/**
 * The role gate. After OTP verification the root navigator reads User.role and
 * mounts exactly one stack — there is no in-app role switch in the MVP (ADR-001).
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { api } from '../lib/api';
import { initI18n } from '../lib/i18n';
import { registerForPush } from '../lib/notifications';
import { clearSession, getAccessToken, setUser } from '../lib/session';
import { Loading, Screen } from '../components/ui';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) {
        router.replace('/(auth)/welcome');
        return;
      }

      try {
        const user = await api.me();
        await setUser(user);
        await initI18n(user.language); // honour the account's saved language
        void registerForPush(); // token registered on login (ADR-005)

        router.replace(user.role === 'FARMER' ? '/(farmer)/home' : '/(transporter)/home');
      } catch {
        // one silent refresh already happened inside api.ts; this means sign in again
        await clearSession();
        router.replace('/(auth)/welcome');
      }
    })();
  }, []);

  return (
    <Screen scroll={false}>
      <Loading label="Opening KisanPool…" />
    </Screen>
  );
}
