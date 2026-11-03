import React, { useState, useEffect } from 'react';
import { Users, Search, Calendar, Wallet, User as UserIcon } from 'lucide-react';
import { applyBrandTokens, BRAND } from './brand.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { OnboardingScreen } from './screens/OnboardingScreen.jsx';
import { SignUpScreen } from './screens/SignUpScreen.jsx';
import { PhotoUploadStep } from './screens/PhotoUploadStep.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen.jsx';
import { ProfileScreen } from './screens/ProfileScreen.jsx';
import { CommunitiesScreen } from './screens/CommunitiesScreen.jsx';
import { CommunityDetailScreen } from './screens/CommunityDetailScreen.jsx';

function MainAppShell() {
  const { user, requiresPhoto, setRequiresPhoto } = useAuth();
  const [currentScreen, setCurrentScreen] = useState('communities');
  const [selectedCommunityId, setSelectedCommunityId] = useState(null);

  useEffect(() => {
    applyBrandTokens();
    if (!user) {
      setCurrentScreen('onboarding');
    } else if (requiresPhoto) {
      setCurrentScreen('photo-step');
    } else {
      setCurrentScreen('communities');
    }
  }, [user, requiresPhoto]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-text">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-surface border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => {
            setSelectedCommunityId(null);
            setCurrentScreen(user ? 'communities' : 'onboarding');
          }}
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
              setCurrentScreen('communities');
            }}
          />
        )}
        {currentScreen === 'profile' && (
          <ProfileScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}

        {currentScreen === 'communities' && (
          <CommunitiesScreen
            onSelectCommunity={(id) => {
              setSelectedCommunityId(id);
              setCurrentScreen('community-detail');
            }}
          />
        )}

        {currentScreen === 'community-detail' && selectedCommunityId && (
          <CommunityDetailScreen
            communityId={selectedCommunityId}
            onBack={() => {
              setSelectedCommunityId(null);
              setCurrentScreen('communities');
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-slate-200 max-w-lg mx-auto flex items-center justify-around py-2 px-3 shadow-lg">
        <button
          type="button"
          onClick={() => {
            setSelectedCommunityId(null);
            setCurrentScreen('communities');
          }}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'communities' || currentScreen === 'community-detail'
              ? 'text-primary'
              : 'text-text-muted'
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[11px] font-medium">Communities</span>
        </button>
        <button
          type="button"
          onClick={() => alert('Item search will be active in Phase 3')}
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Search className="w-5 h-5" />
          <span className="text-[11px] font-medium">Items</span>
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
          onClick={() => {
            setSelectedCommunityId(null);
            setCurrentScreen(user ? 'profile' : 'login');
          }}
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
