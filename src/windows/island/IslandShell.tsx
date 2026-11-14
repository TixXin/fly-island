import type { CollapsedMeeting } from "../../features/calendar/upcoming";
import type { DeviceUse } from "../../features/device-use/api";
import type { LevelChange } from "../../features/system-levels/api";
import type { DeviceAlert } from "../../features/device-events/api";
import type { ReactNode } from "react";
import type { AgentSession } from "../../features/agent-status/session";
import type { CurrentLyric } from "../../features/media/lyrics/useCurrentLyric";
import type { QuotaAlert } from "../../features/agent-status/quotaAlerts";
import type { AgentVisualState } from "../../features/agent-status/status";
import type { AppearanceMode } from "../../features/appearance/types";
import type { MediaState } from "../../features/media/api";
import type { MessagePreview, MessageSource } from "../../features/messages/messagePreview";
import type { MailController } from "../../features/messages/mail/MailPanel";
import type { QQNotificationsController } from "../../features/messages/qq-notifications/QQNotifications";
import type { WeChatRemindersController } from "../../features/messages/wechat/WeChatReminders";
import type { PluginNotificationsController } from "../../features/plugins/usePluginNotifications";
import { useTranslation } from "../../i18n";
import { isPluginPage, type IslandFeatures } from "./features";
import { IslandCollapsedBar } from "./IslandCollapsedBar";
import { useIslandNotch } from "./notch";
import { NotchPopupBand } from "./NotchPopupBand";
import { IslandHeader } from "./IslandHeader";
import { IconButtonTooltip } from "../../components/IconButtonTooltip";
import type { PluginViewEntry } from "../../features/plugin-views/api";
import type { CollapsedSlots, IslandMode, IslandPage, NativeGlassState } from "./types";
import { useGlassPointer } from "./useGlassPointer";
import { useIslandPreparing } from "./useIslandPreparing";
import { usePageFadeIn } from "./usePageFadeIn";
import { DevWatermark } from "../../components/DevWatermark";
import "./IslandShell.css";
import "./IslandGlassLight.css";
import { IslandResizeHints } from "./IslandResizeHints";
import { IslandSideHandle } from "./IslandSideHandle";
import type { IslandSide } from "./useIslandSide";

type IslandShellProps = {
  qqMail: MailController;
  qqNotifications: QQNotificationsController;
  wechatReminders: WeChatRemindersController;
  pluginNotifications: PluginNotificationsController;
  preview: MessagePreview | null;
  onOpenMessages: (source: MessageSource) => void;
  mode: IslandMode;
  page: IslandPage;
  popup?: boolean;
  resizeLabel?: string | null;
  appearanceMode: AppearanceMode;
  nativeGlassState: NativeGlassState;
  isTucked: boolean;
  isDetached: boolean;
  side?: IslandSide | null;
  showTitle: boolean;
  showCollapsedText: boolean;
  collapsedTaskTitle: string | null;
  collapsedTodoCount: number | null;
  agentSession: AgentSession | null;
  lyricLine?: CurrentLyric | null;
  activeAgentSessionCount: number;
  mediaState: MediaState;
  agentVisualState: AgentVisualState;
  agentStatusLabel: string;
  features: IslandFeatures;
  shelfCount: number | null;
  deviceUse: DeviceUse;
  levelPopup?: LevelChange | null;
  deviceAlert?: DeviceAlert | null;
  quotaAlert?: QuotaAlert | null;
  meeting?: CollapsedMeeting | null;
  onOpenPage: (page: IslandPage) => void;
  onWindowDragStart: () => void;
  onCollapse: () => void;
  onResetPosition: () => void;
  minimizesToTray: boolean;
  onMinimize: () => void;
  onOpenTranslator: (() => void) | null;
  onScreenshot?: (() => void) | null;
  translationPeek: string | null;
  notice?: { content: ReactNode; actions: ReactNode } | null;
  onOpenTranslationPeek: () => void;
  onOpenSettings: (section?: "updates") => void;
  onTuck: () => void;
  onReveal: () => void;
  onPageChange: (page: IslandPage) => void;
  pageDigitModifiers: string;
  hoverSwitchPage: boolean;
  hoverSwitchDelayMs: number;
  overlay?: ReactNode;
  pluginPageButtons?: ReactNode;
  pageActions?: ReactNode;
  pluginViews?: readonly PluginViewEntry[];
  onOpenPluginPage?: (page: `plugin:${string}`) => void;
  collapsedSlots?: CollapsedSlots;
  children: ReactNode;
};

export function IslandShell({
  qqMail,
  qqNotifications,
  wechatReminders,
  pluginNotifications,
  preview,
  onOpenMessages,
  mode,
  page,
  popup = false,
  resizeLabel = null,
  appearanceMode,
  nativeGlassState,
  isTucked,
  isDetached,
  side = null,
  showTitle,
  showCollapsedText,
  collapsedTaskTitle,
  collapsedTodoCount,
  agentSession,
  lyricLine = null,
  activeAgentSessionCount,
  mediaState,
  agentVisualState,
  agentStatusLabel,
  features,
  shelfCount,
  deviceUse,
  levelPopup = null,
  deviceAlert = null,
  quotaAlert = null,
  meeting = null,
  onOpenPage,
  onWindowDragStart,
  onCollapse,
  onResetPosition,
  minimizesToTray,
  onMinimize,
  onOpenTranslator,
  onScreenshot,
  translationPeek,
  notice,
  onOpenTranslationPeek,
  onOpenSettings,
  onTuck,
  onReveal,
  onPageChange,
  pageDigitModifiers,
  hoverSwitchPage,
  hoverSwitchDelayMs,
  overlay,
  pluginPageButtons,
  pageActions,
  pluginViews,
  onOpenPluginPage,
  collapsedSlots,
  children,
}: IslandShellProps) {
  const t = useTranslation();
  const notch = useIslandNotch();
  const isExpanded = mode === "expanded";
  const isLiquidGlass = appearanceMode === "liquidGlass";
  const { handleGlassPointerMove, resetGlassPointer } = useGlassPointer(isLiquidGlass);
  const isPreparing = useIslandPreparing(isExpanded);
  const contentRef = usePageFadeIn<HTMLDivElement>(page, mode);
  const qqNotificationCount = qqNotifications.snapshot.items.length;
  const wechatPending = wechatReminders.snapshot.pending;
  const className = [
    "island",
    `island--${mode}`,
    isPluginPage(page) ? "island--plugin" : `island--${page}`,
    `island--appearance-${appearanceMode}`,
    isPreparing && !isExpanded ? "island--preparing" : "",
    isDetached ? "island--detached" : "island--docked",
    isTucked ? "island--tucked" : "",
    side ? `island--side island--side-${side}` : "",
    popup ? "island--popup" : "",
    isLiquidGlass ? `island--glass-${nativeGlassState}` : "",
    showTitle ? "" : "island--title-hidden",
  ]
    .filter(Boolean)
    .join(" ");
  const collapsedLabel = showCollapsedText
    ? agentSession
      ? t.island.agentSession(agentSession.label, agentSession.title)
      : lyricLine?.text
      ? (lyricLine.song ? t.island.nowPlaying : t.island.lyricLine)(lyricLine.text)
      : collapsedTaskTitle
      ? t.messages.collapsedTask(collapsedTaskTitle)
      : collapsedTodoCount !== null
        ? t.island.pendingTodos(collapsedTodoCount)
        : t.island.appName
    : t.island.appName;

  return (
    <section
      className={className}
      aria-label={collapsedLabel}
      onClick={(event) => {
        if (!isExpanded && event.target === event.currentTarget) {
          onOpenPage(agentSession ? "agents" : lyricLine ? "music" : page);
        }
      }}
      onPointerMove={handleGlassPointerMove}
      onPointerLeave={resetGlassPointer}
      onMouseEnter={() => {
        if (isTucked) {
          onReveal();
        }
      }}
    >
      <div className="island__surface">
        {isLiquidGlass && (
          <div className="island__glass" aria-hidden="true">
            <span className="island__glass-refraction" />
            <span className="island__glass-highlight" />
          </div>
        )}
        {side && (
          <IslandSideHandle
            label={collapsedLabel}
            agentVisualState={agentVisualState}
            unreadCount={qqNotificationCount + Number(wechatPending)}
            onOpen={() => onOpenPage(agentSession ? "agents" : page)}
            onWindowDragStart={onWindowDragStart}
          />
        )}
        <IslandCollapsedBar
          qqMail={qqMail}
          qqNotifications={qqNotifications}
          wechatReminders={wechatReminders}
          pluginNotifications={pluginNotifications}
          pluginViews={pluginViews}
          onOpenPluginPage={onOpenPluginPage}
          slots={collapsedSlots}
          preview={preview}
          page={page}
          isExpanded={isExpanded}
          isTucked={isTucked}
          showTitle={showTitle}
          showCollapsedText={showCollapsedText}
          collapsedLabel={collapsedLabel}
          collapsedTaskTitle={collapsedTaskTitle}
          collapsedTodoCount={collapsedTodoCount}
          agentSession={agentSession}
          lyricLine={lyricLine}
          agentSessionCount={features.agents ? activeAgentSessionCount : null}
          mediaState={mediaState}
          showMusic={features.music}
          shelfCount={shelfCount}
          deviceUse={deviceUse}
          levelPopup={levelPopup}
          deviceAlert={deviceAlert}
          quotaAlert={quotaAlert}
          meeting={meeting}
          agentVisualState={agentVisualState}
          onOpenPage={onOpenPage}
          onOpenMessages={onOpenMessages}
          translationPeek={translationPeek}
          notice={notice}
          onOpenTranslationPeek={onOpenTranslationPeek}
          onWindowDragStart={onWindowDragStart}
          onTuck={onTuck}
        />

        <div
          id="island-panel"
          className="island__expanded"
          aria-hidden={!isExpanded}
          inert={!isExpanded}
        >
          <DevWatermark place="panel" />
          {popup && notch && <NotchPopupBand page={page} agentVisualState={agentVisualState} onCollapse={onCollapse} />}
          <IslandHeader
            page={page}
            features={features}
            showTitle={showTitle}
            isDetached={isDetached}
            agentVisualState={agentVisualState}
            agentStatusLabel={agentStatusLabel}
            qqNotificationCount={qqNotificationCount}
            wechatPending={wechatPending}
            onPageChange={onPageChange}
            onCollapse={onCollapse}
            onOpenSettings={onOpenSettings}
            onOpenMessages={onOpenMessages}
            onOpenTranslator={onOpenTranslator}
            onScreenshot={onScreenshot}
            onResetPosition={onResetPosition}
            minimizesToTray={minimizesToTray}
            onMinimize={onMinimize}
            pageDigitModifiers={pageDigitModifiers}
            hoverSwitchPage={hoverSwitchPage}
            hoverSwitchDelayMs={hoverSwitchDelayMs}
            pluginPageButtons={pluginPageButtons}
            pageActions={pageActions}
          />
          <div ref={contentRef} className="island__content">{children}</div>
        </div>
        {overlay}
      </div>
      <IslandResizeHints isExpanded={isExpanded} popup={popup} sizeLabel={resizeLabel} />
      <IconButtonTooltip />
    </section>
  );
}
