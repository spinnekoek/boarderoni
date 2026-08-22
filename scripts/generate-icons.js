// Regenerates every rasterized icon/favicon variant from resources/icon.svg.
// Run with: node scripts/generate-icons.js
'use strict'

const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const sharp = require('sharp')

const ROOT = join(__dirname, '..')
const SVG_PATH = join(ROOT, 'resources/icon.svg')
const PUBLIC_DIR = join(ROOT, 'src/renderer/public')
const RESOURCES_DIR = join(ROOT, 'resources')

const svg = readFileSync(SVG_PATH)

function renderPng(size, outPath) {
  return sharp(svg, { density: (72 * size) / 512 })
    .resize(size, size)
    .png()
    .toBuffer()
    .then((buf) => {
      writeFileSync(outPath, buf)
      return buf
    })
}

// Minimal PNG-in-ICO packer (Windows Vista+ reads PNG-compressed ICO
// entries directly, so no BMP/DIB re-encoding is needed) — avoids pulling
// in an extra dependency just to concatenate a handful of PNG buffers.
function buildIco(pngBuffers, outPath) {
  const count = pngBuffers.length
  const headerSize = 6 + 16 * count
  let offset = headerSize
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  pngBuffers.forEach(({ size, buf }, i) => {
    const entryOffset = 6 + i * 16
    const dim = size >= 256 ? 0 : size // 0 means 256 per the ICO spec
    header.writeUInt8(dim, entryOffset + 0) // width
    header.writeUInt8(dim, entryOffset + 1) // height
    header.writeUInt8(0, entryOffset + 2) // color count (0 = no palette)
    header.writeUInt8(0, entryOffset + 3) // reserved
    header.writeUInt16LE(1, entryOffset + 4) // color planes
    header.writeUInt16LE(32, entryOffset + 6) // bits per pixel
    header.writeUInt32LE(buf.length, entryOffset + 8) // bytes in resource
    header.writeUInt32LE(offset, entryOffset + 12) // offset
    offset += buf.length
  })

  writeFileSync(outPath, Buffer.concat([header, ...pngBuffers.map((p) => p.buf)]))
}

async function main() {
  mkdirSync(PUBLIC_DIR, { recursive: true })

  // App/window icon (Electron main-process BrowserWindow icon)
  await renderPng(512, join(RESOURCES_DIR, 'icon.png'))
  const icon256 = await renderPng(256, join(RESOURCES_DIR, 'icon-256.png'))

  // Favicon + web-manifest variants served alongside index.html
  const sizes = [16, 32, 48, 96, 180, 192, 512]
  const pngBySize = {}
  for (const size of sizes) {
    pngBySize[size] = await renderPng(size, join(PUBLIC_DIR, `icon-${size}.png`))
  }

  writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), svg)
  writeFileSync(join(PUBLIC_DIR, 'apple-touch-icon.png'), pngBySize[180])

  buildIco(
    [16, 32, 48].map((size) => ({ size, buf: pngBySize[size] })),
    join(PUBLIC_DIR, 'favicon.ico')
  )
  buildIco(
    [
      { size: 16, buf: pngBySize[16] },
      { size: 32, buf: pngBySize[32] },
      { size: 48, buf: pngBySize[48] },
      { size: 256, buf: icon256 }
    ],
    join(RESOURCES_DIR, 'icon.ico')
  )

  const manifest = {
    name: 'Boarderoni',
    short_name: 'Boarderoni',
    description: 'Design button/macro dashboards and drive them from an Android WebView client',
    start_url: '.',
    display: 'standalone',
    background_color: '#14161b',
    theme_color: '#14161b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
    ]
  }
  writeFileSync(join(PUBLIC_DIR, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n')

  console.log('Icons generated:')
  console.log(' -', join(RESOURCES_DIR, 'icon.png'))
  console.log(' -', join(RESOURCES_DIR, 'icon.ico'))
  console.log(' -', PUBLIC_DIR, '(favicon.svg, favicon.ico, icon-*.png, apple-touch-icon.png, site.webmanifest)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
