import { Router } from 'express';
import { auth } from '@/lib/auth';
import { toNodeHandler } from "better-auth/node";

const router = Router();

// Health check endpoint specifically for auth (must come before catch-all)
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


router.all("/api/auth/*", toNodeHandler(auth));


export default router;
