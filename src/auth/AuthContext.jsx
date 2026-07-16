import { createContext, useContext, useState, useEffect } from "react";
import pb from "../pb";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((token, model) => {
      setUser(model);
      setLoading(false);
    });

    if (pb.authStore.isValid && pb.authStore.model) {
      setUser(pb.authStore.model);
    }

    setLoading(false);
    return () => unsubscribe();
  }, []);

  const login = async (email, password) => {
    return pb.collection("users").authWithPassword(email, password);
  };

  const register = async (email, password, passwordConfirm, displayName) => {
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm,
      display_name: displayName,
      role: "designer",
    });
    return await pb.collection("users").authWithPassword(email, password);
  };

  const logout = () => {
    pb.authStore.clear();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
