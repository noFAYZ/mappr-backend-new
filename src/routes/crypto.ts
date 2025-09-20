import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { cryptoController } from '@/controllers/cryptoController';
import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { enforceWalletLimit } from '@/middleware/planLimits';
import {
  CreateWalletRequestSchema,
  UpdateWalletRequestSchema,
  GetWalletDetailsRequestSchema,
  GetWalletTransactionsRequestSchema,
  GetWalletNFTsRequestSchema,
  GetWalletDeFiRequestSchema,
  GetWalletDetailsFlexibleRequestSchema,
  GetWalletTransactionsFlexibleRequestSchema,
  GetWalletNFTsFlexibleRequestSchema,
  GetWalletDeFiFlexibleRequestSchema,
  SyncWalletRequestSchema,
  GetAnalyticsRequestSchema,
  ExportDataRequestSchema,
} from '@/utils/cryptoValidation';

const router = Router();

// Async error handler wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===============================
// RATE LIMITING
// ===============================

// General crypto API rate limiting
const cryptoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// More restrictive rate limiting for write operations
const writeOperationsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 write operations per minute
  message: {
    success: false,
    error: {
      code: 'WRITE_RATE_LIMIT_EXCEEDED',
      message: 'Too many write operations, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Sync operations rate limiting (more restrictive)
const syncRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // limit each IP to 3 sync operations per 5 minutes
  message: {
    success: false,
    error: {
      code: 'SYNC_RATE_LIMIT_EXCEEDED',
      message: 'Too many sync requests, please wait before trying again.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all crypto routes
router.use(cryptoRateLimit);

// All crypto routes require authentication
router.use(authenticate);

// ===============================
// WALLET MANAGEMENT ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/wallets:
 *   get:
 *     summary: Get all crypto wallets
 *     description: Retrieve all crypto wallets for the authenticated user
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved wallets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/wallets', cryptoController.getUserWallets.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/wallets:
 *   post:
 *     summary: Add a new crypto wallet
 *     description: Add a new cryptocurrency wallet to track
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "My MetaMask Wallet"
 *               address:
 *                 type: string
 *                 example: "0x742d35cc6645c0532351bf5541ad8c1c7b6e90e2"
 *               network:
 *                 $ref: '#/components/schemas/BlockchainNetwork'
 *             required: [name, address, network]
 *     responses:
 *       201:
 *         description: Wallet added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/CryptoWallet'
 *                 message:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post(
  '/wallets',
  writeOperationsRateLimit,
  enforceWalletLimit,
  validate(CreateWalletRequestSchema),
  cryptoController.addWallet.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}:
 *   get:
 *     summary: Get wallet details and portfolio
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet ID
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 90d, 1y, all]
 *         description: Time range for portfolio data
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PortfolioSummary'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/wallets/:walletId',
  validate(GetWalletDetailsRequestSchema),
  asyncHandler(cryptoController.getWalletDetails.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}:
 *   put:
 *     summary: Update wallet information
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateWalletRequest'
 *     responses:
 *       200:
 *         description: Wallet updated successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put(
  '/wallets/:walletId',
  writeOperationsRateLimit,
  validate(UpdateWalletRequestSchema),
  cryptoController.updateWallet.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}:
 *   delete:
 *     summary: Remove a crypto wallet
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Wallet removed successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete(
  '/wallets/:walletId',
  writeOperationsRateLimit,
  asyncHandler(cryptoController.removeWallet.bind(cryptoController))
);

// ===============================
// FLEXIBLE WALLET ROUTES (Support both ID and Address)
// ===============================

/**
 * @swagger
 * /api/v1/crypto/wallet:
 *   get:
 *     summary: Get wallet details and portfolio (flexible - by ID or address)
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (CUID)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (0x... or base58)
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 90d, 1y, all]
 *         description: Time range for portfolio data
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet portfolio
 *       400:
 *         description: Either walletId or address must be provided
 *       404:
 *         description: Wallet not found
 */
router.get(
  '/wallet',
  validate(GetWalletDetailsFlexibleRequestSchema),
  asyncHandler(cryptoController.getWalletDetailsFlexible.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/wallet/transactions:
 *   get:
 *     summary: Get wallet transactions (flexible - by ID or address)
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (CUID)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (0x... or base58)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet transactions
 *       400:
 *         description: Either walletId or address must be provided
 *       404:
 *         description: Wallet not found
 */
router.get(
  '/wallet/transactions',
  validate(GetWalletTransactionsFlexibleRequestSchema),
  asyncHandler(cryptoController.getWalletTransactionsFlexible.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/wallet/nfts:
 *   get:
 *     summary: Get wallet NFTs (flexible - by ID or address)
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (CUID)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (0x... or base58)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet NFTs
 *       400:
 *         description: Either walletId or address must be provided
 *       404:
 *         description: Wallet not found
 */
router.get(
  '/wallet/nfts',
  validate(GetWalletNFTsFlexibleRequestSchema),
  asyncHandler(cryptoController.getWalletNFTsFlexible.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/wallet/defi:
 *   get:
 *     summary: Get wallet DeFi positions (flexible - by ID or address)
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (CUID)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (0x... or base58)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet DeFi positions
 *       400:
 *         description: Either walletId or address must be provided
 *       404:
 *         description: Wallet not found
 */
router.get(
  '/wallet/defi',
  validate(GetWalletDeFiFlexibleRequestSchema),
  asyncHandler(cryptoController.getWalletDeFiPositionsFlexible.bind(cryptoController))
);

// ===============================
// PORTFOLIO ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/portfolio:
 *   get:
 *     summary: Get aggregated portfolio across all wallets
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 90d, 1y, all]
 *       - in: query
 *         name: includeNFTs
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: includeDeFi
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Successfully retrieved aggregated portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PortfolioSummary'
 */
router.get('/portfolio', cryptoController.getAggregatedPortfolio.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/analytics:
 *   get:
 *     summary: Get portfolio analytics and performance metrics
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d, 30d, 90d, 1y]
 *       - in: query
 *         name: metrics
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [totalValue, assetCount, transactionCount, nftCount, defiValue]
 *     responses:
 *       200:
 *         description: Successfully retrieved portfolio analytics
 */
router.get(
  '/analytics',
  validate(GetAnalyticsRequestSchema),
  cryptoController.getPortfolioAnalytics.bind(cryptoController)
);

// ===============================
// TRANSACTION ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/transactions:
 *   get:
 *     summary: Get all transactions across wallets
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: type
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [SEND, RECEIVE, SWAP, STAKE, UNSTAKE]
 *     responses:
 *       200:
 *         description: Successfully retrieved transactions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedTransactions'
 */
router.get('/transactions', cryptoController.getAllTransactions.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/transactions:
 *   get:
 *     summary: Get transactions for a specific wallet
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet transactions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedTransactions'
 */
router.get(
  '/wallets/:walletId/transactions',
  validate(GetWalletTransactionsRequestSchema),
  cryptoController.getWalletTransactions.bind(cryptoController)
);

// ===============================
// NFT ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/nfts:
 *   get:
 *     summary: Get all NFTs across wallets
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: collections
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved NFTs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedNFTs'
 */
router.get('/nfts', cryptoController.getAllNFTs.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/nfts:
 *   get:
 *     summary: Get NFTs for a specific wallet
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet NFTs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedNFTs'
 */
router.get(
  '/wallets/:walletId/nfts',
  validate(GetWalletNFTsRequestSchema),
  cryptoController.getWalletNFTs.bind(cryptoController)
);

// ===============================
// DeFi ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/defi:
 *   get:
 *     summary: Get all DeFi positions across wallets
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved DeFi positions
 */
router.get('/defi', cryptoController.getAllDeFiPositions.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/defi:
 *   get:
 *     summary: Get DeFi positions for a specific wallet
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved wallet DeFi positions
 */
router.get(
  '/wallets/:walletId/defi',
  validate(GetWalletDeFiRequestSchema),
  cryptoController.getWalletDeFiPositions.bind(cryptoController)
);

// ===============================
// SYNC AND REFRESH ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/sync:
 *   post:
 *     summary: Sync wallet data with blockchain
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullSync:
 *                 type: boolean
 *                 default: false
 *               syncTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [assets, transactions, nfts, defi]
 *     responses:
 *       200:
 *         description: Sync initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     syncId:
 *                       type: string
 *                     status:
 *                       type: string
 */
router.post(
  '/wallets/:walletId/sync',
  syncRateLimit,
  validate(SyncWalletRequestSchema),
  cryptoController.syncWallet.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/sync/status:
 *   get:
 *     summary: Get wallet sync status
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved sync status
 */
router.get('/wallets/:walletId/sync/status', cryptoController.getSyncStatus.bind(cryptoController));

// ===============================
// EXPORT ROUTES
// ===============================

// ===============================
// DATA EXPORT ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/export:
 *   post:
 *     summary: Export portfolio data
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [csv, json, pdf]
 *               dataTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [transactions, assets, nfts, defi]
 *     responses:
 *       200:
 *         description: Export initiated successfully
 */
router.post(
  '/export',
  writeOperationsRateLimit,
  validate(ExportDataRequestSchema),
  cryptoController.exportPortfolioData.bind(cryptoController)
);

// ===============================
// ZAPPER INTEGRATION ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}/zapper:
 *   get:
 *     tags: [Crypto]
 *     summary: Get wallet portfolio data from Zapper
 *     description: Retrieve comprehensive portfolio data for a wallet using Zapper's API
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet ID
 *       - in: query
 *         name: includeTokens
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include token balances
 *       - in: query
 *         name: includeAppPositions
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include DeFi app positions
 *       - in: query
 *         name: includeNFTs
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include NFT holdings
 *       - in: query
 *         name: includeTransactions
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include recent transactions
 *       - in: query
 *         name: maxTransactions
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of transactions to fetch
 *       - in: query
 *         name: networks
 *         schema:
 *           type: string
 *         description: Comma-separated list of networks to include
 *     responses:
 *       200:
 *         description: Wallet portfolio data retrieved successfully
 *       404:
 *         description: Wallet not found
 *       503:
 *         description: Zapper service not available
 */
router.get(
  '/wallets/:walletId/zapper',
  authenticate,
  cryptoRateLimit,
  cryptoController.getZapperWalletData.bind(cryptoController)
);

/**
 * @swagger
 * /api/crypto/zapper/farcaster:
 *   get:
 *     tags: [Crypto]
 *     summary: Get Farcaster user portfolio via Zapper
 *     description: Retrieve portfolio data for Farcaster users by resolving their FID or username to addresses
 *     parameters:
 *       - in: query
 *         name: fids
 *         schema:
 *           type: string
 *         description: Comma-separated list of Farcaster IDs
 *       - in: query
 *         name: usernames
 *         schema:
 *           type: string
 *         description: Comma-separated list of Farcaster usernames
 *       - in: query
 *         name: includeTokens
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include token balances
 *       - in: query
 *         name: includeAppPositions
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include DeFi app positions
 *       - in: query
 *         name: includeNFTs
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include NFT holdings
 *       - in: query
 *         name: networks
 *         schema:
 *           type: string
 *         description: Comma-separated list of networks to include
 *     responses:
 *       200:
 *         description: Farcaster portfolio data retrieved successfully
 *       400:
 *         description: Must provide either fids or usernames
 *       503:
 *         description: Zapper service not available
 */
router.get(
  '/zapper/farcaster',
  authenticate,
  cryptoRateLimit,
  cryptoController.getZapperFarcasterData.bind(cryptoController)
);

/**
 * @swagger
 * /api/crypto/zapper/health:
 *   get:
 *     tags: [Crypto]
 *     summary: Get service health status
 *     description: Check the health status of Zapper and other integrated services
 *     responses:
 *       200:
 *         description: Service health status retrieved
 */
router.get(
  '/zapper/health',
  authenticate,
  cryptoController.getZapperServiceHealth.bind(cryptoController)
);

// ===============================
// UNIFIED PROVIDER ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/wallet/portfolio/live:
 *   get:
 *     summary: Get live wallet portfolio data from external providers
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (alternative to address)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (alternative to walletId)
 *     responses:
 *       200:
 *         description: Live wallet portfolio retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 meta:
 *                   type: object
 *                   properties:
 *                     provider:
 *                       type: string
 *                       enum: [zapper, zerion]
 *                     live:
 *                       type: boolean
 *                     address:
 *                       type: string
 */
router.get(
  '/wallet/portfolio/live',
  authenticate,
  cryptoRateLimit,
  asyncHandler(cryptoController.getWalletDetailsLive.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/wallet/transactions/live:
 *   get:
 *     summary: Get live wallet transactions from external providers
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: walletId
 *         schema:
 *           type: string
 *         description: Wallet ID (alternative to address)
 *       - in: query
 *         name: address
 *         schema:
 *           type: string
 *         description: Wallet address (alternative to walletId)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of transactions to return
 *     responses:
 *       200:
 *         description: Live wallet transactions retrieved successfully
 */
router.get(
  '/wallet/transactions/live',
  authenticate,
  cryptoRateLimit,
  asyncHandler(cryptoController.getWalletTransactionsLive.bind(cryptoController))
);

/**
 * @swagger
 * /api/v1/crypto/providers/status:
 *   get:
 *     summary: Get status of crypto data providers
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Provider status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     primary:
 *                       type: object
 *                       properties:
 *                         provider:
 *                           type: string
 *                         available:
 *                           type: boolean
 *                         healthy:
 *                           type: boolean
 *                     fallback:
 *                       type: object
 *                       properties:
 *                         provider:
 *                           type: string
 *                         available:
 *                           type: boolean
 *                         healthy:
 *                           type: boolean
 */
router.get(
  '/providers/status',
  authenticate,
  asyncHandler(cryptoController.getProviderStatus.bind(cryptoController))
);

// ===============================
// REAL-TIME SYNC PROGRESS ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/user/sync/stream:
 *   get:
 *     summary: Stream real-time sync progress for all user wallets via SSE
 *     description: Establishes a Server-Sent Events connection to receive real-time updates for all wallet sync operations
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: SSE connection established successfully
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 data: {"type":"connection_established","userId":"user123","timestamp":"2023-01-01T00:00:00.000Z"}
 *
 *                 data: {"type":"wallet_sync_progress","walletId":"wallet123","progress":25,"status":"syncing_assets","timestamp":"2023-01-01T00:00:01.000Z"}
 *
 *                 data: {"type":"wallet_sync_completed","walletId":"wallet123","progress":100,"status":"completed","syncedData":["assets","transactions"],"timestamp":"2023-01-01T00:00:02.000Z"}
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/user/sync/stream',
  authenticate,
  cryptoController.streamUserSyncProgress.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/user/wallets/sync/status:
 *   get:
 *     summary: Get batch sync status for all user wallets
 *     description: Returns the current sync status for all wallets belonging to the authenticated user
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Batch sync status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     wallets:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           address:
 *                             type: string
 *                           network:
 *                             type: string
 *                           syncStatus:
 *                             type: object
 *                             properties:
 *                               status:
 *                                 type: string
 *                                 enum: [queued, syncing, syncing_assets, syncing_transactions, syncing_nfts, syncing_defi, completed, failed]
 *                               progress:
 *                                 type: number
 *                                 minimum: 0
 *                                 maximum: 100
 *                               lastSyncAt:
 *                                 type: string
 *                                 format: date-time
 *                               syncedData:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *                               error:
 *                                 type: string
 *                     totalWallets:
 *                       type: number
 *                     syncingCount:
 *                       type: number
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/user/wallets/sync/status',
  authenticate,
  cryptoController.getBatchSyncStatus.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/user/sync/stats:
 *   get:
 *     summary: Get sync progress connection statistics
 *     description: Returns information about the user's SSE connection and system-wide sync progress stats
 *     tags: [Crypto]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sync progress stats retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     isConnected:
 *                       type: boolean
 *                     connectionInfo:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         userId:
 *                           type: string
 *                         connectedAt:
 *                           type: string
 *                           format: date-time
 *                         walletCount:
 *                           type: number
 *                         wallets:
 *                           type: array
 *                           items:
 *                             type: string
 *                     systemStats:
 *                       type: object
 *                       properties:
 *                         totalConnections:
 *                           type: number
 *                         isHealthy:
 *                           type: boolean
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/user/sync/stats',
  authenticate,
  cryptoController.getSyncProgressStats.bind(cryptoController)
);

export { router as cryptoRoutes };
