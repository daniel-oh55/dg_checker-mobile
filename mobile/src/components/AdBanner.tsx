import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { resolveBannerAdUnitId } from '../ads/config';
import { palette } from '../ui/segregation-presentation';

interface AdBannerProps {
  canRequestAds: boolean;
}

/**
 * Anchored adaptive banner only (no interstitial/rewarded/app-open/native).
 * Renders as a normal flex sibling below the scrollable content rather than
 * an overlay, so it can never cover input controls, the check button, result
 * cards, or the keyboard — and simply disappears if ads aren't available.
 * The caller is responsible for bottom-safe-area padding, which must apply
 * whether or not an ad is actually showing.
 */
export function AdBanner({ canRequestAds }: AdBannerProps) {
  const [failedToLoad, setFailedToLoad] = useState(false);

  if (!canRequestAds || failedToLoad) {
    return null;
  }

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={resolveBannerAdUnitId()}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailedToLoad(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: palette.background,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
});
