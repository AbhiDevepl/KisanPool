import { createHash, randomInt } from 'crypto';
import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { User } from '../../models';
import { sendOtpSms } from './sms';
import type { Role } from '@kisanpool/shared';

const hashOtp = (code: string): string => createHash('sha256').update(code).digest('hex');

/**
 * OTP is stored hashed with a short TTL on the user document — no Redis just for
 * this (brief §10). With no provider key configured the code is logged instead of
 * sent, which is how the demo runs.
 */
export async function requestOtp(phone: string, role: Role): Promise<{ sent: true; devCode?: string }> {
  const existing = await User.findOne({ phone }).select(
    '+otpHash +otpExpiresAt +otpAttempts +otpRequestedAt +otpRequestCount',
  );

  const now = Date.now();
  if (existing?.otpRequestedAt) {
    const windowStart = existing.otpRequestedAt.getTime();
    const withinWindow = now - windowStart < config.otp.windowMs;
    if (withinWindow && (existing.otpRequestCount ?? 0) >= config.otp.maxPerWindow) {
      throw new ApiError(
        'AUTH_RATE_LIMITED',
        'Too many code requests. Please wait a few minutes and try again.',
      );
    }
  }

  const code = String(randomInt(0, 10 ** config.otp.length)).padStart(config.otp.length, '0');
  const windowExpired =
    !existing?.otpRequestedAt || now - existing.otpRequestedAt.getTime() >= config.otp.windowMs;

  await User.updateOne(
    { phone },
    {
      $set: {
        phone,
        otpHash: hashOtp(code),
        otpExpiresAt: new Date(now + config.otp.ttlMs),
        otpAttempts: 0,
        ...(windowExpired ? { otpRequestedAt: new Date(now), otpRequestCount: 1 } : {}),
      },
      ...(windowExpired ? {} : { $inc: { otpRequestCount: 1 } }),
      $setOnInsert: { role },
    },
    { upsert: true },
  );

  if (config.otp.demoMode) {
    console.log(`[auth] OTP for ${phone}: ${code}`);
    return { sent: true, devCode: code };
  }

  // A send failure must fail the request. Returning { sent: true } after the SMS
  // did not go out leaves the farmer waiting for a code that will never arrive.
  await sendOtpSms(phone, code);
  return { sent: true };
}

export async function verifyOtp(phone: string, code: string) {
  const user = await User.findOne({ phone }).select('+otpHash +otpExpiresAt +otpAttempts');

  if (!user?.otpHash || !user.otpExpiresAt) {
    throw new ApiError('AUTH_OTP_INVALID', 'That code is not valid. Please request a new one.');
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    throw new ApiError('AUTH_OTP_INVALID', 'That code has expired. Please request a new one.');
  }
  if ((user.otpAttempts ?? 0) >= 5) {
    throw new ApiError('AUTH_RATE_LIMITED', 'Too many attempts. Please request a new code.');
  }
  if (user.otpHash !== hashOtp(code)) {
    await User.updateOne({ _id: user._id }, { $inc: { otpAttempts: 1 } });
    throw new ApiError('AUTH_OTP_INVALID', 'That code is not correct. Please try again.');
  }

  user.set({
    phoneVerifiedAt: new Date(),
    otpHash: undefined,
    otpExpiresAt: undefined,
    otpAttempts: 0,
  });
  await user.save();

  return issueTokens(String(user._id), user.role as Role, user);
}

export async function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await User.findById(payload.sub);
  if (!user) throw new ApiError('AUTH_UNAUTHENTICATED', 'Please sign in again.');
  return issueTokens(String(user._id), user.role as Role, user);
}

function issueTokens(userId: string, role: Role, user: unknown) {
  return {
    accessToken: signAccessToken({ sub: userId, role }),
    refreshToken: signRefreshToken({ sub: userId, role }),
    user,
  };
}
