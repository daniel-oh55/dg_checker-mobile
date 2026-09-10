import { StyleSheet, Text, View } from 'react-native';
import type { SegregationBatchPairResult } from '../api/segregation';
import {
  additionalRequirementText,
  pairStatusText,
  palette,
  variantResolutionNote,
} from '../ui/segregation-presentation';

interface PairResultCardProps {
  pair: SegregationBatchPairResult;
}

const statusStyles = {
  CLEAR: { border: palette.clearBorder, bg: palette.clearBg, text: palette.clearText },
  SEGREGATION_REQUIRED: {
    border: palette.segregationBorder,
    bg: palette.segregationBg,
    text: palette.segregationText,
  },
  REVIEW_REQUIRED: { border: palette.reviewBorder, bg: palette.reviewBg, text: palette.reviewText },
} as const;

export function PairResultCard({ pair }: PairResultCardProps) {
  const status = pair.decision.status;
  const statusText = pairStatusText(status, pair.decision.level);
  const colors = statusStyles[status];
  const hasAdditionalRequirements = pair.additionalRequirements.length > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.pairTitle}>
        UN {pair.leftUnNumber} ↔ UN {pair.rightUnNumber}
      </Text>

      <View style={[styles.statusBlock, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <Text style={[styles.statusKo, { color: colors.text }]}>{statusText.ko}</Text>
        <Text style={[styles.statusEn, { color: colors.text }]}>{statusText.en}</Text>
      </View>

      {pair.variantResolution === 'STRICTEST_OF_MULTIPLE_VARIANTS' && (
        <Text style={styles.variantNote}>
          {variantResolutionNote.ko} / {variantResolutionNote.en}
        </Text>
      )}

      <View style={styles.reasonBlock}>
        <Text style={styles.reasonLabel}>판정 상세 / Decision detail</Text>
        <Text style={styles.reasonText}>{pair.decision.reason}</Text>
      </View>

      {hasAdditionalRequirements && (
        <View style={styles.additionalBlock}>
          <Text style={styles.additionalHeaderKo}>{additionalRequirementText.header.ko}</Text>
          <Text style={styles.additionalHeaderEn}>{additionalRequirementText.header.en}</Text>
          <Text style={styles.additionalFooter}>
            {additionalRequirementText.footer.ko} / {additionalRequirementText.footer.en}
          </Text>
        </View>
      )}
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
  pairTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.navy,
    marginBottom: 8,
  },
  statusBlock: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  statusKo: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusEn: {
    fontSize: 12,
    marginTop: 2,
  },
  variantNote: {
    fontSize: 11,
    color: palette.textSecondary,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  reasonBlock: {
    marginBottom: 4,
  },
  reasonLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: palette.textSecondary,
    marginBottom: 2,
  },
  reasonText: {
    fontSize: 13,
    color: palette.textPrimary,
  },
  additionalBlock: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: palette.additionalBorder,
    backgroundColor: palette.additionalBg,
    borderRadius: 8,
    padding: 10,
  },
  additionalHeaderKo: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.additionalText,
  },
  additionalHeaderEn: {
    fontSize: 11,
    color: palette.additionalText,
    marginBottom: 6,
  },
  additionalFooter: {
    fontSize: 11,
    color: palette.additionalText,
  },
});
