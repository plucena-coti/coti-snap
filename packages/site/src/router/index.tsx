import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAccount } from 'wagmi';

import { SmartRouter } from './SmartRouter.js';
import {
  ConnectPage,
  ContentManageAESKey,
  ContentSwitchNetwork,
} from '../components';
import { ContentInstallAESKeyManager } from '../components/ContentInstallAESKeyManager';
import { PermissionGuard } from '../components/PermissionGuard';
import { useWrongChain } from '../hooks';
import { useAesKey } from '../hooks/AesKeyContext';

/**
 * Redirects to /connect if the user is not connected.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <Navigate to="/connect" replace />;
  }

  return <>{children}</>;
}

/**
 * Redirects to /network if the user is on the wrong chain.
 */
function NetworkProtectedRoute({ children }: { children: React.ReactNode }) {
  const { wrongChain } = useWrongChain();

  if (wrongChain) {
    return <Navigate to="/network" replace />;
  }

  return <>{children}</>;
}

/**
 * Guards the /install route — only accessible when walletType is 'metamask-no-snap'.
 * Redirects to /wallet otherwise.
 */
function InstallGuard({ children }: { children: React.ReactNode }) {
  const { walletType } = useAesKey();

  if (walletType !== 'metamask-no-snap') {
    return <Navigate to="/wallet" replace />;
  }

  return <>{children}</>;
}

/**
 * Dashboard page — renders the AES key management UI.
 */
function Dashboard() {
  const { aesKey } = useAesKey();

  return (
    <PermissionGuard>
      <ContentManageAESKey
        userHasAESKey={aesKey !== null}
        userAESKey={aesKey}
      />
    </PermissionGuard>
  );
}

/**
 * Token management page — renders the AES key management UI for tokens.
 */
function TokenManagement() {
  const { aesKey } = useAesKey();

  return (
    <PermissionGuard>
      <ContentManageAESKey
        userHasAESKey={aesKey !== null}
        userAESKey={aesKey}
      />
    </PermissionGuard>
  );
}

/**
 * Root redirect — navigates to the appropriate route based on connection,
 * network, and AES key state.
 */
function RootRedirect() {
  const { isConnected } = useAccount();
  const { wrongChain } = useWrongChain();
  const { walletType } = useAesKey();

  if (!isConnected) {
    return <Navigate to="/connect" replace />;
  }

  if (wrongChain) {
    return <Navigate to="/network" replace />;
  }

  if (walletType === 'metamask-no-snap') {
    return <Navigate to="/install" replace />;
  }

  return <Navigate to="/wallet" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <SmartRouter />,
    children: [
      {
        index: true,
        element: <RootRedirect />,
      },
      {
        path: 'connect',
        element: <ConnectPage />,
      },
      {
        path: 'network',
        element: (
          <ProtectedRoute>
            <ContentSwitchNetwork />
          </ProtectedRoute>
        ),
      },
      {
        path: 'install',
        element: (
          <ProtectedRoute>
            <NetworkProtectedRoute>
              <InstallGuard>
                <ContentInstallAESKeyManager />
              </InstallGuard>
            </NetworkProtectedRoute>
          </ProtectedRoute>
        ),
      },
      {
        path: 'wallet',
        element: (
          <ProtectedRoute>
            <NetworkProtectedRoute>
              <Dashboard />
            </NetworkProtectedRoute>
          </ProtectedRoute>
        ),
      },
      {
        path: 'tokens',
        element: (
          <ProtectedRoute>
            <NetworkProtectedRoute>
              <TokenManagement />
            </NetworkProtectedRoute>
          </ProtectedRoute>
        ),
      },
    ],
  },
]);
