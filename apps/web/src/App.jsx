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
import { DisputeDetailScreen } from './screens/DisputeDetailScreen.jsx';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen.jsx';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen.jsx';

function MainAppShell() {
  const { user, requiresPhoto, setRequiresPhoto, logout } = useAuth();

  const getInitialRoute = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/forgot-password') return 'forgot-password';
      if (path === '/reset-password') return 'reset-password';
      if (path === '/notifications') return 'notifications';
      const bookingDisputeMatch = path.match(/^\/bookings\/([a-zA-Z0-9_-]+)\/dispute$/);
      if (bookingDisputeMatch) return 'dispute-detail';
      const disputeMatch = path.match(/^\/disputes\/([a-zA-Z0-9_-]+)$/);
      if (disputeMatch) return 'dispute-detail';
      const bookingMatch = path.match(/^\/bookings\/([a-zA-Z0-9_-]+)$/);
      if (bookingMatch) return 'booking-detail';
    }
    return user ? 'communities' : 'onboarding';
  };

  const getInitialBookingId = () => {
    if (typeof window !== 'undefined') {
      const disputeMatch = window.location.pathname.match(
        /^\/bookings\/([a-zA-Z0-9_-]+)\/dispute$/,
      );
      if (disputeMatch) return disputeMatch[1];
      const match = window.location.pathname.match(/^\/bookings\/([a-zA-Z0-9_-]+)$/);
      return match ? match[1] : null;
    }
    return null;
  };

  const getInitialDisputeId = () => {
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/^\/disputes\/([a-zA-Z0-9_-]+)$/);
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
  const [selectedDisputeId, setSelectedDisputeId] = useState(getInitialDisputeId);

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
        const bookingDisputeMatch = path.match(/^\/bookings\/([a-zA-Z0-9_-]+)\/dispute$/);
        if (bookingDisputeMatch) {
          setSelectedBookingId(bookingDisputeMatch[1]);
          setSelectedDisputeId(null);
          setCurrentScreen('dispute-detail');
          return;
        }
        const disputeMatch = path.match(/^\/disputes\/([a-zA-Z0-9_-]+)$/);
        if (disputeMatch) {
          setSelectedDisputeId(disputeMatch[1]);
          setCurrentScreen('dispute-detail');
          return;
        }
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
      } else if (screen === 'dispute-detail') {
        if (params.disputeId) {
          setSelectedDisputeId(params.disputeId);
          window.history.pushState({}, '', `/disputes/${params.disputeId}`);
        } else if (params.bookingId) {
          setSelectedBookingId(params.bookingId);
          window.history.pushState({}, '', `/bookings/${params.bookingId}/dispute`);
        }
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

  // Dynamic SEO Page Title & Robots Directive Management
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const titles = {
      onboarding: 'BorrowLoop — Peer-to-Peer Community Rental & Sharing Marketplace',
      communities: 'Explore Communities & Local Hubs — BorrowLoop',
      'community-detail': 'Community Items & Members — BorrowLoop',
      items: 'Browse Available Items & Equipment — BorrowLoop',
      'item-detail': 'Item Details & Availability — BorrowLoop',
      'create-item': 'List an Item for Rent — BorrowLoop',
      'booking-request': 'Reserve Item & Escrow Hold — BorrowLoop',
      'my-bookings': 'My Rentals & Lending Activity — BorrowLoop',
      'booking-detail': 'Rental Booking Details — BorrowLoop',
      wallet: 'Demo Money Wallet & Payouts — BorrowLoop',
      profile: 'Member Profile & Trust Score — BorrowLoop',
      notifications: 'Notifications & Alerts — BorrowLoop',
      login: 'Log In to BorrowLoop',
      signup: 'Join BorrowLoop Community',
      'forgot-password': 'Reset Your Password — BorrowLoop',
      'reset-password': 'Create New Password — BorrowLoop',
      'dispute-detail': 'Dispute Resolution Case — BorrowLoop',
    };

    document.title = titles[currentScreen] || 'BorrowLoop — Community Sharing Marketplace';

    // Protect private user screens from web crawler indexing
    const privateScreens = new Set([
      'wallet',
      'my-bookings',
      'booking-detail',
      'profile',
      'notifications',
      'reset-password',
      'dispute-detail',
      'booking-request',
    ]);

    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.name = 'robots';
      document.head.appendChild(robotsMeta);
    }
    if (privateScreens.has(currentScreen)) {
      robotsMeta.content = 'noindex, nofollow';
    } else {
      robotsMeta.content =
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
    }
  }, [currentScreen]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-text">
      {/* Top Header (Uber sleek black aesthetic) */}
      <header className="sticky top-0 z-40 bg-black text-white px-4 sm:px-8 py-3.5 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-8">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => {
              setSelectedCommunityId(null);
              navigateTo(user ? 'communities' : 'onboarding');
            }}
          >
            <div
              className="w-7 h-7 text-white"
              dangerouslySetInnerHTML={{ __html: BRAND.logo.svg }}
            />
            <span className="font-heading font-black text-xl tracking-tight text-white">
              {BRAND.appName}
            </span>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-neutral-300">
            <button
              type="button"
              onClick={() => {
                setSelectedItemId(null);
                navigateTo('items');
              }}
              className="hover:text-white transition"
            >
              Borrow
            </button>
            <button
              type="button"
              onClick={() => {
                if (user) {
                  navigateTo('create-item');
                } else {
                  navigateTo('signup');
                }
              }}
              className="hover:text-white transition"
            >
              Lend & Earn
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCommunityId(null);
                navigateTo('communities');
              }}
              className="hover:text-white transition"
            >
              Communities
            </button>
          </nav>
        </div>

        {/* Header Right */}
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-400 text-black shadow-xs">
            Demo money
          </span>

          {user ? (
            <div className="flex items-center gap-2.5">
              <NotificationBell
                onNavigate={(link) => {
                  const disputeMatch = link.match(/\/disputes\/([a-zA-Z0-9_-]+)/);
                  if (disputeMatch) {
                    navigateTo('dispute-detail', { disputeId: disputeMatch[1] });
                    return;
                  }
                  const bookingDisputeMatch = link.match(/\/bookings\/([a-zA-Z0-9_-]+)\/dispute/);
                  if (bookingDisputeMatch) {
                    navigateTo('dispute-detail', { bookingId: bookingDisputeMatch[1] });
                    return;
                  }
                  const match = link.match(/\/bookings\/([a-zA-Z0-9_-]+)/);
                  if (match) {
                    navigateTo('booking-detail', { bookingId: match[1] });
                  } else if (link === '/notifications') {
                    navigateTo('notifications');
                  }
                }}
              />
              <button
                type="button"
                onClick={() => navigateTo('wallet')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-full text-xs font-bold transition border border-neutral-700"
              >
                <Wallet className="w-3.5 h-3.5 text-teal-400" />
                <span>Wallet</span>
              </button>
              <button
                type="button"
                onClick={() => navigateTo('profile')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-full text-xs font-semibold transition border border-neutral-700"
              >
                <UserIcon className="w-3.5 h-3.5 text-teal-400" />
                <span className="max-w-[90px] truncate">
                  {user.name?.split(' ')[0] || 'Account'}
                </span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-xs text-neutral-400 hover:text-white transition px-2 py-1"
                title="Log out"
              >
                Exit
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigateTo('login')}
                className="text-xs sm:text-sm font-semibold text-white hover:text-neutral-300 transition px-2.5 py-1"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => navigateTo('signup')}
                className="bg-white hover:bg-neutral-200 text-black px-4 py-2 rounded-full font-bold text-xs sm:text-sm transition shadow-xs"
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Screen Router */}
      <main className="flex-1 w-full">
        {currentScreen === 'onboarding' && (
          <OnboardingScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}

        {/* Focused Auth and Form Screens */}
        {[
          'signup',
          'login',
          'forgot-password',
          'reset-password',
          'verify-email',
          'photo-step',
        ].includes(currentScreen) && (
          <div className="max-w-md mx-auto px-4 py-10 w-full">
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
            {currentScreen === 'photo-step' && (
              <PhotoUploadStep
                onComplete={() => {
                  setRequiresPhoto(false);
                  setCurrentScreen('communities');
                }}
              />
            )}
          </div>
        )}

        {/* Catalog, Detail, and Community Screens */}
        {[
          'communities',
          'community-detail',
          'items',
          'item-detail',
          'booking-request',
          'booking-detail',
          'dispute-detail',
          'create-item',
        ].includes(currentScreen) && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
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

            {currentScreen === 'booking-detail' && selectedBookingId && (
              <BookingDetailScreen
                bookingId={selectedBookingId}
                onBack={() => navigateTo('my-bookings')}
                onNavigate={navigateTo}
              />
            )}

            {currentScreen === 'dispute-detail' && (
              <DisputeDetailScreen
                bookingId={selectedBookingId}
                disputeId={selectedDisputeId}
                onBack={() => {
                  if (selectedBookingId) {
                    navigateTo('booking-detail', { bookingId: selectedBookingId });
                  } else {
                    navigateTo('my-bookings');
                  }
                }}
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
          </div>
        )}

        {/* User Account and Dashboard Screens */}
        {['my-bookings', 'wallet', 'profile', 'notifications'].includes(currentScreen) && (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 w-full">
            {currentScreen === 'notifications' && (
              <NotificationsScreen
                onNavigate={(link) => {
                  const disputeMatch = link.match(/\/disputes\/([a-zA-Z0-9_-]+)/);
                  if (disputeMatch) {
                    navigateTo('dispute-detail', { disputeId: disputeMatch[1] });
                    return;
                  }
                  const bookingDisputeMatch = link.match(/\/bookings\/([a-zA-Z0-9_-]+)\/dispute/);
                  if (bookingDisputeMatch) {
                    navigateTo('dispute-detail', { bookingId: bookingDisputeMatch[1] });
                    return;
                  }
                  const match = link.match(/\/bookings\/([a-zA-Z0-9_-]+)/);
                  if (match) {
                    navigateTo('booking-detail', { bookingId: match[1] });
                  }
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

            {currentScreen === 'profile' && (
              <ProfileScreen onNavigate={(screen) => setCurrentScreen(screen)} />
            )}

            {currentScreen === 'wallet' && <WalletScreen />}
          </div>
        )}

        {/* Footer (only on non-onboarding screens) */}
        {currentScreen !== 'onboarding' && (
          <footer className="py-6 text-center text-xs text-neutral-400 pb-24 md:pb-8 border-t border-neutral-100">
            <span>&copy; {new Date().getFullYear()} BorrowLoop • Demo money mode</span>
          </footer>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Uber-styled black bar) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black text-white border-t border-neutral-800 flex items-center justify-around py-2 px-3 shadow-lg md:hidden">
        <button
          type="button"
          onClick={() => {
            setSelectedCommunityId(null);
            setSelectedItemId(null);
            setCurrentScreen('communities');
          }}
          className={`flex flex-col items-center gap-1 p-2 min-w-[56px] focus:outline-none ${
            currentScreen === 'communities' || currentScreen === 'community-detail'
              ? 'text-white font-bold'
              : 'text-neutral-400 hover:text-white'
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
              ? 'text-white font-bold'
              : 'text-neutral-400 hover:text-white'
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
              ? 'text-white font-bold'
              : 'text-neutral-400 hover:text-white'
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
            currentScreen === 'wallet'
              ? 'text-white font-bold'
              : 'text-neutral-400 hover:text-white'
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
            currentScreen === 'profile'
              ? 'text-white font-bold'
              : 'text-neutral-400 hover:text-white'
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
