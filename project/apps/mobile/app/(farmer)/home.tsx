/** f1_farmer_home — dashboard, New Request CTA, the pool's claims, Servo AI mic. */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { RequestState, UserDTO } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { getUser } from '../../lib/session';
import { kg, rupees, shortDate } from '../../lib/format';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  Screen,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { VoiceAssistantButton } from '../../components/VoiceAssistantButton';
import { colors, radius, space } from '../../theme';

/**
 * The shared TransportRequestDTO still declares the pre-pool `status` field, while
 * the backend now sends the request's own `state` (packages/shared/src/pooling.ts).
 * Until that DTO catches up, this screen widens the row locally.
 */
type PooledRequest = Awaited<ReturnType<typeof api.myRequests>>[number] & { state: RequestState };

const STATE_LABEL: Record<RequestState, string> = {
  OPEN: 'In the pool',
  TRANSPORTER_INTERESTED: 'Transporters interested',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/** StatusBadge's tone keys predate the pool states; map onto the tone that means the same. */
const STATE_TONE: Record<RequestState, string> = {
  OPEN: 'SEARCHING',
  TRANSPORTER_INTERESTED: 'MATCHED',
  CONFIRMED: 'BOOKED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'REJECTED',
};

/** A load still worth tracking on the map. */
const LIVE_SHIPMENT_STATES = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'PAYMENT_PENDING'];

export default function FarmerHome() {
  const router = useRouter();
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [requests, setRequests] = useState<PooledRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setUserState(await getUser());
      setRequests((await api.myRequests()) as PooledRequest[]);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // a claim the farmer has not answered yet is the most urgent thing on this screen
  const awaitingChoice = requests.filter((r) => r.offerCount > 0 && r.state !== 'CONFIRMED');
  const riding = requests.filter((r) => r.shipment && LIVE_SHIPMENT_STATES.includes(r.shipment.state));

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <View style={{ paddingTop: space.md }}>
          <Txt variant="displayLg">Hello, {user?.name?.split(' ')[0] ?? 'there'}! 👋</Txt>
          <Txt variant="bodyLg" color={colors.onSurfaceVariant}>
            {user?.defaultLocation?.name ?? 'Set your pickup location'}
          </Txt>
        </View>

        <Banner style={{ marginTop: space.lg }}>
          <Txt variant="headlineMd" color={colors.onPrimary}>
            Need to transport your produce?
          </Txt>
          <Txt variant="bodyMd" color={colors.onPrimaryContainer} style={{ marginTop: space.xs }}>
            Share a vehicle with nearby farmers — the more of you aboard, the less each pays.
          </Txt>
          <Button
            label="Transport produce"
            variant="secondary"
            onPress={() => router.push('/(farmer)/requests/new')}
            style={{ marginTop: space.md }}
          />
        </Banner>

        <View style={{ flexDirection: 'row', gap: space.gutter, marginBottom: space.md }}>
          <Card style={{ flex: 1, marginBottom: 0 }} onPress={() => router.push('/(farmer)/mandis')}>
            <MaterialIcons name="storefront" size={24} color={colors.primary} />
            <Txt variant="labelLg" style={{ marginTop: space.sm }}>
              Nearby mandis
            </Txt>
          </Card>
          <Card
            style={{ flex: 1, marginBottom: 0 }}
            onPress={() => router.push('/(farmer)/payments')}
          >
            <MaterialIcons name="receipt-long" size={24} color={colors.primary} />
            <Txt variant="labelLg" style={{ marginTop: space.sm }}>
              Payments
            </Txt>
          </Card>
        </View>

        {awaitingChoice.map((request) => (
          <Card
            key={`offers-${request._id}`}
            style={{ borderColor: colors.primary, borderWidth: 2 }}
            onPress={() => router.push(`/(farmer)/requests/${request._id}/offers`)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <MaterialIcons name="local-shipping" size={22} color={colors.primary} />
              <Txt variant="headlineMd" style={{ flex: 1 }}>
                {request.offerCount} transporter{request.offerCount > 1 ? 's' : ''} interested
              </Txt>
            </View>
            <Txt variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
              {request.cropType} · {kg(request.quantityKg)} to {request.destination.name}. Compare
              their prices and pick one — it costs nothing.
            </Txt>
            <Button
              label="Compare and choose"
              onPress={() => router.push(`/(farmer)/requests/${request._id}/offers`)}
              style={{ marginTop: space.gutter }}
            />
          </Card>
        ))}

        {riding.length > 0 ? (
          <>
            <Txt variant="headlineMd" style={{ marginBottom: space.sm }}>
              On the road
            </Txt>
            {riding.map((request) => (
              <Card
                key={`trip-${request._id}`}
                onPress={() => router.push(`/(farmer)/trips/${request.shipment?.tripId}`)}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Txt variant="labelLg">{request.cropType}</Txt>
                  <StatusBadge status={STATE_TONE[request.state]} label={STATE_LABEL[request.state]} />
                </View>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}
                >
                  <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
                    {request.pickup.name}
                  </Txt>
                  <MaterialIcons name="arrow-right-alt" size={18} color={colors.onSurfaceVariant} />
                  <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
                    {request.destination.name}
                  </Txt>
                </View>
                {request.shipment ? (
                  <Txt variant="labelSm" color={colors.primary} style={{ marginTop: space.xs }}>
                    Your share {rupees(request.shipment.finalPrice ?? request.shipment.allocatedPrice)} ·
                    alone it would be {rupees(request.shipment.soloPrice)}
                  </Txt>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}

        <Txt variant="headlineMd" style={{ marginTop: space.md, marginBottom: space.sm }}>
          Recent requests
        </Txt>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorView error={error} onRetry={() => void load()} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon="local-shipping"
            title="No requests yet"
            message="Create your first request, or tap the mic and just say what you want to send."
          />
        ) : (
          requests.slice(0, 8).map((request) => (
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
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceContainer,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialIcons name="eco" size={24} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="labelLg">
                    {request.cropType} · {kg(request.quantityKg)}
                  </Txt>
                  <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                    {shortDate(request.preferredDate)} · {request.destination.name}
                  </Txt>
                </View>
                <StatusBadge status={STATE_TONE[request.state]} label={STATE_LABEL[request.state]} />
              </View>
            </Card>
          ))
        )}
      </Screen>

      <VoiceAssistantButton language={user?.language} />
    </View>
  );
}
