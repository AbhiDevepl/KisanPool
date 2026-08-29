/** f0.5_onboarding_success — confirmation, and where push permission is requested. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { registerForPush } from '../../lib/notifications';
import { setUser } from '../../lib/session';
import { Button, Screen, Txt } from '../../components/ui';
import { colors, radius, space } from '../../theme';

export default function Success() {
  const router = useRouter();
  const { t } = useT();
  const [role, setRole] = useState<'FARMER' | 'TRANSPORTER'>('FARMER');

  useEffect(() => {
    void (async () => {
      const user = await api.me();
      await setUser(user);
      setRole(user.role);
      // permission asked here, once onboarding has earned the right to ask
      await registerForPush();
    })();
  }, []);

  return (
    <Screen
      footer={
        <Button
          label={t('success.goDashboard')}
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
          {t('success.title')}
        </Txt>
        <Txt variant="headlineMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
          {t('success.titleNative')}
        </Txt>

        <Txt
          variant="bodyLg"
          color={colors.onSurfaceVariant}
          style={{ marginTop: space.md, textAlign: 'center' }}
        >
          {role === 'FARMER' ? t('success.farmerBody') : t('success.transporterBody')}
        </Txt>
      </View>
    </Screen>
  );
}
