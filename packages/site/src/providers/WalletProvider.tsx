import React from 'react';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@coti-io/coti-wallet-plugin';

import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

interface WalletProviderProps {
  children: React.ReactNode;
}

/**
 * Wallet provider for the site.
 *
 * Uses the plugin's shared `wagmiConfig` (same chains/connectors) but wraps
 * WagmiProvider with `reconnectOnMount={false}`.
 *
 * Why: by default wagmi silently reconnects to a previously-authorized
 * connector (e.g. MetaMask) on page load. That bypasses the RainbowKit wallet
 * picker and auto-triggers the MetaMask/snap flow before the user chooses a
 * wallet. Disabling reconnectOnMount ensures the app starts disconnected so
 * the RainbowKit modal is always shown first, and the MetaMask flow only runs
 * after the user explicitly selects MetaMask.
 */
export function WalletProvider({ children }: WalletProviderProps) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
