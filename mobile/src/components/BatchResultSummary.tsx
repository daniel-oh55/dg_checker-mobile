import { StyleSheet, Text, View } from 'react-native';
import type { SegregationBatchSummary } from '../api/segregation';
import { palette, summaryHeadline, summaryMetricLabels } from '../ui/segregation-presentation';

interface BatchResultSummaryProps {
  summary: SegregationBatchSummary;
}

export function BatchResultSummary({ summary }: BatchResultSummaryProps) {
  const headline = summaryHeadline(summary);

  const metrics: Array<{ label: { ko: string; en: string }; value: number }> = [
    { label: summaryMetricLabels.totalPairs, value: summary.totalPairs },
    { label: summaryMetricLabels.segregationRequired, value: summary.segregationRequiredPairs },
    { label: summaryMetricLabels.reviewRequired, value: summary.reviewRequiredPairs },
    { label: summaryMetricLabels.levelZero, value: summary.noSegregationLevelPairs },
    { label: summaryMetricLabels.additionalRequirement, value: summary.additionalRequirementPairs },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitleKo}>검사 결과</Text>
      <Text style={styles.sectionTitleEn}>Result Summary</Text>

      <View style={styles.headlineBlock}>
        <Text style={styles.headlineKo}>{headline.ko}</Text>
        <Text style={styles.headlineEn}>{headline.en}</Text>
      </View>

      <View style={styles.metricsGrid}>
        {metrics.map((metric) => (
          <View key={metric.label.en} style={styles.metricCell}>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricLabelKo}>{metric.label.ko}</Text>
            <Text style={styles.metricLabelEn}>{metric.label.en}</Text>
          </View>
        ))}
      </View>

      {summary.maxRequiredLevel !== null && (
        <View style={styles.highestLevelRow}>
          <View>
            <Text style={styles.highestLevelLabelKo}>{summaryMetricLabels.highestLevel.ko}</Text>
            <Text style={styles.highestLevelLabelEn}>{summaryMetricLabels.highestLevel.en}</Text>
          </View>
          <Text style={styles.highestLevelValue}>Level {summary.maxRequiredLevel}</Text>
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
    padding: 16,
    marginTop: 20,
  },
  sectionTitleKo: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.navy,
  },
  sectionTitleEn: {
    fontSize: 12,
    color: palette.textSecondary,
    marginBottom: 12,
  },
  headlineBlock: {
    backgroundColor: palette.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    marginBottom: 14,
  },
  headlineKo: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  headlineEn: {
    fontSize: 13,
    color: palette.textSecondary,
    marginTop: 2,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  metricCell: {
    width: '33.33%',
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: palette.navy,
  },
  metricLabelKo: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textPrimary,
    marginTop: 2,
  },
  metricLabelEn: {
    fontSize: 11,
    color: palette.textSecondary,
  },
  highestLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 12,
    marginTop: 4,
  },
  highestLevelLabelKo: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  highestLevelLabelEn: {
    fontSize: 11,
    color: palette.textSecondary,
  },
  highestLevelValue: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.navy,
  },
});
