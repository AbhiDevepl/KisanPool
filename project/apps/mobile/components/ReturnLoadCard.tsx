/**
 * One return load, scored against the driver's actual journey home.
 *
 * The card's whole job is to put the COST next to the PAY. A backhaul that earns
 * ₹900 but adds 40 km of detour is a worse deal than one earning ₹600 on the way,
 * and a card that showed only the money would let a driver take the wrong one.
 * So "It adds" and "You earn" sit side by side, always, and the ranking's reason
 * is printed in words rather than left as a score the driver cannot check.
 */
import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { BackhaulMatchDTO } from '@kisanpool/shared';
import { kg, km, rupees } from '../lib/format';
import { CARGO_ICON, CARGO_LABEL } from '../lib/machinery';
import { Button, Card, Divider, IconBadge, Row, Txt } from './ui';
import { colors, radius, space } from '../theme';

export function ReturnLoadCard({
  match,
  busy,
  onTake,
}: {
  match: BackhaulMatchDTO;
  busy: boolean;
  onTake: () => void;
}) {
  return (
    <Card>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.gutter }}>
      <IconBadge icon={CARGO_ICON[match.request.cargoCategory]} tone="tertiary" />
      <View style={{ flex: 1 }}>
        <Txt variant="labelLg">{match.request.description}</Txt>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          {CARGO_LABEL[match.request.cargoCategory]} · {kg(match.request.weightKg)}
        </Txt>
      </View>
    </View>

    {/* why this row is here, in words */}
    <View style={s.reason}>
      <MaterialIcons name="insights" size={16} color={colors.onInfoContainer} />
      <Txt variant="labelSm" color={colors.onInfoContainer} style={{ flex: 1 }}>
        {match.fitReason}
      </Txt>
    </View>

    <View style={{ marginTop: space.gutter, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <MaterialIcons name="my-location" size={15} color={colors.primary} />
        <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
          {match.request.pickup.name}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <MaterialIcons name="place" size={15} color={colors.tertiary} />
        <Txt variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>
          {match.request.destination.name}
        </Txt>
      </View>
    </View>

    {/* what it COSTS, next to what it pays — never one without the other */}
    <View style={s.tradeoff}>
      <View style={{ flex: 1 }}>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          It adds
        </Txt>
        <Txt variant="labelLg">+{km(match.detourKm)}</Txt>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          ~{match.addedMinutes} min · {kg(match.request.weightKg)}
        </Txt>
      </View>
      <View style={{ width: 1, backgroundColor: colors.outlineVariant }} />
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          You earn
        </Txt>
        <Txt variant="headlineMd" color={colors.primary}>
          {rupees(match.expectedEarning)}
        </Txt>
        <Txt variant="labelSm" color={colors.onSurfaceVariant}>
          {match.utilisationPct}% of the vehicle
        </Txt>
      </View>
    </View>

    <Divider />
    <Row label="Cargo rides" value={km(match.carryKm)} />
    <Row
      label="Empty km recovered"
      value={km(match.emptyKmRecovered)}
      bold
    />
    <Row
      label="Collect between"
      value={`${new Date(match.request.readyFrom).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
      })} – ${new Date(match.request.readyUntil).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
      })}`}
    />

    <Button
      label="Take this load"
      icon="add"
      loading={busy}
      onPress={onTake}
      style={{ marginTop: space.gutter }}
    />
    </Card>
  );
}

const s = {
  reason: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: space.sm,
    backgroundColor: colors.infoContainer,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.gutter,
  },
  tradeoff: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.gutter,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: space.gutter,
    marginTop: space.gutter,
  },
};
