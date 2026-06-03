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

  // AES key held in memory only — never persisted
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [showOnboardModal, setShowOnboardModal] = useState<boolean>(false);
  // Local error state to capture errors thrown by getAesKey calls
  const [localError, setLocalError] = useState<string | null>(null);
  // True while silently checking if the snap already has a stored AES key.
  // Starts true when MetaMask is connected to prevent premature /install redirect.
  const [isCheckingSnap, setIsCheckingSnap] = useState<boolean>(
    walletTypeInfo.walletType === 'metamask',
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
   * Retrieves the AES key using the plugin's provider.
   * The plugin routes to Snap or onboard contract based on wallet type.
   * Captures and exposes any errors that occur during retrieval.
   */
  const getAesKey = useCallback(async (): Promise<void> => {
    if (!address) {
      return;
    }

    // Clear previous local error before retrying
    setLocalError(null);

    try {
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
      setLocalError(message);
    }
  }, [address, pluginGetAesKey]);

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
   * When wallet type changes to MetaMask, set isCheckingSnap to true
   * to prevent premature redirect to /install while we check the snap.
   */
  useEffect(() => {
    if (
      (walletType === 'metamask-snap' || walletType === 'metamask-no-snap') &&
      aesKey === null &&
      address &&
      snapCheckDoneRef.current !== address
    ) {
      setIsCheckingSnap(true);
    }
  }, [walletType, aesKey, address]);

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
   * Auto-retrieve AES key from snap when MetaMask is connected.
   *
   * Flow (mirrors examples/src/App.tsx pattern):
   * 1. Silently call 'has-aes-key' on the snap (no user prompt).
   * 2. If the snap holds a key, retrieve it via 'get-aes-key' which triggers
   *    the snap's confirmation dialog, then navigate to key management page.
   * 3. If the snap has no key or isn't installed, do nothing — onboard page shows.
   *
   * Triggers for both 'metamask-snap' and 'metamask-no-snap' because in local
   * development the snap detection can be unreliable. The has-aes-key call
   * will simply fail if the snap isn't actually installed.
   */
  useEffect(() => {
    if (
      (walletType !== 'metamask-snap' && walletType !== 'metamask-no-snap') ||
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
        // Silent check — 'has-aes-key' does NOT show a dialog.
        // If snap isn't installed, this will throw and we'll catch below.
        const hasKey = await invokeSnap({
          method: 'has-aes-key',
          params: {},
        });

        snapCheckDoneRef.current = address;

        if (hasKey) {
          // Snap has the key — retrieve it directly via 'get-aes-key'.
          // This triggers a MetaMask confirmation dialog for the user.
          const key = await invokeSnap({
            method: 'get-aes-key',
            params: {},
          });
          if (key && typeof key === 'string') {
            setAesKey(key);
            setShowOnboardModal(false);
          }
        }
        // If snap doesn't have the key, do nothing — onboard page will show
      } catch (error: unknown) {
        // Snap not installed or communication failed — user will see onboard page
        snapCheckDoneRef.current = address;
        if (import.meta.env.DEV) {
          console.warn('[AesKeyContext] snap check failed:', error);
        }
      } finally {
        setIsCheckingSnap(false);
      }
    };

    void checkAndRetrieve();
  }, [walletType, address, isConnected, aesKey, isOnboarding, invokeSnap]);

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
