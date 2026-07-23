import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

// --- Types (shared with dashboard — will extract later) ---

type InvoiceStatus = "funding" | "active" | "matured" | "defaulted";
type RiskRating = "A" | "B" | "C";

interface Tranche {
  name: string;
  regulation: string;
  supply: number;
  sold: number;
  price: number;
  currency: string;
  geoRestriction: string;
  requiresAccreditation: boolean;
}

interface InvoiceDetail {
  id: string;
  name: string;
  debtor: string;
  debtorCountry: string;
  amount: number;
  currency: string;
  discount: number;
  yield: number;
  term: number;
  funded: number;
  status: InvoiceStatus;
  risk: RiskRating;
  investors: number;
  tokenSymbol: string;
  createdAt: number;
  maturityDate: string;
  origin: "US" | "EU";
  description: string;
  tranches: Tranche[];
  timeline: { date: string; event: string; status: "done" | "current" | "upcoming" }[];
}

// --- Mock Data ---

const MOCK_INVOICES: Record<string, InvoiceDetail> = {
  "INV-2026-Q3-001": {
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
    description: "Quarterly receivables from TechCorp Inc., a Fortune 500 enterprise software provider. Invoice covers Q3 software licensing and maintenance contracts with a 99.7% historical payment rate.",
    tranches: [
      { name: "506(c)", regulation: "Reg D 506(c)", supply: 2500, sold: 1800, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: true },
      { name: "Reg CF", regulation: "Regulation CF", supply: 1500, sold: 1100, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: false },
      { name: "Reg S", regulation: "Regulation S", supply: 1000, sold: 700, price: 100, currency: "USD", geoRestriction: "Non-US only", requiresAccreditation: false },
    ],
    timeline: [
      { date: "Jun 15, 2026", event: "Invoice submitted & verified", status: "done" },
      { date: "Jun 16, 2026", event: "Tokenized — funding open", status: "done" },
      { date: "Jun 18, 2026", event: "Funding in progress (72%)", status: "current" },
      { date: "—", event: "Fully funded → disbursement to business", status: "upcoming" },
      { date: "Sep 18, 2026", event: "Invoice maturity — debtor pays", status: "upcoming" },
      { date: "Sep 19, 2026", event: "Proceeds distributed to investors", status: "upcoming" },
    ],
  },
  "INV-2026-Q3-002": {
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
    description: "EU-originated batch from AutoParts GmbH (Munich), covering automotive component supply contracts to major OEMs. Strong payment history across 12 previous invoices.",
    tranches: [
      { name: "ECSP", regulation: "EU Crowdfunding (ECSP)", supply: 2400, sold: 2400, price: 100, currency: "EUR", geoRestriction: "EU investors", requiresAccreditation: false },
      { name: "506(c)", regulation: "Reg D 506(c)", supply: 800, sold: 800, price: 100, currency: "EUR", geoRestriction: "US accredited", requiresAccreditation: true },
    ],
    timeline: [
      { date: "Jun 4, 2026", event: "Invoice submitted & verified", status: "done" },
      { date: "Jun 5, 2026", event: "Tokenized — funding open", status: "done" },
      { date: "Jun 10, 2026", event: "Fully funded", status: "done" },
      { date: "Jun 11, 2026", event: "Disbursed to AutoParts GmbH (€308,800)", status: "done" },
      { date: "Aug 17, 2026", event: "Invoice maturity — awaiting payment", status: "current" },
      { date: "—", event: "Proceeds distributed to investors", status: "upcoming" },
    ],
  },
  "INV-2026-Q3-003": {
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
    description: "Transport receivables from LogiFreight LLC, a mid-size logistics provider. Higher yield reflects moderate credit risk — solid revenue but shorter operating history (3 years).",
    tranches: [
      { name: "506(c)", regulation: "Reg D 506(c)", supply: 1000, sold: 450, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: true },
      { name: "Reg CF", regulation: "Regulation CF", supply: 500, sold: 225, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: false },
      { name: "Reg S", regulation: "Regulation S", supply: 300, sold: 135, price: 100, currency: "USD", geoRestriction: "Non-US only", requiresAccreditation: false },
    ],
    timeline: [
      { date: "Jun 17, 2026", event: "Invoice submitted & verified", status: "done" },
      { date: "Jun 17, 2026", event: "Tokenized — funding open", status: "done" },
      { date: "Jun 18, 2026", event: "Funding in progress (45%)", status: "current" },
      { date: "—", event: "Fully funded → disbursement to business", status: "upcoming" },
      { date: "Oct 16, 2026", event: "Invoice maturity — debtor pays", status: "upcoming" },
      { date: "—", event: "Proceeds distributed to investors", status: "upcoming" },
    ],
  },
};

// Additional detail entries for remaining dashboard invoices
MOCK_INVOICES["INV-2026-Q2-010"] = {
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
  description: "Medical supply receivables from MedSupply Corp. — a well-established distributor with 15-year track record. This batch has matured and proceeds have been distributed to all investors.",
  tranches: [
    { name: "506(c)", regulation: "Reg D 506(c)", supply: 4000, sold: 4000, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: true },
    { name: "Reg CF", regulation: "Regulation CF", supply: 2000, sold: 2000, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: false },
    { name: "Reg S", regulation: "Regulation S", supply: 1500, sold: 1500, price: 100, currency: "USD", geoRestriction: "Non-US only", requiresAccreditation: false },
  ],
  timeline: [
    { date: "Mar 1, 2026", event: "Invoice submitted & verified", status: "done" },
    { date: "Mar 2, 2026", event: "Tokenized — funding open", status: "done" },
    { date: "Mar 8, 2026", event: "Fully funded", status: "done" },
    { date: "Mar 9, 2026", event: "Disbursed to MedSupply Corp. ($727,500)", status: "done" },
    { date: "Jun 1, 2026", event: "Invoice matured — debtor paid $750,000", status: "done" },
    { date: "Jun 2, 2026", event: "Proceeds distributed to 56 investors", status: "done" },
  ],
};

MOCK_INVOICES["INV-2026-Q3-004"] = {
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
  description: "Renewable energy equipment receivables from NordWind Energie AG (Vienna). Covers turbine component supply contracts with major European utilities. Excellent payment history — zero defaults across 20+ prior invoices.",
  tranches: [
    { name: "ECSP", regulation: "EU Crowdfunding (ECSP)", supply: 3000, sold: 2640, price: 100, currency: "EUR", geoRestriction: "EU investors", requiresAccreditation: false },
    { name: "506(c)", regulation: "Reg D 506(c)", supply: 1200, sold: 1056, price: 100, currency: "EUR", geoRestriction: "US accredited", requiresAccreditation: true },
  ],
  timeline: [
    { date: "Jun 13, 2026", event: "Invoice submitted & verified", status: "done" },
    { date: "Jun 13, 2026", event: "Tokenized — funding open", status: "done" },
    { date: "Jun 18, 2026", event: "Funding in progress (88%)", status: "current" },
    { date: "—", event: "Fully funded → disbursement to NordWind", status: "upcoming" },
    { date: "Sep 1, 2026", event: "Invoice maturity — debtor pays", status: "upcoming" },
    { date: "—", event: "Proceeds distributed to investors", status: "upcoming" },
  ],
};

MOCK_INVOICES["INV-2026-Q2-008"] = {
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
  description: "Construction receivables from BuildRight Ltd. Higher yield reflects elevated credit risk — the company is growing rapidly but has a shorter operating history and higher leverage. Suitable for risk-tolerant investors.",
  tranches: [
    { name: "506(c)", regulation: "Reg D 506(c)", supply: 2000, sold: 2000, price: 100, currency: "USD", geoRestriction: "US only", requiresAccreditation: true },
    { name: "Reg S", regulation: "Regulation S", supply: 600, sold: 600, price: 100, currency: "USD", geoRestriction: "Non-US only", requiresAccreditation: false },
  ],
  timeline: [
    { date: "May 19, 2026", event: "Invoice submitted & verified", status: "done" },
    { date: "May 20, 2026", event: "Tokenized — funding open", status: "done" },
    { date: "May 28, 2026", event: "Fully funded", status: "done" },
    { date: "May 29, 2026", event: "Disbursed to BuildRight Ltd. ($244,400)", status: "done" },
    { date: "Jul 25, 2026", event: "Invoice maturity — awaiting payment", status: "current" },
    { date: "—", event: "Proceeds distributed to investors", status: "upcoming" },
  ],
};

// --- Helpers ---

const statusConfig: Record<InvoiceStatus, { label: string; bg: string; text: string }> = {
  funding: { label: "Funding", bg: "bg-[#845fbc]/10", text: "text-[#845fbc] dark:text-[#a78bfa]" },
  active: { label: "Active", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
  matured: { label: "Matured", bg: "bg-gray-100 dark:bg-white/[0.04]", text: "text-gray-500 dark:text-gray-400" },
  defaulted: { label: "Defaulted", bg: "bg-red-500/10", text: "text-red-500 dark:text-red-400" },
};

const riskConfig: Record<RiskRating, { label: string; color: string; bg: string }> = {
  A: { label: "Low Risk", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  B: { label: "Moderate Risk", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  C: { label: "Higher Risk", color: "text-red-500 dark:text-red-400", bg: "bg-red-500/10" },
};

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

// --- Component ---

const RWAInvoiceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isConnected } = useWallet();

  const [investAmount, setInvestAmount] = useState("");
  const [selectedTranche, setSelectedTranche] = useState(0);
  const [_showInvestModal, setShowInvestModal] = useState(false);

  const invoice = id ? MOCK_INVOICES[id] : null;

  if (!invoice) {
    return (
      <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#121212] flex flex-col items-center justify-center text-center">
        <div className="text-[48px] mb-4">📄</div>
        <h2 className="text-[22px] font-semibold text-gray-900 dark:text-white mb-2">Invoice not found</h2>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">The invoice you're looking for doesn't exist or has been removed.</p>
        <button
          onClick={() => navigate("/rwa")}
          className="px-4 py-2 rounded-md text-[13px] font-semibold bg-[#845fbc] text-white hover:bg-[#7050a8] transition-colors"
        >
          Back to Marketplace
        </button>
      </div>
    );
  }

  const sc = statusConfig[invoice.status];
  const rc = riskConfig[invoice.risk];
  const totalTokens = invoice.tranches.reduce((s, t) => s + t.supply, 0);
  const soldTokens = invoice.tranches.reduce((s, t) => s + t.sold, 0);
  const tranche = invoice.tranches[selectedTranche];

  return (
    <div className="w-full min-h-screen p-4 md:p-8 lg:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
      <div className="max-w-5xl mx-auto">

        {/* Back nav */}
        <button
          onClick={() => navigate("/rwa")}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Marketplace
        </button>

        {/* Header Card */}
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[14px]">{invoice.origin === "US" ? "🇺🇸" : "🇪🇺"}</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] ${sc.bg} ${sc.text}`}>
                  {sc.label}
                </span>
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] ${rc.bg} ${rc.color}`}>
                  {rc.label}
                </span>
              </div>
              <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-1">{invoice.name}</h1>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                {invoice.debtor} · {invoice.debtorCountry} · {invoice.tokenSymbol}
              </p>
            </div>
            <div className="flex gap-3">
              {invoice.status === "funding" && (
                <button
                  onClick={() => setShowInvestModal(true)}
                  className="px-5 py-2.5 rounded-md text-[13px] font-semibold bg-[#845fbc] text-white hover:bg-[#7050a8] transition-colors"
                >
                  Invest Now
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Invoice Amount</div>
            <div className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white">{formatCurrency(invoice.amount, invoice.currency)}</div>
          </div>
          <div className="rounded-xl border border-[#845fbc]/20 ring-1 ring-[#845fbc]/10 bg-white dark:bg-[#1a1a1a] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#a78bfa] mb-1">Expected Yield</div>
            <div className="text-[18px] font-semibold tracking-tight text-[#845fbc] dark:text-[#a78bfa]">{invoice.yield}%</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Term</div>
            <div className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white">{invoice.term} days</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Investors</div>
            <div className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white">{invoice.investors}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Maturity</div>
            <div className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white">{invoice.maturityDate}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left Column — 2/3 */}
          <div className="lg:col-span-2 space-y-6">

            {/* Description */}
            <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-3">About This Invoice</h3>
              <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{invoice.description}</p>
            </div>

            {/* Tranches Table */}
            <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.04]">
                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Investment Tranches</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-white/[0.02]">
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Tranche</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Regulation</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Access</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Tokens</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Sold</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                    {invoice.tranches.map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white">{t.name}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{t.regulation}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-600 dark:text-gray-400">{t.geoRestriction}</span>
                            {t.requiresAccreditation && (
                              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Accredited only</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-900 dark:text-white">{t.supply.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{t.sold.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{(t.supply - t.sold).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4">Timeline</h3>
              <div className="space-y-0">
                {invoice.timeline.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    {/* Vertical line + dot */}
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                        step.status === "done" ? "bg-emerald-500" : step.status === "current" ? "bg-[#845fbc] ring-4 ring-[#845fbc]/20" : "bg-gray-300 dark:bg-gray-600"
                      }`} />
                      {i < invoice.timeline.length - 1 && (
                        <div className={`w-0.5 flex-1 my-0.5 ${
                          step.status === "done" ? "bg-emerald-500/30" : "bg-gray-200 dark:bg-white/[0.08]"
                        }`} />
                      )}
                    </div>
                    <div className="pb-5">
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-0.5">{step.date}</div>
                      <div className={`text-[13px] ${
                        step.status === "current" ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"
                      }`}>
                        {step.event}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column — 1/3 */}
          <div className="space-y-6">

            {/* Funding Progress Card */}
            <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4">Funding Progress</h3>
              <div className="mb-3">
                <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
                  <span>{soldTokens.toLocaleString()} tokens sold</span>
                  <span>{totalTokens.toLocaleString()} total</span>
                </div>
                <div className="h-3 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      invoice.funded >= 100 ? "bg-emerald-500" : "bg-[#845fbc]"
                    }`}
                    style={{ width: `${Math.min(invoice.funded, 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-center">
                <span className={`text-[28px] font-semibold tracking-tight ${
                  invoice.funded >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"
                }`}>
                  {invoice.funded}%
                </span>
                <span className="text-[13px] text-gray-400 dark:text-gray-500 ml-1">funded</span>
              </div>
            </div>

            {/* Quick Invest Card */}
            {invoice.status === "funding" && (
              <div className="rounded-xl border border-[#845fbc]/20 ring-1 ring-[#845fbc]/10 bg-white dark:bg-[#1a1a1a] p-5">
                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4">Invest</h3>

                {/* Tranche Selector */}
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">Select Tranche</div>
                  <div className="space-y-1.5">
                    {invoice.tranches.map((t, i) => {
                      const available = t.supply - t.sold;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedTranche(i)}
                          disabled={available === 0}
                          className={`w-full text-left px-3 py-2 rounded-md text-[12px] border transition-colors ${
                            selectedTranche === i
                              ? "border-[#845fbc] bg-[#845fbc]/5 text-gray-900 dark:text-white"
                              : available === 0
                                ? "border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-gray-500 cursor-not-allowed"
                                : "border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.12] text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-semibold">{t.name}</span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                              {available > 0 ? `${available.toLocaleString()} left` : "Sold out"}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{t.geoRestriction}{t.requiresAccreditation ? " · Accredited" : ""}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Amount Input */}
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">Amount ({tranche.currency})</div>
                  <input
                    type="number"
                    value={investAmount}
                    onChange={(e) => setInvestAmount(e.target.value)}
                    placeholder="e.g. 1000"
                    min="100"
                    step="100"
                    className="w-full px-3 py-2 text-[13px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all"
                  />
                  {investAmount && (
                    <div className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                      = {Math.floor(Number(investAmount) / tranche.price)} tokens @ {formatCurrency(tranche.price, tranche.currency)} each
                    </div>
                  )}
                </div>

                {/* Expected Return */}
                {investAmount && Number(investAmount) > 0 && (
                  <div className="mb-4 p-3 rounded-md bg-emerald-500/5 border border-emerald-500/10">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-500 dark:text-gray-400">Expected return</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(Number(investAmount) * (1 + invoice.yield / 100), tranche.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[12px] mt-1">
                      <span className="text-gray-500 dark:text-gray-400">Profit</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(Number(investAmount) * (invoice.yield / 100), tranche.currency)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Invest Button */}
                {!isConnected ? (
                  <div className="text-center text-[12px] text-gray-400 dark:text-gray-500 py-2">
                    Connect wallet to invest
                  </div>
                ) : (
                  <button
                    disabled={!investAmount || Number(investAmount) < 100}
                    className="w-full py-2.5 rounded-md text-[13px] font-semibold bg-[#845fbc] text-white hover:bg-[#7050a8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Invest {investAmount ? formatCurrency(Number(investAmount), tranche.currency) : ""}
                  </button>
                )}

                <div className="mt-3 text-[10px] text-gray-400 dark:text-gray-500 text-center">
                  Min. {formatCurrency(100, tranche.currency)} · KYC required{tranche.requiresAccreditation ? " · Accreditation required" : ""}
                </div>
              </div>
            )}

            {/* Invoice Details Card */}
            <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-3">Details</h3>
              <div className="space-y-2.5">
                {[
                  ["Invoice ID", invoice.id],
                  ["Token", invoice.tokenSymbol],
                  ["Origin", invoice.origin === "US" ? "United States" : "European Union"],
                  ["Debtor", invoice.debtor],
                  ["Debtor Country", invoice.debtorCountry],
                  ["Discount", `${invoice.discount}%`],
                  ["Created", new Date(invoice.createdAt * 1000).toLocaleDateString()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-[12px]">
                    <span className="text-gray-400 dark:text-gray-500">{label}</span>
                    <span className="text-gray-900 dark:text-white font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default RWAInvoiceDetailPage;
