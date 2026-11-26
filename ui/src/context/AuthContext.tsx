import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { authApi, configApi } from '@/services/api';
import type { LoginCredentials, TokenResponse, User } from '@/types';

export type AuthMode = 'login' | 'open';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** 'login' keeps the JWT sign-in screen; 'open' means the API assumes the local user. */
  authMode: AuthMode;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      // Ask the API which mode it runs in before deciding whether a login is even possible.
      try {
        const config = await configApi.get();
        if (cancelled) return;
        setAuthMode(config.auth_mode);
        localStorage.setItem('auth_mode', config.auth_mode);

        if (config.auth_mode === 'open') {
          // No tokens exist in this mode, and a stale one would be sent as a bogus bearer.
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          const localUser: User = {
            id: config.local_user?.id ?? 0,
            username: config.local_user?.username ?? 'local',
            email: config.local_user?.email ?? '',
          };
          setUser(localUser);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        // Unreachable API: fall back to the login flow rather than pretending to be signed in.
        console.error('Failed to read instance config:', error);
        localStorage.setItem('auth_mode', 'login');
      }

      if (cancelled) return;
      // Check if user is already logged in
      const token = localStorage.getItem('access_token');
      const storedUser = localStorage.getItem('user');

      if (token && storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          setUser(userData);
        } catch (error) {
          console.error('Failed to parse stored user data:', error);
          // Clear invalid data
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
        }
      }
      setIsLoading(false);
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (credentials: LoginCredentials) => {
    try {
      const tokens: TokenResponse = await authApi.login(credentials);
      localStorage.setItem('access_token', tokens.access);
      localStorage.setItem('refresh_token', tokens.refresh);

      // Decode user data from JWT payload
      const payload = JSON.parse(atob(tokens.access.split('.')[1]));
      const userData: User = { id: payload.user_id, username: credentials.username, email: '' };
      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    authMode,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
