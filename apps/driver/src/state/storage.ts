import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * expo-secure-store has no web implementation. The web build exists only for responsive QA
 * (docs/RESPONSIVENESS_AUDIT.md), so there the simulated token falls back to browser storage.
 * Native builds always use the Keychain / Keystore.
 */
const WEB_QA = Platform.OS === 'web';

/**
 * Persistence helpers.
 * - Secrets (session token) → expo-secure-store (Keychain / Android Keystore).
 * - Non-sensitive app state → AsyncStorage. Never store tokens, full card data or location history here.
 * All failures are swallowed and reported as `null` so a storage problem never blocks the app.
 */

export const KEYS = {
  token: 'gobye.driver.token',
  session: 'gobye.driver.session',
  driver: 'gobye.driver.state',
  settings: 'gobye.driver.settings',
} as const;

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    if (value === null || value === undefined) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: state recovery will simply not be available.
  }
}

export async function readSecret(key: string): Promise<string | null> {
  try {
    if (WEB_QA) return await AsyncStorage.getItem(`secret.${key}`);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeSecret(key: string, value: string | null): Promise<void> {
  try {
    if (WEB_QA) {
      if (value === null) await AsyncStorage.removeItem(`secret.${key}`);
      else await AsyncStorage.setItem(`secret.${key}`, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Non-fatal.
  }
}

export async function clearAll(): Promise<void> {
  await Promise.all([
    writeSecret(KEYS.token, null),
    AsyncStorage.multiRemove([KEYS.session, KEYS.driver]).catch(() => undefined),
  ]);
}
