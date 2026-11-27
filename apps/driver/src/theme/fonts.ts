// Per-weight imports so only the four weights GoBye uses are bundled (the package root pulls in all 18).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

/** Inter for iOS and Android (TTF in the app). The web build uses fonts.web.ts. */
export const INTER_FONTS = { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold };

/** Phones wait for the fonts behind the splash screen (they load from the app, instantly). */
export const WAIT_FOR_FONTS = true;
