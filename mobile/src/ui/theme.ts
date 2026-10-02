import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * "Premium maritime utility" visual system — the single source of truth for
 * colour, radius, spacing and elevation across the app.
 *
 * Presentation only. Nothing here encodes a segregation outcome; the semantic
 * mapping from a decision to a tone lives in `segregation-presentation.ts`,
 * which consumes these tokens.
 *
 * Restraint rules that the palette itself has to enforce:
 *  - No green success colour exists. A CLEAR / level-0 pair may still carry an
 *    additional requirement, so the palette offers only a muted `mint*` accent
 *    that reads as "no level identified", never as "safe".
 *  - Status is never carried by hue alone; every tone ships a readable text
 *    colour so the wording stays the primary signal.
 */
export const palette = {
  /** Warm neutral page ground — keeps white surfaces feeling lifted, not clinical. */
  background: '#F8F7F4',
  backgroundCool: '#F7F8FA',
  surface: '#FFFFFF',
  /** Quiet inset surface for footers and secondary panels. */
  surfaceMuted: '#F2F1ED',

  navy: '#102A43',
  textPrimary: '#142638',
  textSecondary: '#687686',
  textTertiary: '#7D8A99',

  brandBlue: '#1769C2',
  brandBlueSoft: '#E8F1FB',
  brandBlueDeep: '#0F4C81',

  teal: '#4CC9C0',
  mintSurface: '#E4F5F1',
  mintText: '#23866A',
  mintBorder: '#A8DCD2',

  segregationText: '#8C2F2F',
  segregationSurface: '#FFF1F1',
  segregationBorder: '#EBC4C4',
  segregationAccent: '#D84A4A',

  reviewText: '#7A5210',
  reviewSurface: '#FDF3E3',
  reviewBorder: '#E8D3AC',
  reviewAccent: '#C08A2E',

  additionalText: '#77551A',
  additionalSurface: '#FDF6E6',
  additionalBorder: '#EADBB4',
  additionalAccent: '#C9A227',

  clearText: '#23866A',
  clearSurface: '#E4F5F1',
  clearBorder: '#A8DCD2',
  clearAccent: '#4CC9C0',

  errorText: '#8C2F2F',
  errorSurface: '#FFF1F1',
  errorBorder: '#EBC4C4',
  errorAccent: '#D84A4A',

  /** Hairline separator — low opacity so cards read as depth, not as boxes. */
  border: 'rgba(20, 50, 75, 0.10)',
  borderStrong: 'rgba(20, 50, 75, 0.16)',
  /** Input outline at rest: visible enough to find, quiet enough to ignore. */
  inputBorder: 'rgba(20, 50, 75, 0.14)',
  inputSurface: '#FFFFFF',

  /** A deliberate disabled surface, not a faded primary button. */
  disabledSurface: '#D6DCE3',
  disabledText: '#566371',

  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#CFE1F4',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  input: 14,
  lg: 16,
  card: 20,
  button: 18,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/**
 * One broad, very low-opacity shadow used sparingly. Cards should read as
 * gently lifted surfaces, not floating bubbles, so there is only one level.
 */
export const shadow = {
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: palette.navy,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
    },
    default: {
      elevation: 2,
      shadowColor: palette.navy,
    },
  }) as ViewStyle,
} as const;

/**
 * Korean is the primary information layer; English is a smaller, quieter
 * second line. These presets keep that hierarchy consistent everywhere
 * instead of being re-tuned per component.
 */
export const typography = {
  appTitle: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 } satisfies TextStyle,
  sectionTitleKo: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 } satisfies TextStyle,
  sectionTitleEn: { fontSize: 12, fontWeight: '500', letterSpacing: 0.3 } satisfies TextStyle,
  labelKo: { fontSize: 15, fontWeight: '600' } satisfies TextStyle,
  bodyKo: { fontSize: 15, fontWeight: '500' } satisfies TextStyle,
  bodyEn: { fontSize: 13, fontWeight: '400' } satisfies TextStyle,
  captionKo: { fontSize: 12, fontWeight: '600' } satisfies TextStyle,
  captionEn: { fontSize: 11, fontWeight: '400' } satisfies TextStyle,
} as const;
