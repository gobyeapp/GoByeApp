// Per-weight imports so only the four weights GoBye uses are bundled (the package root pulls in all 18).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import { ToastProvider, useTheme } from '@gobye/ui';
import { AccountProvider, useAccount } from '@/state/account';
import { BookingProvider } from '@/state/booking';
import { ServiceConfigProvider } from '@/state/config';
import { WalletProvider } from '@/state/wallet';
import { LocationProvider } from '@/state/location';
import { ServicesProvider } from '@/state/services';
import { SessionProvider, useSession } from '@/state/session';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ServicesProvider>
          <ServiceConfigProvider>
            <WalletProvider>
              <SessionProvider>
                <AccountProvider>
                  <LocationProvider>
                      <BookingProvider>
                        <ToastProvider>
                          <AppStack />
                        </ToastProvider>
                      </BookingProvider>
                  </LocationProvider>
                </AccountProvider>
              </SessionProvider>
            </WalletProvider>
          </ServiceConfigProvider>
        </ServicesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppStack() {
  const { colors, scheme } = useTheme();
  const { status } = useSession();
  const { ready } = useAccount();

  // Keep the splash up until the saved Light/Dark/System choice has been applied, so the first frame
  // is never drawn in the wrong theme.
  useEffect(() => {
    if (status !== 'loading' && ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [status, ready]);

  // Root view / Android navigation bar follow the theme (white or black), not a brand colour.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const modal = Platform.OS === 'ios' ? ('modal' as const) : ('card' as const);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="permission-location" options={{ presentation: modal, gestureEnabled: false }} />
        <Stack.Screen name="booking/search" options={{ presentation: modal }} />
        <Stack.Screen name="booking/pickup-map" />
        <Stack.Screen name="booking/searching" options={{ gestureEnabled: false }} />
        <Stack.Screen name="trip" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="trip-complete" options={{ gestureEnabled: false }} />
        <Stack.Screen name="trip-paid" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="trip-summary" options={{ gestureEnabled: false }} />
        <Stack.Screen name="rate/[id]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="promo/[id]" />
      </Stack>
    </>
  );
}
