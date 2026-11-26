// Dynamic config on top of app.json (Expo passes app.json in as `config`; everything there still applies).
// It only adds the Android Google Maps key (D-004, D-025) from the build environment, so the key never
// lives in git. Set GOOGLE_MAPS_ANDROID_API_KEY as an EAS environment variable (docs/TEST_BUILDS.md).
// Without a key the build still works: MapCanvas shows a "map unavailable" panel on Android instead of
// crashing (react-native-maps needs a key on Android).
const withAndroidMapsKey = require('../../tools/expo/with-android-maps-key');

module.exports = ({ config }) => withAndroidMapsKey(config, process.env.GOOGLE_MAPS_ANDROID_API_KEY);
