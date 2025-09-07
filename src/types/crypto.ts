import {
  WalletType,
  BlockchainNetwork,
  AssetType,
  TransactionType,
  TransactionStatus,
  NFTStandard,
} from '@prisma/client';

// ===============================
// ZERION TRANSACTION DATA TYPES
// ===============================

export interface FungibleInfo {
  name?: string;
  symbol?: string;
  description?: string | null;
  icon?: {
    url: string | null;
  };
  flags?: {
    verified: boolean;
  };
  implementations?: Array<{
    chain_id: string;
    address?: string;
    decimals: number;
  }>;
}

export interface Quantity {
  int: string;
  decimals: number;
  float: number;
  numeric: string;
}

export interface Fee {
  fungible_info?: FungibleInfo;
  quantity?: Quantity;
  price: number;
  value: number;
}

export interface NftContentItem {
  url: string;
  content_type?: string;
}

export interface NftContent {
  preview?: NftContentItem;
  detail?: NftContentItem;
  audio?: NftContentItem;
  video?: NftContentItem;
}

export interface NftInfo {
  contract_address: string;
  token_id: string | null;
  name?: string;
  interface?: 'erc721' | 'erc1155';
  content?: NftContent;
  flags?: {
    is_spam?: boolean;
  };
}

export interface Transfer {
  fungible_info?: FungibleInfo;
  nft_info?: NftInfo;
  direction: 'in' | 'out' | 'self';
  quantity: Quantity;
  value: number;
  price: number;
  sender: string;
  recipient: string;
  act_id?: string;
}

export interface Approval {
  fungible_info?: FungibleInfo;
  nft_info?: NftInfo;
  quantity: Quantity;
  sender: string;
  act_id?: string;
}

export interface CollectionInfo {
  id: string;
  name: string;
  icon_url?: string;
}

export interface CollectionApproval {
  collection_info?: CollectionInfo;
  cancelled: boolean;
  spender: string;
  act_id: string;
}

export interface Method {
  id?: string;
  name?: string;
}

export interface ApplicationMetadata {
  name?: string;
  icon?: {
    url: string | null;
  };
  contract_address?: string;
  method?: Method;
}

export interface Flags {
  is_trash?: boolean;
}

export interface Act {
  id: string;
  type:
    | 'send'
    | 'receive'
    | 'trade'
    | 'deposit'
    | 'withdraw'
    | 'approve'
    | 'execute'
    | 'deploy'
    | 'mint'
    | 'burn'
    | 'claim';
  application_metadata?: ApplicationMetadata;
}

export interface TransactionAttributes {
  operation_type?:
    | 'approve'
    | 'borrow'
    | 'burn'
    | 'cancel'
    | 'claim'
    | 'deploy'
    | 'deposit'
    | 'execute'
    | 'mint'
    | 'receive'
    | 'repay'
    | 'send'
    | 'stake'
    | 'trade'
    | 'unstake'
    | 'withdraw';
  hash: string;
  mined_at_block: number;
  mined_at: string;
  sent_from: string;
  sent_to: string;
  status: 'confirmed' | 'failed' | 'pending';
  nonce: number;
  fee: Fee;
  transfers: Array<Transfer>;
  approvals: Array<Approval>;
  collection_approvals?: Array<CollectionApproval>;
  application_metadata?: ApplicationMetadata;
  flags?: Flags;
  acts?: Array<Act>;
  paymaster?: string;
}

export interface RelationshipData {
  type: string;
  id: string;
}

export interface ChainRelationship {
  links: {
    related: string;
  };
  data: RelationshipData;
}

export interface DappRelationship {
  data: RelationshipData;
}

export interface Relationships {
  chain?: ChainRelationship;
  dapp?: DappRelationship;
}

export interface TransactionDataItem {
  type: string;
  id: string;
  attributes: TransactionAttributes;
  relationships?: Relationships;
}

export interface Links {
  self: string;
  next?: string;
}

export interface ListWalletTransactions {
  links: Links;
  data: Array<TransactionDataItem>;
}

// ===============================
// CRYPTO SERVICE TYPES
// ===============================

export interface CryptoWalletRequest {
  name: string;
  address: string;
  type: WalletType;
  network: BlockchainNetwork;
  label?: string | undefined;
  notes?: string | undefined;
  tags?: string[] | undefined;
}

export interface UpdateWalletRequest {
  name?: string | undefined;
  label?: string | null | undefined;
  notes?: string | null | undefined;
  tags?: string[] | undefined;
  isActive?: boolean | undefined;
  isWatching?: boolean | undefined;
}

export interface PortfolioSummary {
  totalValueUsd: number;
  totalAssets: number;
  totalNfts: number;
  totalDeFiValue: number;
  dayChange: number;
  dayChangePct: number;
  topAssets: AssetBalance[];
  networkDistribution: NetworkAllocation[];
  assetTypeDistribution: AssetTypeAllocation[];
}

export interface AssetBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceUsd: number;
  price: number;
  change24h: number;
  logoUrl?: string | null;
  contractAddress?: string | null;
  network: BlockchainNetwork;
}

export interface NetworkAllocation {
  network: BlockchainNetwork;
  valueUsd: number;
  percentage: number;
  assetCount: number;
}

export interface AssetTypeAllocation {
  type: AssetType;
  valueUsd: number;
  percentage: number;
  count: number;
}

export interface CryptoTransactionFilters {
  type?: TransactionType[] | undefined;
  status?: TransactionStatus[] | undefined;
  network?: BlockchainNetwork[] | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  minValue?: number | undefined;
  maxValue?: number | undefined;
  search?: string | undefined; // Search in description, hash, addresses
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface NFTFilters {
  collections?: string[] | undefined;
  network?: BlockchainNetwork[] | undefined;
  standard?: NFTStandard[] | undefined;
  hasPrice?: boolean | undefined;
  isSpam?: boolean | undefined;
  search?: string | undefined;
}

export interface DeFiPositionFilters {
  protocols?: string[] | undefined;
  types?: string[] | undefined;
  networks?: BlockchainNetwork[] | undefined;
  minValue?: number | undefined;
  isActive?: boolean | undefined;
}

// ===============================
// ZERION SDK RESPONSE TYPES
// ===============================

export interface ZerionWalletResponse {
  data: {
    type: 'wallets';
    id: string;
    attributes: {
      address: string;
      total: {
        value: string;
      };
      positions_distribution: {
        [network: string]: {
          total: {
            value: string;
          };
          positions: Array<{
            quantity: string;
            value: string;
            price: string;
            fungible: {
              name: string;
              symbol: string;
              icon?: {
                url: string;
              };
              implementations?: Array<{
                chain_id: string;
                address: string;
              }>;
            };
          }>;
        };
      };
    };
  };
}

export interface ZerionTransactionResponse {
  data: Array<{
    type: 'transactions';
    id: string;
    attributes: {
      hash: string;
      block_number: number;
      timestamp: string;
      status: 'confirmed' | 'failed' | 'pending';
      fee: {
        value: string;
        price: string;
      };
      transfers: Array<{
        type: 'send' | 'receive';
        quantity: string;
        value: string;
        price: string;
        fungible: {
          name: string;
          symbol: string;
          icon?: {
            url: string;
          };
          implementations?: Array<{
            chain_id: string;
            address: string;
          }>;
        };
        from: string;
        to: string;
      }>;
    };
  }>;
  meta: {
    pagination?: {
      cursor: string;
      has_next: boolean;
    };
  };
}

export interface ZerionNFTResponse {
  data: Array<{
    type: 'nft-positions';
    id: string;
    attributes: {
      quantity: string;
      value?: string;
      price?: string;
      nft: {
        contract_address: string;
        token_id: string;
        name?: string;
        description?: string;
        image?: {
          url: string;
        };
        animation?: {
          url: string;
        };
        collection: {
          name: string;
          slug: string;
        };
        attributes: Array<{
          trait_type: string;
          value: string;
        }>;
      };
    };
  }>;
}

export interface ZerionDeFiResponse {
  data: Array<{
    type: 'defi-positions';
    id: string;
    attributes: {
      value: string;
      quantity: string;
      protocol: {
        name: string;
        slug: string;
        icon?: {
          url: string;
        };
      };
      pool?: {
        name: string;
        type: string;
      };
      yield?: {
        value: string;
        apr: number;
        apy: number;
      };
      locked_until?: string;
      composition: Array<{
        quantity: string;
        value: string;
        fungible: {
          name: string;
          symbol: string;
          icon?: {
            url: string;
          };
        };
      }>;
    };
  }>;
}

// ===============================
// BACKGROUND JOB TYPES
// ===============================

export interface SyncWalletJobData {
  userId: string;
  walletId: string;
  fullSync?: boolean; // If true, sync all data, otherwise just balances
}

export interface UpdatePricesJobData {
  assetIds?: string[]; // If not provided, update all assets
}

export interface CreateSnapshotJobData {
  userId: string;
  walletId?: string; // If not provided, create aggregate snapshot
}

// ===============================
// CACHE KEYS
// ===============================

export enum CacheKeys {
  WALLET_PORTFOLIO = 'crypto:wallet:portfolio',
  WALLET_TRANSACTIONS = 'crypto:wallet:transactions',
  WALLET_NFTS = 'crypto:wallet:nfts',
  WALLET_DEFI = 'crypto:wallet:defi',
  ASSET_PRICES = 'crypto:asset:prices',
  USER_PORTFOLIO = 'crypto:user:portfolio',
  MARKET_DATA = 'crypto:market:data',
}

// ===============================
// ZAPPER API TYPES
// ===============================

export interface ZapperPortfolioSummary {
  totalValueUsd: number;
  tokenValue: number;
  appPositionValue: number;
  nftValue: number;
  tokenCount: number;
  appPositionCount: number;
  nftCount: number;
}

export interface ZapperTokenBalance {
  tokenAddress: string;
  symbol: string;
  name?: string;
  balance: number;
  balanceUsd: number;
  imageUrl?: string | null;
  network: BlockchainNetwork;
  price?: number;
}

export interface ZapperAppPosition {
  appName: string;
  appId: string;
  type: string;
  balanceUsd: number;
  tokens: ZapperTokenBalance[];
  protocol?: string;
}

export interface ZapperNFTItem {
  tokenId: string;
  name?: string;
  imageUrl?: string;
  estimatedValueUsd?: number;
  collectionName: string;
}

export interface ZapperTransaction {
  hash: string;
  timestamp: string;
  network: string;
  description: string;
  valueUsd?: number;
}

export interface ZapperWalletData {
  address: string;
  portfolioSummary: ZapperPortfolioSummary;
  tokens: ZapperTokenBalance[];
  appPositions: ZapperAppPosition[];
  nfts: ZapperNFTItem[];
  recentTransactions: ZapperTransaction[];
  lastUpdated: Date;
}

export interface ZapperSyncOptions {
  includeTokens?: boolean;
  includeAppPositions?: boolean;
  includeNFTs?: boolean;
  includeTransactions?: boolean;
  networks?: BlockchainNetwork[];
  maxTransactions?: number;
}

// ===============================
// ERROR TYPES
// ===============================

export class CryptoServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CryptoServiceError';
  }
}

export enum CryptoErrorCodes {
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  DUPLICATE_WALLET = 'DUPLICATE_WALLET',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  ZERION_API_ERROR = 'ZERION_API_ERROR',
  ZAPPER_API_ERROR = 'ZAPPER_API_ERROR',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  NETWORK_NOT_SUPPORTED = 'NETWORK_NOT_SUPPORTED',
}
