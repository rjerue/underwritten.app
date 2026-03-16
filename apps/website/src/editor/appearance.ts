import { useEffect } from "react";

import type { AppearanceSettings } from "../components/settings-dialog";
import { fontPresets } from "./constants";
import { saveAppearance } from "./storage";

export function useApplyAppearanceSettings(appearanceSettings: AppearanceSettings) {
  useEffect(() => {
    const selectedPreset =
      fontPresets.find((preset) => preset.id === appearanceSettings.fontPresetId) ?? fontPresets[0];
    if (!selectedPreset) return;

    const root = document.documentElement;
    root.style.setProperty("--font-sans", selectedPreset.sans);
    root.style.setProperty("--font-mono", selectedPreset.mono);
    root.style.fontSize = `${appearanceSettings.baseFontSize}px`;
    saveAppearance(appearanceSettings);
  }, [appearanceSettings]);
}
