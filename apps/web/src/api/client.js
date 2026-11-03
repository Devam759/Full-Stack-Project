const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/v1';

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/**
 * Universal fetch wrapper with authorization and standard error handling.
 */
export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // for refresh cookies
  });

  // Handle 401 token expiration and attempt refresh
  if (
    response.status === 401 &&
    !endpoint.includes('/auth/login') &&
    !endpoint.includes('/auth/refresh')
  ) {
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setAccessToken(refreshData.accessToken);
        headers.Authorization = `Bearer ${refreshData.accessToken}`;

        // Retry original request
        const retryRes = await fetch(url, { ...options, headers, credentials: 'include' });
        const retryData = await retryRes.json();
        if (!retryRes.ok) throw retryData.error || retryData;
        return retryData;
      }
    } catch {
      setAccessToken(null);
    }
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = data.error || {
      code: 'API_ERROR',
      message: data.message || 'An error occurred during the request',
      details: data,
    };
    throw error;
  }

  return data;
}

export default apiRequest;
