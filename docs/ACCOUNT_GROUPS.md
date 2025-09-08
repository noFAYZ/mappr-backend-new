# Account Groups API Documentation

The Account Groups feature allows users to organize and categorize their financial accounts and crypto wallets into custom groups/folders for better management and organization.

## Overview

Account Groups provide a hierarchical way to organize your financial data:
- **Create custom categories** for your accounts and wallets
- **Hierarchical structure** with parent-child relationships
- **Visual organization** with icons and colors
- **Automatic default groups** for new users
- **Move accounts** between groups easily

## Key Features

### ✅ Hierarchical Organization
- Create nested groups with parent-child relationships
- Unlimited depth for complex organizational structures
- Prevents circular references automatically

### ✅ Visual Customization
- Set custom icons (emojis or unicode)
- Choose colors (hex format) for visual distinction
- Custom descriptions for detailed organization

### ✅ Account Management
- Move financial accounts between groups
- Move crypto wallets between groups
- Remove accounts from groups (ungrouped state)

### ✅ Default Groups
- Automatic creation of default groups: Primary, Savings, Crypto
- Default groups are protected from deletion
- Custom styling and organization

## API Endpoints

### Base URL: `/api/v1/account-groups`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/` | Create a new account group |
| `GET` | `/` | Get all account groups |
| `GET` | `/hierarchy` | Get groups in hierarchical structure |
| `POST` | `/defaults` | Create default account groups |
| `POST` | `/move-account` | Move account to different group |
| `GET` | `/{groupId}` | Get specific account group |
| `PUT` | `/{groupId}` | Update account group |
| `DELETE` | `/{groupId}` | Delete account group |

## Quick Start

### 1. Create Default Groups
```bash
curl -X POST "http://localhost:3000/api/v1/account-groups/defaults" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Create Custom Group
```bash
curl -X POST "http://localhost:3000/api/v1/account-groups" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Personal Banking",
    "description": "Personal checking and savings accounts",
    "icon": "🏦",
    "color": "#3B82F6"
  }'
```

### 3. Get All Groups
```bash
curl -X GET "http://localhost:3000/api/v1/account-groups?details=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Move Account to Group
```bash
curl -X POST "http://localhost:3000/api/v1/account-groups/move-account" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "accountId": "account123",
    "groupId": "group456", 
    "accountType": "financial"
  }'
```

## API Schemas & Types

### TypeScript Interfaces

```typescript
// Core Account Group Interface
interface AccountGroup {
  id: string;                    // Unique identifier (cuid)
  userId: string;                // Owner's user ID
  name: string;                  // Group name (1-100 chars)
  description?: string | null;   // Optional description (max 500 chars)
  icon?: string | null;          // Optional icon/emoji (max 50 chars)
  color?: string | null;         // Optional hex color (#RRGGBB or #RGB)
  sortOrder: number;             // Display sort order (>= 0)
  parentId?: string | null;      // Parent group ID for hierarchy
  isDefault: boolean;            // System default group flag
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  
  // Optional relations (included based on query params)
  financialAccounts?: FinancialAccount[];
  cryptoWallets?: CryptoWallet[];
  children?: AccountGroup[];
  _count?: {
    financialAccounts: number;
    cryptoWallets: number;
    children: number;
  };
}

// Request Types
interface CreateAccountGroupRequest {
  name: string;                  // Required: 1-100 characters
  description?: string;          // Optional: max 500 characters
  icon?: string;                 // Optional: max 50 characters
  color?: string;                // Optional: hex format (#RRGGBB or #RGB)
  parentId?: string;             // Optional: parent group cuid
}

interface UpdateAccountGroupRequest {
  name?: string;                 // Optional: 1-100 characters
  description?: string | null;   // Optional: max 500 chars, null to clear
  icon?: string | null;          // Optional: max 50 chars, null to clear
  color?: string | null;         // Optional: hex format, null to clear
  parentId?: string | null;      // Optional: parent ID, null to make top-level
  sortOrder?: number;            // Optional: >= 0
}

interface MoveAccountRequest {
  accountId: string;             // Required: account cuid to move
  groupId: string | null;        // Required: target group ID or null to ungroup
  accountType: 'financial' | 'crypto'; // Required: account type
}

// Related Entity Types
interface FinancialAccount {
  id: string;
  userId: string;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN' | 'MORTGAGE' | 'CRYPTO';
  institutionName?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  balance: number;               // Decimal as number
  currency: string;              // ISO currency code
  isActive: boolean;
  plaidAccountId?: string | null;
  plaidItemId?: string | null;
  groupId?: string | null;       // Associated group ID
  createdAt: string;
  updatedAt: string;
}

interface CryptoWallet {
  id: string;
  userId: string;
  name: string;
  address: string;
  type: 'HOT_WALLET' | 'COLD_WALLET' | 'EXCHANGE' | 'MULTI_SIG' | 'SMART_CONTRACT';
  network: 'ETHEREUM' | 'POLYGON' | 'BSC' | 'ARBITRUM' | 'OPTIMISM' | 'AVALANCHE' | 'SOLANA' | 'BITCOIN' | 'BASE' | 'FANTOM';
  isActive: boolean;
  isWatching: boolean;
  label?: string | null;
  notes?: string | null;
  tags: string[];
  groupId?: string | null;       // Associated group ID
  totalBalance: number;          // Decimal as number
  totalBalanceUsd: number;       // Decimal as number
  assetCount: number;
  nftCount: number;
  createdAt: string;
  updatedAt: string;
}
```

### JSON Request Examples

#### Create Account Group
```json
{
  "name": "Personal Banking",
  "description": "Personal checking and savings accounts",
  "icon": "🏦",
  "color": "#3B82F6"
}
```

#### Update Account Group
```json
{
  "name": "Business Banking Updated",
  "description": "Updated business account group",
  "color": "#10B981",
  "sortOrder": 1
}
```

#### Move Account to Group
```json
{
  "accountId": "clm123account456def",
  "groupId": "clm123group456def",
  "accountType": "financial"
}
```

#### Remove Account from Group
```json
{
  "accountId": "clm123wallet456def",
  "groupId": null,
  "accountType": "crypto"
}
```

### JSON Response Examples

#### Standard Success Response
```json
{
  "success": true,
  "message": "Account group created successfully",
  "data": {
    "id": "clm123abc456def789",
    "userId": "clm123user456def",
    "name": "Personal Banking",
    "description": "Personal checking and savings accounts",
    "icon": "🏦",
    "color": "#3B82F6",
    "sortOrder": 0,
    "parentId": null,
    "isDefault": false,
    "createdAt": "2025-09-07T14:00:00.000Z",
    "updatedAt": "2025-09-07T14:00:00.000Z"
  }
}
```

#### Account Group with Details
```json
{
  "success": true,
  "message": "Account group retrieved successfully",
  "data": {
    "id": "clm123abc456def789",
    "userId": "clm123user456def",
    "name": "Personal Banking",
    "description": "Personal checking and savings accounts",
    "icon": "🏦",
    "color": "#3B82F6",
    "sortOrder": 0,
    "parentId": null,
    "isDefault": false,
    "createdAt": "2025-09-07T14:00:00.000Z",
    "updatedAt": "2025-09-07T14:00:00.000Z",
    "financialAccounts": [
      {
        "id": "clm123acc456def",
        "userId": "clm123user456def",
        "name": "Chase Checking",
        "type": "CHECKING",
        "institutionName": "Chase Bank",
        "balance": 2500.75,
        "currency": "USD",
        "isActive": true,
        "groupId": "clm123abc456def789",
        "createdAt": "2025-09-07T13:00:00.000Z",
        "updatedAt": "2025-09-07T13:30:00.000Z"
      }
    ],
    "cryptoWallets": [
      {
        "id": "clm123wal456def",
        "userId": "clm123user456def",
        "name": "MetaMask Wallet",
        "address": "0x742d35cc6645c0532351bf5541ad8c1c7b6e90e2",
        "type": "HOT_WALLET",
        "network": "ETHEREUM",
        "isActive": true,
        "isWatching": true,
        "tags": ["personal", "defi"],
        "groupId": "clm123abc456def789",
        "totalBalance": 1.5,
        "totalBalanceUsd": 3750.25,
        "assetCount": 5,
        "nftCount": 12,
        "createdAt": "2025-09-07T12:00:00.000Z",
        "updatedAt": "2025-09-07T14:15:00.000Z"
      }
    ],
    "children": [],
    "_count": {
      "financialAccounts": 1,
      "cryptoWallets": 1,
      "children": 0
    }
  }
}
```

#### List of Account Groups
```json
{
  "success": true,
  "message": "Account groups retrieved successfully",
  "data": [
    {
      "id": "clm123primary456def",
      "userId": "clm123user456def",
      "name": "Primary",
      "description": "Main accounts and wallets",
      "icon": "🏦",
      "color": "#3B82F6",
      "sortOrder": 0,
      "parentId": null,
      "isDefault": true,
      "createdAt": "2025-09-07T10:00:00.000Z",
      "updatedAt": "2025-09-07T10:00:00.000Z",
      "_count": {
        "financialAccounts": 2,
        "cryptoWallets": 1,
        "children": 0
      }
    },
    {
      "id": "clm123savings456def",
      "userId": "clm123user456def",
      "name": "Savings",
      "description": "Long-term savings and investments",
      "icon": "💰",
      "color": "#10B981",
      "sortOrder": 1,
      "parentId": null,
      "isDefault": true,
      "createdAt": "2025-09-07T10:01:00.000Z",
      "updatedAt": "2025-09-07T10:01:00.000Z",
      "_count": {
        "financialAccounts": 1,
        "cryptoWallets": 0,
        "children": 2
      }
    }
  ]
}
```

#### Hierarchical Structure
```json
{
  "success": true,
  "message": "Account group hierarchy retrieved successfully",
  "data": [
    {
      "id": "clm123parent456def",
      "name": "Investment Portfolio",
      "icon": "📈",
      "color": "#8B5CF6",
      "sortOrder": 0,
      "parentId": null,
      "isDefault": false,
      "children": [
        {
          "id": "clm123child1456def",
          "name": "Stocks & ETFs",
          "icon": "📊",
          "parentId": "clm123parent456def",
          "financialAccounts": [
            {
              "id": "clm123brokerage456",
              "name": "Fidelity Brokerage",
              "type": "INVESTMENT",
              "balance": 25000.00,
              "currency": "USD"
            }
          ],
          "children": []
        },
        {
          "id": "clm123child2456def",
          "name": "Crypto Holdings",
          "icon": "₿",
          "parentId": "clm123parent456def",
          "cryptoWallets": [
            {
              "id": "clm123crypto456",
              "name": "Hardware Wallet",
              "address": "bc1q...",
              "network": "BITCOIN",
              "totalBalanceUsd": 15000.00
            }
          ],
          "children": []
        }
      ],
      "_count": {
        "financialAccounts": 0,
        "cryptoWallets": 0,
        "children": 2
      }
    }
  ]
}
```

#### Error Response
```json
{
  "success": false,
  "error": {
    "message": "A group with this name already exists at this level",
    "statusCode": 409,
    "timestamp": "2025-09-07T14:00:00.000Z",
    "suggestions": [
      "Choose a different name for the group",
      "Check existing groups at this level",
      "Consider using a more specific name"
    ]
  }
}
```

#### Validation Error Response
```json
{
  "success": false,
  "error": {
    "message": "Validation error: Name is required, Color must be a valid hex format",
    "statusCode": 400,
    "timestamp": "2025-09-07T14:00:00.000Z",
    "details": [
      {
        "field": "name",
        "message": "Name is required",
        "code": "required"
      },
      {
        "field": "color",
        "message": "Invalid color format",
        "code": "invalid_format"
      }
    ]
  }
}
```

## Business Rules

### Creation Rules
- Group names must be unique within the same level (same parent)
- Parent groups must exist and belong to the user
- Color must be valid hex format if provided

### Update Rules
- Cannot create circular references (child cannot become parent of ancestor)
- Name uniqueness enforced at the same hierarchical level
- Default groups cannot be deleted

### Deletion Rules
- Groups must be empty (no accounts or child groups)
- Default groups are protected from deletion
- Accounts in deleted groups become ungrouped

## HTTP Status Codes & Responses

### Success Responses
| Status Code | Description | Example Endpoints |
|-------------|-------------|-------------------|
| `200` | OK - Request successful | `GET /account-groups`, `PUT /account-groups/{id}`, `DELETE /account-groups/{id}` |
| `201` | Created - Resource created successfully | `POST /account-groups`, `POST /account-groups/defaults` |

### Error Responses
| Status Code | Description | When It Occurs |
|-------------|-------------|----------------|
| `400` | Bad Request - Invalid input data | Invalid JSON, validation errors, business rule violations |
| `401` | Unauthorized - Authentication required | Missing or invalid Bearer token |
| `403` | Forbidden - Access denied | Valid token but insufficient permissions |
| `404` | Not Found - Resource not found | Group ID doesn't exist, account not found |
| `409` | Conflict - Resource conflict | Duplicate group name, circular reference detected |
| `429` | Too Many Requests - Rate limited | Exceeded rate limits (200/15min general, 50/15min writes) |
| `500` | Internal Server Error | Database connection issues, unexpected errors |

### Endpoint-Specific Responses

#### `POST /api/v1/account-groups` - Create Account Group

**Request:**
```json
{
  "name": "Investment Accounts",
  "description": "Long-term investment portfolios",
  "icon": "📈",
  "color": "#8B5CF6",
  "parentId": "clm123parent456def"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Account group created successfully",
  "data": {
    "id": "clm123new456def789",
    "userId": "clm123user456def",
    "name": "Investment Accounts",
    "description": "Long-term investment portfolios",
    "icon": "📈",
    "color": "#8B5CF6",
    "sortOrder": 0,
    "parentId": "clm123parent456def",
    "isDefault": false,
    "createdAt": "2025-09-07T14:30:00.000Z",
    "updatedAt": "2025-09-07T14:30:00.000Z"
  }
}
```

**Error Response (409) - Duplicate Name:**
```json
{
  "success": false,
  "error": {
    "message": "A group with this name already exists at this level",
    "statusCode": 409,
    "timestamp": "2025-09-07T14:30:00.000Z"
  }
}
```

#### `GET /api/v1/account-groups?details=true` - List Groups with Details

**Success Response (200):**
```json
{
  "success": true,
  "message": "Account groups retrieved successfully",
  "data": [
    {
      "id": "clm123primary456def",
      "userId": "clm123user456def",
      "name": "Primary",
      "description": "Main accounts and wallets",
      "icon": "🏦",
      "color": "#3B82F6",
      "sortOrder": 0,
      "parentId": null,
      "isDefault": true,
      "createdAt": "2025-09-07T10:00:00.000Z",
      "updatedAt": "2025-09-07T10:00:00.000Z",
      "financialAccounts": [
        {
          "id": "clm123acc1456def",
          "name": "Chase Checking",
          "type": "CHECKING",
          "balance": 2500.75,
          "currency": "USD",
          "institutionName": "Chase Bank",
          "isActive": true
        }
      ],
      "cryptoWallets": [],
      "children": [],
      "_count": {
        "financialAccounts": 1,
        "cryptoWallets": 0,
        "children": 0
      }
    }
  ]
}
```

#### `POST /api/v1/account-groups/move-account` - Move Account

**Request:**
```json
{
  "accountId": "clm123wallet456def",
  "groupId": "clm123crypto456def",
  "accountType": "crypto"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Crypto account moved to group successfully"
}
```

**Error Response (404) - Account Not Found:**
```json
{
  "success": false,
  "error": {
    "message": "Crypto wallet not found",
    "statusCode": 404,
    "timestamp": "2025-09-07T14:30:00.000Z"
  }
}
```

#### `PUT /api/v1/account-groups/{groupId}` - Update Group

**Request:**
```json
{
  "name": "Updated Investment Accounts",
  "description": "Updated description for investment accounts",
  "sortOrder": 2
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Account group updated successfully",
  "data": {
    "id": "clm123group456def",
    "userId": "clm123user456def",
    "name": "Updated Investment Accounts",
    "description": "Updated description for investment accounts",
    "icon": "📈",
    "color": "#8B5CF6",
    "sortOrder": 2,
    "parentId": null,
    "isDefault": false,
    "createdAt": "2025-09-07T10:00:00.000Z",
    "updatedAt": "2025-09-07T14:35:00.000Z"
  }
}
```

**Error Response (400) - Circular Reference:**
```json
{
  "success": false,
  "error": {
    "message": "Cannot set a descendant as parent",
    "statusCode": 400,
    "timestamp": "2025-09-07T14:30:00.000Z"
  }
}
```

#### `DELETE /api/v1/account-groups/{groupId}` - Delete Group

**Success Response (200):**
```json
{
  "success": true,
  "message": "Account group deleted successfully"
}
```

**Error Response (400) - Group Not Empty:**
```json
{
  "success": false,
  "error": {
    "message": "Cannot delete group with accounts. Move accounts to another group first.",
    "statusCode": 400,
    "timestamp": "2025-09-07T14:30:00.000Z"
  }
}
```

**Error Response (400) - Default Group Protection:**
```json
{
  "success": false,
  "error": {
    "message": "Cannot delete default groups",
    "statusCode": 400,
    "timestamp": "2025-09-07T14:30:00.000Z"
  }
}
```

## Rate Limits

- **General requests**: 200 requests per 15 minutes
- **Write operations**: 50 requests per 15 minutes

## Authentication

All endpoints require Bearer token authentication:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Use Cases

### Personal Finance Organization
```
📁 Personal Banking (Primary)
  ├── 🏦 Chase Checking
  └── 💰 High-Yield Savings

📁 Investment Accounts
  ├── 📈 Brokerage Account
  └── 🏛️ 401k Account

📁 Crypto Portfolio
  ├── ₿ Bitcoin Wallet
  └── 🦄 DeFi Wallet
```

### Business Organization
```
📁 Operating Accounts
  ├── 🏢 Business Checking
  └── 💼 Payroll Account

📁 Investment & Growth
  ├── 📊 Business Savings
  └── 🚀 Growth Fund

📁 Crypto Treasury
  └── 💎 Corporate Wallet
```

## Database Schema

The feature uses the following database tables:
- `account_groups` - Main groups table
- `financial_accounts.groupId` - Foreign key to groups
- `crypto_wallets.groupId` - Foreign key to groups

## Integration Notes

- Groups are user-scoped (isolated per user)
- Soft deletion maintains referential integrity
- Hierarchical queries optimized for performance
- Full TypeScript support with proper interfaces

