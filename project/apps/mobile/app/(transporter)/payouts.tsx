/** Earnings passbook — one payout per farmer carried, its transfer status, running total. */
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { kg, rupees, shortDate } from '../../lib/format';
import {
  Card,
  Divider,
  EmptyState,
  Header,
  Loading,
  Row,
  Screen,
  StatusBadge,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { colors, space } from '../../theme';

/** Straight off the endpoint — a payout is per shipment now, not per trip. */
type Payout = Awaited<ReturnType<typeof api.payouts>>['payouts'][number];

export default function Payouts() {
  const router = useRouter();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [total, setTotal] = useState(0);
  const [accountStatus, setAccountStatus] = useState<string>('NOT_ONBOARDED');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const data = await api.payouts();
      setPayouts(data.payouts);
      setTotal(data.total);
      setAccountStatus(data.account?.payoutStatus ?? 'NOT_ONBOARDED');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // a transfer settles minutes after delivery, so the driver will pull this
  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** Razorpay's own transfer states, not a binary paid/not-paid guess. */
  const transferLabel = (payout: Payout): { badge: string; label: string } => {
    if (!payout.transferId) return { badge: 'PENDING', label: 'Pending' };
    const status = (payout.transferStatus ?? '').toLowerCase();
    if (status === 'failed' || status === 'reversed') return { badge: 'REJECTED', label: 'Failed' };
    if (status === 'processed') return { badge: 'DELIVERED', label: 'Processed' };
    return { badge: 'IN_TRANSIT', label: 'Processing' };
  };

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ paddingHorizontal: space.md }}>
        <Header title="Earnings" subtitle="तुमची कमाई" onBack={() => router.back()} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.xl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorView error={error} onRetry={() => void load()} />
        ) : (
          <>
            <Card>
              <Txt variant="labelLg" color={colors.onSurfaceVariant}>
                Paid out so far
              </Txt>
              <Txt variant="displayLg">{rupees(total)}</Txt>
              <Divider />
              <Row
                label="Payout account"
                value={accountStatus === 'ACTIVE' ? 'Active' : 'Not set up'}
              />
            </Card>

            {payouts.length === 0 ? (
              <EmptyState
                icon="payments"
                title="No earnings yet"
                message="Deliver a load and your share lands here automatically. Pull down to refresh."
              />
            ) : (
              payouts.map((payout) => (
                <Card key={payout.paymentId}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="labelLg" numberOfLines={1}>
                        {payout.cropType ?? 'Load'}
                        {payout.quantityKg ? ` · ${kg(payout.quantityKg)}` : ''}
                      </Txt>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1}>
                        {payout.from ?? '—'} → {payout.to ?? '—'}
                      </Txt>
                      <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                        {shortDate(payout.createdAt)}
                      </Txt>
                    </View>
                    <StatusBadge
                      status={transferLabel(payout).badge}
                      label={transferLabel(payout).label}
                    />
                  </View>

                  <Divider />
                  <Row label="Your share" value={rupees(payout.amount)} bold />
                  {payout.transferId ? (
                    <Txt
                      variant="labelSm"
                      color={colors.onSurfaceVariant}
                      style={{ marginTop: space.xs }}
                    >
                      Transfer: {payout.transferId} · {payout.transferStatus}
                    </Txt>
                  ) : null}
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
