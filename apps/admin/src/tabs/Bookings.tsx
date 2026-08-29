/**
 * Bookings — the demand side, end to end.
 *
 * The two pooling states are shown in separate columns on purpose. "Accepted" is
 * how many transporters put their hand up (which reserves nothing); "Confirmed"
 * is set only once the farmer chose one. A request with five acceptances and no
 * confirmation is the single most useful thing an operator can spot here, and
 * collapsing the columns would hide it.
 */
import { useState } from 'react';
import { api } from '../api';
import { Badge, Empty, ErrorBox, Freshness, SkeletonTable, Stat, Toolbar, kg, rupees, useRemote, when } from '../ui';

const STATES = ['', 'OPEN', 'TRANSPORTER_INTERESTED', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];

export function BookingsTab() {
  const [state, setState] = useState('');
  const [q, setQ] = useState('');

  const bookings = useRemote(() => api.bookings({ state: state || undefined, q: q || undefined }));

  return (
    <>
      <Toolbar>
        <div className="row">
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Search crop, mandi or farmer…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && bookings.refresh()}
          />
          <select
            className="input"
            style={{ width: 210 }}
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            {STATES.map((item) => (
              <option key={item} value={item}>
                {item ? item.replace(/_/g, ' ').toLowerCase() : 'All states'}
              </option>
            ))}
          </select>
          <button className="btn secondary" onClick={bookings.refresh}>
            Apply
          </button>
        </div>
        <Freshness at={bookings.refreshedAt} onRefresh={bookings.refresh} />
      </Toolbar>

      {bookings.loading ? (
        <SkeletonTable />
      ) : bookings.error ? (
        <ErrorBox error={bookings.error} onRetry={bookings.refresh} />
      ) : !bookings.data ? null : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Requests" value={String(bookings.data.totals.total)} />
            <Stat label="Open in pool" value={String(bookings.data.totals.open)} hint="No acceptances yet" />
            <Stat
              label="Awaiting farmer"
              value={String(bookings.data.totals.awaitingFarmer)}
              hint="Accepted, not yet confirmed"
            />
            <Stat label="Confirmed" value={String(bookings.data.totals.confirmed)} hint="Capacity reserved" />
          </div>

          {bookings.data.requests.length === 0 ? (
            <Empty message="No requests match that filter." />
          ) : (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>Produce</th>
                    <th>Route</th>
                    <th>State</th>
                    <th style={{ textAlign: 'right' }}>Accepted</th>
                    <th style={{ textAlign: 'right' }}>Confirmed</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.data.requests.map((row) => (
                    <tr key={row._id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.farmer?.name ?? '—'}</div>
                        <div className="label-sm muted">{row.farmer?.phone ?? ''}</div>
                      </td>
                      <td>
                        {row.cropType}
                        <div className="label-sm muted">{kg(row.quantityKg)}</div>
                      </td>
                      <td>
                        <div>{row.to}</div>
                        <div className="label-sm muted">from {row.from}</div>
                      </td>
                      <td>
                        <Badge value={row.state} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.offerCount > 0 ? (
                          <span className="badge info">{row.offerCount}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.shipment ? (
                          <Badge value={row.shipment.state} />
                        ) : (
                          <span className="muted">not yet</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {row.shipment ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{rupees(row.shipment.price)}</div>
                            <div className="label-sm muted">
                              solo {rupees(row.shipment.soloPrice)}
                            </div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="label-sm muted">{when(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
