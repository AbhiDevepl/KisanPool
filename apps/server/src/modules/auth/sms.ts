import { config } from '../../config';
import { ApiError } from '../../lib/envelope';

/**
 * Fast2SMS — https://www.fast2sms.com/dev/bulkV2
 *
 * The OTP never appears in an API response once a provider is configured; it only
 * goes to the handset. A send failure is surfaced, never swallowed — a farmer who
 * is told "code sent" but receives nothing has no way forward.
 */
interface Fast2SmsResponse {
  return: boolean;
  request_id?: string;
  message?: string[] | string;
  status_code?: number;
}

const TIMEOUT_MS = 10_000;

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const params = new URLSearchParams({
    route: config.otp.route,
    numbers: phone,
  });

  if (config.otp.route === 'otp') {
    // Fast2SMS's built-in OTP route substitutes the code into their template
    params.set('variables_values', code);
  } else {
    // 'q' (quick) or 'dlt' — we supply the whole message
    params.set('message', `${code} is your KisanPool verification code. Do not share it.`);
    params.set('language', 'english');
    params.set('flash', '0');
    if (config.otp.senderId) params.set('sender_id', config.otp.senderId);
    if (config.otp.messageId) params.set('message_id', config.otp.messageId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let json: Fast2SmsResponse;
  try {
    const res = await fetch(`${config.otp.baseUrl}?${params.toString()}`, {
      method: 'GET',
      headers: { authorization: config.otp.providerApiKey },
      signal: controller.signal,
    });
    json = (await res.json()) as Fast2SmsResponse;
  } catch (err) {
    console.error('[sms] fast2sms unreachable', err);
    throw new ApiError(
      'EXTERNAL_SERVICE_ERROR',
      'We could not send the code right now. Please try again in a moment.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!json.return) {
    // their failures are business-level (no balance, bad number, DLT mismatch) and
    // arrive with HTTP 200, so the body is the only signal
    const detail = Array.isArray(json.message) ? json.message.join('; ') : (json.message ?? '');
    console.error(`[sms] fast2sms refused (status ${json.status_code ?? '?'}): ${detail}`);
    throw new ApiError(
      'EXTERNAL_SERVICE_ERROR',
      'We could not send the code to that number. Please check it and try again.',
    );
  }

  // request_id is safe to log for support; the code never is
  console.log(`[sms] OTP sent to ${maskPhone(phone)} (request ${json.request_id ?? 'n/a'})`);
}

const maskPhone = (phone: string): string => `${phone.slice(0, 2)}******${phone.slice(-2)}`;
