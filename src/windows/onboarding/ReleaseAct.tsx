import { Bot, Mail, Settings } from "lucide-react";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsToggleRow } from "../../components/settings/SettingsToggleRow";
import { useTranslation } from "../../i18n";
import type { SettingsFocusSection } from "../settings/storage";
import { ActHeading } from "./ActHeading";
import type { OnboardingModule } from "./personas";
import { isMacOS, useDevBuild } from "../../lib/platform";

export function ReleaseAct({ modules, launchAtStartup, onLaunchAtStartupChange, onLeaveForSettings }: {
  modules: ReadonlySet<OnboardingModule>;
  launchAtStartup: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  onLeaveForSettings: (section?: SettingsFocusSection) => void;
}) {
  const text = useTranslation().onboarding.release;
  const devText = useTranslation().settings.devBuild;
  const devBuild = useDevBuild();

  return (
    <>
      <ActHeading title={text.title} lead={text.lead} />
      <SettingsGroup>
        <SettingsToggleRow title={text.launchAtStartup} description={devBuild ? devText.launchAtStartupOff : isMacOS ? text.launchAtStartupHintMac : text.launchAtStartupHint} checked={launchAtStartup} disabled={devBuild} onChange={onLaunchAtStartupChange} />
      </SettingsGroup>
      <p className="onboarding-release__later">{text.later}</p>
      <div className="onboarding-release__links">
        {modules.has("agents") && (
          <button className="onboarding-release__link" type="button" onClick={() => onLeaveForSettings("agentConnect")}>
            <Bot size={16} aria-hidden="true" />
            {text.connectAgents}
          </button>
        )}
        {modules.has("mail") && (
          <button className="onboarding-release__link" type="button" onClick={() => onLeaveForSettings("mail")}>
            <Mail size={16} aria-hidden="true" />
            {text.addMail}
          </button>
        )}
        <button className="onboarding-release__link" type="button" onClick={() => onLeaveForSettings()}>
          <Settings size={16} aria-hidden="true" />
          {text.openSettings}
        </button>
      </div>
      <p className="onboarding-release__later">{isMacOS ? text.findLaterMac : text.findLater}</p>
    </>
  );
}
