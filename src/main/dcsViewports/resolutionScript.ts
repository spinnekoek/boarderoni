// Low-level Windows display-mode plumbing for the DCS Viewports plugin.
// Empirically verified (2026-08-29, against a live Virtual Display Driver
// install) rather than guessed from vendor docs, which don't cover this:
//
//   - Switching to a resolution the driver already advertises applies
//     instantly via Win32 ChangeDisplaySettingsEx, no elevation, no restart.
//   - Adding a genuinely NEW resolution requires (1) appending it to
//     vdd_settings.xml, then (2) an elevated disable/enable toggle of the
//     driver's PnP device to force it to reload that file — there is no
//     background service watching it. That toggle also renumbers the
//     device's GDI name (\\.\DISPLAY5 -> \\.\DISPLAY6 was observed), so the
//     device name is re-resolved by friendly name every time, never cached.
//
// No native/FFI npm dependency was added for the Win32 calls — a small
// embedded PowerShell + Add-Type C# snippet does it, the same category of
// tool the driver's own vendor scripts (fixxml.ps1) already use, keeping
// this at zero new npm dependencies.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Windows' own PnP adapter friendly name (Device Manager / Get-PnpDevice) —
// confirmed against a live install. NOT the same string Electron's
// Display.label reports for this driver (that's the monitor's own EDID
// name, "VDD by MTT" — see driver.ts's VIRTUAL_DISPLAY_LABEL_MATCH, a
// different namespace entirely), and NOT the same as
// Win32_VideoController.DeviceName either (empirically empty on at least
// one real system for every adapter — see getDeviceNameForBounds below,
// which avoids that WMI property entirely).
const VDD_PNP_INSTANCE_FILTER = "FriendlyName -eq 'Virtual Display Driver'"

async function runPowerShell(script: string): Promise<string> {
  // -EncodedCommand sidesteps all quoting/escaping hazards of handing a
  // multi-line script through argv.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true
  })
  return stdout
}

export interface DisplayMode {
  width: number
  height: number
  frequency: number
}

const DEVMODE_CSHARP = `
using System;
using System.Runtime.InteropServices;
public class BoarderoniDisplay {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
        public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
        public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
        public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
        public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    public static extern int EnumDisplaySettingsA(string deviceName, int modeNum, ref DEVMODE devMode);
    [DllImport("user32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    public static extern int ChangeDisplaySettingsExA(string deviceName, ref DEVMODE devMode, IntPtr hwnd, uint dwflags, IntPtr lParam);
}
`

// Resolves the GDI device name (e.g. "\\\\.\\DISPLAY6") for the virtual
// display — NOT via Win32_VideoController.DeviceName, which is empirically
// EMPTY on at least this system for every adapter (a known WMI quirk, not
// specific to this driver). Instead matches by bounds against
// [System.Windows.Forms.Screen]::AllScreens, which reliably has both
// DeviceName and Bounds — the same coordinate-matching approach already
// verified working during this feature's initial resolution-change spike.
// `bounds` should be the already-resolved Electron Display's own bounds
// (see driver.ts's findVirtualDisplay) so this never has to guess which
// screen is the virtual one itself.
export async function getDeviceNameForBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<string | null> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    if ($s.Bounds.X -eq ${bounds.x} -and $s.Bounds.Y -eq ${bounds.y} -and $s.Bounds.Width -eq ${bounds.width} -and $s.Bounds.Height -eq ${bounds.height}) {
        Write-Output $s.DeviceName
        break
    }
}
`
  const out = await runPowerShell(script)
  const name = out.trim()
  return name.length > 0 ? name : null
}

export async function listDisplayModes(deviceName: string): Promise<DisplayMode[]> {
  const script = `
Add-Type -TypeDefinition @'${DEVMODE_CSHARP}'@ -Language CSharp
$deviceName = "${deviceName}"
$i = 0
while ($true) {
    $mode = New-Object BoarderoniDisplay+DEVMODE
    $mode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mode)
    $result = [BoarderoniDisplay]::EnumDisplaySettingsA($deviceName, $i, [ref]$mode)
    if ($result -eq 0) { break }
    Write-Output "$($mode.dmPelsWidth)x$($mode.dmPelsHeight)@$($mode.dmDisplayFrequency)"
    $i++
    if ($i -gt 200) { break }
}
`
  const out = await runPowerShell(script)
  return out
    .split(/\r?\n/)
    .map((line) => /^(\d+)x(\d+)@(\d+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ width: Number(m[1]), height: Number(m[2]), frequency: Number(m[3]) }))
}

// Non-elevated: only valid for a mode the driver already advertises (see
// listDisplayModes) — applying an unlisted mode fails harmlessly (nonzero
// return), it does not add it.
export async function applyDisplayMode(deviceName: string, mode: DisplayMode): Promise<boolean> {
  const DM_BITSPERPEL = 0x40000
  const DM_PELSWIDTH = 0x80000
  const DM_PELSHEIGHT = 0x100000
  const DM_DISPLAYFREQUENCY = 0x400000
  const CDS_UPDATEREGISTRY = 0x1
  const dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL

  const script = `
Add-Type -TypeDefinition @'${DEVMODE_CSHARP}'@ -Language CSharp
$dm = New-Object BoarderoniDisplay+DEVMODE
$dm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dm)
$dm.dmPelsWidth = ${mode.width}
$dm.dmPelsHeight = ${mode.height}
$dm.dmDisplayFrequency = ${mode.frequency}
$dm.dmBitsPerPel = 32
$dm.dmFields = ${dmFields}
$result = [BoarderoniDisplay]::ChangeDisplaySettingsExA("${deviceName}", [ref]$dm, [IntPtr]::Zero, ${CDS_UPDATEREGISTRY}, [IntPtr]::Zero)
Write-Output $result
`
  const out = await runPowerShell(script)
  return out.trim() === '0'
}

export async function isVirtualDisplayDriverPnpPresent(): Promise<boolean> {
  const out = await runPowerShell(
    `(Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Where-Object { ${VDD_PNP_INSTANCE_FILTER} } | Measure-Object).Count`
  )
  return Number(out.trim()) > 0
}

// Forces the driver to reload vdd_settings.xml (see this file's top
// comment). Requires elevation — surfaces the standard Windows UAC consent
// prompt, which only the human at the keyboard can accept; there is no way
// to script around that, by design of the OS's driver security model.
export async function togglePnpDeviceElevated(): Promise<void> {
  const inner = `
try {
    $dev = Get-PnpDevice -Class Display -ErrorAction Stop | Where-Object { ${VDD_PNP_INSTANCE_FILTER} } | Select-Object -First 1
    if (-not $dev) { throw 'Virtual Display Driver PnP device not found' }
    Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false
    Start-Sleep -Seconds 2
    Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false
} catch {
    exit 1
}
`
  const encodedInner = Buffer.from(inner, 'utf16le').toString('base64')
  const outer = `
$p = Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodedInner}' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Elevated toggle failed with exit code $($p.ExitCode)" }
`
  await runPowerShell(outer)
}
