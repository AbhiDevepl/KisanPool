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

// ---------------------------------------------------------------------------
// data loading — one shape for every tab
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  refresh: () => void;
  refreshedAt: Date | null;
}

/**
 * Fetch on mount, optionally on a timer. `loading` is only true before the first
 * result, so a poll never blanks a table an operator is reading.
 */
export function useRemote<T>(fetcher: () => Promise<T>, everyMs?: number): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const ref = useRef(fetcher);
  ref.current = fetcher;

  const run = useCallback(async () => {
    try {
      const result = await ref.current();
      setData(result);
      setError(undefined);
      setRefreshedAt(new Date());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    if (!everyMs) return;
    const timer = setInterval(() => void run(), everyMs);
    return () => clearInterval(timer);
  }, [run, everyMs]);

  return { data, loading, error, refresh: () => void run(), refreshedAt };
}

/** Table-shaped placeholder for a tab's first load. */
export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card stack">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: 20, width: `${95 - index * 7}%` }} />
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 'var(--s-md)' }}>
      {children}
    </div>
  );
}

/** "Updated 12:04:33" — an operator needs to know how old a board is. */
export function Freshness({ at, onRefresh }: { at: Date | null; onRefresh: () => void }) {
  return (
    <div className="row">
      <span className="label-sm muted">
        {at ? `Updated ${at.toLocaleTimeString('en-IN')}` : 'Loading…'}
      </span>
      <button className="btn ghost" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}

/** A stacked proportion bar. Segments are given, never computed from magic ratios. */
export function Meter({ segments }: { segments: Array<{ pct: number; color: string }> }) {
  return (
    <div className="meter">
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{ width: `${Math.max(0, Math.min(100, segment.pct))}%`, background: segment.color }}
        />
      ))}
    </div>
  );
}

export function Health({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
      <div className="row">
        <span className={`dot ${ok ? 'ok' : 'warn'}`} />
        <span className="body-md">{label}</span>
      </div>
      <span className="label-sm muted">{detail}</span>
    </div>
  );
}
