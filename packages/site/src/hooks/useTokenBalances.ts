import type { BrowserProvider } from '@coti-io/coti-ethers';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAccount } from 'wagmi';
import { usePrivateTokenBalance } from '@coti-io/coti-wallet-plugin';

import { useTokenOperations } from './useTokenOperations';
import type { ImportedToken } from '../types/token';

type UseTokenBalancesProps = {
  tokens: ImportedToken[];
  provider: BrowserProvider;
  aesKey?: string | null;
  cotiBalance?: string;
};

export const useTokenBalances = ({
  tokens,
  provider,
  aesKey,
  cotiBalance,
}: UseTokenBalancesProps) => {
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const { decryptERC20Balance } = useTokenOperations(provider);
  const { fetchPrivateBalance } = usePrivateTokenBalance();
  const { address } = useAccount();
  const abortControllerRef = useRef<AbortController | null>(null);

  const tokenAddresses = useMemo(
    () => tokens.map((token) => token.address).join(','),
    [tokens],
  );

  const fetchBalances = useCallback(async () => {
    if (tokens.length === 0) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    setIsLoading(true);
    const newBalances: Record<string, string> = {};

    try {
      if (cotiBalance) {
        newBalances.COTI = cotiBalance;
      }

      const batchSize = 3;
      for (let i = 0; i < tokens.length; i += batchSize) {
        if (signal.aborted) {
          return;
        }

        const batch = tokens.slice(i, i + batchSize);
        const batchPromises = batch.map(async (token) => {
          if (token.address && token.symbol !== 'COTI') {
            try {
              // Private tokens: use the plugin's fetchPrivateBalance which
              // correctly decrypts with the raw AES key via @coti-io/coti-sdk-typescript.
              // Public tokens: use the site's decryptERC20Balance.
              if (token.isPrivate && aesKey && address) {
                const balance = await fetchPrivateBalance(
                  address,
                  aesKey,
                  token.address,
                  256, // All private tokens on COTI use 256-bit version
                  token.decimals ?? 18,
                );
                return { address: token.address, balance };
              }

              const balance = await decryptERC20Balance(
                token.address,
                aesKey || undefined,
                token.decimals,
              );
              return { address: token.address, balance: balance.toString() };
            } catch (error) {
              console.error(`[TokenBalances] Error fetching balance for ${token.address} (${token.symbol}):`, error);
              return { address: token.address, balance: '0' };
            }
          }
          return null;
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach((result) => {
          if (result) {
            newBalances[result.address] = result.balance;
          }
        });

        if (i + batchSize < tokens.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      if (!signal.aborted) {
        setBalances(newBalances);
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error('[TokenBalances] Unexpected error in fetchBalances:', error);
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [tokenAddresses, aesKey, cotiBalance, decryptERC20Balance, tokens]);

  useEffect(() => {
    fetchBalances();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchBalances]);

  return {
    balances,
    isLoading,
    refetch: fetchBalances,
  };
};
