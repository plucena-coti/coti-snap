/**
 * Wrapper for wagmi/connectors that re-exports everything from the real
 * @wagmi/connectors plus a stub `porto` export.
 * 
 * RainbowKit 2.2.11 imports { porto } from "wagmi/connectors" but
 * wagmi 2.16.5 / @wagmi/connectors 5.9.5 doesn't export it.
 * The portoWallet is not used in our connector list, so a no-op is safe.
 */
export * from '@wagmi/connectors';

export function porto() {
  return () => ({
    id: 'porto',
    name: 'Porto',
    type: 'porto',
  });
}
