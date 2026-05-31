import React from 'react';
import styled, { keyframes } from 'styled-components';

import { StepProgressBar } from './StepProgressBar';
import LoaderIcon from '../assets/icons/loader.png';
import { useAesKey } from '../hooks/AesKeyContext';

/**
 * Onboarding step type - previously from SnapContext.
 * Now defined locally since AesKeyContext uses isOnboarding boolean instead.
 */
type OnboardingStep =
  | 'signature-prompt'
  | 'signature-request'
  | 'send-tx'
  | 'done'
  | null;

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const SpinnerImage = styled.img`
  width: 40px;
  height: 40px;
  animation: ${spin} 2s linear infinite;
`;

const ContentText = styled.p`
  font-size: ${(props) => props.theme.fontSizes.small};
  line-height: 1.2;
  font-weight: 300;
  margin: 0;
  color: #000000 !important;
`;

const ContentTitle = styled.p`
  font-size: ${(props) => props.theme.fontSizes.title};
  font-weight: bold;
  margin: 0;
  text-align: center;
  color: #000000 !important;
`;

const ONBOARDING_STEPS = ['Request', 'Sign', 'Confirm', 'Done'];

const getStepNumber = (onboardingStep: OnboardingStep): number => {
  switch (onboardingStep) {
    case 'signature-prompt':
      return 1;
    case 'signature-request':
      return 2;
    case 'send-tx':
      return 3;
    case 'done':
      return 4;
    default:
      return 1;
  }
};

type LoadingWithProgressProps = {
  title: string;
  actionText: string;
};

export const LoadingWithProgress: React.FC<LoadingWithProgressProps> = ({
  title,
  actionText,
}) => {
  const { isOnboarding } = useAesKey();
  // When isOnboarding is true, show step 2 (in-progress); otherwise step 1 (idle)
  const onboardingStep: OnboardingStep = isOnboarding ? 'signature-request' : 'signature-prompt';
  const currentStep = getStepNumber(onboardingStep);

  return (
    <>
      <ContentTitle>{title}</ContentTitle>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          alignItems: 'center',
        }}
      >
        <SpinnerImage src={LoaderIcon} alt="Loading" />
        <ContentText>{actionText}</ContentText>

        <StepProgressBar currentStep={currentStep} steps={ONBOARDING_STEPS} />
      </div>
    </>
  );
};
