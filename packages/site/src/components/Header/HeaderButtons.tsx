import { ConnectButton } from '@rainbow-me/rainbowkit';

import { ConnectedContainer } from './styles';

export const HeaderButtons = () => {
  return (
    <ConnectedContainer>
      <ConnectButton
        chainStatus="icon"
        accountStatus="address"
        showBalance={false}
      />
    </ConnectedContainer>
  );
};
