// Main-process-only hardened replacement for shared/expr.ts's
// tryEvaluateExpression/evaluateMappingExpression — same exported names and
// signatures (drop-in), different internals.
//
// shared/expr.ts's own version runs in THREE places: the main process, the
// desktop editor's own renderer (a plain Chromium page — contextIsolation +
// nodeIntegration:false, see createEditorWindow in index.ts, means it has
// no Node globals to reach regardless of eval mechanism), and the
// Android/browser client (a plain WebView/browser, same story). In
// those latter two, `new Function(code)` is exactly as safe as any other
// page's own inline script — there's nothing Node-shaped for it to reach.
// The main process is different: it's a CommonJS module (see out/main/
// index.js), so a bare `new Function('variables','console',code)` body
// still closes over THIS FILE'S OWN module scope, and `process` — including
// `process.mainModule.require(...)`, confirmed working in this app's own
// 2026-09-18 security review — is reachable from inside it. That's the ONE
// runtime this module exists to harden; main/index.ts and mcp/tools.ts
// import from here instead of shared/expr.ts for exactly that reason. Every
// renderer/Android-facing call site (ClientCanvas.tsx, states.ts,
// switchPosition.ts, ...) keeps using the shared, unmodified version — it
// was never the vulnerable one.
//
// node:vm's isolated context is Node's own documented next step past
// `new Function` + string eval — NOT a hard security boundary. Node's own
// docs are explicit that vm should not be relied on to run fully untrusted
// code safely (there are known Proxy/prototype-based escapes against older
// engine versions). What it DOES reliably give: a freshly created
// vm.createContext() has its own separate set of intrinsics (Object,
// Function, Array, Error, ...) with NO Node built-ins injected into it at
// all — process, require, module, global, Buffer simply don't exist there,
// unlike a bare `new Function` body which still sees this file's own
// CommonJS scope. That directly defeats the exact payload this app's own
// review demonstrated, and every simpler variant of it — meaningfully
// raising the bar, even though it isn't "provably safe against a
// sufficiently creative attacker" the way a real capability-based sandbox
// (or just not running arbitrary strings as code at all) would be.
import { createContext, Script } from 'node:vm'
import type { VariableMap, ExpressionResult } from '../shared/expr'
import type { VariableValue } from '../shared/types'
import { getExpressionConsoleSink } from '../shared/expr'

// Expressions here are meant to be near-instant color/value/condition
// one-liners, evaluated inline in hot paths (an in-flight drag tick, a fast
// DCS-BIOS/REST stream) — 50ms is generous for any real one while still
// bounding a runaway loop's damage per single evaluation. The OLD `new
// Function` path had no timeout at all (an infinite loop would hang the
// main process's event loop forever); this is a strict improvement, not a
// new restriction on anything that previously worked.
const EVAL_TIMEOUT_MS = 50

// vm's execution timeout only interrupts a script while it's actually
// running inside a runInContext(..., {timeout}) call — NOT a function value
// merely retrieved from one and invoked separately afterward, from host
// code, as an ordinary call. So construction AND invocation of the user's
// code both have to happen inside the same script string, in the same
// runInContext call, or the timeout wouldn't actually bound anything.
// __variables__/__console__ are exposed as context globals (not real
// user-facing names — the user's own code only ever sees them as the
// `variables`/`console` PARAMETERS of the wrapper function below, exactly
// matching new Function('variables','console',code)'s own calling
// convention and implicit-undefined-without-`return` semantics).
function buildScript(code: string): Script {
  return new Script(`(function (variables, console) {\n${code}\n})(__variables__, __console__)`, {
    filename: '<boarderoni-expression>'
  })
}

// A runtime error thrown FROM WITHIN a running vm script is an instance of
// that context's OWN separate Error class, not this file's — `err
// instanceof Error` is false for it despite being a perfectly normal
// Error-shaped object, a documented vm cross-realm quirk. Duck-typing on
// `.message` instead of instanceof sidesteps that for both a vm-realm error
// and an ordinary host one (a malformed `code` string that fails to parse
// at all, thrown by `new Script` itself before any context is involved).
function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

export function tryEvaluateExpression(code: string, variables: VariableMap): ExpressionResult {
  try {
    const sink = getExpressionConsoleSink()
    const context = createContext(
      {
        __variables__: variables,
        __console__: { log: (...args: unknown[]) => sink?.(args) }
      },
      // Belt-and-suspenders beyond the fresh no-Node-builtins context
      // itself: blocks eval()/new Function() FROM WORKING inside this
      // already-isolated realm too (throws EvalError instead), so a
      // malicious expression can't even spawn further string-run code
      // within its own sandbox. Doesn't affect ordinary calls like
      // JSON.parse — only string-to-code generation.
      { codeGeneration: { strings: false, wasm: false } }
    )
    const value = buildScript(code).runInContext(context, { timeout: EVAL_TIMEOUT_MS })
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// Same $value/$index contract as shared/expr.ts's own version — see its
// comment. Deliberately not just re-exported from there: routing through
// THIS file's tryEvaluateExpression is the whole point, so every caller
// gets the sandboxed evaluator underneath regardless of which of these two
// entry points it uses.
export function evaluateMappingExpression(expr: string, rawValue: VariableValue, variables: VariableMap, index?: number): ExpressionResult {
  return tryEvaluateExpression(expr, { ...variables, $value: rawValue, ...(index !== undefined ? { $index: index } : {}) })
}
