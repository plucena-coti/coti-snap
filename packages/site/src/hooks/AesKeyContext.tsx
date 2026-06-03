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
  const { provider: metaMaskProvider } = useMetaMaskContext();

  // AES key held in memory only — never persisted
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [showOnboardModal, setShowOnboardModal] = useState<boolean>(false);
  // Local error state to capture errors thrown by getAesKey calls
  const [localError, setLocalError] = useState<string | null>(null);
  // True while silently checking if the snap already has a stored AES key.
  // Only meaningful for MetaMask; set by the snap-check effect below.
  const [isCheckingSnap, setIsCheckingSnap] = useState<boolean>(false);
  // Track which address we've already checked to avoid repeated checks
  const snapCheckDoneRef = useRef<string | null>(null);

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
  const resolveCotiChainId = useCallback((): number => {
    const COTI_MAINNET_ID = 2632500;
    const COTI_TESTNET_ID = 7082400;
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
  const isCotiSnapInstalled = useCallback(async (): Promise<boolean> => {
    try {
      if (!metaMaskProvider?.request) {
        console.log('[AesKeyContext] isCotiSnapInstalled: no MetaMask provider');
        return false;
      }
      const snaps = (await metaMaskProvider.request({
        method: 'wallet_getSnaps',
      })) as Record<string, unknown>;

      if (!snaps || typeof snaps !== 'object') {
        return false;
      }

      const ids = Object.keys(snaps);
      const found =
        ids.includes(defaultSnapOrigin) ||
        ids.some((id) => id.startsWith('local:') || id.includes('coti-snap'));

      console.log(
        '[AesKeyContext] isCotiSnapInstalled:',
        found,
        '| installed ids:',
        ids,
        '| looking for:',
        defaultSnapOrigin,
      );
      return found;
    } catch (error) {
      console.warn('[AesKeyContext] isCotiSnapInstalled failed:', error);
      return false;
    }
  }, [metaMaskProvider]);

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
        // Snap is installed — check if it holds the key (silent), then retrieve
        const hasKey = await invokeSnap({
          method: 'has-aes-key',
          params: { chainId: cotiChainId },
        });
        console.log('[AesKeyContext] getAesKey: has-aes-key =', hasKey);

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
        // Snap installed but has no key — onboard via contract, then PERSIST
        // the key to the snap so future loads retrieve it directly.
        console.log('[AesKeyContext] getAesKey: snap has no key, onboarding via contract');
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
            console.log('[AesKeyContext] getAesKey: storing key in snap via set-aes-key...');
            const stored = await invokeSnap({
              method: 'set-aes-key',
              params: { newUserAesKey: key, chainId: cotiChainId },
            });
            console.log('[AesKeyContext] getAesKey: set-aes-key result =', stored);

            // Verify it was stored
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
      snapCheckDoneRef.current = null;
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
        const installed = await isCotiSnapInstalled();
        console.log('[AesKeyContext] auto-check: snap installed =', installed);

        snapCheckDoneRef.current = address;

        if (installed) {
          const cotiChainId = resolveCotiChainId();
          console.log('[AesKeyContext] auto-check: using cotiChainId =', cotiChainId);

          const hasKey = await invokeSnap({
            method: 'has-aes-key',
            params: { chainId: cotiChainId },
          });
          console.log('[AesKeyContext] auto-check: has-aes-key =', hasKey);

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
              setAesKey(key);
              setShowOnboardModal(false);
            }
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
  }, [address, isConnected, aesKey, isOnboarding, isCotiSnapInstalled, invokeSnap, resolveCotiChainId]);

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
