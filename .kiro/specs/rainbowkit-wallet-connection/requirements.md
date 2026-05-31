# Requirements Document

## Introduction

Migrate the `/connect` page in `packages/site` from its current MetaMask-only Snap-based wallet connection to use the `@coti-io/coti-wallet-plugin` library. This enables multi-wallet connection via RainbowKit, AES key retrieval from any supported wallet (MetaMask via Snap, others via the COTI Onboarding Contract), and a simplified onboarding flow using the plugin's built-in components and hooks.

## Glossary

- **Site**: The frontend application located at `packages/site` that provides the COTI dApp user interface
- **Plugin**: The `@coti-io/coti-wallet-plugin` library that provides RainbowKit integration, wallet type detection, and AES key management
- **RainbowKit**: A React library that provides a wallet connection modal supporting multiple wallet providers (MetaMask, Coinbase Wallet, WalletConnect, Rainbow)
- **AES_Key**: A symmetric encryption key used for confidential transactions on the COTI network, stored only in memory
- **Snap**: A MetaMask extension (the COTI Snap) that manages AES key lifecycle for MetaMask users
- **Onboard_Contract**: The COTI Onboarding Contract that generates or recovers AES keys for non-MetaMask wallets via `generateOrRecoverAes()`
- **WagmiRainbowKitProvider**: A Plugin component that wraps wagmi, QueryClient, and RainbowKitProvider with COTI chain configurations and multi-wallet connectors
- **Wallet_Type_Info**: An object returned by the Plugin's `useWalletType()` hook that identifies the connected wallet type and whether MetaMask has the Snap installed
- **SmartRouter**: The Site component that handles route-based navigation and guards based on connection, network, and onboarding state
- **ConnectButton**: A RainbowKit component that renders a wallet picker button allowing users to select and connect any supported wallet

## Requirements

### Requirement 1: Multi-Wallet Provider Integration

**User Story:** As a developer, I want to replace the current MetaMask-only wagmi configuration with the Plugin's WagmiRainbowKitProvider, so that the Site supports connections from multiple wallet providers.

#### Acceptance Criteria

1. WHEN the Site application initializes, THE WagmiRainbowKitProvider SHALL wrap the application component tree providing wagmi, QueryClient, and RainbowKit context
2. WHEN the WagmiRainbowKitProvider is configured, THE Site SHALL support connections from MetaMask, Coinbase Wallet, WalletConnect, and Rainbow wallet providers
3. WHEN the WagmiRainbowKitProvider is configured, THE Site SHALL define COTI Mainnet (chain ID 2632500) and COTI Testnet (chain ID 7082400) as the supported chains
4. WHEN the provider hierarchy is established, THE Site SHALL remove the existing standalone WagmiProvider, QueryClientProvider, and MetaMaskProvider from `main.tsx`
5. WHEN the Plugin is configured, THE Site SHALL call `configureCotiPlugin()` with the correct snap ID and default network at application startup

### Requirement 2: Wallet Connection User Interface

**User Story:** As a user, I want to see a wallet picker on the connect page, so that I can connect with my preferred wallet rather than being limited to MetaMask.

#### Acceptance Criteria

1. WHEN a user navigates to the `/connect` page, THE Site SHALL display a RainbowKit ConnectButton or trigger the RainbowKit connect modal
2. WHEN the wallet picker modal is open, THE Site SHALL present all configured wallet options (MetaMask, Coinbase Wallet, WalletConnect, Rainbow)
3. WHEN a user selects a wallet and completes the connection, THE Site SHALL navigate the user to the appropriate next step based on connection and network state
4. WHEN a user disconnects their wallet, THE Site SHALL return the user to the `/connect` page and clear all session state including the in-memory AES_Key

### Requirement 3: Wallet Type Detection

**User Story:** As a developer, I want the system to detect which wallet is connected and whether MetaMask has the Snap installed, so that the correct AES key retrieval path is used.

#### Acceptance Criteria

1. WHEN a wallet connects, THE Site SHALL use the Plugin's `useWalletType()` hook to determine the Wallet_Type_Info
2. WHEN the connected wallet is MetaMask with the Snap installed, THE Wallet_Type_Info SHALL indicate MetaMask-Snap mode
3. WHEN the connected wallet is MetaMask without the Snap installed, THE Wallet_Type_Info SHALL indicate MetaMask-no-Snap mode
4. WHEN the connected wallet is not MetaMask (Coinbase, WalletConnect, Rainbow), THE Wallet_Type_Info SHALL indicate non-MetaMask mode

### Requirement 4: AES Key Retrieval Routing

**User Story:** As a user, I want my AES key to be retrieved using the appropriate method for my wallet type, so that I can use confidential transactions regardless of which wallet I connected with.

#### Acceptance Criteria

1. WHEN the Wallet_Type_Info indicates MetaMask-Snap mode, THE Plugin's `useAesKeyProvider` hook SHALL retrieve the AES_Key via the Snap RPC interface
2. WHEN the Wallet_Type_Info indicates non-MetaMask mode, THE Plugin's `useAesKeyProvider` hook SHALL retrieve the AES_Key via the Onboard_Contract's `generateOrRecoverAes()` function
3. WHEN the AES_Key is successfully retrieved by any method, THE Site SHALL store the AES_Key in memory only and make it available to token management, bridge, and decrypt features
4. IF the AES_Key retrieval fails, THEN THE Site SHALL display an error message and allow the user to retry the operation
5. THE Site SHALL hold the AES_Key in memory only and never persist the AES_Key to localStorage or any other persistent storage

### Requirement 5: Onboarding Flow for Non-MetaMask Wallets

**User Story:** As a non-MetaMask user, I want a clear onboarding experience that explains the signature required to generate my AES key, so that I understand what I am approving.

#### Acceptance Criteria

1. WHEN a non-MetaMask wallet connects and the user has not completed onboarding, THE Site SHALL display the Plugin's OnboardModal component
2. WHEN the OnboardModal is displayed, THE OnboardModal SHALL explain the onboarding signature purpose to the user before requesting the signature
3. WHEN the user completes the onboarding signature via the Onboard_Contract, THE Site SHALL retrieve the AES_Key and navigate to the wallet management page
4. WHEN the user dismisses or cancels the OnboardModal, THE Site SHALL remain on the current page without retrieving the AES_Key

### Requirement 6: MetaMask Snap Backward Compatibility

**User Story:** As a MetaMask user, I want the Snap-based AES key flow to continue working as before, so that my existing workflow is not disrupted by the multi-wallet migration.

#### Acceptance Criteria

1. WHEN a MetaMask user connects and the Snap is already installed, THE Site SHALL retrieve the AES_Key via the Snap without requiring additional onboarding steps
2. WHEN a MetaMask user connects and the Snap is not installed, THE Site SHALL prompt the user to install the Snap before proceeding with AES key retrieval
3. WHEN the Snap is used for AES key operations, THE Site SHALL support the existing Snap RPC methods (`has-aes-key`, `get-aes-key`, `set-aes-key`, `delete-aes-key`)
4. THE Site SHALL not modify the `packages/snap` package as part of this migration

### Requirement 7: Router and Navigation Simplification

**User Story:** As a developer, I want to simplify the router by removing MetaMask-specific route guards and the `/install` route, so that the navigation flow works for all wallet types.

#### Acceptance Criteria

1. WHEN the Site router is configured, THE SmartRouter SHALL use wagmi's `useAccount` hook for connection state detection instead of MetaMask-specific provider checks
2. WHEN a user is connected and on the correct network, THE SmartRouter SHALL navigate directly to the wallet management page without requiring a separate snap installation step for non-MetaMask wallets
3. WHEN a MetaMask user without the Snap connects, THE SmartRouter SHALL route to a snap installation prompt specific to MetaMask users only
4. THE Site SHALL remove the "Install MetaMask" fallback screen from the SmartRouter since non-MetaMask wallets are now supported
5. THE Site SHALL remove the mobile-only restriction message or update it to reflect multi-wallet support capabilities

### Requirement 8: Dependency and Configuration Management

**User Story:** As a developer, I want the project dependencies updated to include the Plugin and RainbowKit, so that the new wallet connection infrastructure is properly configured.

#### Acceptance Criteria

1. WHEN the Site package.json is updated, THE Site SHALL include `@coti-io/coti-wallet-plugin` as a dependency referenced via `file:../../coti-wallet-plugin` or the published package name
2. WHEN the Site package.json is updated, THE Site SHALL include `@rainbow-me/rainbowkit` as a dependency (required peer dependency of the Plugin)
3. WHEN the existing MetaMaskContext and MetaMaskProvider are replaced, THE Site SHALL remove unused MetaMask-specific utility files (`utils/metamask.ts`, `hooks/useInvokeSnap.ts`, `hooks/useRequestSnap.ts`, `hooks/useRequest.ts`)
4. WHEN the Plugin is integrated, THE Site SHALL import RainbowKit's CSS stylesheet for proper modal styling
