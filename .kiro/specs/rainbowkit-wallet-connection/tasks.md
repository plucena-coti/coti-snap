# Implementation Plan

## Overview

Migrate the `packages/site` frontend from MetaMask-only Snap-based wallet connection to a multi-wallet architecture using `@coti-io/coti-wallet-plugin` and RainbowKit. This involves replacing the provider hierarchy, creating a new AesKeyContext, updating routing/navigation, and removing deprecated MetaMask-specific files.

## Tasks

- [x] 1. Update `packages/site/package.json` to add `"@coti-io/coti-wallet-plugin": "file:../../coti-wallet-plugin"` and `"@rainbow-me/rainbowkit"` as dependencies, then run `yarn install` from the workspace root
  - [x] 1.1 Add `"@coti-io/coti-wallet-plugin": "file:../../coti-wallet-plugin"` to the `dependencies` section
  - [x] 1.2 Add `"@rainbow-me/rainbowkit": "^2.2.0"` to the `dependencies` section
  - [x] 1.3 Run `yarn install` from the workspace root to resolve new dependencies
  - [x] 1.4 Verify both packages resolve correctly in `node_modules`

- [x] 2. Create `packages/site/src/hooks/AesKeyContext.tsx` implementing the AesKeyProvider that wraps the plugin's `useWalletType()` and `useAesKeyProvider()` hooks
  - [x] 2.1 Define the `AesKeyContextValue` interface with fields: `aesKey`, `isOnboarding`, `onboardingError`, `walletType`, `getAesKey`, `clearAesKey`, `showOnboardModal`, `setShowOnboardModal`
  - [x] 2.2 Implement the `AesKeyProvider` component using `useWalletType()` and `useAesKeyProvider()` from `@coti-io/coti-wallet-plugin`
  - [x] 2.3 Add disconnect cleanup: watch `useAccount().isConnected` and clear AES key + reset state when it becomes `false`
  - [x] 2.4 Export a `useAesKey()` consumer hook

- [x] 3. Update `packages/site/src/main.tsx` to replace the provider hierarchy with `WagmiRainbowKitProvider` and `AesKeyProvider`
  - [x] 3.1 Add `import '@rainbow-me/rainbowkit/styles.css'` at the top
  - [x] 3.2 Import `configureCotiPlugin` and `WagmiRainbowKitProvider` from `@coti-io/coti-wallet-plugin`
  - [x] 3.3 Call `configureCotiPlugin()` with snap ID and default network ID before the React render
  - [x] 3.4 Replace `WagmiProvider`, `QueryClientProvider`, `MetaMaskProvider`, `SnapProvider` with `WagmiRainbowKitProvider` wrapping `AesKeyProvider`
  - [x] 3.5 Remove unused imports (`WagmiProvider`, `QueryClientProvider`, `config` from wagmi.js, `MetaMaskProvider`, `SnapProvider`) and the `queryClient` instantiation

- [x] 4. Create `packages/site/src/components/ConnectPage.tsx` that renders RainbowKit's `ConnectButton` and replace `ContentConnectYourWallet` in the router
  - [x] 4.1 Create the component importing `ConnectButton` from `@rainbow-me/rainbowkit`
  - [x] 4.2 Style it to match existing layout using `ContentBorderWrapper` and `ContentContainer`
  - [x] 4.3 Update `packages/site/src/router/index.tsx` to use `ConnectPage` for the `/connect` route
  - [x] 4.4 Update `packages/site/src/components/index.ts` exports

- [x] 5. Create `packages/site/src/components/OnboardingWrapper.tsx` that shows the plugin's `OnboardModal` for non-MetaMask wallets needing AES key onboarding
  - [x] 5.1 Import `OnboardModal` from `@coti-io/coti-wallet-plugin` and consume `useAesKey()` context
  - [x] 5.2 Show the modal when `walletType === 'non-metamask'` and `aesKey === null`
  - [x] 5.3 Wire `onConfirm` to `getAesKey()` and `onClose` to `setShowOnboardModal(false)`
  - [x] 5.4 Render children alongside the modal overlay

- [x] 6. Update `packages/site/src/router/SmartRouter.tsx` to remove MetaMask-specific checks and use wallet-type-aware routing from `useAesKey()`
  - [x] 6.1 Remove imports of `useMetaMask` and `useSnap`; import `useAesKey` instead
  - [x] 6.2 Replace `installedSnap`/`snapsDetected`/`hasCheckedForProvider` logic with `walletType` and `aesKey` from context
  - [x] 6.3 Update navigation: route to `/install` only when `walletType === 'metamask-no-snap'`; show onboarding for non-MetaMask without AES key; otherwise route to `/wallet`
  - [x] 6.4 Remove the "Install MetaMask" fallback screen
  - [x] 6.5 Remove or update the mobile-only restriction message to reflect multi-wallet support

- [x] 7. Update `packages/site/src/router/index.tsx` to replace `SnapProtectedRoute` and `InstallProtectedRoute` with `AesKeyProtectedRoute`
  - [x] 7.1 Create `AesKeyProtectedRoute` that checks `aesKey !== null` from `useAesKey()`, redirecting to `/connect` if null
  - [x] 7.2 Remove `SnapProtectedRoute` and `InstallProtectedRoute` components
  - [x] 7.3 Update `/wallet` and `/tokens` routes to use `AesKeyProtectedRoute`
  - [x] 7.4 Update `/install` route guard to only be accessible when `walletType === 'metamask-no-snap'`
  - [x] 7.5 Update `RootRedirect`, `Dashboard`, and `TokenManagement` to use `useAesKey()` instead of `useMetaMask()`/`useSnap()`

- [x] 8. Update the Header component to replace the custom connect button with RainbowKit's `ConnectButton`
  - [x] 8.1 Import `ConnectButton` from `@rainbow-me/rainbowkit` in the Header
  - [x] 8.2 Replace the existing custom wallet button with `<ConnectButton />`
  - [x] 8.3 Remove MetaMask-specific connection logic from the Header
  - [x] 8.4 Adjust styling for integration (use `ConnectButton.Custom` if needed)

- [x] 9. Update `packages/site/src/components/ContentInstallAESKeyManager.tsx` to use plugin hooks instead of removed local hooks
  - [x] 9.1 Replace imports of local snap hooks with plugin equivalents from `@coti-io/coti-wallet-plugin`
  - [x] 9.2 After successful Snap install and AES key retrieval, update `AesKeyContext` via `getAesKey()`
  - [x] 9.3 Verify the component navigates to `/wallet` after successful installation

- [x] 10. Remove deprecated files no longer needed after migration
  - [x] 10.1 Delete `packages/site/src/hooks/MetamaskContext.tsx`
  - [x] 10.2 Delete `packages/site/src/hooks/useMetaMask.ts`
  - [x] 10.3 Delete `packages/site/src/hooks/useInvokeSnap.ts`
  - [x] 10.4 Delete `packages/site/src/hooks/useRequestSnap.ts`
  - [x] 10.5 Delete `packages/site/src/hooks/useRequest.ts`
  - [x] 10.6 Delete `packages/site/src/hooks/SnapContext.tsx`
  - [x] 10.7 Delete `packages/site/src/config/wagmi.ts` (keep chain constants if referenced elsewhere)
  - [x] 10.8 Delete `packages/site/src/components/ContentConnectYourWallet.tsx`
  - [x] 10.9 Update `packages/site/src/hooks/index.ts` to remove exports for all deleted hooks

- [x] 11. Implement error handling and retry logic for AES key retrieval failures
  - [x] 11.1 Expose errors from `useAesKeyProvider()` via `onboardingError` in `AesKeyContext`
  - [x] 11.2 Display error messages in `OnboardingWrapper` / `OnboardModal`
  - [x] 11.3 Wire retry button to call `getAesKey()` again
  - [x] 11.4 Handle Snap errors in `ContentInstallAESKeyManager` with error display and retry

- [x] 12. Build verification and integration smoke test
  - [x] 12.1 Run `yarn build` from workspace root and verify no TypeScript or build errors
  - [x] 12.2 Verify the RainbowKit connect modal appears on `/connect`
  - [x] 12.3 Verify MetaMask connection routes correctly (to `/install` or `/wallet`)
  - [x] 12.4 Verify non-MetaMask wallet connection shows OnboardModal
  - [x] 12.5 Verify disconnect returns to `/connect` and clears all state
  - [x] 12.6 Verify Header shows RainbowKit ConnectButton with address/chain info when connected

## Task Dependencies

- Task 2 depends on Task 1
- Task 4 depends on Task 1
- Task 8 depends on Task 1
- Task 3 depends on Task 2
- Task 5 depends on Task 2
- Task 6 depends on Task 2
- Task 9 depends on Task 2
- Task 7 depends on Task 3, Task 5, Task 6
- Task 11 depends on Task 3, Task 5, Task 6
- Task 10 depends on Task 7, Task 11
- Task 12 depends on Task 10

## Notes

- The `@coti-io/coti-wallet-plugin` is referenced as a local file dependency (`file:../../coti-wallet-plugin`) since it lives adjacent to the snap workspace.
- The `packages/snap` package is NOT modified as part of this migration (Requirement 6.4).
- AES keys are held in memory only (React state) and never persisted to localStorage.
- Chain constants (COTI Mainnet 2632500, COTI Testnet 7082400) may need to be kept as local constants even after removing `config/wagmi.ts` if other components reference them.
- The `WalletConnectProjectId` should be sourced from `VITE_WALLETCONNECT_PROJECT_ID` environment variable.
