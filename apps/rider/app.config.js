// Dynamic config on top of app.json (Expo passes app.json in as `config`; everything there still applies).
// It only adds the Android Google Maps key (D-004, D-025) from the build environment, so the key never
// lives in git. Set GOOGLE_MAPS_ANDROID_API_KEY as an EAS environment variable (docs/TEST_BUILDS.md).
// Without a key the build still works: MapCanvas shows a "map unavailable" panel on Android instead of
// crashing (react-native-maps needs a key on Android).
const withAndroidMapsKey = require('../../tools/expo/with-android-maps-key');

// Web only: each screen is its own file, loaded when first opened, so the browser version starts faster.
// Phones keep one bundle (the option is web-only in production anyway).
const withWebAsyncRoutes = (config) => ({
  ...config,
  plugins: (config.plugins ?? []).map((p) => (p === 'expo-router' ? ['expo-router', { asyncRoutes: { web: 'production', default: false } }] : p)),
});

module.exports = ({ config }) => withAndroidMapsKey(withWebAsyncRoutes(config), process.env.GOOGLE_MAPS_ANDROID_API_KEY);
