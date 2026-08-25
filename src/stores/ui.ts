import { create } from "zustand";

export type ListLayout = "list" | "grid";

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  quickLookId: string | null;
  setQuickLookId: (id: string | null) => void;

  listLayout: ListLayout;
  setListLayout: (layout: ListLayout) => void;

  listCollapsed: boolean;
  setListCollapsed: (collapsed: boolean) => void;
  toggleListCollapsed: () => void;
}

const savedLayout = localStorage.getItem("nookspace.list-layout.v1");
const savedCollapsed = localStorage.getItem("nookspace.list-collapsed.v1");

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  quickLookId: null,
  setQuickLookId: (id) => set({ quickLookId: id }),

  listLayout: savedLayout === "grid" ? "grid" : "list",
  setListLayout: (listLayout) => {
    localStorage.setItem("nookspace.list-layout.v1", listLayout);
    set({ listLayout });
  },

  listCollapsed: savedCollapsed === "1",
  setListCollapsed: (listCollapsed) => {
    localStorage.setItem("nookspace.list-collapsed.v1", listCollapsed ? "1" : "0");
    set({ listCollapsed });
  },
  toggleListCollapsed: () => get().setListCollapsed(!get().listCollapsed),
}));
