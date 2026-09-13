import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { AuthUser, Household } from "./types";

interface AuthState {
  user: AuthUser | null;
  household: Household | null;
  loading: boolean;
  /** Called after a successful code verification. */
  onSignedIn: (user: AuthUser) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user, household } = await api.me();
      setUser(user);
      setHousehold(household ?? null);
    } catch {
      setUser(null);
      setHousehold(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const onSignedIn = useCallback((u: AuthUser) => {
    setUser(u);
    // Pull the household details fresh after signing in.
    api.me().then(({ household }) => setHousehold(household ?? null)).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setHousehold(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, household, loading, onSignedIn, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
