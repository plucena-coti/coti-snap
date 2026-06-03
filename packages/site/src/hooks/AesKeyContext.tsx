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

import { useInvokeSnap } from './useInvokeSnap';
import { useRequest } from './useRequest';
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
  const invokeSnap = useInvokeSnap();
  const request = useRequest();

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
   * Ensures the site has permission to invoke the snap.
   * Checks wallet_getSnaps directly on window.ethereum (MetaMask's provider)
   * to see if snap is already connected. Only calls wallet_requestSnaps
   * if snap is not found.
   * Returns true if snap is available, false otherwise.
   */
  const ensureSnapConnection = useCallback(async (): Promise<boolean> => {
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        console.log('[AesKeyContext] no window.ethereum');
        return false;
      }

      // Check if snap is already connected — wallet_getSnaps is always silent
      const snaps = (await ethereum.request({
        method: 'wallet_getSnaps',
      })) as Record<string, unknown>;

      console.log('[AesKeyContext] wallet_getSnaps result:', JSON.stringify(snaps));
      console.log('[AesKeyContext] looking for snapId:', defaultSnapOrigin);

      if (snaps && typeof snaps === 'object') {
        // Check if our snap ID is present
        const hasExactSnap = defaultSnapOrigin in snaps;
        // Also check for any local snap (for dev)
        const hasLocalSnap = Object.keys(snaps).some((id) => id.startsWith('local:'));

        console.log('[AesKeyContext] hasExactSnap:', hasExactSnap, 'hasLocalSnap:', hasLocalSnap);

        if (hasExactSnap || hasLocalSnap) {
          // Snap is already installed and connected — no need for wallet_requestSnaps
          return true;
        }
      }

      // Snap not found — try requesting it (will prompt install/connect)
      console.log('[AesKeyContext] snap not found, calling wallet_requestSnaps');
      await ethereum.request({
        method: 'wallet_requestSnaps',
        params: { [defaultSnapOrigin]: {} },
      });
      return true;
    } catch (error) {
      console.warn('[AesKeyContext] ensureSnapConnection failed:', error);
      return false;
    }
  }, []);

  /**
   * Retrieves the AES key. Always attempts the snap path first:
   * 1. Ensures snap permission via wallet_requestSnaps
   * 2. Calls has-aes-key (silent, no dialog)
   * 3. If key exists, retrieves via get-aes-key
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
      // Step 1: Ensure we have permission to talk to the snap.
      console.log('[AesKeyContext] getAesKey called for address:', address);
      const snapAvailable = await ensureSnapConnection();
      console.log('[AesKeyContext] snapAvailable:', snapAvailable);

      if (snapAvailable) {
        // Step 2: Silent check — has-aes-key does NOT show a dialog
        console.log('[AesKeyContext] calling has-aes-key...');
        const hasKey = await invokeSnap({
          method: 'has-aes-key',
          params: {},
        });
        console.log('[AesKeyContext] has-aes-key result:', hasKey);

        if (hasKey) {
          // Step 3: Snap has the key — retrieve it (shows snap confirmation)
          console.log('[AesKeyContext] calling get-aes-key...');
          const snapKey = await invokeSnap({
            method: 'get-aes-key',
            params: {},
          });
          console.log('[AesKeyContext] get-aes-key result:', snapKey ? `key(${(snapKey as string).length} chars)` : 'null');
          if (snapKey && typeof snapKey === 'string') {
            setAesKey(snapKey);
            setShowOnboardModal(false);
            console.log('[AesKeyContext] ✅ AES key set from snap');
            return;
          }
        }
        // Snap has no key — fall through to onboard contract
        console.log('[AesKeyContext] snap has no key, falling through to plugin');
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
  }, [address, ensureSnapConnection, invokeSnap, pluginGetAesKey]);

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
        // Ensure we have permission to talk to the snap first
        console.log('[AesKeyContext] auto-check: ensuring snap connection...');
        const snapAvailable = await ensureSnapConnection();
        console.log('[AesKeyContext] auto-check: snapAvailable:', snapAvailable);
        if (!snapAvailable) {
          snapCheckDoneRef.current = address;
          return;
        }

        // Silent check — 'has-aes-key' does NOT show a dialog.
        console.log('[AesKeyContext] auto-check: calling has-aes-key...');
        const hasKey = await invokeSnap({
          method: 'has-aes-key',
          params: {},
        });
        console.log('[AesKeyContext] auto-check: has-aes-key result:', hasKey);

        snapCheckDoneRef.current = address;

        if (hasKey) {
          // Snap has the key — retrieve it directly via 'get-aes-key'.
          console.log('[AesKeyContext] auto-check: calling get-aes-key...');
          const key = await invokeSnap({
            method: 'get-aes-key',
            params: {},
          });
          console.log('[AesKeyContext] auto-check: get-aes-key result:', key ? 'got key' : 'null');
          if (key && typeof key === 'string') {
            setAesKey(key);
            setShowOnboardModal(false);
          }
        }
        // If snap doesn't have the key, do nothing — onboard page will show
      } catch (error: unknown) {
        // Snap not installed or communication failed — user will see onboard page
        snapCheckDoneRef.current = address;
        console.warn('[AesKeyContext] auto-check failed:', error);
      } finally {
        setIsCheckingSnap(false);
      }
    };

    void checkAndRetrieve();
  }, [address, isConnected, aesKey, isOnboarding, invokeSnap, ensureSnapConnection]);

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
