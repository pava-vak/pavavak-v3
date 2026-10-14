// Central theme registry + persistence.
// Add a new theme later in TWO places only:
//   1) an entry in THEMES below, and
//   2) a matching `[data-theme="<id>"]` block in styles.css.
// Everything else (boot, selector, persistence) keeps working automatically.

const STORAGE_KEY = 'pavav3.theme';

export const THEMES = [
  // Dark themes (Obsidian Whisper)
  { id: 'midnight',    label: 'Midnight',    swatch: '#38bdf8', scheme: 'dark' },
  { id: 'emerald',     label: 'Emerald',     swatch: '#10b981', scheme: 'dark' },
  { id: 'sandstone',   label: 'Sandstone',   swatch: '#d4a373', scheme: 'dark' },
  { id: 'royal',       label: 'Royal',       swatch: '#818cf8', scheme: 'dark' },
  { id: 'saffron',     label: 'Saffron',     swatch: '#f59e0b', scheme: 'dark' },
  { id: 'marigold',    label: 'Marigold',    swatch: '#fb923c', scheme: 'dark' },
  { id: 'linen',       label: 'Linen',       swatch: '#e2e8f0', scheme: 'dark' },
  // Light themes (Linen Pure & Warm Light)
  { id: 'linen-lt',    label: 'Linen',       swatch: '#1f4e5b', scheme: 'light' },
  { id: 'emerald-lt',  label: 'Emerald',     swatch: '#2c694e', scheme: 'light' },
  { id: 'sandstone-lt',label: 'Sandstone',   swatch: '#c2824c', scheme: 'light' },
  { id: 'royal-lt',    label: 'Royal',       swatch: '#4f46e5', scheme: 'light' },
  { id: 'saffron-lt',  label: 'Saffron',     swatch: '#d97706', scheme: 'light' },
  { id: 'marigold-lt', label: 'Marigold',    swatch: '#ea580c', scheme: 'light' },
];

const DEFAULT_THEME = THEMES[0].id; // midnight

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
