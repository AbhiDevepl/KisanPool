import { Platform } from 'react-native';
import { AppError } from './errors';

export interface CheckoutResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface CheckoutOptions {
  orderId: string;
  amount: number; // paise
  keyId: string;
  demo: boolean;
  prefill?: { name?: string; contact?: string };
  description?: string;
}

/**
 * Thin wrapper around the native Razorpay sheet. Resolves with the signature
 * triple, or throws PAYMENT_FAILED when the farmer dismisses or the payment fails.
 * The app never sees the card — Razorpay owns the instrument entirely.
 */
export async function openCheckout(options: CheckoutOptions): Promise<CheckoutResult> {
  // Demo mode: no Razorpay keys configured on the server. The signature check is
  // skipped server-side for these order ids, so verify -> capture -> booking
  // commit still runs end to end.
  if (options.demo) {
    return {
      razorpay_order_id: options.orderId,
      razorpay_payment_id: `pay_demo_${Date.now()}`,
      razorpay_signature: 'demo',
    };
  }

  let RazorpayCheckout: {
    open: (opts: Record<string, unknown>) => Promise<CheckoutResult>;
  };
  try {
    // required lazily so Expo Go (which has no native module) still loads the screen
    RazorpayCheckout = require('react-native-razorpay').default;
  } catch {
    throw new AppError(
      'PAYMENT_FAILED',
      'Payments need the full app build. Please use the development build.',
    );
  }

  try {
    return await RazorpayCheckout.open({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amount,
      currency: 'INR',
      name: 'KisanPool',
      description: options.description ?? 'Your share of the trip cost',
      prefill: options.prefill ?? {},
      theme: { color: '#0d631b' },
      ...(Platform.OS === 'android' ? { send_sms_hash: true } : {}),
    });
  } catch (err) {
    const reason = (err as { description?: string }).description;
    throw new AppError(
      'PAYMENT_FAILED',
      reason ?? "Payment didn't go through. You can try again.",
    );
  }
}
