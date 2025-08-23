import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { bearer } from 'better-auth/plugins/bearer';
import { prisma } from '@/config/database';
import { emailService } from '@/services/email';

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  // Required configuration
  secret: process.env['BETTER_AUTH_SECRET'] || process.env['JWT_SECRET'] || 'fallback-secret-key',
  baseURL: process.env['BETTER_AUTH_BASE_URL'] || `http://localhost:${process.env['PORT'] || 3000}`,

  // Advanced configuration for production
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
    crossSubDomainCookies: {
      enabled: process.env['NODE_ENV'] === 'production',
      ...(process.env['NODE_ENV'] === 'production' && process.env['COOKIE_DOMAIN']
        ? { domain: process.env['COOKIE_DOMAIN'] }
        : {}),
    },
    useSecureCookies: process.env['NODE_ENV'] === 'production',
  },

  // Enhanced security settings
  rateLimit: {
    enabled: true,
    window: 60 * 1000, // 1 minute window
    max: process.env['NODE_ENV'] === 'production' ? 50 : 100, // Stricter in production
  },

  // Session configuration optimized for production
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 24 hours - update session daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes cache
    },
  },

  // Email and password authentication with production settings
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env['NODE_ENV'] === 'production',
    minPasswordLength: 8,
    maxPasswordLength: 128,
    password: {
      hash: async (password: string) => {
        const bcrypt = await import('bcryptjs');
        return bcrypt.hash(password, 12);
      },
      verify: async (data: { password: string; hash: string }) => {
        const bcrypt = await import('bcryptjs');
        return bcrypt.compare(data.password, data.hash);
      },
    },
    sendResetPassword: async ({ user, url }: { user: any; url: string }) => {
      try {
        await emailService.sendPasswordResetEmail(user.email, {
          firstName: user.firstName,
          resetUrl: url,
        });
      } catch (error) {
        console.error('Failed to send password reset email:', error);
        throw new Error('Failed to send password reset email');
      }
    },
    sendVerificationEmail: async ({ user, url }: { user: any; url: string }) => {
      try {
        await emailService.sendEmailVerificationEmail(user.email, {
          firstName: user.firstName,
          verificationUrl: url,
        });
      } catch (error) {
        console.error('Failed to send verification email:', error);
        throw new Error('Failed to send verification email');
      }
    },
  },

  // User configuration with additional fields
  user: {
    additionalFields: {
      firstName: {
        type: 'string',
        required: true,
      },
      lastName: {
        type: 'string',
        required: true,
      },
      phone: {
        type: 'string',
        required: false,
      },
      dateOfBirth: {
        type: 'date',
        required: false,
      },
      role: {
        type: 'string',
        defaultValue: 'USER',
      },
      currentPlan: {
        type: 'string',
        defaultValue: 'FREE',
      },
      monthlyIncome: {
        type: 'number',
        required: false,
      },
      currency: {
        type: 'string',
        defaultValue: 'USD',
      },
      timezone: {
        type: 'string',
        defaultValue: 'UTC',
      },
      profilePicture: {
        type: 'string',
        required: false,
      },
    },
  },

  // Production-ready trusted origins
  trustedOrigins:
    process.env['NODE_ENV'] === 'production'
      ? [process.env['FRONTEND_URL']!, process.env['CORS_ORIGIN']!].filter(Boolean)
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],

  // Enhanced plugins for production features
  plugins: [
    // Two-factor authentication
    twoFactor({
      issuer: process.env['APP_NAME'] || 'Mappr Financial',
    }),

    // Bearer token support for API access
    bearer(),
  ],
});

// Export types for TypeScript
export type Session = typeof auth.$Infer.Session;
export type User = (typeof auth.$Infer.Session)['user'];

// Helper functions
export const getUser = (session: Session | null) => session?.user ?? null;
export const requireAuth = (session: Session | null) => {
  if (!session?.user) {
    throw new Error('Authentication required');
  }
  return session;
};

export const requireRole = (session: Session | null, roles: string[]) => {
  const user = requireAuth(session).user;
  if (!roles.includes((user as any).role || 'USER')) {
    throw new Error('Insufficient permissions');
  }
  return session;
};
