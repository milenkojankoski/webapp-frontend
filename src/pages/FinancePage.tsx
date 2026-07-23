import React from 'react';
import { NavLink, useParams, Navigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import FinanceOverview from '../components/finance/FinanceOverview';
import FinanceStatements from '../components/finance/FinanceStatements';
import FinanceTax from '../components/finance/FinanceTax';
import FinanceCurrencies from '../components/finance/FinanceCurrencies';

const TABS = [
  { key: 'overview', label: 'Overview', path: '/finance/overview' },
  { key: 'statements', label: 'Statements', path: '/finance/statements' },
  { key: 'tax', label: 'Tax', path: '/finance/tax' },
  { key: 'currencies', label: 'Currencies', path: '/finance/currencies' },
] as const;

type TabKey = typeof TABS[number]['key'];

const TAB_COMPONENTS: Record<TabKey, React.FC> = {
  overview: FinanceOverview,
  statements: FinanceStatements,
  tax: FinanceTax,
  currencies: FinanceCurrencies,
};

const FinancePage: React.FC = () => {
  const { tab } = useParams<{ tab: string }>();
  const { isConnected, connectToExtension } = useWallet();

  const activeTab = (tab as TabKey) || 'overview';
  const ActiveComponent = TAB_COMPONENTS[activeTab];

  if (!ActiveComponent) {
    return <Navigate to="/finance/overview" replace />;
  }

  return (
    <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#121212]">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-gray-900 dark:text-white mb-1">Finance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Statements, tax reports, and currency overview</p>
        </div>

        {/* Wallet gate */}
        {!isConnected ? (
          <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Connect Your Wallet</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Connect your Alpaca Wallet to view financial reports and statements.
            </p>
            <button
              onClick={() => connectToExtension()}
              className="px-8 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all shadow-lg"
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* Tab navigation */}
            <div className="flex space-x-1 p-1 bg-gray-100 dark:bg-[#2a2a2a] rounded-lg mb-8 w-fit">
              {TABS.map(({ key, label, path }) => (
                <NavLink
                  key={key}
                  to={path}
                  className={() =>
                    [
                      'px-4 py-2 rounded-md text-sm font-semibold transition-all',
                      activeTab === key
                        ? 'bg-[#845fbc] text-white shadow-md'
                        : 'bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3f3f3f]',
                    ].join(' ')
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>

            {/* Active tab content */}
            <ActiveComponent />
          </>
        )}
      </div>
    </div>
  );
};

export default FinancePage;
