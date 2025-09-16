# DeFi Positions Integration Strategy

## Executive Summary

This document outlines the optimal approach for integrating DeFi position tracking into the existing architecture, leveraging the newly fixed `appBalanceParser.ts` and the existing database schema.

## Current Architecture Analysis

### Database Schema Strengths
- ✅ **Existing DeFi Support**: `DeFiPosition` model already exists with comprehensive fields
- ✅ **Wallet Integration**: Strong relationship between `CryptoWallet` and `DeFiPosition`
- ✅ **Network Support**: `BlockchainNetwork` enum covers major DeFi networks
- ✅ **Job System**: Bull queue system for async processing
- ✅ **Service Layer**: Clean separation with existing `cryptoService.ts`

### Current DeFi Position Model
```prisma
model DeFiPosition {
  id              String            @id @default(cuid())
  walletId        String
  protocolName    String           // e.g., "Uniswap", "AAVE"
  protocolType    String           // e.g., "DEX", "Lending", "Yield"
  contractAddress String           // Protocol contract
  network         BlockchainNetwork
  positionType    String           // e.g., "LP", "Lend", "Borrow"
  poolName        String?          // Pool identifier
  totalValueUsd   Decimal          @db.Decimal(12, 2)
  principalUsd    Decimal?         // Initial investment
  yieldEarned     Decimal?         // Earned yield amount
  yieldEarnedUsd  Decimal?         // Earned yield in USD
  apr             Decimal?         // Annual percentage rate
  apy             Decimal?         // Annual percentage yield
  dailyYield      Decimal?         // Daily yield
  totalReturn     Decimal?         // Total returns
  totalReturnPct  Decimal?         // Return percentage
  assets          Json?            // Detailed asset breakdown
  isActive        Boolean          @default(true)
  canWithdraw     Boolean          @default(true)
  lockupEnd       DateTime?        // Lockup period end
  positionData    Json?            // Raw position data
  lastYieldClaim  DateTime?        // Last yield claim
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  wallet          CryptoWallet     @relation(fields: [walletId], references: [id], onDelete: Cascade)
}
```

## Recommended Integration Approach

### 1. Enhanced Database Schema

#### Option A: Extend Existing DeFiPosition Model (Recommended)
```sql
-- Add new columns to existing DeFiPosition table
ALTER TABLE defi_positions ADD COLUMN zapper_app_id VARCHAR(255);
ALTER TABLE defi_positions ADD COLUMN zapper_group_id VARCHAR(255);
ALTER TABLE defi_positions ADD COLUMN zapper_position_address VARCHAR(255);
ALTER TABLE defi_positions ADD COLUMN meta_type VARCHAR(50); -- SUPPLIED, BORROWED, CLAIMABLE, etc.
ALTER TABLE defi_positions ADD COLUMN underlying_tokens JSONB;
ALTER TABLE defi_positions ADD COLUMN display_props JSONB;
ALTER TABLE defi_positions ADD COLUMN sync_source VARCHAR(20) DEFAULT 'zapper';
ALTER TABLE defi_positions ADD COLUMN external_position_id VARCHAR(255);
ALTER TABLE defi_positions ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for efficient querying
CREATE INDEX idx_defi_positions_zapper_app_id ON defi_positions(zapper_app_id);
CREATE INDEX idx_defi_positions_meta_type ON defi_positions(meta_type);
CREATE INDEX idx_defi_positions_sync_source ON defi_positions(sync_source);
CREATE INDEX idx_defi_positions_last_sync ON defi_positions(last_sync_at);
```

#### Option B: Create DeFiPositionToken Junction Table
```sql
-- For detailed token tracking within positions
CREATE TABLE defi_position_tokens (
  id VARCHAR(32) PRIMARY KEY,
  position_id VARCHAR(32) REFERENCES defi_positions(id) ON DELETE CASCADE,
  token_address VARCHAR(255) NOT NULL,
  token_symbol VARCHAR(50) NOT NULL,
  token_name VARCHAR(255),
  balance DECIMAL(28, 18) NOT NULL,
  balance_usd DECIMAL(12, 2) NOT NULL,
  price DECIMAL(18, 8),
  meta_type VARCHAR(50), -- SUPPLIED, BORROWED, CLAIMABLE
  is_underlying BOOLEAN DEFAULT false,
  level INTEGER DEFAULT 1, -- For nested tokens
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_position_tokens_position_id ON defi_position_tokens(position_id);
CREATE INDEX idx_position_tokens_meta_type ON defi_position_tokens(meta_type);
```

### 2. Service Layer Enhancement

#### A. DeFiPositionService (New Service)
```typescript
// src/services/defiPositionService.ts
export class DeFiPositionService {

  async syncWalletDeFiPositions(walletId: string): Promise<DeFiPosition[]> {
    // 1. Fetch from Zapper using appBalanceParser
    // 2. Transform data to our schema
    // 3. Upsert positions
    // 4. Handle cleanup of stale positions
  }

  async upsertDeFiPosition(
    walletId: string,
    parsedPosition: ParsedPosition,
    appData: ParsedApp
  ): Promise<DeFiPosition> {
    // Intelligent upsert logic
  }

  async getPositionsByWallet(
    walletId: string,
    filters?: DeFiPositionFilters
  ): Promise<DeFiPosition[]> {
    // Query with filters
  }

  async calculatePortfolioMetrics(walletId: string): Promise<PortfolioMetrics> {
    // Calculate yield, returns, health ratios
  }
}
```

#### B. Integration with Existing CryptoService
```typescript
// Extend existing cryptoService.ts
export class CryptoService {
  private defiPositionService: DeFiPositionService;

  async syncWalletData(walletId: string, options: SyncOptions) {
    // Existing sync logic...

    if (options.syncDeFi) {
      await this.defiPositionService.syncWalletDeFiPositions(walletId);
    }
  }
}
```

### 3. Data Transformation Layer

#### A. Zapper Data Mapper
```typescript
// src/utils/defi/zapperMapper.ts
export class ZapperDeFiMapper {

  mapParsedAppToPosition(
    walletId: string,
    app: ParsedApp,
    position: ParsedPosition
  ): DeFiPositionCreateInput {

    return {
      walletId,
      protocolName: app.displayName,
      protocolType: this.inferProtocolType(app.category, position.positionType),
      contractAddress: position.address,
      network: this.mapNetwork(app.network),
      positionType: this.mapPositionType(position.positionType),
      poolName: this.extractPoolName(position),
      totalValueUsd: position.balanceUSD,
      assets: this.serializeAssets(position.tokens),

      // Zapper-specific fields
      zapperAppId: app.slug,
      zapperGroupId: position.groupId,
      zapperPositionAddress: position.address,
      metaType: this.extractMetaType(position),
      underlyingTokens: this.serializeUnderlyingTokens(position.tokens),
      displayProps: position.displayProps,
      syncSource: 'zapper',
      externalPositionId: this.generatePositionId(app, position),
      lastSyncAt: new Date(),
    };
  }

  private inferProtocolType(category?: string, positionType?: string): string {
    // Smart categorization logic
    if (category?.toLowerCase().includes('dex')) return 'DEX';
    if (category?.toLowerCase().includes('lending')) return 'Lending';
    if (positionType === 'app-token' && category?.includes('yield')) return 'Yield';
    return 'Other';
  }
}
```

### 4. Job Processing Enhancement

#### A. Enhanced DeFi Sync Job
```typescript
// Enhance existing cryptoJobs.ts
export class CryptoJobProcessor {

  async processSyncDeFiPositions(job: Job<SyncDeFiJobData>): Promise<void> {
    const { userId, walletId } = job.data;
    const context = this.createJobContext(job);

    try {
      // 1. Get wallet data from Zapper
      const zapperData = await this.zapperService.getAppBalances([address]);

      // 2. Parse using appBalanceParser
      const parsedData = parseAppBalances(zapperData);

      // 3. Extract DeFi-specific positions
      const claimableTokens = getClaimableTokens(parsedData);
      const lpPositions = getLPPositions(parsedData);
      const protocolPositions = getPositionsByProtocol(parsedData);

      // 4. Sync to database
      await this.syncDeFiPositionsToDatabase(walletId, parsedData);

      // 5. Update portfolio metrics
      const netWorth = calculateNetWorth(parsedData);
      await this.updatePortfolioMetrics(walletId, netWorth);

      await this.updateJobStats(context, 'success');

    } catch (error) {
      await this.handleJobError(context, error);
      throw error;
    }
  }

  private async syncDeFiPositionsToDatabase(
    walletId: string,
    parsedData: ParsedAppBalances
  ): Promise<void> {

    const mapper = new ZapperDeFiMapper();
    const positions: DeFiPositionCreateInput[] = [];

    // Process each app and its positions
    for (const app of parsedData.apps) {
      for (const position of app.positions) {
        const mappedPosition = mapper.mapParsedAppToPosition(walletId, app, position);
        positions.push(mappedPosition);
      }
    }

    // Batch upsert with transaction
    await prisma.$transaction(async (tx) => {
      // Mark existing positions as potentially stale
      await tx.deFiPosition.updateMany({
        where: { walletId, syncSource: 'zapper' },
        data: { isActive: false }
      });

      // Upsert new/updated positions
      for (const position of positions) {
        await tx.deFiPosition.upsert({
          where: {
            walletId_contractAddress_network_syncSource: {
              walletId: position.walletId,
              contractAddress: position.contractAddress,
              network: position.network,
              syncSource: 'zapper'
            }
          },
          update: {
            ...position,
            isActive: true,
            updatedAt: new Date()
          },
          create: position
        });
      }

      // Clean up positions that weren't updated (truly stale)
      await tx.deFiPosition.deleteMany({
        where: {
          walletId,
          syncSource: 'zapper',
          isActive: false,
          updatedAt: {
            lt: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
          }
        }
      });
    });
  }
}
```

### 5. API Layer Enhancement

#### A. DeFi-Specific Endpoints
```typescript
// src/controllers/cryptoController.ts - Add methods
export class CryptoController {

  async getWalletDeFiPositions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { walletId } = req.params;
      const filters = GetWalletDeFiQuerySchema.parse(req.query);

      const positions = await cryptoService.getWalletDeFiPositions(
        userId,
        walletId,
        filters
      );

      res.json({
        success: true,
        data: {
          positions,
          summary: this.calculateDeFiSummary(positions),
        }
      });

    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getDeFiAnalytics(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { walletId } = req.params;

      const analytics = await cryptoService.getDeFiAnalytics(userId, walletId);

      res.json({
        success: true,
        data: analytics
      });

    } catch (error) {
      this.handleError(error, res);
    }
  }

  private calculateDeFiSummary(positions: DeFiPosition[]) {
    return {
      totalValueUsd: positions.reduce((sum, p) => sum + Number(p.totalValueUsd), 0),
      totalYieldEarned: positions.reduce((sum, p) => sum + Number(p.yieldEarnedUsd || 0), 0),
      activePositions: positions.filter(p => p.isActive).length,
      protocolCount: new Set(positions.map(p => p.protocolName)).size,
      avgAPY: this.calculateWeightedAverage(positions, 'apy', 'totalValueUsd'),
      positionsByType: this.groupBy(positions, 'positionType'),
      positionsByProtocol: this.groupBy(positions, 'protocolName'),
    };
  }
}
```

### 6. Caching Strategy

#### A. Multi-Level Caching
```typescript
// src/services/defiCacheService.ts
export class DeFiCacheService {
  private redis: Redis;

  async cachePositions(walletId: string, positions: DeFiPosition[], ttl = 300) {
    const key = `defi:positions:${walletId}`;
    await this.redis.setex(key, ttl, JSON.stringify(positions));
  }

  async getCachedPositions(walletId: string): Promise<DeFiPosition[] | null> {
    const key = `defi:positions:${walletId}`;
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  async cacheProtocolMetrics(protocolName: string, metrics: any, ttl = 600) {
    const key = `defi:protocol:${protocolName}`;
    await this.redis.setex(key, ttl, JSON.stringify(metrics));
  }
}
```

### 7. Performance Optimizations

#### A. Batch Processing
- Process multiple wallets in parallel with controlled concurrency
- Use database transactions for atomic updates
- Implement progressive sync (only changed positions)

#### B. Smart Caching
- Cache parsed Zapper responses for 5 minutes
- Cache computed metrics for 10 minutes
- Use Redis for cross-instance caching

#### C. Database Optimizations
- Proper indexing on query fields
- Materialized views for complex analytics
- Partition large tables by date/network

### 8. Error Handling & Monitoring

#### A. Resilient Error Handling
```typescript
export class DeFiSyncErrorHandler {

  async handleSyncError(
    context: JobContext,
    error: Error
  ): Promise<void> {

    if (error instanceof ZapperRateLimitError) {
      // Exponential backoff retry
      throw new RetryableError(error.message, error.retryAfter);
    }

    if (error instanceof ZapperParsingError) {
      // Log but continue - don't fail entire sync
      logger.warn('Position parsing failed', {
        walletId: context.walletId,
        error: error.message,
        rawData: error.rawData
      });
      return;
    }

    // Critical errors - fail the job
    throw error;
  }
}
```

#### B. Monitoring Metrics
- Position sync success rate
- Average sync duration
- Parsing error rates
- Cache hit rates
- Database performance metrics

### 9. Migration Strategy

#### A. Phased Rollout
1. **Phase 1**: Deploy enhanced schema and services
2. **Phase 2**: Migrate existing DeFi data (if any)
3. **Phase 3**: Enable new sync jobs for all users
4. **Phase 4**: Deprecate old DeFi tracking (if applicable)

#### B. Data Migration Script
```typescript
// scripts/migrate-defi-positions.ts
export async function migrateDeFiPositions() {
  const wallets = await prisma.cryptoWallet.findMany({
    where: { isActive: true }
  });

  for (const wallet of wallets) {
    try {
      await cryptoJobProcessor.processSyncDeFiPositions({
        data: {
          userId: wallet.userId,
          walletId: wallet.id,
          forceRefresh: true
        }
      } as Job<SyncDeFiJobData>);

      logger.info(`Migrated DeFi positions for wallet ${wallet.id}`);

    } catch (error) {
      logger.error(`Failed to migrate wallet ${wallet.id}:`, error);
    }
  }
}
```

## Implementation Priority

### High Priority (Week 1)
1. ✅ Fix appBalanceParser.ts types (COMPLETED)
2. Extend DeFiPosition schema
3. Create ZapperDeFiMapper
4. Enhance sync job processor

### Medium Priority (Week 2)
5. Add DeFi-specific API endpoints
6. Implement caching layer
7. Add comprehensive error handling
8. Create migration scripts

### Low Priority (Week 3+)
9. Advanced analytics features
10. Real-time position updates
11. Cross-protocol yield optimization
12. Advanced portfolio rebalancing

## Conclusion

This approach leverages your existing robust architecture while adding sophisticated DeFi position tracking. The key advantages:

- **Minimal Schema Changes**: Extends existing models rather than replacing
- **Type-Safe Integration**: Uses the fixed appBalanceParser with proper TypeScript types
- **Scalable Architecture**: Follows existing patterns for consistency
- **Performance Optimized**: Multi-level caching and batch processing
- **Resilient**: Comprehensive error handling and monitoring

The solution is designed to integrate seamlessly with your current crypto tracking system while providing enterprise-grade DeFi position management.