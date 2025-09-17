-- AddAccountGroups Migration
-- Create account_groups table
CREATE TABLE IF NOT EXISTS "account_groups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_groups_pkey" PRIMARY KEY ("id")
);

-- Add groupId column to crypto_wallets
ALTER TABLE "crypto_wallets" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

-- Add foreign key constraints
ALTER TABLE "crypto_wallets"
ADD CONSTRAINT "crypto_wallets_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "account_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_groups"
ADD CONSTRAINT "account_groups_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_groups"
ADD CONSTRAINT "account_groups_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "account_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;