import React, { useState, useEffect } from 'react';
import { CreditCard, Save, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck, Phone, Coins, User, Clock, Lock, Unlock, Calendar, PlayCircle, XCircle } from 'lucide-react';
import { SystemSettings } from '../../types';
import { getAdminAuthHeaders } from '../../utils/adminAuth';

interface SystemSettingsViewProps {
  onSettingsSaved?: (newSettings: SystemSettings) => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({ onSettingsSaved }) => {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [holderInput, setHolderInput] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    setErrorMessage(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/api/settings', { signal: controller.signal });
      if (res.ok) {
        const data: SystemSettings = await res.json();
        setSettings(data);
        if (data.isConfigured || (data.examPriceAzn && data.m10PhoneNumber)) {
          setPriceInput(data.examPriceAzn !== undefined ? String(data.examPriceAzn) : '');
          setPhoneInput(data.m10PhoneNumber || '');
          setHolderInput(data.m10AccountHolder || '');
        } else {
          setPriceInput('');
          setPhoneInput('');
          setHolderInput('');
        }
      }
    } catch (e: any) {
      console.error('Failed to load settings:', e);
      setErrorMessage(e.name === 'AbortError' ? 'Connection timed out while loading settings.' : 'Could not load current payment settings. Please check your network or server connection.');
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const price = parseFloat(priceInput);
    if (isNaN(price) || price <= 0) {
      setErrorMessage('Please enter a valid positive exam price in AZN.');
      return;
    }
    if (!phoneInput.trim()) {
      setErrorMessage('Please enter an official m10 mobile phone number.');
      return;
    }
    if (!holderInput.trim()) {
      setErrorMessage('Please enter the official account holder name or organization label.');
      return;
    }

    setSaving(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const payload: SystemSettings = {
        examPriceAzn: price,
        m10PhoneNumber: phoneInput.trim(),
        m10AccountHolder: holderInput.trim(),
        isConfigured: true
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || 'Failed to update system settings.');
      }

      const resData = await res.json();
      const saved = resData.settings || payload;
      setSettings(saved);
      setSuccessMessage('Exam price and m10 transfer details updated successfully! Candidates will immediately see the new values.');
      if (onSettingsSaved) onSettingsSaved(saved);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setErrorMessage('Request timed out while saving settings. Please verify server connection and retry.');
      } else {
        setErrorMessage(err.message || 'An error occurred while saving settings.');
      }
    } finally {
      clearTimeout(timeoutId);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600 shadow-sm">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Exam Pricing &amp; m10 Payment Configuration
              </h2>
              {settings?.isConfigured ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Configured
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Pending Admin Setup
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 max-w-xl">
              Define the official mock exam registration fee (AZN) and destination m10 mobile transfer account details shown to candidates during public registration.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchSettings}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Unconfigured Alert Banner */}
      {!settings?.isConfigured && !loading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-bold">Payment Parameters Not Yet Defined</strong>
            <span>Please enter the exam registration fee, official m10 mobile number, and account holder name below so candidates can view verified transfer details and register.</span>
          </div>
        </div>
      )}

      {/* Success / Error Feedback */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-start gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <form onSubmit={handleSave} className="md:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Payment Parameters
            </h3>
            <p className="text-xs text-slate-500">
              Updates take effect immediately across all candidate entry and registration views.
            </p>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1.5 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-orange-600" />
              <span>Exam Registration Fee (AZN) *</span>
            </label>
            <div className="relative rounded-xl border border-slate-300 overflow-hidden shadow-2xs focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-orange-500">
              <input
                type="number"
                step="0.5"
                min="1"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                placeholder="e.g. 50"
                className="w-full px-4 py-2.5 text-base font-bold font-mono text-slate-900 focus:outline-none"
                required
              />
              <div className="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400 font-mono select-none">
                AZN
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Amount candidates must transfer via m10 before taking the exam.
            </p>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1.5 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-cyan-600" />
              <span>Official m10 Mobile Number *</span>
            </label>
            <input
              type="text"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              placeholder="e.g. +994 50 123 45 67"
              className="w-full px-4 py-2.5 text-sm font-bold font-mono text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 shadow-2xs"
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Candidates send mobile wallet transfer to this phone number.
            </p>
          </div>

          <div>
            <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span>Account Holder Name / Organization Label *</span>
            </label>
            <input
              type="text"
              value={holderInput}
              onChange={e => setHolderInput(e.target.value)}
              placeholder="e.g. Official Education Center"
              className="w-full px-4 py-2.5 text-sm font-semibold text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-2xs"
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Displayed so candidates can verify the recipient name inside their m10 app.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white font-bold rounded-xl text-xs transition shadow-sm shadow-orange-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving Parameters...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Payment &amp; Pricing Settings</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Live Candidate Preview Card */}
        <div className="md:col-span-5 bg-gradient-to-br from-cyan-900 to-slate-900 text-white rounded-2xl p-6 shadow-md flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-300">
                  Live Candidate Preview
                </span>
              </div>
              <span className="text-[10px] bg-cyan-400/20 text-cyan-300 font-bold px-2 py-0.5 rounded-full border border-cyan-400/30">
                m10 Card
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-white/60">Official Transfer Account</span>
              <div className="text-xl font-mono font-black text-white tracking-wider">
                {phoneInput.trim() || (settings?.isConfigured && settings?.m10PhoneNumber ? settings.m10PhoneNumber : 'Not defined yet')}
              </div>
              <div className="text-xs text-cyan-300 font-medium">
                {holderInput.trim() || (settings?.isConfigured && settings?.m10AccountHolder ? settings.m10AccountHolder : 'Account holder not defined')}
              </div>
            </div>

            <div className="bg-white/10 rounded-xl p-3 border border-white/10 flex items-center justify-between">
              <span className="text-xs text-white/80">Exam Registration Fee:</span>
              <span className="text-lg font-mono font-black text-amber-300">
                {priceInput.trim() ? `${priceInput.trim()} AZN` : (settings?.isConfigured && typeof settings?.examPriceAzn === 'number' ? `${settings.examPriceAzn} AZN` : 'Not set')}
              </span>
            </div>

            <p className="text-[11px] text-white/60 leading-relaxed">
              When candidates visit the registration portal or login page, they will see these exact details for transferring their mock exam fee.
            </p>
          </div>

          <div className="pt-4 mt-4 border-t border-white/10 flex items-center gap-2 text-[10px] text-white/40">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Persisted directly in Cloudflare D1 production database.</span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* EXAM ACCESS & SCHEDULE CONTROL                               */}
      {/* ============================================================ */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Exam entry is controlled by each exam’s own date &amp; time (set in the Exam Wizard): the active exam opens automatically when its start time arrives, and stays open while it remains active. Deactivate the exam to close entry.
        </p>
      </div>
    </div>
  );
};
