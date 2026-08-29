/**
 * Resilience & Recovery — the operator's blackout board (ADR-044).
 *
 * Every number here is READ FROM THE ACTUAL RECOVERY STATE. There are no fake
 * success counts and no hardcoded ticks: if integrity did not pass, this says so
 * and stays saying so. "SYSTEM RECOVERED" appears only when the controller
 * actually reached RECOVERED, which it only does when the checks passed and no
 * journalled operation was left unresolved.
 */
import { useCallback, useEffect, useState } from 'react';
import type { IntegrityReport, ResilienceStatusDTO } from '@kisanpool/shared';
import { api } from '../api';
import { ErrorBox, Loading, when } from '../ui';

const REFRESH_MS = 5000;

/** Colour by meaning, never by guess. */
function stateTone(state: string): string {
  if (['HEALTHY', 'RECOVERED'].includes(state)) return 'badge good';
  if (['DEGRADED', 'RECONCILING', 'VALIDATING'].includes(state)) return 'badge warn';
  if (['RECOVERY_REQUIRED', 'RESTORING', 'MANUAL_REVIEW'].includes(state)) return 'badge bad';
  return 'badge';
}

function depTone(state: string): string {
  if (state === 'UP') return 'badge good';
  if (state === 'DEGRADED') return 'badge warn';
  if (state === 'DOWN') return 'badge bad';
  return 'badge';
}

export function ResilienceTab() {
  const [data, setData] = useState<ResilienceStatusDTO | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) setData(null);
    setError(undefined);
    api.resilience().then(setData).catch(setError);
  }, []);

  useEffect(() => load(), [load]);

  // the board is only useful if it is current — an incident moves in seconds
  useEffect(() => {
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      load(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const runIntegrity = () =>
    act('integrity', async () => {
      const report = await api.integrity();
      setIntegrity(report);
      setNote(
        report.passed
          ? `Integrity checks passed — ${report.checked} records verified.`
          : `${report.findings.filter((f) => f.classification === 'INCONSISTENT' || f.classification === 'MANUAL_REVIEW').length} finding(s) need attention.`,
      );
    });

  const runRecovery = () =>
    act('recover', async () => {
      const result = await api.recover();
      setNote(
        `Recovery finished in state ${result.finalState}. ` +
          `Replay: ${result.replay.superseded} already applied, ${result.replay.unresolved} unresolved. ` +
          `Integrity ${result.integrityPassed ? 'passed' : 'FAILED'}. ` +
          `${result.snapshotsRebuilt} snapshot(s) rebuilt.`,
      );
      setIntegrity(null);
    });

  if (!data && !error) return <Loading />;

  const incident = data?.incident ?? null;
  const simulating = Boolean(data?.simulation);

  return (
    <div className="stack">
      {error ? <ErrorBox error={error} onRetry={() => load()} /> : null}

      {/* ---- system status ---- */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row">
            <span className="headline-md">System status</span>
            {data ? <span className={stateTone(data.state)}>{data.state}</span> : null}
            {data?.writesRestricted ? (
              <span className="badge bad">new bookings &amp; payments paused</span>
            ) : null}
          </div>
          <span className="label-sm muted">
            {data ? `since ${when(data.since)}` : ''}
          </span>
        </div>

        {simulating ? (
          <div
            className="card"
            style={{
              marginTop: 8,
              borderColor: 'var(--error)',
              background: 'var(--error-container)',
            }}
          >
            <strong>Fault simulation active — {data?.simulation?.mode}</strong>
            <div className="label-sm">
              Started {when(data!.simulation!.startedAt)}
              {data!.simulation!.scope.length
                ? ` · scope: ${data!.simulation!.scope.join(', ')}`
                : ''}
              . No data has been modified; clearing the simulation restores normal behaviour.
            </div>
          </div>
        ) : null}

        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 12 }}
        >
          <Dependency
            label="Database"
            state={data?.database.state ?? '—'}
            detail={data?.database.detail ?? ''}
            extra={
              data?.database.replicaSet
                ? `${data.database.replicaSet} · ${data.database.members} members · v${data.database.serverVersion ?? '?'}`
                : undefined
            }
          />
          <Dependency
            label="Cache (Redis)"
            state={data?.cache.state ?? '—'}
            detail={data?.cache.detail ?? ''}
          />
          <Dependency
            label="Recovery journal"
            state={data?.journal.durable ? 'UP' : 'DEGRADED'}
            detail={data?.journal.detail ?? ''}
            extra={
              data
                ? `${data.journal.backend} · ${data.journal.pending} pending · ${data.journal.failed} abandoned`
                : undefined
            }
          />
          <Dependency
            label="Backup / PITR"
            state={data?.database.pitr === 'CONFIGURED' ? 'UP' : 'NOT_CONFIGURED'}
            detail={data?.database.pitrDetail ?? ''}
          />
        </div>

        <div className="label-sm muted" style={{ marginTop: 10 }}>
          Last known good: {data?.lastHealthyAt ? when(data.lastHealthyAt) : 'not yet established'}
        </div>
      </div>

      {/* ---- incident ---- */}
      {incident ? (
        <div className="card" style={{ borderColor: 'var(--error)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="headline-md">
              Incident {incident.id} · {incident.kind}
            </span>
            <span className={stateTone(incident.state)}>{incident.state}</span>
          </div>
          <div className="label-sm muted">
            Detected {when(incident.detectedAt)}
            {incident.resolvedAt ? ` · resolved ${when(incident.resolvedAt)}` : ' · ongoing'}
            {incident.restorePoint ? ` · restore point ${incident.restorePoint}` : ''}
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 10 }}
          >
            <Metric label="Pending events" value={incident.pendingEvents} />
            <Metric label="Already applied" value={incident.supersededEvents} />
            <Metric label="Unresolved" value={incident.failedEvents} bad={incident.failedEvents > 0} />
            <Metric
              label="Snapshots rebuilt"
              value={incident.snapshotsRebuilt ?? '—'}
            />
          </div>

          <div className="label-lg" style={{ marginTop: 12 }}>Recovery stages</div>
          <ul className="stack" style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
            {incident.stages.map((stage, i) => (
              <li key={`${stage.stage}-${i}`} className="body-md">
                <span className={stateTone(stage.stage)}>{stage.stage}</span>{' '}
                <span className="label-sm muted">
                  {when(stage.at)} — {stage.detail}
                </span>
              </li>
            ))}
          </ul>

          {/* the honest completion claim: only what actually happened */}
          {incident.state === 'RECOVERED' ? (
            <div className="card" style={{ marginTop: 10, borderColor: 'var(--primary)' }}>
              <strong>SYSTEM RECOVERED</strong>
              <div className="label-sm">
                ✓ Journal reconciled ({incident.supersededEvents} already applied,{' '}
                {incident.failedEvents} unresolved) · ✓ Integrity checks passed · ✓{' '}
                {incident.snapshotsRebuilt ?? 0} snapshots rebuilt from the database
              </div>
            </div>
          ) : incident.state === 'MANUAL_REVIEW' ? (
            <div className="card" style={{ marginTop: 10, borderColor: 'var(--error)' }}>
              <strong>NEEDS MANUAL REVIEW</strong>
              <div className="label-sm">
                Recovery ran but did not fully validate. Nothing ambiguous has been changed
                automatically — review the findings below before declaring this resolved.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- controls ---- */}
      <div className="card">
        <span className="headline-md">Controls</span>
        <div className="label-sm muted" style={{ marginBottom: 8 }}>
          Simulations are reversible and destroy no data — they make the data layer <em>behave</em>{' '}
          as though it were failing so the real detector and recovery controller run.
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn secondary"
            disabled={busy !== null || simulating}
            onClick={() => act('outage', () => api.simulate('OUTAGE'))}
          >
            {busy === 'outage' ? 'Starting…' : 'Simulate MongoDB failure'}
          </button>
          <button
            className="btn secondary"
            disabled={busy !== null || simulating}
            onClick={() => act('corrupt', () => api.simulate('CORRUPTION'))}
          >
            {busy === 'corrupt' ? 'Starting…' : 'Simulate data corruption'}
          </button>
          <button
            className="btn secondary"
            disabled={busy !== null || !simulating}
            onClick={() => act('stop', () => api.stopSimulation())}
          >
            {busy === 'stop' ? 'Clearing…' : 'Clear simulation'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={runRecovery}>
            {busy === 'recover' ? 'Recovering…' : 'Run recovery'}
          </button>
          <button className="btn ghost" disabled={busy !== null} onClick={runIntegrity}>
            {busy === 'integrity' ? 'Checking…' : 'Run integrity checks'}
          </button>
          <button
            className="btn ghost"
            disabled={busy !== null}
            onClick={() => act('reset', () => api.resetRecovery())}
          >
            Reset controller
          </button>
        </div>
        {note ? (
          <div className="body-md" style={{ marginTop: 10 }}>
            {note}
          </div>
        ) : null}
      </div>

      {/* ---- integrity findings ---- */}
      {integrity ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="headline-md">Integrity report</span>
            <span className={integrity.passed ? 'badge good' : 'badge bad'}>
              {integrity.passed ? 'PASSED' : 'NEEDS ATTENTION'}
            </span>
          </div>
          <div className="label-sm muted">
            {integrity.checked} records checked at {when(integrity.ranAt)}
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Classification</th>
                  <th>Count</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {integrity.findings.map((f) => (
                  <tr key={f.check}>
                    <td>{f.check}</td>
                    <td>
                      <span
                        className={
                          f.classification === 'AUTO_RECOVERED' ||
                          f.classification === 'RECONSTRUCTED'
                            ? 'badge good'
                            : f.classification === 'INCONSISTENT'
                              ? 'badge bad'
                              : 'badge warn'
                        }
                      >
                        {f.classification}
                      </span>
                    </td>
                    <td>{f.count}</td>
                    <td className="label-sm muted">
                      {f.detail}
                      {f.samples.length ? (
                        <div style={{ marginTop: 2 }}>e.g. {f.samples.join(', ')}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Dependency({
  label,
  state,
  detail,
  extra,
}: {
  label: string;
  state: string;
  detail: string;
  extra?: string;
}) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label-lg">{label}</span>
        <span className={depTone(state)}>{state}</span>
      </div>
      <div className="label-sm muted" style={{ marginTop: 2 }}>
        {detail}
      </div>
      {extra ? (
        <div className="label-sm muted" style={{ marginTop: 2 }}>
          {extra}
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  bad,
}: {
  label: string;
  value: number | string;
  bad?: boolean;
}) {
  return (
    <div>
      <div className="display-lg" style={bad ? { color: 'var(--error)' } : undefined}>
        {value}
      </div>
      <div className="label-sm muted">{label}</div>
    </div>
  );
}
