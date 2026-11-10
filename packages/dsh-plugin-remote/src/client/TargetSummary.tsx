import { formatSerialSettings } from "../shared/serial"
import type { RemoteTarget, SerialTarget, SshTarget } from "../shared/types"
import { lineEndingLabelKey } from "./serial"
import type { Translate } from "./types"

/** The target rows of an approval card, one set for each transport. */
export function TargetSummary({
  target,
  t,
}: {
  target: RemoteTarget
  t: Translate
}): React.JSX.Element {
  return target.transport === "serial" ? (
    <SerialTargetSummary target={target} t={t} />
  ) : (
    <SshTargetSummary target={target} t={t} />
  )
}

function SshTargetSummary({ target, t }: { target: SshTarget; t: Translate }): React.JSX.Element {
  return (
    <dl className="remote-grid">
      <dt>{t("label.host")}</dt>
      <dd>{target.host}</dd>
      {target.user === undefined ? null : (
        <>
          <dt>{t("label.user")}</dt>
          <dd>{target.user}</dd>
        </>
      )}
      {target.port === undefined ? null : (
        <>
          <dt>{t("label.port")}</dt>
          <dd>{target.port}</dd>
        </>
      )}
      <dt>{t("label.kind")}</dt>
      <dd>{target.kind === "linux" ? t("kind.linux") : t("kind.network")}</dd>
      <dt>{t("label.jump")}</dt>
      <dd>{target.jump ?? t("label.none")}</dd>
      {target.sshOptions.length === 0 ? null : (
        <>
          <dt>{t("label.options")}</dt>
          <dd>{target.sshOptions.join(" ")}</dd>
        </>
      )}
      {target.initCommands.length === 0 ? null : (
        <>
          <dt>{t("label.initCommands")}</dt>
          <dd>{target.initCommands.join(" ; ")}</dd>
        </>
      )}
    </dl>
  )
}

function SerialTargetSummary({
  target,
  t,
}: {
  target: SerialTarget
  t: Translate
}): React.JSX.Element {
  return (
    <>
      <dl className="remote-grid">
        <dt>{t("label.transport")}</dt>
        <dd>{t("transport.serial")}</dd>
        <dt>{t("label.agent")}</dt>
        <dd>{target.agent}</dd>
        <dt>{t("label.agentFingerprint")}</dt>
        <dd className="remote-fingerprint">{target.agentFingerprint}</dd>
        <dt>{t("label.device")}</dt>
        <dd>{target.device}</dd>
        <dt>{t("label.lineSettings")}</dt>
        <dd>{formatSerialSettings(target.serial)}</dd>
        <dt>{t("label.enterKey")}</dt>
        <dd>{t(lineEndingLabelKey(target.lineEnding))}</dd>
        <dt>{t("label.kind")}</dt>
        <dd>{target.kind === "linux" ? t("kind.linux") : t("kind.network")}</dd>
        {target.initCommands.length === 0 ? null : (
          <>
            <dt>{t("label.initCommands")}</dt>
            <dd>{target.initCommands.join(" ; ")}</dd>
          </>
        )}
      </dl>
      <div className="remote-summary">{t("card.register.serialDetail")}</div>
    </>
  )
}
