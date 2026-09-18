import { describe, expect, it } from 'vitest'
import { tryEvaluateExpression, evaluateMappingExpression } from './sandboxedExpr'

describe('sandboxedExpr', () => {
  it('evaluates an ordinary expression and returns its value', () => {
    const result = tryEvaluateExpression('return variables.foo + 1', { foo: 41 })
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('mirrors new Function\'s own implicit-undefined-without-return semantics', () => {
    // No explicit `return` — same as `new Function('variables','console','variables.foo')`
    // would give (a function BODY, not an expression), not vm.Script's own
    // "last statement's completion value" default. Getting this wrong would
    // silently change behavior for every existing expression missing a
    // `return`, not just a security regression.
    const result = tryEvaluateExpression('variables.foo', { foo: 41 })
    expect(result).toEqual({ ok: true, value: undefined })
  })

  it('has no access to process, require, module, or global — the exact escape this module exists to close', () => {
    for (const name of ['process', 'require', 'module', 'global']) {
      const result = tryEvaluateExpression(`return typeof ${name}`, {})
      expect(result).toEqual({ ok: true, value: 'undefined' })
    }
  })

  it('globalThis exists (every realm has its own, including this sandboxed one) but nothing dangerous hangs off it', () => {
    const exists = tryEvaluateExpression('return typeof globalThis', {})
    expect(exists).toEqual({ ok: true, value: 'object' })
    for (const name of ['process', 'require', 'module']) {
      const result = tryEvaluateExpression(`return typeof globalThis.${name}`, {})
      expect(result).toEqual({ ok: true, value: 'undefined' })
    }
  })

  it('rejects the exact payload confirmed working against the old evaluator', () => {
    const result = tryEvaluateExpression('return process.mainModule.require("os").hostname()', {})
    expect(result.ok).toBe(false)
  })

  it('blocks eval()/new Function() from working even inside the sandbox itself', () => {
    const evalResult = tryEvaluateExpression('return eval("1+1")', {})
    expect(evalResult.ok).toBe(false)
    const fnResult = tryEvaluateExpression('return new Function("return 1")()', {})
    expect(fnResult.ok).toBe(false)
  })

  it('times out a runaway loop instead of hanging forever', () => {
    const result = tryEvaluateExpression('while (true) {}', {})
    expect(result.ok).toBe(false)
  })

  it('a syntax error is caught, not thrown', () => {
    const result = tryEvaluateExpression('this is not valid javascript {{{', {})
    expect(result.ok).toBe(false)
  })

  it('evaluateMappingExpression exposes $value and $index', () => {
    const result = evaluateMappingExpression('return `${variables.$value}-${variables.$index}`', 'hi', {}, 3)
    expect(result).toEqual({ ok: true, value: 'hi-3' })
  })
})
