# Admin Dashboard

A comprehensive admin dashboard for managing the Mappr Financial application with advanced analytics, user management, and system monitoring capabilities.

## 🚀 Features

### Dashboard & Analytics
- **Real-time Dashboard** - Key metrics and KPIs overview
- **User Analytics** - Growth trends, activity patterns, and demographics
- **Revenue Analytics** - Subscription metrics, MRR tracking, and churn analysis
- **Usage Statistics** - Feature usage tracking and platform insights
- **Custom Reports** - Generate detailed reports for specific time periods

### User Management
- **User Directory** - Search, filter, and paginate through all users
- **User Administration** - Update user status, roles, and subscription plans
- **Advanced Filtering** - Filter by status, plan, and search by name/email
- **Audit Trail** - Track all admin actions with detailed logging

### System Monitoring
- **Health Checks** - Database performance and API health monitoring
- **System Alerts** - Automated alerts for errors, performance issues, and failures
- **Performance Metrics** - Response times, error rates, and uptime tracking
- **System Maintenance** - Automated cleanup and optimization tools

### Security & Audit
- **Role-Based Access** - Secure admin-only endpoints with proper authorization
- **Audit Logs** - Comprehensive logging of all admin actions
- **Permission Validation** - Multi-level permission checks for sensitive operations
- **Rate Limiting** - Enhanced rate limiting for admin endpoints

## 📊 API Endpoints

### Dashboard & Analytics
```
GET /api/v1/admin/dashboard/stats          # Dashboard overview statistics
GET /api/v1/admin/analytics/users          # User analytics and trends
GET /api/v1/admin/analytics/revenue        # Revenue and subscription analytics
GET /api/v1/admin/analytics/usage          # Platform usage statistics
GET /api/v1/admin/platform/stats           # Comprehensive platform statistics
```

### User Management
```
GET /api/v1/admin/users                     # Get all users with filtering
PUT /api/v1/admin/users/{userId}            # Update user details
```

### System Monitoring
```
GET /api/v1/admin/system/health             # System health metrics
GET /api/v1/admin/system/alerts             # Active system alerts
POST /api/v1/admin/system/maintenance       # Perform system maintenance
```

### Reports & Audit
```
GET /api/v1/admin/reports/generate          # Generate system reports
GET /api/v1/admin/audit/logs                # View audit logs
```

## 🔐 Authentication & Authorization

### Prerequisites
- User must be authenticated (valid JWT token)
- User must have `ADMIN` role in the database
- All admin endpoints are protected with `requireAdmin` middleware

### Creating Admin Users

#### Option 1: Using the Admin Creation Script
```bash
# Run the interactive admin creation script
tsx src/scripts/createAdmin.ts

# Follow the prompts to create your first admin user
```

#### Option 2: Direct Database Update
```sql
-- Update an existing user to admin role
UPDATE users 
SET role = 'ADMIN', status = 'ACTIVE' 
WHERE email = 'your-admin@email.com';
```

#### Option 3: Using Admin Helper (Programmatic)
```typescript
import { adminHelpers } from '@/utils/adminHelpers';

await adminHelpers.createSystemAdmin(
  'admin@example.com',
  'securePassword123!',
  'Admin',
  'User'
);
```

## 📈 Dashboard Metrics

### User Metrics
- **Total Users** - All registered users
- **Active Users** - Users logged in within last 30 days
- **New Users This Month** - Monthly growth tracking
- **User Status Breakdown** - Active/Inactive/Suspended counts
- **Plan Distribution** - FREE/PRO/ULTIMATE breakdown

### Revenue Metrics
- **Total Revenue** - All-time successful payments
- **Monthly Recurring Revenue** - Subscription-based income
- **Churn Rate** - Subscription cancellation trends
- **Average Revenue Per User** - ARPU calculations

### Platform Metrics
- **Total Crypto Wallets** - Connected wallets across all users
- **Total Transactions** - Financial transaction volume
- **Feature Usage** - Most/least used platform features
- **API Request Volume** - Platform usage intensity

### System Health
- **Database Response Time** - Performance monitoring
- **Error Rate** - System stability metrics
- **Uptime** - Service availability
- **Memory Usage** - Resource utilization

## 🛠️ Usage Examples

### Get Dashboard Overview
```typescript
const response = await fetch('/api/v1/admin/dashboard/stats', {
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  }
});

const dashboardData = await response.json();
```

### Filter Users by Status
```typescript
const response = await fetch('/api/v1/admin/users?status=ACTIVE&page=1&limit=20', {
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});

const users = await response.json();
```

### Update User Status
```typescript
const response = await fetch('/api/v1/admin/users/user123', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'SUSPENDED',
    role: 'USER'
  })
});
```

### Generate Custom Report
```typescript
const startDate = '2024-01-01';
const endDate = '2024-01-31';

const response = await fetch(`/api/v1/admin/reports/generate?startDate=${startDate}&endDate=${endDate}`, {
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});

const report = await response.json();
```

## 🔍 Filtering & Search

### User Filtering Options
- **Status Filter**: `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING_VERIFICATION`
- **Plan Filter**: `FREE`, `PRO`, `ULTIMATE`
- **Search**: Search by email, first name, or last name
- **Pagination**: Page-based pagination with configurable limits

### Usage Analytics Filters
- **Time Range**: `1d`, `7d`, `30d` for different analysis periods
- **Feature Breakdown**: Usage statistics by feature type
- **User Activity**: Top users by platform usage

### Audit Log Filters
- **Action Filter**: Filter by specific admin actions
- **Resource Filter**: Filter by resource type (user, system, etc.)
- **Date Range**: Filter logs by time period

## 📊 System Alerts

### Automatic Alert Types
- **High Error Rate** - >100 errors per hour
- **Failed Payments** - >10 failed payments in 24h
- **Slow Database** - >2000ms response times
- **System Issues** - General system health problems

### Alert Severity Levels
- **HIGH** - Critical issues requiring immediate attention
- **MEDIUM** - Important issues that should be addressed soon
- **LOW** - Minor issues for awareness

## 🧹 System Maintenance

### Automated Cleanup Tasks
- **Expired Sessions** - Remove sessions older than expiration
- **Old Audit Logs** - Archive logs older than 1 year
- **Orphaned Records** - Clean up data integrity issues

### Maintenance Safety
- All maintenance operations are logged
- Permission validation before execution
- Rollback capabilities for critical operations

## 📚 API Documentation

Complete API documentation is available through Swagger UI:
- **Development**: http://localhost:3000/docs
- **Production**: Configure `SWAGGER_UI_ENABLED=true`

### Swagger Tags
- **Admin Dashboard** - Overview and statistics endpoints
- **Admin Analytics** - Advanced analytics and reporting
- **Admin User Management** - User administration functions
- **Admin System** - System monitoring and maintenance
- **Admin Audit** - Audit logs and security monitoring

## 🛡️ Security Considerations

### Rate Limiting
- Admin endpoints have stricter rate limits (200 requests/15min)
- Write operations are further limited to prevent abuse
- IP-based tracking with configurable limits

### Audit Trail
- All admin actions are logged with full details
- IP address and user agent tracking
- Immutable audit log for compliance

### Permission Validation
- Multi-level permission checks
- Admin role verification on every request
- Account status validation (must be ACTIVE)

## 🚀 Getting Started

1. **Set up the Admin User**:
   ```bash
   tsx src/scripts/createAdmin.ts
   ```

2. **Access the Admin Dashboard**:
   ```
   Base URL: /api/v1/admin/
   Documentation: /docs
   ```

3. **Test the Endpoints**:
   ```bash
   # Get dashboard stats
   curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
        http://localhost:3000/api/v1/admin/dashboard/stats
   ```

## 📞 Support

For admin dashboard issues or questions:
- Check the audit logs for detailed error information
- Review system alerts for ongoing issues
- Use the health check endpoints to diagnose problems

The admin dashboard provides comprehensive tools for managing your Mappr Financial application with enterprise-level insights and controls.