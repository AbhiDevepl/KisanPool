import { Stack } from 'expo-router';
import { colors } from '../../theme';

/**
 * f0_onboarding_auth — the shared stepper container for every onboarding screen,
 * farmer and transporter alike, including the KYC step (docs/DESIGN.md §7).
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
