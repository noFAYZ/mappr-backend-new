// Common types and interfaces for the application
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    statusCode: number;
    timestamp: string;
    suggestions?: string[];
    stack?: string;
  };
  meta?: {
    pagination?: PaginationMeta;
    timestamp: string;
    requestId?: string;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterOptions {
  [key: string]: unknown;
}

export interface RequestContext {
  userId?: string;
  userRole?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface ServiceConfig {
  timeout: number;
  retries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface DatabaseConfig {
  url: string;
  poolSize: number;
  connectionTimeout: number;
  queryTimeout: number;
}

export interface CacheConfig {
  url?: string;
  ttl: number;
  prefix: string;
  maxMemory?: string;
}

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  defaultJobOptions: {
    removeOnComplete: number;
    removeOnFail: number;
    attempts: number;
    backoff: {
      type: string;
      delay: number;
    };
  };
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  responseTime?: number;
  details?: Record<string, unknown>;
}

export interface MetricsData {
  timestamp: Date;
  metrics: Record<string, number | string>;
  tags?: Record<string, string>;
}

// Error types
export interface ErrorDetails {
  code: string;
  message: string;
  statusCode: number;
  timestamp: Date;
  requestId?: string;
  userId?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

// Validation types
export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: unknown) => boolean | string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;
}

// Async operation types
export type AsyncResult<T, E = Error> = Promise<
  { success: true; data: T; error?: never } | { success: false; data?: never; error: E }
>;

// Generic repository interfaces
export interface Repository<T, K = string> {
  findById(id: K): Promise<T | null>;
  findMany(options?: FilterOptions & PaginationOptions): Promise<PaginatedResponse<T>>;
  create(data: Partial<T>): Promise<T>;
  update(id: K, data: Partial<T>): Promise<T>;
  delete(id: K): Promise<boolean>;
}

// Service interfaces
export interface BaseService {
  healthCheck(): Promise<HealthCheck>;
  getMetrics?(): Record<string, unknown>;
}

// External API response types
export interface ExternalApiResponse<T = unknown> {
  data?: T;
  error?: {
    message: string;
    code?: string;
    statusCode?: number;
  };
  meta?: {
    requestId?: string;
    rateLimit?: {
      remaining: number;
      reset: number;
    };
  };
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Environment types
export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface AppConfig {
  nodeEnv: Environment;
  port: number;
  apiVersion: string;
  database: DatabaseConfig;
  cache: CacheConfig;
  queue: QueueConfig;
  security: {
    jwtSecret: string;
    bcryptRounds: number;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };
  external: {
    zerionApiKey?: string;
    zapperApiKey?: string;
    plaidClientId?: string;
    plaidSecret?: string;
    stripeSecretKey?: string;
  };
}

// Request/Response enhancers
export interface RequestWithContext extends Request {
  context: RequestContext;
}

// Type guards
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as ApiResponse).success === 'boolean'
  );
}

export function isPaginatedResponse<T>(value: unknown): value is PaginatedResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'pagination' in value &&
    Array.isArray((value as PaginatedResponse<T>).data)
  );
}

// Constants
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_CACHE_TTL = 300; // 5 minutes
export const DEFAULT_REQUEST_TIMEOUT = 30000; // 30 seconds

// HTTP Status Codes
export enum HttpStatusCode {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}

// Error Codes
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  QUEUE_ERROR = 'QUEUE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
