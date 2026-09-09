import { StatusBar } from 'expo-status-bar';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  checkSegregationBatch,
  SegregationCheckError,
  type SegregationBatchResult,
} from './src/api/segregation';
import { BatchResultSummary } from './src/components/BatchResultSummary';
import { DgSummaryCard } from './src/components/DgSummaryCard';
import { PairResultCard } from './src/components/PairResultCard';
import { UnInputGrid } from './src/components/UnInputGrid';
import {
  appHeaderText,
  type Bilingual,
  errorPresentation,
  operationalNote,
  palette,
  validateActiveInputs,
} from './src/ui/segregation-presentation';

const MAX_SLOTS = 10;

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [inputCount, setInputCount] = useState(2);
  const [unInputs, setUnInputs] = useState<string[]>(Array(MAX_SLOTS).fill(''));
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<{ message: Bilingual; unNumbers?: string[] } | null>(null);
  const [result, setResult] = useState<SegregationBatchResult | null>(null);

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const activeInputs = unInputs.slice(0, inputCount);
  const allEmpty = activeInputs.every((value) => value.trim().length === 0);
  const validationMessage = allEmpty ? null : validateActiveInputs(activeInputs);
  const canSubmit = !allEmpty && !validationMessage && !loading;

  function invalidateResult() {
    setResult(null);
    setErrorState(null);
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeq.current += 1;
    setLoading(false);
  }

  function handleChangeInput(index: number, value: string) {
    setUnInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    invalidateResult();
  }

  function handleChangeCount(count: number) {
    setInputCount(count);
    invalidateResult();
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    Keyboard.dismiss();
    setResult(null);
    setErrorState(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const batchResult = await checkSegregationBatch(activeInputs, controller.signal);
      if (requestSeq.current !== seq) return;
      setResult(batchResult);
    } catch (error) {
      if (requestSeq.current !== seq) return;
      if (error instanceof Error && error.name === 'AbortError') return;

      if (error instanceof SegregationCheckError) {
        setErrorState(errorPresentation(error));
      } else {
        setErrorState({ message: { ko: '검사를 완료할 수 없습니다. 다시 시도해주세요.', en: 'Unable to complete the check.' } });
      }
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
      }
    }
  }

  const pairCountLabel = useMemo(
    () => (result ? `${result.pairs.length}` : ''),
    [result],
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{appHeaderText.title}</Text>
        <Text style={styles.subtitleKo}>{appHeaderText.primary.ko}</Text>
        <Text style={styles.subtitleEn}>{appHeaderText.primary.en}</Text>

        <View style={styles.inputCard}>
          <UnInputGrid
            inputCount={inputCount}
            unInputs={unInputs}
            onChangeInput={handleChangeInput}
            onChangeCount={handleChangeCount}
          />

          {validationMessage && (
            <View style={styles.validationBlock}>
              <Text style={styles.validationKo}>{validationMessage.ko}</Text>
              <Text style={styles.validationEn}>{validationMessage.en}</Text>
            </View>
          )}

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="격리조건 확인 / Check segregation"
          >
            {loading ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.buttonText}>확인 중... / Checking...</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text style={styles.buttonText}>격리조건 확인</Text>
                <Text style={styles.buttonTextEn}>Check Segregation</Text>
              </View>
            )}
          </Pressable>
        </View>

        {errorState && (
          <View style={styles.errorCard}>
            <Text style={styles.errorKo}>{errorState.message.ko}</Text>
            <Text style={styles.errorEn}>{errorState.message.en}</Text>
          </View>
        )}

        {result && (
          <>
            <BatchResultSummary summary={result.summary} />

            <View style={styles.sectionHeaderBlock}>
              <Text style={styles.sectionTitleKo}>조합별 결과 ({pairCountLabel})</Text>
              <Text style={styles.sectionTitleEn}>Pair Details</Text>
            </View>
            {result.pairs.map((pair, index) => (
              <PairResultCard key={`${pair.leftUnNumber}-${pair.rightUnNumber}-${index}`} pair={pair} />
            ))}

            <View style={styles.sectionHeaderBlock}>
              <Text style={styles.sectionTitleKo}>입력 화물 정보</Text>
              <Text style={styles.sectionTitleEn}>DG Summary</Text>
            </View>
            {result.dgSummaries.map((dgSummary) => (
              <DgSummaryCard key={dgSummary.unNumber} summary={dgSummary} />
            ))}

            <View style={styles.operationalNoteBlock}>
              <Text style={styles.operationalNoteKo}>{operationalNote.ko}</Text>
              <Text style={styles.operationalNoteEn}>{operationalNote.en}</Text>
            </View>
          </>
        )}

        <StatusBar style="dark" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 56,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.navy,
    marginBottom: 6,
  },
  subtitleKo: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  subtitleEn: {
    fontSize: 12,
    color: palette.textSecondary,
    marginBottom: 20,
  },
  inputCard: {
    backgroundColor: palette.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  validationBlock: {
    marginTop: 4,
    marginBottom: 12,
  },
  validationKo: {
    color: palette.errorText,
    fontSize: 13,
    fontWeight: '600',
  },
  validationEn: {
    color: palette.errorText,
    fontSize: 12,
  },
  button: {
    backgroundColor: palette.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  buttonDisabled: {
    backgroundColor: palette.primaryDisabled,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextEn: {
    color: '#E4ECF5',
    fontSize: 12,
  },
  errorCard: {
    marginTop: 20,
    padding: 14,
    borderRadius: 8,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
  },
  errorKo: {
    color: palette.errorText,
    fontSize: 14,
    fontWeight: '700',
  },
  errorEn: {
    color: palette.errorText,
    fontSize: 12,
    marginTop: 2,
  },
  sectionHeaderBlock: {
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitleKo: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.navy,
  },
  sectionTitleEn: {
    fontSize: 12,
    color: palette.textSecondary,
  },
  operationalNoteBlock: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  operationalNoteKo: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  operationalNoteEn: {
    fontSize: 11,
    color: palette.textSecondary,
    marginTop: 2,
  },
});
