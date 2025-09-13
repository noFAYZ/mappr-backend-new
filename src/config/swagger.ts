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
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication and authorization',
    },
    {
      name: 'Users',
      description: 'User profile and account management',
    },
    {
      name: 'Account Groups',
      description: 'Organization and categorization of accounts',
    },
    {
      name: 'Crypto',
      description: 'Cryptocurrency wallets, transactions, NFTs, and DeFi',
    },
    {
      name: 'Subscriptions',
      description: 'Plan management and billing',
    },
    {
      name: 'Usage',
      description: 'Usage tracking and limits',
    },
    {
      name: 'Admin Dashboard',
      description: 'Admin dashboard overview and key metrics',
    },
    {
      name: 'Admin Analytics',
      description: 'Advanced analytics and reporting for administrators',
    },
    {
      name: 'Admin User Management',
      description: 'User management and administration functions',
    },
    {
      name: 'Admin System',
      description: 'System monitoring and health checks',
    },
    {
      name: 'Admin Audit',
      description: 'Audit logs and security monitoring',
    },
  ],
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
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['success'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              statusCode: { type: 'number' },
            },
            required: ['message', 'statusCode'],
          },
        },
        required: ['success', 'error'],
      },
      // User schemas
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clm123abc456def789' },
          email: { type: 'string', format: 'email', example: 'user@example.com' },
          firstName: { type: 'string', example: 'John' },
          lastName: { type: 'string', example: 'Doe' },
          role: { type: 'string', enum: ['USER', 'ADMIN', 'PREMIUM'], example: 'USER' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'], example: 'ACTIVE' },
          emailVerified: { type: 'boolean', example: true },
          currency: { type: 'string', example: 'USD' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'email', 'firstName', 'lastName', 'role', 'status', 'emailVerified'],
      },
      // Auth request schemas
      RegisterRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', example: 'user@example.com' },
          password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
          firstName: { type: 'string', minLength: 1, maxLength: 50, example: 'John' },
          lastName: { type: 'string', minLength: 1, maxLength: 50, example: 'Doe' },
        },
        required: ['email', 'password', 'firstName', 'lastName'],
      },
      LoginRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', example: 'user@example.com' },
          password: { type: 'string', example: 'SecurePassword123!' },
        },
        required: ['email', 'password'],
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            },
          },
        },
        required: ['success', 'data'],
      },
      UserStats: {
        type: 'object',
        properties: {
          accounts: { type: 'integer', example: 3 },
          transactions: { type: 'integer', example: 150 },
          categories: { type: 'integer', example: 12 },
          budgets: { type: 'integer', example: 5 },
          goals: { type: 'integer', example: 3 },
          currentPlan: { type: 'string', example: 'PRO' },
        },
        required: ['accounts', 'transactions', 'categories', 'budgets', 'goals'],
      },
      // Payment schemas
      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string', example: 'USD' },
          status: { type: 'string', enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'] },
          paymentDate: { type: 'string', format: 'date-time' },
        },
      },
      // Usage schemas
      UsageLimit: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          limit: { type: 'number' },
          current: { type: 'number' },
          remaining: { type: 'number' },
        },
        required: ['feature', 'limit', 'current', 'remaining'],
      },
      // Subscription schemas
      Plan: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['FREE', 'PRO', 'ULTIMATE'] },
          name: { type: 'string', example: 'Pro' },
          monthlyPrice: { type: 'number', example: 19.99 },
          yearlyPrice: { type: 'number', example: 199.99 },
        },
      },
      Subscription: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'CANCELLED', 'PAST_DUE', 'TRIAL', 'EXPIRED'] },
          billingPeriod: { type: 'string', enum: ['MONTHLY', 'YEARLY'] },
          amount: { type: 'number' },
          currentPeriodEnd: { type: 'string', format: 'date-time' },
        },
      },
      BlockchainNetwork: {
        type: 'string',
        enum: ['ETHEREUM', 'POLYGON', 'BSC', 'AVALANCHE', 'ARBITRUM', 'OPTIMISM', 'BASE', 'FANTOM', 'SOLANA'],
        example: 'ETHEREUM',
      },
      TokenBalance: {
        type: 'object',
        properties: {
          token_address: { type: 'string', example: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
          symbol: { type: 'string', example: 'USDT' },
          name: { type: 'string', example: 'Tether USD' },
          balance_formatted: { type: 'string', example: '1000.0' },
          decimals: { type: 'number', example: 6 },
          usd_price: { type: 'number', example: 1.0 },
          usd_value: { type: 'number', example: 1000.0 },
        },
        required: ['token_address', 'symbol', 'name', 'balance_formatted', 'decimals'],
      },
      NFT: {
        type: 'object',
        properties: {
          token_address: { type: 'string', example: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' },
          token_id: { type: 'string', example: '1234' },
          name: { type: 'string', example: 'Cool NFT #1234' },
          image: { type: 'string', example: 'https://ipfs.io/ipfs/QmXXX...' },
          floor_price_usd: { type: 'number', example: 25000.0 },
        },
        required: ['token_address', 'token_id'],
      },
      DeFiProtocol: {
        type: 'object',
        properties: {
          protocol: { type: 'string', example: 'uniswap-v3' },
          total_usd_value: { type: 'number', example: 5000.0 },
        },
        required: ['protocol', 'total_usd_value'],
      },
      // Account Groups schemas
      AccountGroup: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clm123abc456def789' },
          name: { type: 'string', example: 'Personal Banking' },
          description: { type: 'string', example: 'Personal checking and savings accounts' },
          icon: { type: 'string', example: '🏦' },
          color: { type: 'string', example: '#3B82F6' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'name'],
      },
      CreateAccountGroupRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Personal Banking', minLength: 1, maxLength: 100 },
          description: { type: 'string', example: 'Personal checking and savings accounts' },
          icon: { type: 'string', example: '🏦' },
          color: { type: 'string', example: '#3B82F6' },
        },
        required: ['name'],
      },
      CryptoWallet: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clm123wallet456def' },
          name: { type: 'string', example: 'MetaMask Wallet' },
          address: { type: 'string', example: '0x742d35cc6645c0532351bf5541ad8c1c7b6e90e2' },
          network: { $ref: '#/components/schemas/BlockchainNetwork' },
          totalBalanceUsd: { type: 'number', example: 5000.75 },
        },
        required: ['id', 'name', 'address', 'network', 'totalBalanceUsd'],
      },
      // Portfolio schemas
      PortfolioSummary: {
        type: 'object',
        properties: {
          totalValue: { type: 'number', example: 15000.50 },
          totalAssets: { type: 'integer', example: 25 },
          dailyChange: {
            type: 'object',
            properties: {
              value: { type: 'number', example: 150.25 },
              percentage: { type: 'number', example: 1.05 },
            },
          },
        },
        required: ['totalValue', 'totalAssets'],
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      NotFound: {
        description: 'Not Found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
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

// Define Better Auth endpoints that aren't in route files
const betterAuthPaths = {
  '/api/auth/sign-up': {
    post: {
      summary: 'Register a new user',
      description: 'Create a new user account with email and password',
      tags: ['Authentication'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/RegisterRequest'
            },
            example: {
              email: 'user@example.com',
              password: 'SecurePassword123!',
              firstName: 'John',
              lastName: 'Doe'
            }
          }
        }
      },
      responses: {
        201: {
          description: 'User registered successfully',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AuthResponse'
              }
            }
          }
        },
        400: {
          $ref: '#/components/responses/BadRequest'
        }
      }
    }
  },
  '/api/auth/sign-in': {
    post: {
      summary: 'Sign in user',
      description: 'Authenticate user with email and password',
      tags: ['Authentication'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/LoginRequest'
            },
            example: {
              email: 'user@example.com',
              password: 'SecurePassword123!'
            }
          }
        }
      },
      responses: {
        200: {
          description: 'User signed in successfully',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AuthResponse'
              }
            }
          }
        },
        401: {
          $ref: '#/components/responses/Unauthorized'
        }
      }
    }
  },
  '/api/auth/sign-out': {
    post: {
      summary: 'Sign out user',
      description: 'Sign out the currently authenticated user',
      tags: ['Authentication'],
      security: [{ BearerAuth: [] }],
      responses: {
        200: {
          description: 'User signed out successfully',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ApiResponse'
              }
            }
          }
        }
      }
    }
  },
  '/api/auth/forget-password': {
    post: {
      summary: 'Request password reset',
      description: 'Send password reset email to user',
      tags: ['Authentication'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  example: 'user@example.com'
                }
              },
              required: ['email']
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Password reset email sent',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ApiResponse'
              }
            }
          }
        },
        404: {
          $ref: '#/components/responses/NotFound'
        }
      }
    }
  },
  '/api/auth/reset-password': {
    post: {
      summary: 'Reset password',
      description: 'Reset user password with token from email',
      tags: ['Authentication'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: {
                  type: 'string',
                  example: 'reset-token-here'
                },
                password: {
                  type: 'string',
                  minLength: 8,
                  example: 'NewSecurePassword123!'
                }
              },
              required: ['token', 'password']
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Password reset successfully',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ApiResponse'
              }
            }
          }
        },
        400: {
          $ref: '#/components/responses/BadRequest'
        }
      }
    }
  },
  '/api/auth/verify-email': {
    get: {
      summary: 'Verify email address',
      description: 'Verify user email with token from verification email',
      tags: ['Authentication'],
      parameters: [
        {
          name: 'token',
          in: 'query',
          required: true,
          schema: {
            type: 'string'
          },
          example: 'verification-token-here'
        }
      ],
      responses: {
        200: {
          description: 'Email verified successfully',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ApiResponse'
              }
            }
          }
        },
        400: {
          $ref: '#/components/responses/BadRequest'
        }
      }
    }
  },
  '/api/auth/session': {
    get: {
      summary: 'Get current session',
      description: 'Retrieve the current user session information',
      tags: ['Authentication'],
      security: [{ BearerAuth: [] }],
      responses: {
        200: {
          description: 'Session retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  user: {
                    $ref: '#/components/schemas/User'
                  },
                  session: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      userId: { type: 'string' },
                      expiresAt: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          }
        },
        401: {
          $ref: '#/components/responses/Unauthorized'
        }
      }
    }
  }
};

const options = {
  definition: { 
    ...swaggerDefinition,
    paths: betterAuthPaths 
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API files
};

export const swaggerSpec = swaggerJsdoc(options);
