// lib/slices/uiSlice.ts
import { THEME_MODE } from '../../app/ui/types';
import { createAppSlice } from '../createAppSlice';
const { DARK, LIGHT, SYSTEM } = THEME_MODE;


interface UIState {
  isMenuOpen: boolean;
  theme: THEME_MODE
  ;
}

const initialState: UIState = {
  isMenuOpen: true,
  theme: THEME_MODE.SYSTEM
};

export const uiSlice = createAppSlice({
  name: 'ui',
  initialState,
  reducers: (create) => ({
    toggleMenu: create.reducer((state) => {
      state.isMenuOpen = !state.isMenuOpen;
    }),
    toggleTheme: create.reducer((state) => {
      const isBrowser = typeof window !== 'undefined';
      const theme = isBrowser ? localStorage?.getItem('theme') : state.theme;
      // const theme = (localStorage && localStorage?.getItem('theme')) ? localStorage?.getItem('theme') : state.theme;
      // const theme = state.theme;
      switch (theme) {
        case LIGHT:
          state.theme = DARK;
          break;
        case DARK:
          state.theme = SYSTEM;
          break;
        case SYSTEM:
          state.theme = LIGHT;
          break;
        default:
          state.theme = LIGHT;
      }
      localStorage?.setItem('theme', state.theme);
      // state.theme = state.theme === 'light' ? 'dark' : 'light';
    }),
  }),
  selectors: {
    selectIsMenuOpen: (state) => state.isMenuOpen,
    selectTheme: (state) => state.theme,
  }
});

export const { toggleMenu, toggleTheme } = uiSlice.actions;
// export default uiSlice.reducer;
export const { selectIsMenuOpen, selectTheme } = uiSlice.selectors;
