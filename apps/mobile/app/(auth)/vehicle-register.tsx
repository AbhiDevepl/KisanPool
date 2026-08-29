/**
 * onboarding_registration — who the driver is, then the vehicle. Starts PENDING.
 *
 * The name is collected HERE because there is no other transporter onboarding
 * step that asks for it. Farmers get /(auth)/farmer-details; drivers went
 * straight from the OTP screen to this one, so `User.name` was never written and
 * every screen that shows a driver — their own profile, the farmer's comparison
 * list, the trip roster — fell back to the phone number.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { VEHICLE_TYPES, type VehicleType } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { toAppError } from '../../lib/errors';
import { Button, Chip, Field, Header, Screen, Txt } from '../../components/ui';
import { colors, space } from '../../theme';

const LABELS: Record<VehicleType, string> = {
  PICKUP: 'Pickup',
  TRUCK: 'Truck',
  TEMPO: 'Tempo',
  TRACTOR: 'Tractor',
  MINI_TRUCK: 'Mini truck',
  OTHER: 'Other',
};

export default function VehicleRegister() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MINI_TRUCK');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [capacityKg, setCapacityKg] = useState('');
  const [ratePerKm, setRatePerKm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      let currentLocation: { lat: number; lng: number } | undefined;
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === 'granted') {
          const position = await Location.getCurrentPositionAsync({});
          currentLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        }
      } catch {
        // matching falls back to a wide radius without a location
      }

      // identity first: a vehicle with no driver behind it is what the profile,
      // the offer list and the trip roster were all rendering before
      await api.updateMe({
        name: name.trim(),
        ...(currentLocation ? { defaultLocation: { name: 'My base', ...currentLocation } } : {}),
      });

      await api.registerVehicle({
        vehicleType,
        registrationNumber: registrationNumber.toUpperCase(),
        capacityKg: Number(capacityKg),
        ratePerKm: Number(ratePerKm),
        currentLocation,
      });
      router.replace('/(auth)/kyc');
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const valid =
    name.trim().length >= 2 &&
    registrationNumber.trim().length >= 4 &&
    Number(capacityKg) > 0 &&
    Number(ratePerKm) > 0;

  return (
    <Screen
      footer={
        <Button
          label="Continue to documents"
          loading={busy}
          disabled={!valid}
          onPress={() => void save()}
        />
      }
    >
      <Header title="You and your vehicle" subtitle="तुम्ही आणि तुमचे वाहन" />

      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="e.g. Mahesh Jadhav"
      />
      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
        Farmers see this name when they choose who carries their produce.
      </Txt>

      <Txt variant="labelLg" color={colors.onSurfaceVariant} style={{ marginBottom: space.sm }}>
        Vehicle type
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
        {VEHICLE_TYPES.map((item) => (
          <Chip
            key={item}
            label={LABELS[item]}
            selected={vehicleType === item}
            onPress={() => setVehicleType(item)}
          />
        ))}
      </View>

      <Field
        label="Registration number"
        value={registrationNumber}
        onChangeText={setRegistrationNumber}
        autoCapitalize="characters"
        placeholder="MH12 AB 1234"
      />
      <Field
        label="Capacity (kg)"
        value={capacityKg}
        onChangeText={(text) => setCapacityKg(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="e.g. 2500"
      />
      <Field
        label="Rate per km (₹)"
        value={ratePerKm}
        onChangeText={(text) => setRatePerKm(text.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="e.g. 36"
        error={error}
      />

      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
        Your vehicle stays "Pending verification" until your documents are approved. You will not
        receive trip requests before that.
      </Txt>
    </Screen>
  );
}
