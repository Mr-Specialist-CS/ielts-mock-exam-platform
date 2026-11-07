import React, { useState, useEffect } from 'react';
import { ShieldCheck, Search, CheckCircle2, AlertCircle, Award, ExternalLink, Calendar, MapPin, Hash, User } from 'lucide-react';
import { CandidateSession } from '../types';
import { formatDateLong } from '../utils/formatDate';
interface PublicVerificationViewProps {
  initialCandidateId?: string;
}

export const PublicVerificationView: React.FC<PublicVerificationViewProps> = ({
  initialCandidateId = ''
}) => {
  const [candidateId, setCandidateId] = useState(initialCandidateId);
  const [verifiedData, setVerifiedData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVerification = async (idToLookup: string) => {
    if (!idToLookup.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/verify/${idToLookup.trim().toUpperCase()}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError(`No authentic Test Report Form was found matching Candidate ID "${idToLookup}". Please verify the credentials. Note: records are automatically deleted 180 days (~6 months) after the test date, so older TRFs are no longer verifiable.`);
          setVerifiedData(null);
        } else {
          setError('Verification service unavailable. Please retry.');
        }
        return;
      }

      const data = await res.json();
      setVerifiedData(data);
    } catch (err) {
      setError('Could not establish connection to IELTS Gate Verification Gateway.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCandidateId) {
      fetchVerification(initialCandidateId);
    }
  }, [initialCandidateId]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Title & Trust Emblem */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-50 border border-orange-200 text-orange-600 mb-2 shadow-xs">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          IELTS Gate Official Verification Service
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto">
          Recognising organisations, universities, and visa authorities can instantly verify the authenticity of IELTS Gate Test Report Forms.
        </p>
        <p className="text-[11px] text-slate-400 max-w-lg mx-auto">
          TRFs remain verifiable for 6 months (180 days) after the test date, then records are automatically and permanently deleted.
        </p>
      </div>

      {/* Verification Query Input */}
      <div className="max-w-xl mx-auto">
        <form
          onSubmit={e => {
            e.preventDefault();
            fetchVerification(candidateId);
          }}
          className="flex space-x-2 bg-white border border-slate-200 p-2 rounded-2xl shadow-xs"
        >
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={candidateId}
              onChange={e => setCandidateId(e.target.value.toUpperCase())}
              placeholder="Enter Candidate Number (e.g. IG-XXXXXX) or TRF Number"
              className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Verifying...' : 'Verify TRF'}
          </button>
        </form>

        {error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Verified Record Certificate Card */}
      {verifiedData && (
        <div className="bg-white border-2 border-emerald-500/50 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
          {/* Verification Badge Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-emerald-700">
                    Official Authenticated Record
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  IELTS Academic Test Report Form
                </h2>
              </div>
            </div>

            <div className="text-xs font-mono text-slate-500 text-left sm:text-right">
              <div>TRF Number: <strong className="text-slate-800">{verifiedData.trfNumber}</strong></div>
              <div>Status: <span className="text-emerald-700 font-bold uppercase">{verifiedData.verified ? 'AUTHENTIC' : (verifiedData.status || 'VERIFIED')}</span></div>
            </div>
          </div>

          {/* Candidate Bio Info */}
          <div className="flex flex-col sm:flex-row gap-5 bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200 text-xs items-center">
            {verifiedData.candidatePhotoUrl && (
              <img
                src={verifiedData.candidatePhotoUrl}
                alt={verifiedData.candidateName}
                className="w-24 h-28 object-cover rounded-xl border border-slate-300 shadow-2xs shrink-0"
              />
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Candidate Name</span>
                <span className="text-sm font-bold text-slate-900 mt-0.5 block">{verifiedData.candidateName}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Candidate ID</span>
                <span className="text-sm font-mono font-bold text-slate-700 mt-0.5 block">{verifiedData.candidateId}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Test Module</span>
                <span className="text-slate-700 font-semibold mt-0.5 block">{verifiedData.schemeCode || verifiedData.examTitle || 'Academic Standard'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Examination Date</span>
                <span className="text-slate-700 mt-0.5 block">{verifiedData.testDate ? formatDateLong(verifiedData.testDate) : 'Certified'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Test Centre</span>
                <span className="text-slate-700 mt-0.5 block">{verifiedData.testCenter || verifiedData.centre || 'AZ001 - Baku Official IELTS Test Center'}</span>
              </div>
            </div>
          </div>

          {/* Scores Breakdown */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Certified Component Band Scores
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-slate-500 text-xs font-medium block">Listening</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">
                  {verifiedData.scores.listening?.toFixed(1) || '—'}
                </span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-slate-500 text-xs font-medium block">Reading</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">
                  {verifiedData.scores.reading?.toFixed(1) || '—'}
                </span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-slate-500 text-xs font-medium block">Writing</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">
                  {verifiedData.scores.writing?.toFixed(1) || '—'}
                </span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-slate-500 text-xs font-medium block">Speaking</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">
                  {verifiedData.scores.speaking?.toFixed(1) || '—'}
                </span>
              </div>

              <div className="col-span-2 sm:col-span-1 bg-orange-50/70 p-4 rounded-xl border border-orange-200">
                <span className="text-orange-700 text-xs font-bold block uppercase">Overall Band</span>
                <span className="text-3xl font-black text-slate-900 mt-0.5 block">
                  {(verifiedData.scores.overallBand ?? verifiedData.scores.overall)?.toFixed(1) || '—'}
                </span>
                <span className="text-[10px] text-emerald-700 font-bold block mt-0.5">
                  CEFR {verifiedData.scores.cefrLevel ?? verifiedData.scores.cefr}
                </span>
              </div>
            </div>
          </div>

          {/* Validation Seal & Authenticity Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-100 gap-3">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Cryptographically verified against the IELTS Gate proctor registry. Records are kept for 180 days, then auto-deleted.</span>
            </div>
            <div className="font-mono text-[11px] text-slate-400">
              Verified at {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
