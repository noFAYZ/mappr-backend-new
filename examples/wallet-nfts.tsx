import React, { useState, useMemo, useCallback } from 'react';
import { 
  Grid, 
  List, 
  Search, 
  Filter, 
  SortAsc, 
  SortDesc, 
  Eye,
  ExternalLink,
  Heart,
  Share2,
  MoreHorizontal,
  ImageOff,
  Loader2
} from 'lucide-react';

// Types based on your Prisma schema
interface NFT {
  id: string;
  contractAddress: string;
  tokenId: string;
  standard: 'ERC721' | 'ERC1155' | 'SOLANA_NFT' | 'BTC_ORDINALS';
  network: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  animationUrl?: string;
  externalUrl?: string;
  attributes?: any;
  collectionName?: string;
  collectionSymbol?: string;
  collectionSlug?: string;
  ownerAddress: string;
  quantity: string; // BigInt serialized as string
  transferredAt?: string;
  lastSalePrice?: number;
  lastSalePriceUsd?: number;
  floorPrice?: number;
  floorPriceUsd?: number;
  estimatedValue?: number;
  isSpam: boolean;
  isNsfw: boolean;
  rarity?: string;
  rarityRank?: number;
}

interface NFTFilters {
  search?: string;
  collections?: string[];
  networks?: string[];
  standards?: string[];
  hasPrice?: boolean;
  isSpam?: boolean;
  sortBy?: 'name' | 'estimatedValue' | 'floorPrice' | 'rarity' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

interface NFTImageProps {
  nft: NFT;
  className?: string;
  showVideo?: boolean;
}

// Enhanced NFT Image component with better loading and fallbacks
const NFTImage: React.FC<NFTImageProps> = ({ nft, className = '', showVideo = true }) => {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showFallback, setShowFallback] = useState(false);

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setImageError(true);
    
    // Try fallback after a delay
    setTimeout(() => setShowFallback(true), 500);
  }, []);

  const generateFallbackImage = (nft: NFT) => {
    // Generate a consistent gradient based on token ID
    const hash = nft.tokenId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${hue}, 70%, 60%), hsl(${(hue + 60) % 360}, 70%, 40%))`;
  };

  if (imageError && !showFallback) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${className}`}>
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (imageError || !nft.imageUrl) {
    return (
      <div 
        className={`flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 ${className}`}
        style={{ background: generateFallbackImage(nft) }}
      >
        <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 text-center">
          <ImageOff className="w-8 h-8 mx-auto mb-2" />
          <div className="text-sm font-medium text-white">{nft.name || `#${nft.tokenId}`}</div>
          {nft.collectionName && (
            <div className="text-xs text-white/80">{nft.collectionName}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}
      
      {showVideo && nft.animationUrl && nft.animationUrl.includes('video') ? (
        <video
          src={nft.animationUrl}
          className="w-full h-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          onLoadStart={handleImageLoad}
          onError={handleImageError}
        />
      ) : (
        <img
          src={nft.imageUrl}
          alt={nft.name || `NFT #${nft.tokenId}`}
          className="w-full h-full object-cover transition-transform hover:scale-105"
          loading="lazy"
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
      
      {nft.isNsfw && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
          <div className="text-white text-center">
            <Eye className="w-8 h-8 mx-auto mb-2" />
            <div className="text-sm">NSFW Content</div>
          </div>
        </div>
      )}
    </div>
  );
};

// NFT Card component for grid view
const NFTCard: React.FC<{ nft: NFT; onClick: (nft: NFT) => void }> = ({ nft, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);

  const formatPrice = (price?: number) => {
    if (!price) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const getNetworkBadgeColor = (network: string) => {
    const colors = {
      ETHEREUM: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      POLYGON: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      BSC: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      ARBITRUM: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      SOLANA: 'bg-gradient-to-r from-purple-400 to-pink-400 text-white',
    };
    return colors[network as keyof typeof colors] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  };

  return (
    <div
      className="group bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => onClick(nft)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image Container */}
      <div className="relative aspect-square">
        <NFTImage nft={nft} className="w-full h-full rounded-t-xl" />
        
        {/* Overlay Actions */}
        <div className={`absolute inset-0 bg-black/50 flex items-center justify-center gap-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
          <button className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors">
            <Heart className="w-5 h-5 text-white" />
          </button>
          <button className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors">
            <Share2 className="w-5 h-5 text-white" />
          </button>
          <button className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors">
            <ExternalLink className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Network Badge */}
        <div className="absolute top-3 left-3">
          <span className={`px-2 py-1 text-xs font-medium rounded-md ${getNetworkBadgeColor(nft.network)}`}>
            {nft.network}
          </span>
        </div>

        {/* Rarity Badge */}
        {nft.rarityRank && (
          <div className="absolute top-3 right-3">
            <span className="px-2 py-1 bg-black/70 text-white text-xs font-medium rounded-md backdrop-blur-sm">
              #{nft.rarityRank}
            </span>
          </div>
        )}

        {/* Quantity Badge (for ERC1155) */}
        {nft.standard === 'ERC1155' && nft.quantity !== '1' && (
          <div className="absolute bottom-3 left-3">
            <span className="px-2 py-1 bg-black/70 text-white text-xs font-medium rounded-md backdrop-blur-sm">
              ×{nft.quantity}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Collection Name */}
        {nft.collectionName && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">
            {nft.collectionName}
          </div>
        )}

        {/* NFT Name */}
        <h3 className="font-semibold text-gray-900 dark:text-white truncate mb-2">
          {nft.name || `#${nft.tokenId}`}
        </h3>

        {/* Price Info */}
        <div className="flex items-center justify-between text-sm">
          <div>
            {nft.floorPriceUsd && (
              <div className="text-gray-500 dark:text-gray-400">
                Floor: {formatPrice(nft.floorPriceUsd)}
              </div>
            )}
          </div>
          <div className="text-right">
            {nft.estimatedValue && (
              <div className="font-medium text-gray-900 dark:text-white">
                {formatPrice(nft.estimatedValue)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// NFT List Item component for list view
const NFTListItem: React.FC<{ nft: NFT; onClick: (nft: NFT) => void }> = ({ nft, onClick }) => {
  const formatPrice = (price?: number) => {
    if (!price) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  };

  return (
    <div
      className="group bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => onClick(nft)}
    >
      <div className="flex items-center p-4 gap-4">
        {/* Image */}
        <div className="flex-shrink-0">
          <NFTImage nft={nft} className="w-16 h-16 rounded-lg" showVideo={false} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                {nft.name || `#${nft.tokenId}`}
              </h3>
              {nft.collectionName && (
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {nft.collectionName}
                </p>
              )}
            </div>
            
            {/* Price and Actions */}
            <div className="flex items-center gap-4 ml-4">
              <div className="text-right">
                <div className="font-medium text-gray-900 dark:text-white">
                  {formatPrice(nft.estimatedValue)}
                </div>
                {nft.floorPriceUsd && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Floor: {formatPrice(nft.floorPriceUsd)}
                  </div>
                )}
              </div>
              
              <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <MoreHorizontal className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
              {nft.network}
            </span>
            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
              {nft.standard}
            </span>
            {nft.rarityRank && (
              <span className="px-2 py-1 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded">
                Rank #{nft.rarityRank}
              </span>
            )}
            {nft.quantity !== '1' && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                ×{nft.quantity}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Main NFT Wallet Component
const WalletNFTs: React.FC<{ walletId: string }> = ({ walletId }) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filters, setFilters] = useState<NFTFilters>({
    sortBy: 'estimatedValue',
    sortOrder: 'desc',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);

  // Mock data - replace with actual API call
  const nfts: NFT[] = []; // Your NFT data from API

  const filteredAndSortedNFTs = useMemo(() => {
    let filtered = [...nfts];

    // Apply filters
    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(nft => 
        nft.name?.toLowerCase().includes(search) ||
        nft.collectionName?.toLowerCase().includes(search) ||
        nft.tokenId.toLowerCase().includes(search)
      );
    }

    if (filters.collections?.length) {
      filtered = filtered.filter(nft => 
        nft.collectionSlug && filters.collections!.includes(nft.collectionSlug)
      );
    }

    if (filters.networks?.length) {
      filtered = filtered.filter(nft => filters.networks!.includes(nft.network));
    }

    if (filters.standards?.length) {
      filtered = filtered.filter(nft => filters.standards!.includes(nft.standard));
    }

    if (filters.hasPrice !== undefined) {
      filtered = filtered.filter(nft => filters.hasPrice ? !!nft.estimatedValue : !nft.estimatedValue);
    }

    if (filters.isSpam !== undefined) {
      filtered = filtered.filter(nft => nft.isSpam === filters.isSpam);
    }

    // Apply sorting
    if (filters.sortBy) {
      filtered.sort((a, b) => {
        let aVal: any, bVal: any;
        
        switch (filters.sortBy) {
          case 'name':
            aVal = a.name || a.tokenId;
            bVal = b.name || b.tokenId;
            break;
          case 'estimatedValue':
            aVal = a.estimatedValue || 0;
            bVal = b.estimatedValue || 0;
            break;
          case 'floorPrice':
            aVal = a.floorPriceUsd || 0;
            bVal = b.floorPriceUsd || 0;
            break;
          case 'rarity':
            aVal = a.rarityRank || 999999;
            bVal = b.rarityRank || 999999;
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return filters.sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return filters.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [nfts, filters]);

  const handleNFTClick = (nft: NFT) => {
    setSelectedNFT(nft);
    // Open modal or navigate to NFT detail page
  };

  const updateFilters = (newFilters: Partial<NFTFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const toggleSortOrder = () => {
    setFilters(prev => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          NFT Collection
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {filteredAndSortedNFTs.length} NFTs
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search NFTs..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={filters.search || ''}
              onChange={(e) => updateFilters({ search: e.target.value })}
            />
          </div>
        </div>

        {/* Sort */}
        <div className="flex gap-2">
          <select
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={filters.sortBy}
            onChange={(e) => updateFilters({ sortBy: e.target.value as any })}
          >
            <option value="estimatedValue">Price</option>
            <option value="name">Name</option>
            <option value="floorPrice">Floor Price</option>
            <option value="rarity">Rarity</option>
          </select>
          
          <button
            onClick={toggleSortOrder}
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {filters.sortOrder === 'asc' ? <SortAsc className="w-5 h-5" /> : <SortDesc className="w-5 h-5" />}
          </button>
        </div>

        {/* Filters */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
        >
          <Filter className="w-5 h-5" />
          Filters
        </button>

        {/* View Toggle */}
        <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'} rounded-l-lg transition-colors`}
          >
            <Grid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'} rounded-r-lg transition-colors`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Add filter controls here */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Has Price
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                value={filters.hasPrice?.toString() || 'all'}
                onChange={(e) => updateFilters({ 
                  hasPrice: e.target.value === 'all' ? undefined : e.target.value === 'true' 
                })}
              >
                <option value="all">All NFTs</option>
                <option value="true">With Price</option>
                <option value="false">No Price</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Spam Filter
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                value={filters.isSpam?.toString() || 'false'}
                onChange={(e) => updateFilters({ 
                  isSpam: e.target.value === 'true' 
                })}
              >
                <option value="false">Hide Spam</option>
                <option value="true">Show Only Spam</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* NFT Grid/List */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
          {filteredAndSortedNFTs.map((nft) => (
            <NFTCard key={nft.id} nft={nft} onClick={handleNFTClick} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAndSortedNFTs.map((nft) => (
            <NFTListItem key={nft.id} nft={nft} onClick={handleNFTClick} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredAndSortedNFTs.length === 0 && (
        <div className="text-center py-12">
          <ImageOff className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No NFTs found
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Try adjusting your search or filter criteria.
          </p>
        </div>
      )}
    </div>
  );
};

export default WalletNFTs;