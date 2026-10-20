// The native Android app is published at /download/pava-vak.apk with its version in /download/android.json.
export const ANDROID_APK_URL = '/download/pava-vak.apk';
const BANNER_DISMISSED_KEY = 'pava-android-banner-dismissed';

let releasePromise = null;

export function isAndroidBrowser() {
  return /Android/i.test(navigator.userAgent);
}

/** { versionName, sizeBytes } or null when nothing is published / unreachable. Fetched once per page load. */
export function fetchAndroidRelease() {
  releasePromise ??= fetch('/download/android.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.versionName ? j : null))
    .catch(() => null);
  return releasePromise;
}

export function formatReleaseLabel(release) {
  if (!release) return '';
  const mb = release.sizeBytes ? ` · ${(release.sizeBytes / 1048576).toFixed(0)} MB` : '';
  return `Version ${release.versionName}${mb}`;
}

export function isAndroidBannerDismissed() {
  try { return localStorage.getItem(BANNER_DISMISSED_KEY) === '1'; } catch { return false; }
}

export function dismissAndroidBanner() {
  try { localStorage.setItem(BANNER_DISMISSED_KEY, '1'); } catch { /* private mode: banner just returns next visit */ }
}
