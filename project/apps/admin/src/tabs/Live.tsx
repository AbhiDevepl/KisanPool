import { useEffect, useState, type ReactNode } from 'react';
import type { OpsPredictionDTO, RiskLevel } from '@kisanpool/shared';
import { api, type LiveOps, type LiveTrip } from '../api';
import { Badge, Empty, ErrorBox, Loading, kg, rupees, when } from '../ui';

const REFRESH_MS = 15_000;

/**
 * Live Operations (PROMPT_1 §13 A2).
 *
 * Everything here comes from one /admin/live read so the whole board describes a
 * single moment — four independent polls would put four different moments on one
 * screen and make "is this trip stuck?" unanswerable.
 */
export function LiveTab() {
  const [data, setData] = useState<LiveOps | null>(null);
  const [predictions, setPredictions] = useState<OpsPredictionDTO | null>(null);
  const [error, setError] = useState<unknown>();
  const [live, setLive] = useState(true);
  const [stuckMinutes, setStuckMinutes] = useState(45);
  const [openTrip, setOpenTrip] = useState<string | null>(null);

  const load = (quiet = false): void => {
    setError(undefined);
    if (!quiet) setData(null);
    api.live(stuckMinutes).then(setData).catch(setError);
    // advisory scoring — its own read, never blocks the operations board
    api.predictions().then(setPredictions).catch(() => setPredictions(null));
  };

  useEffect(() => load(), [stuckMinutes]);

  // a trip board that is a minute old is worse than no board — it makes an
  // operator act on a pickup that already happened
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, stuckMinutes]);

  const alerts = data?.alerts;
  const alertCount =
    (alerts?.stuckTrips.length ?? 0) +
    (alerts?.idleVehicles.length ?? 0) +
    (alerts?.unclaimedRequests.length ?? 0);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn secondary" onClick={() => load()}>
            Refresh
          </button>
          <label className="label-sm muted">Flag a trip idle after</label>
          <select
            className="input"
            style={{ maxWidth: 130, minHeight: 32 }}
            value={stuckMinutes}
            onChange={(e) => setStuckMinutes(Number(e.target.value))}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={120}>2 hours</option>
            <option value={360}>6 hours</option>
          </select>
        </div>
        <div className="row">
          {data ? (
            <span className="label-sm muted">as of {when(data.generatedAt)}</span>
          ) : null}
          <label className="row label-sm muted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            auto-refresh every {REFRESH_MS / 1000}s
          </label>
        </div>
      </div>

      {error ? <ErrorBox error={error} onRetry={() => load()} /> : null}

      {!data ? (
        <Loading />
      ) : (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
          >
            <AlertCard
              title="Trips not moving"
              count={alerts?.stuckTrips.length ?? 0}
              clear={`No trip has been idle for ${stuckMinutes} minutes.`}
            >
              {alerts?.stuckTrips.map((trip) => (
                <li key={trip._id} className="body-md">
                  <Badge value={trip.state} />{' '}
                  <strong>{trip.transporter}</strong> → {trip.to || 'mandi'}
                  <div className="label-sm muted">
                    {trip.minutesInState} min without a change · {trip.poolSize} farmer
                    {trip.poolSize === 1 ? '' : 's'} aboard
                  </div>
                </li>
              ))}
            </AlertCard>

            <AlertCard
              title="Online with no trip"
              count={alerts?.idleVehicles.length ?? 0}
              clear="Every online vehicle is on a trip."
            >
              {alerts?.idleVehicles.map((vehicle) => (
                <li key={vehicle._id} className="body-md">
                  <strong>{vehicle.registrationNumber || 'unregistered'}</strong>{' '}
                  <Badge value={vehicle.status} />
                  <div className="label-sm muted">
                    {vehicle.owner} · {kg(vehicle.capacityKg)} idle for {vehicle.minutesIdle} min
                  </div>
                </li>
              ))}
            </AlertCard>

            <AlertCard
              title="Open, nobody claiming"
              count={alerts?.unclaimedRequests.length ?? 0}
              clear="Every open request has at least one transporter interested."
            >
              {alerts?.unclaimedRequests.map((request) => (
                <li key={request._id} className="body-md">
                  <strong>{request.farmer}</strong> · {request.cropType},{' '}
                  {kg(request.quantityKg)}
                  <div className="label-sm muted">
                    {request.from} → {request.to} · waiting {request.minutesOpen} min
                  </div>
                </li>
              ))}
            </AlertCard>
          </div>

          <PredictionsPanel data={predictions} />

          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div className="headline-md">
              Active trips ({data.trips.length})
              {alertCount ? (
                <span className="label-sm muted" style={{ marginLeft: 8 }}>
                  {alertCount} thing{alertCount === 1 ? '' : 's'} need attention
                </span>
              ) : null}
            </div>
          </div>

          {data.trips.length === 0 ? (
            <Empty message="No trip is forming or on the road right now." />
          ) : (
            data.trips.map((trip) => (
              <TripCard
                key={trip._id}
                trip={trip}
                open={openTrip === trip._id}
                onToggle={() => setOpenTrip(openTrip === trip._id ? null : trip._id)}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

function AlertCard({
  title,
  count,
  clear,
  children,
}: {
  title: string;
  count: number;
  clear: string;
  children: ReactNode;
}) {
  return (
    <div
      className="card"
      style={
        count
          ? { borderColor: 'var(--tertiary-container)', background: 'var(--tertiary-container)' }
          : undefined
      }
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span
          className="label-lg"
          style={count ? { color: 'var(--on-tertiary-container)' } : undefined}
        >
          {title}
        </span>
        <span className="display-lg" style={count ? { color: 'var(--on-tertiary-container)' } : undefined}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="body-md muted" style={{ marginTop: 4 }}>
          {clear}
        </div>
      ) : (
        <ul
          className="stack"
          style={{
            margin: '8px 0 0',
            padding: 0,
            listStyle: 'none',
            maxHeight: 220,
            overflowY: 'auto',
            color: 'var(--on-tertiary-container)',
          }}
        >
          {children}
        </ul>
      )}
    </div>
  );
}

const LEVEL_RANK: Record<RiskLevel | 'NORMAL', number> = { LOW: 0, NORMAL: 0, MEDIUM: 1, HIGH: 2 };
const levelClass = (level: string): string =>
  level === 'HIGH' ? 'badge bad' : level === 'MEDIUM' ? 'badge warn' : 'badge';

/**
 * Predictive Insights (ADR-041) — advisory only. Deterministic scoring over live
 * signals; it never changes a trip, a price or a dispatch. Shows only what is at
 * MEDIUM or above so it never buries the operations board.
 */
function PredictionsPanel({ data }: { data: OpsPredictionDTO | null }) {
  if (!data) return null;

  const atRisk = data.trips.filter(
    (t) => LEVEL_RANK[t.delay.level] >= 1 || LEVEL_RANK[t.cancellation.level] >= 1,
  );
  const hotRoutes = data.demand.filter((d) => LEVEL_RANK[d.level] >= 1);

  return (
    <div className="card" style={{ background: 'var(--surface-container-low)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="headline-md">Predictive insights</span>
        <span className="label-sm muted">advisory · from live signals · as of {when(data.generatedAt)}</span>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 8 }}
      >
        <div>
          <div className="label-lg">Trips at risk ({atRisk.length})</div>
          {atRisk.length === 0 ? (
            <div className="body-md muted" style={{ marginTop: 4 }}>
              No live trip is flagged for delay or cancellation risk.
            </div>
          ) : (
            <ul className="stack" style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
              {atRisk.map((t) => (
                <li key={t.tripId} className="body-md">
                  <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {LEVEL_RANK[t.delay.level] >= 1 ? (
                      <span className={levelClass(t.delay.level)}>delay {t.delay.level}</span>
                    ) : null}
                    {LEVEL_RANK[t.cancellation.level] >= 1 ? (
                      <span className={levelClass(t.cancellation.level)}>
                        cancel {t.cancellation.level}
                      </span>
                    ) : null}
                    <strong>{t.transporter}</strong> → {t.to} · {t.poolSize} farmer
                    {t.poolSize === 1 ? '' : 's'}
                  </span>
                  <div className="label-sm muted">
                    {(LEVEL_RANK[t.delay.level] >= LEVEL_RANK[t.cancellation.level]
                      ? t.delay
                      : t.cancellation
                    ).reasons[0]}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="label-lg">High-demand corridors ({hotRoutes.length})</div>
          {hotRoutes.length === 0 ? (
            <div className="body-md muted" style={{ marginTop: 4 }}>
              Demand is normal on every corridor with recent activity.
            </div>
          ) : (
            <ul className="stack" style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
              {hotRoutes.map((d) => (
                <li key={d.mandi} className="body-md">
                  <span className="row" style={{ gap: 6 }}>
                    <span className={levelClass(d.level)}>{d.level}</span>
                    <strong>{d.mandi}</strong>
                  </span>
                  <div className="label-sm muted">{d.reasons[0]}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="label-sm muted" style={{ marginTop: 8 }}>
        Advisory only — predictions never cancel a trip, change a price, reroute a vehicle or
        block anyone. The backend stays authoritative.
      </div>
    </div>
  );
}

function TripCard({
  trip,
  open,
  onToggle,
}: {
  trip: LiveTrip;
  open: boolean;
  onToggle: () => void;
}) {
  const { capacity } = trip;
  const pct = (value: number): string =>
    capacity.totalKg ? `${Math.min(100, (value / capacity.totalKg) * 100)}%` : '0%';

  return (
    <div
      className="card"
      style={trip.stuck ? { borderColor: 'var(--error)' } : undefined}
    >
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="row">
            <Badge value={trip.state} />
            <span className="headline-md">→ {trip.destination?.name || 'mandi'}</span>
            {trip.stuck ? (
              <span className="badge bad">idle {trip.minutesInState} min</span>
            ) : null}
          </div>
          <div className="label-sm muted" style={{ marginTop: 4 }}>
            {trip.transporter?.name || 'Unknown transporter'} ·{' '}
            {trip.vehicle?.registrationNumber ?? 'no vehicle'} ({trip.vehicle?.vehicleType ?? '—'}) ·{' '}
            {trip.routeDistanceKm} km · {rupees(trip.estimatedRouteCost)} route cost · pricing v
            {trip.pricingVersion}
          </div>
          <div className="label-sm muted">
            {trip.startedAt ? `started ${when(trip.startedAt)}` : 'not started'} · last change{' '}
            {when(trip.updatedAt)}
            {trip.vehicle?.currentLocation
              ? ` · last seen ${trip.vehicle.currentLocation.lat.toFixed(3)}, ${trip.vehicle.currentLocation.lng.toFixed(3)}`
              : ' · location never reported'}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="display-lg">{trip.poolSize}</div>
          <div className="label-sm muted">farmers pooled</div>
          <div className="label-sm muted">
            {trip.pickedUpCount}/{trip.poolSize} picked up · {trip.deliveredCount} delivered
          </div>
        </div>
      </div>

      {/* one bar, three parts: in the vehicle, promised but not collected, still sellable */}
      <div style={{ marginTop: 'var(--s-md)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label-sm muted">
            {kg(capacity.loadedKg)} loaded · {kg(capacity.committedKg)} committed ·{' '}
            {kg(capacity.availableKg)} free
          </span>
          <span className="label-sm muted">of {kg(capacity.totalKg)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            height: 10,
            marginTop: 4,
            borderRadius: 'var(--r-sm)',
            overflow: 'hidden',
            background: 'var(--surface-container)',
          }}
        >
          <div style={{ width: pct(capacity.loadedKg), background: 'var(--primary)' }} />
          <div
            style={{
              width: pct(Math.max(0, capacity.committedKg - capacity.loadedKg)),
              background: 'var(--primary-container)',
            }}
          />
        </div>
      </div>

      <button
        className="btn ghost"
        style={{ marginTop: 'var(--s-sm)', padding: 0 }}
        onClick={onToggle}
      >
        {open ? 'Hide' : 'Show'} {trip.shipments.length} shipment
        {trip.shipments.length === 1 ? '' : 's'}
      </button>

      {open ? (
        trip.shipments.length === 0 ? (
          <Empty message="This trip has no shipments yet — it is still forming." />
        ) : (
          <div className="table-wrap" style={{ marginTop: 'var(--s-sm)' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Farmer</th>
                  <th>Load</th>
                  <th>Pickup</th>
                  <th>State</th>
                  <th>Allocated now</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {trip.shipments.map((shipment) => (
                  <tr key={shipment._id}>
                    <td className="muted">{shipment.pickupSequence}</td>
                    <td>
                      <strong>{shipment.farmer?.name || 'Unknown'}</strong>
                      <div className="label-sm muted">{shipment.farmer?.phone}</div>
                    </td>
                    <td>
                      {shipment.cropType}
                      <div className="label-sm muted">{kg(shipment.quantityKg)}</div>
                    </td>
                    <td className="label-sm muted">{shipment.pickup?.name || '—'}</td>
                    <td>
                      <Badge value={shipment.state} />
                    </td>
                    <td>
                      <strong>{rupees(shipment.finalPrice ?? shipment.allocatedPrice)}</strong>
                      <div className="label-sm muted">
                        {shipment.finalPrice != null ? 'final' : 'moves as the pool grows'} · alone{' '}
                        {rupees(shipment.soloPrice)}
                      </div>
                    </td>
                    <td className="label-sm muted">
                      {shipment.deliveredAt
                        ? `delivered ${when(shipment.deliveredAt)}`
                        : shipment.pickedUpAt
                          ? `picked up ${when(shipment.pickedUpAt)}`
                          : 'not collected'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
