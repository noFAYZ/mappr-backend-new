See @README.md for project overview and @package.json for available npm commands for this project.

# Claude Code Configuration

## Project Overview
Backend for Mappr - a comprehensive financial management platform with AI-powered insights, cryptocurrency portfolio tracking, and subscription management. Built with Node.js, TypeScript, and PostgreSQL.

## Development Commands
```bash
# Install dependencies
yarn install

# Start development server (default port 3000)
yarn dev

# Build project
yarn build

# Start production server
yarn start

# Run tests
yarn test

# Type checking
yarn typecheck

# Linting and formatting
yarn lint
yarn lint:fix
yarn format

# Database operations
yarn db:generate    # Generate Prisma client
yarn db:push        # Push schema to database
yarn db:migrate     # Run database migrations
yarn db:studio      # Open Prisma Studio
yarn db:seed        # Seed database with initial data
```

## Current Architecture & Features

### Core Services
- **Authentication**: Better-auth integration with JWT tokens, 2FA support
- **Cryptocurrency**: Multi-chain wallet tracking, DeFi positions, NFTs
- **Subscriptions**: Plan-based subscription management with Stripe integration
- **Usage Tracking**: Feature usage analytics and rate limiting
- **Payment Processing**: Secure payment handling with audit trails

### API Routes
- `/api/v1/auth/*` - Authentication endpoints (better-auth)
- `/api/v1/crypto/*` - Cryptocurrency portfolio management
- `/api/v1/subscriptions/*` - Subscription management
- `/api/v1/payments/*` - Payment processing
- `/api/v1/usage/*` - Usage tracking and analytics
- `/health` - Health check endpoint
- `/docs` - Swagger API documentation (development)

### Project Structure
```
src/
├── app.ts              # Express app configuration
├── server.ts           # Server entry point
├── config/            # Configuration files
│   ├── database.ts    # Database configuration
│   ├── environment.ts # Environment variables
│   ├── plans.ts       # Subscription plan definitions
│   └── swagger.ts     # API documentation setup
├── controllers/       # Request handlers
│   ├── cryptoController.ts
│   ├── paymentController.ts
│   ├── subscriptionController.ts
│   └── usageController.ts
├── services/          # Business logic
│   ├── cryptoService.ts
│   ├── email.ts
│   ├── paymentService.ts
│   ├── subscriptionService.ts
│   └── usageService.ts
├── routes/           # Route definitions
│   ├── api.ts        # Main API routes
│   ├── auth.ts       # Better-auth routes
│   ├── crypto.ts     # Crypto portfolio routes
│   ├── payment.ts    # Payment routes
│   ├── subscription.ts # Subscription routes
│   └── usage.ts      # Usage tracking routes
├── middleware/       # Express middleware
│   ├── auth.ts       # Authentication middleware
│   ├── errorHandler.ts # Error handling
│   ├── planAuth.ts   # Plan-based authorization
│   └── validate.ts   # Request validation
├── lib/             # Library integrations
│   ├── auth.ts      # Better-auth configuration
│   └── auth-client.ts # Auth client utilities
├── types/           # TypeScript type definitions
│   └── crypto.ts    # Crypto-related types
├── utils/           # Utility functions
│   ├── cryptoValidation.ts
│   ├── logger.ts    # Winston logger
│   └── validation.ts # Zod schemas
└── prisma/          # Database operations
    └── seedPlans.ts # Plan seeding script
```

### Database Schema
- **Users**: Authentication, profiles, subscription tracking
- **Financial Accounts**: Traditional bank account integration
- **Crypto Wallets**: Multi-chain cryptocurrency wallet tracking
- **Crypto Assets**: Token/coin information and market data
- **Crypto Positions**: User holdings with P&L tracking
- **Crypto Transactions**: On-chain transaction history
- **NFTs**: Non-fungible token holdings
- **DeFi Positions**: Decentralized finance protocol positions
- **Subscriptions**: Plan-based subscription management
- **Payments**: Payment processing and history
- **Usage Tracking**: Feature usage analytics
- **Audit Logs**: Security and compliance tracking

### Key Technologies
- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Framework**: Express.js with security middleware (helmet, CORS)
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Better-auth with JWT and 2FA
- **Crypto Integration**: Zerion SDK for portfolio data
- **Payment Processing**: Stripe integration
- **Validation**: Zod schemas
- **Logging**: Winston with structured logging
- **Documentation**: Swagger/OpenAPI

### Security Features
- JWT-based authentication with refresh tokens
- Two-factor authentication (2FA) support
- Rate limiting and request validation
- Encrypted sensitive data storage
- Comprehensive audit logging
- Plan-based feature access control
- CORS and security headers

### Development Notes
- Uses path aliases (`@/*`) for clean imports
- Strict TypeScript configuration with comprehensive linting
- Environment-based configuration
- Automatic API documentation generation
- Development server with hot reload
- Database migrations and seeding support

### Environment Requirements
```env
# Database
DATABASE_URL="postgresql://..."

# Authentication (Better-auth)
BETTER_AUTH_SECRET="your-secret-key"
BETTER_AUTH_URL="http://localhost:3000"

# Application
NODE_ENV="development"
PORT=3000
API_VERSION="v1"

# External Services
STRIPE_SECRET_KEY="sk_..."
ZERION_API_KEY="..."
```

### Subscription Plans
- **FREE**: Basic features, limited usage
- **PRO**: Advanced features, higher limits
- **ULTIMATE**: Full feature set, unlimited usage

This is a production-ready fintech backend with comprehensive financial management capabilities, focusing on both traditional banking and cryptocurrency portfolio management with enterprise-grade security and compliance features.
