import { StyleSheet, Text, View } from 'react-native';
import type { DgSummary, DgSummaryProfile } from '../api/segregation';
import { multipleProfilesText, noneText, palette, psnUnavailableText } from '../ui/segregation-presentation';

interface DgSummaryCardProps {
  summary: DgSummary;
}

export function DgSummaryCard({ summary }: DgSummaryCardProps) {
  const { profiles, variantCount } = summary;
  const hasMultipleProfiles = profiles.length > 1;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>UN {summary.unNumber}</Text>

      {hasMultipleProfiles && (
        <View style={styles.multiHeaderBlock}>
          <Text style={styles.multiHeaderKo}>{multipleProfilesText.ko}</Text>
          <Text style={styles.multiHeaderEn}>{multipleProfilesText.en}</Text>
        </View>
      )}

      {hasMultipleProfiles
        ? profiles.map((profile, index) => (
            <View key={index} style={styles.profileBlock}>
              <Text style={styles.profileLabel}>Profile {index + 1}</Text>
              <ProfileFields profile={profile} />
            </View>
          ))
        : profiles.map((profile, index) => <ProfileFields key={index} profile={profile} />)}

      {variantCount > 1 && (
        <Text style={styles.variantMeta}>
          {variantCount !== profiles.length
            ? `${variantCount} variants · ${profiles.length} visible profiles`
            : `Dataset variants: ${variantCount}`}
        </Text>
      )}
    </View>
  );
}

function ProfileFields({ profile }: { profile: DgSummaryProfile }) {
  return (
    <View style={styles.fieldsBlock}>
      {profile.properShippingName === null ? (
        <View style={styles.psnUnavailableBlock}>
          <Text style={styles.psnUnavailableKo}>{psnUnavailableText.ko}</Text>
          <Text style={styles.psnUnavailableEn}>{psnUnavailableText.en}</Text>
        </View>
      ) : (
        <Text style={styles.psnText}>{profile.properShippingName}</Text>
      )}

      <View style={styles.attributeRow}>
        <Text style={styles.attributeLabel}>Class</Text>
        <Text style={styles.attributeValue}>{profile.primaryClass}</Text>
      </View>
      <View style={styles.attributeRow}>
        <Text style={styles.attributeLabel}>Sub Risk</Text>
        <Text style={styles.attributeValue}>
          {profile.subsidiaryRisks.length > 0 ? profile.subsidiaryRisks.join(', ') : `${noneText.ko} / ${noneText.en}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    marginBottom: 12,
  },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.navy,
    marginBottom: 8,
  },
  multiHeaderBlock: {
    marginBottom: 8,
  },
  multiHeaderKo: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  multiHeaderEn: {
    fontSize: 11,
    color: palette.textSecondary,
  },
  profileBlock: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 8,
    marginTop: 8,
  },
  profileLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.textSecondary,
    marginBottom: 4,
  },
  fieldsBlock: {
    marginBottom: 2,
  },
  psnText: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  psnUnavailableBlock: {
    backgroundColor: palette.additionalBg,
    borderWidth: 1,
    borderColor: palette.additionalBorder,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  psnUnavailableKo: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.additionalText,
  },
  psnUnavailableEn: {
    fontSize: 11,
    color: palette.additionalText,
  },
  attributeRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  attributeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
    width: 70,
  },
  attributeValue: {
    fontSize: 13,
    color: palette.textPrimary,
    flex: 1,
    flexWrap: 'wrap',
  },
  variantMeta: {
    fontSize: 11,
    color: palette.textSecondary,
    marginTop: 8,
  },
});
