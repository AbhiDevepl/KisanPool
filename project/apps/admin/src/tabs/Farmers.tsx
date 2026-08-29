/**
 * Farmers — the supply side of the network.
 *
 * `requestCount` vs `confirmedCount` is the column pair that matters: a farmer
 * who posts often but rarely confirms is a farmer the pool is failing.
 */
import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Freshness, SkeletonTable, Stat, Toolbar, useRemote, when } from '../ui';

export function FarmersTab() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');

  const farmers = useRemote(() => api.users({ role: 'FARMER', q: applied || undefined }));
  const rows = farmers.data ?? [];

  const confirmedTotal = rows.reduce((sum, row) => sum + row.confirmedCount, 0);
  const requestTotal = rows.reduce((sum, row) => sum + row.requestCount, 0);

  return (
    <>
      <Toolbar>
        <div className="row">
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="Search name or phone…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && setApplied(q.trim())}
          />
          <button className="btn secondary" onClick={() => setApplied(q.trim())}>
            Search
          </button>
        </div>
        <Freshness at={farmers.refreshedAt} onRefresh={farmers.refresh} />
      </Toolbar>

      {farmers.loading ? (
        <SkeletonTable />
      ) : farmers.error ? (
        <ErrorBox error={farmers.error} onRetry={farmers.refresh} />
      ) : rows.length === 0 ? (
        <Empty message="No farmers match that search." />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Farmers" value={String(rows.length)} />
            <Stat label="Requests posted" value={String(requestTotal)} />
            <Stat
              label="Confirmed"
              value={String(confirmedTotal)}
              hint={requestTotal ? `${Math.round((confirmedTotal / requestTotal) * 100)}% conversion` : undefined}
            />
            <Stat
              label="Reachable by push"
              value={String(rows.filter((row) => row.hasPushToken).length)}
            />
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>Language</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Confirmed</th>
                  <th style={{ textAlign: 'right' }}>Rating</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td>{row.phone}</td>
                    <td className="muted">{row.location ?? '—'}</td>
                    <td className="label-sm muted">{row.language}</td>
                    <td style={{ textAlign: 'right' }}>{row.requestCount}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.confirmedCount > 0 ? (
                        <span className="badge good">{row.confirmedCount}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.ratingCount ? `${row.ratingAvg.toFixed(1)}★` : '—'}
                    </td>
                    <td className="label-sm muted">{when(row.createdAt)}</td>
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
