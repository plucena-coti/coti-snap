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
  const { address, isConnected, chain } = useAccount();
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
  }, [invokeSnap]);

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
      // Try to detect and use the snap. isCotiSnapInstalled uses the MetaMask
      // EIP-6963 provider directly — it doesn't depend on walletType which
      // can be unreliable (e.g. reports 'non-metamask' even for MetaMask
      // when there are window.ethereum conflicts).
      const installed = await isCotiSnapInstalled();
      const cotiChainId = resolveCotiChainId();
      console.log(
        '[AesKeyContext] getAesKey: walletType =',
        walletType,
        '| snap installed =',
        installed,
        '| cotiChainId =',
        cotiChainId,
      );

      if (installed) {
        // Snap is installed — check if it holds the key for the current chain.
        // Different chains have different AES keys — only retrieve for current chain.
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
          console.log(
            '[AesKeyContext] getAesKey: get-aes-key =',
            snapKey ? `key(${(snapKey as string).length})` : 'null',
          );
          if (snapKey && typeof snapKey === 'string') {
            setAesKey(snapKey);
            setShowOnboardModal(false);
            return;
          }
        }

        // Snap installed but has no key for this chain — onboard via contract, then PERSIST
        // the key to the snap so future loads retrieve it directly.
        console.log('[AesKeyContext] getAesKey: snap has no key, onboarding via contract');
      } else if (metaMaskProvider) {
        // Snap not installed but MetaMask EIP-6963 provider is available — install the snap.
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

        // Persist the onboarded key into the snap so it is available next time.
        if (installed) {
          try {
            console.log('[AesKeyContext] getAesKey: storing key in snap via set-aes-key for chainId =', cotiChainId);
            // Store ONLY under the current chain — different chains have different keys
            await invokeSnap({
              method: 'set-aes-key',
              params: { newUserAesKey: key, chainId: cotiChainId },
            });
            console.log('[AesKeyContext] getAesKey: key stored for chainId =', cotiChainId);

            // Verify
            const verifyHasKey = await invokeSnap({
              method: 'has-aes-key',
              params: { chainId: cotiChainId },
            });
            console.log('[AesKeyContext] getAesKey: verify has-aes-key after store =', verifyHasKey);
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
  }, [address, isCotiSnapInstalled, invokeSnap, pluginGetAesKey, resolveCotiChainId]);

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

  /**
   * When a wallet connects and we haven't checked yet, set isCheckingSnap
   * to prevent premature routing while the snap check runs.
   */
  useEffect(() => {
    if (
      isConnected &&
      address &&
      aesKey === null &&
      _ctx.done !== address
    ) {
      setIsCheckingSnap(true);
    }
  }, [isConnected, aesKey, address]);

  /**
   * Automatically show the onboard modal when a non-MetaMask wallet
   * is connected and no AES key has been retrieved yet.
   */
  useEffect(() => {
    if (walletType === 'non-metamask' && aesKey === null) {
      setShowOnboardModal(true);
    }
  }, [walletType, aesKey]);

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
      isOnboarding
    ) {
      return;
    }

    const currentChainId = resolveCotiChainId();

    // If chain changed, check if we have a cached key for the new chain
    if (_ctx.chainId !== null && _ctx.chainId !== currentChainId) {
      _ctx.done = null;
      _ctx.inProgress = false;
      const cachedKey = _ctx.keys[currentChainId];
      if (cachedKey) {
        // We already have a key for this chain from a previous fetch
        _ctx.key = cachedKey;
        _ctx.chainId = currentChainId;
        if (aesKey !== cachedKey) {
          setAesKey(cachedKey);
        }
        return;
      }
      // No cached key for new chain — need to fetch
      _ctx.key = null;
      setAesKey(null);
    }
    _ctx.chainId = currentChainId;

    // If we already have a key for this chain, skip
    if (_ctx.key) {
      return;
    }

    // If already checked this address on this chain, skip
    if (aesKey !== null) {
      return;
    }

    // If a check is already in progress, skip (with timeout safety)
    if (_ctx.inProgress) {
      // Safety: if stuck for >10s, reset (e.g. from previous HMR/crash)
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

    // Mark immediately to prevent concurrent fires
    _ctx.done = doneKey;
    _ctx.inProgress = true;
    _ctx.inProgressSince = Date.now();

    const checkAndRetrieve = async (retryCount = 0) => {
      // If key was already found (by another concurrent call), stop
      if (_ctx.key) {
        _ctx.inProgress = false;
        setIsCheckingSnap(false);
        return;
      }
      setIsCheckingSnap(true);
      try {
        // Get key for the current chain only — different chains have different keys.
        const cotiChainId = resolveCotiChainId();
        console.log('[AesKeyContext] auto-check: looking for key on chainId =', cotiChainId, retryCount > 0 ? `(retry ${retryCount})` : '');

        try {
          const hasKey = await invokeSnap({
            method: 'has-aes-key',
            params: { chainId: cotiChainId },
          });
          console.log(`[AesKeyContext] auto-check: has-aes-key (chainId=${cotiChainId}) =`, hasKey);

          // null means RPC failed (provider not ready / rate-limited)
          // Retry up to 3 times with increasing delay
          if (hasKey === null && retryCount < 3) {
            console.log('[AesKeyContext] auto-check: provider not ready, retrying in', (retryCount + 1) * 1500, 'ms');
            _ctx.done = null;
            setTimeout(() => {
              checkAndRetrieve(retryCount + 1);
            }, (retryCount + 1) * 1500);
            return;
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
              _ctx.keys[cotiChainId] = key; // Cache per chain
              setAesKey(key);
              setShowOnboardModal(false);
              return; // Done — key found
            }
          }
        } catch {
          // invokeSnap threw — provider issue, retry if possible
          if (retryCount < 3) {
            _ctx.done = null;
            setTimeout(() => {
              checkAndRetrieve(retryCount + 1);
            }, (retryCount + 1) * 1500);
            return;
          }
        }

        // Definitive: snap responded with false — no key for this chain
        console.log('[AesKeyContext] auto-check: no key found for chainId =', cotiChainId);
      } catch (error: unknown) {
        console.warn('[AesKeyContext] auto-check failed:', error);
        _ctx.done = null;
      } finally {
        _ctx.inProgress = false;
        setIsCheckingSnap(false);
      }
    };

    void checkAndRetrieve();
  }, [address, isConnected, aesKey, isOnboarding, invokeSnap, resolveCotiChainId]);

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
