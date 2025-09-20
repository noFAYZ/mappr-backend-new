import { PlanType } from '@prisma/client';

export interface PlanFeatures {
  maxAccounts: number;
  maxWallets: number;
  maxTransactions: number;
  maxCategories: number;
  maxBudgets: number;
  maxGoals: number;
  aiInsights: boolean;
  advancedReports: boolean;
  prioritySupport: boolean;
  apiAccess: boolean;
  exportData: boolean;
  customCategories: boolean;
  bankSync: boolean;
  multiCurrency: boolean;
  collaborativeAccounts: boolean;
  investmentTracking: boolean;
  taxReporting: boolean;
  mobileApp: boolean;
}

export interface PlanConfig {
  type: PlanType;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  yearlyDiscount: number; // percentage
  features: PlanFeatures;
  popular?: boolean;
  trialDays?: number;
}

export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
  [PlanType.FREE]: {
    type: PlanType.FREE,
    name: 'Free',
    description: 'Perfect for getting started with basic financial tracking',
    monthlyPrice: 0,
    yearlyPrice: 0,
    yearlyDiscount: 0,
    features: {
      maxAccounts: 2,
      maxWallets: 3,
      maxTransactions: 100,
      maxCategories: 10,
      maxBudgets: 3,
      maxGoals: 2,
      aiInsights: false,
      advancedReports: false,
      prioritySupport: false,
      apiAccess: false,
      exportData: false,
      customCategories: false,
      bankSync: false,
      multiCurrency: false,
      collaborativeAccounts: false,
      investmentTracking: false,
      taxReporting: false,
      mobileApp: true,
    },
    trialDays: 0,
  },
  [PlanType.PRO]: {
    type: PlanType.PRO,
    name: 'Pro',
    description: 'Advanced features for serious financial management',
    monthlyPrice: 19.99,
    yearlyPrice: 199.99,
    yearlyDiscount: 17, // ~17% discount
    popular: true,
    features: {
      maxAccounts: 5,
      maxWallets: 5,
      maxTransactions: 5000,
      maxCategories: 50,
      maxBudgets: 20,
      maxGoals: 15,
      aiInsights: true,
      advancedReports: true,
      prioritySupport: false,
      apiAccess: true,
      exportData: true,
      customCategories: true,
      bankSync: true,
      multiCurrency: true,
      collaborativeAccounts: false,
      investmentTracking: true,
      taxReporting: false,
      mobileApp: true,
    },
    trialDays: 14,
  },
  [PlanType.ULTIMATE]: {
    type: PlanType.ULTIMATE,
    name: 'Ultimate',
    description: 'Complete financial ecosystem for professionals and businesses',
    monthlyPrice: 49.99,
    yearlyPrice: 499.99,
    yearlyDiscount: 17, // ~17% discount
    features: {
      maxAccounts: -1, // unlimited
      maxWallets: -1, // unlimited
      maxTransactions: -1, // unlimited
      maxCategories: -1, // unlimited
      maxBudgets: -1, // unlimited
      maxGoals: -1, // unlimited
      aiInsights: true,
      advancedReports: true,
      prioritySupport: true,
      apiAccess: true,
      exportData: true,
      customCategories: true,
      bankSync: true,
      multiCurrency: true,
      collaborativeAccounts: true,
      investmentTracking: true,
      taxReporting: true,
      mobileApp: true,
    },
    trialDays: 30,
  },
};

// Helper functions
export const getPlanConfig = (planType: PlanType): PlanConfig => {
  return PLAN_CONFIGS[planType];
};

export const getPlanFeatures = (planType: PlanType): PlanFeatures => {
  return PLAN_CONFIGS[planType].features;
};

export const isFeatureAvailable = (planType: PlanType, feature: keyof PlanFeatures): boolean => {
  return getPlanFeatures(planType)[feature] as boolean;
};

export const getFeatureLimit = (planType: PlanType, feature: keyof PlanFeatures): number => {
  const limit = getPlanFeatures(planType)[feature] as number;
  return limit === -1 ? Infinity : limit;
};

export const canExceedLimit = (
  planType: PlanType,
  feature: keyof PlanFeatures,
  currentCount: number
): boolean => {
  const limit = getFeatureLimit(planType, feature);
  return currentCount < limit;
};

// Plan comparison helper
export const getAllPlans = (): PlanConfig[] => {
  return Object.values(PLAN_CONFIGS);
};

export const getActivePlans = (): PlanConfig[] => {
  return getAllPlans(); // All plans are active for now
};

// Pricing helpers
export const getYearlySavings = (planType: PlanType): number => {
  const config = getPlanConfig(planType);
  const monthlyTotal = config.monthlyPrice * 12;
  return monthlyTotal - config.yearlyPrice;
};

export const getYearlyDiscountPercentage = (planType: PlanType): number => {
  const config = getPlanConfig(planType);
  return config.yearlyDiscount;
};

// Plan upgrade/downgrade helpers
export const canUpgradeTo = (currentPlan: PlanType, targetPlan: PlanType): boolean => {
  const planHierarchy = {
    [PlanType.FREE]: 0,
    [PlanType.PRO]: 1,
    [PlanType.ULTIMATE]: 2,
  };

  return planHierarchy[targetPlan] > planHierarchy[currentPlan];
};

export const canDowngradeTo = (currentPlan: PlanType, targetPlan: PlanType): boolean => {
  const planHierarchy = {
    [PlanType.FREE]: 0,
    [PlanType.PRO]: 1,
    [PlanType.ULTIMATE]: 2,
  };

  return planHierarchy[targetPlan] < planHierarchy[currentPlan];
};

export const getNextTierPlan = (currentPlan: PlanType): PlanType | null => {
  switch (currentPlan) {
    case PlanType.FREE:
      return PlanType.PRO;
    case PlanType.PRO:
      return PlanType.ULTIMATE;
    case PlanType.ULTIMATE:
      return null;
    default:
      return null;
  }
};

export const getPreviousTierPlan = (currentPlan: PlanType): PlanType | null => {
  switch (currentPlan) {
    case PlanType.ULTIMATE:
      return PlanType.PRO;
    case PlanType.PRO:
      return PlanType.FREE;
    case PlanType.FREE:
      return null;
    default:
      return null;
  }
};
