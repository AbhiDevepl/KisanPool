import { useState } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import { StatsTab } from './tabs/Stats';
import { LiveTab } from './tabs/Live';
import { BillingTab } from './tabs/Billing';
import { UsersTab } from './tabs/Users';
import { VerificationTab } from './tabs/Verification';
import { VehiclesTab } from './tabs/Vehicles';

// ordered by how often an operator needs them during a shift, not alphabetically
const TABS = [
  { id: 'stats', label: 'Overview', render: () => <StatsTab /> },
  { id: 'live', label: 'Live Operations', render: () => <LiveTab /> },
  { id: 'billing', label: 'Billing', render: () => <BillingTab /> },
  { id: 'users', label: 'Users', render: () => <UsersTab /> },
  { id: 'verification', label: 'Verification', render: () => <VerificationTab /> },
  { id: 'vehicles', label: 'Vehicles', render: () => <VehiclesTab /> },
] as const;

export function App() {
  const [signedIn, setSignedIn] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('stats');
  const [defaultCreds, setDefaultCreds] = useState(false);

  if (!signedIn) {
    return <Login onSignedIn={(usingDefaults) => { setDefaultCreds(usingDefaults); setSignedIn(true); }} />;
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: 'var(--s-md)' }}>
      <header
        className="row"
        style={{ justifyContent: 'space-between', paddingBottom: 'var(--s-md)', flexWrap: 'wrap' }}
      >
        <div className="row">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--r-md)',
              background: 'var(--primary-container)',
              color: 'var(--on-primary)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
            }}
          >
            KP
          </div>
          <div>
            <div className="headline-md">KisanPool Admin</div>
            <div className="label-sm muted">Operator console</div>
          </div>
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            clearToken();
            setSignedIn(false);
          }}
        >
          Sign out
        </button>
      </header>

      {defaultCreds ? (
        <div
          className="card"
          style={{
            background: 'var(--tertiary-container)',
            borderColor: 'var(--tertiary-container)',
            borderRadius: 'var(--r-xl)',
            marginBottom: 'var(--s-md)',
          }}
        >
          <strong style={{ color: 'var(--on-tertiary-container)' }}>
            Default credentials are in use
          </strong>
          <div className="body-md" style={{ color: 'var(--on-tertiary-container)' }}>
            Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> in <code>.env</code>{' '}
            before this server is reachable by anyone else.
          </div>
        </div>
      ) : null}

      <nav
        className="row"
        style={{
          gap: 0,
          borderBottom: '1px solid var(--outline-variant)',
          marginBottom: 'var(--s-lg)',
          overflowX: 'auto',
        }}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className="label-lg"
            style={{
              background: 'none',
              border: 0,
              borderBottom: `2px solid ${tab === item.id ? 'var(--primary)' : 'transparent'}`,
              color: tab === item.id ? 'var(--primary)' : 'var(--on-surface-variant)',
              padding: '12px 16px',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {active.render()}
    </div>
  );
}

function Login({ onSignedIn }: { onSignedIn: (usingDefaults: boolean) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.login(username, password);
      setToken(result.token);
      onSignedIn(result.usingDefaultCredentials);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 'var(--s-md)' }}>
      <form className="card" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="headline-lg">KisanPool Admin</div>
        <div className="body-md muted" style={{ marginBottom: 'var(--s-lg)' }}>
          Operator sign in
        </div>

        <label className="label-lg muted">Username</label>
        <input
          className="input"
          style={{ margin: '4px 0 12px' }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label className="label-lg muted">Password</label>
        <input
          className="input"
          style={{ margin: '4px 0 16px' }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error ? (
          <div className="body-md" style={{ color: 'var(--error)', marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <button className="btn" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="label-sm muted" style={{ marginTop: 12, textAlign: 'center' }}>
          Default login is admin / admin — change it in <code>.env</code>.
        </div>
      </form>
    </div>
  );
}
