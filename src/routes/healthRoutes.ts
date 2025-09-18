import { Router } from 'express';
import { asyncHandler } from '@/middleware/errorHandler';
import { monitoringService } from '@/services/MonitoringService';
import { cache } from '@/middleware/cacheMiddleware';
import { validateApiKey } from '@/middleware/securityMiddleware';
import { validate } from '@/middleware/validationMiddleware';
import { ApiResponse } from '@/types/common';
import Joi from 'joi';

const router = Router();

// Health check endpoint - public, no auth required
router.get(
  '/',
  cache({ ttl: 30, skipCache: (req) => req.query['nocache'] === 'true' }),
  asyncHandler(async (_req, res) => {
    const health = await monitoringService.checkHealth();

    const response: ApiResponse = {
      success: health.status === 'healthy',
      data: {
        status: health.status,
        timestamp: health.timestamp,
        uptime: health.metrics.uptime,
        version: process.env['APP_VERSION'] || '1.0.0',
        environment: process.env['NODE_ENV'] || 'development',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    // Return appropriate status code
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(response);
  })
);

// Detailed health check - requires API key
router.get(
  '/detailed',
  validateApiKey,
  cache({ ttl: 30, skipCache: (req) => req.query['nocache'] === 'true' }),
  asyncHandler(async (_req, res) => {
    const health = await monitoringService.checkHealth();

    const response: ApiResponse = {
      success: true,
      data: health,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Individual service health check
router.get(
  '/service/:serviceName',
  validateApiKey,
  validate(
    Joi.object({
      serviceName: Joi.string().required(),
    }),
    'params'
  ),
  cache({ ttl: 30 }),
  asyncHandler(async (_req, res) => {
    const { serviceName } = req.params;
    const serviceHealth = await monitoringService.checkServiceHealth(serviceName!);

    if (!serviceHealth) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Service not found',
          statusCode: 404,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse = {
      success: serviceHealth.status === 'healthy',
      data: serviceHealth,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    const statusCode = serviceHealth.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(response);
  })
);

// System metrics endpoint
router.get(
  '/metrics',
  validateApiKey,
  validate(
    Joi.object({
      service: Joi.string().optional(),
      limit: Joi.number().integer().min(1).max(1000).default(100),
    }),
    'query'
  ),
  cache({ ttl: 60 }),
  asyncHandler(async (_req, res) => {
    const { service, limit } = req.query as unknown as { service?: string; limit: number };
    const metrics = monitoringService.getMetrics(service, limit);

    const response: ApiResponse = {
      success: true,
      data: {
        metrics,
        count: metrics.length,
        service,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Aggregated metrics endpoint
router.get(
  '/metrics/:service/aggregated',
  validateApiKey,
  validate(
    Joi.object({
      service: Joi.string().required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      timeRange: Joi.number().integer().min(1).max(1440).default(60), // minutes
    }),
    'query'
  ),
  cache({ ttl: 300 }),
  asyncHandler(async (_req, res) => {
    const { service } = req.params;
    const { timeRange } = req.query as unknown as { timeRange: number };

    const aggregatedMetrics = monitoringService.getAggregatedMetrics(service!, timeRange);

    const response: ApiResponse = {
      success: true,
      data: aggregatedMetrics,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Performance summary endpoint
router.get(
  '/performance',
  validateApiKey,
  cache({ ttl: 60 }),
  asyncHandler(async (_req, res) => {
    const performanceSummary = await monitoringService.getPerformanceSummary();

    const response: ApiResponse = {
      success: true,
      data: performanceSummary,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Readiness probe - for Kubernetes/container orchestration
router.get(
  '/ready',
  cache({ ttl: 10 }),
  asyncHandler(async (_req, res) => {
    const health = await monitoringService.checkHealth();

    // Check critical services only for readiness
    const criticalServices = ['database', 'cache'];
    const criticalServicesHealth = health.services.filter((s) =>
      criticalServices.includes(s.service)
    );

    const isReady = criticalServicesHealth.every((s) => s.status !== 'unhealthy');

    const response: ApiResponse = {
      success: isReady,
      data: {
        ready: isReady,
        criticalServices: criticalServicesHealth,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(response);
  })
);

// Liveness probe - for Kubernetes/container orchestration
router.get(
  '/live',
  asyncHandler(async (_req, res) => {
    // Simple liveness check - just verify the service is responding
    const response: ApiResponse = {
      success: true,
      data: {
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Startup probe - for Kubernetes/container orchestration
router.get(
  '/startup',
  cache({ ttl: 5 }),
  asyncHandler(async (_req, res) => {
    const health = await monitoringService.checkHealth();

    // Check if all essential services are at least not unhealthy
    const essentialServices = ['database'];
    const essentialServicesHealth = health.services.filter((s) =>
      essentialServices.includes(s.service)
    );

    const hasStarted = essentialServicesHealth.every((s) => s.status !== 'unhealthy');

    const response: ApiResponse = {
      success: hasStarted,
      data: {
        started: hasStarted,
        essentialServices: essentialServicesHealth,
        uptime: health.metrics.uptime,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    const statusCode = hasStarted ? 200 : 503;
    res.status(statusCode).json(response);
  })
);

// Record custom metric endpoint
router.post(
  '/metrics',
  validateApiKey,
  validate(
    Joi.object({
      service: Joi.string().required(),
      metrics: Joi.object()
        .pattern(Joi.string(), Joi.alternatives(Joi.number(), Joi.string()))
        .required(),
      tags: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    })
  ),
  asyncHandler(async (_req, res) => {
    const { service, metrics, tags } = req.body;

    monitoringService.recordMetric(service, metrics, tags);

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Metric recorded successfully',
        service,
        timestamp: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(201).json(response);
  })
);

// System information endpoint
router.get(
  '/system',
  validateApiKey,
  cache({ ttl: 300 }),
  asyncHandler(async (_req, res) => {
    const os = require('os');
    const systemInfo = {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        percentage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
      },
      cpu: {
        model: os.cpus()[0]?.model,
        cores: os.cpus().length,
        loadAverage: os.loadavg(),
      },
      network: os.networkInterfaces(),
      uptime: {
        system: os.uptime(),
        process: process.uptime(),
      },
      environment: process.env['NODE_ENV'],
      version: process.env['APP_VERSION'] || '1.0.0',
    };

    const response: ApiResponse = {
      success: true,
      data: systemInfo,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

// Debug endpoint for development
if (process.env['NODE_ENV'] === 'development') {
  router.get(
    '/debug',
    asyncHandler(async (_req, res) => {
      const debugInfo = {
        environment: process.env['NODE_ENV'],
        version: process.env['APP_VERSION'] || '1.0.0',
        timestamp: new Date().toISOString(),
        headers: req.headers,
        query: req.query,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime(),
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
      };

      const response: ApiResponse = {
        success: true,
        data: debugInfo,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    })
  );
}

export default router;
