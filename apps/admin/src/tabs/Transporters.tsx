/**
 * Transporters — the carrier side, with the fleet and the KYC queue alongside.
 *
 * Vehicles and Verification are sub-views rather than top-level rail items: an
 * operator working a driver problem needs all three within one click, and the
 * rail stays at the twelve product areas.
 */
import { useState } from 'react';
import { api } from '../api';
import { VehiclesTab } from './Vehicles';
import { VerificationTab } from './Verification';
import { Badge, Empty, ErrorBox, Freshness, SkeletonTable, Stat, Toolbar, useRemote, when } from '../ui';

type View = 'people' | 'vehicles' | 'verification';

export function TransportersTab() {
  const [view, setView] = useState<View>('people');

  return (
    <>
      <div className="subnav">
        <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>
          Transporters
        </button>
        <button className={view === 'vehicles' ? 'active' : ''} onClick={() => setView('vehicles')}>
          Fleet
        </button>
        <button
          className={view === 'verification' ? 'active' : ''}
          onClick={() => setView('verification')}
        >
          KYC queue
        </button>
      </div>

      {view === 'people' ? <People /> : view === 'vehicles' ? <VehiclesTab /> : <VerificationTab />}
    </>
  );
}

function People() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');

  const people = useRemote(() => api.users({ role: 'TRANSPORTER', q: applied || undefined }));
  const rows = people.data ?? [];
  const verified = rows.filter((row) => row.vehicle?.verificationStatus === 'VERIFIED').length;
  const online = rows.filter((row) => row.vehicle?.status === 'AVAILABLE').length;

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
        <Freshness at={people.refreshedAt} onRefresh={people.refresh} />
      </Toolbar>

      {people.loading ? (
        <SkeletonTable />
      ) : people.error ? (
        <ErrorBox error={people.error} onRetry={people.refresh} />
      ) : rows.length === 0 ? (
        <Empty message="No transporters match that search." />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
            <Stat label="Transporters" value={String(rows.length)} />
            <Stat label="Verified vehicles" value={String(verified)} />
            <Stat label="Online now" value={String(online)} />
            <Stat
              label="Awaiting KYC"
              value={String(rows.filter((row) => row.vehicle?.verificationStatus === 'PENDING').length)}
            />
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Vehicle</th>
                  <th>KYC</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Rating</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td>{row.phone}</td>
                    <td>{row.vehicle?.registrationNumber ?? <span className="muted">none</span>}</td>
                    <td>
                      {row.vehicle ? (
                        <Badge value={row.vehicle.verificationStatus} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {row.vehicle ? <Badge value={row.vehicle.status} /> : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.ratingCount ? `${row.ratingAvg.toFixed(1)}★ (${row.ratingCount})` : '—'}
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
