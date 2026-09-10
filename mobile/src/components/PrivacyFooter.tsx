import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '../ui/segregation-presentation';

interface PrivacyFooterProps {
  privacyOptionsRequired: boolean;
  privacyPolicyUrl: string | null;
  onPrivacyOptionsPress: () => void;
}

/**
 * Small unobtrusive footer, not a Settings screen. The "Privacy choices"
 * action only appears when UMP reports it is required; the policy link only
 * appears when a public URL is configured (absent in dev/preview builds).
 * UMP state is owned by useAdsConsent — this component only triggers the
 * hook-provided action and renders whatever state it reports.
 */
export function PrivacyFooter({ privacyOptionsRequired, privacyPolicyUrl, onPrivacyOptionsPress }: PrivacyFooterProps) {
  if (!privacyOptionsRequired && !privacyPolicyUrl) {
    return null;
  }

  function handlePrivacyPolicy() {
    if (privacyPolicyUrl) {
      Linking.openURL(privacyPolicyUrl).catch(() => {});
    }
  }

  return (
    <View style={styles.row}>
      {privacyPolicyUrl && (
        <Pressable
          onPress={handlePrivacyPolicy}
          accessibilityRole="button"
          accessibilityLabel="개인정보처리방침 / Privacy Policy"
        >
          <Text style={styles.link}>개인정보처리방침 / Privacy Policy</Text>
        </Pressable>
      )}
      {privacyOptionsRequired && (
        <Pressable
          onPress={onPrivacyOptionsPress}
          accessibilityRole="button"
          accessibilityLabel="개인정보 설정 / Privacy choices"
        >
          <Text style={styles.link}>개인정보 설정 / Privacy choices</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  link: {
    fontSize: 11,
    color: palette.textSecondary,
    textDecorationLine: 'underline',
  },
});
