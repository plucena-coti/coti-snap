/**
 * Stub for the `porto` connector that RainbowKit 2.2.11 imports from
 * wagmi/connectors. Our wagmi 2.16.5 / @wagmi/connectors 5.9.5 doesn't
 * export it yet. Since we don't use portoWallet in our connector list,
 * exporting a no-op is safe.
 */
export function porto() {
  return () => ({
    id: 'porto',
    name: 'Porto',
    type: 'porto',
  });
}
