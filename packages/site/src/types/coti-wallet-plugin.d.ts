/**
 * Ambient type declarations for @coti-io/coti-wallet-plugin
 * This file provides TypeScript types until the plugin publishes its own .d.ts
 */
declare module '@coti-io/coti-wallet-plugin' {
  import type { ReactNode } from 'react';

  // Configuration
  export interface CotiPluginConfig {
    snapId?: string;
    defaultNetworkId?: number;
  }

  export function configureCotiPlugin(config?: CotiPluginConfig): void;
  export function getPluginConfig(): CotiPluginConfig;

  // Chain definitions
  export const cotiMainnet: any;
  export const cotiTestnet: any;
  export const COTI_MAINNET_CHAIN_ID: number;
  export const COTI_TESTNET_CHAIN_ID: number;
  export const COTI_MAINNET_RPC: string;
  export const COTI_TESTNET_RPC: string;
  export function getRpcUrlForChainId(chainId: number): string;

  // Contracts
  export const CONTRACT_ADDRESSES: Record<string, any>;
  export const SUPPORTED_TOKENS: any[];
  export const MINIMUM_PORTAL_IN_AMOUNTS: Record<string, any>;
  export const ERC20_ABI: any[];
  export interface TokenConfig {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  }
  export const TOKEN_ABI: any[];
  export const BRIDGE_ABI: any[];
  export const BRIDGE_ERC20_ABI: any[];
  export const COTI_PRICE_CONSUMER_ABI: any[];
  export const LIMITS: Record<string, any>;

  // Hooks — Key & Onboarding Manager
  export function useSnap(): any;
  export function signIT256ViaSnap(params: any): Promise<any>;
  export function onboardUser(params: any): Promise<any>;
  export function useMetamask(): any;

  // Hooks — Unified Wallet Abstraction
  export interface UseWalletResult {
    walletType: WalletType;
    aesKey: string | null;
    isOnboarding: boolean;
    onboardingError: string | null;
    getAesKey: () => Promise<void>;
    clearAesKey: () => void;
  }
  export function useWallet(): UseWalletResult;

  // Hooks — Balance Manager
  export function usePrivateERC20(params?: any): any;
  export function useFetchPrivateBalance(params?: any): any;
  export function usePrivateTokenBalance(params?: any): any;
  export function useBalanceUpdater(params?: any): any;

  // Hooks — Bridge Operations
  export interface Token {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    isPrivate?: boolean;
  }
  export type SwapProgressStage = string;
  export function usePrivacyBridge(params?: any): any;
  export function getInitialPublicTokens(chainId?: number): Token[];
  export function getInitialPrivateTokens(chainId?: number): Token[];

  export interface BridgeData {
    [key: string]: any;
  }
  export function useBridgeData(): BridgeData;

  export interface BridgeStatus {
    [key: string]: any;
  }
  export function useBridgeStatus(): BridgeStatus;

  export interface FeeEstimate {
    [key: string]: any;
  }
  export function estimateBridgeFee(params: any): Promise<FeeEstimate>;

  export interface BridgeFees {
    [key: string]: any;
  }
  export interface SimulationResult {
    [key: string]: any;
  }
  export function fetchBridgeFees(params: any): Promise<BridgeFees>;
  export function fetchTokenUsdPrice(params: any): Promise<number>;
  export function computeCotiFee(params: any): any;
  export function computeErc20Fee(params: any): any;
  export function simulateFeeOnChain(params: any): Promise<SimulationResult>;
  export function getTokenSimulationMeta(params: any): any;
  export function getBridgeRpcUrl(chainId: number): string;

  // Hooks — Network
  export interface NetworkEnforcerResult {
    isCorrectNetwork: boolean;
    switchNetwork: () => Promise<void>;
  }
  export function useNetworkEnforcer(): NetworkEnforcerResult;

  // Context
  export function PrivacyBridgeProvider(props: { children: ReactNode }): JSX.Element;
  export function usePrivacyBridgeContext(): any;

  // Providers — Multi-Wallet Support
  export function WagmiRainbowKitProvider(props: { children: ReactNode }): JSX.Element;
  export const wagmiConfig: any;

  // Hooks — Wallet Type Detection
  export type WalletType = 'metamask-snap' | 'metamask-no-snap' | 'non-metamask' | 'metamask' | null;
  export interface WalletTypeInfo {
    walletType: WalletType;
    isMetaMask: boolean;
    hasSnap: boolean;
    isMetaMaskWithSnap?: boolean;
    connectorId?: string | null;
  }
  export function useWalletType(): WalletTypeInfo;

  // Hooks — AES Key Provider Abstraction
  export interface AesKeyProviderResult {
    aesKey: string | null;
    isOnboarding: boolean;
    onboardingError: string | null;
    getAesKey: (address?: string) => Promise<string | null>;
    clearAesKey: () => void;
  }
  export function useAesKeyProvider(walletTypeInfo?: WalletTypeInfo): AesKeyProviderResult;

  // Components — Onboarding
  export interface OnboardModalProps {
    open?: boolean;
    isOpen?: boolean;
    onConfirm?: () => void | Promise<void>;
    onClose?: () => void;
    error?: string | null;
    isLoading?: boolean;
    walletType?: string | null;
    sessionAesKey?: string | null;
  }
  export function OnboardModal(props: OnboardModalProps): JSX.Element;

  // Re-export from RainbowKit
  export function useConnectModal(): { openConnectModal: () => void };

  // Utilities
  export function isMultipleWalletsError(error: unknown): boolean;
  export const MULTIPLE_WALLETS_ERROR_SUBSTRING: string;
  export function formatTokenBalanceDisplay(value: string, decimals?: number): string;
  export function truncateDecimalValue(value: string, maxDecimals?: number): string;
  export function formatBalanceWithNotation(value: string): string;
  export function addThousandsSeparators(value: string): string;

  // Hooks — Protocol Price
  export interface TokenPriceMap {
    [address: string]: number;
  }
  export interface UseTokenPricesReturn {
    prices: TokenPriceMap;
    isLoading: boolean;
    error: string | null;
  }
  export function useTokenPrices(addresses?: string[]): UseTokenPricesReturn;
}
