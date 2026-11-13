/**
 * @file apps/api/src/services/payment/PaymentProvider.js
 * Contract for wallet payment providers in accordance with AGENTS.md Hard Rule 5:
 * "The wallet must sit behind a PaymentProvider interface so a real provider can replace the demo wallet later."
 */

export class PaymentProvider {
  /**
   * Adds funds to a user's wallet.
   *
   * @param {string | import('mongoose').Types.ObjectId} userId
   * @param {number} amountPaise
   * @param {object} [idempotencyContext]
   * @returns {Promise<{ availablePaise: number, frozenPaise: number, pendingPaise: number }>}
   */
  async addFunds(userId, amountPaise, _idempotencyContext = null) {
    throw new Error('PaymentProvider.addFunds must be implemented by subclass');
  }

  /**
   * Withdraws funds from a user's wallet.
   *
   * @param {string | import('mongoose').Types.ObjectId} userId
   * @param {number} amountPaise
   * @param {object} [_idempotencyContext]
   * @returns {Promise<{ availablePaise: number, frozenPaise: number, pendingPaise: number }>}
   */
  async withdraw(userId, amountPaise, _idempotencyContext = null) {
    throw new Error('PaymentProvider.withdraw must be implemented by subclass');
  }

  /**
   * Fetches current wallet balances.
   *
   * @param {string | import('mongoose').Types.ObjectId} _userId
   * @returns {Promise<{ availablePaise: number, frozenPaise: number, pendingPaise: number }>}
   */
  async getBalances(_userId) {
    throw new Error('PaymentProvider.getBalances must be implemented by subclass');
  }
}

export default PaymentProvider;
