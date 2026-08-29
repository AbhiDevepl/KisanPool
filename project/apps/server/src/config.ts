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
