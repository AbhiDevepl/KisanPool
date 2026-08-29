import { useEffect, useState } from 'react';
import { api, type AdminVehicle } from '../api';
import { Badge, Empty, ErrorBox, Loading, kg, rupees, when } from '../ui';

const REFRESH_MS = 15_000;

/**
 * On-road view: which vehicles are moving, how much of each is already sold, and
 * where they last reported from. An operator can change status, verification and
 * location — except putting an unverified vehicle on the road, which the server
 * refuses.
 *
 * A vehicle now carries a shared pool rather than one farmer's load, so the useful
 * column is free capacity on the live trip, not "what crop is aboard".
 */
export function VehiclesTab() {
  const [vehicles, setVehicles] = useState<AdminVehicle[] | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyOnRoad, setOnlyOnRoad] = useState(false);
  const [live, setLive] = useState(true);

  const load = (quiet = false): void => {
    setError(undefined);
    if (!quiet) setVehicles(null);
    api.vehicles().then(setVehicles).catch(setError);
  };

  useEffect(() => load(), []);

  // vehicles move; a stale table is worse than no table
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live]);

  const update = async (id: string, patch: Record<string, unknown>): Promise<void> => {
    setBusy(id);
    setError(undefined);
    try {
      await api.updateVehicle(id, patch);
      load(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const setLocation = (vehicle: AdminVehicle): void => {
    const current = vehicle.currentLocation
      ? `${vehicle.currentLocation.lat},${vehicle.currentLocation.lng}`
      : '';
    const input = window.prompt(`New location for ${vehicle.registrationNumber} (lat,lng)`, current);
    if (!input) return;

    const [lat, lng] = input.split(',').map((n) => Number(n.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      window.alert('Enter coordinates as "lat,lng" — for example 18.5204,73.8567');
      return;
    }
    void update(vehicle._id, { currentLocation: { lat, lng } });
  };

  const shown = (vehicles ?? []).filter((v) => !onlyOnRoad || v.activeTrip);
  const onRoadCount = (vehicles ?? []).filter((v) => v.activeTrip).length;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <button
            className={`btn ${onlyOnRoad ? '' : 'secondary'}`}
            onClick={() => setOnlyOnRoad((v) => !v)}
          >
            On road ({onRoadCount})
          </button>
          <button className="btn secondary" onClick={() => load()}>
            Refresh
          </button>
        </div>
        <label className="row label-sm muted" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          auto-refresh every {REFRESH_MS / 1000}s
        </label>
      </div>

      {error ? <ErrorBox error={error} onRetry={() => load()} /> : null}

      {!vehicles ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty message={onlyOnRoad ? 'No vehicle is on a trip right now.' : 'No vehicles registered.'} />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Capacity</th>
                <th>Live trip</th>
                <th>Last location</th>
                <th style={{ width: 260 }}>Update</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((vehicle) => (
                <tr key={vehicle._id}>
                  <td>
                    <strong>{vehicle.registrationNumber}</strong>
                    <div className="label-sm muted">
                      {vehicle.vehicleType} · {rupees(vehicle.ratePerKm)}/km
                    </div>
                  </td>
                  <td>
                    {vehicle.owner?.name ?? '—'}
                    <div className="label-sm muted">{vehicle.owner?.phone}</div>
                  </td>
                  <td>
                    <Badge value={vehicle.status} />
                    <div style={{ marginTop: 4 }}>
                      <Badge value={vehicle.verificationStatus} />
                    </div>
                  </td>
                  <td>
                    {/* the trip's own capacity is derived from the shipments aboard and
                        is what actually gates a new claim; the vehicle field is the
                        registered maximum */}
                    {vehicle.activeTrip?.capacity ? (
                      <>
                        {kg(vehicle.activeTrip.capacity.availableKg)} free
                        <div className="label-sm muted">
                          {kg(vehicle.activeTrip.capacity.committedKg)} committed ·{' '}
                          {kg(vehicle.activeTrip.capacity.loadedKg)} loaded
                        </div>
                      </>
                    ) : (
                      <>
                        {kg(vehicle.availableCapacityKg)} free
                        <div className="label-sm muted">of {kg(vehicle.capacityKg)}</div>
                      </>
                    )}
                  </td>
                  <td>
                    {vehicle.activeTrip ? (
                      <>
                        <Badge value={vehicle.activeTrip.state} />
                        <div className="label-sm" style={{ marginTop: 4 }}>
                          {vehicle.activeTrip.poolSize} farmer
                          {vehicle.activeTrip.poolSize === 1 ? '' : 's'} aboard
                        </div>
                        <div className="label-sm muted">→ {vehicle.activeTrip.to}</div>
                        <div className="label-sm muted">
                          {vehicle.activeTrip.startedAt
                            ? `started ${when(vehicle.activeTrip.startedAt)}`
                            : 'not started'}
                        </div>
                      </>
                    ) : (
                      <span className="muted">idle</span>
                    )}
                  </td>
                  <td className="label-sm muted">
                    {vehicle.currentLocation
                      ? `${vehicle.currentLocation.lat.toFixed(4)}, ${vehicle.currentLocation.lng.toFixed(4)}`
                      : 'never reported'}
                    <div>{when(vehicle.updatedAt)}</div>
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <select
                        className="input"
                        style={{ width: 120, minHeight: 32 }}
                        value={vehicle.status}
                        disabled={busy === vehicle._id}
                        onChange={(e) => void update(vehicle._id, { status: e.target.value })}
                      >
                        <option value="AVAILABLE">Available</option>
                        <option value="BUSY">Busy</option>
                        <option value="OFFLINE">Offline</option>
                      </select>
                      <button
                        className="btn secondary"
                        style={{ minHeight: 32 }}
                        disabled={busy === vehicle._id}
                        onClick={() => setLocation(vehicle)}
                      >
                        Location
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
