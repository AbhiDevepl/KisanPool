/**
 * The app's single error surface. It switches on the shared ErrorCode union with
 * no default branch, so an unhandled code is a compile error rather than a
 * generic toast (docs/API_CONTRACTS.md §5 rule 6, ADR-018).
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import type { ErrorCode } from '@kisanpool/shared';
import { toAppError } from '../lib/errors';
import { space } from '../theme';
import { Button, EmptyState } from './ui';

interface Handling {
  icon: Parameters<typeof EmptyState>[0]['icon'];
  action: 'retry' | 'redirect' | 'none';
  redirectTo?: string;
  actionLabel?: string;
}

/** One entry per code — the union is exhaustive by construction. */
const HANDLING: Record<ErrorCode, Handling> = {
  AUTH_UNAUTHENTICATED: { icon: 'lock', action: 'redirect', redirectTo: '/(auth)/welcome', actionLabel: 'Sign in' },
  AUTH_FORBIDDEN: { icon: 'block', action: 'redirect', redirectTo: '/', actionLabel: 'Go home' },
  AUTH_OTP_INVALID: { icon: 'sms', action: 'none' },
  AUTH_RATE_LIMITED: { icon: 'timer', action: 'none' },

  KYC_REQUIRED: { icon: 'badge', action: 'redirect', redirectTo: '/(auth)/kyc', actionLabel: 'Complete KYC' },
  KYC_PENDING_REVIEW: { icon: 'hourglass-empty', action: 'none' },
  KYC_DOCUMENT_REJECTED: { icon: 'error-outline', action: 'redirect', redirectTo: '/(auth)/kyc', actionLabel: 'Re-upload documents' },

  PAYMENT_FAILED: { icon: 'payment', action: 'retry', actionLabel: 'Try again' },
  PAYMENT_SIGNATURE_INVALID: { icon: 'gpp-maybe', action: 'none' },
  PAYMENT_NOT_CAPTURED: { icon: 'hourglass-top', action: 'retry', actionLabel: 'Check again' },
  PAYMENT_REFUND_NOT_ALLOWED: { icon: 'support-agent', action: 'none' },
  PAYOUT_ACCOUNT_INACTIVE: { icon: 'account-balance', action: 'redirect', redirectTo: '/(auth)/kyc', actionLabel: 'Add bank details' },
  PAYOUT_TRANSFER_FAILED: { icon: 'schedule', action: 'none' },

  CAPACITY_EXCEEDED: { icon: 'local-shipping', action: 'retry', actionLabel: 'See other vehicles' },
  CONCURRENT_BOOKING: { icon: 'local-shipping', action: 'retry', actionLabel: 'See other vehicles' },

  NO_VEHICLE_AVAILABLE: { icon: 'search-off', action: 'none' },
  MATCH_EXPIRED: { icon: 'update', action: 'retry', actionLabel: 'Refresh matches' },
  POD_REQUIRED: { icon: 'photo-camera', action: 'none' },

  BOOKING_STATE_INVALID: { icon: 'sync-problem', action: 'retry', actionLabel: 'Refresh' },
  BOOKING_ALREADY_RATED: { icon: 'star', action: 'none' },

  AI_INTENT_UNCLEAR: { icon: 'help-outline', action: 'none' },
  AI_TOOL_ERROR: { icon: 'mic-off', action: 'none' },

  VALIDATION_ERROR: { icon: 'edit', action: 'none' },
  RESOURCE_NOT_FOUND: { icon: 'search-off', action: 'redirect', redirectTo: '/', actionLabel: 'Go home' },
  EXTERNAL_SERVICE_ERROR: { icon: 'wifi-off', action: 'retry', actionLabel: 'Try again' },
};

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const router = useRouter();
  const appError = toAppError(error);
  const handling = HANDLING[appError.code];

  return (
    <View style={{ paddingVertical: space.lg }}>
      <EmptyState
        icon={handling.icon}
        title={titleFor(appError.code)}
        message={appError.message}
        action={
          handling.action === 'retry' && onRetry ? (
            <Button label={handling.actionLabel ?? 'Try again'} icon="refresh" onPress={onRetry} />
          ) : handling.action === 'redirect' && handling.redirectTo ? (
            <Button
              label={handling.actionLabel ?? 'Continue'}
              onPress={() => router.replace(handling.redirectTo as never)}
            />
          ) : undefined
        }
      />
    </View>
  );
}

function titleFor(code: ErrorCode): string {
  const titles: Partial<Record<ErrorCode, string>> = {
    NO_VEHICLE_AVAILABLE: 'No vehicle free right now',
    CONCURRENT_BOOKING: 'That vehicle was taken',
    CAPACITY_EXCEEDED: 'That vehicle filled up',
    KYC_PENDING_REVIEW: 'Verification in progress',
    PAYMENT_FAILED: "Payment didn't go through",
    PAYOUT_TRANSFER_FAILED: 'Payout pending',
    EXTERNAL_SERVICE_ERROR: 'Connection problem',
  };
  return titles[code] ?? 'Something needs your attention';
}
