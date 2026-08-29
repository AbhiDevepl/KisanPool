/** f0.3_mobile_verification — phone + 6-digit OTP. */
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Language, Role } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { saveSession } from '../../lib/session';
import { Button, Field, Header, Screen, Txt } from '../../components/ui';
import { colors, space } from '../../theme';

export default function Verify() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: Role; language?: Language }>();
  const role = (params.role ?? 'FARMER') as Role;
  const language = (params.language ?? 'en') as Language;

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const [resendDisabled, setResendDisabled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendOtp = async (): Promise<void> => {
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.requestOtp(phone, role);
      setSent(true);
      // demo mode returns the code so the flow is testable without an SMS provider
      if (result.devCode) setHint(`Demo code: ${result.devCode}`);
    } catch (err) {
      const appError = toAppError(err);
      setError(appError.message);

      // AUTH_RATE_LIMITED -> disable resend, don't just show a message
      if (appError.code === 'AUTH_RATE_LIMITED') {
        setResendDisabled(true);
        timer.current = setTimeout(() => setResendDisabled(false), 60_000);
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setError(undefined);
    setBusy(true);
    try {
      const { accessToken, refreshToken, user } = await api.verifyOtp(phone, code);
      await saveSession(accessToken, refreshToken, user);
      await api.updateMe({ language });

      router.replace(
        role === 'FARMER' ? '/(auth)/farmer-details' : '/(auth)/vehicle-register',
      );
    } catch (err) {
      // AUTH_OTP_INVALID -> inline under the field, clear the input, stay here
      setError(toAppError(err).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        sent ? (
          <Button
            label="Verify & continue"
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => void verify()}
          />
        ) : (
          <Button
            label="Send OTP"
            loading={busy}
            disabled={phone.length !== 10}
            onPress={() => void sendOtp()}
          />
        )
      }
    >
      <Header
        title="Verify your number"
        subtitle="मोबाईल नंबर तपासा"
        onBack={() => router.back()}
      />
      <Field
        label="Mobile number"
        value={phone}
        onChangeText={(text) => setPhone(text.replace(/\D/g, '').slice(0, 10))}
        keyboardType="number-pad"
        placeholder="10-digit mobile number"
        editable={!sent}
        error={!sent ? error : undefined}
      />

      {sent ? (
        <>
          <Field
            label="6-digit code"
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="______"
            error={error}
          />

          {hint ? (
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              {hint}
            </Txt>
          ) : null}

          <View style={{ marginTop: space.sm }}>
            <Button
              label={resendDisabled ? 'Resend available shortly' : 'Resend code'}
              variant="ghost"
              icon={null}
              disabled={resendDisabled || busy}
              onPress={() => void sendOtp()}
            />
          </View>
        </>
      ) : (
        <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
          We will send you a 6-digit code. No password needed.
        </Txt>
      )}
    </Screen>
  );
}
