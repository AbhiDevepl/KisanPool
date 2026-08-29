/**
 * A3 · Alerts & issues — everything that needs a human, in one queue.
 *
 * Three feeds the live board already derives, plus the KYC backlog. Each row says
 * what is wrong and how long it has been wrong, because "how long" is what
 * decides which one an operator picks up first.
 */
import { api } from '../api';
import {
  Badge,
  Empty,
  ErrorBox,
  Freshness,
  Section,
  SkeletonTable,
  Stat,
  Toolbar,
  kg,
  useRemote,
} from '../ui';

export function AlertsTab() {
  const live = useRemote(() => api.live(), 30_000);
  const stats = useRemote(() => api.stats(), 120_000);

  const alerts = live.data?.alerts;
  const total = alerts
    ? alerts.stuckTrips.length + alerts.idleVehicles.length + alerts.unclaimedRequests.length
    : 0;

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">
          A trip counts as delayed after {live.data?.stuckMinutes ?? 0} minutes without movement
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
            <Stat label="Open issues" value={String(total)} />
            <Stat label="Delayed trips" value={String(alerts?.stuckTrips.length ?? 0)} />
            <Stat label="Idle vehicles" value={String(alerts?.idleVehicles.length ?? 0)} />
            <Stat
              label="Documents to review"
              value={String(stats.data?.trust.documentsPending ?? 0)}
            />
          </div>

          {total === 0 ? (
            <Empty message="Nothing needs attention. Every active trip is moving, and every open request has been seen by a transporter." />
          ) : null}

          {alerts && alerts.stuckTrips.length > 0 ? (
            <Section title="Delayed trips">
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Transporter</th>
                      <th>Destination</th>
                      <th>State</th>
                      <th style={{ textAlign: 'right' }}>Farmers</th>
                      <th style={{ textAlign: 'right' }}>Stalled for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.stuckTrips.map((trip) => (
                      <tr key={trip._id}>
                        <td style={{ fontWeight: 600 }}>{trip.transporter}</td>
                        <td>{trip.to}</td>
                        <td>
                          <Badge value={trip.state} />
                        </td>
                        <td style={{ textAlign: 'right' }}>{trip.poolSize}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="badge bad">{trip.minutesInState} min</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {alerts && alerts.unclaimedRequests.length > 0 ? (
            <Section title="Requests no transporter has accepted">
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Farmer</th>
                      <th>Produce</th>
                      <th>Route</th>
                      <th style={{ textAlign: 'right' }}>Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.unclaimedRequests.map((request) => (
                      <tr key={request._id}>
                        <td style={{ fontWeight: 600 }}>{request.farmer}</td>
                        <td>
                          {request.cropType} · {kg(request.quantityKg)}
                        </td>
                        <td>
                          {request.from} → {request.to}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="badge warn">{request.minutesOpen} min</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {alerts && alerts.idleVehicles.length > 0 ? (
            <Section title="Verified vehicles sitting idle">
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Owner</th>
                      <th>Vehicle</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Capacity</th>
                      <th style={{ textAlign: 'right' }}>Idle for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.idleVehicles.map((vehicle) => (
                      <tr key={vehicle._id}>
                        <td style={{ fontWeight: 600 }}>{vehicle.owner}</td>
                        <td>{vehicle.registrationNumber}</td>
                        <td>
                          <Badge value={vehicle.status} />
                        </td>
                        <td style={{ textAlign: 'right' }}>{kg(vehicle.capacityKg)}</td>
                        <td style={{ textAlign: 'right' }} className="muted">
                          {vehicle.minutesIdle} min
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}
