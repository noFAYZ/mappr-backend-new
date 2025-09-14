import { Router } from 'express';
import { auth } from '@/lib/auth';
import { toNodeHandler } from 'better-auth/node';

const router = Router();

/**
 * Better Auth Integration
 *
 * This router handles all Better Auth endpoints via a catch-all handler.
 * Available authentication endpoints are documented in the Swagger configuration:
 * - POST /api/auth/sign-up - Register new user
 * - POST /api/auth/sign-in - Sign in user
 * - POST /api/auth/sign-out - Sign out user
 * - POST /api/auth/forget-password - Request password reset
 * - POST /api/auth/reset-password - Reset password with token
 * - GET /api/auth/verify-email - Verify email with token
 * - GET /api/auth/session - Get current session
 *
 * See swagger.ts for detailed API documentation of these endpoints.
 */

// Health check endpoint specifically for auth (must come before catch-all)
/**
 * @swagger
 * /api/auth/health:
 *   get:
 *     summary: Auth service health check
 *     description: Check if the Better Auth service is running
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Auth service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: better-auth
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/api/auth/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'better-auth',
    timestamp: new Date().toISOString(),
  });
});

// Custom Better Auth handler to avoid the GET/HEAD body issue
/* router.all('/api/auth/*', async (req, res) => {
  try {
    // Create a proper Web API Request object
    const url = new URL(req.url || '', `${req.protocol}://${req.get('host')}`);
    
    // Create headers
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        headers.set(key, value[0]);
      }
    });

    // Create the request object manually to avoid the undici issue
    const requestInit: RequestInit = {
      method: req.method,
      headers: headers,
    };

    // Only include body for non-GET/HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body) {
        requestInit.body = JSON.stringify(req.body);
      }
    }

    const webRequest = new Request(url.toString(), requestInit);

    // Call Better Auth handler
    const response = await auth.handler(webRequest);

    // Copy response headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Set status
    res.status(response.status);

    // Send response body
    if (response.body) {
      const responseText = await response.text();
      res.send(responseText);
    } else {
      res.end();
    }
  } catch (error) {
    console.error('Better Auth error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
 */

router.all('/api/auth/*', toNodeHandler(auth));

export default router;
