import React, { useState } from 'react';
import { useWallet } from '../../context/WalletContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { logout } = useWallet();
  const [showSeed, setShowSeed] = useState(false);
  const seedPhrase = localStorage.getItem("alpaca_seed") || "";

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(seedPhrase);
    alert("Seed phrase copied to clipboard!");
  };

  const handleDisconnect = () => {
    if (window.confirm("Are you sure you want to unlink your wallet? You will need your seed phrase to log back in.")) {
      logout();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#171717] w-full max-w-md p-8 rounded-3xl border border-[#333] shadow-2xl relative flex flex-col items-center">
        
        {/* Close Icon */}
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          ✕
        </button>

        {/* Icon & Title */}
        <div className="w-16 h-16 bg-[#2a2a2a] rounded-2xl flex items-center justify-center mb-6 border border-[#333]">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#845fbc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          </svg>
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-6">Wallet Settings</h2>

        <div className="w-full space-y-6">
          
          {/* 1. SEED PHRASE SECTION */}
          <div className="p-5 bg-[#1e1e1e] border border-[#333] rounded-2xl shadow-inner">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Secret Recovery Phrase</span>
              <button 
                onClick={() => setShowSeed(!showSeed)}
                className="text-[#a78bfa] text-xs font-semibold hover:underline"
              >
                {showSeed ? "Hide" : "Show"}
              </button>
            </div>
            
            <div className={`font-mono text-sm text-gray-200 break-words leading-relaxed bg-[#171717] p-4 rounded-xl border border-[#333] transition-all duration-300 ${!showSeed ? 'blur-md select-none' : ''}`}>
              {seedPhrase}
            </div>

            {showSeed && (
              <button 
                onClick={handleCopy}
                className="w-full mt-4 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white text-sm font-bold rounded-lg border border-[#333] transition-all"
              >
                Copy Phrase
              </button>
            )}
            <p className="mt-3 text-[10px] text-gray-500 leading-tight">
              We recommend saving these 24 words on a physical piece of paper and storing it safely non-digitally.
            </p>
          </div>

          {/* 2. DISCONNECT SECTION */}
          <div className="pt-2 border-t border-[#333]">
             <button 
                onClick={handleDisconnect}
                className="w-full py-3.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 rounded-xl font-bold transition-all active:scale-[0.98]"
              >
                Unlink Wallet
              </button>
              <p className="mt-2 text-center text-[10px] text-gray-500">
                Please make sure you have copied your secret phrase before unlinking.
              </p>
          </div>

          {/* 3. FEEDBACK SECTION */}
          <div className="p-4 bg-[#1e1e1e]/50 border border-[#333] rounded-2xl text-center">
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-1">Feedback & Support</h4>
              <p className="text-xs text-gray-500">
                Found a bug or have questions? Reach out to us via <br/>
                <a href="mailto:contact@alpacadex.com" className="text-[#845fbc] hover:underline font-semibold">contact@alpacadex.com</a>
              </p>
          </div>

        </div>
      </div>
    </div>
  );
};