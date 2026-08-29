/**
 * Mandis — the operator places APMC markets on the map (ADR-039).
 *
 * Click the map to set a location, fill in city / state / crops, "Add to batch"
 * to stage several, then "Save all" writes them to the database in one call.
 * These are the ONLY mandis the farmer app shows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type NewMandi } from '../api';
import { GoogleMap, type MapMarker } from '../GoogleMap';
import { Empty, ErrorBox, Freshness, SkeletonTable, Stat, Toolbar, useRemote } from '../ui';

const INDIA_CENTER = { lat: 19.7515, lng: 75.7139 }; // Maharashtra-ish

/** OpenStreetMap Nominatim geocoder — no key, gives city / state / coordinates. */
interface Place {
  label: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

async function searchPlaces(q: string): Promise<Place[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8' +
    '&countrycodes=in&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    address?: Record<string, string>;
  }>;
  return rows.map((r) => {
    const a = r.address ?? {};
    return {
      label: r.display_name,
      city: a.city ?? a.town ?? a.village ?? a.county ?? a.suburb ?? '',
      state: a.state ?? '',
      lat: Number(r.lat),
      lng: Number(r.lon),
    };
  });
}

export function MandisTab() {
  const remote = useRemote(() => api.mandis(), 120_000);
  const saved = useMemo(() => remote.data ?? [], [remote.data]);

  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({ name: '', city: '', state: '', crops: '' });
  const [batch, setBatch] = useState<NewMandi[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // live city/state lookup
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeOpen, setPlaceOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (placeQuery.trim().length < 3) {
      setPlaces([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void searchPlaces(placeQuery).then(setPlaces).catch(() => setPlaces([]));
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [placeQuery]);

  const pickPlace = (p: Place): void => {
    setForm((f) => ({
      ...f,
      city: p.city || f.city,
      state: p.state || f.state,
      name: f.name || (p.city ? `${p.city} Mandi` : f.name),
    }));
    setPicked({ lat: p.lat, lng: p.lng });
    setPlaceQuery(p.city || p.label.split(',')[0]);
    setPlaceOpen(false);
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const readyForBatch =
    picked && form.name.trim().length >= 2 && form.city.trim() && form.state.trim();

  const addToBatch = (): void => {
    if (!readyForBatch || !picked) return;
    setBatch((b) => [
      ...b,
      {
        name: form.name.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        lat: picked.lat,
        lng: picked.lng,
        crops: form.crops
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      },
    ]);
    setForm({ name: '', city: '', state: '', crops: '' });
    setPicked(null);
    setPlaceQuery('');
    setPlaces([]);
  };

  const saveAll = useCallback(async () => {
    if (batch.length === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.createMandis(batch);
      setBatch([]);
      remote.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [batch, remote]);

  const removeMandi = async (id: string): Promise<void> => {
    await api.deleteMandi(id).catch(() => undefined);
    remote.refresh();
  };

  const toggleMandi = async (id: string, active: boolean): Promise<void> => {
    await api.setMandiActive(id, active).catch(() => undefined);
    remote.refresh();
  };

  const markers: MapMarker[] = [
    ...(picked ? [{ ...picked, color: '#c2410c' }] : []),
    ...batch.map((m) => ({ lat: m.lat, lng: m.lng, color: '#2563eb' })),
    ...saved
      .filter((m) => m.active)
      .map((m) => ({ lat: m.location.lat, lng: m.location.lng, color: '#0d631b' })),
  ];

  return (
    <>
      <Toolbar>
        <div className="label-sm muted">Place mandis on the map — farmers only see active ones</div>
        <Freshness at={remote.refreshedAt} onRefresh={remote.refresh} />
      </Toolbar>

      <div className="kpi-grid" style={{ marginBottom: 'var(--s-md)' }}>
        <Stat label="Mandis" value={String(saved.length)} />
        <Stat label="Active" value={String(saved.filter((m) => m.active).length)} />
        <Stat label="Staged" value={String(batch.length)} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--s-md)' }}>
        <GoogleMap
          center={INDIA_CENTER}
          markers={markers}
          focus={picked}
          onPick={(lat, lng) => setPicked({ lat, lng })}
        />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s-md)' }}>
        <div className="label-lg" style={{ marginBottom: 'var(--s-sm)' }}>
          New mandi{' '}
          <span className="label-sm muted">
            {picked
              ? `at ${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`
              : '— search a place or click the map'}
          </span>
        </div>

        {/* live place lookup: pick a city and its state + coordinates auto-fill */}
        <div style={{ position: 'relative', marginBottom: 'var(--s-sm)' }}>
          <input
            className="input"
            placeholder="Search a city / town in India…"
            value={placeQuery}
            onChange={(e) => {
              setPlaceQuery(e.target.value);
              setPlaceOpen(true);
            }}
            onFocus={() => setPlaceOpen(true)}
            onBlur={() => setTimeout(() => setPlaceOpen(false), 150)}
          />
          {placeOpen && places.length > 0 ? (
            <div
              className="card"
              style={{
                position: 'absolute',
                zIndex: 500,
                left: 0,
                right: 0,
                marginTop: 4,
                padding: 4,
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {places.map((p, i) => (
                <button
                  key={i}
                  className="nav-item"
                  style={{ width: '100%', textAlign: 'left', display: 'block' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickPlace(p)}
                >
                  <span style={{ fontWeight: 600 }}>{p.city || p.label.split(',')[0]}</span>
                  {p.state ? <span className="muted"> · {p.state}</span> : null}
                  <div className="label-sm muted" style={{ whiteSpace: 'normal' }}>
                    {p.label}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-sm)' }}>
          <input className="input" placeholder="Mandi name" value={form.name} onChange={set('name')} />
          <input
            className="input"
            placeholder="City (auto-filled)"
            value={form.city}
            onChange={set('city')}
          />
          <input
            className="input"
            placeholder="State (auto-filled)"
            value={form.state}
            onChange={set('state')}
          />
          <input
            className="input"
            placeholder="Crops (comma separated)"
            value={form.crops}
            onChange={set('crops')}
          />
        </div>
        <div className="row" style={{ marginTop: 'var(--s-sm)', gap: 'var(--s-sm)' }}>
          <button className="btn" disabled={!readyForBatch} onClick={addToBatch}>
            Add to batch
          </button>
          <button
            className="btn"
            style={{ background: 'var(--primary)' }}
            disabled={batch.length === 0 || saving}
            onClick={() => void saveAll()}
          >
            {saving ? 'Saving…' : `Save all (${batch.length})`}
          </button>
          {error ? <span className="body-md" style={{ color: 'var(--error)' }}>{error}</span> : null}
        </div>

        {batch.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 'var(--s-sm)' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Location</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batch.map((m, i) => (
                  <tr key={`row${i}`}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td>{m.city}</td>
                    <td>{m.state}</td>
                    <td className="muted">
                      {m.lat.toFixed(3)}, {m.lng.toFixed(3)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="nav-item"
                        style={{ padding: '2px 8px' }}
                        onClick={() => setBatch((b) => b.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="label-lg" style={{ marginBottom: 'var(--s-sm)' }}>
        Saved mandis
      </div>
      {remote.loading ? (
        <SkeletonTable />
      ) : remote.error ? (
        <ErrorBox error={remote.error} onRetry={remote.refresh} />
      ) : saved.length === 0 ? (
        <Empty message="No mandis yet. Click the map above to place the first one." />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mandi</th>
                <th>City</th>
                <th>State</th>
                <th>Crops</th>
                <th>Location</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {saved.map((m) => (
                <tr key={m._id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.city}</td>
                  <td>{m.state}</td>
                  <td className="muted">{m.crops.join(', ') || '—'}</td>
                  <td className="muted">
                    {m.location.lat.toFixed(3)}, {m.location.lng.toFixed(3)}
                  </td>
                  <td>
                    <span className={`badge ${m.active ? 'ok' : 'warn'}`}>
                      {m.active ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="nav-item"
                      style={{ padding: '2px 8px' }}
                      onClick={() => void toggleMandi(m._id, !m.active)}
                    >
                      {m.active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      className="nav-item"
                      style={{ padding: '2px 8px', color: 'var(--error)' }}
                      onClick={() => void removeMandi(m._id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
