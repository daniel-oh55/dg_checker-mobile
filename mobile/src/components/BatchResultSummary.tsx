import { StyleSheet, Text, View } from 'react-native';
import type { SegregationBatchSummary } from '../api/segregation';
import { segregationLevelLabel } from '../ui/segregation-levels';
import {
  summaryHeadline,
  summaryMetricAccents,
  summaryMetricLabels,
  summaryTone,
} from '../ui/segregation-presentation';
import { palette, radius, spacing, typography } from '../ui/theme';
import { AppCard } from './AppCard';
import { StatusPanel } from './StatusPanel';

interface BatchResultSummaryProps {
  summary: SegregationBatchSummary;
}

interface MetricTile {
  key: string;
  label: { ko: string; en: string };
  value: string;
  accent: { tint: string; ink: string };
}

export function BatchResultSummary({ summary }: BatchResultSummaryProps) {
  const headline = summaryHeadline(summary);
  const tone = summaryTone(summary);

  // Counts that qualify the headline. Total pairs and the highest level are the
  // two framing figures and sit in the strip above, not in this grid.
  const tiles: MetricTile[] = [
    {
      key: 'segregationRequired',
      label: summaryMetricLabels.segregationRequired,
      value: `${summary.segregationRequiredPairs}`,
      accent: summaryMetricAccents.segregationRequired,
    },
    {
      key: 'reviewRequired',
      label: summaryMetricLabels.reviewRequired,
      value: `${summary.reviewRequiredPairs}`,
      accent: summaryMetricAccents.reviewRequired,
    },
    {
      key: 'levelZero',
      label: summaryMetricLabels.levelZero,
      value: `${summary.noSegregationLevelPairs}`,
      accent: summaryMetricAccents.levelZero,
    },
    {
      key: 'additionalRequirement',
      label: summaryMetricLabels.additionalRequirement,
      value: `${summary.additionalRequirementPairs}`,
      accent: summaryMetricAccents.additionalRequirement,
    },
  ];

  return (
    <AppCard style={styles.card}>
      <Text style={styles.titleKo}>검사 결과</Text>
      <Text style={styles.titleEn}>Result Summary</Text>

      <StatusPanel tone={tone} ko={headline.ko} en={headline.en} size="lg" style={styles.headline} />

      <View style={styles.framingStrip}>
        <View style={styles.framingCell}>
          <Text style={styles.framingValue}>{summary.totalPairs}</Text>
          <Text style={styles.framingLabelKo}>{summaryMetricLabels.totalPairs.ko}</Text>
          <Text style={styles.framingLabelEn}>{summaryMetricLabels.totalPairs.en}</Text>
        </View>

        {summary.maxRequiredLevel !== null && (
          <>
            <View style={styles.framingDivider} />
            <View style={styles.framingCell}>
              <Text style={[styles.framingValue, { color: palette.brandBlue }]}>
                {segregationLevelLabel(summary.maxRequiredLevel, 'en')}
              </Text>
              <Text style={styles.framingLabelKo}>{summaryMetricLabels.highestLevel.ko}</Text>
              <Text style={styles.framingLabelEn}>{summaryMetricLabels.highestLevel.en}</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.key} style={styles.tileOuter}>
            <View style={styles.tile}>
              <View style={[styles.tileBadge, { backgroundColor: tile.accent.tint }]}>
                <Text style={[styles.tileValue, { color: tile.accent.ink }]}>{tile.value}</Text>
              </View>
              <View style={styles.tileLabels}>
                <Text style={styles.tileLabelKo}>{tile.label.ko}</Text>
                <Text style={styles.tileLabelEn}>{tile.label.en}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
  },
  titleKo: {
    ...typography.sectionTitleKo,
    color: palette.navy,
  },
  titleEn: {
    ...typography.sectionTitleEn,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  headline: {
    marginTop: spacing.lg,
  },
  framingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.backgroundCool,
    borderRadius: radius.lg,
  },
  framingCell: {
    flex: 1,
  },
  framingDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: palette.borderStrong,
    marginHorizontal: spacing.lg,
  },
  framingValue: {
    fontSize: 24,
    fontWeight: '700',
    color: palette.navy,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  framingLabelKo: {
    ...typography.captionKo,
    color: palette.textPrimary,
    marginTop: 3,
  },
  framingLabelEn: {
    ...typography.captionEn,
    color: palette.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs - 1,
    marginTop: spacing.md,
  },
  tileOuter: {
    width: '50%',
    paddingHorizontal: spacing.xs + 1,
    marginTop: spacing.sm + 2,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Accent lives in the badge behind the number only — the tile itself stays
  // on the card surface so no single metric outshouts the headline.
  tileBadge: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileValue: {
    fontSize: 19,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tileLabels: {
    flex: 1,
  },
  tileLabelKo: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  tileLabelEn: {
    ...typography.captionEn,
    color: palette.textSecondary,
    marginTop: 1,
  },
});
