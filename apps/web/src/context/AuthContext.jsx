import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest, setAccessToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requiresPhoto, setRequiresPhoto] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const refreshData = await apiRequest('/auth/refresh', { method: 'POST' });
        setAccessToken(refreshData.accessToken);
        setUser(refreshData.user);
        if (!refreshData.user.photoUrl) {
          setRequiresPhoto(true);
        }
      } catch {
        // Not logged in or expired
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, []);

  const login = async (email, password) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    setAccessToken(data.accessToken);
    setUser(data.user);
    setRequiresPhoto(data.requiresPhoto || !data.user.photoUrl);
    return data;
  };

  const register = async (formData) => {
    return await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(formData),
    });
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      setRequiresPhoto(false);
    }
  };

  const updateProfile = async (updateData) => {
    const data = await apiRequest('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    });
    setUser(data.user);
    if (data.user.photoUrl) {
      setRequiresPhoto(false);
    }
    return data.user;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        requiresPhoto,
        setRequiresPhoto,
        login,
        register,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
