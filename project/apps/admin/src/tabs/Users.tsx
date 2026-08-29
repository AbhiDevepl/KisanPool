import { useEffect, useState } from 'react';
import { api, type AdminUser } from '../api';
import { Badge, Empty, ErrorBox, Loading, when } from '../ui';

export function UsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<unknown>();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');

  const load = (): void => {
    setError(undefined);
    setUsers(null);
    api.users({ q: q.trim() || undefined, role: role || undefined }).then(setUsers).catch(setError);
  };

  useEffect(load, [role]);

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select className="input" style={{ maxWidth: 180 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="FARMER">Farmers</option>
          <option value="TRANSPORTER">Transporters</option>
        </select>
        <button className="btn" onClick={load}>
          Search
        </button>
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !users ? (
        <Loading />
      ) : users.length === 0 ? (
        <Empty message="No users match that search." />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Location</th>
                <th>Rating</th>
                <th>Requests</th>
                <th>Vehicle</th>
                <th>Joined</th>
                <th>Push</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user._id}>
                  <td>
                    <strong>{user.name || <span className="muted">— not set —</span>}</strong>
                    {!user.phoneVerifiedAt ? (
                      <div className="label-sm" style={{ color: 'var(--error)' }}>
                        phone unverified
                      </div>
                    ) : null}
                  </td>
                  <td>{user.phone}</td>
                  <td>
                    <Badge value={user.role} />
                  </td>
                  <td className="muted">{user.location ?? '—'}</td>
                  <td>
                    {user.ratingCount ? (
                      <>
                        {user.ratingAvg} ★{' '}
                        <span className="label-sm muted">({user.ratingCount})</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {/* a request is confirmed when the farmer picks a transporter;
                        what happens after that belongs to the shipment, not here */}
                    {user.requestCount ? (
                      <>
                        {user.confirmedCount}/{user.requestCount}
                        <div className="label-sm muted">found a transporter</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {user.vehicle ? (
                      <>
                        <div>{user.vehicle.registrationNumber}</div>
                        <Badge value={user.vehicle.verificationStatus} />
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted label-sm">{when(user.createdAt)}</td>
                  <td>{user.hasPushToken ? '✓' : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
