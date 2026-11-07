import { shellQuote } from "../../../shared/shell"

export interface SshCommandTarget {
  host: string
  user?: string
  port?: number
  sshOptions: string[]
}

function connectionArgs(target: SshCommandTarget): string[] {
  return [
    ...(target.user === undefined ? [] : ["-l", target.user]),
    ...(target.port === undefined ? [] : ["-p", String(target.port)]),
    ...target.sshOptions.flatMap((option) => ["-o", option]),
  ]
}

/** Command that opens and holds one target's ControlMaster. */
export function buildMasterArgv(
  sshPath: string,
  target: SshCommandTarget,
  controlPath: string,
  persistSeconds: number,
  proxyCommand?: string,
): string[] {
  return [
    sshPath,
    "-M",
    "-N",
    "-S",
    controlPath,
    "-o",
    `ControlPersist=${String(persistSeconds)}`,
    ...(proxyCommand === undefined ? [] : ["-o", `ProxyCommand=${proxyCommand}`]),
    ...connectionArgs(target),
    target.host,
  ]
}

/** Command that runs one plain command through an existing master. */
export function buildExecArgv(
  sshPath: string,
  target: SshCommandTarget,
  controlPath: string,
  command: string,
): string[] {
  return [
    sshPath,
    "-T",
    "-S",
    controlPath,
    "-o",
    "ControlMaster=no",
    "-o",
    "BatchMode=yes",
    ...connectionArgs(target),
    target.host,
    command,
  ]
}

/** Command that opens an interactive shell through an existing master. */
export function buildShellArgv(
  sshPath: string,
  target: SshCommandTarget,
  controlPath: string,
): string[] {
  return [
    sshPath,
    "-tt",
    "-S",
    controlPath,
    "-o",
    "ControlMaster=no",
    "-o",
    "BatchMode=yes",
    ...connectionArgs(target),
    target.host,
  ]
}

/**
 * Build the ProxyCommand the plugin runs through a jump target's own master.
 * OpenSSH replaces %h and %p with the final target's host and port.
 */
export function buildProxyCommand(
  sshPath: string,
  jump: SshCommandTarget,
  jumpControlPath: string,
): string {
  const argv = [
    sshPath,
    "-S",
    jumpControlPath,
    "-o",
    "ControlMaster=no",
    "-o",
    "BatchMode=yes",
    "-W",
    "%h:%p",
    ...(jump.user === undefined ? [] : ["-l", jump.user]),
    ...(jump.port === undefined ? [] : ["-p", String(jump.port)]),
    jump.host,
  ]
  return argv.map(shellQuote).join(" ")
}

/** Command that runs a command with sudo after an explicit authentication. */
export function buildSudoCommand(command: string, passwordless: boolean): string {
  const shell = `sh -c ${shellQuote(command)}`
  return passwordless ? `LC_ALL=C sudo -n -- ${shell}` : `LC_ALL=C sudo -k -S -p '' -- ${shell}`
}

/** Quote one command for a POSIX shell. */
export function quoteCommand(command: string): string {
  return `sh -c ${shellQuote(command)}`
}

/** Read a file as base64 and report its hash, or report that it is missing. */
export function buildReadScript(path: string): string {
  const quoted = shellQuote(path)
  return [
    "set -e",
    `if [ -e ${quoted} ]; then`,
    `  sha256sum -- ${quoted} | cut -d' ' -f1`,
    `  base64 -- ${quoted}`,
    "else",
    "  echo MISSING",
    "fi",
  ].join("\n")
}

/** Report the file's hash so a write can detect a change since the read. */
export function buildHashScript(path: string): string {
  const quoted = shellQuote(path)
  return [
    "set -e",
    `if [ -e ${quoted} ]; then`,
    `  sha256sum -- ${quoted} | cut -d' ' -f1`,
    "else",
    "  echo MISSING",
    "fi",
  ].join("\n")
}

/**
 * Replace a file through a temporary sibling. The expected hash is checked
 * before the rename so a change on the remote becomes a conflict.
 */
export function buildWriteScript(path: string, expectedHash: string | null): string {
  const quoted = shellQuote(path)
  const guard =
    expectedHash === null
      ? []
      : [
          `  current=$(sha256sum -- ${quoted} | cut -d' ' -f1)`,
          `  [ "$current" = ${shellQuote(expectedHash)} ] || { echo "file changed since it was read" >&2; exit 3; }`,
        ]
  return [
    "set -e",
    `p=${quoted}`,
    'd=$(dirname -- "$p")',
    'tmp=$(mktemp "$d/.dsh-remote-XXXXXX")',
    "trap 'rm -f \"$tmp\"' EXIT",
    'if [ -e "$p" ]; then',
    ...(expectedHash === null
      ? ['  echo "file appeared since it was checked" >&2', "  exit 3"]
      : guard),
    '  mode=$(stat -c "%a" "$p")',
    '  uid=$(stat -c "%u" "$p")',
    '  gid=$(stat -c "%g" "$p")',
    '  base64 -d > "$tmp"',
    '  chmod "$mode" "$tmp"',
    '  chown "$uid:$gid" "$tmp" 2>/dev/null || true',
    "else",
    ...(expectedHash === null
      ? []
      : ['  echo "file disappeared since it was read" >&2', "  exit 3"]),
    '  base64 -d > "$tmp"',
    '  chmod 644 "$tmp"',
    "fi",
    'mv -f "$tmp" "$p"',
    "trap - EXIT",
    "echo OK",
  ].join("\n")
}
