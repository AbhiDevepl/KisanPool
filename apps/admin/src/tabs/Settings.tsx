/**
 * Settings — what this console is pointed at and what the platform's policies are.
 *
 * Read-only by design. Policy numbers are server configuration (CLAUDE.md: policy
 * numbers are config, not literals), so the console reports them rather than
 * offering an edit box that would quietly diverge from the running server.
 */
import { Section } from '../ui';

const API_URL = import.meta.env.VITE_API_URL || 'same origin (proxied by Vite)';

export function SettingsTab() {
  return (
    <>
      <Section title="Connection">
        <div className="card stack">
          <Row label="API endpoint" value={API_URL} />
          <Row label="Console build" value="0.1.0" />
          <Row label="Session" value="Admin JWT, stored in this browser only" />
        </div>
      </Section>

      <Section title="Platform policy">
        <div className="card stack">
          <Row
            label="Capacity reservation"
            value="Only a farmer's confirmation reserves capacity — a transporter's acceptance never does"
          />
          <Row
            label="Booking transaction"
            value="Confirmations run inside a MongoDB transaction; a lost race returns CONCURRENT_BOOKING"
          />
          <Row
            label="Matching eligibility"
            value="KYC-unverified vehicles are excluded in the matching query, not the UI"
          />
          <Row label="Payment" value="Captured server-side; the signed webhook is what marks it PAID" />
          <Row
            label="Cancellation fee & platform fee"
            value="Set by PLATFORM_CANCELLATION_FEE_PCT and PLATFORM_FEE_PCT in the server .env"
          />
        </div>
      </Section>

      <Section title="Security">
        <div className="card stack">
          <Row label="Admin auth" value="A JWT claim, never a User.role — marketplace tokens are refused" />
          <Row
            label="Credentials"
            value="Set ADMIN_USERNAME and ADMIN_PASSWORD in the server .env before exposing this console"
          />
          <Row label="Secrets" value="Sarvam, Razorpay and Maps keys stay server-side" />
        </div>
      </Section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-lg)', alignItems: 'flex-start' }}>
      <span className="label-lg" style={{ minWidth: 200 }}>
        {label}
      </span>
      <span className="body-md muted" style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
