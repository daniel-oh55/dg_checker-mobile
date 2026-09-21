import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { palette, radius, shadow, spacing } from '../ui/theme';

interface AppCardProps {
  children: ReactNode;
  style?: ViewStyle;
}

/**
 * The one white surface used across the app. A single broad, faint shadow plus
 * a hairline border — enough to lift the card off the warm ground without the
 * heavy outlined-box look, and never nested inside another AppCard.
 */
export function AppCard({ children, style }: AppCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.xl,
    ...shadow.card,
  },
});
