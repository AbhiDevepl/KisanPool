/**
 * Transporter · Profile — driver, vehicle, preferences, sign out.
 *
 * The vehicle record used to sit on the dashboard as a card among nine others.
 * It belongs here: it is identity and configuration, not an operational status.
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Language, UserDTO, VehicleDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { clearSession, getUser, setUser as persistUser } from '../../lib/session';
import { toAppError } from '../../lib/errors';
import { SUPPORT_PHONE } from '../../lib/support';
import { kg, rupees } from '../../lib/format';
import {
  AppBar,
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  RatingStars,
  Row,
  Screen,
  SettingRow,
  Sheet,
  Skeleton,
  StatusBadge,
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

const VEHICLE_LABEL: Record<string, string> = {
  PICKUP: 'Pickup',
  TRUCK: 'Truck',
  TEMPO: 'Tempo',
  TRACTOR: 'Tractor',
  MINI_TRUCK: 'Mini truck',
  OTHER: 'Other',
};

export default function TransporterProfile() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [vehicle, setVehicle] = useState<VehicleDTO | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    setUserState(await getUser());
    try {
      const [fresh, myVehicle] = await Promise.all([api.me(), api.myVehicle()]);
      await persistUser(fresh);
      setUserState(fresh);
      setVehicle(myVehicle);
    } catch {
      // the cached profile is good enough to render while offline
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

  const languageLabel = LANGUAGES.find((item) => item.code === user?.language)?.native ?? 'English';

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
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}
              >
                <RatingStars value={user.ratingAvg} />
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {user.ratingAvg.toFixed(1)} ({user.ratingCount} trips)
                </Txt>
              </View>
            </>
          ) : (
            <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.gutter }}>
              <Skeleton height={22} width={160} />
              <Skeleton height={14} width={110} />
            </View>
          )}
        </Card>

        {/* the vehicle — configuration, not status */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <MaterialIcons name="local-shipping" size={22} color={colors.primary} />
            <Txt variant="labelLg" style={{ flex: 1 }}>
              My vehicle
            </Txt>
            {vehicle ? <StatusBadge status={vehicle.verificationStatus} /> : null}
          </View>
          <Divider />

          {vehicle ? (
            <>
              <Row label="Registration" value={vehicle.registrationNumber ?? '—'} />
              <Row label="Type" value={VEHICLE_LABEL[vehicle.vehicleType] ?? vehicle.vehicleType} />
              <Row label="Capacity" value={kg(vehicle.capacityKg)} />
              <Row label="Rate" value={`${rupees(vehicle.ratePerKm)} / km`} />
              <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.sm }}>
                Your rate and capacity are what the pricing engine quotes farmers from. To change
                them, contact support.
              </Txt>
            </>
          ) : (
            <>
              <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
                No vehicle registered yet. You need one before loads can be offered to you.
              </Txt>
              <Button
                label="Register my vehicle"
                icon="add"
                onPress={() => router.push('/(auth)/vehicle-register')}
                style={{ marginTop: space.gutter }}
              />
            </>
          )}
        </Card>

        <Card>
          <Txt variant="labelLg" color={colors.onSurfaceVariant}>
            Documents & payouts
          </Txt>
          <Divider />
          <SettingRow
            icon="badge"
            label="KYC documents"
            value={vehicle?.verificationStatus === 'VERIFIED' ? 'Verified' : 'Pending'}
            onPress={() => router.push('/(auth)/kyc')}
          />
          <SettingRow
            icon="account-balance"
            label="Payout account"
            onPress={() => router.push('/(auth)/kyc')}
          />
          <SettingRow
            icon="payments"
            label="Earnings & settlements"
            onPress={() => router.push('/(transporter)/earnings')}
          />
        </Card>

        <Card>
          <Txt variant="labelLg" color={colors.onSurfaceVariant}>
            Settings
          </Txt>
          <Divider />
          <SettingRow
            icon="translate"
            label="Language"
            value={languageLabel}
            onPress={() => setLanguageOpen(true)}
          />
          <SettingRow icon="notifications-active" label="Load alerts" value="On" />
          <SettingRow
            icon="support-agent"
            label="Call support"
            value={SUPPORT_PHONE}
            onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE.replace(/-/g, '')}`)}
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
        message="Any trip in progress keeps running. You will need an OTP to sign back in."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => void signOut()}
      />

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav role="transporter" active="profile" />
    </View>
  );
}
