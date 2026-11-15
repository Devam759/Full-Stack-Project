import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import User from '../src/models/User.js';
import RefreshToken from '../src/models/RefreshToken.js';
import { signPreTotpToken } from '../src/common/jwt.js';
import { generateTotpSecret } from '../src/services/totpService.js';
import { verifyPortalTotp } from '../src/modules/portal/portalAuthService.js';
import * as OTPAuth from 'otpauth';

let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replSet.getUri());
  await User.init();
  await RefreshToken.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

describe('Portal TOTP Security & Multi-Instance Replay Protection (Sub-step 9a)', () => {
  it('blocks rate-limited attacks after 5 failed TOTP attempts', async () => {
    const { encryptedSecret } = generateTotpSecret('agent_rate_limit@test.com');
    const user = await User.create({
      name: 'Agent Brute Test',
      email: `agent_bl_${Date.now()}@test.com`,
      passwordHash: 'dummy_hash',
      role: 'care_agent',
      status: 'active',
      totpSecret: encryptedSecret,
    });

    const tempToken = signPreTotpToken({ sub: user._id.toString() });

    // 5 invalid attempts
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyPortalTotp({
          tempToken,
          totpCode: '000000',
        }),
      ).rejects.toThrow(/Invalid 6-digit authentication code/);
    }

    // 6th attempt is rate-limited
    await expect(
      verifyPortalTotp({
        tempToken,
        totpCode: '000000',
      }),
    ).rejects.toThrow(/Too many failed TOTP attempts/);
  });

  it('rejects replay of the same TOTP code / time-step', async () => {
    const email = `agent_replay_${Date.now()}@test.com`;
    const { secretBase32, encryptedSecret } = generateTotpSecret(email);

    const user = await User.create({
      name: 'Agent Replay Test',
      email,
      passwordHash: 'dummy_hash',
      role: 'admin',
      status: 'active',
      totpSecret: encryptedSecret,
    });

    // Generate valid TOTP code
    const totp = new OTPAuth.TOTP({
      issuer: 'BorrowLoop',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const validCode = totp.generate();

    const tempToken1 = signPreTotpToken({ sub: user._id.toString() });

    // First use: succeeds
    const session = await verifyPortalTotp({
      tempToken: tempToken1,
      totpCode: validCode,
    });
    expect(session.accessToken).toBeDefined();

    // Replay of the exact same code with a new pre-totp token must be rejected
    const tempToken2 = signPreTotpToken({ sub: user._id.toString() });
    await expect(
      verifyPortalTotp({
        tempToken: tempToken2,
        totpCode: validCode,
      }),
    ).rejects.toThrow(/TOTP code has already been used/);
  });
});
