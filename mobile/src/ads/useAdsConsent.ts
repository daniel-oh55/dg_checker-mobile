import { useEffect, useRef, useState } from 'react';
import { AdsConsent, AdsConsentPrivacyOptionsRequirementStatus, MobileAds } from 'react-native-google-mobile-ads';

export interface AdsConsentState {
  /** Whether ads may currently be requested, per the last known UMP consent state. */
  canRequestAds: boolean;
  /** Whether a persistent "Privacy choices" entry point must be shown. */
  privacyOptionsRequired: boolean;
}

const initialState: AdsConsentState = { canRequestAds: false, privacyOptionsRequired: false };

/**
 * Gathers UMP consent on every app launch and initializes Mobile Ads only once
 * ads may actually be requested. Never throws: any consent/network failure
 * leaves ads simply unavailable rather than blocking the DG segregation
 * checker, which must keep working regardless of ad/consent state.
 */
export function useAdsConsent(): AdsConsentState {
  const [state, setState] = useState<AdsConsentState>(initialState);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function gatherConsentAndInitialize() {
      try {
        await AdsConsent.requestInfoUpdate();
        const consentInfo = await AdsConsent.loadAndShowConsentFormIfRequired();

        if (cancelled) return;

        if (consentInfo.canRequestAds && !initializedRef.current) {
          initializedRef.current = true;
          await MobileAds().initialize();
        }

        if (!cancelled) {
          setState({
            canRequestAds: consentInfo.canRequestAds,
            privacyOptionsRequired:
              consentInfo.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
          });
        }
      } catch {
        if (!cancelled) {
          setState(initialState);
        }
      }
    }

    gatherConsentAndInitialize();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
