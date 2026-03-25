import type { SidebarSide } from "../components/file-sidebar";
import type { PageWidthMode } from "../components/settings-dialog";

export function getSidebarDesktopOffsetClass(sidebarSide: SidebarSide, sidebarCollapsed: boolean) {
  return sidebarSide === "right"
    ? sidebarCollapsed
      ? "lg:pr-16"
      : "lg:pr-80"
    : sidebarCollapsed
      ? "lg:pl-16"
      : "lg:pl-80";
}

export function getPageWidthClass(pageWidthMode: PageWidthMode) {
  return pageWidthMode === "fill" ? "w-full" : "mx-auto w-full max-w-[896px]";
}
