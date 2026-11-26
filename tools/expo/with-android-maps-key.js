// Shared by apps/rider/app.config.js and apps/driver/app.config.js.
// Adds the Google Maps key for Android to the Expo config when one is given, and records in `extra`
// whether the build has one (read by MapCanvas through expo-constants). The key itself is not copied
// into `extra`.

/**
 * @param {Record<string, any>} config the Expo config from app.json
 * @param {string | undefined} rawKey usually process.env.GOOGLE_MAPS_ANDROID_API_KEY
 */
function withAndroidMapsKey(config, rawKey) {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  const android = { ...(config.android ?? {}) };
  if (key) {
    android.config = { ...(android.config ?? {}), googleMaps: { ...(android.config?.googleMaps ?? {}), apiKey: key } };
  }
  return {
    ...config,
    android,
    extra: { ...(config.extra ?? {}), googleMapsAndroid: Boolean(key) },
  };
}

module.exports = withAndroidMapsKey;
