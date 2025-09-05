import {  CryptoAssetRegistry, BlockchainNetwork, AssetType } from '@prisma/client';
import { prisma } from '@/config/database';
import { logger } from '../utils/logger';

export interface AssetKey {
  symbol: string;
  network: BlockchainNetwork;
  contractAddress?: string | null | undefined;
}

export interface AssetData {
  id: string;
  symbol: string;
  name: string;
  contractAddress?: string | null | undefined;
  decimals: number;
  type: AssetType;
  network: BlockchainNetwork;
  price?: number | null | undefined;
  priceUsd?: number | null | undefined;
  lastPriceUpdate?: Date | null | undefined;
}

class AssetCacheService {
  private cache = new Map<string, AssetData>();
  private pendingCreations = new Map<string, Promise<CryptoAssetRegistry>>();

  private lastCacheRefresh = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly PRICE_UPDATE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

  constructor() {
  
  }

  private getAssetKey(asset: AssetKey): string {
    return `${asset.symbol}_${asset.network}_${asset.contractAddress ?? 'native'}`;
  }

  private shouldUpdatePrice(asset: AssetData): boolean {
    if (!asset.lastPriceUpdate) return true;
    return Date.now() - asset.lastPriceUpdate.getTime() > this.PRICE_UPDATE_THRESHOLD;
  }

  private async refreshCache(): Promise<void> {
    if (Date.now() - this.lastCacheRefresh < this.CACHE_TTL) {
      return;
    }

    try {
      logger.info('🔄 Refreshing asset cache...');
      const assets = await prisma.cryptoAssetRegistry.findMany();
      
      this.cache.clear();
      for (const asset of assets) {
        const key = this.getAssetKey({
          symbol: asset.symbol,
          network: asset.network,
          contractAddress: asset.contractAddress
        });
        this.cache.set(key, {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          contractAddress: asset.contractAddress ?? null,
          decimals: asset.decimals,
          type: asset.type,
          network: asset.network,
          price: asset.price?.toNumber() ?? null,
          priceUsd: asset.priceUsd?.toNumber() ?? null,
          lastPriceUpdate: asset.lastPriceUpdate ?? null
        });
      }

      this.lastCacheRefresh = Date.now();
      logger.info(`✅ Asset cache refreshed with ${assets.length} assets`);
    } catch (error) {
      logger.warn('⚠️ Asset registry table not found, cache disabled until migration completes', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Set cache as refreshed to prevent constant retries
      this.lastCacheRefresh = Date.now();
    }
  }

  async getAsset(assetKey: AssetKey): Promise<AssetData | null> {
    await this.refreshCache();
    
    const key = this.getAssetKey(assetKey);
    return this.cache.get(key) || null;
  }

  async findOrCreateAsset(assetData: {
    symbol: string;
    name: string;
    contractAddress?: string | null | undefined;
    decimals: number;
    type: AssetType;
    network: BlockchainNetwork;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
    description?: string | null | undefined;
    isVerified?: boolean;
  }): Promise<AssetData> {
    const key = this.getAssetKey({
      symbol: assetData.symbol,
      network: assetData.network,
      contractAddress: assetData.contractAddress
    });

    // Check cache first
    let asset = this.cache.get(key);
    if (asset) {
      return asset;
    }

    // Check if we're already creating this asset
    if (this.pendingCreations.has(key)) {
      const createdAsset = await this.pendingCreations.get(key);
      if (createdAsset) {
        asset = {
          id: createdAsset.id,
          symbol: createdAsset.symbol,
          name: createdAsset.name,
          contractAddress: createdAsset.contractAddress ?? null,
          decimals: createdAsset.decimals,
          type: createdAsset.type,
          network: createdAsset.network,
          price: createdAsset.price?.toNumber() ?? null,
          priceUsd: createdAsset.priceUsd?.toNumber() ?? null,
          lastPriceUpdate: createdAsset.lastPriceUpdate ?? null
        };
        this.cache.set(key, asset);
        return asset;
      }
    }

    // Create the asset
    let creationPromise: Promise<any>;
    try {
      // Handle native tokens (contractAddress is null) vs ERC20 tokens differently
      if (!assetData.contractAddress) {
        // For native tokens, find by symbol + network first, then create/update
        const existingAsset = await prisma.cryptoAssetRegistry.findFirst({
          where: {
            symbol: assetData.symbol,
            network: assetData.network,
            contractAddress: null
          }
        });

        if (existingAsset) {
          creationPromise = prisma.cryptoAssetRegistry.update({
            where: { id: existingAsset.id },
            data: {
              name: assetData.name,
              logoUrl: assetData.logoUrl ?? null,
              websiteUrl: assetData.websiteUrl ?? null,
              description: assetData.description ?? null,
              isVerified: assetData.isVerified ?? false,
              updatedAt: new Date()
            }
          });
        } else {
          creationPromise = prisma.cryptoAssetRegistry.create({
            data: {
              symbol: assetData.symbol,
              name: assetData.name,
              contractAddress: null,
              decimals: assetData.decimals,
              type: assetData.type,
              network: assetData.network,
              logoUrl: assetData.logoUrl ?? null,
              websiteUrl: assetData.websiteUrl ?? null,
              description: assetData.description ?? null,
              isVerified: assetData.isVerified ?? false
            }
          });
        }
      } else {
        // For ERC20 tokens, use contractAddress + network
        creationPromise = prisma.cryptoAssetRegistry.upsert({
          where: {
            contractAddress_network: {
              contractAddress: assetData.contractAddress,
              network: assetData.network
            }
          },
          update: {
            name: assetData.name,
            logoUrl: assetData.logoUrl ?? null,
            websiteUrl: assetData.websiteUrl ?? null,
            description: assetData.description ?? null,
            isVerified: assetData.isVerified ?? false,
            updatedAt: new Date()
          },
          create: {
            symbol: assetData.symbol,
            name: assetData.name,
            contractAddress: assetData.contractAddress,
            decimals: assetData.decimals,
            type: assetData.type,
            network: assetData.network,
            logoUrl: assetData.logoUrl ?? null,
            websiteUrl: assetData.websiteUrl ?? null,
            description: assetData.description ?? null,
            isVerified: assetData.isVerified ?? false
          }
        });
      }
    } catch (error) {
      logger.warn('⚠️ Asset registry not available, returning fallback asset', {
        symbol: assetData.symbol,
        network: assetData.network,
        error: error instanceof Error ? error.message : String(error)
      });
      // Return a fallback asset structure
      return {
        id: `fallback_${assetData.symbol}_${assetData.network}_${Date.now()}`,
        symbol: assetData.symbol,
        name: assetData.name,
        contractAddress: assetData.contractAddress ?? null,
        decimals: assetData.decimals,
        type: assetData.type,
        network: assetData.network,
        price: null,
        priceUsd: null,
        lastPriceUpdate: null
      };
    }

    this.pendingCreations.set(key, creationPromise);
    
    try {
      const createdAsset = await creationPromise;
      asset = {
        id: createdAsset.id,
        symbol: createdAsset.symbol,
        name: createdAsset.name,
        contractAddress: createdAsset.contractAddress ?? null,
        decimals: createdAsset.decimals,
        type: createdAsset.type,
        network: createdAsset.network,
        price: createdAsset.price?.toNumber() ?? null,
        priceUsd: createdAsset.priceUsd?.toNumber() ?? null,
        lastPriceUpdate: createdAsset.lastPriceUpdate ?? null
      };
      
      this.cache.set(key, asset);
      return asset;
    } finally {
      this.pendingCreations.delete(key);
    }
  }

  async batchUpdatePrices(priceUpdates: Array<{
    assetKey: AssetKey;
    price?: number;
    priceUsd?: number;
    marketCap?: number;
    volume24h?: number;
    change24h?: number;
  }>): Promise<void> {
    await this.refreshCache();

    // Filter assets that need price updates
    const assetsToUpdate = priceUpdates.filter(update => {
      const key = this.getAssetKey(update.assetKey);
      const asset = this.cache.get(key);
      return asset && this.shouldUpdatePrice(asset);
    });

    if (assetsToUpdate.length === 0) {
      logger.info('⏭️  All asset prices are up to date, skipping batch update');
      return;
    }

    logger.info(`📊 Batch updating prices for ${assetsToUpdate.length} assets`);

    const batchSize = 50;
    for (let i = 0; i < assetsToUpdate.length; i += batchSize) {
      const batch = assetsToUpdate.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (update) => {
        const key = this.getAssetKey(update.assetKey);
        const asset = this.cache.get(key);
        
        if (!asset) return;

        try {
          await prisma.cryptoAssetRegistry.update({
            where: { id: asset.id },
            data: {
              price: update.price ?? null,
              priceUsd: update.priceUsd ?? null,
              marketCap: update.marketCap ?? null,
              volume24h: update.volume24h ?? null,
              change24h: update.change24h ?? null,
              lastPriceUpdate: new Date(),
              priceUpdateCount: { increment: 1 },
              updatedAt: new Date()
            }
          });

          // Update cache
          this.cache.set(key, {
            ...asset,
            price: update.price ?? null,
            priceUsd: update.priceUsd ?? null,
            lastPriceUpdate: new Date()
          });
        } catch (error) {
          logger.error(`Failed to update price for asset ${asset.symbol}:`, error);
        }
      }));
    }

    logger.info(`✅ Batch price update completed for ${assetsToUpdate.length} assets`);
  }

  async batchFindOrCreateAssets(assetsData: Array<{
    symbol: string;
    name: string;
    contractAddress?: string | null | undefined;
    decimals: number;
    type: AssetType;
    network: BlockchainNetwork;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
    description?: string | null | undefined;
    isVerified?: boolean;
  }>): Promise<AssetData[]> {
    const results: AssetData[] = [];
    const batchSize = 20;

    for (let i = 0; i < assetsData.length; i += batchSize) {
      const batch = assetsData.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(assetData => this.findOrCreateAsset(assetData))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // Get cache stats for monitoring
  getCacheStats(): {
    size: number;
    lastRefresh: number;
    pendingCreations: number;
  } {
    return {
      size: this.cache.size,
      lastRefresh: this.lastCacheRefresh,
      pendingCreations: this.pendingCreations.size
    };
  }

  // Clear cache (useful for testing or forced refresh)
  clearCache(): void {
    this.cache.clear();
    this.lastCacheRefresh = 0;
    logger.info('🗑️ Asset cache cleared');
  }
}

export { AssetCacheService };