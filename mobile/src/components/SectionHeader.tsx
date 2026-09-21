import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../ui/theme';

interface SectionHeaderProps {
  ko: string;
  en: string;
  /** Optional trailing count, e.g. the number of evaluated pairs. */
  trailing?: string;
}

/**
 * Section break inside the single scrolling workflow. Korean leads at section
 * weight; English sits under it as a smaller, uppercased label so the two
 * languages never compete for the same emphasis.
 */
export function SectionHeader({ ko, en, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.block}>
      <View style={styles.titleRow}>
        <Text style={styles.ko}>{ko}</Text>
        {trailing !== undefined && (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{trailing}</Text>
          </View>
        )}
      </View>
      <Text style={styles.en}>{en}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ko: {
    ...typography.sectionTitleKo,
    color: palette.navy,
    flexShrink: 1,
  },
  countPill: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: palette.brandBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.brandBlue,
  },
  en: {
    ...typography.sectionTitleEn,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});
