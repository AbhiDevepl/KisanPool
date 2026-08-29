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
import { kg, rupees, shortDate } from '../../lib/format';
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
    (r) => r.offerCount > 0 && r.state === 'TRANSPORTER_INTERESTED',
  );

  const live = rows.filter(
    (r) => r.shipment && LIVE_SHIPMENT_STATES.includes(r.shipment.state),
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

            <Txt
              variant="labelSm"
              color={colors.onPrimaryContainer}
              style={{ marginTop: space.md }}
            >
              KisanPool shares what is already there — a truck with space in it, and a
              machine standing idle.
            </Txt>
          </Card>
        </View>

        {/* shortcuts */}
        <SectionHeader title="Quick actions" />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <QuickAction
            icon="agriculture"
            label="Hire machinery"
            onPress={() => router.push('/(farmer)/services')}
          />
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
          recent.map((r) => {
            const copy = r.shipment
              ? SHIPMENT_COPY[r.shipment.state]
              : REQUEST_COPY[r.state];
            return (
              <Card
                key={r._id}
                onPress={() =>
                  router.push(
                    r.shipment ? `/(farmer)/trips/${r.shipment.tripId}` : `/(farmer)/requests/${r._id}/offers`,
                  )
                }
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <IconBadge icon={r.shipment ? 'local-shipping' : 'assignment'} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg" numberOfLines={1}>
                      {r.cropType} · {kg(r.quantityKg)}
                    </Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1}>
                      {r.destination?.name ?? '—'} · {shortDate(r.preferredDate ?? r.createdAt)}
                    </Txt>
                  </View>
                  <StatusBadge status={copy.badge} label={copy.label} />
                </View>
              </Card>
            );
          })
        )}

        {/* big CTA pair — move produce / farm services */}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Card
            style={{ flex: 1, borderColor: colors.primary, borderWidth: 2 }}
            onPress={() => router.push('/(farmer)/requests/new')}
          >
            <IconBadge icon="local-shipping" />
            <Txt variant="labelLg" style={{ marginTop: space.sm }}>
              Move my produce
            </Txt>
            <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
              माल पाठवा
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
              Share a vehicle to the mandi — the more farmers aboard, the less each pays.
            </Txt>
          </Card>

          <Card
            style={{ flex: 1, borderColor: colors.tertiaryContainer, borderWidth: 2 }}
            onPress={() => router.push('/(farmer)/services')}
          >
            <IconBadge icon="agriculture" tone="tertiary" />
            <Txt variant="labelLg" style={{ marginTop: space.sm }}>
              Farm services
            </Txt>
            <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
              शेती यंत्रे
            </Txt>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
              Hire a tractor, harvester or rotavator from someone nearby who has one.
            </Txt>
          </Card>
        </View>

        {/* awaiting confirmation — the decision only the farmer can make */}
        {awaitingConfirmation.length > 0 && (
          <>
            <SectionHeader title="Awaiting your confirmation" />
            {awaitingConfirmation.map((a) => (
              <Card
                key={`await-${a._id}`}
                style={{ borderColor: colors.tertiaryContainer, borderWidth: 2 }}
                onPress={() => router.push(`/(farmer)/requests/${a._id}/offers`)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <MaterialIcons name="how-to-reg" size={22} color={colors.tertiary} />
                  <Txt variant="headlineMd" style={{ flex: 1 }}>
                    {a.offerCount} transporter{a.offerCount > 1 ? 's' : ''} accepted
                  </Txt>
                  <StatusBadge status="MATCHED" label="Your choice" />
                </View>
                <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                  {a.cropType} · {kg(a.quantityKg)} to {a.destination?.name}.{' '}
                  {REQUEST_COPY.TRANSPORTER_INTERESTED.detail}
                </Txt>
                <Button
                  label="Compare and confirm"
                  icon="compare-arrows"
                  onPress={() => router.push(`/(farmer)/requests/${a._id}/offers`)}
                  style={{ marginTop: space.gutter }}
                />
              </Card>
            ))}
          </>
        )}

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
          live.map((l) => {
            const copy = SHIPMENT_COPY[l.shipment!.state];
            return (
              <Card
                key={`live-${l._id}`}
                onPress={() => router.push(`/(farmer)/trips/${l.shipment!.tripId}`)}
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
                        {l.pickup?.name ?? '—'}
                      </Txt>
                      <MaterialIcons name="arrow-right-alt" size={16} color={colors.outline} />
                      <Txt variant="labelLg" numberOfLines={1} style={{ flex: 1 }}>
                        {l.destination?.name ?? '—'}
                      </Txt>
                    </View>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {l.cropType} · {kg(l.quantityKg)} · {shortDate(l.preferredDate)}
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
                      {rupees(l.shipment!.finalPrice ?? l.shipment!.allocatedPrice)}
                    </Txt>
                  </View>
                  <Button
                    label="Track trip"
                    variant="secondary"
                    icon="location-on"
                    onPress={() => router.push(`/(farmer)/trips/${l.shipment!.tripId}`)}
                  />
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
