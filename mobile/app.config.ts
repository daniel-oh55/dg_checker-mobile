import type { ExpoConfig } from 'expo/config';

/**
 * EAS Build sets EAS_BUILD_PROFILE to the active build profile name during a
 * cloud build. Anywhere else (local `expo start`, a developer's own
 * `eas build --profile preview`, CI typechecking) it is unset, so this
 * defaults to the non-production branch — a developer or preview build can
 * never accidentally end up wired to production AdMob IDs.
 */
const isProductionBuild = process.env.EAS_BUILD_PROFILE === 'production';

/** Google's official shared test AdMob Android App ID — safe for any non-production build. */
const GOOGLE_TEST_ANDROID_ADMOB_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

function resolveAndroidAdMobAppId(): string {
  if (!isProductionBuild) {
    return GOOGLE_TEST_ANDROID_ADMOB_APP_ID;
  }
  const appId = process.env.ADMOB_ANDROID_APP_ID;
  if (!appId) {
    throw new Error(
      'ADMOB_ANDROID_APP_ID is required for a production build. Set it in the EAS ' +
        '"production" environment before building — see docs/ANDROID_RELEASE.md.',
    );
  }
  return appId;
}

/** Fails the production build outright rather than silently shipping a Google test ad unit. */
function assertProductionBannerAdUnitConfigured(): void {
  if (!isProductionBuild) return;
  if (!process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID) {
    throw new Error(
      'EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID is required for a production build — ' +
        'see docs/ANDROID_RELEASE.md.',
    );
  }
}

/** Google Play requires a public HTTPS privacy-policy URL before a production submission. */
function assertProductionPrivacyPolicyUrlConfigured(): void {
  if (!isProductionBuild) return;
  const url = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
  if (!url || !url.startsWith('https://')) {
    throw new Error(
      'EXPO_PUBLIC_PRIVACY_POLICY_URL (a valid HTTPS URL) is required for a production build — ' +
        'see docs/ANDROID_RELEASE.md.',
    );
  }
}

assertProductionBannerAdUnitConfigured();
assertProductionPrivacyPolicyUrlConfigured();

const config: ExpoConfig = {
  name: 'DG Segregation',
  slug: 'dg-segregation-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'dgsegregation',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
  },
  android: {
    package: 'com.hymlounge.segregationchecker',
    versionCode: 1,
    permissions: ['android.permission.INTERNET'],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    apiBaseUrl: 'https://dg-segregation-api.baseballmeng.workers.dev',
    // Read at runtime by src/ads/config.ts to pick test vs. production ad units —
    // the same signal that gates the native AdMob App ID above, so both are
    // always consistent for a given build.
    adsEnvironment: isProductionBuild ? 'production' : 'test',
    eas: {
      projectId: 'c2510915-c1d8-4742-89f1-435d4663ef09',
    },
  },
  owner: 'ollele',
  plugins: [
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: resolveAndroidAdMobAppId(),
        // Google Mobile Ads native app measurement must not start before UMP
        // consent has been gathered — see docs/ANDROID_RELEASE.md.
        delayAppMeasurementInit: true,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Required by the UMP SDK bundled with react-native-google-mobile-ads —
          // see docs/ANDROID_RELEASE.md.
          extraProguardRules: '-keep class com.google.android.gms.internal.consent_sdk.** { *; }',
        },
      },
    ],
  ],
};

export default config;
