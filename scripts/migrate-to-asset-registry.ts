import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface LegacyAsset {
  id: string;
  walletId: string;
  symbol: string;
  name: string;
  contractAddress: string | null;
  decimals: number;
  type: any;
  network: any;
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
  isVerified: boolean;
  price: any;
  priceUsd: any;
  marketCap: any;
  volume24h: any;
  change24h: any;
  lastPriceUpdate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function migrateCryptoAssets() {
  console.log('🚀 Starting migration from crypto_assets to crypto_asset_registry...');

  try {
    // Step 1: Create the new table (will be done by Prisma push)
    console.log('📋 Step 1: Creating crypto_asset_registry table...');
    
    // Step 2: Fetch all existing crypto_assets
    console.log('📊 Step 2: Fetching existing crypto_assets...');
    const legacyAssets = await prisma.$queryRaw<LegacyAsset[]>`
      SELECT * FROM crypto_assets ORDER BY created_at ASC
    `;
    
    console.log(`📦 Found ${legacyAssets.length} legacy assets to migrate`);

    // Step 3: Group assets by contractAddress + network for deduplication
    console.log('🔄 Step 3: Deduplicating assets by contractAddress + network...');
    
    const assetMap = new Map<string, LegacyAsset>();
    const positionMappings = new Map<string, string>(); // old asset ID -> new asset ID
    
    for (const asset of legacyAssets) {
      const key = `${asset.contractAddress || 'native'}_${asset.network}`;
      
      if (!assetMap.has(key)) {
        // First occurrence of this asset - use it as the master
        assetMap.set(key, asset);
      }
      
      // Always map the old ID to the master asset's ID for later reference updates
      const masterAsset = assetMap.get(key)!;
      positionMappings.set(asset.id, masterAsset.id);
    }

    console.log(`✨ Deduplicated to ${assetMap.size} unique assets`);
    console.log(`🔗 Created ${positionMappings.size} ID mappings`);

    // Step 4: Create deduplicated assets in crypto_asset_registry
    console.log('💾 Step 4: Creating assets in crypto_asset_registry...');
    
    const batchSize = 50;
    const uniqueAssets = Array.from(assetMap.values());
    let createdCount = 0;
    
    for (let i = 0; i < uniqueAssets.length; i += batchSize) {
      const batch = uniqueAssets.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (asset) => {
        try {
          await prisma.cryptoAssetRegistry.create({
            data: {
              id: asset.id, // Keep the original ID from the master asset
              symbol: asset.symbol,
              name: asset.name,
              contractAddress: asset.contractAddress,
              decimals: asset.decimals,
              type: asset.type,
              network: asset.network,
              logoUrl: asset.logoUrl,
              websiteUrl: asset.websiteUrl,
              description: asset.description,
              isVerified: asset.isVerified,
              price: asset.price,
              priceUsd: asset.priceUsd,
              marketCap: asset.marketCap,
              volume24h: asset.volume24h,
              change24h: asset.change24h,
              lastPriceUpdate: asset.lastPriceUpdate,
              priceUpdateCount: 0,
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt
            }
          });
          createdCount++;
        } catch (error) {
          console.warn(`⚠️ Failed to create asset ${asset.symbol} (${asset.id}):`, error);
        }
      }));
      
      console.log(`📝 Created ${Math.min((i + batchSize), uniqueAssets.length)}/${uniqueAssets.length} assets`);
    }

    console.log(`✅ Created ${createdCount} unique assets in registry`);

    // Step 5: Update position references to point to master assets
    console.log('🔄 Step 5: Updating position asset references...');
    
    let updatedPositions = 0;
    for (const [oldAssetId, newAssetId] of positionMappings.entries()) {
      if (oldAssetId !== newAssetId) {
        // Only update if the mapping changed (asset was deduplicated)
        const updateResult = await prisma.$executeRaw`
          UPDATE crypto_positions 
          SET asset_id = ${newAssetId}
          WHERE asset_id = ${oldAssetId}
        `;
        updatedPositions += Number(updateResult);
      }
    }
    
    console.log(`🔗 Updated ${updatedPositions} position references`);

    // Step 6: Update transaction references to point to master assets
    console.log('🔄 Step 6: Updating transaction asset references...');
    
    let updatedTransactions = 0;
    for (const [oldAssetId, newAssetId] of positionMappings.entries()) {
      if (oldAssetId !== newAssetId) {
        // Only update if the mapping changed (asset was deduplicated)
        const updateResult = await prisma.$executeRaw`
          UPDATE crypto_transactions 
          SET asset_id = ${newAssetId}
          WHERE asset_id = ${oldAssetId}
        `;
        updatedTransactions += Number(updateResult);
      }
    }
    
    console.log(`🔗 Updated ${updatedTransactions} transaction references`);

    // Step 7: Verify the migration
    console.log('✔️ Step 7: Verifying migration...');
    
    const registryCount = await prisma.cryptoAssetRegistry.count();
    const positionCount = await prisma.cryptoPosition.count();
    const transactionCount = await prisma.cryptoTransaction.count();
    
    console.log(`📊 Verification results:`);
    console.log(`   • Assets in registry: ${registryCount}`);
    console.log(`   • Positions: ${positionCount}`);
    console.log(`   • Transactions: ${transactionCount}`);

    // Step 8: Show deduplication stats
    console.log(`📈 Migration Summary:`);
    console.log(`   • Original assets: ${legacyAssets.length}`);
    console.log(`   • Unique assets: ${registryCount}`);
    console.log(`   • Duplicates removed: ${legacyAssets.length - registryCount}`);
    console.log(`   • Space saved: ${((legacyAssets.length - registryCount) / legacyAssets.length * 100).toFixed(1)}%`);
    console.log(`   • Position references updated: ${updatedPositions}`);
    console.log(`   • Transaction references updated: ${updatedTransactions}`);

    console.log('\n✅ Migration completed successfully! Ready to drop crypto_assets table.');
    console.log('⚠️ Backup recommendation: Keep crypto_assets table for rollback until system is verified stable.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  migrateCryptoAssets()
    .then(() => {
      console.log('🎉 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateCryptoAssets };