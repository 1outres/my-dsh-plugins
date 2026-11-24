import type { CardNumber } from "../shared/model"
import { fail } from "./errors"

export function requiredText(value: string, message: string): string {
  const text = value.trim()
  if (text.length === 0) fail("invalid_input", message)
  return text
}

export function cardNumberOf(value: number): CardNumber {
  if (!Number.isInteger(value) || value < 1) {
    fail("invalid_input", `Card number ${value} is not a positive integer.`)
  }
  return value
}

export function indexWithin(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail("invalid_input", `The index ${value} is outside the ${label} (0 to ${maximum}).`)
  }
  return value
}
