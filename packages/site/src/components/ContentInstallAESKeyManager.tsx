import { useCallback, useState, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { useSnap } from '@coti-io/coti-wallet-plugin';

import { ButtonAction } from './Button';
import {
  ContentBorderWrapper,
  ContentContainer,
  ContentTextInstall,
  ContentTitle,
} from './styles';
import Metamask from '../assets/metamask_fox.svg';
import SpinnerIcon from '../assets/spinner.png';
import { useAesKey } from '../hooks/AesKeyContext';

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const SpinnerImage = styled.img`
  width: 20px;
  height: 20px;
  animation: ${spin} 1s linear infinite;
`;

const InfoBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #1e29f6;
  border-radius: 12px;
  padding: 16px;
`;

const InfoIcon = styled.span`
  font-size: 16px;
  line-height: 1.4;
  flex-shrink: 0;
`;

const InfoContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const InfoTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: #fff;
`;

const InfoText = styled.span`
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
`;

const ErrorBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 12px;
  padding: 16px;
`;

const ErrorIcon = styled.span`
  font-size: 16px;
  line-height: 1.4;
  flex-shrink: 0;
`;

const ErrorContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ErrorTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: #dc2626;
`;

const ErrorText = styled.span`
  font-size: 13px;
  line-height: 1.5;
  color: rgba(220, 38, 38, 0.9);
`;

export const ContentInstallAESKeyManager = () => {
  const navigate = useNavigate();
  const { getAesKey } = useAesKey();
  const { requestSnap } = useSnap();
  const [isInstalling, setIsInstalling] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleInstallSnap = useCallback(async () => {
    try {
      setIsInstalling(true);
      setSnapError(null);

      startTransition(() => {
        // Makes navigation and subsequent re-renders non-blocking
      });

      // Install the Snap via the plugin's useSnap hook
      await requestSnap();

      // Brief delay to allow Snap state to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Retrieve the AES key via the context (delegates to plugin)
      await getAesKey();

      // Navigate to wallet after successful installation and key retrieval
      navigate('/wallet', { replace: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Snap installation failed. Please try again.';
      setSnapError(message);
    } finally {
      setIsInstalling(false);
    }
  }, [requestSnap, getAesKey, navigate]);

  return (
    <ContentBorderWrapper>
      <ContentContainer>
        <ContentTitle>Install</ContentTitle>
        <ContentTextInstall>
          Click on the Install with MetaMask button to continue with the Snap
          installation. Using the snap you can onboard your AES key and access
          COTI's privacy-centric experience across different dApps.
        </ContentTextInstall>

        <InfoBox>
          <InfoIcon>💡</InfoIcon>
          <InfoContent>
            <InfoTitle>Multiple accounts?</InfoTitle>
            <InfoText>
              When MetaMask prompts you to connect, select all the accounts you
              want to use with the Snap. To add more accounts later, you'll need
              to reinstall the Snap.
            </InfoText>
          </InfoContent>
        </InfoBox>

        {snapError && (
          <ErrorBox>
            <ErrorIcon>⚠️</ErrorIcon>
            <ErrorContent>
              <ErrorTitle>Installation Error</ErrorTitle>
              <ErrorText>{snapError}</ErrorText>
            </ErrorContent>
          </ErrorBox>
        )}

        <ButtonAction
          text={
            isInstalling || isPending
              ? 'Installing'
              : snapError
                ? 'Retry Installation'
                : 'Install with MetaMask'
          }
          primary
          onClick={handleInstallSnap}
          disabled={isInstalling || isPending}
          iconLeft={
            isInstalling || isPending ? (
              <SpinnerImage src={SpinnerIcon} alt="Loading" />
            ) : undefined
          }
          iconRight={<Metamask />}
        />
      </ContentContainer>
    </ContentBorderWrapper>
  );
};
