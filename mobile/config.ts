import Constants from 'expo-constants';

export const API_BASE_URL: string =
  Constants.expoConfig?.extra?.apiBaseUrl ?? 'http://localhost:8787';
