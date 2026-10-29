const { z } = require('zod');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3201),
    WEB_ORIGIN: z.string().url().default('http://localhost:3202'),
    WEB_ORIGINS: z.string().optional(),
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_SSL_REJECT_UNAUTHORIZED: z.preprocess(
      (v) => v === true || v === 'true' || v === '1',
      z.boolean()
    ).optional(),
    ALLOW_DEV_LOGIN: z.preprocess(
      (v) => v === true || v === 'true' || v === '1',
      z.boolean()
    ).default(false),
    // Public self-service signup. Off by default: accounts are admin-provisioned, so the open
    // /auth/register endpoint is closed (404) unless this is explicitly enabled.
    ALLOW_PUBLIC_REGISTRATION: z.preprocess(
      (v) => v === true || v === 'true' || v === '1',
      z.boolean()
    ).default(false),
    // Secret URL for the private "add a member" page (/api/v3/admin-panel/<token>).
    // Unset => the page is a normal 404. Must be 64 hex chars when set.
    ADMIN_PANEL_TOKEN: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    JWT_ACCESS_SECRET: z.string().min(16).optional(),
    JWT_REFRESH_SECRET: z.string().min(16).optional(),
    JWT_ACCESS_TTL: z.string().min(2).default('15m'),
    JWT_REFRESH_TTL: z.string().min(2).default('30d'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SOCKET_PATH: z.string().min(1).default('/socket.io'),
    // legacy is demo-only: per-user copies, no durable cross-user delivery.
    CHAT_STORAGE_MODE: z.enum(['legacy', 'normalized', 'dual-write']).default('normalized'),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).default('mailto:admin@pava.app'),
    // Path to the Firebase service-account JSON (outside git). Unset = no Android push.
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
    // TURN/STUN for voice & video calls. Unset = calls unavailable (clients fall back to public STUN only).
    TURN_SECRET: z.string().min(1).optional(),
    TURN_HOST: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    const requiresSecrets = value.NODE_ENV === 'production' || value.APP_ENV === 'production';
    if (requiresSecrets) {
      if (!value.JWT_ACCESS_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET is required in production'
        });
      }
      if (!value.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET is required in production'
        });
      }
    }
    if (value.APP_ENV === 'production' && value.ALLOW_DEV_LOGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_DEV_LOGIN'],
        message: 'ALLOW_DEV_LOGIN must be false in production'
      });
    }
    if (value.CHAT_STORAGE_MODE !== 'legacy' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: `DATABASE_URL is required when CHAT_STORAGE_MODE=${value.CHAT_STORAGE_MODE}`
      });
    }
  });

const parsed = envSchema.parse(process.env);

const isLocalDatabase = parsed.DATABASE_URL
  ? /localhost|127\.0\.0\.1/.test(parsed.DATABASE_URL)
  : false;

const env = {
  ...parsed,
  JWT_ACCESS_SECRET: parsed.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
  JWT_REFRESH_SECRET: parsed.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  DATABASE_SSL_REJECT_UNAUTHORIZED:
    parsed.DATABASE_SSL_REJECT_UNAUTHORIZED ??
    (parsed.DATABASE_URL && !isLocalDatabase),
  webOrigins: (parsed.WEB_ORIGINS || parsed.WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
};

module.exports = { env };
