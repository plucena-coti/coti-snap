import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAccount } from 'wagmi';
import {
  useWalletType,
  useAesKeyProvider,
} from '@coti-io/coti-wallet-plugin';
import type { WalletTypeInfo } from '@coti-io/coti-wallet-plugin';

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
export const AesKeyProvider: React.FC<AesKeyProviderProps> = ({ children }) => {
  const { address, isConnected } = useAccount();
  const walletTypeInfo = useWalletType();
  const {
    getAesKey: pluginGetAesKey,
    isOnboarding,
    onboardingError,
  } = useAesKeyProvider(walletTypeInfo);

  // AES key held in memory only — never persisted
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [showOnboardModal, setShowOnboardModal] = useState<boolean>(false);
  // Local error state to capture errors thrown by getAesKey calls
  const [localError, setLocalError] = useState<string | null>(null);
  // True while silently checking if the snap already has a stored AES key.
  // Starts true when connected to prevent premature /install redirect.
  const [isCheckingSnap, setIsCheckingSnap] = useState<boolean>(
    isConnected && Boolean(address),
  );
  // Track which address we've already checked to avoid repeated checks
  const snapCheckDoneRef = useRef<string | null>(null);

  const walletType = useMemo(
    () => mapWalletType(walletTypeInfo),
    [walletTypeInfo],
  );

  /**
   * Combined error: prefer the plugin's onboardingError, fall back to local error.
   * This ensures errors from both the plugin's internal state and from
   * direct getAesKey() call failures are surfaced to consumers.
   */
  const combinedError = onboardingError ?? localError;

  /**
   * Calls a snap method directly on window.ethereum, bypassing wagmi's provider.
   * This avoids the provider mismatch issue where wagmi's provider doesn't
   * have snap invoke permissions.
   */
  const invokeSnapDirect = useCallback(
    async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        throw new Error('No window.ethereum');
      }

      // First, ensure we have permission by calling wallet_requestSnaps.
      // For already-installed snaps this should be instant with no dialog.
      // We pass the version '*' to avoid MetaMask trying to "update" the snap.
      await ethereum.request({
        method: 'wallet_requestSnaps',
        params: { [defaultSnapOrigin]: { version: '*' } },
      });

      // Now invoke the snap method
      return ethereum.request({
        method: 'wallet_invokeSnap',
        params: {
          snapId: defaultSnapOrigin,
          request: params ? { method, params } : { method },
        },
      });
    },
    [],
  );

  /**
   * Retrieves the AES key. Always attempts the snap path first:
   * 1. Calls has-aes-key directly on window.ethereum (silent, no dialog)
   * 2. If key exists, retrieves via get-aes-key
   *
   * Falls back to the plugin's onboard contract path only when the snap
   * is genuinely unavailable or has no key stored.
   *
   * This mirrors the examples/src/App.tsx pattern where getAesKey(address)
   * handles routing transparently.
   */
  const getAesKey = useCallback(async (): Promise<void> => {
    if (!address) {
      return;
    }

    // Clear previous local error before retrying
    setLocalError(null);

    try {
      // Try the snap path directly via window.ethereum
      try {
        console.log('[AesKeyContext] getAesKey: trying snap path directly...');
        const hasKey = await invokeSnapDirect('has-aes-key');
        console.log('[AesKeyContext] has-aes-key result:', hasKey);

        if (hasKey) {
          console.log('[AesKeyContext] calling get-aes-key...');
          const snapKey = await invokeSnapDirect('get-aes-key');
          console.log('[AesKeyContext] get-aes-key result:', snapKey ? `key(${(snapKey as string).length} chars)` : 'null');
          if (snapKey && typeof snapKey === 'string') {
            setAesKey(snapKey);
            setShowOnboardModal(false);
            console.log('[AesKeyContext] ✅ AES key set from snap');
            return;
          }
        }
        console.log('[AesKeyContext] snap has no key, falling through to plugin');
      } catch (snapError) {
        console.warn('[AesKeyContext] snap path failed:', snapError);
        // Snap not available — fall through to plugin's onboard contract path
      }

      // Fallback: use the plugin's provider (handles non-MetaMask wallets
      // and the case where the snap genuinely has no key)
      console.log('[AesKeyContext] calling pluginGetAesKey (onboard contract path)');
      const key = await pluginGetAesKey(address);
      if (key) {
        setAesKey(key);
        setShowOnboardModal(false);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'AES key retrieval failed. Please try again.';
      console.error('[AesKeyContext] getAesKey error:', error);
      setLocalError(message);
    }
  }, [address, invokeSnapDirect, pluginGetAesKey]);

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
      snapCheckDoneRef.current = null;
    }
  }, [isConnected]);

  /**
   * When a new address connects and we haven't checked yet, set isCheckingSnap
   * to prevent premature routing while the snap check runs.
   */
  useEffect(() => {
    if (
      isConnected &&
      address &&
      aesKey === null &&
      snapCheckDoneRef.current !== address
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
   * Flow (mirrors examples/src/App.tsx pattern):
   * 1. Silently call 'has-aes-key' on the snap (no user prompt).
   * 2. If the snap holds a key, retrieve it via 'get-aes-key' which triggers
   *    the snap's confirmation dialog, then navigate to key management page.
   * 3. If the snap has no key or isn't installed, do nothing — onboard page shows.
   *
   * Always attempts the snap regardless of walletType since detection can be
   * unreliable. The has-aes-key call will simply fail if snap isn't installed.
   */
  useEffect(() => {
    if (
      !address ||
      !isConnected ||
      aesKey !== null ||
      isOnboarding
    ) {
      return;
    }

    // Only check once per address to avoid repeated prompts
    if (snapCheckDoneRef.current === address) {
      return;
    }

    const checkAndRetrieve = async () => {
      setIsCheckingSnap(true);
      try {
        console.log('[AesKeyContext] auto-check: trying has-aes-key...');
        const hasKey = await invokeSnapDirect('has-aes-key');
        console.log('[AesKeyContext] auto-check: has-aes-key result:', hasKey);

        snapCheckDoneRef.current = address;

        if (hasKey) {
          console.log('[AesKeyContext] auto-check: calling get-aes-key...');
          const key = await invokeSnapDirect('get-aes-key');
          console.log('[AesKeyContext] auto-check: get-aes-key result:', key ? 'got key' : 'null');
          if (key && typeof key === 'string') {
            setAesKey(key);
            setShowOnboardModal(false);
          }
        }
      } catch (error: unknown) {
        snapCheckDoneRef.current = address;
        console.warn('[AesKeyContext] auto-check failed:', error);
      } finally {
        setIsCheckingSnap(false);
      }
    };

    void checkAndRetrieve();
  }, [address, isConnected, aesKey, isOnboarding, invokeSnapDirect]);

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
