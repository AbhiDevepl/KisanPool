/**
 * Transporter stack → tab navigator.
 *
 * home (dashboard) · requests · trips · earnings · profile are tabs (state is
 * preserved per tab). Detail routes are pushed on top. The visible bar is the
 * shared <BottomNav />, rendered by each tab screen — the built-in tab bar is
 * suppressed here.
 */
import { Tabs } from 'expo-router';
import { colors } from '../../theme';

export default function TransporterLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
