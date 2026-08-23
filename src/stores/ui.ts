import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  quickLookId: string | null;
  setQuickLookId: (id: string | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  quickLookId: null,
  setQuickLookId: (id) => set({ quickLookId: id }),
}));
