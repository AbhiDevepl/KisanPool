/**
 * Farmer stack → tab navigator.
 *
 * home · bookings · mandis · support · profile are tabs (state is preserved per
 * tab). Detail routes (requests/*, trips/*, payments, mandis/[id]) are pushed on
 * top and hide the bar. The visible bar is the shared <BottomNav />, rendered by
 * each tab screen — the built-in tab bar is suppressed here.
 */
import { Tabs } from 'expo-router';
import { colors } from '../../theme';

export default function FarmerLayout() {
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
