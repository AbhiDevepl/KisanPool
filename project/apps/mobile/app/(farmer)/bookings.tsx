/**
 * Farmer · Bookings — every request and trip, in one place.
 *
 * This screen did not exist: the booking list was a few rows at the bottom of
 * Home. It is a product area of its own, so it gets a tab.
 *
 * The filters follow the real lifecycle, and they keep the two pooling states
 * visibly apart: "Awaiting you" is where transporters have ACCEPTED but nothing
 * is booked, "Confirmed" is where the farmer has chosen and capacity is reserved.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import type { RequestState } from '@kisanpool/shared';
import { api } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { REQUEST_COPY, SHIPMENT_COPY } from '../../lib/pooling';
import { kg, rupees, shortDate } from '../../lib/format';
import {
  AppBar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FilterRow,
  IconBadge,
  Screen,
  SkeletonList,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { BottomNav } from '../../components/BottomNav';
import { colors, space } from '../../theme';

type MyRequest = Awaited<ReturnType<typeof api.myRequests>>[number] & { state: RequestState };

type Filter = 'all' | 'awaiting' | 'confirmed' | 'active' | 'completed' | 'cancelled';

const ACTIVE_SHIPMENT = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'IN_TRANSIT'];
const DONE_SHIPMENT = ['DELIVERED', 'PAYMENT_PENDING', 'PAID', 'COMPLETED'];

function bucketOf(row: MyRequest): Filter {
  if (row.state === 'CANCELLED' || row.state === 'EXPIRED') return 'cancelled';
  if (row.shipment && DONE_SHIPMENT.includes(row.shipment.state)) return 'completed';
  if (row.shipment && ACTIVE_SHIPMENT.includes(row.shipment.state)) return 'active';
  if (row.state === 'CONFIRMED') return 'confirmed';
  if (row.state === 'TRANSPORTER_INTERESTED' && row.offerCount > 0) return 'awaiting';
  return 'confirmed';
}

/** OPEN requests have no bucket above — they are still looking, so they get one. */
const isPending = (row: MyRequest): boolean => row.state === 'OPEN';

export default function Bookings() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  const requests = useLoader<MyRequest[]>(
    useCallback(async () => (await api.myRequests()) as MyRequest[], []),
  );

  const rows = useMemo(() => requests.data ?? [], [requests.data]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const row of rows) {
      const bucket = isPending(row) ? 'pending' : bucketOf(row);
      tally[bucket] = (tally[bucket] ?? 0) + 1;
    }
    return tally;
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'confirmed') {
      // "Confirmed" also holds requests still open in the pool — both are pre-trip
      return rows.filter((row) => isPending(row) || bucketOf(row) === 'confirmed');
    }
    return rows.filter((row) => !isPending(row) && bucketOf(row) === filter);
  }, [rows, filter]);

  const filters: Array<{ key: Filter; label: string; count?: number }> = [
    { key: 'all', label: 'All', count: rows.length || undefined },
    { key: 'awaiting', label: 'Awaiting you', count: counts.awaiting },
    { key: 'confirmed', label: 'Confirmed', count: (counts.confirmed ?? 0) + (counts.pending ?? 0) || undefined },
    { key: 'active', label: 'On the road', count: counts.active },
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={requests.refreshing}
        onRefresh={requests.refresh}
        header={
          <>
            <AppBar title="My bookings" />
            <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
              <FilterRow options={filters} value={filter} onChange={setFilter} />
            </View>
          </>
        }
      >
        {requests.stale ? (
          <Card raised={false} style={{ backgroundColor: colors.warningContainer, borderColor: colors.warningContainer }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <MaterialIcons name="sync-problem" size={18} color={colors.onWarningContainer} />
              <Txt variant="labelSm" color={colors.onWarningContainer} style={{ flex: 1 }}>
                Showing your last known bookings — we could not reach KisanPool just now.
              </Txt>
            </View>
          </Card>
        ) : null}

        {requests.loading ? (
          <SkeletonList count={3} />
        ) : requests.error ? (
          <ErrorView error={requests.error} onRetry={requests.refresh} />
        ) : visible.length === 0 ? (
          <EmptyForFilter filter={filter} onCreate={() => router.push('/(farmer)/requests/new')} />
        ) : (
          visible.map((row) => (
            <BookingCard
              key={row._id}
              row={row}
              router={router}
              onDeleted={requests.refresh}
            />
          ))
        )}
      </Screen>

      <BottomNav role="farmer" active="bookings" badges={{ bookings: counts.awaiting }} />
    </View>
  );
}

function BookingCard({
  row,
  router,
  onDeleted,
}: {
  row: MyRequest;
  router: ReturnType<typeof useRouter>;
  onDeleted: () => void;
}) {
  const copy = row.shipment ? SHIPMENT_COPY[row.shipment.state] : REQUEST_COPY[row.state];
  const awaiting = row.state === 'TRANSPORTER_INTERESTED' && row.offerCount > 0;
  const share = row.shipment ? (row.shipment.finalPrice ?? row.shipment.allocatedPrice) : null;
  const closed = row.state === 'CANCELLED' || row.state === 'EXPIRED';

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    try {
      await api.deleteRequest(row._id);
      setDeleteOpen(false);
      onDeleted();
    } catch {
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const open = (): void => {
    if (row.shipment) router.push(`/(farmer)/trips/${row.shipment.tripId}`);
    else router.push(`/(farmer)/requests/${row._id}/offers`);
  };

  return (
    <Card onPress={open} style={awaiting ? { borderColor: colors.tertiaryContainer, borderWidth: 2 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
        <IconBadge icon="eco" tone={awaiting ? 'tertiary' : 'primary'} />
        <View style={{ flex: 1 }}>
          <Txt variant="labelLg">
            {row.cropType} · {kg(row.quantityKg)}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}>
            <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1} style={{ maxWidth: 96 }}>
              {row.pickup.name}
            </Txt>
            <MaterialIcons name="arrow-right-alt" size={14} color={colors.outline} />
            <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1} style={{ flex: 1 }}>
              {row.destination.name}
            </Txt>
          </View>
          <Txt variant="labelSm" color={colors.outline} style={{ marginTop: 2 }}>
            {shortDate(row.preferredDate)}
          </Txt>
        </View>
        <StatusBadge status={copy.badge} label={copy.label} />
      </View>

      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.sm }}>
        {copy.detail}
      </Txt>

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
            {share != null ? 'Your share' : awaiting ? 'Offers received' : 'Status'}
          </Txt>
          <Txt variant="labelLg" color={colors.primary}>
            {share != null
              ? rupees(share)
              : awaiting
                ? `${row.offerCount} transporter${row.offerCount > 1 ? 's' : ''}`
                : copy.label}
          </Txt>
        </View>
        {closed ? (
          <Button
            label="Delete"
            variant="danger"
            icon="delete"
            loading={deleting}
            onPress={() => setDeleteOpen(true)}
          />
        ) : (
          <Button
            label={awaiting ? 'Choose transporter' : row.shipment ? 'Track' : 'View'}
            variant={awaiting ? 'primary' : 'secondary'}
            icon={awaiting ? 'check' : 'chevron-right'}
            onPress={open}
          />
        )}
      </View>

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete this request?"
        message="It will be removed from your bookings for good. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}

/** Empty means something different per filter — never one generic message. */
function EmptyForFilter({ filter, onCreate }: { filter: Filter; onCreate: () => void }) {
  const cta = <Button label="Transport produce" onPress={onCreate} />;

  switch (filter) {
    case 'awaiting':
      return (
        <EmptyState
          icon="how-to-reg"
          title="Nothing waiting on you"
          message="When transporters accept one of your requests, they will appear here for you to compare and confirm."
        />
      );
    case 'confirmed':
      return (
        <EmptyState
          icon="event-available"
          title="No confirmed bookings"
          message="Once you choose a transporter, your booking and reserved space will show here."
          action={cta}
        />
      );
    case 'active':
      return (
        <EmptyState
          icon="local-shipping"
          title="Nothing on the road"
          message="Confirmed loads appear here from the moment the driver sets off until they reach the mandi."
        />
      );
    case 'completed':
      return (
        <EmptyState
          icon="task-alt"
          title="No completed trips yet"
          message="Delivered loads and their final bills are kept here."
        />
      );
    case 'cancelled':
      return (
        <EmptyState
          icon="cancel"
          title="Nothing cancelled"
          message="Requests you withdraw, or that expire unclaimed, are listed here."
        />
      );
    default:
      return (
        <EmptyState
          icon="assignment"
          title="No bookings yet"
          message="Send your first load to the pool — nearby drivers will compete for it, and you pick who carries it."
          action={cta}
        />
      );
  }
}
