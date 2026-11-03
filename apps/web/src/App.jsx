import React, { useState, useEffect } from 'react';
import { Home, Search, Calendar, Wallet, User as UserIcon } from 'lucide-react';
import { applyBrandTokens, BRAND } from './brand.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { OnboardingScreen } from './screens/OnboardingScreen.jsx';
import { SignUpScreen } from './screens/SignUpScreen.jsx';
import { PhotoUploadStep } from './screens/PhotoUploadStep.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen.jsx';
import { ProfileScreen } from './screens/ProfileScreen.jsx';
import { formatPaise } from '@borrowloop/shared';

function MainAppShell() {
  const { user, requiresPhoto, setRequiresPhoto } = useAuth();
  const [currentScreen, setCurrentScreen] = useState('home');

  useEffect(() => {
    applyBrandTokens();
    if (!user) {
      setCurrentScreen('onboarding');
    } else if (requiresPhoto) {
      setCurrentScreen('photo-step');
    } else {
      setCurrentScreen('home');
    }
  }, [user, requiresPhoto]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-text">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-surface border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setCurrentScreen(user ? 'home' : 'onboarding')}
        >
          <div
            className="w-7 h-7 text-primary"
            dangerouslySetInnerHTML={{ __html: BRAND.logo.svg }}
          />
          <span className="font-heading font-bold text-lg tracking-tight text-primary-dark">
            {BRAND.appName}
          </span>
        </div>

        {/* Demo Money Tag - Hard Rule 9 */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 shadow-xs">
            Demo money
          </span>
        </div>
      </header>

      {/* Screen Router */}
      <main className="flex-1 max-w-lg mx-auto w-full">
        {currentScreen === 'onboarding' && (
          <OnboardingScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'signup' && (
          <SignUpScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'login' && (
          <LoginScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'verify-email' && (
          <VerifyEmailScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'photo-step' && (
          <PhotoUploadStep
            onComplete={() => {
              setRequiresPhoto(false);
              setCurrentScreen('home');
            }}
          />
        )}
        {currentScreen === 'profile' && (
          <ProfileScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}

        {currentScreen === 'home' && (
          <div className="p-4 space-y-4">
            <div className="bg-surface rounded-brand p-5 border border-slate-200 shadow-sm space-y-3">
              <h1 className="text-xl font-heading font-semibold text-slate-900">
                Welcome back{user ? `, ${user.name}` : ''}!
              </h1>
              <p className="text-sm text-text-muted">
                Your community borrowing platform is active. Communities, item search, and listings
                are coming in Phase 2 and Phase 3.
              </p>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-sm">
                <span className="text-text-muted font-medium">Demo Wallet:</span>
                <span className="font-semibold text-slate-900 font-mono">
                  {formatPaise(0, { showDemoTag: true })}
                </span>
              </div>
            </div>

            {!user && (
              <div className="bg-teal-50 border border-teal-200 p-4 rounded-brand flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold text-teal-900">Join Your Community</h2>
                  <p className="text-[11px] text-teal-700">
                    Create an account to start lending and borrowing
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentScreen('signup')}
                  className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-brand shadow-xs"
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-slate-200 max-w-lg mx-auto flex items-center justify-around py-2 px-3 shadow-lg">
        <button
          type="button"
          onClick={() => setCurrentScreen('home')}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'home' ? 'text-primary' : 'text-text-muted'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[11px] font-medium">Home</span>
        </button>
        <button
          type="button"
          onClick={() => alert('Item search will be active in Phase 3')}
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Search className="w-5 h-5" />
          <span className="text-[11px] font-medium">Search</span>
        </button>
        <button
          type="button"
          onClick={() => alert('Bookings lifecycle will be active in Phase 5')}
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[11px] font-medium">Bookings</span>
        </button>
        <button
          type="button"
          onClick={() => alert('Wallet transactions will be active in Phase 4')}
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Wallet className="w-5 h-5" />
          <span className="text-[11px] font-medium">Wallet</span>
        </button>
        <button
          type="button"
          onClick={() => setCurrentScreen(user ? 'profile' : 'login')}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'profile' ? 'text-primary' : 'text-text-muted'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span className="text-[11px] font-medium">Profile</span>
        </button>
      </nav>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <MainAppShell />
    </AuthProvider>
  );
}

export default App;
