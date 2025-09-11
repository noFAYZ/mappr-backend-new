import { z } from 'zod';
import {
  WalletType,
  BlockchainNetwork,
  AssetType,
  TransactionType,
  TransactionStatus,
  NFTStandard,
} from '@prisma/client';

// ===============================
// ENUM VALIDATIONS
// ===============================

export const WalletTypeSchema = z.nativeEnum(WalletType);
export const BlockchainNetworkSchema = z.nativeEnum(BlockchainNetwork);
export const AssetTypeSchema = z.nativeEnum(AssetType);
export const TransactionTypeSchema = z.nativeEnum(TransactionType);
export const TransactionStatusSchema = z.nativeEnum(TransactionStatus);
export const NFTStandardSchema = z.nativeEnum(NFTStandard);

// ===============================
// WALLET MANAGEMENT SCHEMAS
// ===============================

export const CreateWalletSchema = z.object({
  name: z
    .string()
    .min(1, 'Wallet name is required')
    .max(100, 'Wallet name must be less than 100 characters')
    .trim(),

  address: z
    .string()
    .min(1, 'Wallet address is required')
    .max(100, 'Wallet address must be less than 100 characters')
    .trim()
    .refine((address) => {
      // Basic address validation - more specific validation in service layer
      return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
    }, 'Invalid wallet address format'),

  type: WalletTypeSchema,
  network: BlockchainNetworkSchema,

  label: z.string().max(50, 'Label must be less than 50 characters').trim().optional(),

  notes: z.string().max(500, 'Notes must be less than 500 characters').trim().optional(),

  tags: z
    .array(z.string().min(1).max(30))
    .max(10, 'Maximum 10 tags allowed')
    .optional()
    .default([]),
});

export const UpdateWalletSchema = z.object({
  name: z
    .string()
    .min(1, 'Wallet name is required')
    .max(100, 'Wallet name must be less than 100 characters')
    .trim()
    .optional(),

  label: z.string().max(50, 'Label must be less than 50 characters').trim().optional().nullable(),

  notes: z.string().max(500, 'Notes must be less than 500 characters').trim().optional().nullable(),

  tags: z.array(z.string().min(1).max(30)).max(10, 'Maximum 10 tags allowed').optional(),

  isActive: z.boolean().optional(),
  isWatching: z.boolean().optional(),
});

export const WalletParamsSchema = z.object({
  walletId: z.string().min(1, 'Wallet ID is required').cuid('Invalid wallet ID format'),
});

export const WalletIdentifierParamsSchema = z
  .object({
    walletId: z.string().min(1, 'Wallet identifier is required').optional(),
    address: z
      .string()
      .min(1, 'Wallet address is required')
      .max(100, 'Wallet address must be less than 100 characters')
      .trim()
      .refine((address) => {
        // Basic address validation - more specific validation in service layer
        return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
      }, 'Invalid wallet address format')
      .optional(),
  })
  .refine((data) => data.walletId || data.address, {
    message: 'Either walletId or address must be provided',
    path: ['walletId'],
  });

export const WalletIdentifierQuerySchema = z
  .object({
    walletId: z.string().min(1, 'Wallet identifier is required').optional(),
    address: z
      .string()
      .min(1, 'Wallet address is required')
      .max(100, 'Wallet address must be less than 100 characters')
      .trim()
      .refine((address) => {
        // Basic address validation - more specific validation in service layer
        return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
      }, 'Invalid wallet address format')
      .optional(),
  })
  .refine((data) => data.walletId || data.address, {
    message: 'Either walletId or address must be provided',
    path: ['walletId'],
  });

// ===============================
// PAGINATION AND FILTERING SCHEMAS
// ===============================

export const PaginationSchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be greater than 0')
    .default(1),

  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be greater than 0')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
});

export const TransactionFiltersSchema = z
  .object({
    type: z.array(TransactionTypeSchema).optional(),
    status: z.array(TransactionStatusSchema).optional(),
    network: z.array(BlockchainNetworkSchema).optional(),

    startDate: z.coerce.date().optional(),

    endDate: z.coerce.date().optional(),

    minValue: z.coerce.number().min(0, 'Minimum value must be non-negative').optional(),

    maxValue: z.coerce.number().min(0, 'Maximum value must be non-negative').optional(),

    search: z
      .string()
      .min(1, 'Search query must not be empty')
      .max(100, 'Search query must be less than 100 characters')
      .trim()
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'Start date must be before or equal to end date',
      path: ['startDate'],
    }
  )
  .refine(
    (data) => {
      if (data.minValue && data.maxValue) {
        return data.minValue <= data.maxValue;
      }
      return true;
    },
    {
      message: 'Minimum value must be less than or equal to maximum value',
      path: ['minValue'],
    }
  );

export const NFTFiltersSchema = z.object({
  collections: z
    .array(z.string().min(1).max(100))
    .max(20, 'Maximum 20 collections allowed')
    .optional(),

  network: z.array(BlockchainNetworkSchema).optional(),
  standard: z.array(NFTStandardSchema).optional(),

  hasPrice: z.coerce.boolean().optional(),
  isSpam: z.coerce.boolean().optional(),

  search: z
    .string()
    .min(1, 'Search query must not be empty')
    .max(100, 'Search query must be less than 100 characters')
    .trim()
    .optional(),
});

export const DeFiFiltersSchema = z.object({
  protocols: z.array(z.string().min(1).max(50)).max(20, 'Maximum 20 protocols allowed').optional(),

  types: z.array(z.string().min(1).max(30)).max(10, 'Maximum 10 position types allowed').optional(),

  networks: z.array(BlockchainNetworkSchema).optional(),

  minValue: z.coerce.number().min(0, 'Minimum value must be non-negative').optional(),

  isActive: z.coerce.boolean().optional(),
});

// ===============================
// QUERY PARAMETER SCHEMAS
// ===============================

export const GetWalletTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.array(TransactionTypeSchema).optional(),
  status: z.array(TransactionStatusSchema).optional(),
  network: z.array(BlockchainNetworkSchema).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  minValue: z.coerce.number().min(0).optional(),
  maxValue: z.coerce.number().min(0).optional(),
  search: z.string().min(1).max(100).trim().optional(),
});

export const GetWalletNFTsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  collections: z.array(z.string().min(1).max(100)).max(20).optional(),
  network: z.array(BlockchainNetworkSchema).optional(),
  standard: z.array(NFTStandardSchema).optional(),
  hasPrice: z.coerce.boolean().optional(),
  isSpam: z.coerce.boolean().optional(),
  search: z.string().min(1).max(100).trim().optional(),
});

export const GetWalletDeFiQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  protocols: z.array(z.string().min(1).max(50)).max(20).optional(),
  types: z.array(z.string().min(1).max(30)).max(10).optional(),
  networks: z.array(BlockchainNetworkSchema).optional(),
  minValue: z.coerce.number().min(0).optional(),
  isActive: z.coerce.boolean().optional(),
});

// ===============================
// PORTFOLIO SCHEMAS
// ===============================

export const PortfolioTimeRangeSchema = z.enum(['24h', '7d', '30d', '90d', '1y', 'all']);

export const PortfolioQuerySchema = z.object({
  timeRange: PortfolioTimeRangeSchema.default('24h'),
  includeNFTs: z.coerce.boolean().default(true),
  includeDeFi: z.coerce.boolean().default(true),
  includeStaking: z.coerce.boolean().default(true),
  currency: z.string().length(3).default('USD').optional(),
});

// ===============================
// ASSET MANAGEMENT SCHEMAS
// ===============================

export const AssetFiltersSchema = z
  .object({
    network: z.array(BlockchainNetworkSchema).optional(),
    type: z.array(AssetTypeSchema).optional(),

    minBalance: z.coerce.number().min(0, 'Minimum balance must be non-negative').optional(),

    maxBalance: z.coerce.number().min(0, 'Maximum balance must be non-negative').optional(),

    search: z
      .string()
      .min(1, 'Search query must not be empty')
      .max(100, 'Search query must be less than 100 characters')
      .trim()
      .optional(),

    verified: z.coerce.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.minBalance && data.maxBalance) {
        return data.minBalance <= data.maxBalance;
      }
      return true;
    },
    {
      message: 'Minimum balance must be less than or equal to maximum balance',
      path: ['minBalance'],
    }
  );

export const GetWalletAssetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  network: z.array(BlockchainNetworkSchema).optional(),
  type: z.array(AssetTypeSchema).optional(),
  minBalance: z.coerce.number().min(0).optional(),
  maxBalance: z.coerce.number().min(0).optional(),
  search: z.string().min(1).max(100).trim().optional(),
  verified: z.coerce.boolean().optional(),
});

// ===============================
// SYNC AND UPDATE SCHEMAS
// ===============================

export const SyncWalletSchema = z.object({
  fullSync: z.coerce.boolean().default(false),
  syncAssets: z.coerce.boolean().default(true),
  syncTransactions: z.coerce.boolean().default(true),
  syncNFTs: z.coerce.boolean().default(false),
  syncDeFi: z.coerce.boolean().default(false),
  forceRefresh: z.coerce.boolean().default(false),
});

// ===============================
// ANALYTICS SCHEMAS
// ===============================

export const AnalyticsTimeRangeSchema = z.enum(['1h', '24h', '7d', '30d', '90d', '1y']);

export const AnalyticsQuerySchema = z.object({
  timeRange: AnalyticsTimeRangeSchema.default('24h'),

  metrics: z
    .array(
      z.enum([
        'totalValue',
        'assetCount',
        'transactionCount',
        'nftCount',
        'defiValue',
        'stakingRewards',
        'gasSpent',
      ])
    )
    .min(1, 'At least one metric must be specified')
    .optional(),

  groupBy: z.enum(['hour', 'day', 'week', 'month']).optional(),

  networks: z.array(BlockchainNetworkSchema).optional(),

  currency: z.string().length(3).default('USD').optional(),
});

// ===============================
// EXPORT SCHEMAS
// ===============================

export const ExportFormatSchema = z.enum(['csv', 'json', 'pdf']);

export const ExportRequestSchema = z.object({
  format: ExportFormatSchema,

  dataTypes: z
    .array(z.enum(['transactions', 'assets', 'nfts', 'defi']))
    .min(1, 'At least one data type must be specified'),

  timeRange: z
    .object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    })
    .refine((data) => data.startDate <= data.endDate, {
      message: 'Start date must be before or equal to end date',
      path: ['startDate'],
    })
    .optional(),

  networks: z.array(BlockchainNetworkSchema).optional(),

  includeMetadata: z.boolean().default(false),
});

// ===============================
// WEBHOOK SCHEMAS
// ===============================

export const WebhookConfigSchema = z.object({
  url: z.string().url('Invalid webhook URL').max(500, 'URL must be less than 500 characters'),

  events: z
    .array(
      z.enum([
        'transaction.confirmed',
        'transaction.failed',
        'balance.changed',
        'nft.received',
        'nft.sent',
        'defi.position.changed',
        'sync.completed',
        'sync.failed',
      ])
    )
    .min(1, 'At least one event type must be specified'),

  secret: z
    .string()
    .min(16, 'Webhook secret must be at least 16 characters')
    .max(64, 'Webhook secret must be less than 64 characters')
    .optional(),

  isActive: z.boolean().default(true),
});

// ===============================
// COMPOSITE SCHEMAS FOR ENDPOINTS
// ===============================

export const CreateWalletRequestSchema = z.object({
  body: CreateWalletSchema,
});

export const UpdateWalletRequestSchema = z.object({
  params: WalletParamsSchema,
  body: UpdateWalletSchema,
});

export const GetWalletDetailsRequestSchema = z.object({
  params: WalletParamsSchema,
  query: PortfolioQuerySchema.partial(),
});

export const GetWalletTransactionsRequestSchema = z.object({
  params: WalletParamsSchema,
  query: GetWalletTransactionsQuerySchema,
});

export const GetWalletNFTsRequestSchema = z.object({
  params: WalletParamsSchema,
  query: GetWalletNFTsQuerySchema,
});

export const GetWalletDeFiRequestSchema = z.object({
  params: WalletParamsSchema,
  query: GetWalletDeFiQuerySchema,
});

// New flexible schemas that support both wallet ID and address
export const GetWalletDetailsFlexibleRequestSchema = z.object({
  query: z
    .object({
      walletId: z.string().min(1, 'Wallet identifier is required').optional(),
      address: z
        .string()
        .min(1, 'Wallet address is required')
        .max(100, 'Wallet address must be less than 100 characters')
        .trim()
        .refine((address) => {
          return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
        }, 'Invalid wallet address format')
        .optional(),
    })
    .merge(PortfolioQuerySchema.partial())
    .refine((data) => data.walletId || data.address, {
      message: 'Either walletId or address must be provided',
      path: ['walletId'],
    }),
});

export const GetWalletTransactionsFlexibleRequestSchema = z.object({
  query: z
    .object({
      walletId: z.string().min(1, 'Wallet identifier is required').optional(),
      address: z
        .string()
        .min(1, 'Wallet address is required')
        .max(100, 'Wallet address must be less than 100 characters')
        .trim()
        .refine((address) => {
          return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
        }, 'Invalid wallet address format')
        .optional(),
    })
    .merge(GetWalletTransactionsQuerySchema)
    .refine((data) => data.walletId || data.address, {
      message: 'Either walletId or address must be provided',
      path: ['walletId'],
    }),
});

export const GetWalletNFTsFlexibleRequestSchema = z.object({
  query: z
    .object({
      walletId: z.string().min(1, 'Wallet identifier is required').optional(),
      address: z
        .string()
        .min(1, 'Wallet address is required')
        .max(100, 'Wallet address must be less than 100 characters')
        .trim()
        .refine((address) => {
          return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
        }, 'Invalid wallet address format')
        .optional(),
    })
    .merge(GetWalletNFTsQuerySchema)
    .refine((data) => data.walletId || data.address, {
      message: 'Either walletId or address must be provided',
      path: ['walletId'],
    }),
});

export const GetWalletDeFiFlexibleRequestSchema = z.object({
  query: z
    .object({
      walletId: z.string().min(1, 'Wallet identifier is required').optional(),
      address: z
        .string()
        .min(1, 'Wallet address is required')
        .max(100, 'Wallet address must be less than 100 characters')
        .trim()
        .refine((address) => {
          return /^[a-zA-Z0-9]+$/.test(address) || /^0x[a-fA-F0-9]+$/.test(address);
        }, 'Invalid wallet address format')
        .optional(),
    })
    .merge(GetWalletDeFiQuerySchema)
    .refine((data) => data.walletId || data.address, {
      message: 'Either walletId or address must be provided',
      path: ['walletId'],
    }),
});

export const SyncWalletRequestSchema = z.object({
  params: WalletParamsSchema,
  body: SyncWalletSchema,
});

export const GetAnalyticsRequestSchema = z.object({
  params: WalletParamsSchema.partial(),
  query: AnalyticsQuerySchema,
});

export const ExportDataRequestSchema = z.object({
  params: WalletParamsSchema.optional(),
  body: ExportRequestSchema,
});

// ===============================
// TYPE EXPORTS
// ===============================

export type CreateWalletRequest = z.infer<typeof CreateWalletSchema>;
export type UpdateWalletRequest = z.infer<typeof UpdateWalletSchema>;
export type TransactionFilters = z.infer<typeof TransactionFiltersSchema>;
export type NFTFilters = z.infer<typeof NFTFiltersSchema>;
export type DeFiFilters = z.infer<typeof DeFiFiltersSchema>;
export type PaginationOptions = z.infer<typeof PaginationSchema>;
export type SyncWalletRequest = z.infer<typeof SyncWalletSchema>;
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
