import Constants from 'expo-constants';

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

const rawBaseUrl: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  Constants.expoConfig?.extra?.apiBaseUrl ??
  'http://localhost:8787';

export const API_BASE_URL: string = normalizeBaseUrl(rawBaseUrl);
