import { ConnectButton } from '@rainbow-me/rainbowkit';
import styled from 'styled-components';

import {
  ContentBorderWrapper,
  ContentContainer,
  ContentTitle,
  ContentText,
} from './styles';

const ConnectButtonWrapper = styled.div`
  display: flex;
  justify-content: center;
  width: 100%;
`;

export const ConnectPage = () => {
  return (
    <ContentBorderWrapper>
      <ContentContainer>
        <ContentTitle>Connect</ContentTitle>
        <ContentText>Click on the Connect Wallet to get started.</ContentText>
        <ConnectButtonWrapper>
          <ConnectButton />
        </ConnectButtonWrapper>
      </ContentContainer>
    </ContentBorderWrapper>
  );
};
