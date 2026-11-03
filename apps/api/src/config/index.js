import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z
    .string()
    .default('mongodb://127.0.0.1:27017/borrowloop?replicaSet=rs0&directConnection=true'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev_jwt_access_secret_min_32_chars_ok'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev_jwt_refresh_secret_min_32_chars_ok'),
  CLIENT_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((val) => val.split(',').map((s) => s.trim())),
  PORTAL_ORIGIN: z.string().default('http://localhost:5174'),
  IMAGE_CLOUD_NAME: z.string().optional().default('demo_cloud'),
  IMAGE_API_KEY: z.string().optional().default('demo_key'),
  IMAGE_API_SECRET: z.string().optional().default('demo_secret'),
  EMAIL_PROVIDER_KEY: z.string().optional().default('demo_email_key'),
  EMAIL_FROM: z.string().optional().default('BorrowLoop <noreply@borrowloop.test>'),
  SENTRY_DSN: z.string().optional().default(''),
  GEOCODER_URL: z.string().optional().default('https://nominatim.openstreetmap.org'),
  GEOCODER_KEY: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment configuration validation failed:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const config = parsed.data;
export default config;
