// Central theme registry + persistence.
// Add a new theme later in TWO places only:
//   1) an entry in THEMES below, and
//   2) a matching `[data-theme="<id>"]` block in styles.css.
// Everything else (boot, selector, persistence) keeps working automatically.

const STORAGE_KEY = 'pavav3.theme';

export const THEMES = [
  { id: 'sandstone', label: 'Sandstone', swatch: '#2f6f4f', scheme: 'light' },
  { id: 'midnight', label: 'Midnight', swatch: '#3ddc97', scheme: 'dark' },
  { id: 'emerald', label: 'Emerald', swatch: '#0f9d58', scheme: 'light' },
  { id: 'royal', label: 'Royal', swatch: '#5b6cff', scheme: 'light' },
  { id: 'saffron', label: 'Saffron', swatch: '#e2761b', scheme: 'light' },
  { id: 'marigold', label: 'Marigold', swatch: '#f0a500', scheme: 'light' },
  { id: 'linen', label: 'Linen', swatch: '#b08968', scheme: 'light' }
];

const DEFAULT_THEME = THEMES[0].id;

function isKnown(id) {
  return THEMES.some((theme) => theme.id === id);
}

export function getActiveTheme() {
  let stored = '';
  try {
    stored = window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    stored = '';
  }
  return isKnown(stored) ? stored : DEFAULT_THEME;
}

function syncThemeColorMeta(themeId) {
  const theme = THEMES.find((entry) => entry.id === themeId);
  if (!theme) return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', theme.swatch);
}

export function applyTheme(id) {
  const themeId = isKnown(id) ? id : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', themeId);
  syncThemeColorMeta(themeId);
  return themeId;
}

export function setTheme(id) {
  const themeId = applyTheme(id);
  try {
    window.localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // storage unavailable (private mode) — theme still applies for this session
  }
  return themeId;
}

// Call once at boot, before first render, to avoid a flash of the default theme.
export function initTheme() {
  return applyTheme(getActiveTheme());
}
