# FAQ

For fixing something that isn't working, see
[Troubleshooting](USER_MANUAL.md#17-troubleshooting) in the user manual.

- **I see a lot of DCS World references — is this only for DCS?** — No.
  Boarderoni is a general-purpose dashboard/control-panel tool: widgets,
  variables, event sources, REST/webhook actions, and everything else work
  the same regardless of what's driving them. DCS-BIOS and DCS Viewports are
  just one plugin (and one export flow) among several — see
  [Plugins & event sources](USER_MANUAL.md#9-plugins--event-sources) for the
  full list. The docs lean on DCS examples mainly because that's what the
  examples were built and tested against, not because of any hard
  dependency.
- **Will updating Boarderoni break my saved decks?** — The dashboard file
  format can still change between versions, since the app is pre-1.0. A
  migration path is kept for existing saves, but always back up a deck you
  care about before updating, just in case.
- **Does Boarderoni send any data outside my network, or need an account?**
  — No. Everything runs locally over your own network — no cloud service,
  no account, no external server involved. The desktop app and any
  connected devices (phone, tablet, second PC) talk to each other directly
  over your LAN.
- **What's the difference between the "editor" and the "client"?** —
  The editor is where you design a deck — drag/drop/resize widgets, edit
  properties, and so on. The client is the live, full-screen,
  pressable rendering of that same deck, as opposed to the design surface.
  The desktop app itself can show either; any other connected device only
  ever sees the client.
- **Is there an iPhone/iPad app?** — No, the only native client is Android.
  But you don't need one: any device with a modern browser on the same
  network can open a deck (see
  [Viewing a dashboard on another device](USER_MANUAL.md#2-viewing-a-dashboard-on-another-device)).
  iOS Safari hasn't been tested yet, so if you hit a problem there, please
  open an issue.
- **Does it run on Mac or Linux?** — Not for now. Boarderoni is Windows
  only, and has only been tested on Windows 11. Several plugins (Windows
  Audio, some DCS-BIOS/input pieces) depend on Windows-specific native
  modules.
- **Why isn't the Android app on Google Play?** — It's distributed as an
  APK on the [Releases](../../../releases) page instead. The app's full
  source is in [`android/`](../android/) in this repository, so you can
  check what you're installing, or build it yourself.
- **Is it free? Can I use it commercially?** — It's free for any
  noncommercial use (personal, hobby, research, nonprofit/educational/
  government) under the [PolyForm Noncommercial 1.0.0](../LICENSE)
  license. Commercial use needs a separate arrangement with the copyright
  holder.
- **Can I use a deck from outside my home network?** — Not by design.
  Boarderoni only talks over your local network; there's no cloud relay.
- **Which ports does it use? What do I need to allow in my firewall?** —
  TCP **17334** is the app's own server, which every client connects to.
  TCP **17335** is only used if you enable the MCP server (see
  [AI agents (MCP)](USER_MANUAL.md#16-ai-agents-mcp)). The Android app
  also finds the desktop through mDNS (UDP 5353); if that's blocked you can
  still connect by entering the address yourself. If devices can't connect
  at all, see the firewall steps under
  [Troubleshooting](USER_MANUAL.md#17-troubleshooting).
- **How do I back up a deck, or move it to another PC?** — Use **Export**
  in the deck picker to save a deck to a `.boarderoni` file, and
  **Import** to load it back (see [Decks](USER_MANUAL.md#3-decks)). All of
  Boarderoni's data lives in `%APPDATA%\boarderoni` if you want to back up
  everything at once.
- **Can several devices use the same deck at once?** — Yes. Every
  connected device shows the same deck and stays in sync live, so pressing
  a button on one updates the others.
- **Why does a new device need approval?** — So a random device on your
  network can't watch or control your dashboard. Each device is approved
  once, from the desktop editor (see
  [Devices & approval](USER_MANUAL.md#10-devices--approval)).
- **Do I need AI, or an account, to use Boarderoni?** — No. The app runs
  entirely locally, and the AI agent (MCP) server is optional and off by
  default. The note in the README about Claude is about how the app was
  developed, not something it needs to run.
- **Is it safe to leave the MCP server on?** — It's reachable from any
  machine on your network, and its token gives full write access to every
  deck. Turn it off when you're not using it, and **Regenerate** the token
  if it ever leaks (see [AI agents (MCP)](USER_MANUAL.md#16-ai-agents-mcp)).
