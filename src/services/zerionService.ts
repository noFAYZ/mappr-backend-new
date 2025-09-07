import ZerionSDK, { ZerionConfig } from 'zerion-sdk-ts';
import { logger } from '@/utils/logger';
import { CryptoServiceError, CryptoErrorCodes } from '@/types/crypto';
import { BlockchainNetwork } from '@prisma/client';

// Enhanced metric interfaces
interface DetailedRequestMetrics {
  operationType: string;
  address?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  errorCode?: string;
  retryCount: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: Date | null;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

interface ZerionServiceConfig extends ZerionConfig {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  enableMetrics?: boolean;
}

interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  rateLimitHits: number;
  timeouts: number;
  circuitBreakerTrips: number;
  lastRequestTime: number;
  requestsPerMinute: number;
}

export class ZerionService {
  private sdk: ZerionSDK;
  private config: ZerionServiceConfig;
  private circuitBreaker: CircuitBreakerState;
  private metrics: RequestMetrics;
  private recentRequests: DetailedRequestMetrics[] = [];
  private readonly maxRecentRequests = 1000; // Keep last 1000 requests for analysis

  constructor(config: ZerionServiceConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      enableMetrics: true,
      ...config,
    };

    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      state: 'CLOSED',
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      rateLimitHits: 0,
      timeouts: 0,
      circuitBreakerTrips: 0,
      lastRequestTime: 0,
      requestsPerMinute: 0,
    };

    // Cleanup old requests every 5 minutes
    setInterval(() => this.cleanupOldRequests(), 5 * 60 * 1000);

    if (!config.apiKey) {
      const error = new CryptoServiceError(
        'Zerion API key is required',
        CryptoErrorCodes.ZERION_API_ERROR,
        500
      );
      logger.error('ZerionService initialization failed: missing API key', {
        error: error.message,
      });
      throw error;
    }

    try {
      this.sdk = new ZerionSDK({
        apiKey: config.apiKey,
      } as any);
      logger.info('Zerion SDK initialized successfully', {
        config: {
          timeout: this.config.timeout,
          retries: this.config.retries,
          circuitBreakerThreshold: this.config.circuitBreakerThreshold,
        },
      });
    } catch (error) {
      logger.error('Failed to initialize Zerion SDK', {
        error,
        apiKeyLength: config.apiKey?.length,
      });
      throw new CryptoServiceError(
        'Failed to initialize Zerion SDK',
        CryptoErrorCodes.ZERION_API_ERROR,
        500
      );
    }
  }

  // ===============================
  // WALLET PORTFOLIO
  // ===============================

  async getWalletPortfolio(address: string): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    const operationMetrics: DetailedRequestMetrics = {
      operationType: 'getWalletPortfolio',
      address: this.maskAddress(address),
      startTime,
      success: false,
      retryCount: 0,
    };

    try {
      logger.info('Starting wallet portfolio fetch', {
        requestId,
        address: this.maskAddress(address),
        circuitBreakerState: this.circuitBreaker.state,
        metrics: {
          recentSuccessRate: this.getRecentSuccessRate(),
          avgResponseTime: this.metrics.averageResponseTime,
        },
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();
      this.checkRateLimit();

      const response = await this.retryRequest(
        requestId,
        'getWalletPortfolio',
        async (attemptNumber: number) => {
          operationMetrics.retryCount = Math.max(operationMetrics.retryCount, attemptNumber - 1);

          // Try multiple SDK methods with fallbacks
          let result: any;
          const methods = [
            () =>
              (this.sdk as any).wallets?.getPortfolio?.(address, {
                positions: 'no_filter',
              }),
            () => (this.sdk as any).getWallet?.(address),
            () => (this.sdk as any).wallets?.get?.(address),
            () => (this.sdk as any).portfolio?.get?.(address),
          ];

          for (const method of methods) {
            try {
              result = await method();
              if (result && (result.data || result.attributes)) {
                logger.debug('SDK method succeeded', {
                  requestId,
                  methodIndex: methods.indexOf(method),
                  hasData: !!result.data,
                  hasAttributes: !!result.attributes,
                });
                break;
              }
            } catch (methodError) {
              logger.debug('SDK method failed, trying next', {
                requestId,
                methodIndex: methods.indexOf(method),
                error: methodError instanceof Error ? methodError.message : String(methodError),
              });
            }
          }

          if (!result) {
            throw new CryptoServiceError(
              'All Zerion SDK methods failed for portfolio fetch',
              CryptoErrorCodes.ZERION_API_ERROR,
              503
            );
          }

          // Validate response structure
          if (!result.data && !result.attributes) {
            logger.warn('Empty or invalid response from Zerion API', {
              requestId,
              address: this.maskAddress(address),
              responseKeys: result ? Object.keys(result).slice(0, 10) : 'null',
              responseSize: JSON.stringify(result || {}).length,
            });
          }

          return result;
        },
        address
      );

      const duration = Date.now() - startTime;
      operationMetrics.endTime = Date.now();
      operationMetrics.duration = duration;
      operationMetrics.success = true;

      logger.info('Successfully fetched wallet portfolio', {
        requestId,
        address: this.maskAddress(address),
        duration,
        retryCount: operationMetrics.retryCount,
        hasData: !!response?.data,
        dataKeys: response?.data ? Object.keys(response.data).slice(0, 5) : [],
        responseSize: JSON.stringify(response || {}).length,
        circuitBreakerState: this.circuitBreaker.state,
      });

      this.recordMetrics(operationMetrics);
      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      operationMetrics.endTime = Date.now();
      operationMetrics.duration = duration;
      operationMetrics.errorCode = (error as any)?.code || 'UNKNOWN';

      logger.error('Failed to fetch wallet portfolio', {
        requestId,
        address: this.maskAddress(address),
        duration,
        retryCount: operationMetrics.retryCount,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        statusCode: (error as any)?.response?.status,
        circuitBreakerState: this.circuitBreaker.state,
        stackTrace: error instanceof Error ? error.stack?.split('\n').slice(0, 3) : undefined,
      });

      this.recordMetrics(operationMetrics);
      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet portfolio');
    }
  }

  async getWalletSummary(address: string): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.debug('Fetching wallet summary', {
        requestId,
        address: this.maskAddress(address),
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getWalletSummary',
        async () => {
          return (await (this.sdk as any).getWalletSummary?.(address)) || { data: null };
        },
        address
      );

      const duration = Date.now() - startTime;
      logger.info('Successfully fetched wallet summary', {
        requestId,
        address: this.maskAddress(address),
        duration,
      });

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error fetching wallet summary', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet summary');
    }
  }

  // ===============================
  // WALLET POSITIONS
  // ===============================

  async getWalletPositions(address: string, options?: any): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.debug('Fetching wallet positions', {
        requestId,
        address: this.maskAddress(address),
        options: options ? Object.keys(options) : [],
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getWalletPositions',
        async () => {
          return (
            (await (this.sdk as any).wallets.getPositions?.(address, options)) || { data: null }
          );
        },
        address
      );

      const duration = Date.now() - startTime;

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error fetching wallet positions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet positions');
    }
  }

  async getAllWalletPositions(address: string, options?: any): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Starting all wallet positions fetch', {
        requestId,
        address: this.maskAddress(address),
        options: options ? Object.keys(options) : [],
        circuitBreakerState: this.circuitBreaker.state,
      });

      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getAllWalletPositions',
        async () => {
          const result = await (this.sdk as any).getAllPositions?.(address, options);

          logger.info('Zerion getAllPositions raw result:', result);

          if (result?.data) {
            logger.debug('Positions data structure', {
              requestId,
              dataType: typeof result.data,
              dataKeys: Array.isArray(result.data)
                ? 'array'
                : Object.keys(result.data || {}).slice(0, 5),
              itemCount: Array.isArray(result.data)
                ? result.data.length
                : typeof result.data === 'object'
                  ? Object.keys(result.data).length
                  : 0,
            });
          }

          return result;
        },
        address
      );

      const duration = Date.now() - startTime;
      const positionCount = this.extractPositionCount(response);

      logger.info('Successfully fetched all wallet positions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        positionCount,
        hasData: !!response?.data,
        responseSize: JSON.stringify(response || {}).length,
      });

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to fetch all wallet positions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        statusCode: (error as any)?.response?.status,
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch all wallet positions');
    }
  }

  // ===============================
  // WALLET TRANSACTIONS
  // ===============================

  async getWalletTransactions(address: string, options?: any): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.debug('Fetching wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        options: options ? Object.keys(options) : [],
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getWalletTransactions',
        async () => {
          return (await (this.sdk as any).getTransactions?.(address, options)) || { data: null };
        },
        address
      );

      const duration = Date.now() - startTime;
      const txCount = response?.data?.length || 0;

      logger.info('Successfully fetched wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        transactionCount: txCount,
        hasMore: !!response?.meta?.pagination?.has_next,
      });

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error fetching wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
        options,
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet transactions');
    }
  }

  async getAllWalletTransactions(address: string, options?: any): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.debug('Fetching all wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        options: options ? Object.keys(options) : [],
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getAllWalletTransactions',
        async () => {
          return (
            (await (this.sdk as any).wallets.getAllTransactions?.(address, options)) || {
              data: null,
            }
          );
        },
        address
      );

      const duration = Date.now() - startTime;
      const txCount = Array.isArray(response) ? response?.length : 0;

      logger.info('Successfully fetched all wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        totalTransactions: txCount,
      });

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error fetching all wallet transactions', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch all wallet transactions');
    }
  }

  // ===============================
  // ANALYTICS & PnL
  // ===============================

  async getWalletPnL(address: string, options?: any): Promise<any> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.debug('Fetching PnL for wallet', {
        requestId,
        address: this.maskAddress(address),
        options: options ? Object.keys(options) : [],
      });

      await this.validateRequest(address, 'address');
      this.checkCircuitBreaker();

      const response = await this.retryRequest(
        requestId,
        'getWalletPnL',
        async () => {
          return (await (this.sdk as any).getPnL?.(address, options)) || { data: null };
        },
        address
      );

      const duration = Date.now() - startTime;
      logger.info('Successfully fetched PnL for wallet', {
        requestId,
        address: this.maskAddress(address),
        duration,
      });

      this.recordSuccess(requestId, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error fetching PnL for wallet', {
        requestId,
        address: this.maskAddress(address),
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordFailure(requestId, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet PnL');
    }
  }

  async getWalletChart(address: string, period: any, options?: any): Promise<any> {
    try {
      logger.debug(`Fetching chart data for wallet: ${address}`, { period, options });

      const requestId = this.generateRequestId();
      const response = await this.retryRequest(
        requestId,
        'getWalletChart',
        async () => {
          return (await (this.sdk as any).getChart?.(address, period, options)) || { data: null };
        },
        address
      );

      logger.info(`Successfully fetched chart data for wallet: ${address}`);
      return response;
    } catch (error) {
      logger.error(`Error fetching chart data for wallet ${address}:`, error);
      throw this.handleZerionError(error, 'Failed to fetch wallet chart data');
    }
  }

  async getPortfolioAnalysis(address: string): Promise<any> {
    try {
      logger.debug(`Fetching portfolio analysis for wallet: ${address}`);

      const requestId = this.generateRequestId();
      const response = await this.retryRequest(
        requestId,
        'getPortfolioAnalysis',
        async () => {
          return (await (this.sdk as any).getPortfolioAnalysis?.(address)) || { data: null };
        },
        address
      );

      logger.info(`Successfully fetched portfolio analysis for wallet: ${address}`);
      return response;
    } catch (error) {
      logger.error(`Error fetching portfolio analysis for wallet ${address}:`, error);
      throw this.handleZerionError(error, 'Failed to fetch portfolio analysis');
    }
  }

  // ===============================
  // WALLET MONITORING
  // ===============================

  async *monitorWalletActivity(
    address: string,
    intervalMs: number = 30000
  ): AsyncGenerator<any, void, unknown> {
    try {
      logger.info(`Starting wallet monitoring for: ${address}`, { intervalMs });

      const monitor = (this.sdk as any).monitorWalletActivity?.(address, intervalMs) || [];

      for await (const update of monitor) {
        logger.debug(`Wallet activity update for ${address}:`, update);
        yield update;
      }
    } catch (error) {
      logger.error(`Error monitoring wallet activity for ${address}:`, error);
      throw this.handleZerionError(error, 'Failed to monitor wallet activity');
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  private async retryRequest<T>(
    requestId: string,
    operation: string,
    request: (attemptNumber: number) => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: any;
    let totalDelay = 0;
    const maxRetries = this.config.retries || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const attemptStartTime = Date.now();

      try {
        logger.debug('Executing API request attempt', {
          requestId,
          operation,
          attempt,
          maxAttempts: maxRetries,
          context: context ? this.maskAddress(context) : undefined,
          totalDelayMs: totalDelay,
          circuitBreakerState: this.circuitBreaker.state,
          previousAttemptErrors: attempt > 1 ? lastError?.message || 'Unknown' : 'N/A',
        });

        // Add jitter to prevent thundering herd
        if (attempt > 1) {
          const jitter = Math.random() * 100; // 0-100ms jitter
          await this.sleep(jitter);
        }

        const result = await Promise.race([
          request(attempt),
          this.createTimeoutPromise<T>(operation, requestId),
        ]);

        const attemptDuration = Date.now() - attemptStartTime;

        if (attempt > 1) {
          logger.info('API request succeeded after retry', {
            requestId,
            operation,
            attempt,
            attemptDuration,
            totalDelay,
            previousErrors: attempt - 1,
          });
        } else {
          logger.debug('API request succeeded on first attempt', {
            requestId,
            operation,
            attemptDuration,
          });
        }

        return result;
      } catch (error: any) {
        lastError = error;
        const attemptDuration = Date.now() - attemptStartTime;
        const isTimeout = error.message?.includes('timeout');

        if (isTimeout) {
          this.metrics.timeouts++;
        }

        logger.warn('API request attempt failed', {
          requestId,
          operation,
          attempt,
          attemptDuration,
          error: error.message,
          errorCode: error.code,
          statusCode: error.response?.status,
          isTimeout,
          shouldRetry: !this.shouldNotRetry(error),
          remainingAttempts: maxRetries - attempt,
        });

        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          logger.info('Request will not be retried due to error type', {
            requestId,
            operation,
            errorCode: error.code,
            statusCode: error.response?.status,
            errorType: error.constructor?.name,
          });
          break;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          totalDelay += delay;

          logger.info('Scheduling retry attempt', {
            requestId,
            operation,
            nextAttempt: attempt + 1,
            delayMs: delay,
            totalDelayMs: totalDelay,
            errorType: error.constructor?.name,
            backoffStrategy: 'exponential_with_jitter',
          });

          await this.sleep(delay);
        }
      }
    }

    logger.error('All retry attempts exhausted', {
      requestId,
      operation,
      totalAttempts: maxRetries,
      totalDelay,
      finalError: {
        message: lastError.message,
        code: lastError.code,
        statusCode: lastError.response?.status,
        type: lastError.constructor?.name,
      },
      circuitBreakerWillOpen:
        this.circuitBreaker.failures >= (this.config.circuitBreakerThreshold || 5) - 1,
    });

    throw lastError;
  }

  private createTimeoutPromise<T>(operation: string, requestId: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error(
          `Zerion API ${operation} request timeout after ${this.config.timeout}ms (requestId: ${requestId})`
        );
        (timeoutError as any).code = 'TIMEOUT';
        (timeoutError as any).isTimeout = true;
        reject(timeoutError);
      }, this.config.timeout);
    });
  }

  private shouldNotRetry(error: any): boolean {
    // Don't retry on authentication errors or client errors (4xx except rate limiting)
    const statusCode = error.response?.status;
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return true;
    }

    // Don't retry on specific error codes
    const nonRetryableErrors = [
      'INVALID_ADDRESS',
      'WALLET_NOT_FOUND',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'BAD_REQUEST',
      'INVALID_API_KEY',
    ];

    if (nonRetryableErrors.includes(error.code)) {
      return true;
    }

    // Don't retry if circuit breaker should open
    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold! - 1) {
      logger.warn('Circuit breaker threshold reached, will not retry', {
        currentFailures: this.circuitBreaker.failures,
        threshold: this.config.circuitBreakerThreshold,
      });
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleZerionError(error: any, defaultMessage: string): CryptoServiceError {
    if (error instanceof CryptoServiceError) {
      return error;
    }

    let message = defaultMessage;
    let code = CryptoErrorCodes.ZERION_API_ERROR;
    let statusCode = 500;

    // Handle specific error types
    if (error.response) {
      statusCode = error.response.status;
      message = error.response.data?.message || error.message || defaultMessage;

      if (statusCode === 401 || statusCode === 403) {
        code = CryptoErrorCodes.INSUFFICIENT_PERMISSIONS;
      } else if (statusCode === 429) {
        code = CryptoErrorCodes.RATE_LIMIT_EXCEEDED;
      } else if (statusCode === 404) {
        code = CryptoErrorCodes.WALLET_NOT_FOUND;
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      message = 'Unable to connect to Zerion API';
      statusCode = 503;
    } else if (error.message?.includes('timeout')) {
      message = 'Zerion API request timeout';
      statusCode = 504;
    }

    return new CryptoServiceError(message, code, statusCode);
  }

  // Network mapping utilities
  static mapNetworkToZerion(network: BlockchainNetwork): string {
    const networkMap: Partial<Record<BlockchainNetwork, string>> = {
      [BlockchainNetwork.ETHEREUM]: 'ethereum',
      [BlockchainNetwork.POLYGON]: 'polygon',
      [BlockchainNetwork.BSC]: 'binance-smart-chain',
      [BlockchainNetwork.ARBITRUM]: 'arbitrum',
      [BlockchainNetwork.OPTIMISM]: 'optimism',
      [BlockchainNetwork.AVALANCHE]: 'avalanche',
      [BlockchainNetwork.BASE]: 'base',
      [BlockchainNetwork.SOLANA]: 'solana',
      [BlockchainNetwork.BITCOIN]: 'bitcoin',
    };

    return networkMap[network] || network.toLowerCase();
  }

  static mapZerionToNetwork(zerionNetwork: string): BlockchainNetwork {
    const networkMap: Record<string, BlockchainNetwork> = {
      ethereum: BlockchainNetwork.ETHEREUM,
      polygon: BlockchainNetwork.POLYGON,
      'binance-smart-chain': BlockchainNetwork.BSC,
      arbitrum: BlockchainNetwork.ARBITRUM,
      optimism: BlockchainNetwork.OPTIMISM,
      avalanche: BlockchainNetwork.AVALANCHE,
      base: BlockchainNetwork.BASE,
      solana: BlockchainNetwork.SOLANA,
      bitcoin: BlockchainNetwork.BITCOIN,
    };

    return networkMap[zerionNetwork] || BlockchainNetwork.ETHEREUM;
  }

  // Circuit Breaker Methods
  private checkCircuitBreaker(): void {
    if (this.circuitBreaker.state === 'OPEN') {
      const now = Date.now();
      const timeSinceLastFailure = this.circuitBreaker.lastFailureTime
        ? now - this.circuitBreaker.lastFailureTime.getTime()
        : 0;

      if (timeSinceLastFailure >= this.config.circuitBreakerTimeout!) {
        this.circuitBreaker.state = 'HALF_OPEN';
        logger.info('Circuit breaker moving to HALF_OPEN state', {
          timeSinceLastFailure,
          timeout: this.config.circuitBreakerTimeout,
        });
      } else {
        const error = new CryptoServiceError(
          `Circuit breaker is OPEN. Service will be available in ${Math.ceil((this.config.circuitBreakerTimeout! - timeSinceLastFailure) / 1000)} seconds`,
          CryptoErrorCodes.ZERION_API_ERROR,
          503
        );

        logger.warn('Circuit breaker is OPEN, rejecting request', {
          failures: this.circuitBreaker.failures,
          timeSinceLastFailure,
          remainingTime: this.config.circuitBreakerTimeout! - timeSinceLastFailure,
        });

        throw error;
      }
    }
  }

  private recordSuccess(requestId: string, duration: number): void {
    if (this.config.enableMetrics) {
      this.metrics.totalRequests++;
      this.metrics.successfulRequests++;
      this.metrics.lastRequestTime = Date.now();
      this.updateAverageResponseTime(duration);
      this.updateRequestsPerMinute();
    }

    // Reset circuit breaker on success
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.lastFailureTime = null;
      logger.info('Circuit breaker moved to CLOSED state after successful request', {
        requestId,
        duration,
        previousFailures: this.circuitBreaker.failures,
      });
    } else if (this.circuitBreaker.state === 'CLOSED') {
      // Reset failure count on successful requests
      this.circuitBreaker.failures = Math.max(0, this.circuitBreaker.failures - 1);
    }
  }

  private recordFailure(requestId: string, error?: any): void {
    if (this.config.enableMetrics) {
      this.metrics.totalRequests++;
      this.metrics.failedRequests++;
      this.metrics.lastRequestTime = Date.now();
      this.updateRequestsPerMinute();

      // Track specific error types
      if (error?.response?.status === 429) {
        this.metrics.rateLimitHits++;
      }
    }

    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = new Date();

    const threshold = this.config.circuitBreakerThreshold || 5;
    if (this.circuitBreaker.failures >= threshold) {
      this.circuitBreaker.state = 'OPEN';
      this.metrics.circuitBreakerTrips++;

      logger.error('Circuit breaker opened due to consecutive failures', {
        requestId,
        failures: this.circuitBreaker.failures,
        threshold,
        errorCode: error?.code,
        statusCode: error?.response?.status,
        lastFailureTime: this.circuitBreaker.lastFailureTime.toISOString(),
        lockoutDuration: this.config.circuitBreakerTimeout,
      });
    } else {
      logger.warn('Failure recorded, circuit breaker still closed', {
        requestId,
        failures: this.circuitBreaker.failures,
        threshold,
        remainingFailuresBeforeOpen: threshold - this.circuitBreaker.failures,
      });
    }
  }

  // Utility Methods
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private maskAddress(address: string): string {
    if (!address || address.length < 8) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.config.retryDelay || 1000;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter to prevent thundering herd
    const finalDelay = Math.min(exponentialDelay + jitter, 60000); // Max 60 seconds

    logger.debug('Calculated backoff delay', {
      attempt,
      baseDelay,
      exponentialDelay,
      jitter: Math.round(jitter),
      finalDelay: Math.round(finalDelay),
    });

    return finalDelay;
  }

  private updateAverageResponseTime(duration: number): void {
    const totalRequests = this.metrics.totalRequests;
    if (totalRequests === 1) {
      this.metrics.averageResponseTime = duration;
    } else {
      // Use exponential moving average for more recent data weight
      const alpha = 0.1; // Weight for new data
      this.metrics.averageResponseTime =
        alpha * duration + (1 - alpha) * this.metrics.averageResponseTime;
    }
  }

  private extractPositionCount(response: any): number {
    if (!response?.data) return 0;

    if (Array.isArray(response.data)) {
      return response.data.length;
    }

    if (typeof response.data === 'object') {
      let totalCount = 0;
      for (const [, data] of Object.entries(response.data)) {
        if (data && typeof data === 'object' && (data as any).positions) {
          totalCount += (data as any).positions.length || 0;
        }
      }
      return totalCount;
    }

    return 0;
  }

  // Health check and metrics
  async healthCheck(): Promise<{
    healthy: boolean;
    metrics?: RequestMetrics | undefined;
    circuitBreaker?: CircuitBreakerState | undefined;
  }> {
    try {
      logger.info('Performing Zerion API health check', {
        circuitBreakerState: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
      });

      // If circuit breaker is open, service is unhealthy
      if (this.circuitBreaker.state === 'OPEN') {
        return {
          healthy: false,
          metrics: this.config.enableMetrics ? { ...this.metrics } : undefined,
          circuitBreaker: { ...this.circuitBreaker },
        };
      }

      // Try a simple check - this would be replaced with an actual health endpoint
      // For now, just return healthy if we can create the SDK instance
      const isHealthy = !!this.sdk;

      return {
        healthy: isHealthy,
        metrics: this.config.enableMetrics ? { ...this.metrics } : undefined,
        circuitBreaker: { ...this.circuitBreaker },
      };
    } catch (error) {
      logger.error('Zerion API health check failed', { error });
      return {
        healthy: false,
        metrics: this.config.enableMetrics ? { ...this.metrics } : undefined,
        circuitBreaker: { ...this.circuitBreaker },
      };
    }
  }

  getMetrics(): RequestMetrics | null {
    return this.config.enableMetrics ? { ...this.metrics } : null;
  }

  resetCircuitBreaker(): void {
    const previousState = { ...this.circuitBreaker };
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      state: 'CLOSED',
    };
    logger.info('Circuit breaker manually reset', {
      previousState: {
        state: previousState.state,
        failures: previousState.failures,
        lastFailureTime: previousState.lastFailureTime?.toISOString(),
      },
      newState: this.circuitBreaker.state,
    });
  }

  // New utility methods
  private validateRequest(value: any, type: 'address' | 'network'): Promise<void> {
    return new Promise((resolve, reject) => {
      if (type === 'address') {
        if (!value || typeof value !== 'string') {
          reject(
            new CryptoServiceError(
              'Invalid wallet address provided',
              CryptoErrorCodes.INVALID_ADDRESS,
              400
            )
          );
          return;
        }

        // Basic address validation (adjust based on requirements)
        if (value.length < 10 || value.length > 100) {
          reject(
            new CryptoServiceError(
              'Wallet address has invalid length',
              CryptoErrorCodes.INVALID_ADDRESS,
              400
            )
          );
          return;
        }
      }

      resolve();
    });
  }

  private checkRateLimit(): void {
    // Simple rate limiting - 60 requests per minute
    if (this.metrics.requestsPerMinute > 60) {
      logger.warn('Rate limit threshold approached', {
        requestsPerMinute: this.metrics.requestsPerMinute,
        threshold: 60,
      });

      // Add small delay to prevent hitting limits
      return new Promise((resolve) => setTimeout(resolve, 1000)) as any;
    }
  }

  private updateRequestsPerMinute(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Count requests in the last minute from recent requests
    const recentRequestsInLastMinute = this.recentRequests.filter(
      (req) => req.startTime > oneMinuteAgo
    ).length;

    this.metrics.requestsPerMinute = recentRequestsInLastMinute;
  }

  private recordMetrics(metrics: DetailedRequestMetrics): void {
    this.recentRequests.push(metrics);

    // Keep only recent requests
    if (this.recentRequests.length > this.maxRecentRequests) {
      this.recentRequests = this.recentRequests.slice(-this.maxRecentRequests);
    }
  }

  private cleanupOldRequests(): void {
    const oneHourAgo = Date.now() - 3600000; // 1 hour
    const initialCount = this.recentRequests.length;

    this.recentRequests = this.recentRequests.filter((req) => req.startTime > oneHourAgo);

    const removed = initialCount - this.recentRequests.length;
    if (removed > 0) {
      logger.debug('Cleaned up old request metrics', {
        removed,
        remaining: this.recentRequests.length,
      });
    }
  }

  private getRecentSuccessRate(): number {
    if (this.recentRequests.length === 0) return 1;

    const recent = this.recentRequests.slice(-50); // Last 50 requests
    const successful = recent.filter((req) => req.success).length;

    return successful / recent.length;
  }

  getDetailedMetrics(): {
    basic: RequestMetrics;
    recent: {
      successRate: number;
      avgDuration: number;
      errorDistribution: Record<string, number>;
      operationDistribution: Record<string, number>;
    };
    circuitBreaker: CircuitBreakerState;
  } {
    const recent = this.recentRequests.slice(-100); // Last 100 requests
    const successRate =
      recent.length > 0 ? recent.filter((req) => req.success).length / recent.length : 1;

    const avgDuration =
      recent.length > 0
        ? recent.reduce((sum, req) => sum + (req.duration || 0), 0) / recent.length
        : 0;

    const errorDistribution: Record<string, number> = {};
    const operationDistribution: Record<string, number> = {};

    recent.forEach((req) => {
      if (req.errorCode) {
        errorDistribution[req.errorCode] = (errorDistribution[req.errorCode] || 0) + 1;
      }
      operationDistribution[req.operationType] =
        (operationDistribution[req.operationType] || 0) + 1;
    });

    return {
      basic: { ...this.metrics },
      recent: {
        successRate,
        avgDuration,
        errorDistribution,
        operationDistribution,
      },
      circuitBreaker: { ...this.circuitBreaker },
    };
  }
}

// Singleton instance
let zerionService: ZerionService | null = null;

export function createZerionService(config: ZerionConfig): ZerionService {
  if (!zerionService) {
    zerionService = new ZerionService(config);
  }
  return zerionService;
}

export function getZerionService(): ZerionService | null {
  return zerionService;
}
