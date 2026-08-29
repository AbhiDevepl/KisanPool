/** f0.1_welcome_language — language picker, sets the default Servo AI language. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Language } from '@kisanpool/shared';
import { getLanguage, setLanguage as applyLanguage, useT } from '../../lib/i18n';
import { Button, Card, Screen, Txt } from '../../components/ui';
import { colors, radius, space } from '../../theme';

const LANGUAGES: Array<{ code: Language; native: string; english: string }> = [
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi' },
  { code: 'en', native: 'English', english: 'English' },
];

export default function Welcome() {
  const router = useRouter();
  const { t, lang } = useT();
  // highlight whatever language is actually active (re-syncs when it changes)
  const [language, setLanguage] = useState<Language>(getLanguage());

  useEffect(() => {
    setLanguage(lang);
  }, [lang]);

  const chooseLanguage = (code: Language): void => {
    setLanguage(code);
    void applyLanguage(code); // switch the whole app right away
  };

  return (
    <Screen
      footer={
        <Button
          label={t('common.continue')}
          onPress={() => router.push({ pathname: '/(auth)/role', params: { language } })}
        />
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.xl,
            backgroundColor: colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialIcons name="energy-savings-leaf" size={40} color={colors.onPrimary} />
        </View>
        <Txt variant="displayLg" style={{ marginTop: space.md }}>
          KisanPool
        </Txt>
        <Txt variant="bodyLg" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
          {t('common.tagline')}
        </Txt>
      </View>

      <Txt variant="headlineMd" style={{ marginBottom: space.sm }}>
        {t('welcome.chooseLanguageNative')}
      </Txt>
      <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
        {t('welcome.chooseLanguage')}
      </Txt>

      {LANGUAGES.map((item) => {
        const selected = language === item.code;
        return (
          <Card
            key={item.code}
            onPress={() => chooseLanguage(item.code)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View>
              <Txt variant="headlineMd">{item.native}</Txt>
              <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
                {item.english}
              </Txt>
            </View>
            <MaterialIcons
              name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
              size={24}
              color={selected ? colors.primary : colors.outline}
            />
          </Card>
        );
      })}
    </Screen>
  );
}
