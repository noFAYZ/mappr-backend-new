import { createAuthClient } from 'better-auth/client';

/**
 * Better Auth client configuration for frontend
 * Export this configuration to be used in your frontend application
 */
export const authClient = createAuthClient({
  baseURL: process.env['BETTER_AUTH_BASE_URL'] || 'http://localhost:3000',

  // Plugin configurations (add as needed)
  plugins: [
    // Add client-side plugins
  ],
});

// Export types for frontend use
export type AuthClient = typeof authClient;

/**
 * Frontend helper functions
 */
export const clientHelpers = {
  // Get current user from session
  getCurrentUser: async () => {
    try {
      const session = await authClient.getSession();
      return session.data?.user || null;
    } catch {
      return null;
    }
  },

  // Check if user is authenticated
  isAuthenticated: async () => {
    try {
      const session = await authClient.getSession();
      return !!session.data?.user;
    } catch {
      return false;
    }
  },

  // Check if user has specific role
  hasRole: async (roles: string[]) => {
    try {
      const user = await clientHelpers.getCurrentUser();
      if (!user) return false;
      return roles.includes((user as any).role || 'USER');
    } catch {
      return false;
    }
  },

  // Sign out user
  signOut: async () => {
    try {
      await authClient.signOut();
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * React hooks can be created like this:
 *
 * import { useAuth } from 'better-auth/react';
 *
 * export const useAuthHooks = () => {
 *   const { data: session, isPending, error } = useAuth();
 *
 *   return {
 *     user: session?.user || null,
 *     isLoading: isPending,
 *     error,
 *     isAuthenticated: !!session?.user,
 *   };
 * };
 */
