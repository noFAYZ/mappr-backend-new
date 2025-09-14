# Real-Time Wallet Sync Integration Guide

This guide shows how to integrate real-time wallet sync progress tracking into your frontend application.

## Overview

The backend now provides:
- **Server-Sent Events (SSE)** for real-time progress updates
- **Batch polling** as a fallback for older browsers
- **Automatic cache invalidation** after sync completion

## API Endpoints

### 1. SSE Stream (Primary)
```
GET /api/v1/crypto/user/sync/stream
Authorization: Bearer <token>
```

**Response Format:**
```javascript
// Connection established
data: {"type":"connection_established","userId":"user123","timestamp":"2023-01-01T00:00:00.000Z"}

// Progress updates
data: {"type":"wallet_sync_progress","walletId":"wallet123","progress":25,"status":"syncing_assets","message":"Fetching portfolio assets...","timestamp":"2023-01-01T00:00:01.000Z"}

// Completion
data: {"type":"wallet_sync_completed","walletId":"wallet123","progress":100,"status":"completed","syncedData":["assets","transactions"],"completedAt":"2023-01-01T00:00:02.000Z"}

// Heartbeat (every 30s)
data: {"type":"heartbeat","timestamp":"2023-01-01T00:00:30.000Z"}
```

### 2. Batch Status (Fallback)
```
GET /api/v1/crypto/user/wallets/sync/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallets": {
      "wallet123": {
        "id": "wallet123",
        "name": "MetaMask Wallet",
        "address": "0x742d35cc...",
        "network": "ETHEREUM",
        "syncStatus": {
          "status": "syncing_assets",
          "progress": 50,
          "lastSyncAt": "2023-01-01T00:00:00Z",
          "syncedData": ["assets"]
        }
      }
    },
    "totalWallets": 5,
    "syncingCount": 2
  }
}
```

### 3. Connection Stats
```
GET /api/v1/crypto/user/sync/stats
Authorization: Bearer <token>
```

## Frontend Integration

### Complete Example (React/TypeScript)

```typescript
import React, { useState, useEffect, useCallback } from 'react';

interface WalletSyncProgress {
  walletId: string;
  progress: number;
  status: 'queued' | 'syncing' | 'syncing_assets' | 'syncing_transactions' | 'syncing_nfts' | 'syncing_defi' | 'completed' | 'failed';
  message?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  syncedData?: string[];
}

interface WalletSyncState {
  [walletId: string]: WalletSyncProgress;
}

export class MultiWalletSyncTracker {
  private eventSource: EventSource | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly API_BASE = '/api/v1/crypto';

  constructor(
    private authToken: string,
    private onProgress: (walletId: string, progress: WalletSyncProgress) => void,
    private onComplete: (walletId: string, result: any) => void,
    private onError: (error: string) => void,
    private onConnectionChange: (connected: boolean) => void
  ) {}

  startTracking(): void {
    if (this.isSSESupported()) {
      this.startSSE();
    } else {
      this.startPolling();
    }
  }

  stopTracking(): void {
    this.cleanup();
  }

  private isSSESupported(): boolean {
    return typeof EventSource !== 'undefined';
  }

  private startSSE(): void {
    try {
      this.eventSource = new EventSource(
        `${this.API_BASE}/user/sync/stream`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`
          }
        }
      );

      this.eventSource.onopen = () => {
        console.log('SSE connection established');
        this.onConnectionChange(true);
      };

      this.eventSource.addEventListener('message', (event) => {
        this.handleSSEMessage(JSON.parse(event.data));
      });

      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        this.onConnectionChange(false);

        // Fallback to polling after SSE failure
        this.cleanup();
        setTimeout(() => this.startPolling(), 1000);
      };

    } catch (error) {
      console.error('Failed to establish SSE connection:', error);
      this.startPolling();
    }
  }

  private handleSSEMessage(data: any): void {
    switch (data.type) {
      case 'connection_established':
        console.log('SSE connection confirmed for user:', data.userId);
        break;

      case 'wallet_sync_progress':
        this.onProgress(data.walletId, {
          walletId: data.walletId,
          progress: data.progress,
          status: data.status,
          message: data.message,
          startedAt: data.startedAt ? new Date(data.startedAt) : undefined
        });
        break;

      case 'wallet_sync_completed':
        this.onComplete(data.walletId, {
          ...data,
          completedAt: new Date(data.completedAt || data.timestamp)
        });
        break;

      case 'wallet_sync_failed':
        this.onProgress(data.walletId, {
          walletId: data.walletId,
          progress: 0,
          status: 'failed',
          error: data.error,
          completedAt: new Date(data.timestamp)
        });
        break;

      case 'heartbeat':
        // Connection is alive
        break;

      default:
        console.warn('Unknown SSE message type:', data.type);
    }
  }

  private startPolling(): void {
    console.log('Starting polling fallback');
    this.onConnectionChange(true);

    this.pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.API_BASE}/user/wallets/sync/status`, {
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        this.handlePollingResponse(data);

      } catch (error) {
        console.error('Polling error:', error);
        this.onError(`Polling failed: ${error.message}`);
      }
    }, 2000); // Poll every 2 seconds
  }

  private handlePollingResponse(response: any): void {
    if (!response.success || !response.data.wallets) {
      return;
    }

    Object.values(response.data.wallets).forEach((wallet: any) => {
      const syncStatus = wallet.syncStatus;

      this.onProgress(wallet.id, {
        walletId: wallet.id,
        progress: syncStatus.progress || 100,
        status: syncStatus.status || 'completed',
        message: syncStatus.message,
        error: syncStatus.error,
        syncedData: syncStatus.syncedData
      });

      // Trigger completion callback for completed wallets
      if (syncStatus.status === 'completed') {
        this.onComplete(wallet.id, {
          walletId: wallet.id,
          status: 'completed',
          progress: 100,
          syncedData: syncStatus.syncedData,
          completedAt: new Date(syncStatus.lastSyncAt)
        });
      }
    });
  }

  private cleanup(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.onConnectionChange(false);
  }
}

// React Hook
export function useWalletSyncProgress(authToken: string) {
  const [walletStates, setWalletStates] = useState<WalletSyncState>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProgress = useCallback((walletId: string, progress: WalletSyncProgress) => {
    setWalletStates(prev => ({
      ...prev,
      [walletId]: progress
    }));
  }, []);

  const handleComplete = useCallback((walletId: string, result: any) => {
    setWalletStates(prev => ({
      ...prev,
      [walletId]: {
        ...prev[walletId],
        ...result,
        status: 'completed',
        progress: 100
      }
    }));

    // Refresh wallet data after completion
    refreshWalletData(walletId);
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  const handleConnectionChange = useCallback((connected: boolean) => {
    setIsConnected(connected);
    if (connected) {
      setError(null);
    }
  }, []);

  useEffect(() => {
    if (!authToken) return;

    const tracker = new MultiWalletSyncTracker(
      authToken,
      handleProgress,
      handleComplete,
      handleError,
      handleConnectionChange
    );

    tracker.startTracking();

    return () => tracker.stopTracking();
  }, [authToken, handleProgress, handleComplete, handleError, handleConnectionChange]);

  return {
    walletStates,
    isConnected,
    error
  };
}

// Helper function to refresh wallet data after sync completion
async function refreshWalletData(walletId: string) {
  try {
    // Call your wallet details API to get fresh data
    const response = await fetch(`/api/v1/crypto/wallets/${walletId}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const walletData = await response.json();
      // Update your application state with fresh wallet data
      console.log('Refreshed wallet data:', walletData);
    }
  } catch (error) {
    console.error('Failed to refresh wallet data:', error);
  }
}

// Example React Component
export function WalletSyncDashboard() {
  const authToken = localStorage.getItem('authToken') || '';
  const { walletStates, isConnected, error } = useWalletSyncProgress(authToken);

  return (
    <div className="wallet-sync-dashboard">
      <div className="connection-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="wallet-list">
        {Object.entries(walletStates).map(([walletId, state]) => (
          <WalletSyncCard key={walletId} walletId={walletId} state={state} />
        ))}
      </div>
    </div>
  );
}

function WalletSyncCard({ walletId, state }: { walletId: string; state: WalletSyncProgress }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'syncing':
      case 'syncing_assets':
      case 'syncing_transactions': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  return (
    <div className="wallet-sync-card" style={{ borderLeft: `4px solid ${getStatusColor(state.status)}` }}>
      <div className="wallet-header">
        <h3>Wallet {walletId.substring(0, 8)}...</h3>
        <span className="status">{state.status.replace('_', ' ').toUpperCase()}</span>
      </div>

      <div className="progress-section">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${state.progress}%`,
              backgroundColor: getStatusColor(state.status)
            }}
          />
        </div>
        <span className="progress-text">{state.progress}%</span>
      </div>

      {state.message && (
        <div className="status-message">{state.message}</div>
      )}

      {state.error && (
        <div className="error-message">Error: {state.error}</div>
      )}

      {state.syncedData && state.syncedData.length > 0 && (
        <div className="synced-data">
          Synced: {state.syncedData.join(', ')}
        </div>
      )}
    </div>
  );
}
```

### Basic CSS Styles

```css
.wallet-sync-dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 8px;
}

.status-indicator {
  font-weight: 600;
}

.error {
  color: #ef4444;
  font-size: 14px;
}

.wallet-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.wallet-sync-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: transform 0.2s;
}

.wallet-sync-card:hover {
  transform: translateY(-2px);
}

.wallet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.wallet-header h3 {
  margin: 0;
  font-size: 18px;
}

.status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  background: #e5e7eb;
  border-radius: 4px;
}

.progress-section {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 14px;
  font-weight: 600;
  min-width: 40px;
}

.status-message {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 8px;
}

.error-message {
  font-size: 14px;
  color: #ef4444;
  margin-bottom: 8px;
}

.synced-data {
  font-size: 12px;
  color: #059669;
  font-weight: 500;
}
```

## Usage Examples

### 1. Start Tracking After Wallet Sync
```javascript
// After triggering a wallet sync
const syncWallet = async (walletId) => {
  try {
    // Start sync
    const response = await fetch(`/api/v1/crypto/wallets/${walletId}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        syncAssets: true,
        syncTransactions: true,
        syncNFTs: false,
        syncDeFi: false
      })
    });

    if (response.ok) {
      // Real-time tracking will automatically pick up the sync progress
      console.log('Sync started - progress will be tracked automatically');
    }
  } catch (error) {
    console.error('Failed to start sync:', error);
  }
};
```

### 2. Handle Multiple Wallet Syncs
```javascript
const syncMultipleWallets = async (walletIds) => {
  // Start all syncs in parallel
  const syncPromises = walletIds.map(walletId =>
    fetch(`/api/v1/crypto/wallets/${walletId}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ syncAssets: true, syncTransactions: true })
    })
  );

  try {
    await Promise.all(syncPromises);
    console.log('All syncs started - tracking progress in real-time');
  } catch (error) {
    console.error('Failed to start some syncs:', error);
  }
};
```

## Benefits

✅ **Real-time updates** - No more manual refreshing
✅ **Efficient** - Single connection for all wallets
✅ **Robust** - Automatic fallback to polling
✅ **Universal** - Works in all browsers
✅ **Scalable** - Handles multiple wallets efficiently
✅ **Automatic refresh** - Fresh data after sync completion

## Browser Support

- **SSE**: Chrome 6+, Firefox 6+, Safari 5+, Edge 79+
- **Polling Fallback**: All browsers
- **Automatic detection** and graceful degradation

The system automatically detects SSE support and falls back to polling for older browsers, ensuring universal compatibility.