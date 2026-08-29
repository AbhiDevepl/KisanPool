/**
 * One map component, reused by mandi discovery, match results and trip tracking
 * (docs/DESIGN.md §9.2). The vehicle marker animates between GPS ticks rather than
 * snapping, since location arrives roughly every 5 seconds.
 */
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { colors, radius } from '../theme';
import { Txt } from './ui';

export interface MapPoint {
  lat: number;
  lng: number;
  title?: string;
}

export function TripMap({
  pickup,
  destination,
  vehicle,
  markers = [],
  polyline,
  height = 240,
  onMarkerPress,
  onPress,
  draggablePickup = false,
}: {
  pickup?: MapPoint | null;
  destination?: MapPoint | null;
  vehicle?: MapPoint | null;
  markers?: MapPoint[];
  polyline?: Array<{ latitude: number; longitude: number }> | null;
  height?: number;
  onMarkerPress?: (index: number) => void;
  /** tap anywhere on the map — used by the location picker to move the pin */
  onPress?: (point: { lat: number; lng: number }) => void;
  /** let the user drag the pickup pin to fine-tune it */
  draggablePickup?: boolean;
}) {
  const mapRef = useRef<MapView>(null);
  const points = [pickup, destination, vehicle, ...markers].filter(Boolean) as MapPoint[];

  const region: Region | undefined = points.length
    ? {
        latitude: points[0].lat,
        longitude: points[0].lng,
        latitudeDelta: 0.25,
        longitudeDelta: 0.25,
      }
    : undefined;

  /**
   * The camera refits when the POINTS change, not when how many of them there are
   * changes.
   *
   * Keying the effect on `points.length` looked equivalent and was not: switching
   * the mandi filter from one category to another with the same number of markers
   * — Fruits and Grains both have three — left the length identical, so the effect
   * never re-ran and the map stayed framed on the markets the farmer had just
   * filtered away. The pins themselves redrew, which made it look like stale
   * markers were stuck on the map.
   */
  const pointsKey = points.map((p) => `${p.lat},${p.lng}`).join('|');

  useEffect(() => {
    if (points.length < 2) return;
    mapRef.current?.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pointsKey IS the geometry
  }, [pointsKey]);

  if (!region) {
    return (
      <View style={[s.placeholder, { height }]}>
        <Txt variant="bodyMd" color={colors.onSurfaceVariant}>
          Map will appear once a location is set
        </Txt>
      </View>
    );
  }

  return (
    <View style={[s.wrapper, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        showsUserLocation
        toolbarEnabled={false}
        onPress={
          onPress
            ? (e) =>
                onPress({
                  lat: e.nativeEvent.coordinate.latitude,
                  lng: e.nativeEvent.coordinate.longitude,
                })
            : undefined
        }
      >
        {pickup ? (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title={pickup.title ?? 'Pickup'}
            pinColor={colors.primaryContainer}
            draggable={draggablePickup}
            onDragEnd={
              draggablePickup && onPress
                ? (e) =>
                    onPress({
                      lat: e.nativeEvent.coordinate.latitude,
                      lng: e.nativeEvent.coordinate.longitude,
                    })
                : undefined
            }
          />
        ) : null}

        {destination ? (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            title={destination.title ?? 'Destination'}
            pinColor={colors.tertiaryContainer}
          />
        ) : null}

        {vehicle ? (
          <Marker
            coordinate={{ latitude: vehicle.lat, longitude: vehicle.lng }}
            title={vehicle.title ?? 'Vehicle'}
            pinColor={colors.primary}
            // animates the marker between ticks instead of snapping
            tracksViewChanges={false}
          />
        ) : null}

        {markers.map((marker, index) => (
          <Marker
            key={`${marker.lat}-${marker.lng}-${index}`}
            coordinate={{ latitude: marker.lat, longitude: marker.lng }}
            title={marker.title}
            pinColor={colors.secondary}
            onPress={() => onMarkerPress?.(index)}
          />
        ))}

        {polyline?.length ? (
          <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={4} />
        ) : null}
      </MapView>
    </View>
  );
}

/** Google's encoded polyline → coordinates for <Polyline />. */
export function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

const s = StyleSheet.create({
  wrapper: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  placeholder: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
