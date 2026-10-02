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
import { resolvePrivacyPolicyUrl } from './src/ads/config';
import { useAdsConsent } from './src/ads/useAdsConsent';
import { AdBanner } from './src/components/AdBanner';
import { AppCard } from './src/components/AppCard';
import { BatchResultSummary } from './src/components/BatchResultSummary';
import { DgSummaryCard } from './src/components/DgSummaryCard';
import { PairResultCard } from './src/components/PairResultCard';
import { PrivacyFooter } from './src/components/PrivacyFooter';
import { SectionHeader } from './src/components/SectionHeader';
import { UnInputGrid } from './src/components/UnInputGrid';
import {
  appHeaderText,
  type Bilingual,
  duplicateInputIndexes,
  errorPresentation,
  operationalNote,
  validateActiveInputs,
} from './src/ui/segregation-presentation';
import { palette, radius, spacing, typography } from './src/ui/theme';

const privacyPolicyUrl = resolvePrivacyPolicyUrl();

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
  const { canRequestAds, privacyOptionsRequired, showPrivacyOptions } = useAdsConsent();
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
  // Loading keeps the primary surface so the white spinner stays legible;
  // `disabled` below is still driven by `canSubmit` exactly as before.
  const showDisabledSurface = !canSubmit && !loading;

  // Outlined fields are a subset of what blocks submission; the panel below
  // still carries the full message. Nothing here affects `canSubmit`.
  const invalidIndexes = validationMessage ? duplicateInputIndexes(activeInputs) : [];

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
        style={styles.scroll}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {/* The single maritime identity detail: a short teal keel line under
              the wordmark. No asset, no hero image, no slogan. */}
          <View style={styles.headerAccent} />
          <Text style={styles.title}>{appHeaderText.title}</Text>
          <Text style={styles.subtitleKo}>{appHeaderText.primary.ko}</Text>
          <Text style={styles.subtitleEn}>{appHeaderText.primary.en}</Text>
        </View>

        <AppCard>
          <UnInputGrid
            inputCount={inputCount}
            unInputs={unInputs}
            onChangeInput={handleChangeInput}
            onChangeCount={handleChangeCount}
            errorIndexes={invalidIndexes}
          />

          {validationMessage && (
            <View style={styles.validationPanel}>
              <View style={styles.validationAccent} />
              <View style={styles.validationContent}>
                <Text style={styles.validationKo}>{validationMessage.ko}</Text>
                <Text style={styles.validationEn}>{validationMessage.en}</Text>
              </View>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && canSubmit && styles.buttonPressed,
              showDisabledSurface && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            accessibilityLabel="격리조건 확인 / Check segregation"
          >
            {loading ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator color={palette.onPrimary} />
                <Text style={styles.buttonText}>확인 중... / Checking...</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text style={[styles.buttonText, showDisabledSurface && styles.buttonTextDisabled]}>
                  격리조건 확인
                </Text>
                <Text style={[styles.buttonTextEn, showDisabledSurface && styles.buttonTextDisabled]}>
                  Check Segregation
                </Text>
              </View>
            )}
          </Pressable>
        </AppCard>

        {errorState && (
          <View style={styles.errorPanel}>
            <View style={styles.errorAccent} />
            <View style={styles.errorContent}>
              <Text style={styles.errorKo}>{errorState.message.ko}</Text>
              <Text style={styles.errorEn}>{errorState.message.en}</Text>
            </View>
          </View>
        )}

        {result && (
          <>
            <BatchResultSummary summary={result.summary} />

            <SectionHeader ko="조합별 결과" en="Pair Details" trailing={pairCountLabel} />
            {result.pairs.map((pair, index) => (
              <PairResultCard key={`${pair.leftUnNumber}-${pair.rightUnNumber}-${index}`} pair={pair} />
            ))}

            <SectionHeader ko="입력 화물 정보" en="DG Summary" />
            {result.dgSummaries.map((dgSummary) => (
              <DgSummaryCard key={dgSummary.unNumber} summary={dgSummary} />
            ))}

            <View style={styles.operationalNote}>
              <Text style={styles.operationalNoteKo}>{operationalNote.ko}</Text>
              <Text style={styles.operationalNoteEn}>{operationalNote.en}</Text>
            </View>
          </>
        )}

        <PrivacyFooter
          privacyOptionsRequired={privacyOptionsRequired}
          privacyPolicyUrl={privacyPolicyUrl}
          onPrivacyOptionsPress={showPrivacyOptions}
        />

        <StatusBar style="dark" />
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom, backgroundColor: palette.surfaceMuted }}>
        <AdBanner canRequestAds={canRequestAds} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.xxl,
  },
  headerAccent: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.teal,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.appTitle,
    color: palette.navy,
  },
  subtitleKo: {
    ...typography.bodyKo,
    color: palette.textPrimary,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  subtitleEn: {
    ...typography.bodyEn,
    color: palette.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  validationPanel: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.errorSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.errorBorder,
    overflow: 'hidden',
  },
  validationAccent: {
    width: 3,
    backgroundColor: palette.errorAccent,
  },
  validationContent: {
    flex: 1,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md + 2,
  },
  validationKo: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.errorText,
    lineHeight: 19,
  },
  validationEn: {
    fontSize: 12,
    color: palette.errorText,
    opacity: 0.85,
    marginTop: 1,
  },
  button: {
    backgroundColor: palette.brandBlueDeep,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 56,
  },
  buttonPressed: {
    backgroundColor: palette.navy,
  },
  // A deliberate disabled surface rather than a faded primary: the control
  // still reads as a real control, just clearly not actionable yet.
  buttonDisabled: {
    backgroundColor: palette.disabledSurface,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  buttonText: {
    color: palette.onPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  buttonTextEn: {
    color: palette.onPrimaryMuted,
    fontSize: 13,
  },
  buttonTextDisabled: {
    color: palette.disabledText,
  },
  errorPanel: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: palette.errorSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.errorBorder,
    overflow: 'hidden',
  },
  errorAccent: {
    width: 4,
    backgroundColor: palette.errorAccent,
  },
  errorContent: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
  },
  errorKo: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.errorText,
    lineHeight: 21,
  },
  errorEn: {
    fontSize: 12,
    color: palette.errorText,
    opacity: 0.85,
    marginTop: 2,
  },
  operationalNote: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceMuted,
  },
  operationalNoteKo: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textPrimary,
    lineHeight: 19,
  },
  operationalNoteEn: {
    fontSize: 11,
    color: palette.textSecondary,
    lineHeight: 17,
    marginTop: spacing.xs + 2,
  },
});
