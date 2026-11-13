import React, { useState, useEffect } from 'react';
import { Users, Search, Calendar, Wallet, User as UserIcon } from 'lucide-react';
import { applyBrandTokens, BRAND } from './brand.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { NotificationBell } from './components/NotificationBell.jsx';
import { NotificationsScreen } from './screens/NotificationsScreen.jsx';
import { OnboardingScreen } from './screens/OnboardingScreen.jsx';
import { SignUpScreen } from './screens/SignUpScreen.jsx';
import { PhotoUploadStep } from './screens/PhotoUploadStep.jsx';
import { LoginScreen } from './screens/LoginScreen.jsx';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen.jsx';
import { ProfileScreen } from './screens/ProfileScreen.jsx';
import { CommunitiesScreen } from './screens/CommunitiesScreen.jsx';
import { CommunityDetailScreen } from './screens/CommunityDetailScreen.jsx';
import { ItemsBrowseScreen } from './screens/ItemsBrowseScreen.jsx';
import { ItemDetailScreen } from './screens/ItemDetailScreen.jsx';
import { CreateItemScreen } from './screens/CreateItemScreen.jsx';
import { WalletScreen } from './screens/WalletScreen.jsx';
import { BookingRequestScreen } from './screens/BookingRequestScreen.jsx';
import { MyBookingsScreen } from './screens/MyBookingsScreen.jsx';
import { BookingDetailScreen } from './screens/BookingDetailScreen.jsx';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen.jsx';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen.jsx';

function MainAppShell() {
  const { user, requiresPhoto, setRequiresPhoto } = useAuth();

  const getInitialRoute = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/forgot-password') return 'forgot-password';
      if (path === '/reset-password') return 'reset-password';
      if (path === '/notifications') return 'notifications';
      const bookingMatch = path.match(/^\/bookings\/([a-zA-Z0-9_-]+)$/);
      if (bookingMatch) return 'booking-detail';
    }
    return user ? 'communities' : 'onboarding';
  };

  const getInitialBookingId = () => {
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/^\/bookings\/([a-zA-Z0-9_-]+)$/);
      return match ? match[1] : null;
    }
    return null;
  };

  const getQueryToken = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('token') || '';
    }
    return '';
  };

  const [currentScreen, setCurrentScreen] = useState(getInitialRoute);
  const [resetToken] = useState(getQueryToken);
  const [selectedCommunityId, setSelectedCommunityId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedBookingId, setSelectedBookingId] = useState(getInitialBookingId);

  // Sync with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/forgot-password') {
        setCurrentScreen('forgot-password');
      } else if (path === '/reset-password') {
        setCurrentScreen('reset-password');
      } else if (path === '/notifications') {
        setCurrentScreen('notifications');
      } else {
        const bookingMatch = path.match(/^\/bookings\/([a-zA-Z0-9_-]+)$/);
        if (bookingMatch) {
          setSelectedBookingId(bookingMatch[1]);
          setCurrentScreen('booking-detail');
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (screen, params = {}) => {
    if (typeof window !== 'undefined') {
      if (screen === 'booking-detail' && params.bookingId) {
        setSelectedBookingId(params.bookingId);
        window.history.pushState({}, '', `/bookings/${params.bookingId}`);
      } else if (screen === 'reset-password') {
        window.history.pushState(
          {},
          '',
          `/reset-password${params.token ? `?token=${params.token}` : ''}`,
        );
      } else if (screen === 'forgot-password') {
        window.history.pushState({}, '', '/forgot-password');
      } else if (screen === 'notifications') {
        window.history.pushState({}, '', '/notifications');
      } else if (screen === 'communities' || screen === 'onboarding') {
        window.history.pushState({}, '', '/');
      }
    }
    setCurrentScreen(screen);
  };

  useEffect(() => {
    applyBrandTokens();
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path === '/forgot-password' || path === '/reset-password') {
      return;
    }
    if (!user) {
      setCurrentScreen((prev) =>
        prev === 'forgot-password' ||
        prev === 'reset-password' ||
        prev === 'login' ||
        prev === 'signup'
          ? prev
          : 'onboarding',
      );
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
            navigateTo(user ? 'communities' : 'onboarding');
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

        {/* Header Right: Notification Bell & Demo Money Tag */}
        <div className="flex items-center gap-2">
          {user && (
            <NotificationBell
              onNavigate={(link) => {
                const match = link.match(/\/bookings\/([a-zA-Z0-9_-]+)/);
                if (match) {
                  navigateTo('booking-detail', { bookingId: match[1] });
                } else if (link === '/notifications') {
                  navigateTo('notifications');
                }
              }}
            />
          )}
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
        {currentScreen === 'forgot-password' && (
          <ForgotPasswordScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'reset-password' && (
          <ResetPasswordScreen
            initialToken={resetToken}
            onNavigate={(screen) => setCurrentScreen(screen)}
          />
        )}
        {currentScreen === 'verify-email' && (
          <VerifyEmailScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {currentScreen === 'notifications' && (
          <NotificationsScreen
            onNavigate={(link) => {
              const match = link.match(/\/bookings\/([a-zA-Z0-9_-]+)/);
              if (match) {
                navigateTo('booking-detail', { bookingId: match[1] });
              }
            }}
          />
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

        {currentScreen === 'items' && (
          <ItemsBrowseScreen
            onSelectItem={(id) => {
              setSelectedItemId(id);
              setCurrentScreen('item-detail');
            }}
            onCreateItem={() => setCurrentScreen('create-item')}
          />
        )}

        {currentScreen === 'item-detail' && selectedItemId && (
          <ItemDetailScreen
            itemId={selectedItemId}
            onBack={() => {
              setSelectedItemId(null);
              setCurrentScreen('items');
            }}
            onRequestBooking={(id) => {
              setSelectedItemId(id);
              setCurrentScreen('booking-request');
            }}
          />
        )}

        {currentScreen === 'booking-request' && selectedItemId && (
          <BookingRequestScreen
            itemId={selectedItemId}
            onBack={() => navigateTo('item-detail')}
            onSuccess={(newBooking) => {
              navigateTo('booking-detail', { bookingId: newBooking._id });
            }}
          />
        )}

        {currentScreen === 'my-bookings' && (
          <MyBookingsScreen
            onSelectBooking={(id) => {
              navigateTo('booking-detail', { bookingId: id });
            }}
          />
        )}

        {currentScreen === 'booking-detail' && selectedBookingId && (
          <BookingDetailScreen
            bookingId={selectedBookingId}
            onBack={() => navigateTo('my-bookings')}
          />
        )}

        {currentScreen === 'create-item' && (
          <CreateItemScreen
            onBack={() => setCurrentScreen('items')}
            onSuccess={(newItem) => {
              setSelectedItemId(newItem._id);
              setCurrentScreen('item-detail');
            }}
          />
        )}

        {currentScreen === 'wallet' && <WalletScreen />}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-slate-200 max-w-lg mx-auto flex items-center justify-around py-2 px-3 shadow-lg">
        <button
          type="button"
          onClick={() => {
            setSelectedCommunityId(null);
            setSelectedItemId(null);
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
          onClick={() => {
            setSelectedCommunityId(null);
            setSelectedItemId(null);
            setCurrentScreen('items');
          }}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'items' ||
            currentScreen === 'item-detail' ||
            currentScreen === 'create-item'
              ? 'text-primary'
              : 'text-text-muted'
          }`}
        >
          <Search className="w-5 h-5" />
          <span className="text-[11px] font-medium">Items</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedCommunityId(null);
            setSelectedItemId(null);
            setSelectedBookingId(null);
            setCurrentScreen(user ? 'my-bookings' : 'login');
          }}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'my-bookings' ||
            currentScreen === 'booking-detail' ||
            currentScreen === 'booking-request'
              ? 'text-primary'
              : 'text-text-muted hover:text-slate-900'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[11px] font-medium">Bookings</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedCommunityId(null);
            setSelectedItemId(null);
            setCurrentScreen(user ? 'wallet' : 'login');
          }}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'wallet' ? 'text-primary' : 'text-text-muted hover:text-slate-900'
          }`}
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
      <SocketProvider>
        <MainAppShell />
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
