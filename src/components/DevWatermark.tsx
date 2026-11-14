import { useTranslation } from "../i18n";
import { useDevBuild } from "../lib/platform";
import "./DevWatermark.css";

export function DevWatermark({ place }: { place: "collapsed" | "panel" | "settings" }) {
  const text = useTranslation().settings.devBuild;
  if (!useDevBuild()) return null;
  return <span className={`dev-watermark dev-watermark--${place}`} aria-hidden="true">{text.mark}</span>;
}
