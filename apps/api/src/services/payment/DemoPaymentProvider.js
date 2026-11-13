/**
 * @file apps/api/src/services/payment/DemoPaymentProvider.js
 * Implementation of PaymentProvider interface for the demo wallet.
 */

import PaymentProvider from './PaymentProvider.js';
import ledgerService from '../../modules/wallet/ledgerService.js';
import Wallet from '../../models/Wallet.js';

export class DemoPaymentProvider extends PaymentProvider {
  /**
   * @param {string | import('mongoose').Types.ObjectId} userId
   * @param {number} amountPaise
   * @param {object} [idempotencyContext]
   */
  async addFunds(userId, amountPaise, idempotencyContext = null) {
    return ledgerService.addDemoFunds({
      userId,
      amountPaise,
      idempotency: idempotencyContext,
    });
  }

  /**
   * @param {string | import('mongoose').Types.ObjectId} userId
   * @param {number} amountPaise
   * @param {object} [idempotencyContext]
   */
  async withdraw(userId, amountPaise, idempotencyContext = null) {
    return ledgerService.withdrawDemoFunds({
      userId,
      amountPaise,
      idempotency: idempotencyContext,
    });
  }

  /**
   * @param {string | import('mongoose').Types.ObjectId} userId
   */
  async getBalances(userId) {
    const wallet = await Wallet.getOrCreate(userId);
    return {
      availablePaise: wallet.availablePaise,
      frozenPaise: wallet.frozenPaise,
      pendingPaise: wallet.pendingPaise,
      demo: true,
    };
  }
}

export const defaultPaymentProvider = new DemoPaymentProvider();
export default defaultPaymentProvider;
