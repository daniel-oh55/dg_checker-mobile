import Constants from 'expo-constants';
import { TestIds } from 'react-native-google-mobile-ads';

/**
 * Set at build time in app.config.ts from EAS_BUILD_PROFILE, so the runtime
 * branch below always agrees with which native AdMob App ID the build was
 * compiled with — a preview build can never end up requesting production ads.
 */
const isProductionAdsEnvironment: boolean = Constants.expoConfig?.extra?.adsEnvironment === 'production';

/**
 * A production build fails at config time (see app.config.ts) if this is
 * missing, so the fallback below is unreachable in practice; it exists only
 * so a misconfiguration shows test ads instead of crashing the app.
 */
export function resolveBannerAdUnitId(): string {
  if (!isProductionAdsEnvironment) {
    return TestIds.ADAPTIVE_BANNER;
  }
  return process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID ?? TestIds.ADAPTIVE_BANNER;
}

export function resolvePrivacyPolicyUrl(): string | null {
  return process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? null;
}
