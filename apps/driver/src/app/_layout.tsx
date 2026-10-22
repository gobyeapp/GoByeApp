// Per-weight imports so only the four weights GoBye uses are bundled.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider, useTheme } from '@gobye/ui';
import { RequestWatcher } from '@/features/requests/RequestWatcher';
import { DriverProvider, useDriver } from '@/state/driver';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider, useSettings } from '@/state/settings';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * GoBye Driver. Shares @gobye/core (rules, simulated services) and @gobye/ui (design system and the
 * building blocks first made for the rider app: sign-in steps, map, tab tray, settings groups).
 */
export default function DriverRoot() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <SessionProvider>
            <AccountScope />
          </SessionProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Driver data is stored per signed-in number, so a different account never sees another's application. */
function AccountScope() {
  const { phone } = useSession();
  const key = phone ?? 'signed-out';
  return (
    <DriverProvider key={key} accountKey={key}>
      <ToastProvider>
        <AppStack />
        <RequestWatcher />
      </ToastProvider>
    </DriverProvider>
  );
}

function AppStack() {
  const { colors, scheme } = useTheme();
  const { status } = useSession();
  const { ready } = useDriver();
  const settings = useSettings();

  useEffect(() => {
    if (status !== 'loading' && ready && settings.ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [status, ready, settings.ready]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const modal = Platform.OS === 'ios' ? ('modal' as const) : ('card' as const);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="permission-location" options={{ presentation: modal, gestureEnabled: false }} />
        <Stack.Screen name="access" options={{ presentation: modal }} />
        <Stack.Screen name="request/[id]" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="negotiation/[id]" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="trip" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="trip-complete" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </>
  );
}
