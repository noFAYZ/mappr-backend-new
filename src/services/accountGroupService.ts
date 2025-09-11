import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { AccountGroup, FinancialAccount, CryptoWallet } from '@prisma/client';

export interface CreateAccountGroupRequest {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parentId?: string;
}

export interface UpdateAccountGroupRequest {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface AccountGroupWithDetails extends AccountGroup {
  financialAccounts?: FinancialAccount[];
  cryptoWallets?: CryptoWallet[];
  children?: AccountGroup[];
  _count?: any;
}

export class AccountGroupService {
  async createAccountGroup(userId: string, data: CreateAccountGroupRequest): Promise<AccountGroup> {
    try {
      // Validate parent group if provided
      if (data.parentId) {
        const parentGroup = await prisma.accountGroup.findFirst({
          where: {
            id: data.parentId,
            userId,
          },
        });

        if (!parentGroup) {
          throw new AppError('Parent group not found', 404);
        }
      }

      // Check for duplicate names at the same level
      const existingGroup = await prisma.accountGroup.findFirst({
        where: {
          userId,
          name: data.name,
          parentId: data.parentId || null,
        },
      });

      if (existingGroup) {
        throw new AppError('A group with this name already exists at this level', 409);
      }

      const accountGroup = await prisma.accountGroup.create({
        data: {
          userId,
          name: data.name,
          description: data.description || null,
          icon: data.icon || null,
          color: data.color || null,
          parentId: data.parentId || null,
        },
      });

      logger.info(`Account group created: ${accountGroup.id} for user ${userId}`);
      return accountGroup;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error creating account group:', error);
      throw new AppError('Failed to create account group', 500);
    }
  }

  async getAccountGroups(
    userId: string,
    includeDetails = false
  ): Promise<AccountGroupWithDetails[]> {
    try {
      const groups = await prisma.accountGroup.findMany({
        where: { userId },
        include: {
          financialAccounts: includeDetails,
          cryptoWallets: includeDetails,
          children: true,
          _count: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      return groups;
    } catch (error) {
      logger.error('Error fetching account groups:', error);
      throw new AppError('Failed to fetch account groups', 500);
    }
  }

  async getAccountGroupById(
    userId: string,
    groupId: string
  ): Promise<AccountGroupWithDetails | null> {
    try {
      const group = await prisma.accountGroup.findFirst({
        where: {
          id: groupId,
          userId,
        },
        include: {
          financialAccounts: true,
          cryptoWallets: true,
          children: {
            include: {
              _count: true,
            },
          },
          _count: true,
        },
      });

      return group;
    } catch (error) {
      logger.error('Error fetching account group:', error);
      throw new AppError('Failed to fetch account group', 500);
    }
  }

  async updateAccountGroup(
    userId: string,
    groupId: string,
    data: UpdateAccountGroupRequest
  ): Promise<AccountGroup> {
    try {
      // Verify group exists and belongs to user
      const existingGroup = await prisma.accountGroup.findFirst({
        where: {
          id: groupId,
          userId,
        },
      });

      if (!existingGroup) {
        throw new AppError('Account group not found', 404);
      }

      // Validate parent group if being updated
      if (data.parentId && data.parentId !== existingGroup.parentId) {
        // Prevent circular references
        if (data.parentId === groupId) {
          throw new AppError('Cannot set group as its own parent', 400);
        }

        const parentGroup = await prisma.accountGroup.findFirst({
          where: {
            id: data.parentId,
            userId,
          },
        });

        if (!parentGroup) {
          throw new AppError('Parent group not found', 404);
        }

        // Check if the proposed parent is a descendant of current group
        const isDescendant = await this.isDescendant(userId, groupId, data.parentId);
        if (isDescendant) {
          throw new AppError('Cannot set a descendant as parent', 400);
        }
      }

      // Check for duplicate names if name is being updated
      if (data.name && data.name !== existingGroup.name) {
        const duplicateGroup = await prisma.accountGroup.findFirst({
          where: {
            userId,
            name: data.name,
            parentId: data.parentId !== undefined ? data.parentId : existingGroup.parentId,
            id: { not: groupId },
          },
        });

        if (duplicateGroup) {
          throw new AppError('A group with this name already exists at this level', 409);
        }
      }

      const updatedGroup = await prisma.accountGroup.update({
        where: { id: groupId },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.icon !== undefined && { icon: data.icon }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.parentId !== undefined && { parentId: data.parentId }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          updatedAt: new Date(),
        },
      });

      logger.info(`Account group updated: ${groupId} for user ${userId}`);
      return updatedGroup;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error updating account group:', error);
      throw new AppError('Failed to update account group', 500);
    }
  }

  async deleteAccountGroup(userId: string, groupId: string): Promise<void> {
    try {
      // Verify group exists and belongs to user
      const existingGroup = await prisma.accountGroup.findFirst({
        where: {
          id: groupId,
          userId,
        },
        include: {
          financialAccounts: true,
          cryptoWallets: true,
          children: true,
        },
      });

      if (!existingGroup) {
        throw new AppError('Account group not found', 404);
      }

      // Prevent deletion of default groups
      if (existingGroup.isDefault) {
        throw new AppError('Cannot delete default groups', 400);
      }

      // Check if group has accounts or children
      if (existingGroup.financialAccounts.length > 0 || existingGroup.cryptoWallets.length > 0) {
        throw new AppError(
          'Cannot delete group with accounts. Move accounts to another group first.',
          400
        );
      }

      if (existingGroup.children.length > 0) {
        throw new AppError(
          'Cannot delete group with child groups. Delete or move child groups first.',
          400
        );
      }

      await prisma.accountGroup.delete({
        where: { id: groupId },
      });

      logger.info(`Account group deleted: ${groupId} for user ${userId}`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error deleting account group:', error);
      throw new AppError('Failed to delete account group', 500);
    }
  }

  async moveAccountToGroup(
    userId: string,
    accountId: string,
    groupId: string | null,
    accountType: 'financial' | 'crypto'
  ): Promise<void> {
    try {
      // Validate group exists if provided
      if (groupId) {
        const group = await prisma.accountGroup.findFirst({
          where: {
            id: groupId,
            userId,
          },
        });

        if (!group) {
          throw new AppError('Account group not found', 404);
        }
      }

      if (accountType === 'financial') {
        // Verify financial account exists and belongs to user
        const account = await prisma.financialAccount.findFirst({
          where: {
            id: accountId,
            userId,
          },
        });

        if (!account) {
          throw new AppError('Financial account not found', 404);
        }

        await prisma.financialAccount.update({
          where: { id: accountId },
          data: { groupId },
        });
      } else {
        // Verify crypto wallet exists and belongs to user
        const wallet = await prisma.cryptoWallet.findFirst({
          where: {
            id: accountId,
            userId,
          },
        });

        if (!wallet) {
          throw new AppError('Crypto wallet not found', 404);
        }

        await prisma.cryptoWallet.update({
          where: { id: accountId },
          data: { groupId },
        });
      }

      logger.info(
        `Moved ${accountType} account ${accountId} to group ${groupId || 'null'} for user ${userId}`
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error(`Error moving ${accountType} account to group:`, error);
      throw new AppError(`Failed to move ${accountType} account to group`, 500);
    }
  }

  async getAccountGroupHierarchy(userId: string): Promise<AccountGroupWithDetails[]> {
    try {
      // Get all top-level groups (no parent)
      const topLevelGroups = await prisma.accountGroup.findMany({
        where: {
          userId,
          parentId: null,
        },
        include: {
          financialAccounts: true,
          cryptoWallets: true,
          children: {
            include: {
              financialAccounts: true,
              cryptoWallets: true,
              children: {
                include: {
                  financialAccounts: true,
                  cryptoWallets: true,
                  children: true,
                },
              },
            },
          },
          _count: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      return topLevelGroups;
    } catch (error) {
      logger.error('Error fetching account group hierarchy:', error);
      throw new AppError('Failed to fetch account group hierarchy', 500);
    }
  }

  private async isDescendant(
    userId: string,
    ancestorId: string,
    potentialDescendantId: string
  ): Promise<boolean> {
    const descendants = await this.getAllDescendants(userId, ancestorId);
    return descendants.some((group) => group.id === potentialDescendantId);
  }

  private async getAllDescendants(userId: string, groupId: string): Promise<AccountGroup[]> {
    const descendants: AccountGroup[] = [];

    const children = await prisma.accountGroup.findMany({
      where: {
        userId,
        parentId: groupId,
      },
    });

    for (const child of children) {
      descendants.push(child);
      const childDescendants = await this.getAllDescendants(userId, child.id);
      descendants.push(...childDescendants);
    }

    return descendants;
  }

  async createDefaultGroups(userId: string): Promise<AccountGroup[]> {
    try {
      const defaultGroups = [
        {
          name: 'Primary',
          description: 'Main accounts and wallets',
          icon: '🏦',
          color: '#3B82F6',
          isDefault: true,
        },
        {
          name: 'Savings',
          description: 'Long-term savings and investments',
          icon: '💰',
          color: '#10B981',
          isDefault: true,
        },
        {
          name: 'Crypto',
          description: 'Cryptocurrency wallets and assets',
          icon: '₿',
          color: '#F59E0B',
          isDefault: true,
        },
      ];

      const createdGroups: AccountGroup[] = [];

      for (const groupData of defaultGroups) {
        const existingGroup = await prisma.accountGroup.findFirst({
          where: {
            userId,
            name: groupData.name,
          },
        });

        if (!existingGroup) {
          const group = await prisma.accountGroup.create({
            data: {
              userId,
              ...groupData,
            },
          });
          createdGroups.push(group);
        }
      }

      if (createdGroups.length > 0) {
        logger.info(`Created ${createdGroups.length} default account groups for user ${userId}`);
      }

      return createdGroups;
    } catch (error) {
      logger.error('Error creating default account groups:', error);
      throw new AppError('Failed to create default account groups', 500);
    }
  }
}
