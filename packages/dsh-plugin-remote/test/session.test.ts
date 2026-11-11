import { describe, expect, it } from "vitest"
import { InteractiveSessions } from "../src/host/sessions/session"
import type {
  RemoteTransport,
  ShellHandle,
  TransportCall,
  TransportPrompter,
} from "../src/host/transport/transport"
import type { RemoteTarget } from "../src/shared/types"

class FakeShell implements ShellHandle {
  readonly pid = 1
  readonly enter = "\n"
  exitCode: number | null = null
  written: string[] = []
  breaks: number[] = []
  closes = 0
  closeError: Error | undefined
  onWrite: (data: string) => void = () => {}
  readonly data = new Set<(chunk: string) => void>()
  readonly exits = new Set<(code: number | null) => void>()

  async write(value: string): Promise<void> {
    this.written.push(value)
    this.onWrite(value)
  }

  async sendBreak(durationMs: number): Promise<void> {
    this.breaks.push(durationMs)
  }

  onData(listener: (chunk: string) => void): () => void {
    this.data.add(listener)
    return () => this.data.delete(listener)
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exits.add(listener)
    return () => this.exits.delete(listener)
  }

  emit(chunk: string): void {
    for (const listener of [...this.data]) listener(chunk)
  }

  finish(code = 0): void {
    this.exitCode = code
    for (const listener of [...this.exits]) listener(code)
  }

  async close(): Promise<void> {
    this.closes += 1
    this.finish(0)
    if (this.closeError !== undefined) throw this.closeError
  }

  kill(): void {
    this.finish(0)
  }
}

const target: RemoteTarget = {
  name: "web1",
  transport: "ssh",
  kind: "linux",
  host: "example.com",
  sshOptions: [],
  secrets: ["login", "sudo"],
  initCommands: [],
}

const prompter: TransportPrompter = {
  async secret() {
    return "s3cret"
  },
  async hostKey() {
    return true
  },
}

function call(): TransportCall {
  return { sessionId: "s", callId: "c", signal: new AbortController().signal, prompter }
}

function transportWith(shell: FakeShell, breakable = false): RemoteTransport {
  return {
    id: "ssh",
    capabilities: () => ({
      exec: true,
      sudo: true,
      files: true,
      jump: true,
      interactive: true,
      break: breakable,
    }),
    connect: async () => {},
    disconnect: async () => {},
    isConnected: async () => true,
    exec: async () => {
      throw new Error("not used")
    },
    readFile: async () => {
      throw new Error("not used")
    },
    hashFile: async () => {
      throw new Error("not used")
    },
    writeFile: async () => {},
    openShell: async () => shell,
    disposeSession: async () => {},
  }
}

function sessions(shell: FakeShell, breakable = false): InteractiveSessions {
  return new InteractiveSessions(() => transportWith(shell, breakable), {
    defaultPromptPattern: "[>#$%]\\s*$",
    idleMs: 60,
    sendTimeoutMs: 2000,
    maxOutputBytes: 30000,
    secretValues: () => [],
  })
}

describe("interactive sessions", () => {
  it("opens on the first prompt and returns its output", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("welcome\nops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    expect(opened.reason).toBe("prompt")
    expect(opened.output).toContain("welcome")
    expect(opened.session.state).toBe("open")
  })

  it("does not stop on the prompt that was already on screen before a send", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    shell.onWrite = (data) => {
      if (!data.includes("echo hi")) return
      setTimeout(() => shell.emit("echo hi\r\nhi\r\nops@web1$ "), 10)
    }
    const sent = await manager.send(
      opened.session.id,
      { text: "echo hi", submit: true, wait: true, timeoutMs: 2000 },
      call(),
      prompter,
    )
    expect(sent.reason).toBe("prompt")
    expect(sent.output).toContain("hi")
    expect(sent.output).toContain("ops@web1$")
  })

  it("ends a silent wait on idle", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    shell.onWrite = () => {}
    const sent = await manager.send(
      opened.session.id,
      { text: "sleep 10", submit: true, wait: true, timeoutMs: 5000 },
      call(),
      prompter,
    )
    expect(sent.reason).toBe("idle")
  })

  it("sends a password field and hides its value", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    shell.onWrite = (data) => {
      if (!data.includes("s3cret")) return
      setTimeout(() => shell.emit("s3cret\r\n0\r\nops@web1$ "), 10)
    }
    const sent = await manager.send(
      opened.session.id,
      { secret: "sudo", submit: true, wait: true, timeoutMs: 2000 },
      call(),
      prompter,
    )
    expect(sent.output).toContain("0")
    expect(sent.output.includes("s3cret")).toBe(false)
  })

  it("sends a BREAK when the transport supports it", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell, true)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    expect(await manager.sendBreak(opened.session.id, 250)).toEqual({
      sessionId: opened.session.id,
      durationMs: 250,
    })
    expect(shell.breaks).toEqual([250])
  })

  it("refuses a BREAK on a transport without the capability", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    await expect(manager.sendBreak(opened.session.id, 250)).rejects.toThrow(/cannot send a BREAK/)
  })

  it("refuses to send to an exited shell and names its exit code", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    shell.finish(7)
    await expect(
      manager.send(
        opened.session.id,
        { text: "exit", submit: true, wait: true, timeoutMs: 2000 },
        call(),
        prompter,
      ),
    ).rejects.toThrow(/exited.*7/)
  })

  it("closes a session only after its shell is released", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    expect(await manager.close(opened.session.id)).toBe(true)
    expect(shell.closes).toBe(1)
    expect(manager.statuses()).toEqual([])
  })

  it("returns false for an unknown session id", async () => {
    const manager = sessions(new FakeShell())
    expect(await manager.close("session-404")).toBe(false)
  })

  it("reports a close error after forgetting the session", async () => {
    const shell = new FakeShell()
    const manager = sessions(shell)
    setTimeout(() => shell.emit("ops@web1$ "), 5)
    const opened = await manager.open(target, "shell", call())
    shell.closeError = new Error("the port did not close")
    await expect(manager.close(opened.session.id)).rejects.toThrow(/the port did not close/)
    expect(manager.statuses()).toEqual([])
  })
})
