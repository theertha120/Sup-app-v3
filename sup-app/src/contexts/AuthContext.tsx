import React, { createContext, useContext, useState, ReactNode } from "react";
import { autoDetectAndSaveTimezone } from "@/src/services/user/timezoneService";
import { CURRENT_USER_ID } from "@/constants/env";

interface AuthContextType {
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (email: string, password: string): Promise<boolean> => {
    // Simple authentication check, later integrate with 'users' list in backend
    if (email === "user@test.com" && password === "1234") {
      setIsAuthenticated(true);

      // Auto-detect and save timezone
      await autoDetectAndSaveTimezone(CURRENT_USER_ID);

      return true;
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
