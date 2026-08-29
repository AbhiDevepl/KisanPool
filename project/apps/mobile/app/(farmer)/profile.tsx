/**
 * Farmer · Profile — identity and preferences.
 *
 * Deliberately NOT a dashboard: no trip counts, no earnings, no operational
 * metrics. Those live in Bookings. This screen is who you are, how the app should
 * talk to you, and the way out.
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Language, UserDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { clearSession, getUser, setUser as persistUser } from '../../lib/session';
import { getFavourites } from '../../lib/favourites';
import { findMandi } from '../../lib/mandis';
import { toAppError } from '../../lib/errors';
import { SUPPORT_PHONE } from '../../lib/support';
import {
  AppBar,
  Avatar,
  Card,
  ConfirmDialog,
  Divider,
  Screen,
  SettingRow,
  Sheet,
  Skeleton,
  Toast,
  Txt,
} from '../../components/ui';
import { BottomNav } from '../../components/BottomNav';
import { colors, space } from '../../theme';

const LANGUAGES: Array<{ code: Language; native: string; english: string }> = [
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi' },
  { code: 'en', native: 'English', english: 'English' },
];

export default function FarmerProfile() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    setUserState(await getUser());
    setFavourites(await getFavourites());
    // the cached user can lag behind the server; refresh it quietly
    try {
      const fresh = await api.me();
      await persistUser(fresh);
      setUserState(fresh);
    } catch {
      // offline is fine here — the cached profile is still correct enough to show
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeLanguage = async (language: Language): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.updateMe({ language });
      await persistUser(updated);
      setUserState(updated);
      setLanguageOpen(false);
      setToastTone('success');
      setToast('Language updated');
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async (): Promise<void> => {
    await clearSession();
    router.replace('/(auth)/welcome');
  };

  const languageLabel =
    LANGUAGES.find((item) => item.code === user?.language)?.native ?? 'English';

  return (
    <View style={{ flex: 1 }}>
      <Screen withNav header={<AppBar title="Profile" />}>
        <Card style={{ alignItems: 'center', paddingVertical: space.lg }}>
          <Avatar name={user?.name} size={80} />
          {user ? (
            <>
              <Txt variant="headlineLg" style={{ marginTop: space.gutter }}>
                {user.name}
              </Txt>
              <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
                {user.phone}
              </Txt>
              <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                Farmer · KP-{user._id.slice(-6).toUpperCase()}
              </Txt>
            </>
          ) : (
            <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.gutter }}>
              <Skeleton height={22} width={160} />
              <Skeleton height={14} width={110} />
            </View>
          )}
        </Card>

        <Card>
          <Txt variant="labelLg" color={colors.onSurfaceVariant}>
            Account
          </Txt>
          <Divider />
          <SettingRow
            icon="place"
            label="Pickup location"
            value={user?.defaultLocation?.name ?? 'Not set'}
          />
          <SettingRow
            icon="translate"
            label="Language"
            value={languageLabel}
            onPress={() => setLanguageOpen(true)}
          />
          <SettingRow
            icon="star"
            label="Favourite mandis"
            value={
              favourites.length
                ? favourites
                    .map((id) => findMandi(id)?.name)
                    .filter(Boolean)
                    .slice(0, 1)
                    .join('') + (favourites.length > 1 ? ` +${favourites.length - 1}` : '')
                : 'None yet'
            }
            onPress={() => router.push('/(farmer)/mandis?filter=favourites')}
          />
          <SettingRow
            icon="receipt-long"
            label="Payments & receipts"
            onPress={() => router.push('/(farmer)/payments')}
          />
        </Card>

        <Card>
          <Txt variant="labelLg" color={colors.onSurfaceVariant}>
            Notifications
          </Txt>
          <Divider />
          <SettingRow
            icon="notifications-active"
            label="Trip & offer alerts"
            value="On"
          />
          <Txt variant="labelSm" color={colors.outline}>
            You are told when a transporter accepts your request, when your driver sets off, and
            when your share changes.
          </Txt>
        </Card>

        <Card>
          <Txt variant="labelLg" color={colors.onSurfaceVariant}>
            Help
          </Txt>
          <Divider />
          <SettingRow
            icon="support-agent"
            label="Support & AI assistant"
            onPress={() => router.push('/(farmer)/support')}
          />
          <SettingRow
            icon="call"
            label="Call KisanPool"
            value={SUPPORT_PHONE}
            onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
          />
          <SettingRow icon="policy" label="Privacy & terms" onPress={() => setToast('Coming soon')} />
        </Card>

        <Card>
          <SettingRow
            icon="logout"
            label="Sign out"
            tone="danger"
            onPress={() => setSignOutOpen(true)}
          />
        </Card>

        <Txt
          variant="labelSm"
          color={colors.outline}
          style={{ textAlign: 'center', marginTop: space.sm }}
        >
          KisanPool · v0.1.0
        </Txt>
      </Screen>

      <Sheet
        visible={languageOpen}
        onClose={() => setLanguageOpen(false)}
        title="Choose your language"
        subtitle="Servo AI will speak and listen in this language too."
      >
        {LANGUAGES.map((item) => (
          <SettingRow
            key={item.code}
            icon={item.code === user?.language ? 'radio-button-checked' : 'radio-button-unchecked'}
            label={`${item.native} · ${item.english}`}
            onPress={saving ? undefined : () => void changeLanguage(item.code)}
          />
        ))}
      </Sheet>

      <ConfirmDialog
        visible={signOutOpen}
        title="Sign out of KisanPool?"
        message="You will need your mobile number and an OTP to sign back in."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => void signOut()}
      />

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav role="farmer" active="profile" />
    </View>
  );
}
