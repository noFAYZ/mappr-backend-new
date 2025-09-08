import { Request, Response } from 'express';
import { AccountGroupService } from '@/services/accountGroupService';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { z } from 'zod';

// Validation schemas
const CreateAccountGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  icon: z.string().max(50, 'Icon must be less than 50 characters').optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid color format').optional(),
  parentId: z.string().cuid().optional(),
});

const UpdateAccountGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters').optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  icon: z.string().max(50, 'Icon must be less than 50 characters').optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid color format').optional(),
  parentId: z.string().cuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const MoveAccountSchema = z.object({
  accountId: z.string().cuid('Invalid account ID'),
  groupId: z.string().cuid().nullable(),
  accountType: z.enum(['financial', 'crypto']),
});

const AccountGroupParamsSchema = z.object({
  groupId: z.string().cuid('Invalid group ID'),
});

export class AccountGroupController {
  private accountGroupService: AccountGroupService;

  constructor() {
    this.accountGroupService = new AccountGroupService();
  }

  async createAccountGroup(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const validatedData = CreateAccountGroupSchema.parse(req.body);
      const requestData: any = { name: validatedData.name };
      if (validatedData.description !== undefined) requestData.description = validatedData.description;
      if (validatedData.icon !== undefined) requestData.icon = validatedData.icon;
      if (validatedData.color !== undefined) requestData.color = validatedData.color;
      if (validatedData.parentId !== undefined) requestData.parentId = validatedData.parentId;
      
      const accountGroup = await this.accountGroupService.createAccountGroup(userId, requestData);

      logger.info(`Account group created by user ${userId}`, {
        userId,
        groupId: accountGroup.id,
        name: accountGroup.name,
      });

      res.status(201).json({
        success: true,
        data: accountGroup,
        message: 'Account group created successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(`Validation error: ${error.errors.map(e => e.message).join(', ')}`, 400);
      }
      throw error;
    }
  }

  async getAccountGroups(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const includeDetails = req.query['details'] === 'true';
      const accountGroups = await this.accountGroupService.getAccountGroups(userId, includeDetails);

      res.json({
        success: true,
        data: accountGroups,
        message: 'Account groups retrieved successfully',
      });
    } catch (error) {
      throw error;
    }
  }

  async getAccountGroupHierarchy(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const hierarchy = await this.accountGroupService.getAccountGroupHierarchy(userId);

      res.json({
        success: true,
        data: hierarchy,
        message: 'Account group hierarchy retrieved successfully',
      });
    } catch (error) {
      throw error;
    }
  }

  async getAccountGroupById(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { groupId } = AccountGroupParamsSchema.parse(req.params);
      const accountGroup = await this.accountGroupService.getAccountGroupById(userId, groupId);

      if (!accountGroup) {
        throw new AppError('Account group not found', 404);
      }

      res.json({
        success: true,
        data: accountGroup,
        message: 'Account group retrieved successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError('Invalid group ID', 400);
      }
      throw error;
    }
  }

  async updateAccountGroup(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { groupId } = AccountGroupParamsSchema.parse(req.params);
      const validatedData = UpdateAccountGroupSchema.parse(req.body);
      const requestData: any = {};
      if (validatedData.name !== undefined) requestData.name = validatedData.name;
      if (validatedData.description !== undefined) requestData.description = validatedData.description;
      if (validatedData.icon !== undefined) requestData.icon = validatedData.icon;
      if (validatedData.color !== undefined) requestData.color = validatedData.color;
      if (validatedData.parentId !== undefined) requestData.parentId = validatedData.parentId;
      if (validatedData.sortOrder !== undefined) requestData.sortOrder = validatedData.sortOrder;

      const updatedGroup = await this.accountGroupService.updateAccountGroup(userId, groupId, requestData);

      logger.info(`Account group updated by user ${userId}`, {
        userId,
        groupId,
        changes: Object.keys(validatedData),
      });

      res.json({
        success: true,
        data: updatedGroup,
        message: 'Account group updated successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(`Validation error: ${error.errors.map(e => e.message).join(', ')}`, 400);
      }
      throw error;
    }
  }

  async deleteAccountGroup(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { groupId } = AccountGroupParamsSchema.parse(req.params);
      await this.accountGroupService.deleteAccountGroup(userId, groupId);

      logger.info(`Account group deleted by user ${userId}`, {
        userId,
        groupId,
      });

      res.json({
        success: true,
        message: 'Account group deleted successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError('Invalid group ID', 400);
      }
      throw error;
    }
  }

  async moveAccountToGroup(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const validatedData = MoveAccountSchema.parse(req.body);
      await this.accountGroupService.moveAccountToGroup(
        userId,
        validatedData.accountId,
        validatedData.groupId,
        validatedData.accountType
      );

      logger.info(`Account moved to group by user ${userId}`, {
        userId,
        accountId: validatedData.accountId,
        groupId: validatedData.groupId,
        accountType: validatedData.accountType,
      });

      res.json({
        success: true,
        message: `${validatedData.accountType} account moved to group successfully`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(`Validation error: ${error.errors.map(e => e.message).join(', ')}`, 400);
      }
      throw error;
    }
  }

  async createDefaultGroups(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const defaultGroups = await this.accountGroupService.createDefaultGroups(userId);

      logger.info(`Default account groups created for user ${userId}`, {
        userId,
        count: defaultGroups.length,
      });

      res.status(201).json({
        success: true,
        data: defaultGroups,
        message: `${defaultGroups.length} default account groups created successfully`,
      });
    } catch (error) {
      throw error;
    }
  }
}

// Create and export controller instance
export const accountGroupController = new AccountGroupController();