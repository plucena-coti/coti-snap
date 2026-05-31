/**
 * Ambient type declarations for @rainbow-me/rainbowkit
 * This file provides TypeScript types until the package is properly installed
 */
declare module '@rainbow-me/rainbowkit' {
  import type { ReactNode } from 'react';

  export interface ConnectButtonProps {
    accountStatus?: 'full' | 'avatar' | 'address';
    chainStatus?: 'full' | 'icon' | 'name' | 'none';
    showBalance?: boolean;
    label?: string;
  }

  export interface ConnectButtonCustomProps {
    children: (props: {
      account?: {
        address: string;
        balanceDecimals?: number;
        balanceFormatted?: string;
        balanceSymbol?: string;
        displayBalance?: string;
        displayName: string;
        ensAvatar?: string;
        ensName?: string;
        hasPendingTransactions: boolean;
      };
      chain?: {
        hasIcon: boolean;
        iconUrl?: string;
        iconBackground?: string;
        id: number;
        name?: string;
        unsupported?: boolean;
      };
      openAccountModal: () => void;
      openChainModal: () => void;
      openConnectModal: () => void;
      accountModalOpen: boolean;
      chainModalOpen: boolean;
      connectModalOpen: boolean;
      mounted: boolean;
    }) => ReactNode;
  }

  export const ConnectButton: React.FC<ConnectButtonProps> & {
    Custom: React.FC<ConnectButtonCustomProps>;
  };

  export function useConnectModal(): {
    openConnectModal: (() => void) | undefined;
    connectModalOpen: boolean;
  };

  export function useAccountModal(): {
    openAccountModal: (() => void) | undefined;
    accountModalOpen: boolean;
  };

  export function useChainModal(): {
    openChainModal: (() => void) | undefined;
    chainModalOpen: boolean;
  };

  export interface RainbowKitProviderProps {
    children: ReactNode;
    theme?: any;
    locale?: string;
    showRecentTransactions?: boolean;
    appInfo?: {
      appName?: string;
      learnMoreUrl?: string;
    };
  }

  export function RainbowKitProvider(props: RainbowKitProviderProps): JSX.Element;

  export function getDefaultWallets(config: any): any;
  export function getDefaultConfig(config: any): any;
  export function darkTheme(config?: any): any;
  export function lightTheme(config?: any): any;
  export function midnightTheme(config?: any): any;
}

declare module '@rainbow-me/rainbowkit/styles.css' {
  const content: string;
  export default content;
}
