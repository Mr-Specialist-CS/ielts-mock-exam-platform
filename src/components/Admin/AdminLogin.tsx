import React, { useState } from 'react';
import {
  ShieldAlert,
  Lock,
  UserCheck,
  KeyRound,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
  Fingerprint
} from 'lucide-react';
import { AdminAuthResponse } from '../../types';

interface AdminLoginProps {
  onLoginSuccess: (token: string, username: string) => void;
  onBackToStudent: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onLoginSuccess,
  onBackToStudent
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockWaitSeconds, setLockWaitSeconds] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please provide the administrator username.');
      return;
    }
    if (!password) {
      setError('Please provide the master security password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data: AdminAuthResponse = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || data.error || 'Authentication rejected. Verify credentials.');
        if (data.locked) {
          setIsLocked(true);
          setLockWaitSeconds(data.waitSeconds || 60);
        } else if (typeof data.attemptsRemaining === 'number') {
          setAttemptsRemaining(data.attemptsRemaining);
        }
        return;
      }

      if (data.token) {
        // Store in sessionStorage and localStorage for seamless persistence
        sessionStorage.setItem('ielts_admin_token', data.token);
        sessionStorage.setItem('ielts_admin_user', data.username || username.trim());
        localStorage.setItem('ielts_admin_token', data.token);
        onLoginSuccess(data.token, data.username || username.trim());
      }
    } catch (err) {
      console.error('Admin authentication error:', err);
      setError('Network or server error during authentication. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-gradient-to-b from-slate-50 via-slate-100/60 to-white">
      <div className="w-full max-w-lg space-y-6">
        {/* Back Link */}
        <button
          onClick={onBackToStudent}
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Candidate Exam Portal</span>
        </button>

        {/* Main Card */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 shadow-xl shadow-slate-200/50 space-y-6">
          {/* Header Brand */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-5">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white shadow-md shadow-orange-500/20">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black text-slate-900 tracking-tight">Admin Command Center</h1>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                    Restricted
                  </span>
                </div>
                <p className="text-xs text-slate-500">IELTS Gate Official Invigilator &amp; Examiner Gateway</p>
              </div>
            </div>
            <Fingerprint className="w-8 h-8 text-slate-300 hidden sm:block" />
          </div>

          {/* Security Notice */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-slate-800 block">Authorized Personnel Only</span>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                This gateway controls candidate lockdown status, m10 registration approvals, answer key modification, and official TRF certification.
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-800 flex items-start space-x-3 animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-bold">{error}</p>
                {attemptsRemaining !== null && attemptsRemaining > 0 && (
                  <p className="text-[11px] text-rose-600 font-mono">
                    Warning: {attemptsRemaining} attempt{attemptsRemaining > 1 ? 's' : ''} remaining before terminal security lock.
                  </p>
                )}
                {isLocked && (
                  <p className="text-[11px] text-rose-700 font-semibold">
                    Anti-brute-force protocol activated. Please wait {lockWaitSeconds ? `${lockWaitSeconds}s ` : ''}for cooldown.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Authentication Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-orange-600" />
                  Admin Username
                </span>
                <span className="text-[10px] text-slate-400 font-mono lowercase">case-sensitive</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter admin username"
                disabled={loading || isLocked}
                className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 transition shadow-2xs font-mono"
              />
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-orange-600" />
                  Master Security Password
                </span>
                <span className="text-[10px] text-slate-400 font-mono">24-char complex key</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter complex administrator password..."
                  disabled={loading || isLocked}
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 transition shadow-2xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-slate-700 rounded-lg transition cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || isLocked}
              className="w-full py-3 px-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold rounded-xl text-sm shadow-md shadow-orange-500/20 active:scale-[0.99] transition disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Proctor Credentials...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Authenticate &amp; Enter Command Center</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-slate-400 space-y-1">
          <p>IELTS Gate Secure Proctor Network • Protocol Version 2026.4</p>
          <p>Compliant with British Council &amp; IDP Computer-Delivered Examination Security Standards</p>
        </div>
      </div>
    </div>
  );
};
