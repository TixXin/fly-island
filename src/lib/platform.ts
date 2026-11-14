import { useEffect, useState } from "react";
import { readPlatformSupport, type PlatformFeature, type PlatformSupport } from "./api.ts";

export type { PlatformFeature, PlatformSupport } from "./api.ts";

export const isMacOS = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

const NONE: ReadonlySet<PlatformFeature> = new Set();
let pending: Promise<PlatformSupport | null> | null = null;

function loadPlatformSupport(): Promise<PlatformSupport | null> {
  pending ??= readPlatformSupport()
    .then((support) => support ?? null)
    .catch(() => null);
  return pending;
}

export function loadUnsupportedFeatures(): Promise<ReadonlySet<PlatformFeature>> {
  return loadPlatformSupport().then((support) => (Array.isArray(support?.unsupported) ? new Set(support.unsupported) : NONE));
}

export function loadDevBuild(): Promise<boolean> {
  return loadPlatformSupport().then((support) => support?.devBuild === true);
}

export function useUnsupportedFeatures(): ReadonlySet<PlatformFeature> {
  const [unsupported, setUnsupported] = useState(NONE);
  useEffect(() => {
    let live = true;
    void loadUnsupportedFeatures().then((features) => {
      if (live) setUnsupported(features);
    });
    return () => {
      live = false;
    };
  }, []);
  return unsupported;
}

export function useDevBuild(): boolean {
  const [devBuild, setDevBuild] = useState(false);
  useEffect(() => {
    let live = true;
    void loadDevBuild().then((value) => {
      if (live) setDevBuild(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return devBuild;
}
