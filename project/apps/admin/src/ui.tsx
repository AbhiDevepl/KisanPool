import type { ReactNode } from 'react';

export function Badge({ value }: { value: string }) {
  // one tone map across all three pooling state machines — a state means the same
  // thing to an operator wherever it is rendered
  const tone =
    {
      VERIFIED: 'good',
      DELIVERED: 'good',
      PAID: 'good',
      AVAILABLE: 'good',
      ACTIVE: 'good',
      COMPLETED: 'good',
      CONFIRMED: 'good',
      SELECTED: 'good',
      PENDING: 'warn',
      PAYMENT_PENDING: 'warn',
      CREATED: 'warn',
      OPEN: 'warn',
      FORMING: 'warn',
      ASSIGNED: 'warn',
      AT_DESTINATION: 'warn',
      BUSY: 'info',
      IN_TRANSIT: 'info',
      EN_ROUTE: 'info',
      ARRIVED: 'info',
      PICKED_UP: 'info',
      TRANSPORTER_INTERESTED: 'info',
      INTERESTED: 'info',
      REJECTED: 'bad',
      CANCELLED: 'bad',
      FAILED: 'bad',
      EXPIRED: 'bad',
      WITHDRAWN: 'bad',
      OFFLINE: '',
    }[value] ?? '';
  return <span className={`badge ${tone}`}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="label-sm muted">{label}</div>
      <div className="display-lg" style={{ marginTop: 4 }}>
        {value}
      </div>
      {hint ? <div className="label-sm muted">{hint}</div> : null}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ marginTop: 'var(--s-lg)' }}>
      <div className="headline-md">{title}</div>
      {children}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--s-xl)' }}>
      <div className="muted">{message}</div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const err = error as { code?: string; message?: string };
  return (
    <div
      className="card"
      style={{ borderColor: 'var(--error)', background: 'var(--error-container)' }}
    >
      <div className="label-lg" style={{ color: 'var(--on-error-container)' }}>
        {err.code ?? 'ERROR'}
      </div>
      <div className="body-md" style={{ color: 'var(--on-error-container)', marginTop: 4 }}>
        {err.message ?? 'Something went wrong.'}
      </div>
      {onRetry ? (
        <button className="btn secondary" style={{ marginTop: 12 }} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Loading() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--s-xl)' }}>
      <div className="muted">Loading…</div>
    </div>
  );
}

/** Everything the console shows comes straight from the API — nothing is computed here. */
export const rupees = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;
export const kg = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${v} kg`);
export const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
