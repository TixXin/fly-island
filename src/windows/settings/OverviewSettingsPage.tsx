import { useId, useState } from "react";
import { ArrowUpRight, ChevronRight, Keyboard, Languages, Palette, Power, SlidersHorizontal, Sparkles, SunMoon, type LucideIcon } from "lucide-react";
import { SettingsChoice } from "../../components/settings/SettingsChoice";
import { SettingsSelect } from "../../components/settings/SettingsSelect";
import { SettingsSwitch } from "../../components/settings/SettingsSwitch";
import { THEME_MODES } from "../../features/appearance/themeMode";
import type { IslandSettings, ThemeMode } from "../../features/appearance/types";
import { LOCALE_CODES, TRANSLATIONS, isLocaleCode, useTranslation, type LocaleCode } from "../../i18n";
import { isMacOS, useDevBuild, type PlatformFeature } from "../../lib/platform";
import { openOnboardingWindow } from "../onboarding/api";
import { FEATURE_PAGES, isCategoryAvailable, SETTINGS_FEATURES, type SettingsCategory, type SettingsFeature } from "./categories";
import { OverviewStage, type StageFeature } from "./OverviewStage";
import { CATEGORY_ICONS } from "./SettingsSidebar";
import type { FeatureSwitch, FeatureSwitches } from "./useFeatureSwitches";
import { useLaunchAtStartup } from "./useLaunchAtStartup";
import "./OverviewSettingsPage.css";

const LOCALE_OPTIONS = LOCALE_CODES.map((code) => ({ value: code, label: TRANSLATIONS[code].localeLabel }));

export function OverviewSettingsPage({
  settings,
  locale,
  features,
  unsupported,
  onLocaleChange,
  onSettingsChange,
  onOpenPage,
}: {
  settings: IslandSettings;
  locale: LocaleCode;
  features: FeatureSwitches;
  unsupported: ReadonlySet<PlatformFeature>;
  onLocaleChange: (locale: LocaleCode) => void;
  onSettingsChange: (settings: IslandSettings) => void;
  onOpenPage: (page: SettingsCategory) => void;
}) {
  const t = useTranslation();
  const text = t.settings.overview;
  const [launchAtStartup, updateLaunchAtStartup] = useLaunchAtStartup();
  const [spot, setSpot] = useState<StageFeature | null>(null);
  const launchId = useId();
  const devBuild = useDevBuild();
  const offered = SETTINGS_FEATURES.filter((feature) => isCategoryAvailable(FEATURE_PAGES[feature][0], unsupported));

  const playing: StageFeature[] = [...offered.filter((feature) => features[feature].on), "messages"];
  const watch = (feature: StageFeature) => ({
    onMouseEnter: () => setSpot(feature),
    onMouseLeave: () => setSpot(null),
    onFocus: () => setSpot(feature),
    onBlur: () => setSpot(null),
  });
  const next: [LucideIcon, string, string, () => void][] = [
    [SlidersHorizontal, text.look, text.lookHint, () => onOpenPage("appearance")],
    [Palette, text.themes, text.themesHint, () => onOpenPage("themeMarket")],
    [Keyboard, text.shortcuts, text.shortcutsHint, () => onOpenPage("shortcuts")],
    [Sparkles, text.guide, text.guideHint, openOnboardingWindow],
  ];

  return (
    <div className="settings-overview" data-search="off">
      <OverviewStage settings={settings} spot={spot} playing={playing} />

      <section className="settings-group">
        <div className="settings-group__header">
          <h2 className="settings-group__title">{text.basicsTitle}</h2>
        </div>
        <div className="settings-overview__quick">
          <div className="settings-overview__tile" title={text.toneHint}>
            <span className="settings-overview__tile-label"><SunMoon size={15} strokeWidth={1.9} aria-hidden="true" />{text.tone}</span>
            <SettingsChoice<ThemeMode>
              value={settings.themeMode}
              ariaLabel={text.tone}
              options={THEME_MODES.map((mode) => ({ value: mode, label: t.settings.colors.modes[mode] }))}
              onChange={(themeMode) => onSettingsChange({ ...settings, themeMode })}
            />
          </div>
          <div className="settings-overview__tile">
            <span className="settings-overview__tile-label"><Languages size={15} strokeWidth={1.9} aria-hidden="true" />{t.settings.language.label}</span>
            <SettingsSelect
              value={locale}
              options={LOCALE_OPTIONS}
              ariaLabel={t.settings.language.label}
              onChange={(value) => {
                if (isLocaleCode(value)) onLocaleChange(value);
              }}
            />
          </div>
          <div className="settings-overview__tile">
            <label className="settings-overview__tile-label" htmlFor={launchId}><Power size={15} strokeWidth={1.9} aria-hidden="true" />{isMacOS ? t.settings.layout.launchAtStartupMac : t.settings.layout.launchAtStartup}</label>
            <SettingsSwitch id={launchId} checked={launchAtStartup} disabled={devBuild} onChange={updateLaunchAtStartup} />
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group__header">
          <h2 className="settings-group__title">{text.featuresTitle}</h2>
          <span className="settings-overview__count">{text.featuresOn(playing.length, offered.length + 1)}</span>
        </div>
        <ul className="settings-overview__features">
          {offered.map((feature) => (
            <FeatureCard key={feature} feature={feature} state={features[feature]} watch={watch(feature)} onOpen={() => onOpenPage(FEATURE_PAGES[feature][0])} />
          ))}
          <MessagesCard watch={watch("messages")} onOpen={() => onOpenPage("messages")} />
        </ul>
        <div className="settings-group__footer">
          <p>{text.featuresFooter}</p>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group__header">
          <h2 className="settings-group__title">{text.nextTitle}</h2>
        </div>
        <div className="settings-overview__next">
          {next.map(([Icon, title, hint, go]) => (
            <button key={title} className="settings-overview__next-tile" type="button" onClick={go}>
              <span className="settings-overview__next-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.9} /></span>
              <span className="settings-overview__next-text">
                <strong>{title}</strong>
                <span>{hint}</span>
              </span>
              <ArrowUpRight className="settings-overview__next-arrow" size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

type Watch = { onMouseEnter: () => void; onMouseLeave: () => void; onFocus: () => void; onBlur: () => void };

function FeatureCard({ feature, state, watch, onOpen }: { feature: SettingsFeature; state: FeatureSwitch; watch: Watch; onOpen: () => void }) {
  const t = useTranslation();
  const id = useId();
  const page = FEATURE_PAGES[feature][0];
  const name = feature === "agents" ? t.settings.categories.groups.agents : t.settings.categories[page];
  const Icon = CATEGORY_ICONS[page];
  return (
    <li className={`settings-overview__feature${state.on ? " settings-overview__feature--on" : ""}`} data-feature={feature} {...watch}>
      <span className="settings-overview__feature-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="settings-overview__feature-text">
        <label className="settings-overview__feature-name" htmlFor={id}>{name}</label>
        <span className="settings-overview__feature-hint">{t.settings.overview.features[feature]}</span>
      </span>
      <span className="settings-overview__feature-side">
        <SettingsSwitch id={id} checked={state.on} onChange={state.set} />
        {state.on && <OpenLink label={t.settings.overview.open} onClick={onOpen} />}
      </span>
    </li>
  );
}

function MessagesCard({ watch, onOpen }: { watch: Watch; onOpen: () => void }) {
  const t = useTranslation();
  const Icon = CATEGORY_ICONS.messages;
  return (
    <li className="settings-overview__feature settings-overview__feature--on" data-feature="messages" {...watch}>
      <span className="settings-overview__feature-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2} />
      </span>
      <span className="settings-overview__feature-text">
        <span className="settings-overview__feature-name">{t.settings.categories.messages}</span>
        <span className="settings-overview__feature-hint">{t.settings.overview.features.messages}</span>
      </span>
      <span className="settings-overview__feature-side">
        <OpenLink label={t.settings.overview.messagesAction} onClick={onOpen} />
      </span>
    </li>
  );
}

function OpenLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="settings-overview__open" type="button" onClick={onClick}>
      {label}
      <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
