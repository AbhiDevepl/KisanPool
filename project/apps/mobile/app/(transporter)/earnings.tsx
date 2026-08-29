/**
 * Transporter · Earnings — today, in total, and where every rupee came from.
 *
 * Replaces the old payouts passbook, which was a total and a flat list buried
 * behind a card on the dashboard. Earnings is a product area: it has to answer
 * "what did I make today", "what is still coming", and "which trip paid what".
 *
 * Every figure is derived from the payouts endpoint. Nothing is invented here.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { isToday, kg, rupees, shortDate } from '../../lib/format';
import {
  AppBar,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  FilterRow,
  Metric,
  Row,
  Screen,
  SectionHeader,
  SkeletonList,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { BottomNav } from '../../components/BottomNav';
import { colors, radius, space } from '../../theme';

type Payout = Awaited<ReturnType<typeof api.payouts>>['payouts'][number];
type Tab = 'all' | 'settled' | 'pending';

/**
 * The payout's own state, straight from the backend (ADR-043).
 *
 * This used to be inferred from the presence of a `transferId` plus a raw status
 * string, which could not tell "waiting on your onboarding" apart from "Razorpay
 * refused it" — two things a driver needs to respond to very differently. The
 * server now decides the state; this only names it.
 */
function transferState(payout: Payout): { badge: string; label: string; settled: boolean } {
  switch (payout.payoutState) {
    case 'PROCESSED':
      return { badge: 'DELIVERED', label: 'Settled', settled: true };
    case 'FAILED':
      return { badge: 'REJECTED', label: 'Failed', settled: false };
    case 'REVERSED':
      return { badge: 'CANCELLED', label: 'Reversed', settled: false };
    case 'CREATED':
      return { badge: 'IN_TRANSIT', label: 'Processing', settled: false };
    case 'NOT_APPLICABLE':
      return { badge: 'CANCELLED', label: 'Not payable', settled: false };
    default:
      return { badge: 'PENDING', label: 'Pending', settled: false };
  }
}

export default function Earnings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');

  const data = useLoader(useCallback(() => api.payouts(), []));

  const payouts = useMemo(() => data.data?.payouts ?? [], [data.data]);
  const total = data.data?.total ?? 0;
  const accountStatus = data.data?.account?.payoutStatus ?? 'NOT_ONBOARDED';

  const todayTotal = payouts
    .filter((payout) => isToday(payout.createdAt))
    .reduce((sum, payout) => sum + payout.amount, 0);

  const pendingTotal = payouts
    .filter((payout) => !transferState(payout).settled)
    .reduce((sum, payout) => sum + payout.amount, 0);

  const tripsPaid = new Set(payouts.map((payout) => payout.tripId)).size;

  const visible =
    tab === 'all'
      ? payouts
      : payouts.filter((payout) => transferState(payout).settled === (tab === 'settled'));

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'all', label: 'All', count: payouts.length || undefined },
    {
      key: 'settled',
      label: 'Settled',
      count: payouts.filter((p) => transferState(p).settled).length || undefined,
    },
    {
      key: 'pending',
      label: 'Pending',
      count: payouts.filter((p) => !transferState(p).settled).length || undefined,
    },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Screen
        withNav
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        header={<AppBar title="Earnings" />}
      >
        {data.loading ? (
          <SkeletonList count={3} />
        ) : data.error ? (
          <ErrorView error={data.error} onRetry={data.refresh} />
        ) : (
          <>
            {/* today leads — it is the number a driver checks between trips */}
            <Card
              style={{
                backgroundColor: colors.primaryContainer,
                borderColor: colors.primaryContainer,
                borderRadius: radius.xl,
              }}
            >
              <Txt variant="bodyMd" color={colors.onPrimaryContainer}>
                Today's earnings
              </Txt>
              <Txt variant="displayLg" color={colors.onPrimary}>
                {rupees(todayTotal)}
              </Txt>

              <Divider />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Metric label="Paid out so far" value={rupees(total)} tone="onPrimary" />
                <Metric label="Trips paid" value={String(tripsPaid)} tone="onPrimary" />
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: space.gutter }}>
              <Card style={{ flex: 1 }}>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  Awaiting settlement
                </Txt>
                <Txt variant="headlineLg" color={colors.tertiary}>
                  {rupees(pendingTotal)}
                </Txt>
              </Card>
              <Card style={{ flex: 1 }}>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  Loads carried
                </Txt>
                <Txt variant="headlineLg">{payouts.length}</Txt>
              </Card>
            </View>

            {accountStatus !== 'ACTIVE' ? (
              <Banner tone="warning">
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <MaterialIcons name="account-balance" size={22} color={colors.onWarningContainer} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg" color={colors.onWarningContainer}>
                      Payout account not set up
                    </Txt>
                    <Txt variant="bodyMd" color={colors.onWarningContainer}>
                      Add your PAN and bank details so your earnings can be transferred
                      automatically after each delivery.
                    </Txt>
                    <Button
                      label="Add bank details"
                      variant="secondary"
                      icon="account-balance"
                      onPress={() => router.push('/(auth)/kyc')}
                      style={{ marginTop: space.gutter }}
                    />
                  </View>
                </View>
              </Banner>
            ) : null}

            <SectionHeader title="Settlement history" />
            <FilterRow options={tabs} value={tab} onChange={setTab} style={{ marginBottom: space.sm }} />

            {payouts.length === 0 ? (
              <EmptyState
                icon="payments"
                title="No earnings yet"
                message="Your share is transferred automatically once a farmer's produce is delivered and paid for. Complete a trip and it will appear here."
                action={
                  <Button
                    label="Find loads"
                    icon="local-shipping"
                    onPress={() => router.push('/(transporter)/requests')}
                  />
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon="filter-list-off"
                title={tab === 'settled' ? 'Nothing settled yet' : 'Nothing pending'}
                message={
                  tab === 'settled'
                    ? 'Transfers usually land within minutes of a delivery being paid for.'
                    : 'Every payout so far has been settled to your account.'
                }
              />
            ) : (
              visible.map((payout) => {
                const state = transferState(payout);
                return (
                  <Card key={payout.paymentId}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="labelLg" numberOfLines={1}>
                          {payout.cropType ?? 'Load'}
                          {payout.quantityKg ? ` · ${kg(payout.quantityKg)}` : ''}
                        </Txt>
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}
                        >
                          <Txt
                            variant="labelSm"
                            color={colors.onSurfaceVariant}
                            numberOfLines={1}
                            style={{ maxWidth: 100 }}
                          >
                            {payout.from ?? '—'}
                          </Txt>
                          <MaterialIcons name="arrow-right-alt" size={14} color={colors.outline} />
                          <Txt
                            variant="labelSm"
                            color={colors.onSurfaceVariant}
                            numberOfLines={1}
                            style={{ flex: 1 }}
                          >
                            {payout.to ?? '—'}
                          </Txt>
                        </View>
                        <Txt variant="labelSm" color={colors.outline} style={{ marginTop: 2 }}>
                          {shortDate(payout.createdAt)}
                        </Txt>
                      </View>
                      <StatusBadge status={state.badge} label={state.label} />
                    </View>

                    <Divider />
                    <Row label="Your share" value={rupees(payout.amount)} bold />
                    {payout.transferId ? (
                      <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                        Transfer {payout.transferId}
                        {payout.settledAt ? ` · settled ${shortDate(payout.settledAt)}` : ''}
                      </Txt>
                    ) : (
                      <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                        Transfers settle shortly after the farmer pays.
                      </Txt>
                    )}
                    {/* why it has not landed — the driver can usually act on this */}
                    {!state.settled && payout.payoutNote ? (
                      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
                        {payout.payoutNote}
                      </Txt>
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        )}
      </Screen>

      <BottomNav role="transporter" active="earnings" />
    </View>
  );
}
