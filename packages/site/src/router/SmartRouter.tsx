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
import { isMobile } from '../utils/isMobile';

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
  const { isConnected, connector } = useAccount();
  const { wrongChain } = useWrongChain();
  const { aesKey, walletType, setShowOnboardModal, isCheckingSnap } = useAesKey();
  const navigate = useNavigate();
  const [hasInitialized, setHasInitialized] = useState(false);
  const [, startTransition] = useTransition();

  // Determine if user connected with MetaMask based on wagmi connector
  const isMetaMaskConnector = (() => {
    const id = connector?.id?.toLowerCase() ?? '';
    return id.includes('metamask') || id.includes('io.metamask');
  })();

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

      // Connected, correct chain, MetaMask without Snap → /install (desktop only)
      // On mobile, snaps are not supported — skip install and go to contract onboarding.
      // Skip redirect while checking if snap actually has a key (detection can be slow)
      if (isMetaMaskConnector && walletType === 'metamask-no-snap' && !isCheckingSnap) {
        if (!isMobile) {
          navigate('/install', { replace: true });
          return;
        }
        // Mobile: fall through to /wallet where contract onboarding will handle it
      }

      // Connected, correct chain, non-MetaMask (or mobile MetaMask), no AES key → show OnboardModal
      if ((!isMetaMaskConnector || isMobile) && aesKey === null) {
        setShowOnboardModal(true);
      }

      // Connected, correct chain → navigate to /wallet if still on a
      // connect/install/network page. The /wallet page handles all states
      // (snap checking, onboarding, key management).
      if (
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
    isCheckingSnap,
    isMetaMaskConnector,
    navigate,
    setShowOnboardModal,
  ]);

  // Show loading only briefly while connector info is being determined
  // But don't block forever — after wagmi mounts, connector should resolve quickly
  if (!connector && isConnected && !hasInitialized) {
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
