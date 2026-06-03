import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAccount } from 'wagmi';
import {
  useWalletType,
  useAesKeyProvider,
} from '@coti-io/coti-wallet-plugin';
import type { WalletTypeInfo } from '@coti-io/coti-wallet-plugin';

import { useInvokeSnap } from './useInvokeSnap';
import { useMetaMaskContext } from './MetamaskContext';
import { defaultSnapOrigin } from '../config';

/**
 * Mapped wallet type exposed to the application.
 * - 'metamask-snap': MetaMask with COTI Snap installed
 * - 'metamask-no-snap': MetaMask without COTI Snap
 * - 'non-metamask': Any other wallet (Coinbase, WalletConnect, Rainbow, etc.)
 * - null: No wallet connected
 */
export type MappedWalletType =
  | 'metamask-snap'
  | 'metamask-no-snap'
  | 'non-metamask'
  | null;

/**
 * Context value interface for AES key state management.
 */
export interface AesKeyContextValue {
  /** The AES key held in memory, null when not yet retrieved */
  aesKey: string | null;
  /** True during async AES key retrieval (onboarding contract flow) */
  isOnboarding: boolean;
  /** Error message from failed onboarding attempts */
  onboardingError: string | null;
  /** Mapped wallet type for routing decisions */
  walletType: MappedWalletType;
  /** Triggers AES key retrieval via the appropriate path */
  getAesKey: () => Promise<void>;
  /** Clears the in-memory AES key and resets state */
  clearAesKey: () => void;
  /** Whether the onboard modal should be displayed */
  showOnboardModal: boolean;
  /** Controls onboard modal visibility */
  setShowOnboardModal: (show: boolean) => void;
  /** True while checking if the snap has an AES key stored */
  isCheckingSnap: boolean;
}

const AesKeyContext = createContext<AesKeyContextValue | undefined>(undefined);

/**
 * Maps the plugin's WalletTypeInfo to the application's simplified wallet type.
 */
function mapWalletType(walletTypeInfo: WalletTypeInfo): MappedWalletType {
  if (!walletTypeInfo.connectorId) {
    return null;
  }

  if (walletTypeInfo.walletType === 'metamask') {
    return walletTypeInfo.isMetaMaskWithSnap
      ? 'metamask-snap'
      : 'metamask-no-snap';
  }

  return 'non-metamask';
}

interface AesKeyProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that manages AES key state using the plugin's
 * useWalletType() and useAesKeyProvider() hooks.
 *
 * The AES key is held in React state only (never persisted).
 * On disconnect, the key is cleared automatically.
 */

// Module-level state that survives React StrictMode double-mount.
// StrictMode unmounts/remounts components, resetting useRef values.
// These module-level vars prevent duplicate snap checks that overwhelm MetaMask.
// We store on window to also survive Vite HMR which resets module-level vars.
const WIN = typeof window !== 'undefined' ? (window as any) : ({} as any);
if (!WIN.__aesKeyCtx) WIN.__aesKeyCtx = { done: null, installed: false, key: null, inProgress: false, inProgressSince: 0, chainId: null, keys: {} };
const _ctx = WIN.__aesKeyCtx as { done: string | null; installed: boolean; key: string | null; inProgress: boolean; inProgressSince: number; chainId: number | null; keys: Record<number, string> };

export const AesKeyProvider: React.FC<AesKeyProviderProps> = ({ children }) => {
  const { address, isConnected, chain, connector } = useAccount();
  const walletTypeInfo = useWalletType();
  const {
    getAesKey: pluginGetAesKey,
    isOnboarding,
    onboardingError,
  } = useAesKeyProvider(walletTypeInfo);
  // Site's own snap invoker — correctly resolves the local snap id
  // (local:http://localhost:8080) via resolveSnapId, unlike the plugin's
  // useSnap which is locked to the npm id captured at module load.
  const invokeSnap = useInvokeSnap();
  // The detected MetaMask EIP-6963 provider (not raw window.ethereum, which
  // can be hijacked by other wallet extensions).
  const { provider: metaMaskProvider, hasCheckedForProvider } = useMetaMaskContext();

  // AES key held in memory only — never persisted
  const [aesKey, setAesKeyState] = useState<string | null>(_ctx.key);

  // Wrapper that keeps module-level cache in sync with React state
  const setAesKey = useCallback((key: string | null) => {
    _ctx.key = key;
    setAesKeyState(key);
  }, []);
  const [showOnboardModal, setShowOnboardModal] = useState<boolean>(false);
  // Local error state to capture errors thrown by getAesKey calls
  const [localError, setLocalError] = useState<string | null>(null);
  // True while silently checking if the snap already has a stored AES key.
  // Only meaningful for MetaMask; set by the snap-check effect below.
  const [isCheckingSnap, setIsCheckingSnap] = useState<boolean>(false);

  const walletType = useMemo(
    () => mapWalletType(walletTypeInfo),
    [walletTypeInfo],
  );

  /**
   * True only when the connected wallet is MetaMask (with or without snap).
   * Snap RPC calls (which talk to window.ethereum / MetaMask directly) must
   * NEVER run for other wallets — doing so invokes MetaMask automatically and
   * bypasses the RainbowKit wallet the user actually selected.
   */
  const isMetaMask = useMemo(
    () => walletType === 'metamask-snap' || walletType === 'metamask-no-snap',
    [walletType],
  );

  /**
   * Combined error: prefer the plugin's onboardingError, fall back to local error.
   * This ensures errors from both the plugin's internal state and from
   * direct getAesKey() call failures are surfaced to consumers.
   */
  const combinedError = onboardingError ?? localError;

  /**
   * Resolves the COTI chainId where the AES key is stored.
   * The snap stores keys per COTI chainId. Non-COTI chains (e.g. Sepolia)
   * default to COTI testnet, matching the plugin's getAESKeyFromSnap logic.
   */
  const COTI_MAINNET_ID = 2632500;
  const COTI_TESTNET_ID = 7082400;

  const resolveCotiChainId = useCallback((): number => {
    return chain?.id === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;
  }, [chain?.id]);

  /**
   * Checks if the COTI snap is installed by reading wallet_getSnaps from the
   * detected MetaMask EIP-6963 provider (NOT raw window.ethereum, which may be
   * hijacked by another wallet extension). Matches the configured npm id, the
   * local snap id, OR any local: snap (for local dev). This is needed because
   * the plugin's own isSnapInstalled is locked to the npm id and misses the
   * local snap in development.
   */
  /**
   * Checks if the COTI snap is installed. Uses a cached result to avoid
   * repeated RPC calls that can fail due to MetaMask rate-limiting.
   * The actual check is done by attempting to invoke the snap directly —
   * if it works, the snap is installed.
   */
  const isCotiSnapInstalled = useCallback(async (): Promise<boolean> => {
    // Don't check snap for non-MetaMask connectors
    const connectorId = connector?.id?.toLowerCase() ?? '';
    const isMetaMaskConnector = connectorId.includes('metamask') || connectorId.includes('io.metamask');
    if (!isMetaMaskConnector) {
      return false;
    }

    // Once confirmed installed, never re-check during this session
    if (_ctx.installed === true) {
      console.log('[AesKeyContext] isCotiSnapInstalled: true (cached)');
      return true;
    }

    try {
      const result = await invokeSnap({ method: 'check-account-permissions' });
      const installed = result !== null;
      console.log(
        '[AesKeyContext] isCotiSnapInstalled:',
        installed,
        '(via invokeSnap check-account-permissions)',
      );
      if (installed) {
        _ctx.installed = true;
      }
      return installed;
    } catch (error) {
      console.warn('[AesKeyContext] isCotiSnapInstalled failed:', error);
      return false;
    }
  }, [invokeSnap, connector]);

  /**
   * Retrieves the AES key.
   *
   * If the COTI snap is installed, retrieves the key from it via the site's
   * own invokeSnap (which resolves the correct local/npm snap id). Only when
   * the snap is genuinely not installed do we fall back to the onboard
   * contract via pluginGetAesKey.
   */
  const getAesKey = useCallback(async (): Promise<void> => {
    if (!address) {
      return;
    }

    setLocalError(null);

    try {
      const cotiChainId = resolveCotiChainId();
      const connectorId = connector?.id?.toLowerCase() ?? '';
      const isMetaMask = connectorId.includes('metamask') || connectorId.includes('io.metamask');

      console.log(
        '[AesKeyContext] getAesKey: connector =',
        connector?.id,
        '| isMetaMask =',
        isMetaMask,
        '| cotiChainId =',
        cotiChainId,
      );

      // Only try snap for MetaMask connections
      if (isMetaMask) {
        const installed = await isCotiSnapInstalled();

        if (installed) {
          const hasKey = await invokeSnap({
            method: 'has-aes-key',
            params: { chainId: cotiChainId },
          });
          console.log(`[AesKeyContext] getAesKey: has-aes-key (chainId=${cotiChainId}) =`, hasKey);

          if (hasKey) {
            const snapKey = await invokeSnap({
              method: 'get-aes-key',
              params: { chainId: cotiChainId },
            });
            if (snapKey && typeof snapKey === 'string') {
              setAesKey(snapKey);
              setShowOnboardModal(false);
              return;
            }
          }
          console.log('[AesKeyContext] getAesKey: snap has no key, onboarding via contract');
        } else if (metaMaskProvider) {
          console.log('[AesKeyContext] getAesKey: installing snap...');
          try {
            await metaMaskProvider.request({
              method: 'wallet_requestSnaps',
              params: { [defaultSnapOrigin]: {} },
            });
            console.log('[AesKeyContext] getAesKey: snap installed successfully');
          } catch (installError) {
            console.warn('[AesKeyContext] getAesKey: snap install failed:', installError);
          }
        }
      }

      // Onboard via the plugin (contract flow) to obtain the key
      console.log('[AesKeyContext] getAesKey: calling pluginGetAesKey...');
      const key = await pluginGetAesKey(address);
      console.log(
        '[AesKeyContext] getAesKey: pluginGetAesKey returned',
        key ? `key(${key.length})` : 'null',
      );

      if (key) {
        setAesKey(key);
        setShowOnboardModal(false);

        // Persist the onboarded key into the snap (MetaMask only)
        if (isMetaMask) {
          try {
            console.log('[AesKeyContext] getAesKey: storing key in snap via set-aes-key for chainId =', cotiChainId);
            await invokeSnap({
              method: 'set-aes-key',
              params: { newUserAesKey: key, chainId: cotiChainId },
            });
            console.log('[AesKeyContext] getAesKey: key stored for chainId =', cotiChainId);
          } catch (storeError) {
            console.error('[AesKeyContext] getAesKey: failed to store key in snap:', storeError);
          }
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'AES key retrieval failed. Please try again.';
      console.error('[AesKeyContext] getAesKey error:', error);
      setLocalError(message);
    }
  }, [address, connector, isCotiSnapInstalled, invokeSnap, pluginGetAesKey, resolveCotiChainId, metaMaskProvider]);

  /**
   * Clears the in-memory AES key and resets modal state and errors.
   */
  const clearAesKey = useCallback((): void => {
    setAesKey(null);
    setLocalError(null);
    setShowOnboardModal(false);
  }, []);

  /**
   * Watch connection state — clear AES key and errors on disconnect.
   * Also clear when connector changes (switching wallets).
   */
  useEffect(() => {
    if (!isConnected) {
      setAesKey(null);
      setLocalError(null);
      setShowOnboardModal(false);
      setIsCheckingSnap(false);
      _ctx.done = null;
      _ctx.installed = false;
      _ctx.key = null;
      _ctx.inProgress = false;
      _ctx.chainId = null;
      _ctx.keys = {};
    }
  }, [isConnected]);

  // Clear stale state when connector changes (e.g., Rabby → MetaMask or vice versa)
  useEffect(() => {
    if (!connector) return;
    const connectorId = connector.id?.toLowerCase() ?? '';
    const isMetaMask = connectorId.includes('metamask') || connectorId.includes('io.metamask');
    
    // Always reset done/inProgress on connector change to allow fresh check
    _ctx.done = null;
    _ctx.inProgress = false;

    // If switching TO non-MetaMask, clear any MetaMask snap key
    if (!isMetaMask) {
      _ctx.key = null;
      _ctx.keys = {};
      setAesKey(null);
    }
  }, [connector]);

  /**
   * When a MetaMask wallet connects and we haven't checked yet, set isCheckingSnap
   * to prevent premature routing while the snap check runs.
   * Non-MetaMask wallets skip this entirely.
   */
  useEffect(() => {
    if (!isConnected || !address || !connector) return;
    const connectorId = connector.id?.toLowerCase() ?? '';
    const isMetaMask = connectorId.includes('metamask') || connectorId.includes('io.metamask');
    if (isMetaMask && aesKey === null && !_ctx.key) {
      setIsCheckingSnap(true);
    } else {
      setIsCheckingSnap(false);
    }
  }, [isConnected, aesKey, address, connector]);

  /**
   * Automatically show the onboard modal when a non-MetaMask wallet
   * is connected and no AES key has been retrieved yet.
   */
  useEffect(() => {
    if (!isConnected || !connector || aesKey !== null) {
      return;
    }
    const connectorId = connector.id?.toLowerCase() ?? '';
    const isMetaMaskConnector = connectorId.includes('metamask') || connectorId.includes('io.metamask');
    if (!isMetaMaskConnector) {
      setShowOnboardModal(true);
    }
  }, [isConnected, connector, aesKey]);

  /**
   * Auto-retrieve AES key from snap on wallet connect.
   *
   * Instead of first checking "is snap installed" (which is fragile due to
   * MetaMask rate-limiting and StrictMode double-mount), we directly try to
   * get the key via invokeSnap. If it succeeds → key set, done.
   * If it returns null → snap not installed or no key stored → show onboard.
   */
  useEffect(() => {
    if (
      !address ||
      !isConnected ||
      isOnboarding ||
      !hasCheckedForProvider
    ) {
      return;
    }

    // Only run snap auto-check if the user connected with MetaMask.
    const connectorId = connector?.id?.toLowerCase() ?? '';
    const isMetaMaskConnector = connectorId.includes('metamask') || connectorId.includes('io.metamask');
    if (!isMetaMaskConnector) {
      return;
    }

    const currentChainId = resolveCotiChainId();

    // If chain changed, check if we have a cached key for the new chain
    if (_ctx.chainId !== null && _ctx.chainId !== currentChainId) {
      _ctx.done = null;
      _ctx.inProgress = false;
      const cachedKey = _ctx.keys[currentChainId];
      if (cachedKey) {
        _ctx.key = cachedKey;
        _ctx.chainId = currentChainId;
        if (aesKey !== cachedKey) {
          setAesKey(cachedKey);
        }
        return;
      }
      _ctx.key = null;
      setAesKey(null);
    }
    _ctx.chainId = currentChainId;

    // If we already have a key for this chain, skip
    if (_ctx.key) {
      return;
    }

    if (aesKey !== null) {
      return;
    }

    // If a check is already in progress, skip (with timeout safety)
    if (_ctx.inProgress) {
      if (!_ctx.inProgressSince || Date.now() - _ctx.inProgressSince > 10000) {
        _ctx.inProgress = false;
      } else {
        return;
      }
    }

    // Only check once per address+chain combo
    const doneKey = `${address}:${currentChainId}`;
    if (_ctx.done === doneKey) {
      return;
    }

    _ctx.done = doneKey;
    _ctx.inProgress = true;
    _ctx.inProgressSince = Date.now();

    const checkAndRetrieve = async () => {
      // If key was already found (by another concurrent call), stop
      if (_ctx.key) {
        _ctx.inProgress = false;
        setIsCheckingSnap(false);
        return;
      }
      setIsCheckingSnap(true);
      try {
        const cotiChainId = resolveCotiChainId();
        console.log('[AesKeyContext] auto-check: looking for key on chainId =', cotiChainId);

        let hasKey = await invokeSnap({
          method: 'has-aes-key',
          params: { chainId: cotiChainId },
        });
        console.log(`[AesKeyContext] auto-check: has-aes-key (chainId=${cotiChainId}) =`, hasKey);

        // If null, the snap might need permission re-approval — try requesting it
        if (hasKey === null && metaMaskProvider) {
          console.log('[AesKeyContext] auto-check: snap permission issue, requesting snap...');
          try {
            await metaMaskProvider.request({
              method: 'wallet_requestSnaps',
              params: { [defaultSnapOrigin]: {} },
            });
            // Retry after approval
            hasKey = await invokeSnap({
              method: 'has-aes-key',
              params: { chainId: cotiChainId },
            });
            console.log(`[AesKeyContext] auto-check: after re-approval, has-aes-key =`, hasKey);
          } catch (snapErr) {
            console.warn('[AesKeyContext] auto-check: snap request failed:', snapErr);
          }
        }

        if (hasKey) {
          const key = await invokeSnap({
            method: 'get-aes-key',
            params: { chainId: cotiChainId },
          });
          console.log(
            '[AesKeyContext] auto-check: get-aes-key =',
            key ? `key(${(key as string).length})` : 'null',
          );
          if (key && typeof key === 'string') {
            _ctx.installed = true;
            _ctx.key = key;
            _ctx.keys[cotiChainId] = key;
            setAesKey(key);
            setShowOnboardModal(false);
            return;
          }
        }

        // No key found or snap not accessible — show onboard
        console.log('[AesKeyContext] auto-check: no key found for chainId =', cotiChainId);
      } catch (error: unknown) {
        console.warn('[AesKeyContext] auto-check failed:', error);
      } finally {
        _ctx.inProgress = false;
        setIsCheckingSnap(false);
      }
    };

    void checkAndRetrieve();
  }, [address, isConnected, aesKey, isOnboarding, hasCheckedForProvider, connector, invokeSnap, resolveCotiChainId]);

  const contextValue = useMemo<AesKeyContextValue>(
    () => ({
      aesKey,
      isOnboarding,
      onboardingError: combinedError,
      walletType,
      getAesKey,
      clearAesKey,
      showOnboardModal,
      setShowOnboardModal,
      isCheckingSnap,
    }),
    [
      aesKey,
      isOnboarding,
      combinedError,
      walletType,
      getAesKey,
      clearAesKey,
      showOnboardModal,
      isCheckingSnap,
    ],
  );

  return (
    <AesKeyContext.Provider value={contextValue}>
      {children}
    </AesKeyContext.Provider>
  );
};

/**
 * Consumer hook for accessing AES key context.
 * Must be used within an AesKeyProvider.
 */
export function useAesKey(): AesKeyContextValue {
  const context = useContext(AesKeyContext);
  if (context === undefined) {
    throw new Error('useAesKey must be used within an AesKeyProvider');
  }
  return context;
}
