# Frontend Authentication Integration Guide

## Overview
This backend uses **Better Auth v1.3.7** for authentication with JWT-based sessions, two-factor authentication, and comprehensive user management. The backend implements a custom request handler to ensure compatibility with all HTTP methods.

## Quick Setup

### 1. Install Better Auth Client
```bash
npm install better-auth@^1.3.7
# or
yarn add better-auth@^1.3.7
```

### 2. Create Auth Client
```typescript
// lib/auth-client.ts
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: 'http://localhost:3000', // Your backend URL
  fetchOptions: {
    credentials: 'include', // Important for cookie-based sessions
  },
});
```

### 3. React Integration
```typescript
// hooks/useAuth.ts
import { useAuth } from 'better-auth/react';

export const useAuthHooks = () => {
  const { data: session, isPending, error } = useAuth();

  return {
    user: session?.user || null,
    isLoading: isPending,
    error,
    isAuthenticated: !!session?.user,
  };
};
```

## API Endpoints

All auth endpoints are prefixed with `/api/auth/`:

### Core Authentication
- `POST /api/auth/sign-up/email` - Register new user with email
- `POST /api/auth/sign-in/email` - Sign in user with email/password  
- `POST /api/auth/sign-out` - Sign out user
- `GET /api/auth/get-session` - Get current session
- `POST /api/auth/forget-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `POST /api/auth/send-verification-email` - Send email verification
- `POST /api/auth/verify-email` - Verify email with token
- `GET /api/auth/health` - Health check endpoint

### Two-Factor Authentication
- `POST /api/auth/two-factor/enable` - Enable 2FA
- `POST /api/auth/two-factor/verify` - Verify 2FA token
- `POST /api/auth/two-factor/disable` - Disable 2FA
- `POST /api/auth/two-factor/backup-codes` - Generate backup codes

### Bearer Token Support
- `POST /api/auth/bearer/create` - Create bearer token for API access
- `POST /api/auth/bearer/revoke` - Revoke bearer token

## Usage Examples

### Sign Up
```typescript
const signUp = async () => {
  const result = await authClient.signUp.email({
    email: 'user@example.com',
    password: 'securePassword123',
    firstName: 'John',
    lastName: 'Doe',
  });
  
  if (result.error) {
    console.error('Sign up failed:', result.error.message);
  }
};
```

### Sign In
```typescript
const signIn = async () => {
  const result = await authClient.signIn.email({
    email: 'user@example.com',
    password: 'securePassword123',
  });
  
  if (result.error) {
    console.error('Sign in failed:', result.error.message);
  }
};
```

### Get Current User
```typescript
const getCurrentUser = async () => {
  const session = await authClient.getSession();
  return session.data?.user || null;
};

// Alternative: Using the session endpoint directly
const getSessionData = async () => {
  const response = await fetch('/api/auth/get-session', {
    credentials: 'include',
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.user;
  }
  return null;
};
```

### Sign Out
```typescript
const signOut = async () => {
  await authClient.signOut();
};
```

### Password Reset
```typescript
const resetPassword = async () => {
  await authClient.forgetPassword({
    email: 'user@example.com',
    redirectTo: 'http://localhost:3001/reset-password',
  });
};
```

## User Data Structure

```typescript
interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: Date;
  role: string; // 'USER' | 'ADMIN'
  currentPlan: string; // 'FREE' | 'PREMIUM' | 'ENTERPRISE'
  monthlyIncome?: number;
  currency: string; // Default: 'USD'
  timezone: string; // Default: 'UTC'
  profilePicture?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Error Handling

```typescript
const handleAuthAction = async () => {
  try {
    const result = await authClient.signIn.email({
      email: 'user@example.com',
      password: 'password123',
    });
    
    if (result.error) {
      // Handle specific errors
      switch (result.error.code) {
        case 'INVALID_CREDENTIALS':
          setError('Invalid email or password');
          break;
        case 'EMAIL_NOT_VERIFIED':
          setError('Please verify your email first');
          break;
        default:
          setError(result.error.message);
      }
    } else {
      // Success - redirect or update UI
      router.push('/dashboard');
    }
  } catch (error) {
    console.error('Auth error:', error);
    setError('An unexpected error occurred');
  }
};
```

## Protected Routes (React Example)

```typescript
// components/ProtectedRoute.tsx
import { useAuthHooks } from '@/hooks/useAuth';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuthHooks();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};
```

## Environment Variables (Frontend)

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_BASE_URL=http://localhost:3000
```

## Session Management

Sessions are automatically managed via httpOnly cookies:
- **Duration**: 7 days
- **Auto-refresh**: Every 24 hours  
- **Cookie Cache**: 5 minutes (for performance)
- **Secure**: HTTPS only in production
- **Cross-domain**: Configurable for subdomains

### Important Notes:
- The backend uses a **custom request handler** to ensure compatibility with all HTTP methods
- GET/HEAD requests are handled specially to avoid body-related issues
- Sessions work seamlessly with the frontend Better Auth client
- Always include `credentials: 'include'` in fetch requests

## Rate Limiting

Authentication endpoints are rate-limited:
- **Development**: 100 requests/minute
- **Production**: 50 requests/minute

## Security Features

- ✅ Password hashing with bcrypt (12 rounds)
- ✅ Email verification required (production)
- ✅ JWT-based sessions with httpOnly cookies
- ✅ Two-factor authentication with TOTP support
- ✅ Bearer token support for API access
- ✅ Rate limiting on auth endpoints (configurable per environment)
- ✅ CORS protection with trusted origins
- ✅ Secure password reset flow with email integration
- ✅ Role-based access control with custom user fields
- ✅ Session cookie caching for improved performance
- ✅ Custom request handling to prevent GET/HEAD body errors

## Next.js App Router Example

```typescript
// app/providers.tsx
'use client';
import { AuthProvider } from 'better-auth/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}

// app/login/page.tsx
'use client';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const handleLogin = async (formData: FormData) => {
    const result = await authClient.signIn.email({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    });
    
    if (!result.error) {
      window.location.href = '/dashboard';
    }
  };

  return (
    <form action={handleLogin}>
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      <button type="submit">Sign In</button>
    </form>
  );
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Session Not Persisting
**Problem**: User gets logged out on page refresh
**Solution**: Ensure `credentials: 'include'` is set in fetch options:

```typescript
export const authClient = createAuthClient({
  baseURL: 'http://localhost:3000',
  fetchOptions: {
    credentials: 'include', // This is crucial
  },
});
```

#### 2. CORS Issues
**Problem**: Cross-origin requests failing
**Solution**: Verify your frontend URL is in the backend's trusted origins:

```typescript
// Backend config (lib/auth.ts)
trustedOrigins: [
  'http://localhost:3000',
  'http://localhost:3001', // Add your frontend URL
  'http://localhost:3002',
],
```

#### 3. GET/HEAD Body Errors (Fixed)
**Problem**: "Request with GET/HEAD method cannot have body" errors
**Solution**: This has been resolved with the custom request handler implementation. The backend now properly handles all HTTP methods without body-related issues.

#### 4. Email Integration Issues
**Problem**: Password reset/verification emails not sending
**Solution**: Check your email service configuration and ensure the email service is properly initialized.

#### 5. Rate Limiting Errors
**Problem**: Too many requests errors during development
**Solution**: The backend automatically uses higher limits in development mode (100 vs 50 requests/minute).

### Health Check
You can verify the auth service is running by hitting:
```bash
GET http://localhost:3000/api/auth/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "better-auth",
  "timestamp": "2025-08-23T17:15:19.557Z"
}
```

### Version Compatibility
- **Better Auth**: v1.3.7
- **Node.js**: >=20.0.0
- **TypeScript**: ^5.3.3

### Support
For additional help:
1. Check the [Better Auth documentation](https://better-auth.com)
2. Review the backend logs for specific error details
3. Ensure all environment variables are properly configured
```