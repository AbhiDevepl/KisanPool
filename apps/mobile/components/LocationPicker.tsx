/**
 * Pick a location by name, by search, on the map, or from GPS — and edit it
 * before it is used.
 *
 * THE BUG THIS EXISTS TO FIX
 * -------------------------
 * Request creation and machine booking both silently used `user.defaultLocation`
 * (itself GPS-only) with no way to change it, so a farmer standing in one village
 * could not send produce from another. Device GPS is now only a *suggestion*: the
 * value that leaves this sheet is whatever the farmer confirmed, and GPS being
 * denied or unavailable never blocks manual entry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Location from 'expo-location';
import { MaterialIcons } from '@expo/vector-icons';
import type { GeoPoint } from '@kisanpool/shared';
import { api } from '../lib/api';
import { Button, Field, Sheet, Txt } from './ui';
import { TripMap } from './TripMap';
import { colors, radius, space } from '../theme';

type Draft = { name: string; lat: number; lng: number };

export function LocationPicker({
  visible,
  onClose,
  onPick,
  initial,
  title = 'Choose the location',
  subtitle,
  confirmLabel = 'Use this location',
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (point: GeoPoint) => void;
  initial?: GeoPoint | null;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(initial ?? null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [searching, setSearching] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // re-seed each time the sheet opens so a cancel truly discards edits
  useEffect(() => {
    if (visible) {
      setDraft(initial ?? null);
      setQuery('');
      setResults([]);
      setNote(null);
    }
  }, [visible, initial]);

  const runSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounce.current) clearTimeout(debounce.current);
      if (text.trim().length < 2) {
        setResults([]);
        return;
      }
      debounce.current = setTimeout(async () => {
        setSearching(true);
        try {
          const hits = await api.searchPlaces(text, draft ?? initial ?? null);
          setResults(hits);
          if (!hits.length) setNote('No match — type a nearby town, or tap the map.');
        } catch {
          setNote('Search is unavailable right now — tap the map to place the pin.');
        } finally {
          setSearching(false);
        }
      }, 350);
    },
    [draft, initial],
  );

  const useCurrentLocation = useCallback(async () => {
    setGpsBusy(true);
    setNote(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setNote('Location permission is off. Search for your village or tap the map instead.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      let name = draft?.name ?? '';
      try {
        const [place] = await Location.reverseGeocodeAsync(position.coords);
        if (place) {
          name = [place.name ?? place.district ?? place.city, place.region]
            .filter(Boolean)
            .join(', ');
        }
      } catch {
        // a name is optional; the farmer can type one
      }
      setDraft({ name: name || 'My location', ...coords });
    } catch {
      setNote('Could not get GPS. Search for your village or tap the map instead.');
    } finally {
      setGpsBusy(false);
    }
  }, [draft]);

  const pickResult = (hit: { name: string; lat: number; lng: number }) => {
    setDraft({ name: hit.name, lat: hit.lat, lng: hit.lng });
    setResults([]);
    setQuery('');
  };

  const onMapPress = (p: { lat: number; lng: number }) =>
    setDraft((prev) => ({ name: prev?.name || 'Dropped pin', lat: p.lat, lng: p.lng }));

  const confirm = () => {
    if (!draft) return;
    onPick({ name: draft.name.trim() || 'Selected location', lat: draft.lat, lng: draft.lng });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <Pressable
        onPress={() => void useCurrentLocation()}
        disabled={gpsBusy}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 44,
          paddingHorizontal: space.gutter,
          borderRadius: radius.base,
          borderWidth: 1,
          borderColor: colors.primary,
          marginBottom: space.sm,
          opacity: gpsBusy ? 0.5 : 1,
        }}
      >
        <MaterialIcons name="my-location" size={20} color={colors.primary} />
        <Txt variant="labelLg" color={colors.primary}>
          {gpsBusy ? 'Getting your location…' : 'Use my current location'}
        </Txt>
      </Pressable>

      <Field
        label="Search a village, town or landmark"
        value={query}
        onChangeText={runSearch}
        placeholder="e.g. Niphad, Nashik"
        autoCorrect={false}
      />

      {searching ? (
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          Searching…
        </Txt>
      ) : null}

      {results.map((hit) => (
        <Pressable
          key={`${hit.lat},${hit.lng},${hit.name}`}
          onPress={() => pickResult(hit)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 44,
            paddingVertical: space.xs,
          }}
        >
          <MaterialIcons name="place" size={18} color={colors.onSurfaceVariant} />
          <Txt variant="bodyMd" style={{ flex: 1 }} numberOfLines={2}>
            {hit.name}
          </Txt>
        </Pressable>
      ))}

      {note ? (
        <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.xs }}>
          {note}
        </Txt>
      ) : null}

      {draft ? (
        <View style={{ marginTop: space.sm }}>
          <TripMap
            pickup={{ lat: draft.lat, lng: draft.lng, title: draft.name }}
            onPress={onMapPress}
            draggablePickup
            height={170}
          />
          <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginTop: space.xs }}>
            Tap the map or drag the pin to adjust.
          </Txt>
          <Field
            label="Name this place"
            value={draft.name}
            onChangeText={(name) => setDraft((prev) => (prev ? { ...prev, name } : prev))}
            placeholder="e.g. My farm, Wagholi"
          />
        </View>
      ) : (
        <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginVertical: space.sm }}>
          Use GPS, search, or tap the map once a point is chosen — you can edit it before
          confirming.
        </Txt>
      )}

      <Button label={confirmLabel} icon="check" disabled={!draft} onPress={confirm} />
    </Sheet>
  );
}
