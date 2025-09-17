-- Create BlockchainNetwork enum
CREATE TYPE "BlockchainNetwork" AS ENUM ('ETHEREUM', 'POLYGON', 'BSC', 'ARBITRUM', 'OPTIMISM', 'AVALANCHE', 'SOLANA', 'BITCOIN', 'BASE', 'FANTOM', 'CRONOS', 'GNOSIS', 'AURORA', 'CELO', 'MOONBEAM', 'KAVA');

-- Create DeFiPosition table
CREATE TABLE IF NOT EXISTS "defi_positions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "protocolName" TEXT NOT NULL,
    "protocolType" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "network" "BlockchainNetwork" NOT NULL,
    "positionType" TEXT NOT NULL,
    "poolName" TEXT,
    "totalValueUsd" DECIMAL(12,2) NOT NULL,
    "principalUsd" DECIMAL(12,2),
    "yieldEarned" DECIMAL(12,2),
    "yieldEarnedUsd" DECIMAL(12,2),
    "apr" DECIMAL(8,4),
    "apy" DECIMAL(8,4),
    "dailyYield" DECIMAL(12,2),
    "totalReturn" DECIMAL(12,2),
    "totalReturnPct" DECIMAL(8,4),
    "assets" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canWithdraw" BOOLEAN NOT NULL DEFAULT true,
    "lockupEnd" TIMESTAMP(3),
    "positionData" JSONB,
    "lastYieldClaim" TIMESTAMP(3),
    "zapperAppId" TEXT,
    "zapperGroupId" TEXT,
    "zapperPositionAddress" TEXT,
    "appImageUrl" TEXT,
    "metaType" TEXT,
    "underlyingTokens" JSONB,
    "displayProps" JSONB,
    "syncSource" TEXT NOT NULL DEFAULT 'zapper',
    "externalPositionId" TEXT,
    "lastSyncAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defi_positions_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraint
ALTER TABLE "defi_positions"
ADD CONSTRAINT "defi_positions_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "crypto_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_defi_positions_walletId" ON "defi_positions"("walletId");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_protocolName" ON "defi_positions"("protocolName");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_positionType" ON "defi_positions"("positionType");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_zapperAppId" ON "defi_positions"("zapperAppId");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_metaType" ON "defi_positions"("metaType");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_syncSource" ON "defi_positions"("syncSource");
CREATE INDEX IF NOT EXISTS "idx_defi_positions_lastSyncAt" ON "defi_positions"("lastSyncAt");

-- Create unique constraint
ALTER TABLE "defi_positions"
ADD CONSTRAINT "defi_positions_walletId_contractAddress_network_syncSource_key"
UNIQUE ("walletId", "contractAddress", "network", "syncSource");