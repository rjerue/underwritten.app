import { useMemo } from "react";

import { AboutPage } from "../components/about-page";
import { BrandNavigation } from "../components/brand-navigation";
import { ModeToggle } from "../components/mode-toggle";
import { useApplyAppearanceSettings } from "../editor/appearance";
import { defaultAppearance, defaultPageWidthMode } from "../editor/constants";
import { getPageWidthClass } from "../editor/layout";
import { loadAppearance, loadWorkspaceSettings } from "../editor/storage";

export function AboutRoute() {
  const initialAppearance = useMemo(() => loadAppearance(), []);
  const initialWorkspace = useMemo(() => loadWorkspaceSettings(), []);
  const appearanceSettings = initialAppearance ?? defaultAppearance;
  const pageWidthMode = initialWorkspace?.pageWidthMode ?? defaultPageWidthMode;

  useApplyAppearanceSettings(appearanceSettings);

  return (
    <div className="min-h-screen bg-background">
      <div data-page-width={pageWidthMode} data-testid="about-shell">
        <div className="flex min-h-screen flex-col">
          <div className="min-w-0 flex-1 px-6 pt-8 pb-8 lg:px-8 lg:pt-8 lg:pb-8">
            <div className={getPageWidthClass(pageWidthMode)} data-testid="page-width-container">
              <div className="mb-4 flex items-center justify-between gap-4">
                <BrandNavigation />
                <ModeToggle />
              </div>
              <AboutPage />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
