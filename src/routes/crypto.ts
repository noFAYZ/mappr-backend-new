import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cryptoController } from '@/controllers/cryptoController';
import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import {
  CreateWalletRequestSchema,
  UpdateWalletRequestSchema,
  GetWalletDetailsRequestSchema,
  GetWalletTransactionsRequestSchema,
  GetWalletNFTsRequestSchema,
  GetWalletDeFiRequestSchema,
  SyncWalletRequestSchema,
  GetAnalyticsRequestSchema,
  ExportDataRequestSchema,
} from '@/utils/cryptoValidation';

const router = Router();

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
 *     summary: Get all user's crypto wallets
 *     tags: [Crypto - Wallets]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved wallets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CryptoWallet'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/wallets', cryptoController.getUserWallets.bind(cryptoController));

/**
 * @swagger
 * /api/v1/crypto/wallets:
 *   post:
 *     summary: Add a new crypto wallet
 *     tags: [Crypto - Wallets]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWalletRequest'
 *     responses:
 *       201:
 *         description: Wallet added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
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
  validate(CreateWalletRequestSchema),
  cryptoController.addWallet.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}:
 *   get:
 *     summary: Get wallet details and portfolio
 *     tags: [Crypto - Wallets]
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
  cryptoController.getWalletDetails.bind(cryptoController)
);

/**
 * @swagger
 * /api/v1/crypto/wallets/{walletId}:
 *   put:
 *     summary: Update wallet information
 *     tags: [Crypto - Wallets]
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
 *     tags: [Crypto - Wallets]
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
  cryptoController.removeWallet.bind(cryptoController)
);

// ===============================
// PORTFOLIO ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/crypto/portfolio:
 *   get:
 *     summary: Get aggregated portfolio across all wallets
 *     tags: [Crypto - Portfolio]
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
 *     tags: [Crypto - Analytics]
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
 *     tags: [Crypto - Transactions]
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
 *     tags: [Crypto - Transactions]
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
 *     tags: [Crypto - NFTs]
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
 *     tags: [Crypto - NFTs]
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
 *     tags: [Crypto - DeFi]
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
 *     tags: [Crypto - DeFi]
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
 *     tags: [Crypto - Sync]
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
 *     tags: [Crypto - Sync]
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
 *     tags: [Crypto - Export]
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
 *     tags: [Zapper Integration]
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
 * /api/crypto/wallets/{walletId}/zapper/sync:
 *   post:
 *     tags: [Zapper Integration]
 *     summary: Sync wallet with Zapper data
 *     description: Synchronize wallet data with fresh information from Zapper
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               includeTokens:
 *                 type: boolean
 *                 default: true
 *               includeAppPositions:
 *                 type: boolean
 *                 default: true
 *               includeNFTs:
 *                 type: boolean
 *                 default: true
 *               includeTransactions:
 *                 type: boolean
 *                 default: true
 *               networks:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Wallet synced successfully
 *       404:
 *         description: Wallet not found
 *       503:
 *         description: Zapper service not available
 */
router.post(
  '/wallets/:walletId/zapper/sync',
  authenticate,
  cryptoRateLimit,
  writeOperationsRateLimit,
  cryptoController.syncWalletWithZapper.bind(cryptoController)
);

/**
 * @swagger
 * /api/crypto/zapper/farcaster:
 *   get:
 *     tags: [Zapper Integration]
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
 *     tags: [Zapper Integration]
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

export { router as cryptoRoutes };
