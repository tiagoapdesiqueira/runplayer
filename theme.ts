export const theme = {
  bg: '#0b0b0e',
  bgElevated: '#141418',
  surface: '#17171c',
  surfaceHigh: '#1f1f26',
  surfaceOverlay: 'rgba(255,255,255,0.04)',
  text: '#f5f5f7',
  textSoft: '#c4c4ca',
  textMuted: '#8a8a92',
  textDim: '#5a5a62',
  accent: '#ff7a4d',
  accentSoft: 'rgba(255,122,77,0.14)',
  accentDark: '#0b0b0d',
  divider: 'rgba(255,255,255,0.07)',
  dividerStrong: 'rgba(255,255,255,0.12)',
  overlay: 'rgba(0,0,0,0.5)',
};

export const defaultPalette = {
  dominant: '#1f1f26',
  vibrant: '#3a3a44',
  dark: '#0b0b0e',
};

export type Palette = typeof defaultPalette;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
};

export const font = {
  tiny: 11,
  caption: 12,
  small: 13,
  button: 14,
  body: 15,
  callout: 16,
  title3: 20,
  title2: 22,
  title1: 28,
  large: 32,
};

export const weight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const lineHeight = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.45,
  loose: 1.6,
};

export const letterSpacing = {
  wide: 1.4,
  normal: 0,
  slight: -0.1,
  tight: -0.3,
  tighter: -0.5,
};

export const ff = 'System';
