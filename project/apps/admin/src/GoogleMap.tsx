/**
 * A thin Google Maps wrapper — no npm dependency, just the JS API loaded once.
 *
 * Renders a Map / Satellite toggle over the top-right of the map. Emits a click
 * with lat/lng, draws the given markers, and pans/zooms to `focus` when it
 * changes.
 */
import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    __gmapsPromise?: Promise<any>;
  }
}

const API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ??
  'AIzaSyD1vO6gYF0QM4HA2FatmzWKsAk9F1X2yL0';

function loadGoogle(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (window.__gmapsPromise) return window.__gmapsPromise;
  window.__gmapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return window.__gmapsPromise;
}

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
}

export function GoogleMap({
  center,
  zoom = 6,
  height = 380,
  markers,
  focus,
  onPick,
}: {
  center: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  markers: MapMarker[];
  focus: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerObjs = useRef<any[]>([]);
  const [type, setType] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [failed, setFailed] = useState(false);

  // one-time map creation
  useEffect(() => {
    let cancelled = false;
    void loadGoogle()
      .then((google) => {
        if (cancelled || !divRef.current || mapRef.current) return;
        mapRef.current = new google.maps.Map(divRef.current, {
          center,
          zoom,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          zoomControl: true,
        });
        mapRef.current.addListener('click', (e: any) =>
          onPick(e.latLng.lat(), e.latLng.lng()),
        );
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setMapTypeId(type);
  }, [type]);

  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.panTo(focus);
      mapRef.current.setZoom(12);
    }
  }, [focus]);

  // redraw markers whenever the list changes
  useEffect(() => {
    const google = window.google;
    if (!google || !mapRef.current) return;
    markerObjs.current.forEach((m) => m.setMap(null));
    markerObjs.current = markers.map(
      (m) =>
        new google.maps.Marker({
          position: { lat: m.lat, lng: m.lng },
          map: mapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: m.color,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
        }),
    );
  }, [markers]);

  if (failed) {
    return (
      <div
        style={{
          height,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-container-low)',
        }}
        className="label-sm muted"
      >
        Map could not load — set VITE_GOOGLE_MAPS_API_KEY.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 5,
          display: 'flex',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,.3)',
        }}
      >
        {(['roadmap', 'hybrid'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              border: 'none',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: type === t ? 'var(--primary)' : '#fff',
              color: type === t ? '#fff' : '#333',
            }}
          >
            {t === 'roadmap' ? 'Map' : 'Satellite'}
          </button>
        ))}
      </div>
    </div>
  );
}
