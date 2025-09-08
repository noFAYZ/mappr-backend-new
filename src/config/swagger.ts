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
      description: 'User authentication and authorization endpoints'
    },
    {
      name: 'Users',
      description: 'User profile and account management'
    },
    {
      name: 'Account Groups',
      description: 'Organization and categorization of financial accounts and crypto wallets'
    },
    {
      name: 'Financial Accounts',
      description: 'Traditional bank accounts and financial institutions'
    },
    {
      name: 'Crypto Wallets',
      description: 'Cryptocurrency wallets and blockchain assets'
    },
    {
      name: 'Subscriptions',
      description: 'Plan management and billing'
    },
    {
      name: 'Payments',
      description: 'Payment processing and history'
    },
    {
      name: 'Usage',
      description: 'Usage tracking and limits'
    }
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
      BlockchainNetwork: {
        type: 'string',
        enum: [
          'ETHEREUM',
          'POLYGON',
          'BSC',
          'AVALANCHE',
          'ARBITRUM',
          'OPTIMISM',
          'BASE',
          'FANTOM',
          'SOLANA',
        ],
        description: 'Supported blockchain networks',
        example: 'ETHEREUM',
      },
      TokenBalance: {
        type: 'object',
        properties: {
          token_address: {
            type: 'string',
            description: 'Token contract address',
            example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          },
          symbol: {
            type: 'string',
            description: 'Token symbol',
            example: 'USDT',
          },
          name: {
            type: 'string',
            description: 'Token name',
            example: 'Tether USD',
          },
          balance: {
            type: 'string',
            description: 'Raw token balance',
            example: '1000000000',
          },
          balance_formatted: {
            type: 'string',
            description: 'Formatted token balance',
            example: '1000.0',
          },
          decimals: {
            type: 'number',
            description: 'Token decimals',
            example: 6,
          },
          logo: {
            type: 'string',
            nullable: true,
            description: 'Token logo URL',
            example:
              'https://logo.moralis.io/0x1_0xdac17f958d2ee523a2206206994597c13d831ec7_a578c5277503e5b0972f1d9b99c6dd8c',
          },
          verified_contract: {
            type: 'boolean',
            nullable: true,
            description: 'Whether contract is verified',
            example: true,
          },
          possible_spam: {
            type: 'boolean',
            nullable: true,
            description: 'Whether token is potentially spam',
            example: false,
          },
          usd_price: {
            type: 'number',
            nullable: true,
            description: 'Current USD price per token',
            example: 1.0,
          },
          usd_value: {
            type: 'number',
            nullable: true,
            description: 'Total USD value of holdings',
            example: 1000.0,
          },
          percentage_relative_to_total_supply: {
            type: 'number',
            nullable: true,
            description: 'Percentage of total supply held',
            example: 0.001,
          },
        },
        required: ['token_address', 'symbol', 'name', 'balance', 'balance_formatted', 'decimals'],
      },
      NFTMetadata: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            nullable: true,
            description: 'NFT name',
            example: 'Cool NFT #1234',
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'NFT description',
            example: 'A really cool NFT',
          },
          image: {
            type: 'string',
            nullable: true,
            description: 'NFT image URL',
            example: 'https://ipfs.io/ipfs/QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          },
          animation_url: {
            type: 'string',
            nullable: true,
            description: 'NFT animation URL',
          },
          external_url: {
            type: 'string',
            nullable: true,
            description: 'External URL',
          },
          attributes: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: {
                trait_type: { type: 'string' },
                value: { type: 'string' },
              },
            },
            description: 'NFT attributes',
          },
        },
      },
      NFT: {
        type: 'object',
        properties: {
          token_address: {
            type: 'string',
            description: 'NFT contract address',
            example: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
          },
          token_id: {
            type: 'string',
            description: 'NFT token ID',
            example: '1234',
          },
          contract_type: {
            type: 'string',
            description: 'Contract type (ERC721, ERC1155)',
            example: 'ERC721',
          },
          token_uri: {
            type: 'string',
            nullable: true,
            description: 'Token metadata URI',
            example: 'https://ipfs.io/ipfs/QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          },
          metadata: {
            type: 'object',
            nullable: true,
            description: 'Raw metadata',
          },
          normalized_metadata: {
            $ref: '#/components/schemas/NFTMetadata',
            nullable: true,
          },
          amount: {
            type: 'string',
            nullable: true,
            description: 'Amount held (for ERC1155)',
            example: '1',
          },
          name: {
            type: 'string',
            nullable: true,
            description: 'Collection name',
            example: 'Bored Ape Yacht Club',
          },
          symbol: {
            type: 'string',
            nullable: true,
            description: 'Collection symbol',
            example: 'BAYC',
          },
          block_number_minted: {
            type: 'string',
            nullable: true,
            description: 'Block number when minted',
            example: '12345678',
          },
          possible_spam: {
            type: 'boolean',
            nullable: true,
            description: 'Whether NFT is potentially spam',
            example: false,
          },
          verified_collection: {
            type: 'boolean',
            nullable: true,
            description: 'Whether collection is verified',
            example: true,
          },
          floor_price_usd: {
            type: 'number',
            nullable: true,
            description: 'Collection floor price in USD',
            example: 25000.0,
          },
        },
        required: ['token_address', 'token_id', 'contract_type'],
      },
      DeFiProtocol: {
        type: 'object',
        properties: {
          protocol: {
            type: 'string',
            description: 'Protocol name',
            example: 'uniswap-v3',
          },
          total_usd_value: {
            type: 'number',
            description: 'Total USD value in protocol',
            example: 5000.0,
          },
          positions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                tokens: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      symbol: { type: 'string' },
                      balance: { type: 'string' },
                      balance_formatted: { type: 'string' },
                      usd_value: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        required: ['protocol', 'total_usd_value'],
      },
      // Account Groups schemas
      AccountGroup: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Account group unique identifier',
            example: 'clm123abc456def789',
          },
          userId: {
            type: 'string',
            description: 'User ID who owns the group',
            example: 'clm123abc456def789',
          },
          name: {
            type: 'string',
            description: 'Group name',
            example: 'Personal Banking',
            maxLength: 100,
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Group description',
            example: 'Personal checking and savings accounts',
            maxLength: 500,
          },
          icon: {
            type: 'string',
            nullable: true,
            description: 'Group icon (emoji or unicode)',
            example: '🏦',
            maxLength: 50,
          },
          color: {
            type: 'string',
            nullable: true,
            description: 'Group color (hex code)',
            example: '#3B82F6',
            pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
          },
          sortOrder: {
            type: 'integer',
            description: 'Sort order for display',
            example: 0,
            minimum: 0,
          },
          parentId: {
            type: 'string',
            nullable: true,
            description: 'Parent group ID for hierarchical structure',
            example: 'clm123parent456def',
          },
          isDefault: {
            type: 'boolean',
            description: 'Whether this is a system default group',
            example: false,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Creation timestamp',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Last update timestamp',
          },
          financialAccounts: {
            type: 'array',
            description: 'Financial accounts in this group',
            items: {
              $ref: '#/components/schemas/FinancialAccount',
            },
          },
          cryptoWallets: {
            type: 'array',
            description: 'Crypto wallets in this group',
            items: {
              $ref: '#/components/schemas/CryptoWallet',
            },
          },
          children: {
            type: 'array',
            description: 'Child groups (for hierarchical structure)',
            items: {
              $ref: '#/components/schemas/AccountGroup',
            },
          },
          _count: {
            type: 'object',
            description: 'Count of related entities',
            properties: {
              financialAccounts: { type: 'integer' },
              cryptoWallets: { type: 'integer' },
              children: { type: 'integer' },
            },
          },
        },
        required: ['id', 'userId', 'name', 'sortOrder', 'isDefault', 'createdAt', 'updatedAt'],
      },
      CreateAccountGroupRequest: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Group name',
            example: 'Personal Banking',
            minLength: 1,
            maxLength: 100,
          },
          description: {
            type: 'string',
            description: 'Group description (optional)',
            example: 'Personal checking and savings accounts',
            maxLength: 500,
          },
          icon: {
            type: 'string',
            description: 'Group icon (optional)',
            example: '🏦',
            maxLength: 50,
          },
          color: {
            type: 'string',
            description: 'Group color in hex format (optional)',
            example: '#3B82F6',
            pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
          },
          parentId: {
            type: 'string',
            description: 'Parent group ID (optional)',
            example: 'clm123parent456def',
          },
        },
        required: ['name'],
      },
      UpdateAccountGroupRequest: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Updated group name',
            example: 'Business Banking',
            minLength: 1,
            maxLength: 100,
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Updated group description',
            example: 'Business accounts and corporate banking',
            maxLength: 500,
          },
          icon: {
            type: 'string',
            nullable: true,
            description: 'Updated group icon',
            example: '🏢',
            maxLength: 50,
          },
          color: {
            type: 'string',
            nullable: true,
            description: 'Updated group color',
            example: '#10B981',
            pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
          },
          parentId: {
            type: 'string',
            nullable: true,
            description: 'Updated parent group ID',
            example: 'clm123newparent456',
          },
          sortOrder: {
            type: 'integer',
            description: 'Updated sort order',
            example: 1,
            minimum: 0,
          },
        },
      },
      MoveAccountRequest: {
        type: 'object',
        properties: {
          accountId: {
            type: 'string',
            description: 'Account ID to move',
            example: 'clm123account456def',
          },
          groupId: {
            type: 'string',
            nullable: true,
            description: 'Target group ID (null to remove from group)',
            example: 'clm123group456def',
          },
          accountType: {
            type: 'string',
            enum: ['financial', 'crypto'],
            description: 'Type of account to move',
            example: 'financial',
          },
        },
        required: ['accountId', 'accountType'],
      },
      FinancialAccount: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Account unique identifier',
            example: 'clm123account456def',
          },
          name: {
            type: 'string',
            description: 'Account name',
            example: 'Chase Checking',
          },
          type: {
            type: 'string',
            enum: ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'LOAN', 'MORTGAGE', 'CRYPTO'],
            description: 'Account type',
            example: 'CHECKING',
          },
          balance: {
            type: 'number',
            description: 'Account balance',
            example: 1250.50,
          },
          currency: {
            type: 'string',
            description: 'Account currency',
            example: 'USD',
          },
          institutionName: {
            type: 'string',
            nullable: true,
            description: 'Financial institution name',
            example: 'Chase Bank',
          },
          groupId: {
            type: 'string',
            nullable: true,
            description: 'Associated group ID',
            example: 'clm123group456def',
          },
          isActive: {
            type: 'boolean',
            description: 'Whether account is active',
            example: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Creation timestamp',
          },
        },
        required: ['id', 'name', 'type', 'balance', 'currency', 'isActive'],
      },
      CryptoWallet: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Wallet unique identifier',
            example: 'clm123wallet456def',
          },
          name: {
            type: 'string',
            description: 'Wallet name',
            example: 'MetaMask Wallet',
          },
          address: {
            type: 'string',
            description: 'Wallet address',
            example: '0x742d35cc6645c0532351bf5541ad8c1c7b6e90e2',
          },
          network: {
            $ref: '#/components/schemas/BlockchainNetwork',
          },
          type: {
            type: 'string',
            enum: ['HOT_WALLET', 'COLD_WALLET', 'EXCHANGE', 'MULTI_SIG', 'SMART_CONTRACT'],
            description: 'Wallet type',
            example: 'HOT_WALLET',
          },
          totalBalanceUsd: {
            type: 'number',
            description: 'Total balance in USD',
            example: 5000.75,
          },
          groupId: {
            type: 'string',
            nullable: true,
            description: 'Associated group ID',
            example: 'clm123group456def',
          },
          isActive: {
            type: 'boolean',
            description: 'Whether wallet is active',
            example: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Creation timestamp',
          },
        },
        required: ['id', 'name', 'address', 'network', 'type', 'totalBalanceUsd', 'isActive'],
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad Request - Invalid input parameters',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - Authentication required',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
            },
          },
        },
      },
      NotFound: {
        description: 'Not Found - Resource not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
            },
          },
        },
      },
      InternalServerError: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ErrorResponse',
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
