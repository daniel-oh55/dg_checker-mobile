import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  checkSegregation,
  SegregationCheckError,
  type SegregationCheckResult,
} from './src/api/segregation';

export default function App() {
  const [leftUnNumber, setLeftUnNumber] = useState('');
  const [rightUnNumber, setRightUnNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SegregationCheckResult | null>(null);

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit = leftUnNumber.trim().length > 0 && rightUnNumber.trim().length > 0 && !loading;

  async function handleCheck() {
    const trimmedLeft = leftUnNumber.trim();
    const trimmedRight = rightUnNumber.trim();

    setResult(null);
    setErrorMessage(null);

    if (trimmedLeft.length === 0 || trimmedRight.length === 0) {
      setValidationMessage('Enter both UN numbers.');
      return;
    }
    setValidationMessage(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const checkResult = await checkSegregation(trimmedLeft, trimmedRight, controller.signal);
      if (requestSeq.current !== seq) return;
      setResult(checkResult);
    } catch (error) {
      if (requestSeq.current !== seq) return;
      if (error instanceof Error && error.name === 'AbortError') return;

      if (error instanceof SegregationCheckError) {
        if (error.code === 'DG_NOT_FOUND' && error.unNumbers && error.unNumbers.length > 0) {
          const list = error.unNumbers.map((un) => `UN ${un}`).join(', ');
          setErrorMessage(`${list} ${error.unNumbers.length > 1 ? 'were' : 'was'} not found in the current dataset.`);
        } else {
          setErrorMessage(error.message);
        }
      } else {
        setErrorMessage('Unable to complete the check. Please try again.');
      }
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
      }
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>DG Segregation</Text>
        <Text style={styles.subtitle}>Enter two UN numbers to check segregation.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>UN Number 1</Text>
          <TextInput
            style={styles.input}
            value={leftUnNumber}
            onChangeText={setLeftUnNumber}
            placeholder="e.g. UN3077"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>UN Number 2</Text>
          <TextInput
            style={styles.input}
            value={rightUnNumber}
            onChangeText={setRightUnNumber}
            placeholder="e.g. UN1993"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {validationMessage && <Text style={styles.validationText}>{validationMessage}</Text>}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleCheck}
          disabled={!canSubmit}
        >
          {loading ? (
            <View style={styles.buttonContent}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.buttonText}>Checking...</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Check Segregation</Text>
          )}
        </Pressable>

        {errorMessage && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultHeading}>{headingForStatus(result.decision.status)}</Text>
            {result.decision.status === 'SEGREGATION_REQUIRED' && result.decision.level !== null && (
              <Text style={styles.resultLevel}>Level {result.decision.level}</Text>
            )}
            <Text style={styles.resultReason}>{result.decision.reason}</Text>
            <Text style={styles.resultMeta}>
              {result.variants.left} × {result.variants.right} variant combination
              {result.variants.evaluatedPairs === 1 ? '' : 's'} evaluated
            </Text>
          </View>
        )}

        <StatusBar style="auto" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function headingForStatus(status: SegregationCheckResult['decision']['status']): string {
  switch (status) {
    case 'CLEAR':
      return 'No segregation required';
    case 'SEGREGATION_REQUIRED':
      return 'Segregation required';
    case 'REVIEW_REQUIRED':
      return 'Manual review required';
  }
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#444',
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    color: '#222',
  },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  validationText: {
    color: '#B00020',
    marginBottom: 12,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#9BB6D6',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F5C2C0',
  },
  errorText: {
    color: '#8A1C1C',
    fontSize: 15,
  },
  resultCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#F2F6FA',
    borderWidth: 1,
    borderColor: '#CBDCEB',
  },
  resultHeading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    color: '#0D2E4E',
  },
  resultLevel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
    color: '#0D2E4E',
  },
  resultReason: {
    fontSize: 15,
    color: '#22384F',
    marginBottom: 12,
  },
  resultMeta: {
    fontSize: 12,
    color: '#5A6B7C',
  },
});
