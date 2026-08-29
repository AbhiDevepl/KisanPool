/**
 * Farmer · Support — the human and the assistant, in that order.
 *
 * Servo AI is offered here as one way to get help, not as the front door to the
 * app: a farmer with a load stuck on a truck wants a phone number first. The mic
 * FAB stays available everywhere, so this screen adds the things it cannot do —
 * calling a person, and reporting a specific problem against a real trip.
 */
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { UserDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { getUser } from '../../lib/session';
import { useLoader } from '../../lib/useLoader';
import { LIVE_SHIPMENT_STATES } from '../../lib/pooling';
import { ISSUE_TOPICS, SUPPORT_PHONE } from '../../lib/support';
import { kg } from '../../lib/format';
import {
  AppBar,
  Button,
  Card,
  Divider,
  IconBadge,
  Screen,
  Sheet,
  Toast,
  Txt,
} from '../../components/ui';
import { BottomNav } from '../../components/BottomNav';
import { VoiceAssistantButton } from '../../components/VoiceAssistantButton';
import { ChatSheet } from '../../components/ChatSheet';
import { colors, radius, space } from '../../theme';

export default function Support() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [topic, setTopic] = useState<(typeof ISSUE_TOPICS)[number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const requests = useLoader(
    useCallback(async () => {
      setUserState(await getUser());
      return api.myRequests();
    }, []),
  );

  // a support request is only useful when it is attached to a real trip
  const liveRequest = (requests.data ?? []).find(
    (row) => row.shipment && LIVE_SHIPMENT_STATES.includes(row.shipment.state),
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={requests.refreshing}
        onRefresh={requests.refresh}
        header={<AppBar title="Support" />}
      >
        {/* Servo AI — a supporting feature, given its own card rather than the stage */}
        <Card style={{ borderColor: colors.primary, borderWidth: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
            <View style={s.aiIcon}>
              <MaterialIcons name="graphic-eq" size={24} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="headlineMd">Servo AI</Txt>
                <View style={s.aiTag}>
                  <Txt variant="labelSm" color={colors.onPrimary}>
                    AI
                  </Txt>
                </View>
              </View>
              <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                Ask anything in Marathi, Hindi or English — by voice.
              </Txt>
            </View>
          </View>
          <Divider />
          <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
            "मला उद्या कांदा लासलगावला पाठवायचा आहे" — say it and Servo will set up the request for
            you. It never pays or books on its own; you always confirm.
          </Txt>
          <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.sm }}>
            Tap the green microphone at the bottom right to start.
          </Txt>
        </Card>

        {/* report an issue, bound to a live trip when there is one */}
        <Txt variant="headlineMd" style={{ marginTop: space.md, marginBottom: space.sm }}>
          Report an issue
        </Txt>

        {liveRequest ? (
          <Card raised={false} style={{ backgroundColor: colors.surfaceContainerLow }}>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              About your current trip
            </Txt>
            <Txt variant="labelLg">
              {liveRequest.cropType} · {kg(liveRequest.quantityKg)} → {liveRequest.destination.name}
            </Txt>
          </Card>
        ) : (
          <Card raised={false} style={{ backgroundColor: colors.surfaceContainerLow }}>
            <Txt variant="labelSm" color={colors.onSurfaceVariant}>
              You have no trip running right now, so we will log this against your account.
            </Txt>
          </Card>
        )}

        {ISSUE_TOPICS.map((item) => (
          <Card key={item.key} onPress={() => setTopic(item)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
              <IconBadge icon={item.icon as never} tone="muted" size={40} />
              <View style={{ flex: 1 }}>
                <Txt variant="labelLg">{item.label}</Txt>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  {item.detail}
                </Txt>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
            </View>
          </Card>
        ))}

        {liveRequest ? (
          <Button
            label="Message my driver"
            variant="secondary"
            icon="chat"
            onPress={() => setChatOpen(true)}
            style={{ marginTop: space.sm }}
          />
        ) : null}

        <Button
          label="Back to home"
          variant="ghost"
          icon="home"
          onPress={() => router.replace('/(farmer)/home')}
          style={{ marginTop: space.sm }}
        />
      </Screen>

      <Sheet
        visible={topic !== null}
        onClose={() => setTopic(null)}
        title={topic?.label}
        subtitle={topic?.detail}
      >
        <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginBottom: space.md }}>
          Our team will call you back on {user?.phone ?? 'your registered number'}. For anything
          urgent, please call us directly — it is always faster.
        </Txt>
        <Button
          label={`Call ${SUPPORT_PHONE}`}
          icon="call"
          onPress={() => {
            setTopic(null);
            void Linking.openURL(`tel:${SUPPORT_PHONE.replace(/-/g, '')}`);
          }}
        />
        <Button
          label="Request a call back"
          variant="secondary"
          icon="schedule"
          onPress={() => {
            setTopic(null);
            setToast('We will call you back shortly');
          }}
          style={{ marginTop: space.sm }}
        />
      </Sheet>

      {liveRequest?.shipment ? (
        <ChatSheet
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          tripId={liveRequest.shipment.tripId}
          myUserId={user?._id ?? ''}
          socket={null}
          otherPartyName="Driver"
        />
      ) : null}

      <Toast message={toast} onHide={() => setToast(null)} />
      <VoiceAssistantButton language={user?.language} />
      <BottomNav role="farmer" active="support" />
    </View>
  );
}

const s = {
  aiIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  aiTag: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
  },
};
