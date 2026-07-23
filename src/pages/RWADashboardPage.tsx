import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

// --- Types ---

type InvoiceStatus = "funding" | "active" | "matured" | "defaulted";
type RiskRating = "A" | "B" | "C";

interface InvoiceBatch {
  id: string;
  name: string;
  debtor: string;
  debtorCountry: string;
  amount: number;
  currency: string;
  discount: number;
  yield: number;
  term: number; // days
  funded: number; // percentage 0-100
  status: InvoiceStatus;
  risk: RiskRating;
  investors: number;
  tokenSymbol: string;
  createdAt: number;
  maturityDate: string;
  origin: "US" | "EU";
  tranches: string[];
}

// --- Mock Data ---

const MOCK_INVOICES: InvoiceBatch[] = [
  {
    id: "INV-2026-Q3-001",
    name: "TechCorp Q3 Receivables",
    debtor: "TechCorp Inc.",
    debtorCountry: "US",
    amount: 500000,
    currency: "USD",
    discount: 4.2,
    yield: 8.8,
    term: 90,
    funded: 72,
    status: "funding",
    risk: "A",
    investors: 34,
    tokenSymbol: "INV-TC-Q3",
    createdAt: Date.now() / 1000 - 86400 * 3,
    maturityDate: "2026-09-18",
    origin: "US",
    tranches: ["506(c)", "Reg CF", "Reg S"],
  },
  {
    id: "INV-2026-Q3-002",
    name: "AutoParts EU Batch",
    debtor: "AutoParts GmbH",
    debtorCountry: "DE",
    amount: 320000,
    currency: "EUR",
    discount: 3.5,
    yield: 7.2,
    term: 60,
    funded: 100,
    status: "active",
    risk: "A",
    investors: 28,
    tokenSymbol: "INV-AP-Q3",
    createdAt: Date.now() / 1000 - 86400 * 14,
    maturityDate: "2026-08-17",
    origin: "EU",
    tranches: ["ECSP", "506(c)"],
  },
  {
    id: "INV-2026-Q3-003",
    name: "LogiFreight Transport",
    debtor: "LogiFreight LLC",
    debtorCountry: "US",
    amount: 180000,
    currency: "USD",
    discount: 5.0,
    yield: 10.5,
    term: 120,
    funded: 45,
    status: "funding",
    risk: "B",
    investors: 12,
    tokenSymbol: "INV-LF-Q3",
    createdAt: Date.now() / 1000 - 86400 * 1,
    maturityDate: "2026-10-16",
    origin: "US",
    tranches: ["506(c)", "Reg CF", "Reg S"],
  },
  {
    id: "INV-2026-Q2-010",
    name: "MedSupply Batch",
    debtor: "MedSupply Corp.",
    debtorCountry: "US",
    amount: 750000,
    currency: "USD",
    discount: 3.0,
    yield: 6.2,
    term: 90,
    funded: 100,
    status: "matured",
    risk: "A",
    investors: 56,
    tokenSymbol: "INV-MS-Q2",
    createdAt: Date.now() / 1000 - 86400 * 95,
    maturityDate: "2026-06-01",
    origin: "US",
    tranches: ["506(c)", "Reg CF"],
  },
  {
    id: "INV-2026-Q3-004",
    name: "NordWind Energy",
    debtor: "NordWind Energie AG",
    debtorCountry: "AT",
    amount: 420000,
    currency: "EUR",
    discount: 3.8,
    yield: 7.9,
    term: 75,
    funded: 88,
    status: "funding",
    risk: "A",
    investors: 41,
    tokenSymbol: "INV-NW-Q3",
    createdAt: Date.now() / 1000 - 86400 * 5,
    maturityDate: "2026-09-01",
    origin: "EU",
    tranches: ["ECSP", "506(c)"],
  },
  {
    id: "INV-2026-Q2-008",
    name: "BuildRight Construction",
    debtor: "BuildRight Ltd.",
    debtorCountry: "US",
    amount: 260000,
    currency: "USD",
    discount: 6.0,
    yield: 12.8,
    term: 60,
    funded: 100,
    status: "active",
    risk: "C",
    investors: 19,
    tokenSymbol: "INV-BR-Q2",
    createdAt: Date.now() / 1000 - 86400 * 30,
    maturityDate: "2026-07-25",
    origin: "US",
    tranches: ["506(c)", "Reg S"],
  },
];

// --- Helpers ---

const statusConfig: Record<InvoiceStatus, { label: string; bg: string; text: string }> = {
  funding: { label: "Funding", bg: "bg-[#845fbc]/10", text: "text-[#845fbc] dark:text-[#a78bfa]" },
  active: { label: "Active", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
  matured: { label: "Matured", bg: "bg-gray-100 dark:bg-white/[0.04]", text: "text-gray-500 dark:text-gray-400" },
  defaulted: { label: "Defaulted", bg: "bg-red-500/10", text: "text-red-500 dark:text-red-400" },
};

const riskConfig: Record<RiskRating, { label: string; color: string }> = {
  A: { label: "A", color: "text-emerald-600 dark:text-emerald-400" },
  B: { label: "B", color: "text-amber-600 dark:text-amber-400" },
  C: { label: "C", color: "text-red-500 dark:text-red-400" },
};

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

const isNew = (createdAt: number) => (Date.now() / 1000) - createdAt < 7 * 86400;

type FilterStatus = "all" | InvoiceStatus;

// --- Component ---

const RWADashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { network: _network } = useWallet();

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterText, setFilterText] = useState("");
  const [sortBy, setSortBy] = useState<"yield" | "amount" | "funded" | "term">("yield");

  // Summary metrics
  const metrics = useMemo(() => {
    const funding = MOCK_INVOICES.filter((i) => i.status === "funding");
    const active = MOCK_INVOICES.filter((i) => i.status === "active");
    const totalVolume = MOCK_INVOICES.reduce((s, i) => s + i.amount, 0);
    const avgYield = MOCK_INVOICES.reduce((s, i) => s + i.yield, 0) / MOCK_INVOICES.length;
    const totalInvestors = MOCK_INVOICES.reduce((s, i) => s + i.investors, 0);
    return { fundingCount: funding.length, activeCount: active.length, totalVolume, avgYield, totalInvestors };
  }, []);

  // Filter + sort
  const filteredInvoices = useMemo(() => {
    let list = MOCK_INVOICES;
    if (filterStatus !== "all") list = list.filter((i) => i.status === filterStatus);
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.debtor.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          i.tokenSymbol.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "yield") return b.yield - a.yield;
      if (sortBy === "amount") return b.amount - a.amount;
      if (sortBy === "funded") return b.funded - a.funded;
      return a.term - b.term;
    });
  }, [filterStatus, filterText, sortBy]);

  return (
    <div className="w-full min-h-screen p-4 md:p-8 lg:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
      <div className="max-w-6xl mx-auto">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-1">
            Invoice Marketplace
          </h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400">
            Tokenized invoices with fractional ownership. Earn yield from real-world receivables.
          </p>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3 transition-colors">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Open Offerings</div>
            <div className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">{metrics.fundingCount}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3 transition-colors">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Active Invoices</div>
            <div className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">{metrics.activeCount}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3 transition-colors">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Total Volume</div>
            <div className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">{formatCurrency(metrics.totalVolume, "USD")}</div>
          </div>
          <div className="rounded-xl border border-[#845fbc]/20 ring-1 ring-[#845fbc]/10 bg-white dark:bg-[#1a1a1a] px-4 py-3 transition-colors">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#a78bfa] mb-1">Avg. Yield</div>
            <div className="text-[22px] font-semibold tracking-tight text-[#845fbc] dark:text-[#a78bfa]">{metrics.avgYield.toFixed(1)}%</div>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
          {/* Status Tabs */}
          <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-white/[0.04] rounded-md border border-gray-200 dark:border-white/[0.06]">
            {(["all", "funding", "active", "matured"] as FilterStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 text-[12px] font-semibold rounded transition-all ${
                  filterStatus === s
                    ? "bg-white dark:bg-white/[0.1] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search invoices..."
              className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-md border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 border text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 transition-all"
            />
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1.5 text-[13px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-700 dark:text-gray-200 focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all"
          >
            <option value="yield">Highest Yield</option>
            <option value="amount">Largest Amount</option>
            <option value="funded">Most Funded</option>
            <option value="term">Shortest Term</option>
          </select>
        </div>

        {/* Invoice Table */}
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] overflow-hidden">
          {/* Header */}
          <div className="hidden md:grid grid-cols-[1fr_140px_80px_80px_100px_140px_80px] gap-2 px-4 py-2.5 bg-gray-50 dark:bg-white/[0.02] border-b border-gray-100 dark:border-white/[0.04]">
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Invoice</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Amount</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Yield</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Term</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Funded</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Tranches</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Risk</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
            {filteredInvoices.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-gray-400 dark:text-gray-500">
                No invoices match your filters.
              </div>
            ) : (
              filteredInvoices.map((inv) => {
                const sc = statusConfig[inv.status];
                const rc = riskConfig[inv.risk];
                return (
                  <div
                    key={inv.id}
                    onClick={() => navigate(`/rwa/${inv.id}`)}
                    className="grid grid-cols-1 md:grid-cols-[1fr_140px_80px_80px_100px_140px_80px] gap-2 md:gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.02] cursor-pointer transition-colors items-center"
                  >
                    {/* Invoice info */}
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Origin flag */}
                      <div className="w-8 h-8 rounded-md bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-[14px] shrink-0">
                        {inv.origin === "US" ? "🇺🇸" : "🇪🇺"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{inv.name}</span>
                          {isNew(inv.createdAt) && (
                            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">New</span>
                          )}
                          <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] ${sc.bg} ${sc.text}`}>
                            {sc.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                          {inv.debtor} · {inv.tokenSymbol}
                        </div>
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(inv.amount, inv.currency)}
                    </div>

                    {/* Yield */}
                    <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                      {inv.yield.toFixed(1)}%
                    </div>

                    {/* Term */}
                    <div className="text-[13px] text-gray-600 dark:text-gray-300">
                      {inv.term}d
                    </div>

                    {/* Funded progress */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            inv.funded >= 100
                              ? "bg-emerald-500"
                              : inv.funded >= 50
                                ? "bg-[#845fbc]"
                                : "bg-amber-500"
                          }`}
                          style={{ width: `${Math.min(inv.funded, 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 w-8 text-right">{inv.funded}%</span>
                    </div>

                    {/* Tranches */}
                    <div className="flex flex-wrap gap-1">
                      {inv.tranches.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400"
                        >
                          {t}
                        </span>
                      ))}
                    </div>

                    {/* Risk */}
                    <div className={`text-[13px] font-semibold ${rc.color}`}>
                      {rc.label}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-6 text-center text-[11px] text-gray-400 dark:text-gray-500">
          Showing {filteredInvoices.length} of {MOCK_INVOICES.length} invoices · Mock data for preview purposes
        </div>

      </div>
    </div>
  );
};

export default RWADashboardPage;
