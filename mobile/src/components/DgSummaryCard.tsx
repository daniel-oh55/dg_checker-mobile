import { StyleSheet, Text, View } from 'react-native';
import type { DgSummary, DgSummaryProfile } from '../api/segregation';
import {
  additionalTone,
  multipleProfilesText,
  presentPrimaryClass,
  presentSubsidiaryRisks,
  psnUnavailableText,
} from '../ui/segregation-presentation';
import { palette, radius, spacing, typography } from '../ui/theme';
import { AppCard } from './AppCard';

interface DgSummaryCardProps {
  summary: DgSummary;
}

export function DgSummaryCard({ summary }: DgSummaryCardProps) {
  const { profiles } = summary;
  const hasMultipleProfiles = profiles.length > 1;

  return (
    <AppCard style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.unNumber}>UN {summary.unNumber}</Text>
        {hasMultipleProfiles && (
          <View style={styles.multiBadge}>
            <Text style={styles.multiBadgeKo}>{multipleProfilesText.ko}</Text>
          </View>
        )}
      </View>

      {hasMultipleProfiles && <Text style={styles.multiNoteEn}>{multipleProfilesText.en}</Text>}

      {hasMultipleProfiles
        ? profiles.map((profile, index) => (
            <View key={index} style={styles.profileBlock}>
              <Text style={styles.profileLabel}>Profile {index + 1}</Text>
              <ProfileFields profile={profile} />
            </View>
          ))
        : profiles.map((profile, index) => <ProfileFields key={index} profile={profile} />)}
    </AppCard>
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

      <View style={styles.attributeStrip}>
        <View style={styles.attributeCell}>
          <Text style={styles.attributeLabel}>Class</Text>
          <Text style={styles.attributeValue}>{presentPrimaryClass(profile.primaryClass)}</Text>
        </View>
        <View style={styles.attributeDivider} />
        <View style={styles.attributeCell}>
          <Text style={styles.attributeLabel}>Sub Risk</Text>
          <Text style={styles.attributeValue}>{presentSubsidiaryRisks(profile.subsidiaryRisks)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  unNumber: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.navy,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  multiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: additionalTone.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: additionalTone.border,
  },
  multiBadgeKo: {
    fontSize: 11,
    fontWeight: '700',
    color: additionalTone.text,
  },
  multiNoteEn: {
    ...typography.captionEn,
    color: palette.textSecondary,
    marginTop: 3,
  },
  profileBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
  profileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  fieldsBlock: {
    marginTop: spacing.md,
  },
  // Long proper shipping names are common and must wrap freely rather than
  // truncate — the name is the operator's primary identification of the cargo.
  psnText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    color: palette.textPrimary,
    marginBottom: spacing.md,
  },
  psnUnavailableBlock: {
    backgroundColor: additionalTone.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: additionalTone.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  psnUnavailableKo: {
    fontSize: 13,
    fontWeight: '700',
    color: additionalTone.text,
  },
  psnUnavailableEn: {
    ...typography.captionEn,
    color: additionalTone.text,
    opacity: 0.85,
    marginTop: 1,
  },
  attributeStrip: {
    flexDirection: 'row',
    backgroundColor: palette.backgroundCool,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  attributeCell: {
    flex: 1,
  },
  attributeDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: palette.borderStrong,
    marginHorizontal: spacing.md,
  },
  attributeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attributeValue: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.textPrimary,
    marginTop: 3,
    lineHeight: 20,
  },
});
