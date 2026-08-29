/**
 * Reports — the numbers a pitch or a weekly review needs, in one place.
 *
 * Everything is computed from /admin/stats and /admin/billing. The CSV export is
 * built from the same rows the tables render, so a downloaded file can never
 * disagree with the screen it came from.
 */
import { api } from '../api';
import {
  ErrorBox,
  Freshness,
  Meter,
  Section,
  SkeletonTable,
  Stat,
  Toolbar,
  kg,
  rupees,
  useRemote,
} from '../ui';

function toCsv(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number): string => `"${String(value).replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
}

function download(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportsTab() {
  const stats = useRemote(() => api.stats(), 120_000);
  const billing = useRemote(() => api.billing());

  if (stats.loading) return <SkeletonTable rows={6} />;
  if (stats.error) return <ErrorBox error={stats.error} onRetry={stats.refresh} />;
  if (!stats.data) return null;

  const s = stats.data;
  const settlements = billing.data?.settlements ?? [];

  // pooling is the whole thesis — this is the number that proves or disproves it
  const savingsPct =
    s.money.collected > 0
      ? Math.round((s.pooling.totalSaved / (s.money.collected + s.pooling.totalSaved)) * 100)
      : 0;

  const exportSettlements = (): void => {
    download(
      `kisanpool-settlements-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        settlements.map((row) => ({
          shipment: row.shipmentId,
          trip: row.tripId,
          farmer: row.farmer?.name ?? '',
          crop: row.cropType,
          quantityKg: row.quantityKg,
          state: row.shipmentState,
          price: row.finalPrice ?? row.allocatedPrice,
          soloPrice: row.soloPrice,
          saved: row.saved,
          paymentStatus: row.payment?.status ?? 'UNPAID',
          payout: row.payment?.transporterPayoutAmount ?? 0,
          deliveredAt: row.deliveredAt ?? '',
        })),
      ),
    );
  };

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">Derived from live platform data</div>
        <div className="row">
          <button className="btn secondary" onClick={exportSettlements} disabled={settlements.length === 0}>
            Export settlements CSV
          </button>
          <Freshness at={stats.refreshedAt} onRefresh={stats.refresh} />
        </div>
      </Toolbar>

      <Section title="Impact">
        <div className="kpi-grid">
          <Stat
            label="Farmer savings"
            value={rupees(s.pooling.totalSaved)}
            hint={`${savingsPct}% cheaper than going alone`}
          />
          <Stat
            label="Average pool size"
            value={s.trips.avgPoolSize.toFixed(1)}
            hint="Farmers sharing one vehicle"
          />
          <Stat label="Tonnes moved" value={`${s.trips.tonnesMoved.toFixed(1)} t`} />
          <Stat
            label="Fleet utilisation"
            value={`${s.vehicles.utilisationPct}%`}
            hint={`${kg(s.vehicles.capacityInUseKg)} of ${kg(s.vehicles.capacityTotalKg)}`}
          />
        </div>
      </Section>

      <Section title="Growth">
        <div className="kpi-grid">
          <Stat label="Total users" value={String(s.users.total)} hint={`${s.users.newThisWeek} this week`} />
          <Stat label="Farmers" value={String(s.users.byRole.FARMER ?? 0)} />
          <Stat label="Transporters" value={String(s.users.byRole.TRANSPORTER ?? 0)} />
          <Stat label="Trips completed" value={String(s.trips.completed)} />
        </div>
      </Section>

      <Section title="Revenue">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-gutter)' }}>
            <span className="label-lg">Collected vs paid out</span>
            <span className="label-sm muted">
              {rupees(s.money.collected)} in · {rupees(s.money.paidOut)} out
            </span>
          </div>
          <Meter
            segments={[
              {
                pct: s.money.collected ? (s.money.paidOut / s.money.collected) * 100 : 0,
                color: 'var(--primary-container)',
              },
              {
                pct: s.money.collected
                  ? Math.max(0, 100 - (s.money.paidOut / s.money.collected) * 100)
                  : 0,
                color: 'var(--primary)',
              },
            ]}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="label-sm muted">Driver payouts</span>
            <span className="label-sm muted">
              Platform retained {rupees(Math.max(0, s.money.collected - s.money.paidOut - s.money.refunded))}
            </span>
          </div>
        </div>

        <div className="kpi-grid" style={{ marginTop: 'var(--s-gutter)' }}>
          <Stat label="Billed" value={rupees(billing.data?.totals.billed ?? 0)} />
          <Stat label="Awaiting payment" value={rupees(billing.data?.totals.awaitingPayment ?? 0)} />
          <Stat label="Awaiting transfer" value={rupees(billing.data?.totals.awaitingTransfer ?? 0)} />
          <Stat label="Refunded" value={rupees(s.money.refunded)} />
        </div>
      </Section>

      <Section title="Trust">
        <div className="kpi-grid">
          <Stat label="Ratings" value={String(s.trust.ratings)} />
          <Stat label="Average stars" value={`${s.trust.avgStars.toFixed(1)}★`} />
          <Stat label="Verified vehicles" value={String(s.vehicles.byVerification.VERIFIED ?? 0)} />
          <Stat label="Documents pending" value={String(s.trust.documentsPending)} />
        </div>
      </Section>
    </>
  );
}
