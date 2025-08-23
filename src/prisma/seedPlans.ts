import { PrismaClient } from '@prisma/client';
import { PLAN_CONFIGS } from '../config/plans';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export async function seedPlans() {
  try {
    logger.info('Seeding plans...');

    for (const planConfig of Object.values(PLAN_CONFIGS)) {
      const existingPlan = await prisma.plan.findUnique({
        where: { type: planConfig.type },
      });

      if (existingPlan) {
        // Update existing plan
        await prisma.plan.update({
          where: { type: planConfig.type },
          data: {
            name: planConfig.name,
            description: planConfig.description,
            monthlyPrice: planConfig.monthlyPrice,
            yearlyPrice: planConfig.yearlyPrice,
            maxAccounts:
              planConfig.features.maxAccounts === -1 ? 999999 : planConfig.features.maxAccounts,
            maxTransactions:
              planConfig.features.maxTransactions === -1
                ? 999999
                : planConfig.features.maxTransactions,
            maxCategories:
              planConfig.features.maxCategories === -1 ? 999999 : planConfig.features.maxCategories,
            maxBudgets:
              planConfig.features.maxBudgets === -1 ? 999999 : planConfig.features.maxBudgets,
            maxGoals: planConfig.features.maxGoals === -1 ? 999999 : planConfig.features.maxGoals,
            aiInsights: planConfig.features.aiInsights,
            advancedReports: planConfig.features.advancedReports,
            prioritySupport: planConfig.features.prioritySupport,
            apiAccess: planConfig.features.apiAccess,
            exportData: planConfig.features.exportData,
            customCategories: planConfig.features.customCategories,
          },
        });
        logger.info(`Updated plan: ${planConfig.name}`);
      } else {
        // Create new plan
        await prisma.plan.create({
          data: {
            type: planConfig.type,
            name: planConfig.name,
            description: planConfig.description,
            monthlyPrice: planConfig.monthlyPrice,
            yearlyPrice: planConfig.yearlyPrice,
            maxAccounts:
              planConfig.features.maxAccounts === -1 ? 999999 : planConfig.features.maxAccounts,
            maxTransactions:
              planConfig.features.maxTransactions === -1
                ? 999999
                : planConfig.features.maxTransactions,
            maxCategories:
              planConfig.features.maxCategories === -1 ? 999999 : planConfig.features.maxCategories,
            maxBudgets:
              planConfig.features.maxBudgets === -1 ? 999999 : planConfig.features.maxBudgets,
            maxGoals: planConfig.features.maxGoals === -1 ? 999999 : planConfig.features.maxGoals,
            aiInsights: planConfig.features.aiInsights,
            advancedReports: planConfig.features.advancedReports,
            prioritySupport: planConfig.features.prioritySupport,
            apiAccess: planConfig.features.apiAccess,
            exportData: planConfig.features.exportData,
            customCategories: planConfig.features.customCategories,
          },
        });
        logger.info(`Created plan: ${planConfig.name}`);
      }
    }

    logger.info('Plans seeded successfully');
  } catch (error) {
    logger.error('Error seeding plans:', error);
    throw error;
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedPlans()
    .catch((error) => {
      logger.error('Seeding failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
