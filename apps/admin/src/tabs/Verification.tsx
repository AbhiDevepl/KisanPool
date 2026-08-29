import { useEffect, useState } from 'react';
import { api, type KycGroup } from '../api';
import { Badge, Empty, ErrorBox, Loading, kg, when } from '../ui';

/**
 * Grouped by transporter, because RC and DL are approved together — that is what
 * flips the vehicle to VERIFIED and lets it appear in matching at all (ADR-010).
 */
export function VerificationTab() {
  const [groups, setGroups] = useState<KycGroup[] | null>(null);
  const [error, setError] = useState<unknown>();
  const [filter, setFilter] = useState('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = (): void => {
    setError(undefined);
    setGroups(null);
    api.documents(filter || undefined).then(setGroups).catch(setError);
  };

  useEffect(load, [filter]);

  const review = async (id: string, status: 'VERIFIED' | 'REJECTED'): Promise<void> => {
    const reason =
      status === 'REJECTED' ? window.prompt('Why is this rejected? (shown to the driver)') : undefined;
    if (status === 'REJECTED' && !reason) return;

    setBusy(id);
    setNote(null);
    try {
      const result = await api.reviewDocument(id, status, reason ?? undefined);
      setNote(
        result.vehicleVerification === 'VERIFIED'
          ? 'Vehicle is now VERIFIED — it will start appearing in matching.'
          : `Saved. Vehicle is ${result.vehicleVerification ?? 'unchanged'}.`,
      );
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        {['PENDING', 'VERIFIED', 'REJECTED', ''].map((value) => (
          <button
            key={value || 'ALL'}
            className={`btn ${filter === value ? '' : 'secondary'}`}
            onClick={() => setFilter(value)}
          >
            {value || 'All'}
          </button>
        ))}
      </div>

      {note ? (
        <div
          className="card"
          style={{ background: 'var(--secondary-container)', borderColor: 'var(--secondary-container)' }}
        >
          <span style={{ color: 'var(--on-secondary-container)' }}>{note}</span>
        </div>
      ) : null}

      {error ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty message="Nothing to review here." />
      ) : (
        groups.map((group) => (
          <div key={group.user._id} className="card">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <div className="headline-md">{group.user.name || 'Unnamed'}</div>
                <div className="label-sm muted">{group.user.phone}</div>
              </div>
              {group.vehicle ? (
                <div style={{ textAlign: 'right' }}>
                  <div className="label-lg">{group.vehicle.registrationNumber}</div>
                  <div className="label-sm muted">
                    {group.vehicle.vehicleType} · {kg(group.vehicle.capacityKg)}
                  </div>
                  <Badge value={group.vehicle.verificationStatus} />
                </div>
              ) : (
                <span className="muted label-sm">no vehicle registered</span>
              )}
            </div>

            <div className="table-wrap" style={{ marginTop: 'var(--s-md)' }}>
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Uploaded</th>
                    <th>Status</th>
                    <th>File</th>
                    <th style={{ width: 200 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {group.documents.map((doc) => (
                    <tr key={doc._id}>
                      <td>
                        <strong>{doc.type}</strong>
                        {doc.type === 'RC' || doc.type === 'DL' ? (
                          <div className="label-sm muted">gates matching</div>
                        ) : (
                          <div className="label-sm muted">gates payouts</div>
                        )}
                      </td>
                      <td className="label-sm muted">{when(doc.createdAt)}</td>
                      <td>
                        <Badge value={doc.status} />
                        {doc.rejectionReason ? (
                          <div className="label-sm" style={{ color: 'var(--error)' }}>
                            {doc.rejectionReason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                          view
                        </a>
                      </td>
                      <td>
                        <div className="row">
                          <button
                            className="btn"
                            disabled={busy === doc._id || doc.status === 'VERIFIED'}
                            onClick={() => void review(doc._id, 'VERIFIED')}
                          >
                            Approve
                          </button>
                          <button
                            className="btn danger"
                            disabled={busy === doc._id || doc.status === 'REJECTED'}
                            onClick={() => void review(doc._id, 'REJECTED')}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
