import { THEME_SET, THEME_TOGGLE } from '../actions/theme.js';

export const STORAGE_KEY = 'td-theme';
export const DARK = 'dark';
export const LIGHT = 'light';

const normalize = (theme) => (theme === DARK ? DARK : LIGHT);

// Dark when the OS/browser reports a dark colour-scheme preference.
export const getSystemTheme = () => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
    }
    return LIGHT;
};

// Saved preference wins; otherwise seed from the system preference.
export const getInitialTheme = () => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === DARK || stored === LIGHT) {
            return stored;
        }
    } catch (e) {
        // localStorage may be unavailable (private mode / SSR) - fall through
    }
    return getSystemTheme();
};

// Reflect the theme onto <body> so the CSS variable overrides take effect.
export const applyTheme = (theme) => {
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.toggle('dark', normalize(theme) === DARK);
    }
};

const state = {
    theme: getInitialTheme()
};

const actions = {
    [THEME_SET]: ({ commit }, theme) => commit(THEME_SET, normalize(theme)),
    [THEME_TOGGLE]: ({ commit, state }) => commit(THEME_SET, state.theme === DARK ? LIGHT : DARK)
};

const mutations = {
    [THEME_SET]: (state, theme) => {
        state.theme = normalize(theme);
        applyTheme(state.theme);
        try {
            window.localStorage.setItem(STORAGE_KEY, state.theme);
        } catch (e) {
            // ignore persistence failures
        }
    }
};

const getters = {
    isDark: (state) => state.theme === DARK
};

export default {
    state,
    actions,
    mutations,
    getters
};
