import { useEffect, useState } from 'react';
import { api, type Billing, type PricingAudit } from '../api';
import { Badge, Empty, ErrorBox, Loading, Stat, kg, rupees, when } from '../ui';

const PAYMENT_FILTERS = ['', 'CREATED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

/**
 * Billing (PROMPT_1 §13 A3).
 *
 * Settlements are per shipment, because one trip now bills several farmers
 * separately, each after their own load is delivered. The audit trail underneath
 * is the whole point of the screen: when a farmer rings up asking why their price
 * changed, this is the only place that can answer with a receipt rather than an
 * explanation of the algorithm.
 */
export function BillingTab() {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState('');
  const [tripId, setTripId] = useState('');

  const load = (): void => {
    setError(undefined);
    setData(null);
    api
      .billing({ status: status || undefined, tripId: tripId || undefined })
      .then(setData)
      .catch(setError);
  };

  useEffect(load, [status, tripId]);

  const [audit, setAudit] = useState<PricingAudit | null>(null);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<unknown>();

  const loadAudit = (id: string): void => {
    setAuditFor(id);
    setAudit(null);
    setAuditError(undefined);
    api.pricingAudit(id).then(setAudit).catch(setAuditError);
  };

  // the trip list comes from the settlements, so the picker can never offer a trip
  // that has no billing rows behind it
  const tripOptions = data?.trips ?? [];

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ maxWidth: 220 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {PAYMENT_FILTERS.map((value) => (
            <option key={value || 'ALL'} value={value}>
              {value ? `Payment ${value.replace(/_/g, ' ').toLowerCase()}` : 'All payment states'}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ maxWidth: 320 }}
          value={tripId}
          onChange={(e) => setTripId(e.target.value)}
        >
          <option value="">All trips</option>
          {tripOptions.map((trip) => (
            <option key={trip._id} value={trip._id}>
              {trip.to || 'mandi'} · {trip.state.toLowerCase()} · v{trip.pricingVersion}
            </option>
          ))}
        </select>
        <button className="btn secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <ErrorBox error={error} onRetry={load} /> : null}

      {!data ? (
        <Loading />
      ) : (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
          >
            <Stat label="Billed" value={rupees(data.totals.billed)} hint="across these shipments" />
            <Stat label="Collected" value={rupees(data.totals.collected)} hint="captured from farmers" />
            <Stat
              label="Awaiting payment"
              value={String(data.totals.awaitingPayment)}
              hint="delivered, not yet paid"
            />
            <Stat label="Paid out" value={rupees(data.totals.paidOut)} hint="transferred to transporters" />
            <Stat
              label="Awaiting transfer"
              value={String(data.totals.awaitingTransfer)}
              hint="paid by the farmer, payout not made"
            />
            <Stat
              label="Saved by pooling"
              value={rupees(data.totals.totalSaved)}
              hint="versus each farmer going alone"
            />
          </div>

          {data.settlements.length === 0 ? (
            <Empty message="No settlements match that filter." />
          ) : (
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>Load</th>
                    <th>Trip</th>
                    <th>Shipment</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Transfer</th>
                    <th style={{ width: 120 }}>Why this price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settlements.map((row) => (
                    <tr key={row.shipmentId}>
                      <td>
                        <strong>{row.farmer?.name || 'Unknown'}</strong>
                        <div className="label-sm muted">{row.farmer?.phone}</div>
                      </td>
                      <td>
                        {row.cropType}
                        <div className="label-sm muted">{kg(row.quantityKg)}</div>
                      </td>
                      <td className="label-sm muted">
                        {row.trip?.to || '—'}
                        <div>
                          {row.trip ? <Badge value={row.trip.state} /> : null}
                        </div>
                      </td>
                      <td>
                        <Badge value={row.shipmentState} />
                        <div className="label-sm muted">
                          {row.deliveredAt ? when(row.deliveredAt) : 'not delivered'}
                        </div>
                      </td>
                      <td>
                        <strong>{rupees(row.finalPrice ?? row.allocatedPrice)}</strong>
                        <div className="label-sm muted">
                          {row.finalPrice != null ? 'final' : 'still moving'} · saved{' '}
                          {rupees(row.saved)}
                        </div>
                      </td>
                      <td>
                        {row.payment ? (
                          <>
                            <Badge value={row.payment.status} />
                            <div className="label-sm muted">
                              {rupees(row.payment.amount)}
                              {row.payment.capturedAt ? ` · ${when(row.payment.capturedAt)}` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="muted label-sm">
                            {row.shipmentState === 'PAYMENT_PENDING'
                              ? 'no order yet'
                              : 'not billable yet'}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.payment?.transferId ? (
                          <>
                            <Badge value={row.payment.transferStatus ?? 'CREATED'} />
                            <div className="label-sm muted">
                              {rupees(row.payment.transporterPayoutAmount)} to transporter
                            </div>
                          </>
                        ) : row.payment?.status === 'PAID' ? (
                          <span className="badge warn">payout pending</span>
                        ) : (
                          <span className="muted label-sm">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn secondary"
                          style={{ minHeight: 32 }}
                          onClick={() => loadAudit(row.tripId)}
                        >
                          Audit trail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {auditFor ? (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="headline-md">Pricing audit trail</div>
            <button className="btn ghost" onClick={() => setAuditFor(null)}>
              Close
            </button>
          </div>

          {auditError ? (
            <ErrorBox error={auditError} onRetry={() => loadAudit(auditFor)} />
          ) : !audit ? (
            <Loading />
          ) : audit.events.length === 0 ? (
            <Empty message="No price has been reallocated on this trip yet." />
          ) : (
            <>
              <div className="card">
                <div className="label-lg">
                  → {audit.trip.to || 'mandi'} · {audit.trip.transporter?.name || 'Unknown'}
                </div>
                <div className="label-sm muted">
                  {audit.trip.routeDistanceKm} km · {rupees(audit.trip.estimatedRouteCost)} route
                  cost · {audit.trip.poolSize} farmer
                  {audit.trip.poolSize === 1 ? '' : 's'} · currently at version{' '}
                  {audit.trip.pricingVersion}
                </div>
              </div>

              {audit.events.map((event) => (
                <div key={event._id} className="card">
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <div>
                      <span className="label-lg">v{event.version}</span>{' '}
                      <span className="body-md">{event.reason}</span>
                      <div className="label-sm muted">
                        {rupees(event.routeCost)} over {event.routeDistanceKm} km, split across{' '}
                        {kg(event.totalQuantityKg)}
                      </div>
                    </div>
                    <span className="label-sm muted">{when(event.createdAt)}</span>
                  </div>

                  <div className="table-wrap" style={{ marginTop: 'var(--s-sm)' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Farmer</th>
                          <th>Weight</th>
                          <th>Was</th>
                          <th>Became</th>
                          <th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.allocations.map((allocation) => (
                          <tr key={allocation.shipmentId}>
                            <td>{allocation.farmerName}</td>
                            <td className="muted">{kg(allocation.quantityKg)}</td>
                            <td className="muted">
                              {allocation.previousAmount == null
                                ? 'first quote'
                                : rupees(allocation.previousAmount)}
                            </td>
                            <td>
                              <strong>{rupees(allocation.amount)}</strong>
                            </td>
                            <td>
                              {allocation.delta == null ? (
                                <span className="muted">—</span>
                              ) : (
                                <span
                                  className={`badge ${allocation.delta <= 0 ? 'good' : 'bad'}`}
                                >
                                  {allocation.delta <= 0 ? '↓' : '↑'} {rupees(Math.abs(allocation.delta))}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
