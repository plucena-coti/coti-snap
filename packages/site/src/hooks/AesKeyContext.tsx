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
  useSnap,
} from '@coti-io/coti-wallet-plugin';
import type { WalletTypeInfo } from '@coti-io/coti-wallet-plugin';

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
  // Plugin's own snap hooks — these are the proven, working snap RPC calls
  // used internally by useAesKeyProvider. We use getAESKeyFromSnap directly
  // so we never accidentally fall through to the onboard contract when the
  // snap holds the key.
  const { getAESKeyFromSnap, isSnapInstalled } = useSnap();

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
   * Retrieves the AES key.
   *
   * Mirrors examples/src/App.tsx: calls the plugin's getAESKeyFromSnap(address)
   * which handles snap detection, connection, environment sync, and key
   * retrieval (with caching). If the snap is installed and holds the key, the
   * key is returned. Only when the snap is genuinely unavailable do we fall
   * back to the plugin's onboard-contract path via pluginGetAesKey.
   */
  const getAesKey = useCallback(async (): Promise<void> => {
    if (!address) {
      return;
    }

    setLocalError(null);

    try {
      // Check if the snap is installed (silent — wallet_getSnaps only)
      const installed = await isSnapInstalled();
      console.log('[AesKeyContext] getAesKey: isSnapInstalled =', installed);

      if (installed) {
        // Use the plugin's proven snap retrieval (handles connect + invoke)
        const snapKey = await getAESKeyFromSnap(address);
        console.log(
          '[AesKeyContext] getAesKey: getAESKeyFromSnap =',
          snapKey ? `key(${snapKey.length})` : 'null',
        );
        if (snapKey) {
          setAesKey(snapKey);
          setShowOnboardModal(false);
          return;
        }
        // Snap installed but returned null (user cancelled) — stop here,
        // do NOT fall through to the onboard contract.
        return;
      }

      // Snap not installed — use the plugin's provider (non-MetaMask wallets
      // route to the onboard contract here)
      console.log('[AesKeyContext] getAesKey: snap not installed, using pluginGetAesKey');
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
  }, [address, isSnapInstalled, getAESKeyFromSnap, pluginGetAesKey]);

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
   * Mirrors examples/src/App.tsx: if the snap is installed, retrieve the key
   * via the plugin's getAESKeyFromSnap. If the snap isn't installed, do
   * nothing — the onboard page will show.
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
        const installed = await isSnapInstalled();
        console.log('[AesKeyContext] auto-check: isSnapInstalled =', installed);

        snapCheckDoneRef.current = address;

        if (installed) {
          const key = await getAESKeyFromSnap(address);
          console.log(
            '[AesKeyContext] auto-check: getAESKeyFromSnap =',
            key ? `key(${key.length})` : 'null',
          );
          if (key) {
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
  }, [address, isConnected, aesKey, isOnboarding, isSnapInstalled, getAESKeyFromSnap]);

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
