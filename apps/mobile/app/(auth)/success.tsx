/** f0.5_onboarding_success — confirmation, and where push permission is requested. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { registerForPush } from '../../lib/notifications';
import { setUser } from '../../lib/session';
import { Button, Screen, Txt } from '../../components/ui';
import { colors, radius, space } from '../../theme';

export default function Success() {
  const router = useRouter();
  const [role, setRole] = useState<'FARMER' | 'TRANSPORTER'>('FARMER');
  const [isProvider, setIsProvider] = useState(false);

  useEffect(() => {
    void (async () => {
      const user = await api.me();
      await setUser(user);
      setRole(user.role);
      // a machinery/service provider signs up as FARMER but owns a machine
      void api.myMachines().then((m) => setIsProvider(m.length > 0)).catch(() => {});
      // permission asked here, once onboarding has earned the right to ask
      await registerForPush();
    })();
  }, []);

  return (
    <Screen
      footer={
        <Button
          label="Go to my dashboard"
          onPress={() =>
            router.replace(role === 'FARMER' ? '/(farmer)/home' : '/(transporter)/home')
          }
        />
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: space.xl * 2 }}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: radius.full,
            backgroundColor: colors.secondaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialIcons name="check-circle" size={56} color={colors.primary} />
        </View>

        <Txt variant="displayLg" style={{ marginTop: space.lg, textAlign: 'center' }}>
          You're all set!
        </Txt>
        <Txt variant="headlineMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
          तुमचं खातं तयार आहे
        </Txt>

        <Txt
          variant="bodyLg"
          color={colors.onSurfaceVariant}
          style={{ marginTop: space.md, textAlign: 'center' }}
        >
          {isProvider
            ? 'Your machine is listed. Farmers nearby can now find and book it — requests appear under Farm Services.'
            : role === 'FARMER'
              ? 'Create your first transport request — by tapping, or just by speaking to Servo AI.'
              : 'Once your documents are verified you will start receiving trip requests near you.'}
        </Txt>
      </View>
    </Screen>
  );
}
