/**
 * @file apps/api/tests/adminAdsConfiguration.test.js
 * Comprehensive integration tests for Sub-step 9e:
 * Admin Google AdSense configuration, master switch guard, regex validation,
 * audit logging, and public cached config endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { BUSINESS_CONFIG, ERROR_CODES } from '@borrowloop/shared';
import { User, AdSetting, SystemSetting, AuditLog } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import app from '../src/app.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

describe('Sub-step 9e: Admin Ads Configuration API', () => {
  let replSet;
  let adminUser;
  let adminToken;
  let careAgentUser;
  let careAgentToken;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Admin user
    adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin.ads@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    adminToken = signAccessToken(
      { sub: adminUser._id.toString(), role: 'admin' },
      TOKEN_AUDIENCES.PORTAL,
    );

    // Care agent user (forbidden from admin ads routes)
    careAgentUser = await User.create({
      name: 'Care Agent',
      email: 'agent.ads@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'care_agent',
      status: 'active',
      emailVerified: true,
    });
    careAgentToken = signAccessToken(
      { sub: careAgentUser._id.toString(), role: 'care_agent' },
      TOKEN_AUDIENCES.PORTAL,
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  describe('RBAC Verification', () => {
    it('blocks care agents from accessing admin ads endpoints with 403 FORBIDDEN', async () => {
      const getRes = await request(app)
        .get('/v1/admin/ads')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(getRes.status).toBe(403);
      expect(getRes.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

      const patchRes = await request(app)
        .patch('/v1/admin/ads/home_banner')
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', 'idem-agent-ad-1')
        .send({
          enabled: true,
          reason: 'Attempting care agent ad update',
        });
      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

      const masterRes = await request(app)
        .post('/v1/admin/ads/master')
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', 'idem-agent-ad-2')
        .send({
          enabled: true,
          confirm: 'ENABLE_ADS',
          reason: 'Attempting care agent master toggle',
        });
      expect(masterRes.status).toBe(403);
      expect(masterRes.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    });
  });

  describe('Public Configuration Behavior (Master Switch OFF)', () => {
    it('returns masterEnabled: false and empty placements when master switch is off', async () => {
      // By default, no settings in DB -> master is off
      const res = await request(app).get('/v1/ads/config');
      expect(res.status).toBe(200);
      expect(res.body.masterEnabled).toBe(false);
      expect(res.body.placements).toEqual([]);
    });
  });

  describe('Master Switch Validation & Audit Logging', () => {
    it('fails with 400 ADS_CONFIG_INVALID if turning master on without confirm: ENABLE_ADS', async () => {
      const res = await request(app)
        .post('/v1/admin/ads/master')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-master-missing-confirm')
        .send({
          enabled: true,
          confirm: 'WRONG_CONFIRM',
          reason: 'Attempting master toggle without confirmation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.ADS_CONFIG_INVALID);
    });

    it('fails with 400 ADS_CONFIG_INVALID if clientId does not match CLIENT_ID_PATTERN', async () => {
      const res = await request(app)
        .post('/v1/admin/ads/master')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-master-bad-client-id')
        .send({
          enabled: true,
          confirm: 'ENABLE_ADS',
          clientId: 'not-a-valid-ca-pub',
          reason: 'Valid reason with bad client ID',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.ADS_CONFIG_INVALID);
    });

    it('successfully enables master switch, saves clientId, and writes audit log', async () => {
      const res = await request(app)
        .post('/v1/admin/ads/master')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-master-enable-ok')
        .send({
          enabled: true,
          confirm: 'ENABLE_ADS',
          clientId: 'ca-pub-1234567890123456',
          reason: 'Enabling AdSense network across platform',
        });

      expect(res.status).toBe(200);
      expect(res.body.masterEnabled).toBe(true);
      expect(res.body.clientId).toBe('ca-pub-1234567890123456');

      // Verify SystemSetting in DB
      const masterSetting = await SystemSetting.findOne({ key: 'ads.masterEnabled' });
      expect(masterSetting?.value).toBe(true);

      const clientSetting = await SystemSetting.findOne({ key: 'ads.clientId' });
      expect(clientSetting?.value).toBe('ca-pub-1234567890123456');

      // Verify AuditLog record
      const audit = await AuditLog.findOne({
        action: 'ad_master_enabled',
        targetType: 'system_setting',
      });
      expect(audit).toBeTruthy();
      expect(audit.actorId.toString()).toBe(adminUser._id.toString());
      expect(audit.actorRole).toBe('admin');
      expect(audit.after.reason).toBe('Enabling AdSense network across platform');
    });
  });

  describe('Ad Placement Configuration & Validation', () => {
    it('rejects unknown placement with 400 ADS_CONFIG_INVALID', async () => {
      const res = await request(app)
        .patch('/v1/admin/ads/unsupported_placement')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-placement-bad-name')
        .send({
          enabled: true,
          reason: 'Updating invalid placement',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.ADS_CONFIG_INVALID);
    });

    it('rejects invalid slotId with 400 ADS_CONFIG_INVALID', async () => {
      const res = await request(app)
        .patch('/v1/admin/ads/home_banner')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-placement-bad-slot')
        .send({
          enabled: true,
          adsenseSlotId: '123', // too short, requires 6-20 digits
          reason: 'Valid reason with short slot ID',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ERROR_CODES.ADS_CONFIG_INVALID);
    });

    it('successfully configures placement, sets slot ID, and writes audit row', async () => {
      const res = await request(app)
        .patch('/v1/admin/ads/home_banner')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-placement-home-banner-ok')
        .send({
          enabled: true,
          adsenseSlotId: '9876543210',
          reason: 'Activating home banner with production slot ID',
        });

      expect(res.status).toBe(200);
      expect(res.body.placement).toBe('home_banner');
      expect(res.body.enabled).toBe(true);
      expect(res.body.adsenseSlotId).toBe('9876543210');

      // Verify AdSetting in DB
      const adDoc = await AdSetting.findOne({ placement: 'home_banner' });
      expect(adDoc).toBeTruthy();
      expect(adDoc.enabled).toBe(true);
      expect(adDoc.adsenseSlotId).toBe('9876543210');

      // Verify AuditLog
      const audit = await AuditLog.findOne({
        action: 'ad_placement_updated',
        targetType: 'ad_setting',
        targetId: adDoc._id.toString(),
      });
      expect(audit).toBeTruthy();
      expect(audit.actorId.toString()).toBe(adminUser._id.toString());
      expect(audit.after.reason).toBe('Activating home banner with production slot ID');
    });

    it('GET /v1/admin/ads returns full state with all placements', async () => {
      const res = await request(app)
        .get('/v1/admin/ads')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.masterEnabled).toBe(true);
      expect(res.body.clientId).toBe('ca-pub-1234567890123456');
      expect(res.body.placements.length).toBe(BUSINESS_CONFIG.ADS.PLACEMENTS.length);

      const homeBanner = res.body.placements.find((p) => p.placement === 'home_banner');
      expect(homeBanner.enabled).toBe(true);
      expect(homeBanner.adsenseSlotId).toBe('9876543210');

      const sidebar = res.body.placements.find((p) => p.placement === 'item_sidebar');
      expect(sidebar.enabled).toBe(false);
    });
  });

  describe('Public Configuration Behavior (Master Switch ON)', () => {
    it('returns only enabled placements when master switch is on', async () => {
      const res = await request(app).get('/v1/ads/config');
      expect(res.status).toBe(200);
      expect(res.body.masterEnabled).toBe(true);
      expect(res.body.clientId).toBe('ca-pub-1234567890123456');

      // Only home_banner is enabled, item_sidebar & search_results are disabled
      expect(res.body.placements.length).toBe(1);
      expect(res.body.placements[0].placement).toBe('home_banner');
      expect(res.body.placements[0].adsenseSlotId).toBe('9876543210');
      expect(res.body.placements[0].pages).toBeDefined();
    });

    it('hides all placements from public endpoint when master switch is turned off', async () => {
      // Turn master OFF
      const masterRes = await request(app)
        .post('/v1/admin/ads/master')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'idem-master-disable-ok')
        .send({
          enabled: false,
          reason: 'Emergency shutdown of all ad scripts platform-wide',
        });
      expect(masterRes.status).toBe(200);
      expect(masterRes.body.masterEnabled).toBe(false);

      // Query public endpoint
      const res = await request(app).get('/v1/ads/config');
      expect(res.status).toBe(200);
      expect(res.body.masterEnabled).toBe(false);
      expect(res.body.placements).toEqual([]);
    });
  });
});
