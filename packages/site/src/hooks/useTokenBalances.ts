import type { BrowserProvider } from '@coti-io/coti-ethers';
import { BrowserProvider as VanillaBrowserProvider, Contract, formatUnits } from 'ethers';
import type { Eip1193Provider } from 'ethers';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAccount, useConnectorClient } from 'wagmi';
import { decryptUint, decryptUint256 } from '@coti-io/coti-sdk-typescript';

import { useTokenOperations } from './useTokenOperations';
import type { ImportedToken } from '../types/token';

// --- Private balance decryption (local implementation) ---
// This replaces the plugin's usePrivateTokenBalance which internally does
// `new ethers.BrowserProvider(window.ethereum)`. That breaks when Coinbase
// wallet extension hijacks window.ethereum. Instead we use the wagmi
// connector-based BrowserProvider passed in from ContentManageToken.

/**
 * Known p.COTI addresses (testnet + mainnet) that use the legacy 64-bit
 * ciphertext format. All other private tokens use 256-bit.
 */
const PCOTI_ADDRESSES = new Set([
  '0x6ce8907414986e73de9e7d28d62ea2080f8e88e1', // testnet p.COTI
  '0xd2f2692b83c3ecdf2eaa0f7c2632bbd46ae1cc91', // mainnet p.COTI
]);

/** Nested 4-part ciphertext ABI (PoD pTokens) */
const NESTED_BALANCE_ABI = [
  'function balanceOf(address account) view returns (tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low))',
];

/** Flat 2-part ciphertext ABI (COTI native privacy tokens) */
const FLAT_BALANCE_ABI = [
  'function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))',
];

/** Legacy 64-bit ciphertext ABI (p.COTI) */
const LEGACY_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

/** Insanity threshold: 1e12 * 10^decimals — values above this indicate a bad key */
const INSANE_THRESHOLD_BASE = 1_000_000_000_000n;

function normalizeAesKey(aesKey: string): string {
  const trimmed = aesKey.startsWith('0x') ? aesKey.slice(2) : aesKey;
  return trimmed.toLowerCase();
}

function isInsane(value: bigint, decimals: number): boolean {
  const threshold = INSANE_THRESHOLD_BASE * 10n ** BigInt(decimals);
  return value > threshold;
}

/**
 * Fetches and decrypts a private token balance using a VANILLA ethers BrowserProvider.
 * 
 * IMPORTANT: We must NOT use @coti-io/coti-ethers's BrowserProvider here because
 * its custom JsonRpcSigner may auto-decrypt/modify return values from contract calls,
 * causing double-decryption and "insane" values. The plugin's usePrivateTokenBalance
 * also uses vanilla ethers.BrowserProvider — we replicate that behavior exactly.
 */
async function fetchPrivateBalanceLocal(
  eip1193Provider: Eip1193Provider,
  userAddress: string,
  aesKey: string,
  contractAddress: string,
  decimals: number = 18,
): Promise<string> {
  const normalizedKey = normalizeAesKey(aesKey);
  // Use VANILLA ethers BrowserProvider — NOT @coti-io/coti-ethers version
  const vanillaProvider = new VanillaBrowserProvider(eip1193Provider);
  const signer = await vanillaProvider.getSigner();
  const version = PCOTI_ADDRESSES.has(contractAddress.toLowerCase()) ? 64 : 256;

  if (version === 64) {
    const contract = new Contract(contractAddress, LEGACY_BALANCE_ABI, signer);
    const encrypted: bigint = await (contract as any)['balanceOf(address)'](userAddress);
    if (!encrypted || encrypted === 0n) return '0';

    console.log(`[TokenBalances] DEBUG ${contractAddress} (64-bit): encrypted=${encrypted.toString(16).slice(0,20)}..., key=${normalizedKey.slice(0,8)}...`);

    const decrypted = decryptUint(encrypted, normalizedKey);
    const value = typeof decrypted === 'bigint' ? decrypted : BigInt(decrypted);
    if (isInsane(value, decimals)) {
      console.warn(`[TokenBalances] Insane decrypted value for ${contractAddress} (64-bit): value=${value}, decimals=${decimals} — AES key mismatch?`);
      return '0';
    }
    return formatUnits(value, decimals);
  }

  // 256-bit: try nested 4-part ABI first, fall back to flat 2-part
  let encryptedBalance: any;
  let isNested = false;

  try {
    const nestedContract = new Contract(contractAddress, NESTED_BALANCE_ABI, signer);
    encryptedBalance = await (nestedContract as any).balanceOf(userAddress);

    const hasNestedShape =
      (encryptedBalance?.high?.high !== undefined && encryptedBalance?.high?.low !== undefined) ||
      (encryptedBalance?.[0]?.[0] !== undefined && encryptedBalance?.[0]?.[1] !== undefined);

    if (hasNestedShape) {
      isNested = true;
    } else {
      throw new Error('Not nested format');
    }
  } catch {
    // Fall back to flat 2-part ABI
    const flatContract = new Contract(contractAddress, FLAT_BALANCE_ABI, signer);
    encryptedBalance = await (flatContract as any).balanceOf(userAddress);
    isNested = false;
  }

  if (!encryptedBalance) return '0';

  if (isNested) {
    // Nested: { high: { high, low }, low: { high, low } }
    const hh = BigInt(encryptedBalance.high?.high ?? encryptedBalance[0]?.[0] ?? 0n);
    const hl = BigInt(encryptedBalance.high?.low ?? encryptedBalance[0]?.[1] ?? 0n);
    const lh = BigInt(encryptedBalance.low?.high ?? encryptedBalance[1]?.[0] ?? 0n);
    const ll = BigInt(encryptedBalance.low?.low ?? encryptedBalance[1]?.[1] ?? 0n);

    if (hh === 0n && hl === 0n && lh === 0n && ll === 0n) return '0';

    const d1 = BigInt(decryptUint(hh, normalizedKey));
    const d2 = BigInt(decryptUint(hl, normalizedKey));
    const d3 = BigInt(decryptUint(lh, normalizedKey));
    const d4 = BigInt(decryptUint(ll, normalizedKey));
    const decrypted = (d1 << 192n) + (d2 << 128n) + (d3 << 64n) + d4;

    if (isInsane(decrypted, decimals)) {
      console.warn(`[TokenBalances] Insane decrypted value for ${contractAddress} (256-nested) — AES key mismatch?`);
      return '0';
    }
    return formatUnits(decrypted, decimals);
  }

  // Flat: { ciphertextHigh, ciphertextLow }
  const ciphertextHigh = BigInt(encryptedBalance.ciphertextHigh ?? encryptedBalance[0] ?? 0n);
  const ciphertextLow = BigInt(encryptedBalance.ciphertextLow ?? encryptedBalance[1] ?? 0n);

  if (ciphertextHigh === 0n && ciphertextLow === 0n) return '0';

  const decrypted = decryptUint256({ ciphertextHigh, ciphertextLow }, normalizedKey);
  const value = typeof decrypted === 'bigint' ? decrypted : BigInt(decrypted);

  if (isInsane(value, decimals)) {
    console.warn(`[TokenBalances] Insane decrypted value for ${contractAddress} (256-flat) — AES key mismatch?`);
    return '0';
  }
  return formatUnits(value, decimals);
}

// --- Hook ---

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
  const { address } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get the raw EIP-1193 provider from wagmi connector for private balance calls.
  // We MUST use vanilla ethers BrowserProvider (not @coti-io/coti-ethers) to avoid
  // the custom signer's auto-decryption interfering with manual decryption.
  const rawEip1193Provider = useMemo((): Eip1193Provider | null => {
    if (connectorClient?.transport) {
      return connectorClient.transport as unknown as Eip1193Provider;
    }
    // Fallback: extract the underlying EIP-1193 provider from the @coti-io/coti-ethers
    // BrowserProvider that was passed to us. The _getConnection() internal might not
    // be accessible, so just use window.ethereum as last resort.
    if (typeof window !== 'undefined' && window.ethereum) {
      return window.ethereum as unknown as Eip1193Provider;
    }
    return null;
  }, [connectorClient]);

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
              // Private tokens: decrypt locally using a VANILLA ethers BrowserProvider.
              // We must NOT use @coti-io/coti-ethers's BrowserProvider because its
              // custom JsonRpcSigner auto-decrypts return values, causing double-decryption.
              if (token.isPrivate && aesKey && address && rawEip1193Provider) {
                const balance = await fetchPrivateBalanceLocal(
                  rawEip1193Provider,
                  address,
                  aesKey,
                  token.address,
                  token.decimals ?? 18,
                );
                return { address: token.address, balance };
              }

              if (token.isPrivate && (!aesKey || !rawEip1193Provider)) {
                console.warn(`[TokenBalances] Skipping private token ${token.symbol}: aesKey=${!!aesKey}, provider=${!!rawEip1193Provider}`);
                return { address: token.address, balance: '0' };
              }

              // Public tokens: use the site's decryptERC20Balance
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
  }, [tokenAddresses, aesKey, cotiBalance, decryptERC20Balance, tokens, provider, address, rawEip1193Provider]);

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
