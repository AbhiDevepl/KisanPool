import { useEffect, useState, type ReactNode } from 'react';
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
  const [error, setError] = useState<unknown>();
  const [live, setLive] = useState(true);
  const [stuckMinutes, setStuckMinutes] = useState(45);
  const [openTrip, setOpenTrip] = useState<string | null>(null);

  const load = (quiet = false): void => {
    setError(undefined);
    if (!quiet) setData(null);
    api.live(stuckMinutes).then(setData).catch(setError);
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
