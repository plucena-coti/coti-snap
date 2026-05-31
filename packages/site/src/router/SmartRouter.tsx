import { useEffect, useState, useTransition } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { useAccount } from 'wagmi';

import { Header } from '../components';
import { Footer } from '../components/Footer';
import { Loading } from '../components/Loading';
import {
  ContentBorderWrapper,
  ContentContainer,
} from '../components/styles';
import { useWrongChain } from '../hooks';
import { useAesKey } from '../hooks/AesKeyContext';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  margin: auto;
  width: 564px;
  height: 100%;
  max-height: 100vh;
  max-height: calc(100vh - clamp(96px, 12vh, 120px));
  padding-bottom: clamp(96px, 12vh, 120px);
  gap: clamp(12px, 2vh, 24px);
  box-sizing: border-box;
  border-radius: 14px;
  background: transparent;
  ${({ theme }) => theme.mediaQueries.small} {
    width: 100%;
    padding: 0 1.6rem;
    padding-bottom: calc(clamp(96px, 12vh, 120px) + 1.6rem);
    margin: auto;
    max-width: 100vw;
    box-sizing: border-box;
  }

  @media screen and (max-width: 768px), screen and (max-height: 700px) {
    max-height: calc(100vh - clamp(96px, 12vh, 96px));
    padding-bottom: clamp(96px, 12vh, 96px);
  }
`;

/**
 * SmartRouter handles wallet-type-aware navigation routing.
 *
 * Navigation flow:
 * - Not connected → /connect
 * - Connected, wrong chain → /network
 * - Connected, correct chain, MetaMask without Snap → /install
 * - Connected, correct chain, non-MetaMask, no AES key → show OnboardModal
 * - Connected, correct chain, has AES key → /wallet
 */
export function SmartRouter() {
  const { isConnected } = useAccount();
  const { wrongChain } = useWrongChain();
  const { aesKey, walletType, setShowOnboardModal } = useAesKey();
  const navigate = useNavigate();
  const [hasInitialized, setHasInitialized] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasInitialized(true);
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasInitialized) {
      return;
    }

    const currentPath = window.location.pathname;
    const protectedRoutes = ['/wallet', '/tokens'];
    const isOnProtectedRoute = protectedRoutes.includes(currentPath);

    startTransition(() => {
      // Not connected → /connect
      if (!isConnected) {
        navigate('/connect', { replace: true });
        return;
      }

      // Connected, wrong chain → /network
      if (wrongChain) {
        navigate('/network', { replace: true });
        return;
      }

      // Connected, correct chain, MetaMask without Snap → /install
      if (walletType === 'metamask-no-snap') {
        navigate('/install', { replace: true });
        return;
      }

      // Connected, correct chain, non-MetaMask, no AES key → show OnboardModal
      if (walletType === 'non-metamask' && aesKey === null) {
        setShowOnboardModal(true);
        // Stay on current page; OnboardingWrapper will display the modal
        if (
          !isOnProtectedRoute &&
          currentPath !== '/wallet' &&
          currentPath !== '/connect'
        ) {
          navigate('/wallet', { replace: true });
        }
        return;
      }

      // Connected, correct chain, has AES key → /wallet
      if (
        aesKey !== null &&
        !isOnProtectedRoute &&
        (currentPath === '/' ||
          currentPath === '/connect' ||
          currentPath === '/network' ||
          currentPath === '/install')
      ) {
        navigate('/wallet', { replace: true });
      }
    });
  }, [
    hasInitialized,
    isConnected,
    wrongChain,
    walletType,
    aesKey,
    navigate,
    setShowOnboardModal,
  ]);

  // Show loading while wallet type is being determined
  if (walletType === null && isConnected) {
    return (
      <Container>
        <Header />
        <ContentBorderWrapper>
          <ContentContainer>
            <Loading title="Loading..." actionText="" />
          </ContentContainer>
        </ContentBorderWrapper>
        <Footer />
      </Container>
    );
  }

  return (
    <Container>
      <Header />
      <Outlet />
      <Footer />
    </Container>
  );
}
