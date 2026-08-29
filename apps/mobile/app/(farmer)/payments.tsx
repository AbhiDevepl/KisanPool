/**
 * Payments passbook — what was paid, and what sharing the vehicle saved.
 *
 * Billing is per delivered shipment now, so every row is one load on one shared
 * trip, with the solo price it was measured against (ADR-031).
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
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

type PaymentRow = Awaited<ReturnType<typeof api.myPayments>>[number];

const PAYMENT_LABEL: Record<string, string> = {
  CREATED: 'Not paid',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};

export default function Payments() {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setRows(await api.myPayments());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const paid = rows.filter((row) => row.payment.status === 'PAID');
  const totalPaid = paid.reduce((sum, row) => sum + row.payment.amount, 0);
  const totalSaved = paid.reduce(
    (sum, row) => sum + Math.max((row.shipment?.soloPrice ?? 0) - (row.shipment?.finalPrice ?? 0), 0),
    0,
  );

  return (
    <Screen>
      <Header title="Payments" subtitle="तुमचे व्यवहार" onBack={() => router.back()} />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorView error={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="receipt-long"
          title="No payments yet"
          message="You pay only after your produce is delivered. Your receipts will appear here."
        />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.gutter }}>
            <Card style={{ flex: 1 }}>
              <Txt variant="labelLg" color={colors.onSurfaceVariant}>
                Total paid
              </Txt>
              <Txt variant="displayLg">{rupees(totalPaid)}</Txt>
            </Card>
            <Card style={{ flex: 1, backgroundColor: colors.secondaryContainer }}>
              <Txt variant="labelLg" color={colors.onSecondaryContainer}>
                Pooling saved you
              </Txt>
              <Txt variant="displayLg" color={colors.primary}>
                {rupees(totalSaved)}
              </Txt>
            </Card>
          </View>

          {rows.map(({ payment, shipment }) => {
            const saved = shipment ? Math.max(shipment.soloPrice - shipment.finalPrice, 0) : 0;
            return (
              <Card key={payment._id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="labelLg">
                      {shipment ? `${shipment.cropType} · ${kg(shipment.quantityKg)}` : 'Load'}
                    </Txt>
                    <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                      {shipment?.from ? `From ${shipment.from} · ` : ''}
                      {shortDate(payment.createdAt)}
                    </Txt>
                  </View>
                  <StatusBadge
                    status={payment.status === 'PAID' ? 'BOOKED' : payment.status}
                    label={PAYMENT_LABEL[payment.status] ?? payment.status}
                  />
                </View>

                <Divider />

                <Row label="You paid" value={rupees(payment.amount)} bold />
                {shipment ? (
                  <>
                    <Row label="Alone it would have cost" value={rupees(shipment.soloPrice)} />
                    <Row label="Sharing the vehicle saved" value={rupees(saved)} />
                  </>
                ) : null}
                {payment.refundAmount ? (
                  <Row label="Refunded" value={rupees(payment.refundAmount)} />
                ) : null}
                {payment.razorpayPaymentId ? (
                  <Txt
                    variant="labelSm"
                    color={colors.onSurfaceVariant}
                    style={{ marginTop: space.xs }}
                  >
                    Payment ID: {payment.razorpayPaymentId}
                  </Txt>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
