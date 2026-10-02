import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { StatusTone } from '../ui/segregation-presentation';
import { radius, spacing } from '../ui/theme';

interface StatusPanelProps {
  tone: StatusTone;
  ko: string;
  en: string;
  style?: ViewStyle;
  /** `lg` for the batch headline, `md` for an individual pair. */
  size?: 'md' | 'lg';
}

/**
 * The status surface shared by the batch headline and each pair result, so a
 * tone always means the same thing in both places.
 *
 * The tinted surface and the accent bar are reinforcement only — the Korean
 * sentence and its English second line state the outcome in full, so the panel
 * stays unambiguous without colour.
 */
export function StatusPanel({ tone, ko, en, style, size = 'md' }: StatusPanelProps) {
  return (
    <View
      style={[styles.panel, { backgroundColor: tone.surface, borderColor: tone.border }, style]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${ko} / ${en}`}
    >
      <View style={[styles.accentBar, { backgroundColor: tone.accent }]} />
      <View style={styles.content}>
        <Text style={[size === 'lg' ? styles.koLg : styles.koMd, { color: tone.text }]}>{ko}</Text>
        <Text style={[size === 'lg' ? styles.enLg : styles.enMd, { color: tone.text }]}>{en}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  accentBar: {
    width: 4,
  },
  content: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  koLg: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
  enLg: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
    opacity: 0.86,
  },
  koMd: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  enMd: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    opacity: 0.86,
  },
});
