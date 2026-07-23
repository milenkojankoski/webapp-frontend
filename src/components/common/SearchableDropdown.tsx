import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TokenLogo } from './TokenLogo';

interface SearchableDropdownProps {
    options: any[];
    value: string;
    onChange: (val: string) => void;
    isFiat?: boolean;
    fiatNames?: { [key: string]: string };
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    options,
    value,
    onChange,
    isFiat,
    fiatNames
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const filteredOptions = options.filter(opt =>
        opt.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelect = (symbol: string) => {
        onChange(symbol);
        setIsOpen(false);
        setSearchTerm('');
    };

    const handleClickOutside = useCallback((event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
            setIsOpen(false);
            setSearchTerm('');
        }
    }, []);

    useEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [handleClickOutside]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const getDisplayName = (symbol: string) => {
        if (isFiat && fiatNames && fiatNames[symbol]) {
            return fiatNames[symbol];
        }
        return symbol;
    };

    const selectedOption = options.find(opt => opt.symbol === value);

    return (
        <div className="relative w-full md:w-auto" ref={dropdownRef}>
            <button
                className="w-full md:w-auto flex items-center justify-between gap-2 bg-gray-100 dark:bg-[#333333] hover:bg-gray-200 dark:hover:bg-[#444444] transition px-4 py-3 md:py-2 md:px-4 rounded-full font-bold text-gray-900 dark:text-white border border-gray-200 dark:border-transparent mt-2 md:mt-0"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2">
                    {value ? (
                        <>
                            {!isFiat && (
                                selectedOption && <TokenLogo address={selectedOption.address} symbol={selectedOption.symbol} network={selectedOption.network || 'main'} />
                            )}
                            <div className="flex flex-col items-start px-1">
                                <span className={selectedOption?.symbol.length && selectedOption.symbol.length > 5 ? 'text-xs' : 'text-base'}>{value}</span>
                            </div>
                        </>
                    ) : (
                        <span className="text-gray-500 px-1">Select...</span>
                    )}
                </div>
                <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>

            {isOpen && (
                <div className="absolute left-0 right-0 md:right-auto md:-left-2 top-full mt-2 w-full md:w-72 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#333333] rounded-xl shadow-xl z-50 overflow-hidden transform translate-x-0">
                    <div className="p-3 border-b border-gray-100 dark:border-[#333333] bg-gray-50 dark:bg-[#2a2a2a]">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            </div>
                            <input
                                ref={inputRef}
                                type="text"
                                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-[#444444] rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#845fbc] placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt, i) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-[#333333] cursor-pointer transition-colors border-b border-gray-50 dark:border-[#2a2a2a] last:border-0"
                                    onClick={() => handleSelect(opt.symbol)}
                                >
                                    {isFiat ? (
                                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-[#444] flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-bold shadow-inner flex-shrink-0">
                                            {opt.symbol.substring(0, 1)}
                                        </div>
                                    ) : (
                                        <div className="flex-shrink-0">
                                            <TokenLogo address={opt.address} symbol={opt.symbol} network={opt.network || 'main'} />
                                        </div>
                                    )}
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-bold text-gray-900 dark:text-white truncate">{opt.symbol}</span>
                                        <span className="text-xs text-gray-500 truncate">{getDisplayName(opt.symbol)}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-sm">No results found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
