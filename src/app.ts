import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { errorHandler } from '@/middleware/errorHandler';
import { notFoundHandler } from '@/middleware/notFoundHandler';
import { swaggerSpec } from '@/config/swagger';
import authRoutes from '@/routes/auth';
import apiRoutes from '@/routes/api';
// import userRoutes from '@/routes/user'; // Commented out - replaced by better-auth API routes
import subscriptionRoutes from '@/routes/subscription';
import paymentRoutes from '@/routes/payment';
import usageRoutes from '@/routes/usage';

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env['NODE_ENV'] === 'production' ? config.cors.origin : true,
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Compression middleware
app.use(compression() as any);

// Logging middleware
app.use(
  morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }) as any
);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: config.apiVersion,
  });
});

// API documentation endpoint
app.get('/api', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Mappr Financial API',
    version: config.apiVersion,
    documentation: {
      health: '/health',
      auth: {
        register: 'POST /api/v1/auth/register',
        login: 'POST /api/v1/auth/login',
        logout: 'POST /api/v1/auth/logout',
        refresh: 'POST /api/v1/auth/refresh',
        me: 'GET /api/v1/auth/me',
        forgotPassword: 'POST /api/v1/auth/forgot-password',
        resetPassword: 'POST /api/v1/auth/reset-password',
        changePassword: 'POST /api/v1/auth/change-password',
        verifyEmail: 'POST /api/v1/auth/verify-email',
        resendVerification: 'POST /api/v1/auth/resend-verification',
      },
      users: {
        profile: 'PUT /api/v1/users/profile',
        stats: 'GET /api/v1/users/stats',
        deleteAccount: 'DELETE /api/v1/users/account',
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (_req, res) => {
  const endpoints: any = {
    health: '/health',
    documentation: '/api',
    auth: `/api/${config.apiVersion}/auth`,
    users: `/api/${config.apiVersion}/users`,
    subscriptions: `/api/${config.apiVersion}/subscriptions`,
    payments: `/api/${config.apiVersion}/payments`,
    usage: `/api/${config.apiVersion}/usage`,
  };

  // Add docs link if Swagger is enabled
  if (config.nodeEnv === 'development' || process.env['SWAGGER_UI_ENABLED'] === 'true') {
    endpoints.swagger = '/docs';
    endpoints.openapi = '/docs.json';
  }

  res.status(200).json({
    success: true,
    message: 'Welcome to Mappr Financial API',
    version: config.apiVersion,
    status: 'Server is running',
    endpoints,
    timestamp: new Date().toISOString(),
  });
});

// Swagger UI setup
if (config.nodeEnv === 'development' || process.env['SWAGGER_UI_ENABLED'] === 'true') {
  const swaggerOptions = {
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info .title { color: #1f2937; }
      .swagger-ui .scheme-container { background: #f8fafc; padding: 20px; border-radius: 8px; }
    `,
    customSiteTitle: 'Mappr Financial API Documentation',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showRequestHeaders: true,
    },
  };

  app.use('/docs', swaggerUi.serve as any);
  app.get('/docs', swaggerUi.setup(swaggerSpec, swaggerOptions) as any);

  // JSON endpoint for the OpenAPI spec
  app.get('/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// Better Auth routes - handles authentication
app.use('/', authRoutes);

// API routes with authentication
app.use(`/api/${config.apiVersion}`, apiRoutes);
// app.use(`/api/${config.apiVersion}/users`, userRoutes); // Commented out - replaced by better-auth API routes
app.use(`/api/${config.apiVersion}/subscriptions`, subscriptionRoutes);
app.use(`/api/${config.apiVersion}/payments`, paymentRoutes);
app.use(`/api/${config.apiVersion}/usage`, usageRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
