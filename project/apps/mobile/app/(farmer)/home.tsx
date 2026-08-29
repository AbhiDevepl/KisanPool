/**
 * F1 · Farmer Home — the entry screen, not a dashboard.
 *
 * Home answers one question: "what should I do next?" Everything that is a
 * product area of its own — the full booking list, mandi discovery, support, the
 * profile — lives behind the bottom navigation. Home only carries the greeting,
 * the primary action, whatever is live right now, and shortcuts.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { RequestState, UserDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { getUser } from '../../lib/session';
import { getFavourites } from '../../lib/favourites';
import { useLoader } from '../../lib/useLoader';
import { REQUEST_COPY, SHIPMENT_COPY, LIVE_SHIPMENT_STATES } from '../../lib/pooling';
import { kg, rupees, shortDate, timeAgo } from '../../lib/format';
import {
  AppBar,
  Button,
  Card,
  ContextStrip,
  EmptyState,
  IconBadge,
  QuickAction,
  Screen,
  SectionHeader,
  SkeletonList,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { BottomNav } from '../../components/BottomNav';
import { VoiceAssistantButton } from '../../components/VoiceAssistantButton';
import { colors, space } from '../../theme';

type MyRequest = Awaited<ReturnType<typeof api.myRequests>>[number] & { state: RequestState };

const LANGUAGE_LABEL: Record<string, string> = { mr: 'मराठी', hi: 'हिंदी', en: 'English' };

export default function FarmerHome() {
  const router = useRouter();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);

  const requests = useLoader<MyRequest[]>(
    useCallback(async () => (await api.myRequests()) as MyRequest[], []),
  );

  useEffect(() => {
    void getUser().then(setUser);
    void getFavourites().then(setFavourites);
  }, []);

  const rows = requests.data ?? [];

  // the pivotal state: transporters have accepted, but NOTHING is booked until
  // the farmer picks one. This is the most urgent thing Home can show.
  const awaitingConfirmation = rows.filter(
    (row) => row.offerCount > 0 && row.state === 'TRANSPORTER_INTERESTED',
  );
  const live = rows.filter(
    (row) => row.shipment && LIVE_SHIPMENT_STATES.includes(row.shipment.state),
  );
  const recent = rows.slice(0, 4);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={requests.refreshing}
        onRefresh={requests.refresh}
        header={
          <>
            <AppBar
              unread={awaitingConfirmation.length}
              onNotifications={() => router.push('/(farmer)/bookings')}
            />
            <ContextStrip
              location={user?.defaultLocation?.name ?? 'Set your pickup location'}
              language={LANGUAGE_LABEL[user?.language ?? 'en'] ?? 'English'}
              onLocation={() => router.push('/(farmer)/profile')}
              onLanguage={() => router.push('/(farmer)/profile')}
            />
          </>
        }
      >
        {/* hero — greeting and the one action this app exists for */}
        <View style={{ marginTop: space.sm }}>
          <Card
            raised
            style={{
              backgroundColor: colors.primary,
              borderColor: colors.primary,
              borderRadius: 24,
              padding: space.md,
            }}
          >
            <Txt variant="displayLg" color={colors.onPrimary}>
              Hello, {firstName}! 👋
            </Txt>
            <Txt variant="bilingualSubtext" color={colors.onPrimaryContainer}>
              आजचा दिवस कसा आहे!
            </Txt>

            <View style={{ marginTop: space.md }}>
              <Txt variant="headlineMd" color={colors.onPrimary}>
                Need to transport your produce?
              </Txt>
              <Txt
                variant="labelSm"
                color={colors.onPrimaryContainer}
                style={{ marginTop: space.xs }}
              >
                Share a vehicle with nearby farmers — the more of you aboard, the less each pays.
              </Txt>
              <Button
                label="Transport produce"
                variant="secondary"
                onPress={() => router.push('/(farmer)/requests/new')}
                style={{ marginTop: space.gutter }}
              />
            </View>
          </Card>
        </View>

        {/* the decision only the farmer can make */}
        {awaitingConfirmation.map((request) => (
          <Card
            key={`await-${request._id}`}
            style={{ borderColor: colors.tertiaryContainer, borderWidth: 2 }}
            onPress={() => router.push(`/(farmer)/requests/${request._id}/offers`)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <MaterialIcons name="how-to-reg" size={22} color={colors.tertiary} />
              <Txt variant="headlineMd" style={{ flex: 1 }}>
                {request.offerCount} transporter{request.offerCount > 1 ? 's' : ''} accepted
              </Txt>
              <StatusBadge status="MATCHED" label="Your choice" />
            </View>
            <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
              {request.cropType} · {kg(request.quantityKg)} to {request.destination.name}.{' '}
              {REQUEST_COPY.TRANSPORTER_INTERESTED.detail}
            </Txt>
            <Button
              label="Compare and confirm"
              icon="compare-arrows"
              onPress={() => router.push(`/(farmer)/requests/${request._id}/offers`)}
              style={{ marginTop: space.gutter }}
            />
          </Card>
        ))}

        {/* active / upcoming trip */}
        <SectionHeader
          title="Active / upcoming trip"
          actionLabel={rows.length > 0 ? 'View all' : undefined}
          onAction={() => router.push('/(farmer)/bookings')}
        />

        {requests.loading ? (
          <SkeletonList count={1} />
        ) : requests.error ? (
          <ErrorView error={requests.error} onRetry={requests.refresh} />
        ) : live.length === 0 ? (
          <Card raised={false} style={{ alignItems: 'center', paddingVertical: space.lg }}>
            <IconBadge icon="local-shipping" tone="muted" />
            <Txt variant="labelLg" style={{ marginTop: space.sm }}>
              No trip on the road
            </Txt>
            <Txt
              variant="labelSm"
              color={colors.onSurfaceVariant}
              style={{ textAlign: 'center', marginTop: space.xs }}
            >
              When a booking is confirmed you'll be able to track it live from here.
            </Txt>
          </Card>
        ) : (
          live.map((request) => {
            const copy = SHIPMENT_COPY[request.shipment!.state];
            return (
              <Card
                key={`live-${request._id}`}
                onPress={() => router.push(`/(farmer)/trips/${request.shipment!.tripId}`)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <StatusBadge status={copy.badge} label={copy.label} />
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.xs,
                        marginTop: space.sm,
                      }}
                    >
                      <Txt variant="labelLg" numberOfLines={1} style={{ maxWidth: 110 }}>
                        {request.pickup.name}
                      </Txt>
                      <MaterialIcons name="arrow-right-alt" size={16} color={colors.outline} />
                      <Txt variant="labelLg" numberOfLines={1} style={{ flex: 1 }}>
                        {request.destination.name}
                      </Txt>
                    </View>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {request.cropType} · {kg(request.quantityKg)} ·{' '}
                      {shortDate(request.preferredDate)}
                    </Txt>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: space.gutter,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: colors.surfaceVariant,
                  }}
                >
                  <View>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      Your share
                    </Txt>
                    <Txt variant="labelLg" color={colors.primary}>
                      {rupees(request.shipment!.finalPrice ?? request.shipment!.allocatedPrice)}
                    </Txt>
                  </View>
                  <Button
                    label="Track trip"
                    variant="secondary"
                    icon="location-on"
                    onPress={() => router.push(`/(farmer)/trips/${request.shipment!.tripId}`)}
                  />
                </View>
              </Card>
            );
          })
        )}

        {/* shortcuts */}
        <SectionHeader title="Quick actions" />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <QuickAction
            icon="storefront"
            label="Nearby mandis"
            onPress={() => router.push('/(farmer)/mandis')}
          />
          <QuickAction
            icon="assignment"
            label="My bookings"
            badge={awaitingConfirmation.length}
            onPress={() => router.push('/(farmer)/bookings')}
          />
          <QuickAction
            icon="star"
            label="Favourites"
            tone="tertiary"
            badge={favourites.length || undefined}
            onPress={() => router.push('/(farmer)/mandis?filter=favourites')}
          />
          <QuickAction
            icon="support-agent"
            label="AI assistant"
            tag="AI"
            onPress={() => router.push('/(farmer)/support')}
          />
        </View>

        {/* recent activity */}
        <SectionHeader
          title="Recent activity"
          actionLabel={rows.length > recent.length ? 'View all' : undefined}
          onAction={() => router.push('/(farmer)/bookings')}
        />

        {requests.loading ? (
          <SkeletonList count={2} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon="local-shipping"
            title="No requests yet"
            message="Create your first request, or tap the mic and just say what you want to send."
            action={
              <Button
                label="Transport produce"
                onPress={() => router.push('/(farmer)/requests/new')}
              />
            }
          />
        ) : (
          recent.map((request) => {
            const copy = request.shipment
              ? SHIPMENT_COPY[request.shipment.state]
              : REQUEST_COPY[request.state];
            return (
              <Card
                key={request._id}
                onPress={() =>
                  router.push(
                    request.shipment
                      ? `/(farmer)/trips/${request.shipment.tripId}`
                      : `/(farmer)/requests/${request._id}/offers`,
                  )
                }
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.gutter }}>
                  <IconBadge icon="eco" />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg">
                      {request.cropType} · {kg(request.quantityKg)}
                    </Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1}>
                      {request.destination.name} · {timeAgo(request.createdAt)}
                    </Txt>
                  </View>
                  <StatusBadge status={copy.badge} label={copy.label} />
                </View>
              </Card>
            );
          })
        )}
      </Screen>

      <VoiceAssistantButton language={user?.language} />
      <BottomNav
        role="farmer"
        active="home"
        badges={{ bookings: awaitingConfirmation.length }}
      />
    </View>
  );
}
