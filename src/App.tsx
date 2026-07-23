import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Layout & Contexts
import Layout from './components/layout/Layout';
import { ThemeProvider } from './components/common/ThemeContext';
import { WalletProvider } from './context/WalletContext';
import { SwapProvider } from './context/SwapContext';

// Pages
import HomePage from './pages/HomePage';
import TokenDetailsPage from './pages/TokenDetailsPage';
import AlpaMetric from './pages/AlpaMetrics';
import { WalletPage } from './pages/WalletPage';
import LiquidityPage from './pages/LiquidityPage';
import AlpacaCollectivePage from './pages/AlpacaCollectivePage';
import LaunchpadPage from './pages/LaunchpadPage';
import ConverterPage from './pages/ConverterPage';
import AdminPage from './pages/AdminPage';
import UsernamePage from './pages/UsernamePage';
import BridgePage from './pages/BridgePage';
import RWADashboardPage from './pages/RWADashboardPage';
import RWAInvoiceDetailPage from './pages/RWAInvoiceDetailPage';
import FinancePage from './pages/FinancePage';
import AndroidEarlyAccessPage from './pages/AndroidEarlyAccessPage';

// Components
import { SwapModal } from './components/layout/SwapModal';
import { BetaGate } from './components/common/BetaGate';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <WalletProvider>
          <SwapProvider>

            {/* The Modal sits here to overlay ALL pages */}
            <SwapModal />

            <Routes>
              {/* Wrapper Layout (Sidebar + Content Area) */}
              <Route element={<Layout />}>

                {/* Main Routes */}
                <Route path="/" element={<HomePage />} />
                <Route path="/alpametric" element={<AlpaMetric />} />
                <Route path="/token-details" element={<TokenDetailsPage />} />
                <Route path="/wallet" element={<WalletPage />} />

                {/* ✅ 2. Add New Routes */}
                <Route path="/liquidity" element={<LiquidityPage />} />
                <Route path="/collective" element={<AlpacaCollectivePage />} />
                <Route path="/launchpad" element={<Navigate to="/launchpad/sandbox" replace />} />
                <Route path="/launchpad/:tab" element={<LaunchpadPage />} />
                <Route path="/create" element={<Navigate to="/launchpad/create" replace />} />
                <Route path="/finance" element={<BetaGate featureName="Finance"><Navigate to="/finance/overview" replace /></BetaGate>} />
                <Route path="/finance/:tab" element={<BetaGate featureName="Finance"><FinancePage /></BetaGate>} />
                <Route path="/converter" element={<ConverterPage />} />
                <Route path="/bridge" element={<BridgePage />} />
                <Route path="/rwa" element={<BetaGate featureName="RWA 1"><RWADashboardPage /></BetaGate>} />
                <Route path="/rwa/:id" element={<BetaGate featureName="RWA 1"><RWAInvoiceDetailPage /></BetaGate>} />
                <Route path="/account" element={<UsernamePage />} />
                <Route path="/android" element={<AndroidEarlyAccessPage />} />
                <Route path="/admin" element={<AdminPage />} />

                {/* Catch all redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />

              </Route>
            </Routes>

          </SwapProvider>
        </WalletProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

export default App;