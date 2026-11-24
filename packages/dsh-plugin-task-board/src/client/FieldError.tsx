export interface FieldErrorProps {
  readonly message: string | undefined
}

export function FieldError({ message }: FieldErrorProps) {
  if (message === undefined) return null
  return (
    <p className="tb-field-error" role="alert">
      {message}
    </p>
  )
}
