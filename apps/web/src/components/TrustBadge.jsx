/**
 * @file apps/web/src/components/TrustBadge.jsx
 * Displays user trust score (0-100) and rating statistics.
 */

import React from 'react';
import { Shield, Star } from 'lucide-react';

export default function TrustBadge({
  trustScore = 50,
  ratingAvg = 0,
  ratingCount = 0,
  size = 'md',
}) {
  const score = Math.max(0, Math.min(100, Math.round(Number(trustScore) || 50)));

  // Color coding based on trust score
  let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  let shieldColor = 'text-emerald-500';
  if (score < 50) {
    badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
    shieldColor = 'text-rose-500';
  } else if (score < 70) {
    badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    shieldColor = 'text-amber-500';
  } else if (score < 90) {
    badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
    shieldColor = 'text-blue-500';
  }

  const isSmall = size === 'sm';

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${badgeColor} ${
          isSmall ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
        }`}
        title={`Trust Score: ${score}/100`}
      >
        <Shield className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'} ${shieldColor}`} />
        <span>{score} Trust</span>
      </div>

      {ratingCount > 0 && (
        <div
          className={`inline-flex items-center gap-1 text-neutral-700 ${
            isSmall ? 'text-xs' : 'text-sm'
          }`}
        >
          <Star
            className={`${isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-amber-400 fill-amber-400`}
          />
          <span className="font-bold">{Number(ratingAvg || 0).toFixed(1)}</span>
          <span className="text-neutral-400">({ratingCount})</span>
        </div>
      )}
    </div>
  );
}
