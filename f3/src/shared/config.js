export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  appEnv: import.meta.env.VITE_APP_ENV || 'development'
};

export function socketBaseUrl() {
  return config.apiBaseUrl || window.location.origin;
}
