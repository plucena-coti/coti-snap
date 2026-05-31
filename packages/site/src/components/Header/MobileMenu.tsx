import { memo, useCallback, useTransition } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';

import { MobileMenuButton, MobileMenuDropdown, DisconnectButton } from './styles';
import MenuIcon from '../../assets/menu.png';
import LogOutIcon from '../../assets/icons/logOut.svg';
import { useOptimizedDropdown } from '../../hooks/useOptimizedDropdown';

export const MobileMenu = memo(() => {
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [, startTransition] = useTransition();
  const { isOpen, toggle, close, dropdownRef, buttonRef } = useOptimizedDropdown({
    closeOnOutsideClick: true,
  });

  const handleDisconnect = useCallback(() => {
    startTransition(() => {
      disconnect();
    });
    close();
  }, [disconnect, close]);

  return (
    <>
      <MobileMenuButton ref={buttonRef} onClick={toggle}>
        <img src={MenuIcon} alt="Menu" />
      </MobileMenuButton>

      <MobileMenuDropdown ref={dropdownRef} $isVisible={isOpen}>
        <ConnectButton
          chainStatus="icon"
          accountStatus="address"
          showBalance={false}
        />
        {isConnected && (
          <DisconnectButton onClick={handleDisconnect}>
            <LogOutIcon />
            Disconnect
          </DisconnectButton>
        )}
      </MobileMenuDropdown>
    </>
  );
});

MobileMenu.displayName = 'MobileMenu';
