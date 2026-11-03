import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import { hashPassword } from '../src/common/crypto.js';
import { isValidCloudinaryPhotoUrl } from '../src/services/uploadService.js';

describe('Uploads Signature & URL Validation (Phase 1)', () => {
  let userToken;

  beforeAll(async () => {
    await setupTestDB();
    const passwordHash = await hashPassword('UserPassword123!');
    await User.create({
      name: 'Upload Tester',
      email: 'uploader@example.com',
      passwordHash,
      role: 'user',
    });

    const loginRes = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'uploader@example.com', password: 'UserPassword123!' });

    userToken = loginRes.body.accessToken;
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  it('POST /v1/uploads/sign generates signed Cloudinary params with metadata stripping', async () => {
    const res = await request(app)
      .post('/v1/uploads/sign')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ type: 'profile' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('signature');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body.folder).toBe('borrowloop/profiles');
    expect(res.body.allowedFormats).toEqual(['jpg', 'jpeg', 'png', 'webp']);
  });

  it('isValidCloudinaryPhotoUrl accepts only our Cloudinary account, correct folder, and valid format', () => {
    const validUrl =
      'https://res.cloudinary.com/demo_cloud/image/upload/v1234567890/borrowloop/profiles/avatar.jpg';
    expect(isValidCloudinaryPhotoUrl(validUrl, 'profile')).toBe(true);

    const wrongCloud =
      'https://res.cloudinary.com/attacker_cloud/image/upload/borrowloop/profiles/avatar.jpg';
    expect(isValidCloudinaryPhotoUrl(wrongCloud, 'profile')).toBe(false);

    const wrongFolder =
      'https://res.cloudinary.com/demo_cloud/image/upload/random_folder/avatar.jpg';
    expect(isValidCloudinaryPhotoUrl(wrongFolder, 'profile')).toBe(false);

    const invalidExtension =
      'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/virus.exe';
    expect(isValidCloudinaryPhotoUrl(invalidExtension, 'profile')).toBe(false);
  });
});
