import { HarnessError } from "@deepseek-ai/dsh-llm"
import type { AdvisorErrorCode } from "../contract"

export class AdvisorError extends HarnessError {
  declare readonly code: AdvisorErrorCode

  constructor(code: AdvisorErrorCode, detail: string) {
    super(`Advisor unavailable (${code}): ${detail}. Continue the task without advice.`, code)
  }
}

const FAILURE_CODES: Readonly<Record<string, AdvisorErrorCode>> = {
  CONTEXT_WINDOW_EXCEEDED: "prompt_too_long",
  RATE_LIMIT: "too_many_requests",
  QUOTA: "too_many_requests",
  ACCOUNT_QUOTA: "too_many_requests",
  SERVER: "overloaded",
  HTTP_503: "overloaded",
  HTTP_529: "overloaded",
  TIMEOUT: "execution_time_exceeded",
  UNKNOWN_MODEL: "model_not_found",
  MODEL_UNSUPPORTED: "model_not_found",
  NO_ADAPTER: "model_not_found",
}

export function classifyFailureCode(code: string): AdvisorErrorCode {
  return FAILURE_CODES[code] ?? "unavailable"
}
