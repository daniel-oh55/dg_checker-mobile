import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { sanitizeUnDigits } from '../ui/segregation-presentation';
import { palette, radius, spacing, typography } from '../ui/theme';

const MIN_COUNT = 2;
const MAX_COUNT = 10;

interface UnInputGridProps {
  inputCount: number;
  unInputs: string[];
  onChangeInput: (index: number, value: string) => void;
  onChangeCount: (count: number) => void;
  /** Active slot indexes to outline as invalid. Presentation only — the submit
   * gate is decided by the caller's existing validation. */
  errorIndexes?: readonly number[];
}

export function UnInputGrid({
  inputCount,
  unInputs,
  onChangeInput,
  onChangeCount,
  errorIndexes = [],
}: UnInputGridProps) {
  const activeIndexes = Array.from({ length: inputCount }, (_, index) => index);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const atMin = inputCount <= MIN_COUNT;
  const atMax = inputCount >= MAX_COUNT;

  return (
    <View>
      <View style={styles.stepperRow}>
        <View style={styles.stepperLabelBlock}>
          <Text style={styles.stepperLabelKo}>화물 수</Text>
          <Text style={styles.stepperLabelEn}>Number of DGs</Text>
        </View>

        <View style={styles.stepperControl}>
          <Pressable
            style={({ pressed }) => [
              styles.stepperButton,
              pressed && !atMin && styles.stepperButtonPressed,
            ]}
            onPress={() => onChangeCount(Math.max(MIN_COUNT, inputCount - 1))}
            disabled={atMin}
            accessibilityRole="button"
            accessibilityState={{ disabled: atMin }}
            accessibilityLabel="화물 수 줄이기 / Decrease number of DGs"
          >
            <Text style={[styles.stepperGlyph, atMin && styles.stepperGlyphDisabled]}>−</Text>
          </Pressable>

          <View style={styles.stepperDivider} />
          <Text style={styles.stepperCount}>{inputCount}</Text>
          <View style={styles.stepperDivider} />

          <Pressable
            style={({ pressed }) => [
              styles.stepperButton,
              pressed && !atMax && styles.stepperButtonPressed,
            ]}
            onPress={() => onChangeCount(Math.min(MAX_COUNT, inputCount + 1))}
            disabled={atMax}
            accessibilityRole="button"
            accessibilityState={{ disabled: atMax }}
            accessibilityLabel="화물 수 늘리기 / Increase number of DGs"
          >
            <Text style={[styles.stepperGlyph, atMax && styles.stepperGlyphDisabled]}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.grid}>
        {activeIndexes.map((index) => {
          const value = unInputs[index] ?? '';
          const focused = focusedIndex === index;
          const invalid = errorIndexes.includes(index);

          return (
            <View key={index} style={styles.cell}>
              <Text style={styles.cellLabel}>UN {index + 1}</Text>
              <View
                style={[
                  styles.inputShell,
                  focused && styles.inputShellFocused,
                  invalid && styles.inputShellInvalid,
                ]}
              >
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={(text) => onChangeInput(index, sanitizeUnDigits(text))}
                  onFocus={() => setFocusedIndex(index)}
                  onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
                  placeholder="e.g. 1993"
                  placeholderTextColor={palette.textTertiary}
                  keyboardType="number-pad"
                  maxLength={4}
                  accessibilityLabel={`UN 번호 ${index + 1} 입력 / UN number ${index + 1} input`}
                />
                {value.length > 0 && (
                  <Pressable
                    onPress={() => onChangeInput(index, '')}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`UN 번호 ${index + 1} 지우기 / Clear UN number ${index + 1}`}
                    style={styles.clearButton}
                  >
                    <Text style={styles.clearGlyph}>×</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  stepperLabelBlock: {
    flexShrink: 1,
  },
  stepperLabelKo: {
    ...typography.labelKo,
    color: palette.textPrimary,
  },
  stepperLabelEn: {
    ...typography.captionEn,
    color: palette.textSecondary,
    marginTop: 1,
  },
  // One cohesive control: two tap zones and the value share a single tinted
  // track, rather than two isolated square buttons.
  stepperControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.backgroundCool,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  stepperButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  stepperButtonPressed: {
    backgroundColor: palette.brandBlueSoft,
  },
  stepperGlyph: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    color: palette.brandBlue,
  },
  stepperGlyphDisabled: {
    color: palette.disabledText,
    opacity: 0.55,
  },
  stepperDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: palette.border,
  },
  stepperCount: {
    minWidth: 40,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: palette.navy,
    fontVariant: ['tabular-nums'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs - 2,
  },
  cell: {
    width: '50%',
    paddingHorizontal: spacing.xs + 2,
    marginBottom: spacing.md,
  },
  cellLabel: {
    ...typography.captionKo,
    color: palette.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.inputSurface,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    paddingRight: 6,
    minHeight: 50,
  },
  inputShellFocused: {
    borderColor: palette.brandBlue,
    backgroundColor: palette.surface,
  },
  inputShellInvalid: {
    borderColor: palette.errorAccent,
    backgroundColor: palette.errorSurface,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: palette.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  clearButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.backgroundCool,
  },
  clearGlyph: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '600',
    color: palette.textSecondary,
  },
});
