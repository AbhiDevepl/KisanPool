/**
 * One map component, reused by mandi discovery, match results and trip tracking
 * (docs/DESIGN.md §9.2). The vehicle marker animates between GPS ticks rather than
 * snapping, since location arrives roughly every 5 seconds.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { Txt } from './ui';

/** distinct blue for the farmer's own location, so it never reads as a mandi */
const SELF_PIN = '#1e6fd9';

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
  markerVariant = 'pin',
  polyline,
  height = 240,
  onMarkerPress,
}: {
  pickup?: MapPoint | null;
  destination?: MapPoint | null;
  vehicle?: MapPoint | null;
  markers?: MapPoint[];
  /** 'shop' draws each marker as a red storefront badge (mandi discovery) */
  markerVariant?: 'pin' | 'shop';
  polyline?: Array<{ latitude: number; longitude: number }> | null;
  height?: number;
  onMarkerPress?: (index: number) => void;
}) {
  const mapRef = useRef<MapView>(null);
  const points = [pickup, destination, vehicle, ...markers].filter(Boolean) as MapPoint[];

  const focusSelf = useCallback(() => {
    if (!pickup) return;
    mapRef.current?.animateToRegion(
      {
        latitude: pickup.lat,
        longitude: pickup.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      },
      400,
    );
  }, [pickup]);

  const region: Region | undefined = points.length
    ? {
        latitude: points[0].lat,
        longitude: points[0].lng,
        latitudeDelta: 0.25,
        longitudeDelta: 0.25,
      }
    : undefined;

  useEffect(() => {
    if (points.length < 2) return;
    mapRef.current?.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [points.length, vehicle?.lat, vehicle?.lng]);

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
      >
        {pickup ? (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title={pickup.title ?? 'Pickup'}
            pinColor={SELF_PIN}
          />
        ) : null}

        {destination ? (
          markerVariant === 'shop' ? (
            <Marker
              coordinate={{ latitude: destination.lat, longitude: destination.lng }}
              title={destination.title ?? 'Destination'}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={s.shopPinYellow}>
                <MaterialIcons name="storefront" size={16} color="#3a2e00" />
              </View>
            </Marker>
          ) : (
            <Marker
              coordinate={{ latitude: destination.lat, longitude: destination.lng }}
              title={destination.title ?? 'Destination'}
              pinColor={colors.tertiaryContainer}
            />
          )
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

        {markers.map((marker, index) =>
          markerVariant === 'shop' ? (
            <Marker
              key={`${marker.lat}-${marker.lng}-${index}`}
              coordinate={{ latitude: marker.lat, longitude: marker.lng }}
              title={marker.title}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onMarkerPress?.(index)}
            >
              <View style={s.shopPin}>
                <MaterialIcons name="storefront" size={16} color="#ffffff" />
              </View>
            </Marker>
          ) : (
            <Marker
              key={`${marker.lat}-${marker.lng}-${index}`}
              coordinate={{ latitude: marker.lat, longitude: marker.lng }}
              title={marker.title}
              pinColor={colors.secondary}
              onPress={() => onMarkerPress?.(index)}
            />
          ),
        )}

        {polyline?.length ? (
          <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={4} />
        ) : null}
      </MapView>

      {pickup ? (
        <Pressable
          onPress={focusSelf}
          hitSlop={8}
          accessibilityLabel="Centre map on my location"
          style={({ pressed }) => [s.focusButton, { opacity: pressed ? 0.7 : 1 }]}
        >
          <MaterialIcons name="my-location" size={20} color={SELF_PIN} />
        </Pressable>
      ) : null}
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
  shopPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.error,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopPinYellow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f5c518',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
