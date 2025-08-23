import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './environment';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Mappr Financial API',
    version: '1.0.0',
    description: 'A comprehensive financial management API with AI-powered insights',
    contact: {
      name: 'Mappr Team',
      email: 'support@mappr.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: `http://localhost:${config.port}`,
      description: 'Development server',
    },
    {
      url: 'https://api.mappr.com',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT Bearer token',
      },
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'Refresh token stored in httpOnly cookie',
      },
    },
    schemas: {
      // Common schemas
      ApiResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            description: 'Indicates if the request was successful',
          },
          message: {
            type: 'string',
            description: 'Response message',
          },
          data: {
            type: 'object',
            description: 'Response data',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Response timestamp',
          },
        },
        required: ['success'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false,
          },
          error: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Error message',
              },
              statusCode: {
                type: 'number',
                description: 'HTTP status code',
              },
              timestamp: {
                type: 'string',
                format: 'date-time',
              },
              suggestions: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Helpful suggestions for resolving the error',
              },
            },
            required: ['message', 'statusCode', 'timestamp'],
          },
        },
        required: ['success', 'error'],
      },
      // User schemas
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'User unique identifier',
            example: 'clm123abc456def789',
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'user@example.com',
          },
          firstName: {
            type: 'string',
            description: 'User first name',
            example: 'John',
          },
          lastName: {
            type: 'string',
            description: 'User last name',
            example: 'Doe',
          },
          role: {
            type: 'string',
            enum: ['USER', 'ADMIN', 'PREMIUM'],
            description: 'User role',
            example: 'USER',
          },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'],
            description: 'User account status',
            example: 'ACTIVE',
          },
          emailVerified: {
            type: 'boolean',
            description: 'Whether user email is verified',
            example: true,
          },
          phone: {
            type: 'string',
            nullable: true,
            description: 'User phone number',
            example: '+1234567890',
          },
          dateOfBirth: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'User date of birth',
          },
          monthlyIncome: {
            type: 'number',
            nullable: true,
            description: 'User monthly income',
            example: 5000.0,
          },
          currency: {
            type: 'string',
            description: 'User preferred currency',
            example: 'USD',
          },
          timezone: {
            type: 'string',
            description: 'User timezone',
            example: 'UTC',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Account creation timestamp',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Last update timestamp',
          },
        },
        required: ['id', 'email', 'firstName', 'lastName', 'role', 'status', 'emailVerified'],
      },
      // Auth request schemas
      RegisterRequest: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'user@example.com',
          },
          password: {
            type: 'string',
            minLength: 8,
            description:
              'User password (min 8 chars, must contain uppercase, lowercase, number, and special character)',
            example: 'SecurePassword123!',
          },
          firstName: {
            type: 'string',
            minLength: 1,
            maxLength: 50,
            description: 'User first name',
            example: 'John',
          },
          lastName: {
            type: 'string',
            minLength: 1,
            maxLength: 50,
            description: 'User last name',
            example: 'Doe',
          },
          phone: {
            type: 'string',
            pattern: '^\\+?[\\d\\s\\-()]+$',
            description: 'User phone number (optional)',
            example: '+1234567890',
          },
          dateOfBirth: {
            type: 'string',
            format: 'date-time',
            description: 'User date of birth (optional)',
          },
        },
        required: ['email', 'password', 'firstName', 'lastName'],
      },
      LoginRequest: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'user@example.com',
          },
          password: {
            type: 'string',
            description: 'User password',
            example: 'SecurePassword123!',
          },
        },
        required: ['email', 'password'],
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Authentication successful',
          },
          data: {
            type: 'object',
            properties: {
              user: {
                $ref: '#/components/schemas/User',
              },
              token: {
                type: 'string',
                description: 'JWT access token',
                example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              },
            },
            required: ['user', 'token'],
          },
        },
        required: ['success', 'data'],
      },
      TokenRefreshRequest: {
        type: 'object',
        properties: {
          refreshToken: {
            type: 'string',
            description: 'Refresh token (can also be sent via cookie)',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
        },
      },
      ForgotPasswordRequest: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'user@example.com',
          },
        },
        required: ['email'],
      },
      ResetPasswordRequest: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Password reset token',
            example: 'abc123def456',
          },
          password: {
            type: 'string',
            minLength: 8,
            description: 'New password',
            example: 'NewSecurePassword123!',
          },
        },
        required: ['token', 'password'],
      },
      ChangePasswordRequest: {
        type: 'object',
        properties: {
          currentPassword: {
            type: 'string',
            description: 'Current password',
            example: 'CurrentPassword123!',
          },
          newPassword: {
            type: 'string',
            minLength: 8,
            description: 'New password',
            example: 'NewSecurePassword123!',
          },
        },
        required: ['currentPassword', 'newPassword'],
      },
      VerifyEmailRequest: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Email verification token',
            example: 'abc123def456',
          },
        },
        required: ['token'],
      },
      UserStats: {
        type: 'object',
        properties: {
          accounts: {
            type: 'integer',
            description: 'Number of user accounts',
            example: 3,
          },
          transactions: {
            type: 'integer',
            description: 'Number of transactions',
            example: 150,
          },
          categories: {
            type: 'integer',
            description: 'Number of categories',
            example: 12,
          },
          budgets: {
            type: 'integer',
            description: 'Number of budgets',
            example: 5,
          },
          goals: {
            type: 'integer',
            description: 'Number of goals',
            example: 3,
          },
        },
        required: ['accounts', 'transactions', 'categories', 'budgets', 'goals'],
      },
      // Payment schemas
      PaymentIntent: {
        type: 'object',
        properties: {
          paymentIntentId: {
            type: 'string',
            description: 'Payment intent ID',
          },
          clientSecret: {
            type: 'string',
            description: 'Client secret for payment processing',
          },
          amount: {
            type: 'number',
            description: 'Amount in cents',
          },
          currency: {
            type: 'string',
            description: 'Currency code',
            example: 'USD',
          },
          requiresPayment: {
            type: 'boolean',
            description: 'Whether payment is required',
          },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Payment unique identifier',
          },
          subscriptionId: {
            type: 'string',
            description: 'Associated subscription ID',
          },
          amount: {
            type: 'number',
            description: 'Payment amount',
          },
          currency: {
            type: 'string',
            description: 'Currency code',
            example: 'USD',
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'],
            description: 'Payment status',
          },
          paymentDate: {
            type: 'string',
            format: 'date-time',
            description: 'Payment date',
          },
          processedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When payment was processed',
          },
          failureReason: {
            type: 'string',
            description: 'Reason for payment failure',
          },
        },
      },
      // Usage schemas
      UsageLimit: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name',
          },
          limit: {
            type: 'number',
            description: 'Maximum allowed usage (-1 for unlimited)',
          },
          current: {
            type: 'number',
            description: 'Current usage count',
          },
          remaining: {
            type: 'number',
            description: 'Remaining usage count (-1 for unlimited)',
          },
          resetDate: {
            type: 'string',
            format: 'date-time',
            description: 'When the limit resets (if applicable)',
          },
        },
        required: ['feature', 'limit', 'current', 'remaining'],
      },
      UsageRecord: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Usage record ID',
          },
          userId: {
            type: 'string',
            description: 'User ID',
          },
          feature: {
            type: 'string',
            description: 'Feature used',
          },
          action: {
            type: 'string',
            description: 'Action performed',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'When the usage occurred',
          },
          metadata: {
            type: 'object',
            description: 'Additional usage metadata',
          },
        },
      },
      // Subscription schemas
      Plan: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Plan unique identifier',
          },
          type: {
            type: 'string',
            enum: ['FREE', 'PRO', 'ULTIMATE'],
            description: 'Plan type',
          },
          name: {
            type: 'string',
            description: 'Plan name',
            example: 'Pro',
          },
          description: {
            type: 'string',
            description: 'Plan description',
          },
          monthlyPrice: {
            type: 'number',
            description: 'Monthly price in USD',
            example: 19.99,
          },
          yearlyPrice: {
            type: 'number',
            description: 'Yearly price in USD',
            example: 199.99,
          },
          popular: {
            type: 'boolean',
            description: 'Whether this plan is marked as popular',
          },
          yearlyDiscount: {
            type: 'number',
            description: 'Yearly discount percentage',
            example: 17,
          },
          trialDays: {
            type: 'integer',
            description: 'Number of trial days',
            example: 14,
          },
          features: {
            type: 'object',
            properties: {
              maxAccounts: {
                type: 'integer',
                description: 'Maximum number of accounts (-1 for unlimited)',
              },
              maxTransactions: {
                type: 'integer',
                description: 'Maximum number of transactions (-1 for unlimited)',
              },
              maxCategories: {
                type: 'integer',
                description: 'Maximum number of categories (-1 for unlimited)',
              },
              maxBudgets: {
                type: 'integer',
                description: 'Maximum number of budgets (-1 for unlimited)',
              },
              maxGoals: {
                type: 'integer',
                description: 'Maximum number of goals (-1 for unlimited)',
              },
              aiInsights: {
                type: 'boolean',
                description: 'AI-powered insights available',
              },
              advancedReports: {
                type: 'boolean',
                description: 'Advanced reporting available',
              },
              prioritySupport: {
                type: 'boolean',
                description: 'Priority customer support',
              },
              apiAccess: {
                type: 'boolean',
                description: 'API access available',
              },
              exportData: {
                type: 'boolean',
                description: 'Data export functionality',
              },
              customCategories: {
                type: 'boolean',
                description: 'Custom categories creation',
              },
            },
          },
        },
      },
      UserSubscription: {
        type: 'object',
        properties: {
          currentPlan: {
            type: 'string',
            enum: ['FREE', 'PRO', 'ULTIMATE'],
            description: 'Current plan type',
          },
          subscription: {
            type: 'object',
            nullable: true,
            properties: {
              id: {
                type: 'string',
                description: 'Subscription ID',
              },
              status: {
                type: 'string',
                enum: ['ACTIVE', 'CANCELLED', 'PAST_DUE', 'TRIAL', 'EXPIRED'],
                description: 'Subscription status',
              },
              billingPeriod: {
                type: 'string',
                enum: ['MONTHLY', 'YEARLY'],
                description: 'Billing period',
              },
              amount: {
                type: 'number',
                description: 'Subscription amount',
              },
              currentPeriodStart: {
                type: 'string',
                format: 'date-time',
                description: 'Current billing period start',
              },
              currentPeriodEnd: {
                type: 'string',
                format: 'date-time',
                description: 'Current billing period end',
              },
              trialEnd: {
                type: 'string',
                format: 'date-time',
                nullable: true,
                description: 'Trial end date',
              },
              cancelAt: {
                type: 'string',
                format: 'date-time',
                nullable: true,
                description: 'Scheduled cancellation date',
              },
            },
          },
        },
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
};

const options = {
  definition: swaggerDefinition,
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API files
};

export const swaggerSpec = swaggerJsdoc(options);
