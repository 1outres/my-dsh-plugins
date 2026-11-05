// A scripted stand-in for the `claude` binary. It uses no account, no network and no credentials.
// The FAKE_CLAUDE variable holds a JSON scenario. See `FakeClaudeScenario` in test/support.
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as sleep } from "node:timers/promises"

const scenario = JSON.parse(process.env.FAKE_CLAUDE ?? "{}")
const argv = process.argv.slice(2)

function record(entry) {
  if (scenario.record === undefined) return
  appendFileSync(scenario.record, `${JSON.stringify(entry)}\n`)
}

function emit(row) {
  process.stdout.write(`${JSON.stringify(row)}\n`)
}

async function waitForFile(path) {
  while (!existsSync(path)) await sleep(5)
}

async function runStep(step) {
  if (step.out !== undefined) emit(step.out)
  if (step.raw !== undefined) process.stdout.write(`${step.raw}\n`)
  if (step.err !== undefined) process.stderr.write(`${step.err}\n`)
  if (step.touch !== undefined) writeFileSync(step.touch, "")
  if (step.waitFor !== undefined) await waitForFile(step.waitFor)
  if (step.sleepMs !== undefined) await sleep(step.sleepMs)
  if (step.flood !== undefined) await flood(step.flood)
  if (step.descendant !== undefined) startDescendant(step.descendant)
  if (step.exit !== undefined) process.exit(step.exit)
}

async function flood(rows) {
  const tail = "x".repeat(1024)
  for (let index = 0; index < rows; index += 1) {
    const written = process.stdout.write(`${JSON.stringify({ type: "system", tail })}\n`)
    process.stderr.write(`${tail}\n`)
    if (!written) await new Promise((resolve) => process.stdout.once("drain", resolve))
  }
}

function startDescendant({ pidFile, inheritStdout }) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: ["ignore", inheritStdout === true ? "inherit" : "ignore", "ignore"],
  })
  writeFileSync(pidFile, String(child.pid))
  child.unref()
}

async function runScript(steps) {
  for (const step of steps ?? []) await runStep(step)
}

async function authStatus() {
  if (scenario.authRaw !== undefined) process.stdout.write(`${scenario.authRaw}\n`)
  else emit(scenario.auth)
  await runScript(scenario.authScript)
  process.exit(scenario.auth?.loggedIn === true ? 0 : 1)
}

async function readLines(onLine) {
  for await (const line of createInterface({ input: process.stdin })) await onLine(line)
}

async function handshake() {
  await readLines(async (line) => {
    const request = JSON.parse(line)
    record({ handshake: request })
    await runScript(scenario.handshakeScript)
    if (scenario.handshakeRaw !== undefined) {
      process.stdout.write(`${scenario.handshakeRaw}\n`)
      return
    }
    const firstParty = !process.env.ANTHROPIC_BASE_URL
    const models = firstParty ? (scenario.served ?? scenario.models) : scenario.models
    emit({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: { models, account: scenario.account },
      },
    })
  })
  await runScript(scenario.afterHandshake)
}

function argValue(flag) {
  return argv[argv.indexOf(flag) + 1]
}

function recordRequestFiles() {
  const mcp = JSON.parse(argValue("--mcp-config"))
  const inert = mcp.mcpServers.dsh
  record({
    files: {
      directory: dirname(argValue("--system-prompt-file")),
      system: readFileSync(argValue("--system-prompt-file"), "utf8"),
      settings: JSON.parse(readFileSync(argValue("--settings"), "utf8")),
      tools: JSON.parse(readFileSync(inert.args[1], "utf8")),
      mcp,
    },
  })
}

async function turn() {
  recordRequestFiles()
  await runScript(scenario.atStart)
  if (scenario.neverRead === true) await sleep(60_000)
  let lines = 0
  await readLines(async (line) => {
    lines += 1
    const frame = JSON.parse(line)
    record({ frame: { type: frame.type, shouldQuery: frame.shouldQuery, bytes: line.length } })
    if (lines === 1) await runScript(scenario.afterFirstFrame)
    if (frame.shouldQuery === false) emit({ type: "result", num_turns: 0, is_error: false })
  })
  await runScript(scenario.script)
}

record({ argv, env: process.env, cwd: process.cwd() })
if (argv[0] === "auth" && argv[1] === "status") await authStatus()
else if (argv.includes("--max-turns")) await turn()
else await handshake()
