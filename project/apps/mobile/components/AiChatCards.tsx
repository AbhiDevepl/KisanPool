/**
 * Renders the rich blocks Servo AI returns under its text reply — a list of
 * mandis / transporters, or a small map. The data is shaped by the server from a
 * read-only tool result; this component only draws it (docs/DESIGN.md §9.3).
 */
import { View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import type { AiCard, AiMapPoint } from '@kisanpool/shared';
import { colors, radius, space } from '../theme';
import { Txt } from './ui';

function regionFor(points: AiMapPoint[]): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.6),
  };
}

function Row({ point, index }: { point: AiMapPoint; index: number }) {
  const icon =
    point.kind === 'transporter' ? 'local-shipping' : point.kind === 'me' ? 'my-location' : 'storefront';
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: space.xs }}>
      <View style={s.badge}>
        <Txt variant="labelSm" color={colors.onPrimary}>
          {index + 1}
        </Txt>
      </View>
      <MaterialIcons name={icon} size={18} color={colors.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Txt variant="labelLg">{point.label}</Txt>
        {point.detail ? (
          <Txt variant="labelSm" color={colors.onSurfaceVariant}>
            {point.detail}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

function CardBlock({ card }: { card: AiCard }) {
  if (card.type === 'map') {
    const points = [card.center, ...card.points];
    return (
      <View style={s.card}>
        <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.xs }}>
          {card.title}
        </Txt>
        <View style={s.mapWrap}>
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_GOOGLE}
            initialRegion={regionFor(points)}
            pointerEvents="none"
            scrollEnabled={false}
            zoomEnabled={false}
          >
            {points.map((p, i) => (
              <Marker
                key={`${p.lat},${p.lng},${i}`}
                coordinate={{ latitude: p.lat, longitude: p.lng }}
                title={p.label}
                description={p.detail}
                pinColor={p.kind === 'me' ? colors.secondary : colors.primary}
              />
            ))}
          </MapView>
        </View>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Txt variant="labelSm" color={colors.onSurfaceVariant} style={{ marginBottom: space.xs }}>
        {card.title}
      </Txt>
      {card.items.map((p, i) => (
        <Row key={`${p.lat},${p.lng},${i}`} point={p} index={i} />
      ))}
    </View>
  );
}

export function AiChatCards({ cards }: { cards?: AiCard[] }) {
  if (!cards?.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {cards.map((card, i) => (
        <CardBlock key={i} card={card} />
      ))}
    </View>
  );
}

const s = {
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  mapWrap: {
    height: 180,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
  },
};
