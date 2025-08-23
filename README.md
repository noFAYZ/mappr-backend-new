# Mappr Backend - Financial Management API

🚀 **Status: Development Server Ready!** 

A comprehensive financial management backend with AI-powered insights built with Node.js, TypeScript, and PostgreSQL.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0
- PostgreSQL database
- Yarn package manager

### 1. Install Dependencies
```bash
yarn install
```

### 2. Database Setup
1. Create a PostgreSQL database
2. Update the `DATABASE_URL` in `.env` with your database credentials:
```
DATABASE_URL="postgresql://username:password@localhost:5432/your_database_name?schema=public"
```

### 3. Generate Prisma Client & Run Migrations
```bash
yarn db:generate
yarn db:migrate
```

### 4. Start Development Server
```bash
yarn dev
```

The server will start on `http://localhost:3000`

## 📚 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset password
- `POST /api/v1/auth/change-password` - Change password (authenticated)
- `POST /api/v1/auth/verify-email` - Verify email address
- `POST /api/v1/auth/resend-verification` - Resend verification email
- `GET /api/v1/auth/me` - Get current user

### User Management
- `PUT /api/v1/users/profile` - Update user profile
- `DELETE /api/v1/users/account` - Delete user account
- `GET /api/v1/users/stats` - Get user statistics

### Health Check
- `GET /health` - Service health status

## 🔐 Authentication

The API uses JWT-based authentication with access and refresh tokens:
- **Access Token**: Short-lived (15 minutes), sent in Authorization header
- **Refresh Token**: Long-lived (7 days), stored as httpOnly cookie

### Usage Example:
```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "firstName": "John",
    "lastName": "Doe"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'

# Protected endpoint
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🛠️ Development

### Available Scripts
- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn lint` - Run ESLint
- `yarn lint:fix` - Fix ESLint issues
- `yarn test` - Run tests
- `yarn db:generate` - Generate Prisma client
- `yarn db:migrate` - Run database migrations
- `yarn db:push` - Push schema to database
- `yarn db:studio` - Open Prisma Studio

### Database Schema
The application includes comprehensive schemas for:
- **Users**: Authentication and profile management
- **Accounts**: Financial account tracking
- **Transactions**: Financial transaction history
- **Categories**: Transaction categorization
- **Budgets**: Budget management
- **Goals**: Financial goal tracking
- **Audit Logs**: Security and activity tracking

## 🔒 Security Features
- JWT authentication with refresh tokens
- Password hashing with bcrypt
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation with Zod
- SQL injection protection via Prisma ORM

## 📦 Tech Stack
- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JSON Web Tokens
- **Validation**: Zod
- **Logging**: Winston
- **Development**: Nodemon, ESLint, Prettier

## 🌍 Environment Variables

Key environment variables:

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database_name"

# JWT Secrets (change in production!)
JWT_SECRET=your-super-secret-jwt-key-change-in-production-32-chars-min
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production-32-chars-min

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=http://localhost:3000
```

---

# Original Project Overview

## Core Features
- **Bank Integration**: Multi-provider support (Plaid, Teller, Yodlee)
- **Cryptocurrency Tracking**: Multi-chain wallet support and DeFi protocol monitoring
- **AI Analytics**: Transaction categorization and financial insights using OpenAI/Claude APIs
- **Tax Calculations**: Automated tax event detection and reporting
- **Expense Management**: Smart budgeting and spending analysis
- **Security**: PCI DSS compliant with enterprise-grade security measures

## Technology Stack

### Backend Core
- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **Framework**: Express.js with Helmet, CORS, compression
- **Database**: PostgreSQL 15+ with Prisma ORM
- **Caching**: Redis 7+ for sessions and performance
- **Queue**: BullMQ for background job processing
- **Validation**: Zod schemas for all input/output
- **Logging**: Winston with structured logging

### External Integrations
- **Banking**: Plaid, Teller.io, Yodlee SDKs
- **Crypto**: Zerion SDK, direct blockchain RPC calls
- **AI**: OpenAI API, Anthropic Claude API
- **Security**: JWT with refresh tokens, bcrypt (12+ rounds)

### Infrastructure
- **Monitoring**: Sentry for errors, Prometheus for metrics
- **Documentation**: OpenAPI/Swagger specifications
- **Environment**: Docker containers, environment-specific configs

## Architecture Principles

### Security Requirements (CRITICAL)
- All sensitive data encrypted at rest and in transit
- Never store plain text passwords, API keys, or financial data
- Implement proper JWT authentication with refresh token rotation
- Use parameterized queries only (prevent SQL injection)
- Add comprehensive input validation and sanitization
- Implement rate limiting on all endpoints
- Maintain detailed audit logs for all financial operations
- Follow PCI DSS compliance guidelines

### Code Standards
- **TypeScript**: Strict mode enabled, comprehensive type definitions
- **Error Handling**: Custom error classes with proper HTTP status codes
- **Async Operations**: Always use async/await, never callbacks
- **Database**: Use transactions for critical operations, implement soft deletes
- **API Design**: RESTful conventions, consistent response formats
- **Logging**: Structured logging with correlation IDs
- **Documentation**: JSDoc comments for all public methods

### File Structure Patterns
```
src/
├── controllers/     # Thin controllers, delegate to services
├── services/        # Business logic and external API integrations
├── models/         # Prisma schema and database models
├── middleware/     # Authentication, validation, error handling
├── routes/         # Express route definitions
├── utils/          # Helper functions and utilities
├── types/          # TypeScript type definitions
├── config/         # Environment and application configuration
└── tests/          # Unit and integration tests
```

### Response Format Standards
```typescript
// Success Response
{
  success: true,
  data: T,
  message?: string,
  pagination?: {
    page: number,
    limit: number,
    total: number
  }
}

// Error Response
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: any
  }
}
```

## Development Guidelines

### When Creating Services
- Inherit from base service class with common functionality
- Use dependency injection for testability
- Implement comprehensive error handling with custom error types
- Add caching strategies for performance-critical operations
- Use TypeScript interfaces for all method contracts
- Include detailed logging with correlation tracking

### When Creating Controllers
- Keep controllers minimal - delegate business logic to services
- Validate all request data using Zod schemas
- Handle async operations with proper error boundaries
- Use consistent response formatting
- Implement proper HTTP status codes

### When Creating Database Models
- Use Prisma schema with explicit relationships
- Add appropriate indexes for query performance
- Use Decimal type for all monetary values
- Implement audit trails (createdAt, updatedAt, deletedAt)
- Add unique constraints where business logic requires

### Required Environment Variables
```
# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Authentication
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<different-strong-secret>
BCRYPT_ROUNDS=12

# External APIs
PLAID_CLIENT_ID=<plaid-client-id>
PLAID_SECRET=<plaid-secret>
OPENAI_API_KEY=<openai-key>
ANTHROPIC_API_KEY=<anthropic-key>

# Application
NODE_ENV=development|production
PORT=3000
API_VERSION=v1
```

### Performance Requirements
- Implement Redis caching for frequent database queries
- Use background jobs for time-consuming operations
- Optimize database queries with proper indexing and relations
- Implement connection pooling for database connections
- Add response compression for API endpoints

### Testing Requirements
- Unit tests for all service methods
- Integration tests for API endpoints
- Mock all external API calls
- Test authentication and authorization flows
- Validate input/output schemas
- Test error scenarios and edge cases

## Financial Data Handling (CRITICAL)

### Data Security
- Encrypt all PII and financial data using industry-standard algorithms
- Use secure key management for encryption keys
- Implement data retention and deletion policies
- Never log sensitive financial information
- Use tokenization for stored payment methods

### Compliance Requirements
- Follow PCI DSS guidelines for payment data
- Implement GDPR data protection measures
- Maintain SOC 2 Type II compliance standards
- Create audit trails for all data access and modifications
- Implement right-to-be-forgotten functionality

### Transaction Processing
- Use database transactions for all financial operations
- Implement idempotent operations to prevent duplicate processing
- Add comprehensive validation for all financial calculations
- Maintain detailed audit logs with immutable records
- Implement proper error recovery and rollback mechanisms

## Integration Patterns

### Bank API Integration
- Use multiple providers for redundancy (Plaid primary, Teller/Yodlee backup)
- Implement webhook handling for real-time updates
- Add retry logic with exponential backoff
- Normalize data across different providers
- Handle rate limiting and API quotas

### AI Service Integration
- Implement cost-effective API usage patterns
- Add fallback mechanisms for AI service failures
- Cache AI responses when appropriate
- Implement request batching for efficiency
- Monitor and optimize AI API costs

## Deployment Considerations
- Use Docker containers for consistent environments
- Implement proper secret management
- Add health check endpoints for load balancers
- Use environment-specific configuration
- Implement proper logging aggregation and monitoring

---

**Important**: This is a financial application handling sensitive data. Always prioritize security, compliance, and data protection in every implementation decision.