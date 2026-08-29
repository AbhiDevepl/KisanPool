/**
 * Mandis — demand by destination.
 *
 * Aggregated server-side from real requests, trips and shipments, so this table
 * says where produce is actually going rather than restating a static list.
 */
import { api } from '../api';
import { Empty, ErrorBox, Freshness, Meter, SkeletonTable, Stat, Toolbar, rupees, useRemote } from '../ui';

export function MandisTab() {
  const mandis = useRemote(() => api.mandis(), 120_000);
  const rows = mandis.data ?? [];
  const busiest = rows[0]?.requests ?? 0;

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">Destinations ranked by demand</div>
        <Freshness at={mandis.refreshedAt} onRefresh={mandis.refresh} />
      </Toolbar>

      {mandis.loading ? (
        <SkeletonTable />
      ) : mandis.error ? (
        <ErrorBox error={mandis.error} onRetry={mandis.refresh} />
      ) : rows.length === 0 ? (
        <Empty message="No mandis have received produce yet. They appear here as soon as a farmer sends a request." />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Mandis served" value={String(rows.length)} />
            <Stat
              label="Tonnes delivered"
              value={`${rows.reduce((sum, row) => sum + row.tonnes, 0).toFixed(1)} t`}
            />
            <Stat
              label="Revenue"
              value={rupees(rows.reduce((sum, row) => sum + row.revenue, 0))}
            />
            <Stat
              label="Farmer savings"
              value={rupees(rows.reduce((sum, row) => sum + row.saved, 0))}
            />
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mandi</th>
                  <th>Demand</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Open</th>
                  <th style={{ textAlign: 'right' }}>Trips</th>
                  <th style={{ textAlign: 'right' }}>Active</th>
                  <th style={{ textAlign: 'right' }}>Tonnes</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Saved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ minWidth: 120 }}>
                      <Meter
                        segments={[
                          {
                            pct: busiest ? (row.requests / busiest) * 100 : 0,
                            color: 'var(--primary)',
                          },
                        ]}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.requests}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.openRequests > 0 ? (
                        <span className="badge warn">{row.openRequests}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.trips}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.activeTrips > 0 ? (
                        <span className="badge info">{row.activeTrips}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.tonnes.toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>{rupees(row.revenue)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--primary)' }}>
                      {rupees(row.saved)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
