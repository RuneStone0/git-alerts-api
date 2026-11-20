import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Get API base URL from environment or default to localhost
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Create axios instance
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token refresh state
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // If the request failed because the access token is missing or expired, refresh once.
    // 401 is the documented answer, but DRF returns 403 token_not_valid when JWT is not the
    // first authenticator, and a client that only looks for 401 stays broken until logout.
    const status = error.response?.status;
    const tokenInvalid =
      (error.response?.data as { code?: string } | undefined)?.code === 'token_not_valid';
    if ((status === 401 || (status === 403 && tokenInvalid)) && !originalRequest._retry) {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        // No refresh token, redirect to login
        isRefreshing = false;
        processQueue(error, null);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        // Try to refresh the token. API_BASE_URL is '/' when the UI is served same-origin
        // behind a proxy, and a bare concatenation would build '//api/token/refresh/',
        // which browsers read as protocol-relative (host "api"). Trim first.
        const refreshBase = API_BASE_URL.replace(/\/+$/, '');
        const response = await axios.post(`${refreshBase}/api/token/refresh/`, {
          refresh: refreshToken,
        });

        const { access } = response.data;
        localStorage.setItem('access_token', access);

        // Process queued requests with new token
        processQueue(null, access);

        // Retry the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access}`;
        }

        isRefreshing = false;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        processQueue(refreshError, null);
        isRefreshing = false;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
