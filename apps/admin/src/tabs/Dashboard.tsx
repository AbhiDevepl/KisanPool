/**
 * A1 · Operations dashboard — the platform at a glance.
 *
 * Every figure comes from /admin/stats and /admin/live. Nothing on this page is a
 * literal: if a number cannot be derived from the API it is not shown.
 */
import { api } from '../api';
import {
  ErrorBox,
  Freshness,
  Health,
  Meter,
  Section,
  SkeletonTable,
  Stat,
  Toolbar,
  kg,
  rupees,
  useRemote,
} from '../ui';

export function DashboardTab() {
  const stats = useRemote(() => api.stats(), 60_000);
  const live = useRemote(() => api.live(), 60_000);

  if (stats.loading) return <SkeletonTable rows={6} />;
  if (stats.error) return <ErrorBox error={stats.error} onRetry={stats.refresh} />;
  if (!stats.data) return null;

  const s = stats.data;
  const alerts = live.data?.alerts;
  const alertTotal = alerts
    ? alerts.stuckTrips.length + alerts.idleVehicles.length + alerts.unclaimedRequests.length
    : 0;

  const utilisation = s.vehicles.utilisationPct;

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">Platform KPIs, refreshed every minute</div>
        <Freshness at={stats.refreshedAt} onRefresh={stats.refresh} />
      </Toolbar>

      {/* the network */}
      <div className="kpi-grid">
        <Stat
          label="Farmers"
          value={String(s.users.byRole.FARMER ?? 0)}
          hint={`${s.users.newThisWeek} joined this week`}
        />
        <Stat
          label="Transporters"
          value={String(s.users.byRole.TRANSPORTER ?? 0)}
          hint={`${s.vehicles.byVerification.VERIFIED ?? 0} vehicles verified`}
        />
        <Stat
          label="Active trips"
          value={String(s.trips.active)}
          hint={`${s.trips.completed} completed all time`}
        />
        <Stat
          label="Pooled loads"
          value={String(s.pooling.shipments)}
          hint={`${s.trips.avgPoolSize.toFixed(1)} farmers per trip`}
        />
      </div>

      {/* the money */}
      <Section title="Money">
        <div className="kpi-grid">
          <Stat label="Collected" value={rupees(s.money.collected)} hint="Payments captured" />
          <Stat label="Paid out" value={rupees(s.money.paidOut)} hint="Transferred to drivers" />
          <Stat
            label="Farmer savings"
            value={rupees(s.pooling.totalSaved)}
            hint="Versus travelling alone"
          />
          <Stat label="Refunded" value={rupees(s.money.refunded)} hint="Cancellations" />
        </div>
      </Section>

      <div className="split" style={{ marginTop: 'var(--s-lg)' }}>
        {/* fleet */}
        <div className="card">
          <div className="headline-md">Fleet capacity</div>
          <div className="label-sm muted" style={{ marginBottom: 'var(--s-gutter)' }}>
            {kg(s.vehicles.capacityInUseKg)} of {kg(s.vehicles.capacityTotalKg)} committed
          </div>
          <Meter
            segments={[
              { pct: utilisation, color: 'var(--primary)' },
              { pct: Math.max(0, 100 - utilisation), color: 'transparent' },
            ]}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="label-sm muted">{utilisation}% utilised</span>
            <span className="label-sm muted">
              {kg(Math.max(0, s.vehicles.capacityTotalKg - s.vehicles.capacityInUseKg))} free
            </span>
          </div>

          <div style={{ marginTop: 'var(--s-md)' }} className="kpi-grid">
            <Stat label="Available now" value={String(s.vehicles.byStatus.AVAILABLE ?? 0)} />
            <Stat label="On a trip" value={String(s.vehicles.byStatus.BUSY ?? 0)} />
            <Stat label="Offline" value={String(s.vehicles.byStatus.OFFLINE ?? 0)} />
            <Stat label="Tonnes moved" value={`${s.trips.tonnesMoved.toFixed(1)} t`} />
          </div>
        </div>

        {/* what needs a human */}
        <div className="stack">
          <div className="card">
            <div className="headline-md">Needs attention</div>
            {live.loading ? (
              <div className="skeleton" style={{ height: 60, marginTop: 8 }} />
            ) : alertTotal === 0 ? (
              <div className="body-md muted" style={{ marginTop: 8 }}>
                Nothing stuck. Every active trip is moving and every open request has been seen.
              </div>
            ) : (
              <div className="stack" style={{ marginTop: 8 }}>
                <Health
                  label="Stuck trips"
                  ok={(alerts?.stuckTrips.length ?? 0) === 0}
                  detail={String(alerts?.stuckTrips.length ?? 0)}
                />
                <Health
                  label="Idle verified vehicles"
                  ok={(alerts?.idleVehicles.length ?? 0) === 0}
                  detail={String(alerts?.idleVehicles.length ?? 0)}
                />
                <Health
                  label="Unclaimed requests"
                  ok={(alerts?.unclaimedRequests.length ?? 0) === 0}
                  detail={String(alerts?.unclaimedRequests.length ?? 0)}
                />
              </div>
            )}
          </div>

          <div className="card">
            <div className="headline-md">System health</div>
            <div className="stack" style={{ marginTop: 8 }}>
              <Health label="API" ok detail="Responding" />
              <Health
                label="Documents queue"
                ok={s.trust.documentsPending === 0}
                detail={`${s.trust.documentsPending} pending review`}
              />
              <Health
                label="Open offers"
                ok
                detail={`${s.pooling.offersOpen} awaiting a farmer`}
              />
              <Health
                label="Trust"
                ok={s.trust.avgStars >= 4}
                detail={`${s.trust.avgStars.toFixed(1)}★ from ${s.trust.ratings} ratings`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* the funnel — where requests actually end up */}
      <Section title="Request funnel">
        <div className="kpi-grid">
          <Stat label="Total requests" value={String(s.requests.total)} />
          <Stat label="Open in the pool" value={String(s.requests.open)} />
          <Stat
            label="Confirmed"
            value={String(s.requests.byState.CONFIRMED ?? 0)}
            hint="Farmer chose a transporter"
          />
          <Stat label="Cancelled / expired" value={String(s.requests.cancelled)} />
        </div>
      </Section>
    </>
  );
}
