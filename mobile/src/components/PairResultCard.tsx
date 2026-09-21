import { StyleSheet, Text, View } from 'react-native';
import type { SegregationBatchPairResult } from '../api/segregation';
import {
  additionalRequirementText,
  additionalTone,
  pairStatusText,
  pairStatusTone,
  variantResolutionNote,
} from '../ui/segregation-presentation';
import { palette, radius, spacing, typography } from '../ui/theme';
import { AppCard } from './AppCard';
import { StatusPanel } from './StatusPanel';

interface PairResultCardProps {
  pair: SegregationBatchPairResult;
}

export function PairResultCard({ pair }: PairResultCardProps) {
  const status = pair.decision.status;
  const statusText = pairStatusText(status, pair.decision.level);
  const tone = pairStatusTone(status);
  const hasAdditionalRequirements = pair.additionalRequirements.length > 0;

  return (
    <AppCard style={styles.card}>
      <View style={styles.pairRow}>
        <Text style={styles.pairUn}>UN {pair.leftUnNumber}</Text>
        <Text style={styles.pairGlyph}>↔</Text>
        <Text style={styles.pairUn}>UN {pair.rightUnNumber}</Text>
      </View>

      <StatusPanel tone={tone} ko={statusText.ko} en={statusText.en} style={styles.status} />

      {pair.variantResolution === 'STRICTEST_OF_MULTIPLE_VARIANTS' && (
        <Text style={styles.variantNote}>
          {variantResolutionNote.ko} / {variantResolutionNote.en}
        </Text>
      )}

      {hasAdditionalRequirements && (
        <View style={styles.additionalBlock}>
          <Text style={styles.additionalHeaderKo}>{additionalRequirementText.header.ko}</Text>
          <Text style={styles.additionalHeaderEn}>{additionalRequirementText.header.en}</Text>
          <Text style={styles.additionalFooter}>
            {additionalRequirementText.footer.ko} / {additionalRequirementText.footer.en}
          </Text>
        </View>
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pairUn: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.navy,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  pairGlyph: {
    fontSize: 15,
    color: palette.textTertiary,
  },
  status: {
    marginBottom: 0,
  },
  variantNote: {
    ...typography.captionEn,
    color: palette.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm + 2,
  },
  additionalBlock: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: additionalTone.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: additionalTone.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  additionalHeaderKo: {
    fontSize: 13,
    fontWeight: '700',
    color: additionalTone.text,
  },
  additionalHeaderEn: {
    ...typography.captionEn,
    color: additionalTone.text,
    opacity: 0.85,
    marginTop: 1,
    marginBottom: spacing.sm,
  },
  additionalFooter: {
    ...typography.captionEn,
    color: additionalTone.text,
    lineHeight: 16,
  },
});
