import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { createApiClient, type AuthService } from '@gobye/core';
import { chunkedSecureStorage, createAccountsApi, createSupabaseAuth, createSupabaseAuthService, currentAccessToken, type DeviceInfo, type SupabaseAuthLike } from '@gobye/auth-client';
import { publicConfig } from './publicConfig';

const INSTALL_ID_KEY = 'gobye.installId';

/** A random id for this install, so the account's device list can tell phones apart (not a tracking id). */
async function device(): Promise<DeviceInfo | undefined> {
  try {
    let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(INSTALL_ID_KEY, id);
    }
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
    return { installId: id, platform, appVersion: Constants.expoConfig?.version };
  } catch {
    return undefined;
  }
}

/** Browser storage for the web test build (expo-secure-store has no web version). */
const webStorage = {
  getItem: (k: string) => AsyncStorage.getItem(k),
  setItem: (k: string, v: string) => AsyncStorage.setItem(k, v),
  removeItem: (k: string) => AsyncStorage.removeItem(k),
};

function build(): { service: AuthService; auth: SupabaseAuthLike } | null {
  if (publicConfig.auth !== 'supabase' || !publicConfig.supabase) return null;
  const sb = createSupabaseAuth({ ...publicConfig.supabase, storage: Platform.OS === 'web' ? webStorage : chunkedSecureStorage(SecureStore) });
  // Refresh the session only while the app is open (Supabase's advice for React Native).
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (s) => (s === 'active' ? sb.startAutoRefresh() : sb.stopAutoRefresh()));
    sb.startAutoRefresh();
  }
  const accounts = publicConfig.accountsApi
    ? createAccountsApi(createApiClient({ baseUrl: publicConfig.apiBaseUrl, getToken: () => currentAccessToken(sb.auth), client: `rider/${Constants.expoConfig?.version ?? '0'}` }))
    : undefined;
  return { service: createSupabaseAuthService({ auth: sb.auth, role: 'rider', accounts, device }), auth: sb.auth };
}

/**
 * Real sign-in (Backend Phase 2, WP2, D-078) when EXPO_PUBLIC_AUTH=supabase; null keeps the generated
 * accounts. Only sign-in is real: trips, payments and the rest stay simulated until their APIs exist.
 */
export const realAuth = build();

/** With real sign-in, whether Supabase still holds a session (it may have expired or been revoked). */
export async function hasRealSession(): Promise<boolean> {
  if (!realAuth) return true;
  return !!(await currentAccessToken(realAuth.auth).catch(() => null));
}
