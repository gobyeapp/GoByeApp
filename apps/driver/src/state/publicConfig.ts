import { describeConfigProblems, parsePublicConfig, type PublicConfig } from '@gobye/core';

/**
 * Public configuration for this build (D-051): environment, the stable API / realtime / media
 * addresses and whether simulated services are on. Only EXPO_PUBLIC_* values can be read here, and
 * anything that looks like a secret makes the build's configuration invalid (secrets live on servers).
 *
 * Not wired into screens yet: no backend exists, so every service is still simulated
 * (docs/ENVIRONMENT_CONFIGURATION.md). Expo inlines each process.env.EXPO_PUBLIC_* reference at build
 * time, so they are listed one by one.
 */
const raw: Record<string, string | undefined> = {
  EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_REALTIME_URL: process.env.EXPO_PUBLIC_REALTIME_URL,
  EXPO_PUBLIC_MEDIA_BASE_URL: process.env.EXPO_PUBLIC_MEDIA_BASE_URL,
  EXPO_PUBLIC_USE_MOCKS: process.env.EXPO_PUBLIC_USE_MOCKS,
  EXPO_PUBLIC_DEMO_RELAY_URL: process.env.EXPO_PUBLIC_DEMO_RELAY_URL,
};

const parsed = parsePublicConfig(raw, 'expo');

/** Problems with this build's configuration (empty when valid). Shown in developer tools, logged at start. */
export const configProblems: string = parsed.ok ? '' : describeConfigProblems(parsed.error);

/**
 * The validated configuration, or a safe development fallback (simulated services, local addresses)
 * when it is invalid, so a bad .env never points the app at an unintended server.
 */
export const publicConfig: PublicConfig = parsed.ok
  ? parsed.value
  : { environment: 'development', apiBaseUrl: 'http://localhost:8787/v1', realtimeUrl: 'ws://localhost:8787/v1/realtime', mediaBaseUrl: 'http://localhost:8787/media', useMocks: true };
