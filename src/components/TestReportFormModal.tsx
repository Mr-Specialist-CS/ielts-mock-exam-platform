import React from 'react';
import { X, Printer, CheckCircle2, ShieldCheck, Download, Lock } from 'lucide-react';
import { CandidateSession } from '../types';
import { CandidateAvatar } from './CandidateAvatar';
import { formatDateLong } from '../utils/formatDate';
import { QrCode } from './common/QrCode';
import { isSessionAllGradesFinalized } from '../utils/ieltsScoring';

interface TestReportFormModalProps {
  session: CandidateSession;
  onClose: () => void;
}

export const TestReportFormModal: React.FC<TestReportFormModalProps> = ({ session, onClose }) => {
  const isAllFinalized = isSessionAllGradesFinalized(session);

  if (!isAllFinalized) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-6 sm:p-8 border border-slate-200 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600 shadow-sm">
            <Lock className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Official TRF Certificate Unavailable</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Examination grades have not yet been fully finalized by authorized IELTS examiners. All 4 components (Listening, Reading, Writing, and Speaking) must be evaluated and certified before the official Test Report Form (TRF) certificate can be generated.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const g = session.grading;
  const lBand = (g.listeningScore?.band ?? 0).toFixed(1);
  const rBand = (g.readingScore?.band ?? 0).toFixed(1);
  const wBand = (g.writingAdminEvaluation?.overallBand ?? g.writingAiEvaluation?.overallBand ?? 0).toFixed(1);
  const sBand = (g.speakingEvaluation?.overallBand ?? 0).toFixed(1);
  const overallBand = (g.finalOverallBand ?? 0).toFixed(1);
  const cefr = g.cefrLevel || 'B2';

  const verifyUrl = `${window.location.origin}/verify/${session.candidateId}`;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white">
      <div className="max-w-3xl w-full bg-white text-slate-900 rounded-2xl shadow-xl overflow-hidden my-4 print:my-0 print:shadow-none print:rounded-none border border-slate-200" style={{maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto'}}>
        {/* Modal Action Header (Hidden on Print) */}
        <div className="bg-slate-50 px-6 py-4 flex items-center justify-between text-slate-800 border-b border-slate-200 print:hidden">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-orange-600" />
            <span className="font-bold text-sm">Official IELTS Test Report Form (TRF)</span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={handlePrint}
              className="flex items-center space-x-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* The Printable TRF Document */}
        <div id="trf-document" className="p-5 sm:p-7 border-4 border-slate-100 bg-[#fdfdfc] text-slate-900 font-sans print:border-none print:p-6">
          {/* Top Title & Logos */}
          <div className="flex items-start justify-between border-b-2 border-red-700 pb-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-3">
                <div className="text-2xl font-black tracking-tight text-red-700 uppercase font-serif">
                  IELTS
                </div>
                <div className="h-6 w-px bg-slate-300" />
                <div className="text-xs font-bold tracking-widest text-slate-700 uppercase">
                  Test Report Form
                </div>
              </div>
              <p className="text-[11px] text-slate-500 font-semibold tracking-wider uppercase">
                Academic Module • Confidential Document
              </p>
            </div>

            <div className="text-right space-y-0.5 text-xs font-mono">
              <div><span className="text-slate-500">Centre No:</span> <strong>GB042</strong></div>
              <div><span className="text-slate-500">Candidate ID:</span> <strong className="text-red-700">{session.candidateId}</strong></div>
              <div><span className="text-slate-500">Date:</span> <strong>{formatDateLong(new Date())}</strong></div>
            </div>
          </div>

          {/* Candidate Profile Box */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 my-6 items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="md:col-span-1 flex justify-center">
              <CandidateAvatar
                name={session.candidateName}
                photoUrl={session.candidatePhotoUrl}
                className="w-28 h-32 rounded-lg border-2 border-slate-300 shadow-sm"
                textClassName="text-2xl"
              />
            </div>

            <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-4 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Candidate Name</span>
                <span className="text-sm font-bold text-slate-900">{session.candidateName}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Candidate Number</span>
                <span className="text-sm font-mono font-bold text-slate-900">{session.candidateId}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Date of Birth</span>
                <span className="font-semibold text-slate-800">{session.dateOfBirth || '14/08/1998'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Sex (M/F)</span>
                <span className="font-semibold text-slate-800">{session.gender === 'F' ? 'Female (F)' : 'Male (M)'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Test Scheme</span>
                <span className="font-semibold text-slate-800">{session.schemeCode || 'Academic Standard'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Country / Region</span>
                <span className="font-semibold text-slate-800">{session.countryOfOrigin || 'Azerbaijan'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">First Language</span>
                <span className="font-semibold text-slate-800">{session.firstLanguage || 'Azerbaijani'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">ID Document No.</span>
                <span className="font-mono font-semibold text-slate-800">{session.idDocumentNumber || 'AZE09182371'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">TRF Number</span>
                <span className="font-mono font-bold text-slate-900 text-[11px]">{session.trfNumber}</span>
              </div>
            </div>
          </div>

          {/* Test Results Table */}
          <div className="my-6">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Official Test Scores &amp; Band Descriptors
            </div>

            <div className="grid grid-cols-5 border-2 border-slate-800 text-center text-xs divide-x-2 divide-slate-800 rounded-lg overflow-hidden bg-white shadow-sm">
              <div className="p-3">
                <span className="font-bold text-slate-600 block text-[11px]">Listening</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{lBand}</span>
              </div>
              <div className="p-3">
                <span className="font-bold text-slate-600 block text-[11px]">Reading</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{rBand}</span>
              </div>
              <div className="p-3">
                <span className="font-bold text-slate-600 block text-[11px]">Writing</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{wBand}</span>
              </div>
              <div className="p-3">
                <span className="font-bold text-slate-600 block text-[11px]">Speaking</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{sBand}</span>
              </div>
              <div className="p-3 bg-red-50/70">
                <span className="font-bold text-red-800 block text-[11px] uppercase">Overall Band</span>
                <span className="text-3xl font-black text-red-700 mt-0.5 block">{overallBand}</span>
              </div>
            </div>

            {/* CEFR Level Banner */}
            <div className="mt-2 flex items-center justify-between px-3 py-1.5 bg-slate-100 rounded text-xs">
              <span className="text-slate-600 font-medium">Common European Framework (CEFR) Equivalent:</span>
              <span className="font-bold text-slate-900">Level {cefr} (Proficient / Effective Operational)</span>
            </div>
          </div>

          {/* Bottom Security / Signature / QR Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t-2 border-slate-200 items-end">
            {/* Stamp */}
            <div className="flex flex-col items-center md:items-start text-center md:text-left">
              <div className="w-24 h-24 rounded-full border-2 border-dashed border-red-700 flex flex-col items-center justify-center text-red-800 p-1 transform -rotate-6 shadow-sm">
                <span className="text-[8px] uppercase tracking-wider font-extrabold">IELTS GATE</span>
                <span className="text-[9px] uppercase font-black text-center leading-tight">OFFICIAL TEST CENTRE</span>
                <span className="text-[7px] tracking-widest font-mono text-red-600 mt-0.5">VALIDATED</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-medium">Official Stamp</span>
            </div>

            {/* Signature */}
            <div className="text-center space-y-1">
              <div className="font-serif italic text-lg text-slate-800 border-b border-slate-400 pb-1 w-44 mx-auto">
                S. Azimzadeh
              </div>
              <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                Administrator Signature
              </span>
              <span className="text-[9px] text-slate-400 block font-mono">
                Sura Azimzadeh, Senior Examiner
              </span>
            </div>

            {/* QR Verification */}
            <div className="flex flex-col items-center md:items-end text-center md:text-right space-y-1">
              <QrCode value={verifyUrl} size={84} />
              <div className="text-[9px] text-slate-500 font-mono pt-1">
                Scan to verify online authenticity
              </div>
              <div className="text-[8px] text-slate-400 truncate max-w-[180px]">
                {verifyUrl}
              </div>
            </div>
          </div>

          {/* Legal disclaimer */}
          <div className="mt-8 pt-3 border-t border-slate-100 text-[8px] text-slate-400 text-justify leading-tight">
            The validity of this IELTS Test Report Form can be authenticated by recognizing organisations and academic institutions at any time via the IELTS Gate online verification service. Reproduction of this document without authorization is strictly prohibited.
          </div>
        </div>
      </div>
    </div>
  );
};
