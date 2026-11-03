import mongoose from 'mongoose';
import config from '../src/config/index.js';
import User from '../src/models/User.js';
import { hashPassword } from '../src/common/crypto.js';
import { createTotpEnrollmentLink } from '../src/modules/portal/portalAuthService.js';

async function createAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@borrowloop.test').toLowerCase();
  const name = process.env.ADMIN_NAME || 'System Admin';
  const password = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

  console.info(`Connecting to MongoDB: ${config.MONGODB_URI.replace(/\/\/.*@/, '//<redacted>@')}`);
  await mongoose.connect(config.MONGODB_URI);

  try {
    let admin = await User.findOne({ email });

    if (!admin) {
      console.info(`Creating new admin user: ${email}`);
      const passwordHash = await hashPassword(password);
      admin = await User.create({
        name,
        email,
        passwordHash,
        role: 'admin',
        emailVerified: true,
        status: 'active',
        termsAcceptedAt: new Date(),
        ageConfirmedAt: new Date(),
      });
      console.info('Admin user created successfully.');
    } else {
      console.info(`User ${email} already exists. Ensuring admin role.`);
      admin.role = 'admin';
      admin.status = 'active';
      admin.emailVerified = true;
      await admin.save();
    }

    // Generate one-time TOTP enrollment link
    const enrollment = await createTotpEnrollmentLink(admin._id);

    console.info('========================================================');
    console.info('ADMIN USER CONFIGURED');
    console.info(`Email: ${admin.email}`);
    console.info(`Password: ${password}`);
    console.info('TOTP Secret (Base32):', enrollment.secretBase32);
    console.info('TOTP Setup URI (for Authenticator app):', enrollment.totpUri);
    console.info('One-time Enrollment Token:', enrollment.enrollmentToken);
    console.info('========================================================');
  } finally {
    await mongoose.disconnect();
    console.info('Disconnected from database.');
  }
}

createAdmin().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
