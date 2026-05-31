import React from 'react';
import { OnboardModal } from '@coti-io/coti-wallet-plugin';

import { useAesKey } from '../hooks/AesKeyContext';

interface OnboardingWrapperProps {
  children: React.ReactNode;
}

/**
 * Renders the Plugin's OnboardModal when a non-MetaMask wallet
 * connects and needs AES key onboarding.
 *
 * Children are always rendered alongside the modal overlay so the
 * rest of the application remains visible behind the modal.
 */
export const OnboardingWrapper: React.FC<OnboardingWrapperProps> = ({
  children,
}) => {
  const {
    aesKey,
    isOnboarding,
    onboardingError,
    walletType,
    getAesKey,
    showOnboardModal,
    setShowOnboardModal,
  } = useAesKey();

  return (
    <>
      {children}
      <OnboardModal
        isOpen={showOnboardModal}
        onClose={() => setShowOnboardModal(false)}
        onConfirm={getAesKey}
        isLoading={isOnboarding}
        error={onboardingError}
        walletType={walletType}
        sessionAesKey={aesKey}
      />
    </>
  );
};
