/**
 * The honest status banner (ADR-044, §15).
 *
 * Shows nothing at all when the system is normal — a status bar that is always
 * present is a status bar nobody reads. During an incident it says what is
 * happening in plain language, when the shown data was last authoritative, and
 * whether new actions will be accepted.
 *
 * What it deliberately never does: claim recovery is finished, invent an ETA, or
 * imply that an action was accepted when it was not. "New bookings are paused"
 * is a better thing to tell a farmer than a confirmation that is not real.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type ServiceStatusDTO } from '../lib/api';
import { Txt } from './ui';
import { colors, radius, space } from '../theme';

/** Polled slowly: this is a reassurance, not a live feed. */
const POLL_MS = 20_000;

export function useServiceStatus(): ServiceStatusDTO | null {
  const [status, setStatus] = useState<ServiceStatusDTO | null>(null);

  const check = useCallback(() => {
    api
      .serviceStatus()
      .then(setStatus)
      // if the status endpoint itself cannot be reached there is nothing useful
      // to say — the screen's own error handling is a better signal than a guess
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, [check]);

  return status;
}

export function ServiceBanner({ status }: { status: ServiceStatusDTO | null }) {
  if (!status || status.normal) return null;

  const severe = status.writesRestricted;

  return (
    <View
      style={{
        backgroundColor: severe ? colors.warningContainer : colors.infoContainer,
        borderRadius: radius.md,
        padding: space.gutter,
        marginBottom: space.gutter,
        gap: space.xs,
      }}
      accessibilityRole="alert"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <MaterialIcons
          name={severe ? 'cloud-off' : 'sync'}
          size={20}
          color={severe ? colors.onWarningContainer : colors.onInfoContainer}
        />
        <Txt
          variant="labelLg"
          color={severe ? colors.onWarningContainer : colors.onInfoContainer}
          style={{ flex: 1 }}
        >
          {severe ? 'System recovery in progress' : 'Service catching up'}
        </Txt>
      </View>

      <Txt
        variant="bodyMd"
        color={severe ? colors.onWarningContainer : colors.onInfoContainer}
      >
        {status.message}
      </Txt>

      {/* the timestamp is the point: it tells the farmer HOW OLD what they are
          looking at is, rather than letting them assume it is live */}
      {status.lastSyncedAt ? (
        <Txt
          variant="labelSm"
          color={severe ? colors.onWarningContainer : colors.onInfoContainer}
          style={{ opacity: 0.85 }}
        >
          Showing information last confirmed at{' '}
          {new Date(status.lastSyncedAt).toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
          })}
          .
        </Txt>
      ) : null}
    </View>
  );
}
