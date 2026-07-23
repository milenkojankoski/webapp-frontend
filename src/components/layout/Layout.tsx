import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import TopBar from './TopBar';

const Layout: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-[#121212]">

      {/* 1. The Persistent Sidebar */}
      <Sidebar
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuClose={() => setIsMobileMenuOpen(false)}
      />

      {/* 2. The Main Content Area */}
      <div className="flex-1 w-full ml-0 md:ml-[248px] flex flex-col overflow-x-hidden">
        <TopBar
          onMobileMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          isMobileMenuOpen={isMobileMenuOpen}
        />
        <main className="flex-1 p-0 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

    </div>
  );
};

export default Layout;
