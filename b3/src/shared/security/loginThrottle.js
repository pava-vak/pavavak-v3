// In-memory failed-login throttle with temporary lockout.
// Keyed by caller-supplied strings (we use IP and username+IP) so a remote
// attacker can only lock themselves out, not a victim's account globally.
//
// One instance is created per app (see auth.routes), which keeps test runs
// isolated and matches the single-process deployment. For multi-instance
// horizontal scaling this would need a shared store (Redis/DB).

function createLoginThrottle({
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000
} = {}) {
  const entries = new Map(); // key -> { count, firstAt, lockedUntil }

  function live(key, now) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.lockedUntil && entry.lockedUntil <= now) {
      entries.delete(key);
      return null;
    }
    if (!entry.lockedUntil && now - entry.firstAt > windowMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function check(keys) {
    const now = Date.now();
    let retryAfterMs = 0;
    for (const key of keys) {
      const entry = live(key, now);
      if (entry?.lockedUntil) {
        retryAfterMs = Math.max(retryAfterMs, entry.lockedUntil - now);
      }
    }
    return { locked: retryAfterMs > 0, retryAfterMs };
  }

  function recordFailure(keys) {
    const now = Date.now();
    for (const key of keys) {
      let entry = live(key, now);
      if (!entry) {
        entry = { count: 0, firstAt: now, lockedUntil: 0 };
        entries.set(key, entry);
      }
      entry.count += 1;
      if (entry.count >= maxAttempts) {
        entry.lockedUntil = now + lockMs;
      }
    }
  }

  function reset(keys) {
    for (const key of keys) {
      entries.delete(key);
    }
  }

  return { check, recordFailure, reset };
}

module.exports = { createLoginThrottle };
