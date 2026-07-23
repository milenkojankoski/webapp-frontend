import React, { useState, useMemo } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db, authReady } from '../config/firebase';

// Android robot SVG path (Material Design icon)
const ANDROID_PATH = "M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-2.21-1.2-4.15-2.97-5.19-.01-.01 0-.35-.5.35zM10 5H9V4h1v1zm5 0h-1V4h1v1z";

// Smartphone SVG path
const PHONE_PATH = "M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z";

// Play Store triangle
const PLAY_PATH = "M8 5v14l11-7z";

// Shield/security
const SHIELD_PATH = "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z";

const ICON_PATHS = [ANDROID_PATH, PHONE_PATH, PLAY_PATH, SHIELD_PATH];

const FloatingIcons: React.FC = () => {
  const icons = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      path: ICON_PATHS[i % ICON_PATHS.length],
      left: `${5 + (i * 37 + i * i * 7) % 90}%`,
      top: `${5 + (i * 23 + i * i * 11) % 85}%`,
      size: 16 + (i % 5) * 4,
      duration: 12 + (i % 7) * 3,
      delay: -(i * 1.7),
      rotate: (i * 30) % 360,
    }));
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <style>{`
        @keyframes androidFloat {
          0%, 100% { transform: translate(0, 0) rotate(var(--r)); }
          25% { transform: translate(12px, -18px) rotate(calc(var(--r) + 8deg)); }
          50% { transform: translate(-8px, -30px) rotate(calc(var(--r) - 5deg)); }
          75% { transform: translate(15px, -12px) rotate(calc(var(--r) + 12deg)); }
        }
      `}</style>
      {icons.map((icon) => (
        <svg
          key={icon.id}
          viewBox="0 0 24 24"
          width={icon.size}
          height={icon.size}
          className="absolute text-[#845fbc] dark:text-[#a78bfa]"
          style={{
            left: icon.left,
            top: icon.top,
            opacity: 0.06,
            '--r': `${icon.rotate}deg`,
            animation: `androidFloat ${icon.duration}s ease-in-out ${icon.delay}s infinite`,
          } as React.CSSProperties}
          fill="currentColor"
        >
          <path d={icon.path} />
        </svg>
      ))}
    </div>
  );
};

const AndroidEarlyAccessPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'already' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Please enter a valid email address.');
      setStatus('error');
      return;
    }

    setStatus('submitting');
    try {
      await authReady;

      // Check if email already registered
      const q = query(collection(db, 'android_early_access'), where('email', '==', trimmed));
      const snap = await getDocs(q);
      if (!snap.empty) {
        setStatus('already');
        return;
      }

      await addDoc(collection(db, 'android_early_access'), {
        email: trimmed,
        createdAt: Timestamp.now(),
      });
      setStatus('success');
      setEmail('');
    } catch (err: any) {
      console.error('Early access signup error:', err);
      setErrorMsg('Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#171717] transition-colors duration-300 p-4 md:p-8 lg:p-12 relative">
      <FloatingIcons />
      <div className="max-w-xl mx-auto relative z-10">
      {/* Header */}
      <div className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">
          Early Access
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">
          Alpaca for Android
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-2">
          Get early access to the Alpaca Wallet Android app. Enter your Google Play email and we'll add you as an internal tester.
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 transition-colors">

        {/* Android icon */}
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-[#845fbc]/10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-9 h-9 text-[#845fbc] dark:text-[#a78bfa]" fill="currentColor">
              <path d={ANDROID_PATH} />
            </svg>
          </div>
        </div>

        {status === 'success' ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1">You're in!</p>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">We'll add you as an internal tester shortly. Once added, the app will be available for you on Google Play.</p>
            <a
              href="https://play.google.com/store/apps/details?id=com.alpaca.wallet"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold text-[#845fbc] bg-[#845fbc]/8 hover:bg-[#845fbc] hover:text-white transition-colors"
            >
              Open on Google Play
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        ) : status === 'already' ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-[#845fbc]/10 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#845fbc] dark:text-[#a78bfa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1">Already signed up</p>
            <p className="text-[13px] text-gray-500 dark:text-gray-400">This email is already on our early access list. We'll be in touch!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Google Play email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setStatus('idle'); }}
                placeholder="you@example.com"
                className="w-full px-3 py-2 text-[14px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-colors"
                disabled={status === 'submitting'}
              />
            </div>

            {status === 'error' && (
              <p className="text-[13px] text-red-500 dark:text-red-400">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full py-2.5 rounded-md text-[14px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#7350a8] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? 'Signing up...' : 'Get Early Access'}
            </button>

            <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
              We'll only use your email to add you as an internal tester on Google Play.
            </p>
          </form>
        )}
      </div>
      </div>
    </div>
  );
};

export default AndroidEarlyAccessPage;
