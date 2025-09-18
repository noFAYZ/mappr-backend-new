-- Performance optimization indexes for Mappr Financial Backend
-- Run this migration after backup

-- =================================
-- CRITICAL PERFORMANCE INDEXES
-- =================================

-- Crypto Wallets Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_wallets_user_active
ON crypto_wallets(userId, isActive)
WHERE isActive = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_wallets_address_network
ON crypto_wallets(address, network);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_wallets_balance_desc
ON crypto_wallets(totalBalanceUsd DESC)
WHERE isActive = true AND totalBalanceUsd > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_wallets_sync_status
ON crypto_wallets(syncStatus, lastSyncAt)
WHERE isActive = true;

-- Crypto Positions Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_positions_wallet_balance
ON crypto_positions(walletId, balanceUsd DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_positions_asset_wallet
ON crypto_positions(assetId, walletId)
WHERE assetId IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_positions_balance_threshold
ON crypto_positions(walletId, balanceUsd)
WHERE balanceUsd > 1;

-- Crypto Transactions Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_transactions_wallet_timestamp
ON crypto_transactions(walletId, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_transactions_hash_network
ON crypto_transactions(hash, network);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_transactions_status_type
ON crypto_transactions(status, type, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_transactions_value_desc
ON crypto_transactions(walletId, valueUsd DESC)
WHERE valueUsd IS NOT NULL;

-- Asset Registry Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_assets_symbol_network
ON crypto_asset_registry(symbol, network);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_assets_price_update
ON crypto_asset_registry(lastPriceUpdate DESC NULLS LAST);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_assets_contract_network
ON crypto_asset_registry(contractAddress, network)
WHERE contractAddress IS NOT NULL;

-- DeFi Positions Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_positions_wallet_active_balance
ON defi_app_positions(walletId, isActive, balanceUSD DESC)
WHERE isActive = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_positions_app_network
ON defi_app_positions(appId, network);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_positions_meta_type
ON defi_app_positions(metaType, balanceUSD DESC)
WHERE isActive = true;

-- DeFi Apps Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_apps_slug_network
ON defi_apps(slug, network);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_apps_category_verified
ON defi_apps(category, isVerified)
WHERE isVerified = true;

-- NFT Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_nfts_wallet_value
ON crypto_nfts(walletId, estimatedValue DESC)
WHERE estimatedValue IS NOT NULL AND estimatedValue > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crypto_nfts_collection_floor
ON crypto_nfts(collectionSlug, floorPriceUsd DESC)
WHERE collectionSlug IS NOT NULL AND NOT isSpam;

-- User & Session Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_expires
ON session(userId, expiresAt DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_token_active
ON session(token)
WHERE expiresAt > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_status
ON users(email, status)
WHERE status = 'ACTIVE';

-- Usage Tracking Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_user_timestamp
ON usage_tracking(userId, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_feature_action
ON usage_tracking(feature, action, timestamp DESC);

-- Subscription & Payment Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_status
ON subscriptions(userId, status)
WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_subscription_date
ON payments(subscriptionId, paymentDate DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status_date
ON payments(status, paymentDate DESC);

-- Account Groups Performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_groups_user_parent
ON account_groups(userId, parentId);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_groups_sort_order
ON account_groups(userId, sortOrder)
WHERE isDefault = false;

-- =================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =================================

-- Portfolio overview queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_overview
ON crypto_positions(walletId, balanceUsd DESC, lastUpdated DESC)
WHERE balanceUsd > 0;

-- Transaction analysis queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_analysis
ON crypto_transactions(walletId, type, timestamp DESC, valueUsd DESC);

-- DeFi position analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_defi_analysis
ON defi_app_positions(walletId, appId, metaType, balanceUSD DESC)
WHERE isActive = true;

-- User activity tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity
ON usage_tracking(userId, feature, timestamp DESC);

-- =================================
-- PARTIAL INDEXES FOR FILTERED QUERIES
-- =================================

-- Active wallets only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_wallets_only
ON crypto_wallets(userId, updatedAt DESC)
WHERE isActive = true AND isWatching = true;

-- High-value positions only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_high_value_positions
ON crypto_positions(walletId, assetId)
WHERE balanceUsd > 100;

-- Recent transactions only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recent_transactions
ON crypto_transactions(walletId, timestamp DESC)
WHERE timestamp > NOW() - INTERVAL '30 days';

-- Active DeFi positions only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_defi_positions
ON defi_app_positions(walletId, balanceUSD DESC)
WHERE isActive = true AND balanceUSD > 10;

-- =================================
-- FUNCTION-BASED INDEXES
-- =================================

-- Lowercase email search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower
ON users(LOWER(email));

-- Normalized address search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallets_address_lower
ON crypto_wallets(LOWER(address), network);

-- =================================
-- BTREE INDEXES FOR SORTING
-- =================================

-- Most common sort patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallets_created_desc
ON crypto_wallets(createdAt DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_updated_desc
ON crypto_positions(lastUpdated DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_timestamp_desc
ON crypto_transactions(timestamp DESC);

-- =================================
-- MONITORING QUERIES
-- =================================

-- Query to check index usage
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0
-- ORDER BY schemaname, tablename;

-- Query to find slow queries
-- SELECT query, mean_exec_time, calls, total_exec_time
-- FROM pg_stat_statements
-- WHERE mean_exec_time > 1000
-- ORDER BY mean_exec_time DESC
-- LIMIT 10;

-- Query to check table sizes
-- SELECT schemaname, tablename,
--        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;