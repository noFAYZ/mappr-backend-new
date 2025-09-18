import { Request, Response, NextFunction } from 'express';
import { getCacheService } from '@/services/CacheService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/common';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  key?: string | ((req: Request) => string); // Custom cache key
  tags?: string[] | ((req: Request) => string[]); // Cache invalidation tags
  condition?: (req: Request, res: Response) => boolean; // Conditional caching
  skipCache?: (req: Request) => boolean; // Skip cache for certain conditions
  varyBy?: string[]; // Request properties to include in cache key
}

/**
 * Advanced caching middleware with intelligent key generation and invalidation
 */
export function cache(options: CacheOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cacheService = getCacheService();

    // Skip caching if no cache service or skip condition met
    if (!cacheService || (options.skipCache && options.skipCache(req))) {
      return next();
    }

    try {
      const cacheKey = generateCacheKey(req, options);
      const requestId = (req.headers['x-request-id'] as string) || 'unknown';

      // Try to get from cache
      const cached = await cacheService.get<ApiResponse>(cacheKey);

      if (cached) {
        // Add cache headers
        res.set({
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey,
          'X-Request-ID': requestId,
        });

        logger.debug('Cache hit', {
          requestId,
          cacheKey,
          method: req.method,
          url: req.url,
        });

        res.json(cached);
        return;
      }

      // Cache miss - proceed with request and cache response
      res.set('X-Cache', 'MISS');

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = function (body: any) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const shouldCache = !options.condition || options.condition(req, res);

          if (shouldCache && isValidForCaching(body)) {
            const ttl = options.ttl || 300; // Default 5 minutes
            const tags = generateTags(req, options);

            // Cache in background to avoid blocking response
            cacheService.set(cacheKey, body, { ttl, tags }).catch((error) => {
              logger.error('Failed to cache response', {
                requestId,
                cacheKey,
                error: error.message,
              });
            });

            logger.debug('Response cached', {
              requestId,
              cacheKey,
              ttl,
              tags,
              method: req.method,
              url: req.url,
            });
          }
        }

        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error', {
        error: error instanceof Error ? error.message : String(error),
        method: req.method,
        url: req.url,
      });

      // Don't fail the request due to cache errors
      next();
    }
  };
}

/**
 * Generate intelligent cache key based on request parameters
 */
function generateCacheKey(req: Request, options: CacheOptions): string {
  if (typeof options.key === 'string') {
    return options.key;
  }

  if (typeof options.key === 'function') {
    return options.key(req);
  }

  // Generate key from request properties
  const keyParts: string[] = [req.method, req.route?.path || req.path];

  // Add query parameters
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  if (queryString) {
    keyParts.push(`query:${queryString}`);
  }

  // Add user context
  const userId = (req as any).user?.id;
  if (userId) {
    keyParts.push(`user:${userId}`);
  }

  // Add vary-by fields
  if (options.varyBy) {
    options.varyBy.forEach((field) => {
      const value = getNestedValue(req, field);
      if (value !== undefined) {
        keyParts.push(`${field}:${value}`);
      }
    });
  }

  // Add headers that affect caching
  const varyHeaders = ['accept', 'accept-language', 'authorization'];
  varyHeaders.forEach((header) => {
    const value = req.headers[header];
    if (value) {
      keyParts.push(`${header}:${hashString(String(value))}`);
    }
  });

  return keyParts.join('|');
}

/**
 * Generate cache invalidation tags
 */
function generateTags(req: Request, options: CacheOptions): string[] {
  if (Array.isArray(options.tags)) {
    return options.tags;
  }

  if (typeof options.tags === 'function') {
    return options.tags(req);
  }

  const tags: string[] = [];

  // Add route-based tags
  if (req.route?.path) {
    tags.push(`route:${req.route.path}`);
  }

  // Add user-based tags
  const userId = (req as any).user?.id;
  if (userId) {
    tags.push(`user:${userId}`);
  }

  // Add resource-based tags from params
  Object.entries(req.params).forEach(([key, value]) => {
    if (value) {
      tags.push(`${key}:${value}`);
    }
  });

  return tags;
}

/**
 * Check if response body is valid for caching
 */
function isValidForCaching(body: any): boolean {
  // Don't cache empty responses
  if (!body) return false;

  // Don't cache error responses
  if (body.success === false) return false;

  // Don't cache responses with sensitive data
  if (body.password || body.token || body.secret) return false;

  // Don't cache very large responses (> 1MB)
  const size = JSON.stringify(body).length;
  if (size > 1024 * 1024) return false;

  return true;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Cache invalidation middleware
 */
export function invalidateCache(tags: string[] | ((req: Request) => string[])) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cacheService = getCacheService();

    if (!cacheService) {
      return next();
    }

    try {
      // Store original end method
      const originalEnd = res.end.bind(res);

      // Override end method to invalidate cache after successful response
      res.end = function (chunk?: any, encoding?: any, cb?: any) {
        // Only invalidate on successful mutations
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const tagsToInvalidate = Array.isArray(tags) ? tags : tags(req);

          if (tagsToInvalidate.length > 0) {
            // Invalidate in background
            cacheService.invalidateByTags(tagsToInvalidate).catch((error) => {
              logger.error('Failed to invalidate cache', {
                tags: tagsToInvalidate,
                error: error.message,
              });
            });

            logger.debug('Cache invalidated', {
              tags: tagsToInvalidate,
              method: req.method,
              url: req.url,
            });
          }
        }

        return originalEnd(chunk, encoding, cb);
      };

      next();
    } catch (error) {
      logger.error('Cache invalidation middleware error', {
        error: error instanceof Error ? error.message : String(error),
      });

      next();
    }
  };
}

/**
 * Conditional caching based on user role or other criteria
 */
export function conditionalCache(
  options: CacheOptions & {
    cacheForRoles?: string[];
    skipForRoles?: string[];
  }
) {
  return cache({
    ...options,
    skipCache: (req: Request) => {
      const user = (req as any).user;

      if (!user) return false;

      // Skip cache for certain roles
      if (options.skipForRoles?.includes(user.role)) {
        return true;
      }

      // Only cache for certain roles
      if (options.cacheForRoles && !options.cacheForRoles.includes(user.role)) {
        return true;
      }

      return options.skipCache ? options.skipCache(req) : false;
    },
  });
}

/**
 * Rate-limited caching to prevent cache stampede
 */
export function rateLimitedCache(
  options: CacheOptions & {
    maxConcurrentRequests?: number;
  }
) {
  const pendingRequests = new Map<string, Promise<any>>();
  const maxConcurrent = options.maxConcurrentRequests || 10;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cacheService = getCacheService();

    if (!cacheService) {
      return next();
    }

    try {
      const cacheKey = generateCacheKey(req, options);

      // Check if request is already pending
      const pendingRequest = pendingRequests.get(cacheKey);
      if (pendingRequest) {
        try {
          const cachedResult = await pendingRequest;
          if (cachedResult) {
            res.set('X-Cache', 'PENDING');
            res.json(cachedResult);
            return;
          }
        } catch {
          // If pending request failed, continue with normal flow
        }
      }

      // Limit concurrent requests for the same key
      if (pendingRequests.size >= maxConcurrent) {
        logger.warn('Cache rate limit exceeded', {
          cacheKey,
          pendingCount: pendingRequests.size,
        });
        return next();
      }

      // Apply normal caching
      cache(options)(req, res, next);
    } catch (error) {
      logger.error('Rate-limited cache error', {
        error: error instanceof Error ? error.message : String(error),
      });

      next();
    }
  };
}

/**
 * Pre-warming cache middleware for predictable routes
 */
export function preWarmCache(
  routes: Array<{
    path: string;
    method: string;
    warmupFunction: () => Promise<unknown>;
    ttl?: number;
  }>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const cacheService = getCacheService();

    if (!cacheService) {
      return next();
    }

    // Find matching route
    const route = routes.find(
      (r) => r.method.toLowerCase() === req.method.toLowerCase() && req.path.includes(r.path)
    );

    if (route) {
      const cacheKey = generateCacheKey(req, {});

      // Check if cache exists
      const cached = await cacheService.exists(cacheKey);

      if (!cached) {
        // Pre-warm cache in background
        route
          .warmupFunction()
          .then((data) => {
            if (data) {
              cacheService.set(cacheKey, data, { ttl: route.ttl || 300 });
            }
          })
          .catch((error) => {
            logger.error('Cache pre-warming failed', {
              route: route.path,
              error: error.message,
            });
          });
      }
    }

    return next();
  };
}
