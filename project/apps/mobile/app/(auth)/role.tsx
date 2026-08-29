/** f0.2_role_selection — sets User.role, which is permanent for the MVP (ADR-002). */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { Role } from '@kisanpool/shared';
import { Button, Card, Header, Screen, Txt } from '../../components/ui';
import { colors, radius, space } from '../../theme';

/** The provider path signs up as a FARMER (ADR-038: a provider is anyone who
 *  owns a machine, not a new role) but goes to machine listing, not produce. */
type Choice = 'FARMER' | 'TRANSPORTER' | 'PROVIDER';

const ROLE_CARDS: Array<{
  choice: Choice;
  role: Role;
  native: string;
  english: string;
  blurb: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}> = [
  {
    choice: 'FARMER',
    role: 'FARMER',
    native: 'शेतकरी',
    english: 'Farmer',
    blurb: 'I want to send my produce to a mandi',
    icon: 'agriculture',
  },
  {
    choice: 'TRANSPORTER',
    role: 'TRANSPORTER',
    native: 'वाहतूकदार',
    english: 'Transporter',
    blurb: 'I have a vehicle with space to share',
    icon: 'local-shipping',
  },
  {
    choice: 'PROVIDER',
    role: 'FARMER',
    native: 'यंत्रसेवा',
    english: 'Machinery / service provider',
    blurb: 'I have a tractor, harvester or other machine to hire out',
    icon: 'handyman',
  },
];

export default function RoleSelection() {
  const router = useRouter();
  const params = useLocalSearchParams<{ language?: string }>();
  const [choice, setChoice] = useState<Choice>('FARMER');
  const picked = ROLE_CARDS.find((c) => c.choice === choice) ?? ROLE_CARDS[0];

  return (
    <Screen
      footer={
        <Button
          label="Continue"
          onPress={() =>
            router.push({
              pathname: '/(auth)/verify',
              params: {
                role: picked.role,
                language: params.language ?? 'en',
                ...(choice === 'PROVIDER' ? { provider: '1' } : {}),
              },
            })
          }
        />
      }
    >
      <Header title="Who are you?" subtitle="तुम्ही कोण आहात?" onBack={() => router.back()} />

      {ROLE_CARDS.map((card) => {
        const selected = choice === card.choice;
        return (
          <Card
            key={card.choice}
            onPress={() => setChoice(card.choice)}
            style={{
              borderColor: selected ? colors.primary : colors.outlineVariant,
              borderWidth: selected ? 2 : 1,
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
                <Txt variant="headlineMd">{card.native}</Txt>
                <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
                  {card.english} — {card.blurb}
                </Txt>
              </View>
            </View>
          </Card>
        );
      })}

      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
        You can only pick one for now. If you both farm and drive, create a second account later.
      </Txt>
    </Screen>
  );
}
