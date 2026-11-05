import { isDeepStrictEqual } from "node:util"

function shown(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) return String(value)
  return text.length <= 600 ? text : `${text.slice(0, 600)}... (${text.length} chars)`
}

/** Collects what differed in one case, so a case reports all of it and not only the first. */
export class Checks {
  readonly failures: string[] = []

  equal(label: string, actual: unknown, expected: unknown): void {
    if (isDeepStrictEqual(actual, expected)) return
    this.failures.push(`${label}: expected ${shown(expected)}, got ${shown(actual)}`)
  }

  ok(label: string, condition: boolean, detail?: unknown): void {
    if (condition) return
    this.failures.push(detail === undefined ? label : `${label}: ${shown(detail)}`)
  }
}

export type Facts = Record<string, unknown>

export interface EvalCase {
  name: string
  run(checks: Checks, facts: Facts): Promise<void>
}

async function runOne(evalCase: EvalCase): Promise<boolean> {
  const checks = new Checks()
  const facts: Facts = {}
  try {
    await evalCase.run(checks, facts)
  } catch (error) {
    checks.failures.push(
      `threw: ${error instanceof Error ? (error.stack ?? error.message) : error}`,
    )
  }
  const passed = checks.failures.length === 0
  console.log(`${passed ? "PASS" : "FAIL"} ${evalCase.name} ${JSON.stringify(facts)}`)
  for (const failure of checks.failures) console.log(`  - ${failure}`)
  return passed
}

/** Runs the cases in order and ends the process: non-zero when any of them failed. */
export async function runEval(title: string, cases: readonly EvalCase[]): Promise<never> {
  const failed: string[] = []
  for (const evalCase of cases) {
    if (!(await runOne(evalCase))) failed.push(evalCase.name)
  }
  const passed = cases.length - failed.length
  console.log(`${title}: ${passed}/${cases.length} passed`)
  if (failed.length > 0) console.log(`failed: ${failed.join(", ")}`)
  process.exit(failed.length === 0 ? 0 : 1)
}
