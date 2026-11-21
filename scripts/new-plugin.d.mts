export function titleOf(name: string): string

export function createPlugin(
  root: string,
  name: string,
): Promise<{ directoryName: string; packageName: string }>
