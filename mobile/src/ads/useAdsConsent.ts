import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  MobileAds,
  type AdsConsentInfo,
} from 'react-native-google-mobile-ads';

export interface AdsConsentState {
  /** Whether ads may currently be requested, per the last known UMP consent state. */
  canRequestAds: boolean;
  /** Whether a persistent "Privacy choices" entry point must be shown. */
  privacyOptionsRequired: boolean;
  /** Opens the UMP privacy-options form, then re-syncs consent state from it. */
  showPrivacyOptions: () => Promise<void>;
}

interface ConsentSnapshot {
  canRequestAds: boolean;
  privacyOptionsRequired: boolean;
}

const initialSnapshot: ConsentSnapshot = { canRequestAds: false, privacyOptionsRequired: false };

function toSnapshot(consentInfo: AdsConsentInfo): ConsentSnapshot {
  return {
    canRequestAds: consentInfo.canRequestAds,
    privacyOptionsRequired:
      consentInfo.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  };
}

/**
 * Gathers UMP consent on every app launch and initializes Mobile Ads only once
 * ads may actually be requested. Never throws: any consent/network failure
 * falls back to the UMP SDK's previous-session state (failing closed if even
 * that is unavailable) rather than blocking the DG segregation checker, which
 * must keep working regardless of ad/consent state.
 */
export function useAdsConsent(): AdsConsentState {
  const [state, setState] = useState<ConsentSnapshot>(initialSnapshot);
  const initializedRef = useRef(false);
  const cancelledRef = useRef(false);

  /**
   * Single source of truth for applying the UMP SDK's current consent state:
   * reads it fresh from getConsentInfo() (which reflects both a just-gathered
   * update and whatever the SDK persisted from a previous session), lazily
   * initializes Mobile Ads the first time ads become requestable, and pushes
   * the result into state. Swallows its own errors so callers never need to.
   */
  const syncConsentState = useCallback(async (): Promise<ConsentSnapshot | null> => {
    try {
      const consentInfo = await AdsConsent.getConsentInfo();
      if (cancelledRef.current) return null;

      if (consentInfo.canRequestAds && !initializedRef.current) {
        initializedRef.current = true;
        try {
          await MobileAds().initialize();
        } catch {
          // Non-fatal — the banner simply won't have ads to show.
        }
      }

      const snapshot = toSnapshot(consentInfo);
      if (!cancelledRef.current) {
        setState(snapshot);
      }
      return snapshot;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    async function gatherConsentAndInitialize() {
      try {
        await AdsConsent.requestInfoUpdate();
        await AdsConsent.loadAndShowConsentFormIfRequired();
        await syncConsentState();
      } catch {
        // requestInfoUpdate/consent-form gathering failed (e.g. no network).
        // Fall back to the UMP SDK's previous-session state rather than
        // assuming consent was never obtained.
        const fallback = await syncConsentState();
        if (fallback === null && !cancelledRef.current) {
          // getConsentInfo() failed too — fail closed.
          setState(initialSnapshot);
        }
      }
    }

    gatherConsentAndInitialize();

    return () => {
      cancelledRef.current = true;
    };
  }, [syncConsentState]);

  const showPrivacyOptions = useCallback(async () => {
    try {
      await AdsConsent.showPrivacyOptionsForm();
    } catch {
      // Non-fatal — the entry point stays a no-op if the form can't be shown.
    }
    await syncConsentState();
  }, [syncConsentState]);

  return { ...state, showPrivacyOptions };
}
