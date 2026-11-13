/**
 * @file apps/api/src/models/Wallet.js
 * Cached wallet balances per user.
 * Balances are strictly updated atomically within transactions alongside ledger entries.
 */

import mongoose, { Schema, model } from 'mongoose';

const WalletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    availablePaise: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'availablePaise cannot be negative'],
      validate: {
        validator: (v) => Number.isSafeInteger(v) && v >= 0,
        message: 'availablePaise must be a non-negative safe integer',
      },
    },
    frozenPaise: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'frozenPaise cannot be negative'],
      validate: {
        validator: (v) => Number.isSafeInteger(v) && v >= 0,
        message: 'frozenPaise must be a non-negative safe integer',
      },
    },
    pendingPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 0, // Invariant: pendingPaise is strictly locked at 0 in demo mode
      validate: {
        validator: (v) => v === 0,
        message: 'pendingPaise must remain 0',
      },
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  },
);

/**
 * Ensures a wallet document exists for the given user, returning it.
 *
 * @param {string | import('mongoose').Types.ObjectId} userId
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<import('mongoose').Document>}
 */
WalletSchema.statics.getOrCreate = async function (userId, session = null) {
  const query = this.findOne({ userId });
  if (session) {
    query.session(session);
  }
  let wallet = await query;
  if (!wallet) {
    try {
      const created = await this.create(
        [{ userId, availablePaise: 0, frozenPaise: 0, pendingPaise: 0 }],
        session ? { session } : {},
      );
      wallet = created[0];
    } catch (err) {
      // Handle potential duplicate key race
      if (err.code === 11000) {
        const retryQuery = this.findOne({ userId });
        if (session) retryQuery.session(session);
        wallet = await retryQuery;
      } else {
        throw err;
      }
    }
  }
  return wallet;
};

export const Wallet = mongoose.models.Wallet || model('Wallet', WalletSchema);
export default Wallet;
