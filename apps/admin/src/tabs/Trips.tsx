/**
 * Trips — every pooled journey, active first.
 *
 * Reuses the live-operations feed because a trip's truth (capacity, pool size,
 * how long it has sat in one state) is derived there already. Adding a second
 * derivation would be a second chance to disagree with the app.
 */
import { useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Empty,
  ErrorBox,
  Freshness,
  Meter,
  SkeletonTable,
  Stat,
  Toolbar,
  kg,
  rupees,
  useRemote,
  when,
} from '../ui';

type Filter = 'active' | 'stuck' | 'all';

export function TripsTab() {
  const [filter, setFilter] = useState<Filter>('active');
  const live = useRemote(() => api.live(), 30_000);

  const trips = live.data?.trips ?? [];
  const visible =
    filter === 'all' ? trips : filter === 'stuck' ? trips.filter((trip) => trip.stuck) : trips;

  const totalCommitted = trips.reduce((sum, trip) => sum + trip.capacity.committedKg, 0);
  const totalCapacity = trips.reduce((sum, trip) => sum + trip.capacity.totalKg, 0);

  return (
    <>
      <Toolbar>
        <div className="subnav" style={{ border: 0, margin: 0 }}>
          {(['active', 'stuck', 'all'] as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? 'active' : ''}
              onClick={() => setFilter(item)}
            >
              {item === 'active' ? 'Active' : item === 'stuck' ? 'Delayed' : 'All'}
              {item === 'stuck' && trips.some((trip) => trip.stuck)
                ? ` (${trips.filter((trip) => trip.stuck).length})`
                : ''}
            </button>
          ))}
        </div>
        <Freshness at={live.refreshedAt} onRefresh={live.refresh} />
      </Toolbar>

      {live.loading ? (
        <SkeletonTable />
      ) : live.error ? (
        <ErrorBox error={live.error} onRetry={live.refresh} />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Active trips" value={String(trips.length)} />
            <Stat
              label="Delayed"
              value={String(trips.filter((trip) => trip.stuck).length)}
              hint={`No movement for ${live.data?.stuckMinutes ?? 0}+ min`}
            />
            <Stat
              label="Farmers aboard"
              value={String(trips.reduce((sum, trip) => sum + trip.poolSize, 0))}
            />
            <Stat
              label="Capacity committed"
              value={totalCapacity ? `${Math.round((totalCommitted / totalCapacity) * 100)}%` : '—'}
              hint={`${kg(totalCommitted)} of ${kg(totalCapacity)}`}
            />
          </div>

          {visible.length === 0 ? (
            <Empty
              message={
                filter === 'stuck'
                  ? 'Nothing is delayed — every active trip has moved recently.'
                  : 'No trips are running. A trip begins the moment a farmer confirms a transporter.'
              }
            />
          ) : (
            <div className="stack">
              {visible.map((trip) => {
                const usedPct = trip.capacity.totalKg
                  ? (trip.capacity.committedKg / trip.capacity.totalKg) * 100
                  : 0;
                const loadedPct = trip.capacity.totalKg
                  ? (trip.capacity.loadedKg / trip.capacity.totalKg) * 100
                  : 0;

                return (
                  <div
                    key={trip._id}
                    className="card"
                    style={trip.stuck ? { borderColor: 'var(--error)' } : undefined}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <div>
                        <div className="row">
                          <span className="headline-md">{trip.destination.name}</span>
                          <Badge value={trip.state} />
                          {trip.stuck ? <span className="badge bad">delayed</span> : null}
                        </div>
                        <div className="label-sm muted">
                          {trip.transporter?.name ?? 'Unassigned'} ·{' '}
                          {trip.vehicle?.registrationNumber ?? '—'} ·{' '}
                          {trip.routeDistanceKm.toFixed(0)} km · {trip.minutesInState} min in this
                          state
                        </div>
                      </div>
                      <div className="row" style={{ gap: 'var(--s-lg)' }}>
                        <div>
                          <div className="label-sm muted">Farmers</div>
                          <div className="headline-md">{trip.poolSize}</div>
                        </div>
                        <div>
                          <div className="label-sm muted">Picked up</div>
                          <div className="headline-md">
                            {trip.pickedUpCount}/{trip.poolSize}
                          </div>
                        </div>
                        <div>
                          <div className="label-sm muted">Delivered</div>
                          <div className="headline-md">
                            {trip.deliveredCount}/{trip.poolSize}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 'var(--s-gutter)' }}>
                      <Meter
                        segments={[
                          { pct: loadedPct, color: 'var(--primary)' },
                          { pct: Math.max(0, usedPct - loadedPct), color: 'var(--primary-container)' },
                        ]}
                      />
                      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                        <span className="label-sm muted">
                          {kg(trip.capacity.loadedKg)} loaded · {kg(trip.capacity.committedKg)}{' '}
                          reserved
                        </span>
                        <span className="label-sm muted">
                          {kg(trip.capacity.availableKg)} still free
                        </span>
                      </div>
                    </div>

                    {trip.shipments.length > 0 ? (
                      <div className="table-wrap" style={{ marginTop: 'var(--s-gutter)' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Farmer</th>
                              <th>Produce</th>
                              <th>State</th>
                              <th style={{ textAlign: 'right' }}>Share</th>
                              <th>Picked up</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trip.shipments.map((shipment) => (
                              <tr key={shipment._id}>
                                <td>{shipment.pickupSequence + 1}</td>
                                <td>{shipment.farmer?.name ?? '—'}</td>
                                <td>
                                  {shipment.cropType} · {kg(shipment.quantityKg)}
                                </td>
                                <td>
                                  <Badge value={shipment.state} />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {rupees(shipment.finalPrice ?? shipment.allocatedPrice)}
                                </td>
                                <td className="label-sm muted">{when(shipment.pickedUpAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
