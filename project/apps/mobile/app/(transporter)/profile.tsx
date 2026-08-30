/**
 * Transporter · Profile — driver, vehicle, preferences, sign out.
 *
 * The vehicle record used to sit on the dashboard as a card among nine others.
 * It belongs here: it is identity and configuration, not an operational status.
 */
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Language, UserDTO, VehicleDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { setLanguage as applyLanguage } from '../../lib/i18n';
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
  Field,
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
import { TripMap } from '../../components/TripMap';
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
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const updateLocation = async (): Promise<void> => {
    setLocating(true);
    try {
      console.log('[update-location] requesting permission…');
      const perm = await Location.requestForegroundPermissionsAsync();
      console.log('[update-location] permission:', perm.status);
      if (perm.status !== 'granted') {
        setToastTone('error');
        setToast('Location permission denied');
        return;
      }

      console.log('[update-location] getting GPS position…');
      const pos = await Location.getCurrentPositionAsync({});
      console.log('[update-location] coords:', pos.coords.latitude, pos.coords.longitude);

      const updated = await api.updateVehicleLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      console.log('[update-location] saved. vehicle.currentLocation =', updated?.currentLocation);
      setVehicle(updated);
      setToastTone('success');
      setToast('Location updated — nearby loads will match');
    } catch (err) {
      console.error('[update-location] FAILED:', err);
      setToastTone('error');
      setToast(`Update failed: ${toAppError(err).message}`);
    } finally {
      setLocating(false);
    }
  };

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

  // reload every time the tab regains focus
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Drivers who registered before the onboarding step asked for a name have an
   * empty one on record. This is the repair path — they set it themselves and it
   * is written to the user document, rather than a screen inventing a label.
   */
  const saveName = async (): Promise<void> => {
    const next = nameDraft.trim();
    if (next.length < 2) return;
    setSaving(true);
    try {
      const updated = await api.updateMe({ name: next });
      await persistUser(updated);
      setUserState(updated);
      setNameOpen(false);
      setToastTone('success');
      setToast('Name updated');
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const changeLanguage = async (language: Language): Promise<void> => {
    setSaving(true);
    try {
      // switch the UI first so it works even if the server call fails
      await applyLanguage(language);
      setLanguageOpen(false);
      const updated = await api.updateMe({ language });
      await persistUser(updated);
      setUserState(updated);
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
              {user.name?.trim() ? (
                <Txt variant="headlineLg" style={{ marginTop: space.gutter }}>
                  {user.name}
                </Txt>
              ) : (
                // no name on record — say so and offer the fix, rather than
                // silently showing the phone number where a name belongs
                <Button
                  label="Add your name"
                  variant="secondary"
                  icon="person-add"
                  onPress={() => {
                    setNameDraft('');
                    setNameOpen(true);
                  }}
                  style={{ marginTop: space.gutter }}
                />
              )}
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
              <Row
                label="Base location"
                value={
                  vehicle.currentLocation
                    ? `${vehicle.currentLocation.lat.toFixed(4)}, ${vehicle.currentLocation.lng.toFixed(4)}`
                    : 'Not set'
                }
              />
              {vehicle.currentLocation ? (
                <View style={{ marginTop: space.sm }}>
                  <TripMap
                    pickup={{
                      lat: vehicle.currentLocation.lat,
                      lng: vehicle.currentLocation.lng,
                      title: 'You',
                    }}
                    height={140}
                  />
                </View>
              ) : null}
              <Button
                label="Update my location"
                variant="secondary"
                icon="my-location"
                loading={locating}
                onPress={() => void updateLocation()}
                style={{ marginTop: space.gutter }}
              />
              <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.sm }}>
                Farmers' loads are matched to you by distance from this point. Your rate and capacity
                are what the pricing engine quotes from — to change them, contact support.
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
            icon="badge"
            label="Your name"
            value={user?.name?.trim() || 'Not set'}
            onPress={() => {
              setNameDraft(user?.name ?? '');
              setNameOpen(true);
            }}
          />
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
        visible={nameOpen}
        onClose={() => setNameOpen(false)}
        title="Your name"
        subtitle="Farmers see this when they choose who carries their produce."
      >
        <Field
          label="Full name"
          value={nameDraft}
          onChangeText={setNameDraft}
          autoCapitalize="words"
          placeholder="e.g. Mahesh Jadhav"
        />
        <Button
          label="Save"
          icon="check"
          loading={saving}
          disabled={nameDraft.trim().length < 2}
          onPress={() => void saveName()}
        />
      </Sheet>

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
