// Generates JSON Schema for the MCP server's tool input shapes directly from
// shared/types.ts's own exported Widget/WidgetAction/Variable/Plugin types —
// the single source of truth the docs/TODO.md item for this feature asked
// for, so a new widget type or field is picked up here automatically next
// run instead of drifting against a hand-maintained second description of
// the same shapes. See src/main/mcp/tools.ts for where this output is
// actually consumed, and package.json's "generate:mcp-schemas" script.
//
// Run via `npm run generate:mcp-schemas`. The committed output
// (src/shared/generated/mcpSchemas.ts) is checked in — nothing at build/dev
// time regenerates it automatically, so it's on whoever changes
// Widget/WidgetAction/Variable/Plugin to re-run this and commit the diff.
import { createGenerator } from 'ts-json-schema-generator'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TYPES = ['Widget', 'Variable', 'Plugin'] as const

const outPath = join(__dirname, '../src/shared/generated/mcpSchemas.ts')

const generator = createGenerator({
  path: join(__dirname, '../src/shared/types.ts'),
  expose: 'export',
  topRef: true,
  jsDoc: 'none',
  skipTypeCheck: true,
  additionalProperties: false
})

const schemas: Record<string, unknown> = {}
for (const typeName of TYPES) {
  // Each type gets its OWN self-contained schema (its own `definitions` for
  // anything it references) rather than one combined multi-root schema —
  // simpler to embed each one as a single property's schema in tools.ts's
  // hand-written wrapper object schemas (see mergeSchemaIntoProperty there).
  const schema = generator.createSchema(typeName)
  schemas[typeName] = schema
}

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with \`npm run generate:mcp-schemas\` (scripts/generate-mcp-schemas.ts)
// after changing Widget/Variable/Plugin in shared/types.ts.
`

const body = `${header}\nexport const MCP_SCHEMAS = ${JSON.stringify(schemas, null, 2)} as const\n`

writeFileSync(outPath, body, 'utf-8')
console.log(`[generate-mcp-schemas] wrote ${outPath}`)
