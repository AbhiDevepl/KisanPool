/**
 * The operator console shell.
 *
 * Desktop-first: a persistent left rail with the twelve product areas, and a wide
 * content canvas. The old build was six top tabs, which meant Trips, Farmers,
 * Mandis, Bookings, Alerts, AI and Reports had nowhere to live at all.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import { DashboardTab } from './tabs/Dashboard';
import { LiveTab } from './tabs/Live';
import { TripsTab } from './tabs/Trips';
import { FarmersTab } from './tabs/Farmers';
import { TransportersTab } from './tabs/Transporters';
import { MandisTab } from './tabs/Mandis';
import { BookingsTab } from './tabs/Bookings';
import { BillingTab } from './tabs/Billing';
import { AlertsTab } from './tabs/Alerts';
import { AiTab } from './tabs/Ai';
import { ReportsTab } from './tabs/Reports';
import { SettingsTab } from './tabs/Settings';

type TabId =
  | 'dashboard'
  | 'live'
  | 'trips'
  | 'farmers'
  | 'transporters'
  | 'mandis'
  | 'bookings'
  | 'billing'
  | 'alerts'
  | 'ai'
  | 'reports'
  | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  group: string;
  render: () => ReactNode;
}

// grouped the way a shift actually runs: watch, then the ledgers, then the desk
const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦', group: 'Operations', render: () => <DashboardTab /> },
  { id: 'live', label: 'Live Operations', icon: '◉', group: 'Operations', render: () => <LiveTab /> },
  { id: 'trips', label: 'Trips', icon: '⇄', group: 'Operations', render: () => <TripsTab /> },
  { id: 'bookings', label: 'Bookings', icon: '☑', group: 'Operations', render: () => <BookingsTab /> },
  { id: 'farmers', label: 'Farmers', icon: '⚘', group: 'Network', render: () => <FarmersTab /> },
  { id: 'transporters', label: 'Transporters', icon: '⛟', group: 'Network', render: () => <TransportersTab /> },
  { id: 'mandis', label: 'Mandis', icon: '⌂', group: 'Network', render: () => <MandisTab /> },
  { id: 'billing', label: 'Payments & Billing', icon: '₹', group: 'Money', render: () => <BillingTab /> },
  { id: 'alerts', label: 'Alerts & Issues', icon: '⚠', group: 'Oversight', render: () => <AlertsTab /> },
  { id: 'ai', label: 'AI Assistant', icon: '◍', group: 'Oversight', render: () => <AiTab /> },
  { id: 'reports', label: 'Reports', icon: '▤', group: 'Oversight', render: () => <ReportsTab /> },
  { id: 'settings', label: 'Settings', icon: '⚙', group: 'Oversight', render: () => <SettingsTab /> },
];

const GROUPS = ['Operations', 'Network', 'Money', 'Oversight'];

export function App() {
  const [signedIn, setSignedIn] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<TabId>('dashboard');
  const [defaultCreds, setDefaultCreds] = useState(false);
  /** counts on the rail, so an operator sees where the trouble is without clicking */
  const [alertCount, setAlertCount] = useState(0);

  const pollAlerts = useCallback(async () => {
    try {
      const live = await api.live();
      setAlertCount(
        live.alerts.stuckTrips.length +
          live.alerts.idleVehicles.length +
          live.alerts.unclaimedRequests.length,
      );
    } catch {
      // the badge is a convenience; a failure here must not disturb the console
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void pollAlerts();
    const timer = setInterval(() => void pollAlerts(), 60_000);
    return () => clearInterval(timer);
  }, [signedIn, pollAlerts]);

  if (!signedIn) {
    return (
      <Login
        onSignedIn={(usingDefaults) => {
          setDefaultCreds(usingDefaults);
          setSignedIn(true);
        }}
      />
    );
  }

  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--primary-container)',
              color: 'var(--on-primary)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            KP
          </div>
          <div>
            <div className="label-lg">KisanPool</div>
            <div className="label-sm muted">Operator console</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="nav-group-label">{group}</div>
              {TABS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                  aria-current={tab === item.id ? 'page' : undefined}
                >
                  <span aria-hidden style={{ width: 16, textAlign: 'center' }}>
                    {item.icon}
                  </span>
                  {item.label}
                  {item.id === 'alerts' && alertCount > 0 ? (
                    <span className="nav-count">{alertCount}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            className="nav-item"
            onClick={() => {
              clearToken();
              setSignedIn(false);
            }}
          >
            <span aria-hidden style={{ width: 16, textAlign: 'center' }}>
              ⏻
            </span>
            Sign out
          </button>
        </div>
      </aside>

      <div className="canvas">
        <header className="topbar">
          <div>
            <div className="headline-md">{active.label}</div>
            <div className="label-sm muted">{active.group}</div>
          </div>
          <div className="row">
            <span className="dot ok" />
            <span className="label-sm muted">API connected</span>
          </div>
        </header>

        <main className="content">
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

          {active.render()}
        </main>
      </div>
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
