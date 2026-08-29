import { useEffect, useState } from 'react';
import { api, type Stats as StatsData } from '../api';
import { Badge, ErrorBox, Loading, Section, Stat, rupees } from '../ui';

/**
 * Pooling first, everything else second.
 *
 * The old overview led with trip counts, which is what a per-farmer courier
 * business measures. This product only justifies itself if farmers are actually
 * sharing vehicles and paying less for it, so pool size and rupees saved are the
 * headline and the rest is context.
 */
export function StatsTab() {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<unknown>();

  const load = (): void => {
    setError(undefined);
    api.stats().then(setData).catch(setError);
  };

  useEffect(load, []);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return <Loading />;

  const breakdown = (record: Record<string, number>) => (
    <div className="card">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {Object.entries(record).length === 0 ? (
          <span className="muted body-md">Nothing yet</span>
        ) : (
          Object.entries(record).map(([key, count]) => (
            <span key={key} className="row" style={{ gap: 6, marginRight: 16 }}>
              <Badge value={key} />
              <strong>{count}</strong>
            </span>
          ))
        )}
      </div>
    </div>
  );

  const poolWorking = data.trips.avgPoolSize >= 2;

  return (
    <div>
      <div className="headline-md" style={{ marginBottom: 'var(--s-gutter)' }}>
        Pooling
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Stat
          label="Farmers per trip"
          value={data.trips.avgPoolSize ? data.trips.avgPoolSize.toFixed(1) : '—'}
          hint={poolWorking ? 'loads are sharing vehicles' : 'below 2 — vehicles are running solo'}
        />
        <Stat
          label="Saved for farmers"
          value={rupees(data.pooling.totalSaved)}
          hint="versus each going alone, on settled loads"
        />
        <Stat
          label="Open offers"
          value={String(data.pooling.offersOpen)}
          hint="transporters waiting on a farmer's choice"
        />
        <Stat
          label="Produce moved"
          value={`${data.trips.tonnesMoved} t`}
          hint={`${data.pooling.shipments} shipment${data.pooling.shipments === 1 ? '' : 's'} in total`}
        />
      </div>

      {!poolWorking && data.trips.total > 0 ? (
        <div
          className="card"
          style={{
            marginTop: 'var(--s-md)',
            background: 'var(--tertiary-container)',
            borderColor: 'var(--tertiary-container)',
            borderRadius: 'var(--r-xl)',
          }}
        >
          <strong style={{ color: 'var(--on-tertiary-container)' }}>
            Trips are averaging {data.trips.avgPoolSize.toFixed(1)} farmers
          </strong>
          <div className="body-md" style={{ color: 'var(--on-tertiary-container)' }}>
            A trip below two farmers costs the same as the old one-farmer-one-truck model —
            nobody is saving anything. Check Live Operations for requests nobody has claimed.
          </div>
        </div>
      ) : null}

      <Section title="Requests, trips and money">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Stat
            label="Requests in the pool"
            value={String(data.requests.open)}
            hint={`${data.requests.total} lifetime · ${data.requests.cancelled} cancelled`}
          />
          <Stat
            label="Active trips"
            value={String(data.trips.active)}
            hint={`${data.trips.completed} completed of ${data.trips.total}`}
          />
          <Stat
            label="Collected"
            value={rupees(data.money.collected)}
            hint="farmer shares captured"
          />
          <Stat
            label="Paid out"
            value={rupees(data.money.paidOut)}
            hint="transferred to transporters"
          />
          <Stat
            label="Fleet capacity in use"
            value={`${data.vehicles.utilisationPct}%`}
            hint={`${Math.round(data.vehicles.capacityInUseKg / 1000)} t of ${Math.round(data.vehicles.capacityTotalKg / 1000)} t`}
          />
          <Stat
            label="Users"
            value={String(data.users.total)}
            hint={`${data.users.byRole.FARMER ?? 0} farmers · ${data.users.byRole.TRANSPORTER ?? 0} transporters`}
          />
          <Stat
            label="Vehicles"
            value={String(data.vehicles.total)}
            hint={`${data.vehicles.byVerification.VERIFIED ?? 0} verified · ${data.vehicles.byVerification.PENDING ?? 0} pending`}
          />
          <Stat
            label="Avg rating"
            value={data.trust.avgStars ? `${data.trust.avgStars} ★` : '—'}
            hint={`${data.trust.ratings} reviews`}
          />
        </div>
      </Section>

      {data.trust.documentsPending > 0 ? (
        <div
          className="card"
          style={{
            marginTop: 'var(--s-md)',
            background: 'var(--tertiary-container)',
            borderColor: 'var(--tertiary-container)',
            borderRadius: 'var(--r-xl)',
          }}
        >
          <strong style={{ color: 'var(--on-tertiary-container)' }}>
            {data.trust.documentsPending} document
            {data.trust.documentsPending > 1 ? 's' : ''} waiting for review
          </strong>
          <div className="body-md" style={{ color: 'var(--on-tertiary-container)' }}>
            Transporters cannot claim requests until their RC and licence are approved.
          </div>
        </div>
      ) : null}

      <Section title="Requests by state">{breakdown(data.requests.byState)}</Section>
      <Section title="Trips by state">{breakdown(data.trips.byState)}</Section>
      <Section title="Vehicles by status">{breakdown(data.vehicles.byStatus)}</Section>
      <Section title="Payments by status">{breakdown(data.money.byStatus)}</Section>
    </div>
  );
}
