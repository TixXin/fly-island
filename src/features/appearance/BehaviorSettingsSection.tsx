import { LOCALE_CODES, TRANSLATIONS, isLocaleCode, useTranslation, type LocaleCode } from "../../i18n";
import { isMacOS, useDevBuild } from "../../lib/platform";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { SettingsSelect } from "../../components/settings/SettingsSelect";
import { SettingsToggleRow } from "../../components/settings/SettingsToggleRow";

const LOCALE_OPTIONS = LOCALE_CODES.map((code) => ({ value: code, label: TRANSLATIONS[code].localeLabel }));

export function BehaviorSettingsSection({
  launchAtStartup,
  locale,
  onLaunchAtStartupChange,
  onLocaleChange,
}: {
  launchAtStartup: boolean;
  locale: LocaleCode;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  onLocaleChange: (locale: LocaleCode) => void;
}) {
  const t = useTranslation();
  const devBuild = useDevBuild();
  return (
    <SettingsGroup title={t.settings.behavior.title}>
      <SettingsToggleRow
        title={isMacOS ? t.settings.layout.launchAtStartupMac : t.settings.layout.launchAtStartup}
        description={devBuild ? t.settings.devBuild.launchAtStartupOff : undefined}
        checked={launchAtStartup}
        disabled={devBuild}
        onChange={onLaunchAtStartupChange}
      />
      <SettingsRow
        title={t.settings.language.label}
        control={
          <SettingsSelect
            value={locale}
            options={LOCALE_OPTIONS}
            ariaLabel={t.settings.language.label}
            onChange={(next) => {
              if (isLocaleCode(next)) onLocaleChange(next);
            }}
          />
        }
      />
    </SettingsGroup>
  );
}
