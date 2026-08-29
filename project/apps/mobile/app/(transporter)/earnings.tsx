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
  Field,
  FilterRow,
  Metric,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  StatusBadge,
  Toast,
  Txt,
} from '../../components/ui';
import { ErrorView } from '../../components/ErrorView';
import { BottomNav } from '../../components/BottomNav';
import { toAppError } from '../../lib/errors';
import { colors, radius, space } from '../../theme';

type Payout = Awaited<ReturnType<typeof api.payouts>>['payouts'][number];
type Tab = 'all' | 'settled' | 'pending';

/** Razorpay's own transfer states, not a binary paid/not-paid guess. */
function transferState(payout: Payout): { badge: string; label: string; settled: boolean } {
  if (!payout.transferId) return { badge: 'PENDING', label: 'Pending', settled: false };
  const status = (payout.transferStatus ?? '').toLowerCase();
  if (status === 'failed' || status === 'reversed')
    return { badge: 'REJECTED', label: 'Failed', settled: false };
  if (status === 'processed') return { badge: 'DELIVERED', label: 'Settled', settled: true };
  return { badge: 'IN_TRANSIT', label: 'Processing', settled: false };
}

export default function Earnings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');

  const data = useLoader(useCallback(() => api.payouts(), []));
  const wallet = useLoader(useCallback(() => api.wallet(), []));
  const withdrawals = useLoader(useCallback(() => api.withdrawals(), []));

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const payouts = useMemo(() => data.data?.payouts ?? [], [data.data]);
  const total = data.data?.total ?? 0;
  const account = data.data?.account ?? null;
  const accountStatus = account?.payoutStatus ?? 'NOT_ONBOARDED';
  const balance = wallet.data?.balance ?? 0;
  const wdRows = withdrawals.data?.withdrawals ?? [];

  const openWithdraw = (): void => {
    setUpiId(account?.upiId ?? '');
    setAmount(String(balance || ''));
    setWithdrawOpen(true);
  };

  const amountNum = Math.floor(Number(amount) || 0);
  const canWithdraw =
    amountNum > 0 &&
    amountNum <= balance &&
    /^[^\s@]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim());

  const submitWithdraw = async (): Promise<void> => {
    setSending(true);
    try {
      await api.withdraw({ amount: amountNum, upiId: upiId.trim() });
      setWithdrawOpen(false);
      setToastTone('success');
      setToast('Withdrawal started');
      wallet.refresh();
      withdrawals.refresh();
    } catch (err) {
      setToastTone('error');
      setToast(toAppError(err).message);
    } finally {
      setSending(false);
    }
  };

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

            {/* wallet — the balance a driver withdraws to their UPI */}
            <Card style={{ backgroundColor: colors.secondaryContainer, borderRadius: radius.xl }}>
              <Txt variant="bodyMd" color={colors.onSecondaryContainer}>
                Wallet balance
              </Txt>
              <Txt variant="displayLg" color={colors.primary}>
                {rupees(balance)}
              </Txt>
              <Txt variant="labelSm" color={colors.onSecondaryContainer} style={{ marginTop: space.xs }}>
                Your delivered-load earnings collect here. Withdraw them to your UPI ID.
              </Txt>
              <Button
                label="Withdraw money"
                icon="account-balance-wallet"
                disabled={balance <= 0 || accountStatus !== 'ACTIVE'}
                onPress={openWithdraw}
                style={{ marginTop: space.gutter }}
              />
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
                  <MaterialIcons name="account-balance-wallet" size={22} color={colors.onWarningContainer} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg" color={colors.onWarningContainer}>
                      UPI ID not set up
                    </Txt>
                    <Txt variant="bodyMd" color={colors.onWarningContainer}>
                      Add a UPI ID so you can withdraw your wallet balance.
                    </Txt>
                    <Button
                      label="Add UPI ID"
                      variant="secondary"
                      icon="account-balance-wallet"
                      onPress={() => router.push('/(auth)/kyc')}
                      style={{ marginTop: space.gutter }}
                    />
                  </View>
                </View>
              </Banner>
            ) : null}

            {wdRows.length > 0 ? (
              <>
                <SectionHeader title="Withdrawals" />
                {wdRows.slice(0, 5).map((w) => (
                  <Card key={w._id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="labelLg">{rupees(w.amount)}</Txt>
                        <Txt variant="labelSm" color={colors.onSurfaceVariant} numberOfLines={1}>
                          {w.upiId} · {shortDate(w.requestedAt)}
                        </Txt>
                        {w.failureReason ? (
                          <Txt variant="labelSm" color={colors.error} numberOfLines={2}>
                            {w.failureReason}
                          </Txt>
                        ) : null}
                      </View>
                      <StatusBadge
                        status={
                          w.status === 'SUCCESS'
                            ? 'DELIVERED'
                            : w.status === 'FAILED'
                              ? 'REJECTED'
                              : 'IN_TRANSIT'
                        }
                        label={
                          w.status === 'SUCCESS'
                            ? 'Paid'
                            : w.status === 'FAILED'
                              ? 'Failed'
                              : 'Processing'
                        }
                      />
                    </View>
                  </Card>
                ))}
              </>
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
                      </Txt>
                    ) : (
                      <Txt variant="labelSm" color={colors.outline} style={{ marginTop: space.xs }}>
                        Transfers settle shortly after the farmer pays.
                      </Txt>
                    )}
                  </Card>
                );
              })
            )}
          </>
        )}
      </Screen>

      <Sheet
        visible={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw money"
        subtitle={`Available: ${rupees(balance)}`}
      >
        <Field
          label="UPI ID"
          value={upiId}
          onChangeText={setUpiId}
          autoCapitalize="none"
          placeholder="name@bank"
        />
        <Field
          label="Amount (₹)"
          value={amount}
          onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="0"
          error={
            amountNum > balance ? 'More than your wallet balance' : undefined
          }
        />
        <Button
          label="Withdraw"
          icon="check"
          loading={sending}
          disabled={!canWithdraw}
          onPress={() => void submitWithdraw()}
          style={{ marginTop: space.sm }}
        />
      </Sheet>

      <Toast message={toast} tone={toastTone} onHide={() => setToast(null)} />
      <BottomNav role="transporter" active="earnings" />
    </View>
  );
}
