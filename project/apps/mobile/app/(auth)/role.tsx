/** f0.2_role_selection — sets User.role, which is permanent for the MVP (ADR-002). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Language, Role } from '@kisanpool/shared';
import { LANGUAGES, setLanguage as applyLanguage, useT } from '../../lib/i18n';
import { Button, Card, Header, Screen, Txt } from '../../components/ui';
import { colors, radius, space } from '../../theme';

const ROLE_CARDS: Array<{
  role: Role;
  nativeKey: string;
  englishKey: string;
  blurbKey: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}> = [
  {
    role: 'FARMER',
    nativeKey: 'role.farmerNative',
    englishKey: 'role.farmer',
    blurbKey: 'role.farmerBlurb',
    icon: 'agriculture',
  },
  {
    role: 'TRANSPORTER',
    nativeKey: 'role.transporterNative',
    englishKey: 'role.transporter',
    blurbKey: 'role.transporterBlurb',
    icon: 'local-shipping',
  },
];

export default function RoleSelection() {
  const router = useRouter();
  const { t } = useT();
  const params = useLocalSearchParams<{ language?: string }>();
  const [role, setRole] = useState<Role>('FARMER');

  // carry the language chosen on the welcome screen through the rest of onboarding
  useEffect(() => {
    if (params.language && (LANGUAGES as readonly string[]).includes(params.language)) {
      void applyLanguage(params.language as Language);
    }
  }, [params.language]);

  return (
    <Screen
      footer={
        <Button
          label={t('common.continue')}
          onPress={() =>
            router.push({
              pathname: '/(auth)/verify',
              params: { role, language: params.language ?? 'en' },
            })
          }
        />
      }
    >
      <Header title={t('role.title')} subtitle={t('role.titleNative')} onBack={() => router.back()} />

      {ROLE_CARDS.map((card) => {
        const selected = role === card.role;
        return (
          <Card
            key={card.role}
            onPress={() => setRole(card.role)}
            style={{
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.primaryContainer : colors.surfaceContainer,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons
                  name={card.icon}
                  size={26}
                  color={selected ? colors.onPrimary : colors.onSurfaceVariant}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="headlineMd">{t(card.nativeKey)}</Txt>
                <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
                  {t(card.englishKey)} — {t(card.blurbKey)}
                </Txt>
              </View>
            </View>
          </Card>
        );
      })}

      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
        {t('role.oneForNow')}
      </Txt>
    </Screen>
  );
}
