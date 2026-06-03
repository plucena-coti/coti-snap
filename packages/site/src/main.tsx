import '@rainbow-me/rainbowkit/styles.css';

import type { FunctionComponent, ReactNode } from 'react';
import { StrictMode, createContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import styled, { ThemeProvider } from 'styled-components';
import {
  configureCotiPlugin,
  WagmiRainbowKitProvider,
} from '@coti-io/coti-wallet-plugin';

import './components/ContentManageToken/transitions.css';
import App from './App.js';
import { GlobalBackground } from './components/GlobalBackground';
import { dark, GlobalStyle, light } from './config/theme.js';
import { AesKeyProvider } from './hooks/AesKeyContext';
import { MetaMaskProvider } from './hooks/MetamaskContext';
import { getThemePreference } from './utils';

// Resolve snap ID from environment (mirrors logic from config/snap.ts)
const isSnapLocal = import.meta.env.VITE_SNAP_ENV === 'local';
const snapId = isSnapLocal
  ? `local:${import.meta.env.VITE_SNAP_LOCAL_URL ?? 'http://localhost:8080'}`
  : (import.meta.env.VITE_SNAP_ORIGIN ?? 'npm:@coti-io/coti-snap');

// Configure the COTI plugin before React renders
configureCotiPlugin({
  snapId,
});

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
  background: transparent;
`;

export type RootProps = {
  children: ReactNode;
};

type ToggleTheme = () => void;

export const ToggleThemeContext = createContext<ToggleTheme>(
  (): void => undefined,
);

export const Root: FunctionComponent<RootProps> = ({ children }) => {
  const [darkTheme] = useState(getThemePreference());

  return (
    <ThemeProvider theme={darkTheme ? dark : light}>
      <WagmiRainbowKitProvider>
        <MetaMaskProvider>
          <AesKeyProvider>
            <GlobalBackground>
              <Wrapper>{children}</Wrapper>
            </GlobalBackground>
          </AesKeyProvider>
        </MetaMaskProvider>
      </WagmiRainbowKitProvider>
    </ThemeProvider>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root>
      <App />
      <GlobalStyle />
    </Root>
  </StrictMode>,
);
