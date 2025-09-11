import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { accountGroupController } from '@/controllers/accountGroupController';
import { authenticate } from '@/middleware/auth';
import { Request, Response, NextFunction } from 'express';

const router = Router();

// Async error handler wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===============================
// RATE LIMITING
// ===============================

// General account group API rate limiting
const accountGroupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 write operations per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many write operations from this IP, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply authentication and rate limiting to all routes
router.use(authenticate);
router.use(accountGroupRateLimit);

// ===============================
// ACCOUNT GROUP ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/account-groups:
 *   post:
 *     summary: Create a new account group
 *     description: Create a new account group for organizing financial accounts and crypto wallets
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAccountGroupRequest'
 *           examples:
 *             personal:
 *               summary: Personal banking group
 *               value:
 *                 name: "Personal Banking"
 *                 description: "Personal checking and savings accounts"
 *                 icon: "🏦"
 *                 color: "#3B82F6"
 *             business:
 *               summary: Business group with parent
 *               value:
 *                 name: "Business Expenses"
 *                 description: "Business expense accounts"
 *                 icon: "💼"
 *                 color: "#10B981"
 *                 parentId: "clm123parent456def"
 *     responses:
 *       201:
 *         description: Account group created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account group created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AccountGroup'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Group name already exists at this level
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/',
  writeOperationsRateLimit,
  asyncHandler(accountGroupController.createAccountGroup.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups:
 *   get:
 *     summary: Get all account groups
 *     description: Retrieve all account groups for the authenticated user
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: details
 *         schema:
 *           type: boolean
 *         description: Include detailed account information
 *         example: true
 *     responses:
 *       200:
 *         description: Account groups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account groups retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AccountGroup'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/', asyncHandler(accountGroupController.getAccountGroups.bind(accountGroupController)));

/**
 * @swagger
 * /api/v1/account-groups/hierarchy:
 *   get:
 *     summary: Get account groups hierarchy
 *     description: Retrieve account groups in hierarchical structure (top-level groups with nested children)
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Account group hierarchy retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account group hierarchy retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AccountGroup'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/hierarchy',
  asyncHandler(accountGroupController.getAccountGroupHierarchy.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups/defaults:
 *   post:
 *     summary: Create default account groups
 *     description: Create default account groups (Primary, Savings, Crypto) for the user
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Default account groups created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "3 default account groups created successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AccountGroup'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/defaults',
  writeOperationsRateLimit,
  asyncHandler(accountGroupController.createDefaultGroups.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups/move-account:
 *   post:
 *     summary: Move account to group
 *     description: Move a financial account or crypto wallet to a different group
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MoveAccountRequest'
 *           examples:
 *             moveFinancialAccount:
 *               summary: Move financial account to group
 *               value:
 *                 accountId: "clm123account456def"
 *                 groupId: "clm123group456def"
 *                 accountType: "financial"
 *             removeCryptoFromGroup:
 *               summary: Remove crypto wallet from group
 *               value:
 *                 accountId: "clm123wallet456def"
 *                 groupId: null
 *                 accountType: "crypto"
 *     responses:
 *       200:
 *         description: Account moved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Financial account moved to group successfully"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/move-account',
  writeOperationsRateLimit,
  asyncHandler(accountGroupController.moveAccountToGroup.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups/{groupId}:
 *   get:
 *     summary: Get account group by ID
 *     description: Retrieve a specific account group with its accounts and child groups
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account group ID
 *         example: "clm123group456def"
 *     responses:
 *       200:
 *         description: Account group retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account group retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AccountGroup'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/:groupId',
  asyncHandler(accountGroupController.getAccountGroupById.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups/{groupId}:
 *   put:
 *     summary: Update account group
 *     description: Update an existing account group's properties
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account group ID
 *         example: "clm123group456def"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAccountGroupRequest'
 *           examples:
 *             updateName:
 *               summary: Update group name and description
 *               value:
 *                 name: "Business Banking"
 *                 description: "Updated business account group"
 *             changeParent:
 *               summary: Move group to different parent
 *               value:
 *                 parentId: "clm123newparent456"
 *                 sortOrder: 2
 *     responses:
 *       200:
 *         description: Account group updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account group updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AccountGroup'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Group name already exists or circular reference detected
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  '/:groupId',
  writeOperationsRateLimit,
  asyncHandler(accountGroupController.updateAccountGroup.bind(accountGroupController))
);

/**
 * @swagger
 * /api/v1/account-groups/{groupId}:
 *   delete:
 *     summary: Delete account group
 *     description: Delete an account group (must be empty and not a default group)
 *     tags: [Account Groups]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Account group ID
 *         example: "clm123group456def"
 *     responses:
 *       200:
 *         description: Account group deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Account group deleted successfully"
 *       400:
 *         description: Cannot delete default group or group with accounts/children
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete(
  '/:groupId',
  writeOperationsRateLimit,
  asyncHandler(accountGroupController.deleteAccountGroup.bind(accountGroupController))
);

export default router;
