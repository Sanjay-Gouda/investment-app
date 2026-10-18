'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiClient, TOKEN_KEY } from './api-client';

export type Role = 'INVESTOR' | 'ADVISER';
export type KycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: Role;
}

export interface AuthAccount {
  id: string;
  kycStatus: KycStatus;
  status: string;
  selectedPortfolio?: string | null;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
  account: AuthAccount;
}

interface AuthContextValue {
  user: AuthUser | null;
  account: AuthAccount | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isKYCApproved: boolean;
  isAdviser: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (email: string, password: string, fullName: string) => Promise<AuthResponse>;
  logout: () => void;
  refresh: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function safeGet(key: string): string | null {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function safeSet(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — keep in-memory state only */
    }
  }
  function safeRemove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function persist(res: AuthResponse) {
    safeSet(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
    setAccount(res.account);
  }

  // Hydrate from a stored token on first load.
  useEffect(() => {
    const stored = safeGet(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    apiClient
      .get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        setAccount(data.account);
      })
      .catch(() => {
        safeRemove(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', { email, password });
    persist(data);
    return data;
  };

  const register = async (email: string, password: string, fullName: string) => {
    const { data } = await apiClient.post<AuthResponse>('/auth/register', {
      email,
      password,
      fullName,
    });
    persist(data);
    return data;
  };

  const logout = () => {
    safeRemove(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setAccount(null);
  };

  const refresh = async () => {
    const { data } = await apiClient.get('/auth/me');
    setUser(data.user);
    setAccount(data.account);
  };

  const value: AuthContextValue = {
    user,
    account,
    token,
    loading,
    isAuthenticated: !!token && !!user,
    isKYCApproved: account?.kycStatus === 'APPROVED',
    isAdviser: user?.role === 'ADVISER',
    login,
    register,
    logout,
    refresh,
    refreshUser: refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
