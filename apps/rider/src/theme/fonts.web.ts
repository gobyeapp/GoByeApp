/**
 * Inter for the web build: Latin-subset WOFF2 files in public/fonts (about 30 KB each instead of 340 KB TTFs;
 * made with fonttools pyftsubset from @expo-google-fonts/inter, OFL). The page shows straight away in the
 * system font and switches to Inter when it arrives, instead of staying blank while fonts download.
 */
export const INTER_FONTS = {
  Inter_400Regular: '/fonts/Inter_400Regular.woff2',
  Inter_500Medium: '/fonts/Inter_500Medium.woff2',
  Inter_600SemiBold: '/fonts/Inter_600SemiBold.woff2',
  Inter_700Bold: '/fonts/Inter_700Bold.woff2',
};

export const WAIT_FOR_FONTS = false;
