import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('3000'),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  DATABASE_POOL_SIZE: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('20'),

  // Auth
  JWT_SECRET: z.string().min(32, 'Secret must be at least 32 characters'), // Keep for backward compatibility

  // Security
  BCRYPT_ROUNDS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('12'),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('100'),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // Better Auth
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'Better Auth secret must be at least 32 characters')
    .optional(),
  BETTER_AUTH_BASE_URL: z.string().default('http://localhost:3000'),

  // App Configuration
  APP_NAME: z.string().default('Mappr Financial'),
  FRONTEND_URL: z.string().url().optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
  UPGRADE_URL: z.string().optional(),

  // Cookies
  COOKIE_DOMAIN: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  apiVersion: env.API_VERSION,

  database: {
    url: env.DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
  },

  auth: {
    secret: env.JWT_SECRET,
  },

  security: {
    bcryptRounds: env.BCRYPT_ROUNDS,
  },

  rateLimiting: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  },

  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
  },

  cors: {
    origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
  },

  betterAuth: {
    secret: env.BETTER_AUTH_SECRET || env.JWT_SECRET,
    baseUrl: env.BETTER_AUTH_BASE_URL,
  },

  app: {
    name: env.APP_NAME,
    frontendUrl: env.FRONTEND_URL,
    supportEmail: env.SUPPORT_EMAIL,
    upgradeUrl: env.UPGRADE_URL,
  },

  cookies: {
    domain: env.COOKIE_DOMAIN,
  },
};
