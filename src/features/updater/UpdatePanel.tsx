import { useEffect, useSyncExternalStore } from "react";
import { ArrowDownToLine, CircleCheck, Download, LoaderCircle, PackageCheck, RefreshCcw, TriangleAlert } from "lucide-react";
import { SettingsLinkButton } from "../../components/settings/SettingsLinkButton";
import { useErrorText, useLocale, useTranslation } from "../../i18n";
import { useDevBuild } from "../../lib/platform";
import { ProjectLink } from "./ProjectLink";
import { websitePage } from "./projectLinks";
import { UpdateNotes } from "./UpdateNotes";
import {
  checkForUpdate,
  checkOnFirstVisit,
  getUpdateState,
  installUpdate,
  skipVersion,
  subscribeToUpdate,
  type UpdateStage,
} from "./updaterController";
import "./ProjectSettingsSection.css";
import "./UpdatePanel.css";

type Tone = "muted" | "ok" | "new" | "busy" | "error";

const TONES: Record<Exclude<UpdateStage, "disabled">, Tone> = {
  idle: "muted", checking: "busy", latest: "ok", available: "new", downloading: "busy",
  ready: "new", installing: "busy", done: "ok", error: "error",
};

function StageIcon({ stage }: { stage: UpdateStage }) {
  const props = { size: 20, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (stage === "checking" || stage === "downloading" || stage === "installing") return <LoaderCircle className="update-status__spinner" {...props} />;
  if (stage === "latest" || stage === "done") return <CircleCheck {...props} />;
  if (stage === "available") return <ArrowDownToLine {...props} />;
  if (stage === "ready") return <PackageCheck {...props} />;
  if (stage === "error") return <TriangleAlert {...props} />;
  return <RefreshCcw {...props} />;
}

export function UpdatePanel() {
  const t = useTranslation();
  const text = t.settings.project.update;
  const devBuild = useDevBuild();
  const hero = t.settings.project.hero;
  const errorText = useErrorText();
  const { locale } = useLocale();
  const { stage, version, channel, nextVersion, notes, downloaded, total, detail, skippedVersion, commandError, autoUpdate } = useSyncExternalStore(
    subscribeToUpdate,
    getUpdateState,
  );

  useEffect(() => {
    void checkOnFirstVisit();
  }, []);

  if (stage === "disabled") {
    return (
      <ProjectLink
        href={websitePage(locale, "releases/")}
        tone="release"
        title={t.settings.project.latestRelease}
        hint={devBuild ? t.settings.devBuild.updateOff : text.unavailable}
        icon={<Download className="project-link__icon" size={18} strokeWidth={1.8} aria-hidden="true" />}
      />
    );
  }

  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  const skipped = nextVersion !== "" && skippedVersion === nextVersion;
  const current = version ? text.versionLabel(version) : "";
  const install = () => void installUpdate(nextVersion, channel);
  const step = version ? `v${version} → v${nextVersion}` : `v${nextVersion}`;

  let headline = current || text.title;
  let sub = hero.idle;
  if (stage === "checking") { headline = text.checking; sub = current; }
  else if (stage === "latest") { headline = text.upToDate; sub = current; }
  else if (stage === "available") { headline = text.available(nextVersion); sub = skipped ? text.skipped(nextVersion) : current; }
  else if (stage === "downloading") { headline = percent === null ? text.downloadingUnknown : text.downloading(percent); sub = step; }
  else if (stage === "ready") { headline = hero.ready(nextVersion); sub = skipped ? text.skipped(nextVersion) : autoUpdate === "install" ? text.readyIdleHint : text.readyHint; }
  else if (stage === "installing") { headline = text.installing; sub = `${step} · ${text.readyHint}`; }
  else if (stage === "done") { headline = text.done; sub = current; }
  else if (stage === "error") { headline = hero.error; sub = detail ? text.errorDetail(detail) : text.error; }

  const offersUpdate = stage === "available" || stage === "ready";

  return (
    <div className={`update-status update-status--${TONES[stage]}`}>
      <div className="update-status__row">
        <span className="update-status__icon"><StageIcon stage={stage} /></span>
        <div className="update-status__copy" role={stage === "error" ? "alert" : "status"}>
          <strong>{headline}</strong>
          {sub ? <span>{sub}</span> : null}
        </div>
        <div className="update-status__actions">
          {offersUpdate ? (
            <>
              <span title={skipped ? undefined : text.skipHint}>
                <SettingsLinkButton onClick={() => skipVersion(skipped ? null : nextVersion)}>{skipped ? text.unskip : text.skip}</SettingsLinkButton>
              </span>
              {stage === "available" ? <SettingsLinkButton onClick={() => void checkForUpdate()}>{text.recheck}</SettingsLinkButton> : null}
              <button className="update-status__button update-status__button--primary" type="button" onClick={install}>
                {stage === "ready" ? text.installNow : text.download}
              </button>
            </>
          ) : stage === "idle" || stage === "latest" || stage === "error" || stage === "checking" ? (
            <button className="update-status__button" type="button" disabled={stage === "checking"} onClick={() => void checkForUpdate()}>
              {stage === "error" ? text.retry : text.title}
            </button>
          ) : null}
        </div>
      </div>
      {commandError !== null && <p className="update-status__error" role="alert">{errorText(commandError)}</p>}
      {(stage === "downloading" || stage === "installing") && (
        <div
          className={percent === null ? "update-status__track update-status__track--unknown" : "update-status__track"}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span className="update-status__fill" style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
      {(offersUpdate || stage === "downloading") && <UpdateNotes notes={notes} version={nextVersion} />}
    </div>
  );
}
