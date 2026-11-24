import type { TaskBoardErrorCode } from "../shared/model"

export class TaskBoardOperationError extends Error {
  readonly code: TaskBoardErrorCode

  constructor(code: TaskBoardErrorCode, message: string) {
    super(message)
    this.name = "TaskBoardOperationError"
    this.code = code
  }
}

export function fail(code: TaskBoardErrorCode, message: string): never {
  throw new TaskBoardOperationError(code, message)
}
