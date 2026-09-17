import { StyleSheet, Text, View } from 'react-native';
import type { DgSummary, DgSummaryProfile } from '../api/segregation';
import {
  multipleProfilesText,
  palette,
  presentPrimaryClass,
  presentSubsidiaryRisks,
  psnUnavailableText,
} from '../ui/segregation-presentation';

interface DgSummaryCardProps {
  summary: DgSummary;
}

export function DgSummaryCard({ summary }: DgSummaryCardProps) {
  const { profiles } = summary;
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
        <Text style={styles.attributeValue}>{presentPrimaryClass(profile.primaryClass)}</Text>
      </View>
      <View style={styles.attributeRow}>
        <Text style={styles.attributeLabel}>Sub Risk</Text>
        <Text style={styles.attributeValue}>{presentSubsidiaryRisks(profile.subsidiaryRisks)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    marginBottom: 12,
    shadowColor: palette.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
    fontSize: 15,
    fontWeight: '700',
    color: palette.navy,
    marginBottom: 8,
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
});
