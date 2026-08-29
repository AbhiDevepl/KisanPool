import dotenv from 'dotenv';
import path from 'path';

// The repo root .env is shared by the server and (via EXPO_PUBLIC_*) the app.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/kisanpool',

  jwtSecret: process.env.JWT_SECRET ?? 'dev-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
  accessTokenTtl: '30d',
  refreshTokenTtl: '90d',

  otp: {
    providerApiKey: process.env.OTP_PROVIDER_API_KEY ?? '',
    // Fast2SMS — https://www.fast2sms.com/dev/bulkV2
    baseUrl: process.env.FAST2SMS_BASE_URL ?? 'https://www.fast2sms.com/dev/bulkV2',
    /** 'otp' uses Fast2SMS's own OTP template; 'q'/'dlt' send our own message text */
    route: process.env.FAST2SMS_ROUTE ?? 'otp',
    senderId: process.env.FAST2SMS_SENDER_ID ?? '',
    messageId: process.env.FAST2SMS_MESSAGE_ID ?? '',
    ttlMs: 5 * 60 * 1000,
    length: 6,
    maxPerWindow: 5,
    windowMs: 15 * 60 * 1000,
    /** with no provider key the OTP is logged to the console — demo mode */
    get   demoMode(): boolean {
      return !this.providerApiKey;
    },
  },

  sarvam: {
    apiKey: process.env.SARVAM_API_KEY ?? '',
    baseUrl: 'https://api.sarvam.ai',
    sttModel: process.env.SARVAM_STT_MODEL ?? 'saaras:v3',
    ttsModel: process.env.SARVAM_TTS_MODEL ?? 'bulbul:v3',
    // sarvam-m was retired by Sarvam; keep the model name configurable so the next
    // rename is an env change, not a code change
    chatModel: process.env.SARVAM_CHAT_MODEL ?? 'sarvam-105b',
  },

  // No hardcoded API keys; fallback to empty string so directions cleanly use straight-line estimation when unconfigured
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    get enabled(): boolean {
      return Boolean(this.keyId && this.keySecret);
    },
  },

  // Policy values are config, never literals in the payment code (ADR-013).
  cancellationFeePct: num(process.env.PLATFORM_CANCELLATION_FEE_PCT, 5),
  platformFeePct: num(process.env.PLATFORM_FEE_PCT, 10),

  cloudinaryUrl: process.env.CLOUDINARY_URL ?? '',

  /**
   * Optional operational cache + durable journal backend (ADR-044).
   *
   * Entirely optional: with no URL the app runs exactly as before, reading and
   * writing MongoDB directly, and the recovery journal falls back to a local
   * fsync'd append-only file. Redis is only ever treated as DURABLE when it
   * reports `appendonly yes` — a cache-mode Redis can lose acknowledged writes,
   * so it is never trusted to hold pending intent.
   */
  redis: {
    url: process.env.REDIS_URL ?? '',
    /**
     * How to decide whether Redis may be trusted with pending intent.
     *
     *   auto     (default) trust ONLY when Redis reports `appendonly yes`.
     *   durable  the operator asserts this provider persists. Needed for managed
     *            services — Upstash, ElastiCache with AOF, Memorystore — which
     *            genuinely are durable but do not run standard Redis AOF and so
     *            answer `CONFIG GET appendonly` with `no` or refuse it outright.
     *   cache    never trust it with intent, whatever it reports.
     *
     * `auto` is deliberately the conservative default: unverifiable is not the
     * same as verified, and the cost of being wrong is a lost booking. The
     * override exists so a correct provider is not permanently mislabelled — but
     * it has to be a deliberate act, not an inference (ADR-044).
     */
    durability: (process.env.REDIS_DURABILITY ?? 'auto').toLowerCase() as
      | 'auto'
      | 'durable'
      | 'cache',
    get enabled(): boolean {
      return Boolean(this.url);
    },
  },

  resilience: {
    /** durable journal location when Redis is absent or not AOF-backed */
    journalFile: process.env.RECOVERY_JOURNAL_FILE ?? '.data/recovery-journal.log',
    /** consecutive failed probes before an incident is declared — debounce, not a hair trigger */
    failureThreshold: num(process.env.RECOVERY_FAILURE_THRESHOLD, 3),
    /** how often the health probe runs, ms */
    probeIntervalMs: num(process.env.RECOVERY_PROBE_INTERVAL_MS, 10_000),
    /** how long a cached operational snapshot stays presentable, seconds */
    snapshotTtlSeconds: num(process.env.RECOVERY_SNAPSHOT_TTL_SECONDS, 900),
  },

  admin: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'admin',
    sessionTtl: '12h',
    /** true when the built-in credentials are still in use */
    get usingDefaults(): boolean {
      return !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD;
    },
  },

  isProd: process.env.NODE_ENV === 'production',
} as const;
