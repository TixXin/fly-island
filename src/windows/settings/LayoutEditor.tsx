import { useRef, useState, type ReactNode } from "react";
import { DevWatermark } from "../../components/DevWatermark";
import { useTranslation } from "../../i18n";
import { isMacOS } from "../../lib/platform";
import { entryOf, type SettingsCategory } from "./categories";
import { SettingsTabs } from "./SettingsTabs";
import { SettingsSidebar } from "./SettingsSidebar";
import { useFoundRow, type FoundRow } from "./useFoundRow";
import { WindowControls } from "./WindowControls";
import "./LayoutEditor.css";
import "./SettingsSidebarNarrow.css";
import "./SettingsMac.css";

export function LayoutEditor({
  category,
  hidden,
  titleAction,
  children,
  onCategoryChange,
}: {
  category: SettingsCategory;
  hidden?: ReadonlySet<SettingsCategory>;
  titleAction?: ReactNode;
  children: ReactNode;
  onCategoryChange: (category: SettingsCategory) => void;
}) {
  const t = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<FoundRow | null>(null);
  useFoundRow(found, category, panel);
  const entry = entryOf(category);
  return (
    <div className="settings-layout" data-tauri-drag-region>
      {!isMacOS && <WindowControls style="windows" />}
      <DevWatermark place="settings" />
      <div className="settings-sidebar-card" data-tauri-drag-region>
        <SettingsSidebar
          category={category}
          hidden={hidden}
          onCategoryChange={onCategoryChange}
          onRowOpen={(page, title) => {
            onCategoryChange(page);
            setFound({ page, title, at: Date.now() });
          }}
        />
      </div>

      <div className="settings-content">
        <div className="settings-page__header" data-tauri-drag-region>
          <h1 className="settings-page__title" data-tauri-drag-region>{entry ? t.settings.categories.entries[entry] : t.settings.categories[category]}</h1>
          {titleAction}
        </div>
        <SettingsTabs category={category} onCategoryChange={onCategoryChange} />
        <div className="editor-panel" key={category} ref={panel}>
          {children}
        </div>
      </div>
    </div>
  );
}
