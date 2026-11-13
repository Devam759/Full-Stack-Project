import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  MONGODB_URI: z
    .string()
    .default('mongodb://127.0.0.1:27018/borrowloop?replicaSet=rs0&directConnection=true'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  EMAIL_PROVIDER_KEY: z.string().optional().default('demo_email_key'),
  EMAIL_FROM: z.string().optional().default('BorrowLoop <noreply@borrowloop.test>'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SENTRY_DSN: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Worker environment configuration validation failed:', parsed.error.format());
  throw new Error('Invalid worker environment configuration');
}

export const config = parsed.data;
export default config;
