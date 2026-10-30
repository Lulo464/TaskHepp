import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://tasklog:tasklog@localhost:5432/tasklog'),
  /** Public base URL, used for the webhook URL, monitor link and OIDC redirect. */
  PUBLIC_URL: z.string().default('http://localhost:8080'),
  /** `oidc` for real logins; `dev` logs everyone in as DEV_USER_EMAIL (admin). Never use `dev` in production. */
  AUTH_MODE: z.enum(['oidc', 'dev']).default('oidc'),
  DEV_USER_EMAIL: z.string().default('admin@example.com'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid profile email groups'),
  OIDC_GROUPS_CLAIM: z.string().default('groups'),
  /** Always admin, whatever the groups say — to get in before the group mapping is set up. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  /** Signs the short-lived login cookie. */
  COOKIE_SECRET: z.string().min(32).default('dev-only-cookie-secret-change-me-please!!'),
  SESSION_DAYS: z.coerce.number().default(30),
  /** Home Assistant; values saved in the admin UI take precedence. */
  HA_URL: z.string().optional(),
  HA_TOKEN: z.string().optional(),
  /** Folder with the built admin UI to serve at `/`. */
  ADMIN_DIST: z.string().optional(),
  /** Folder for photos attached to tickets. */
  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** Folder for the nightly JSON backup (03:00); unset = no automatic backup. */
  BACKUP_DIR: z.string().optional(),
  SEED_DEMO: z.stringbool().default(false),
  TZ: z.string().default('Europe/Berlin'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.AUTH_MODE === 'oidc' && (!config.OIDC_ISSUER || !config.OIDC_CLIENT_ID)) {
    throw new Error('AUTH_MODE=oidc needs OIDC_ISSUER and OIDC_CLIENT_ID (or set AUTH_MODE=dev for local development)');
  }
  return config;
}
