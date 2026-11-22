import type {
  AgentPort,
  AgentsPort,
  Clock,
  LauncherPort,
  LoggerPort,
  ResumeRecord,
  ResumeStore,
  WatchdogPort,
} from "../contract"
import { cancelledMessage, type RunningSession, runningRefusal } from "./admission"

export interface RestartCoordinatorOptions {
  readonly agents: AgentsPort
  readonly store: ResumeStore
  readonly launcher: LauncherPort
  readonly watchdog: WatchdogPort
  readonly clock: Clock
  readonly logger: LoggerPort
  readonly exitCode: number
}

/** The restart that waits for its caller to stop working. */
interface PendingRestart {
  readonly caller: AgentPort
  readonly note: string | undefined
  readonly requestedAt: number
}

type CoordinatorState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly restart: PendingRestart }
  | { readonly kind: "exiting" }

/** Decides when one restart may run, and hands it to the launcher. */
export class RestartCoordinator {
  private state: CoordinatorState = { kind: "idle" }

  /**
   * @param options - the agents, storage, and launcher facts the restart needs.
   */
  constructor(private readonly options: RestartCoordinatorOptions) {}

  /**
   * Accept one restart request and queue it until the caller is idle.
   * @param caller - live root agent that asked for the restart.
   * @param note - what the agent should do after the restart.
   * @throws when a restart is pending, or when another session is running.
   */
  request(caller: AgentPort, note: string | undefined): void {
    if (this.state.kind === "exiting") {
      throw new Error("DeepSeek Harness is already restarting")
    }
    if (this.state.kind === "pending") {
      throw new Error("A restart is already pending; it starts when this session stops working")
    }
    const running = this.runningSessions((agent) => agent.id !== caller.id)
    if (running.length > 0) throw new Error(runningRefusal(running))
    const restart: PendingRestart = { caller, note, requestedAt: this.options.clock() }
    this.state = { kind: "pending", restart }
    this.options.logger.info(`restart asked by session ${caller.sessionId}`)
    void this.settle(restart).catch((error: unknown) => {
      this.options.logger.warn(`restart failed: ${String(error)}`)
      if (this.state.kind === "pending" && this.state.restart === restart) {
        this.state = { kind: "idle" }
      }
    })
  }

  /**
   * Drop a pending restart when the session that asked for it is gone.
   * @param agentId - id of the agent that was just disposed.
   */
  onAgentDisposed(agentId: string): void {
    if (this.state.kind !== "pending" || this.state.restart.caller.id !== agentId) return
    this.state = { kind: "idle" }
    this.options.logger.info(
      "the session that asked for the restart was closed; the restart was cancelled",
    )
  }

  private async settle(restart: PendingRestart): Promise<void> {
    await restart.caller.whenIdle()
    if (this.state.kind !== "pending" || this.state.restart !== restart) return
    const running = this.runningSessions(() => true)
    if (running.length > 0) {
      this.state = { kind: "idle" }
      this.options.logger.info(
        `restart cancelled; running sessions: ${running.map((session) => session.sessionId).join(", ")}`,
      )
      restart.caller.followup(cancelledMessage(running))
      return
    }
    this.state = { kind: "exiting" }
    try {
      await this.options.store.save(this.recordOf(restart))
    } catch (error: unknown) {
      this.state = { kind: "idle" }
      this.options.logger.warn(`could not store the resume request: ${String(error)}`)
      restart.caller.followup(storeFailedMessage(String(error)))
      return
    }
    this.options.logger.info(
      `exiting with code ${this.options.exitCode} to restart; this session resumes on startup`,
    )
    this.options.launcher.exit(this.options.exitCode)
    this.options.watchdog.arm()
  }

  private runningSessions(keep: (agent: AgentPort) => boolean): RunningSession[] {
    return this.options.agents
      .list()
      .filter((agent) => keep(agent) && agent.status() === "running")
      .map((agent) =>
        agent.title === undefined
          ? { sessionId: agent.sessionId }
          : { sessionId: agent.sessionId, title: agent.title },
      )
  }

  private recordOf(restart: PendingRestart): ResumeRecord {
    return restart.note === undefined
      ? { sessionId: restart.caller.sessionId, requestedAt: restart.requestedAt }
      : {
          sessionId: restart.caller.sessionId,
          note: restart.note,
          requestedAt: restart.requestedAt,
        }
  }
}

function storeFailedMessage(reason: string): string {
  return `DeepSeek Harness did not restart: its resume request could not be stored (${reason}). Fix that, then ask again.`
}
