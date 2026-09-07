import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, sanitizeUnDigits } from '../ui/segregation-presentation';

const MIN_COUNT = 2;
const MAX_COUNT = 10;

interface UnInputGridProps {
  inputCount: number;
  unInputs: string[];
  onChangeInput: (index: number, value: string) => void;
  onChangeCount: (count: number) => void;
}

export function UnInputGrid({ inputCount, unInputs, onChangeInput, onChangeCount }: UnInputGridProps) {
  const activeIndexes = Array.from({ length: inputCount }, (_, index) => index);

  return (
    <View>
      <View style={styles.stepperRow}>
        <Text style={styles.stepperLabel}>화물 수 / Number of DGs</Text>
        <View style={styles.stepperControl}>
          <Pressable
            style={[styles.stepperButton, inputCount <= MIN_COUNT && styles.stepperButtonDisabled]}
            onPress={() => onChangeCount(Math.max(MIN_COUNT, inputCount - 1))}
            disabled={inputCount <= MIN_COUNT}
            accessibilityRole="button"
            accessibilityLabel="화물 수 줄이기 / Decrease number of DGs"
          >
            <Text style={styles.stepperButtonText}>−</Text>
          </Pressable>
          <Text style={styles.stepperCount}>{inputCount}</Text>
          <Pressable
            style={[styles.stepperButton, inputCount >= MAX_COUNT && styles.stepperButtonDisabled]}
            onPress={() => onChangeCount(Math.min(MAX_COUNT, inputCount + 1))}
            disabled={inputCount >= MAX_COUNT}
            accessibilityRole="button"
            accessibilityLabel="화물 수 늘리기 / Increase number of DGs"
          >
            <Text style={styles.stepperButtonText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.grid}>
        {activeIndexes.map((index) => (
          <View key={index} style={styles.cell}>
            <Text style={styles.cellLabel}>UN {index + 1}</Text>
            <TextInput
              style={styles.cellInput}
              value={unInputs[index] ?? ''}
              onChangeText={(text) => onChangeInput(index, sanitizeUnDigits(text))}
              placeholder="1002"
              placeholderTextColor="#9AA7B4"
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel={`UN 번호 ${index + 1} 입력 / UN number ${index + 1} input`}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.navy,
    flexShrink: 1,
    paddingRight: 12,
  },
  stepperControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    backgroundColor: palette.primaryDisabled,
  },
  stepperButtonText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
  stepperCount: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: palette.navy,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  cell: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  cellLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
    marginBottom: 6,
  },
  cellInput: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: palette.textPrimary,
    backgroundColor: palette.card,
  },
});
