-- Asset Registry Migration Script
-- This script migrates from wallet-specific crypto_assets to global crypto_asset_registry

BEGIN;

-- Step 1: Create the new crypto_asset_registry table
CREATE TABLE IF NOT EXISTS crypto_asset_registry (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    contract_address TEXT,
    decimals INTEGER NOT NULL DEFAULT 18,
    type TEXT NOT NULL,
    network TEXT NOT NULL,
    logo_url TEXT,
    website_url TEXT,
    description TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    price DECIMAL(18,8),
    price_usd DECIMAL(12,2),
    market_cap DECIMAL(15,2),
    volume24h DECIMAL(15,2),
    change24h DECIMAL(8,4),
    last_price_update TIMESTAMP WITH TIME ZONE,
    price_update_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Step 2: Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS crypto_asset_registry_contract_network_key 
    ON crypto_asset_registry (contract_address, network);
CREATE UNIQUE INDEX IF NOT EXISTS crypto_asset_registry_symbol_network_contract_key 
    ON crypto_asset_registry (symbol, network, contract_address);
CREATE INDEX IF NOT EXISTS crypto_asset_registry_symbol_idx ON crypto_asset_registry (symbol);
CREATE INDEX IF NOT EXISTS crypto_asset_registry_network_idx ON crypto_asset_registry (network);
CREATE INDEX IF NOT EXISTS crypto_asset_registry_last_price_update_idx ON crypto_asset_registry (last_price_update);

-- Step 3: Insert deduplicated assets into registry
-- Use ROW_NUMBER to pick the first asset for each contract_address + network combination
WITH deduplicated_assets AS (
    SELECT 
        id,
        symbol,
        name,
        contract_address,
        decimals,
        type,
        network,
        logo_url,
        website_url,
        description,
        is_verified,
        price,
        price_usd,
        market_cap,
        volume24h,
        change24h,
        last_price_update,
        created_at,
        updated_at,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(contract_address, 'native'), network 
            ORDER BY created_at ASC
        ) as rn
    FROM crypto_assets
)
INSERT INTO crypto_asset_registry (
    id, symbol, name, contract_address, decimals, type, network,
    logo_url, website_url, description, is_verified,
    price, price_usd, market_cap, volume24h, change24h,
    last_price_update, price_update_count, created_at, updated_at
)
SELECT 
    id, symbol, name, contract_address, decimals, type, network,
    logo_url, website_url, description, is_verified,
    price, price_usd, market_cap, volume24h, change24h,
    last_price_update, 0, created_at, updated_at
FROM deduplicated_assets 
WHERE rn = 1;

-- Step 4: Create mapping table to track old to new asset ID mappings
CREATE TEMP TABLE asset_id_mapping AS
WITH deduplicated_assets AS (
    SELECT 
        id as old_id,
        COALESCE(contract_address, 'native') as contract_key,
        network,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(contract_address, 'native'), network 
            ORDER BY created_at ASC
        ) as rn
    FROM crypto_assets
),
master_assets AS (
    SELECT 
        id as master_id,
        contract_key,
        network
    FROM deduplicated_assets 
    WHERE rn = 1
)
SELECT 
    ca.id as old_asset_id,
    ma.master_id as new_asset_id
FROM crypto_assets ca
JOIN master_assets ma ON (
    COALESCE(ca.contract_address, 'native') = ma.contract_key 
    AND ca.network = ma.network
);

-- Step 5: Update crypto_positions to reference new assets
UPDATE crypto_positions 
SET asset_id = aim.new_asset_id
FROM asset_id_mapping aim
WHERE crypto_positions.asset_id = aim.old_asset_id
AND aim.old_asset_id != aim.new_asset_id;

-- Step 6: Update crypto_transactions to reference new assets
UPDATE crypto_transactions 
SET asset_id = aim.new_asset_id
FROM asset_id_mapping aim
WHERE crypto_transactions.asset_id = aim.old_asset_id
AND crypto_transactions.asset_id IS NOT NULL
AND aim.old_asset_id != aim.new_asset_id;

-- Step 7: Show migration statistics
SELECT 
    'Migration Statistics' as info,
    (SELECT COUNT(*) FROM crypto_assets) as original_assets,
    (SELECT COUNT(*) FROM crypto_asset_registry) as registry_assets,
    (SELECT COUNT(*) FROM crypto_assets) - (SELECT COUNT(*) FROM crypto_asset_registry) as duplicates_removed,
    (SELECT COUNT(*) FROM asset_id_mapping WHERE old_asset_id != new_asset_id) as references_updated;

COMMIT;

-- Note: Keep crypto_assets table for now as backup
-- To complete migration later:
-- 1. Verify system works correctly
-- 2. DROP TABLE crypto_assets;
-- 3. Update Prisma schema to remove crypto_assets model