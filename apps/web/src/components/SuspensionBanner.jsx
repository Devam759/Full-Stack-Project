/**
 * @file apps/web/src/components/SuspensionBanner.jsx
 * Banner informing suspended or banned users of account restrictions.
 */

import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

export default function SuspensionBanner({ user }) {
  if (!user) return null;

  const isBanned = user.status === 'banned';
  const isSuspended = user.banUntil && new Date(user.banUntil) > new Date();

  if (!isBanned && !isSuspended) return null;

  if (isBanned) {
    return (
      <div className="bg-rose-50 border-b border-rose-200 px-4 py-3 text-rose-800 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
        <div className="text-sm">
          <span className="font-semibold">Account Permanently Banned:</span> Your account has been
          banned due to policy violations. You can still withdraw your available wallet balance.
        </div>
      </div>
    );
  }

  const expiryDate = new Date(user.banUntil).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-900 flex items-center gap-3">
      <Clock className="w-5 h-5 text-amber-600 shrink-0" />
      <div className="text-sm">
        <span className="font-semibold">Account Temporarily Suspended:</span> New bookings and item
        listings are paused until <span className="font-medium underline">{expiryDate}</span>. You
        can still return items you currently hold and withdraw available wallet funds.
      </div>
    </div>
  );
}
