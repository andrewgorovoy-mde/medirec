// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';

const medplum = new MedplumClient({
  onUnauthenticated: () => (window.location.href = '/'),
  baseUrl: import.meta.env.MEDPLUM_BASE_URL,
});

const theme = createTheme({
  fontFamily:
    '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  primaryColor: 'brand',
  primaryShade: 8,
  defaultRadius: 'sm',
  colors: {
    brand: [
      '#F7F3FA',
      '#EDE1F3',
      '#DCC4E8',
      '#C7A0D9',
      '#B27DC9',
      '#9C5CB8',
      '#8446A0',
      '#6B3684',
      '#43205F',
      '#2B123E',
    ],
  },
  headings: {
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '500',
        lineHeight: '2.0',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.875rem',
    md: '0.875rem',
    lg: '1.0rem',
    xl: '1.125rem',
  },
  components: {
    Button: {
      defaultProps: { radius: 'sm' },
      styles: { root: { fontWeight: 600 } },
    },
    Card: {
      defaultProps: { radius: 'md' },
    },
    TextInput: {
      defaultProps: { radius: 'md' },
    },
    Select: {
      defaultProps: { radius: 'md' },
    },
    NumberInput: {
      defaultProps: { radius: 'md' },
    },
  },
});

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <BrowserRouter>
      <MedplumProvider medplum={medplum}>
        <MantineProvider theme={theme}>
          <App />
        </MantineProvider>
      </MedplumProvider>
    </BrowserRouter>
  </StrictMode>
);
