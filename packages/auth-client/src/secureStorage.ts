import type { SecureStoreLike } from './types';

/** expo-secure-store values should stay under about 2 KB; a Supabase session is larger, so it is split. */
export const CHUNK = 1800;

/**
 * Supabase session storage on the device's Keychain / Keystore (WP2). The session is split into chunks
 * `<key>.0`, `<key>.1`, … with the count at `<key>.n`, so nothing sensitive goes into AsyncStorage.
 */
export function chunkedSecureStorage(store: SecureStoreLike) {
  const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');
  return {
    async getItem(key: string): Promise<string | null> {
      const k = safe(key);
      const n = Number(await store.getItemAsync(`${k}.n`));
      if (!n) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(`${k}.${i}`);
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      const k = safe(key);
      const old = Number(await store.getItemAsync(`${k}.n`)) || 0;
      const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
      for (let i = 0; i < parts.length; i++) await store.setItemAsync(`${k}.${i}`, parts[i]!);
      await store.setItemAsync(`${k}.n`, String(parts.length));
      for (let i = parts.length; i < old; i++) await store.deleteItemAsync(`${k}.${i}`);
    },
    async removeItem(key: string): Promise<void> {
      const k = safe(key);
      const n = Number(await store.getItemAsync(`${k}.n`)) || 0;
      for (let i = 0; i < n; i++) await store.deleteItemAsync(`${k}.${i}`);
      await store.deleteItemAsync(`${k}.n`);
    },
  };
}
