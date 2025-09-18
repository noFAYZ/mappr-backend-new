# Mappr Backend Architecture Diagram

## System Overview

Mappr is a comprehensive financial management platform with integrated cryptocurrency portfolio tracking and DeFi position monitoring. The backend follows a microservices-inspired architecture with clear separation of concerns, built on Node.js/TypeScript with Express.js.

## Core Architecture Components

### 1. Application Layer (Express.js)
```
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Application Layer                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Routes        │  │   Controllers   │  │   Middleware    │ │
│  │                 │  │                 │  │                 │ │
│  │ • auth.ts       │  │ • cryptoCont..  │  │ • auth.ts       │ │
│  │ • api.ts        │  │ • adminCont..   │  │ • validate.ts   │ │
│  │ • crypto.ts     │  │ • accountGr..   │  │ • errorHandler  │ │
│  │ • admin.ts      │  │                 │  │ • securityMid.. │ │
│  │ • payment.ts    │  │                 │  │ • cacheMid..    │ │
│  │ • usage.ts      │  │                 │  │ • planAuth.ts   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Service Layer (Business Logic)
```
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Core Services   │  │ Crypto Services │  │ Support Services │ │
│  │                 │  │                 │  │                 │ │
│  │ • email.ts      │  │ • cryptoService │  │ • CacheService  │ │
│  │ • paymentServ.  │  │ • defiAppServ.  │  │ • MonitorServ.  │ │
│  │ • subscriptionS │  │ • zapperService │  │ • PerformanceOpt│ │
│  │ • usageService  │  │ • zerionService │  │ • userSyncProgr│ │
│  │ • accountGrpS.  │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Data Access Layer
```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Access Layer                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Prisma ORM    │  │   Repositories  │  │ External APIs   │ │
│  │                 │  │                 │  │                 │ │
│  │ • Database      │  │ • User Repo     │  │ • Better Auth   │ │
│  │ • Models        │  │ • Crypto Repo   │  │ • Plaid API     │ │
│  │ • Relations     │  │ • DeFi Repo     │  │ • Zapper API    │ │
│  │ • Migrations    │  │ • Analytics Repo│  │ • Zerion API    │ │
│  │                 │  │                 │  │ • Stripe API    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Background Job System
```
┌─────────────────────────────────────────────────────────────────┐
│                  Background Job System                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   BullMQ        │  │   Queue Types   │  │   Workers       │ │
│  │                 │  │                 │  │                 │ │
│  │ • Queue Manager │  │ • crypto-sync   │  │ • cryptoJobs.ts │ │
│  │ • Redis Backend │  │ • crypto-prices │  │ • Price updates │ │
│  │ • Job Priority  │  │ • crypto-analy. │  │ • Data sync     │ │
│  │ • Retry Logic   │  │ • notifications │  │ • Portfolio calcs│ │
│  │ • Metrics       │  │ • maintenance   │  │ • Notifications │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema Architecture

### Core Financial Management
```
User (Financial Accounts)
├── FinancialAccount (Checking, Savings, Credit, Investment)
├── Transaction (Linked to accounts and categories)
├── Category (Hierarchical budget categories)
├── Budget (Spending limits by category/account)
├── Goal (Financial savings goals)
└── AccountGroup (Organize accounts into groups)
```

### Cryptocurrency & DeFi Tracking
```
User (Crypto Portfolio)
├── CryptoWallet (Multi-chain wallet support)
│   ├── CryptoPosition (Token balances across chains)
│   ├── CryptoTransaction (On-chain transaction history)
│   ├── CryptoNFT (NFT holdings with metadata)
│   ├── DeFiPosition (Legacy DeFi positions)
│   ├── DeFiAppPosition (Normalized DeFi app positions)
│   └── CryptoPortfolio (Aggregated portfolio value)
├── DeFiApp (DeFi protocol registry)
├── CryptoAssetRegistry (Global asset master list)
└── CryptoPortfolioSnapshot (Historical portfolio data)
```

### User Management & Authentication
```
User (Profile & Settings)
├── Subscription (Plan management via Stripe)
├── Payment (Payment history and processing)
├── UsageTracking (Feature usage analytics)
├── AuditLog (Security and compliance logging)
├── session (Better Auth sessions)
├── account (OAuth provider connections)
├── verification (Email/phone verification)
└── twoFactor (2FA configuration)
```

## External Integrations

### Authentication & Security
- **Better Auth**: Modern authentication framework
- **Stripe**: Payment processing and subscription management
- **Plaid**: Bank account integration and transaction syncing

### Cryptocurrency Data Providers
- **Zapper API**: DeFi position tracking and protocol integration
- **Zerion API**: Comprehensive portfolio tracking and analytics
- **Multi-chain support**: Ethereum, Polygon, BSC, Arbitrum, Optimism, Avalanche, Solana, Bitcoin, Base, Fantom, and more

### Infrastructure Services
- **Redis**: Caching layer and job queue backend
- **PostgreSQL**: Primary database with Prisma ORM
- **BullMQ**: Background job processing system

## Security Architecture

### Authentication Flow
```
Client Request → Authentication Middleware → Session Validation → Route Handler
     ↓                    ↓                      ↓                    ↓
  JWT/Bearer Token   → Verify Session       → Load User Data    → Process Request
                      → Check Permissions   → Audit Log Entry
                      → Rate Limit Check
```

### Security Measures
- **Helmet**: Security headers configuration
- **CORS**: Cross-origin resource sharing controls
- **Rate Limiting**: API request throttling
- **Input Validation**: Zod schema validation
- **SQL Injection Protection**: Prisma ORM parameterized queries
- **Audit Logging**: Comprehensive action tracking
- **Session Management**: Secure session handling with Better Auth

## Performance Optimization

### Caching Strategy
```
Redis Cache Layers:
├── Asset Price Cache (5-minute TTL)
├── Portfolio Cache (15-minute TTL)
├── API Response Cache (Variable TTL)
├── Session Cache (Session duration)
└── Database Query Cache (Query-specific)
```

### Database Optimization
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Prisma query analysis and optimization
- **Indexing Strategy**: Optimized indexes for common query patterns
- **Read Replicas**: Potential for read scaling (architecture-ready)

### Job Queue System
```
Priority Levels:
├── CRITICAL (100): Price updates, notifications
├── HIGH (75): Wallet sync, transaction updates
├── NORMAL (50): Portfolio calculations, analytics
├── LOW (25): NFT sync, DeFi position updates
└── BACKGROUND (10): Reports, maintenance, cleanup
```

## Monitoring & Observability

### Logging System
- **Winston**: Structured logging with multiple transports
- **Request/Response Logging**: Comprehensive API logging
- **Error Tracking**: Detailed error logging with context
- **Performance Metrics**: Query timing and job processing metrics

### Health Checks
- **Database Connectivity**: Connection pool monitoring
- **Queue Health**: Job queue backlog and processing metrics
- **External API Status**: Third-party service availability
- **System Resources**: Memory, CPU, and disk usage

## API Architecture

### RESTful API Structure
```
/api/v1/
├── auth/              (Authentication endpoints)
├── users/             (User management)
├── crypto/            (Cryptocurrency operations)
├── account-groups/    (Account organization)
├── subscriptions/     (Subscription management)
├── payments/          (Payment processing)
├── usage/             (Usage analytics)
├── admin/             (Administrative functions)
└── health/            (System health checks)
```

### API Features
- **OpenAPI/Swagger**: Auto-generated API documentation
- **Versioning**: API version control (/api/v1/)
- **Error Handling**: Standardized error responses
- **Request Validation**: Input validation with Zod
- **Rate Limiting**: Per-endpoint rate limiting
- **Response Compression**: Gzip compression for responses

## Deployment Architecture

### Environment Support
- **Development**: Hot reload with Nodemon
- **Production**: Optimized builds with PM2 support
- **Testing**: Jest test framework with coverage
- **Docker**: Containerization ready (Dockerfile support)

### Configuration Management
- **Environment Variables**: Secure configuration management
- **Feature Flags**: Conditional feature enablement
- **Multi-tenant Support**: Configurable for different deployments

## Scalability Considerations

### Horizontal Scaling
- **Stateless Design**: Session storage in Redis
- **Load Balancing**: Multiple instance support
- **Database Scaling**: Connection pooling and read replica support
- **Queue Processing**: Distributed job processing

### Performance Scaling
- **Caching Layers**: Multi-level caching strategy
- **Database Optimization**: Query optimization and indexing
- **Background Processing**: Async job processing
- **API Optimization**: Response compression and caching

## Development Workflow

### Code Quality
- **TypeScript**: Type-safe development
- **ESLint**: Code linting and style enforcement
- **Prettier**: Code formatting
- **Testing**: Jest unit and integration tests

### Database Management
- **Prisma Migrations**: Database schema versioning
- **Seed Data**: Development database seeding
- **Schema Documentation**: Auto-generated schema docs

### API Documentation
- **Swagger UI**: Interactive API documentation
- **OpenAPI Spec**: Machine-readable API specification
- **Type Definitions**: TypeScript types for API responses

## Key Architectural Patterns

### 1. Layered Architecture
Clear separation between presentation, business logic, and data access layers

### 2. Repository Pattern
Abstracted data access with repository pattern for better testability

### 3. Service Layer Pattern
Business logic encapsulated in service layers with clear boundaries

### 4. Dependency Injection
Loose coupling through dependency injection where applicable

### 5. Event-Driven Architecture
Background job system enabling event-driven processing

### 6. CQRS Pattern (Partial)
Command Query Responsibility Segregation for read/write operations

## Future Enhancements

### Microservices Transition
- Service decomposition for independent scaling
- Event-driven communication between services
- Container orchestration with Kubernetes

### Advanced Features
- Real-time data streaming with WebSockets
- Machine learning integration for insights
- Advanced analytics and reporting
- Multi-currency and internationalization support

### Performance Improvements
- Read replicas for query scaling
- Advanced caching strategies
- Database sharding for large datasets
- CDN integration for static assets

This architecture provides a solid foundation for a scalable, maintainable, and feature-rich financial management platform with comprehensive cryptocurrency and DeFi integration capabilities.