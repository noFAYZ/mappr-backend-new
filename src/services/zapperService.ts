import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { logger } from '@/utils/logger';
import { BlockchainNetwork } from '@prisma/client';

// Zapper-specific types
export interface ZapperPortfolioToken {
  tokenAddress: string;
  symbol: string;
  balance: number;
  balanceUSD: number;
  imgUrlV2?: string | null;
  network: {
    name: string;
  };
}

export interface ZapperPortfolioResponse {
  portfolioV2: {
    tokenBalances: {
      totalBalanceUSD: number;
      byToken: {
        edges: Array<{
          node: {
            tokenAddress: string;
            symbol: string;
            balance: string;
            balanceUSD: number;
            imgUrlV2?: string;
            network: {
              name: string;
            };
            price: number;
            name: string;
          };
        }>;
      };
    };
    appBalances: {
      totalBalanceUSD: number;
      byApp: {
        edges: Array<{
          node: {
            appId: string;
            balanceUSD: number;
            network: {
              name: string;
            };
            positionCount: number;
            app: {
              imgUrl?: string;
              displayName: string;
            };
          };
        }>;
      };
    };
    nftBalances: {
      totalBalanceUSD: number;
      totalTokensOwned: number;
      byCollection: {
        edges: Array<{
          node: {
            collection: {
              address: string;
              displayName: string;
              floorPrice?: {
                valueUsd: number;
              };
              name: string;
              spamScore?: number;
              symbol?: string;
              nfts: {
                edges: Array<{
                  node: {
                    id: string;
                    estimatedValue?: {
                      valueUsd: number;
                    };
                    name?: string;
                    collection: {
                      name: string;
                    };
                    mediasV3?: {
                      images: {
                        edges: Array<{
                          node: {
                            url: string;
                          };
                        }>;
                      };
                    };
                  };
                }>;
              };
            };
          };
        }>;
      };
    };
  };
}

export interface ZapperTransactionNode {
  transaction: {
    hash: string;
    timestamp: string;
    network: string;
  };
  interpretation: {
    processedDescription: string;
  };
}

export interface ZapperTransactionResponse {
  transactionHistoryV2: {
    edges: Array<{
      node: ZapperTransactionNode;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

export interface ZapperCombinedPortfolioResponse {
  assets: ZapperPortfolioResponse;
  nfts: ZapperPortfolioResponse;
  transactions: ZapperTransactionResponse;
}

export interface ZapperServiceConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  rateLimit?: {
    requestsPerSecond: number;
    maxConcurrent: number;
  };
}

export interface ZapperHealthCheck {
  healthy: boolean;
  message: string;
  timestamp: Date;
}

export class ZapperService {
  private client: AxiosInstance;
  private apiKey: string;
  private rateLimitQueue: Array<() => void> = [];
  private currentRequests = 0;
  private maxConcurrent = 5;
  private requestsPerSecond = 10;

  constructor(config: ZapperServiceConfig) {
    this.apiKey = config.apiKey;
    this.maxConcurrent = config.rateLimit?.maxConcurrent || 5;
    this.requestsPerSecond = config.rateLimit?.requestsPerSecond || 10;

    this.client = axios.create({
      baseURL: config.baseUrl || 'https://public.zapper.xyz',
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'x-zapper-api-key': this.apiKey,
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Zapper API request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Zapper API request error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Zapper API response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`Zapper API error: ${error.response.status} ${error.response.statusText}`, {
            url: error.config?.url,
            requestData: error.config?.data,
            responseData: error.response.data,
            headers: error.response.headers,
          });
        } else {
          logger.error('Zapper API network error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  private async makeGraphQLRequest<T>(query: string, variables: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.currentRequests >= this.maxConcurrent) {
        this.rateLimitQueue.push(async () => {
          try {
            const result = await this.executeGraphQLRequest<T>(query, variables);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
        return;
      }

      this.executeGraphQLRequest<T>(query, variables).then(resolve).catch(reject);
    });
  }

  private async executeGraphQLRequest<T>(query: string, variables: any): Promise<T> {
    this.currentRequests++;

    try {
      const response: AxiosResponse<{ data: T; errors?: any[] }> = await this.client.post(
        '/graphql',
        {
          query,
          variables,
        }
      );

      if (response.data.errors) {
        throw new Error(`Zapper GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } finally {
      this.currentRequests--;

      // Process next queued request with rate limiting
      if (this.rateLimitQueue.length > 0) {
        setTimeout(() => {
          const nextRequest = this.rateLimitQueue.shift();
          if (nextRequest) {
            nextRequest();
          }
        }, 1000 / this.requestsPerSecond);
      }
    }
  }

  async getWalletPortfolio(
    addresses: string[],
    chainIds?: number[]
  ): Promise<ZapperCombinedPortfolioResponse> {
    try {
      logger.info(`Fetching combined Zapper portfolio for ${addresses.length} addresses`, {
        addresses: addresses.slice(0, 3), // Log first 3 for privacy
        chainIds,
      });

      // Execute all three requests in parallel for efficiency
      const [assets, nfts, transactions] = await Promise.all([
        this.getWalletAssets(addresses, chainIds),
        this.getWalletNFTs(addresses, chainIds),
        this.getWalletTransactions(addresses, 20) // Default to 20 recent transactions
      ]);

      return {
        assets,
        nfts,
        transactions
      };
    } catch (error) {
      logger.error('Error fetching combined Zapper portfolio:', error);
      throw new Error(
        `Failed to fetch combined Zapper portfolio: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getWalletAssets(
    addresses: string[],
    chainIds?: number[]
  ): Promise<ZapperPortfolioResponse> {
    const query = `
     query PortfolioV2Query($addresses: [Address!]!) {
        portfolioV2(addresses: $addresses) {
           tokenBalances {
            totalBalanceUSD
            byToken(first: 50) {
              edges {
                node {
                  tokenAddress
                  symbol
                  balance
                  balanceUSD
                  imgUrlV2
                  price
                  name
                  network {
                    name
                  }
                  
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      addresses,
    };

    try {
      logger.info(`Fetching Zapper Assets for ${addresses.length} addresses`, {
        addresses: addresses.slice(0, 3), // Log first 3 for privacy
        chainIds,
      });

      return await this.makeGraphQLRequest<ZapperPortfolioResponse>(query, variables);
    } catch (error) {
      logger.error('Error fetching Zapper Assets:', error);
      throw new Error(
        `Failed to fetch Zapper Assets: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  async getWalletNFTs(addresses: string[], chainIds?: number[]): Promise<ZapperPortfolioResponse> {
    const query = `
    query PortfolioV2Query($addresses: [Address!]!) {
        portfolioV2(addresses: $addresses) {
           nftBalances {
            totalBalanceUSD
            totalTokensOwned
            byToken {
              edges {
                node {
                  token {
                    tokenId
                    name
                    description
                    supply
                    circulatingSupply
                    estimatedValue {
                      valueUsd
                      valueWithDenomination
                      denomination {
                        address
                        symbol
                        network
                      }
                    }
                    collection {
                      address
                      name
                      type
                      owner
                      medias {
                        logo {
                          mimeType
                          medium
                        }
                      }
                        spamScore
                      floorPrice {
                        valueUsd
                      }
                      networkV2 {
                        name
                      }
                    }
                    mediasV3 {
                      images {
                        edges {
                          node {
                            mimeType
                            thumbnail
                            medium
                            predominantColor
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      addresses,
    };

    try {
      logger.info(`Fetching Zapper NFTs for ${addresses.length} addresses`, {
        addresses: addresses.slice(0, 3), // Log first 3 for privacy
        chainIds,
      });

      return await this.makeGraphQLRequest<ZapperPortfolioResponse>(query, variables);
    } catch (error) {
      logger.error('Error fetching Zapper NFTs:', error);
      throw new Error(
        `Failed to fetch Zapper NFTs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  async getWalletTransactions(
    addresses: string[],
    first = 20,
    after?: string
  ): Promise<ZapperTransactionResponse> {
    const query = `
      query GetTransactionHistory($subjects: [Address!]!, $first: Int!, $after: String) {
        transactionHistoryV2(
          subjects: $subjects
          perspective: All
          first: $first
          after: $after
          filters: {
            orderByDirection: DESC
          }
        ) {
    totalCount
    pageInfo {
      startCursor
      endCursor
      hasNextPage
      hasPreviousPage
    }
    edges {
      cursor
      node {
        ... on TimelineEventV2 {
          methodSignature
          methodSighash
          transaction {
            blockNumber
            hash
            network
            timestamp
            fromUser {
              address
              displayName { value source }
              farcasterProfile { fid username }
            }
            toUser {
              address
              displayName { value source }
            }
          }
          interpretation {
            processedDescription
            description
            descriptionDisplayItems {
              ... on TokenDisplayItem {
                type
                tokenAddress
                amountRaw
                network
                tokenV2 {
                  decimals
                  symbol
                  name
                  imageUrlV2
                  priceData {
                    price
                    priceChange24h
                  }
                }
              }
              ... on ActorDisplayItem {
                type
                address
                account {
                  displayName { value source }
                }
              }
            }
          }
          deltas {
            totalCount
            edges {
              node {
                account { address isContract }
                tokenDeltasV2 {
                  edges {
                    node {
                      amount
                      amountRaw
                      token {
                        address
                        credibility
                        decimals
                        symbol
                        imageUrlV2
                        priceData { price priceChange24h }
                      }
                    }
                  }
                }
                nftDeltasV2 {
                  edges {
                    node {
                      collectionAddress
                      tokenId
                      quantity
                      tokenUri
                    }
                  }
                }
              }
            }
          }
        }
        ... on ActivityTimelineEventDelta {
          transactionHash
          transactionBlockTimestamp
          network
          subject
          from { address isContract }
          to { address isContract }
          fungibleDeltas {
            amount
            amountRaw
            token {
              address
              credibility
              decimals
              symbol
              imageUrlV2
              priceData { price priceChange24h }
            }
          }
          # You can also request other side details (e.g. NFT deltas) if needed
        }
      }
    }
  }
      }
    `;

    const variables = {
      subjects: addresses,
      first,
      ...(after && { after }),
    };

    try {
      logger.info(`Fetching Zapper transactions for ${addresses.length} addresses`, {
        addresses: addresses.slice(0, 3),
        first,
        after,
      });

      return await this.makeGraphQLRequest<ZapperTransactionResponse>(query, variables);
    } catch (error) {
      logger.error('Error fetching Zapper transactions:', error);
      throw new Error(
        `Failed to fetch Zapper transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getFarcasterPortfolio(
    fids?: number[],
    usernames?: string[]
  ): Promise<{ addresses: string[]; portfolio?: ZapperCombinedPortfolioResponse }> {
    if (!fids && !usernames) {
      throw new Error('Must provide either FIDs or usernames');
    }

    // First, resolve Farcaster identifiers to addresses
    const accountQuery = `
      query GetFarcasterAddresses($fids: [Float!], $farcasterUsernames: [String!]) {
        accounts(fids: $fids, farcasterUsernames: $farcasterUsernames) {
          farcasterProfile {
            username
            fid
            connectedAddresses
            custodyAddress
          }
        }
      }
    `;

    const accountVariables = {
      ...(fids && { fids }),
      ...(usernames && { farcasterUsernames: usernames }),
    };

    try {
      logger.info('Resolving Farcaster addresses', { fids, usernames });

      const accountResponse = await this.makeGraphQLRequest<{
        accounts: Array<{
          farcasterProfile: {
            username: string;
            fid: number;
            connectedAddresses: string[];
            custodyAddress: string;
          };
        }>;
      }>(accountQuery, accountVariables);

      // Extract all addresses
      const allAddresses = new Set<string>();
      accountResponse.accounts.forEach((account) => {
        const profile = account.farcasterProfile;
        if (profile.custodyAddress) {
          allAddresses.add(profile.custodyAddress);
        }
        profile.connectedAddresses?.forEach((addr) => allAddresses.add(addr));
      });

      const addresses = Array.from(allAddresses);

      if (addresses.length === 0) {
        return { addresses: [] };
      }

      // Get portfolio for resolved addresses
      const portfolio = await this.getWalletPortfolio(addresses);

      return { addresses, portfolio };
    } catch (error) {
      logger.error('Error fetching Farcaster portfolio:', error);
      throw new Error(
        `Failed to fetch Farcaster portfolio: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Helper method to convert network names to our internal enum
  mapNetworkName(zapperNetworkName: string): BlockchainNetwork {
    const networkMap: Record<string, BlockchainNetwork> = {
      ethereum: BlockchainNetwork.ETHEREUM,
      polygon: BlockchainNetwork.POLYGON,
      'binance-smart-chain': BlockchainNetwork.BSC,
      arbitrum: BlockchainNetwork.ARBITRUM,
      optimism: BlockchainNetwork.OPTIMISM,
      avalanche: BlockchainNetwork.AVALANCHE,
      base: BlockchainNetwork.BASE,
      // Add more mappings as needed
    };

    return networkMap[zapperNetworkName.toLowerCase()] || BlockchainNetwork.ETHEREUM;
  }

  // Convert Zapper chain IDs to our network enum
  mapChainIdToNetwork(chainId: number): BlockchainNetwork {
    const chainIdMap: Record<number, BlockchainNetwork> = {
      1: BlockchainNetwork.ETHEREUM,
      137: BlockchainNetwork.POLYGON,
      56: BlockchainNetwork.BSC,
      42161: BlockchainNetwork.ARBITRUM,
      10: BlockchainNetwork.OPTIMISM,
      43114: BlockchainNetwork.AVALANCHE,
      8453: BlockchainNetwork.BASE,
    };

    return chainIdMap[chainId] || BlockchainNetwork.ETHEREUM;
  }

  // Convert our network enum to Zapper chain IDs
  networkToChainId(network: BlockchainNetwork): number {
    const networkMap: Partial<Record<BlockchainNetwork, number>> = {
      [BlockchainNetwork.ETHEREUM]: 1,
      [BlockchainNetwork.POLYGON]: 137,
      [BlockchainNetwork.BSC]: 56,
      [BlockchainNetwork.ARBITRUM]: 42161,
      [BlockchainNetwork.OPTIMISM]: 10,
      [BlockchainNetwork.AVALANCHE]: 43114,
      [BlockchainNetwork.BASE]: 8453,
      [BlockchainNetwork.SOLANA]: 1, // Fallback to Ethereum
      [BlockchainNetwork.BITCOIN]: 1, // Fallback to Ethereum
      [BlockchainNetwork.FANTOM]: 250,
      [BlockchainNetwork.CRONOS]: 25,
      [BlockchainNetwork.GNOSIS]: 100,
      [BlockchainNetwork.AURORA]: 1313161554,
    };

    return networkMap[network] || 1; // Default to Ethereum
  }

  async healthCheck(): Promise<ZapperHealthCheck> {
    try {
      // Simple introspection query to test the connection
      const query = `
        query IntrospectionQuery {
          __schema {
            queryType {
              name
            }
          }
        }
      `;

      await this.makeGraphQLRequest(query, {});

      return {
        healthy: true,
        message: 'Zapper service is operational',
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Zapper health check failed:', error);
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Health check failed',
        timestamp: new Date(),
      };
    }
  }

  // Batch portfolio requests for multiple addresses
  async getBatchPortfolios(
    addressGroups: string[][],
    chainIds?: number[]
  ): Promise<ZapperCombinedPortfolioResponse[]> {
    const promises = addressGroups.map((addresses) => this.getWalletPortfolio(addresses, chainIds));

    try {
      return await Promise.all(promises);
    } catch (error) {
      logger.error('Error in batch portfolio requests:', error);
      throw error;
    }
  }
}

// Factory function to create Zapper service instance
export function createZapperService(config: ZapperServiceConfig): ZapperService {
  return new ZapperService(config);
}

export default ZapperService;
