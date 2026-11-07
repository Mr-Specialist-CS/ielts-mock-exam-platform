import React, { useState, useEffect } from 'react';
import { CandidateAvatar } from '../CandidateAvatar';
import { formatDateLong, formatDateTime } from '../../utils/formatDate';
import { isRecentRegistration } from '../../utils/retention';
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Eye,
  RefreshCw,
  Search,
  Filter,
  FileCheck,
  Calendar,
  Phone,
  Mail,
  User,
  ExternalLink,
  AlertCircle,
  Clock,
  Sparkles,
  X,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  FileBadge
} from 'lucide-react';
import { ExamRegistrationRequest, CandidateSession, MAX_REGISTRATIONS_PER_DATE } from '../../types';
import { getAdminAuthHeaders, getAuthenticatedFileUrl } from '../../utils/adminAuth';

interface RegistrationApprovalsViewProps {
  onRefreshSessions: () => Promise<void>;
  onSelectCandidate?: (candidateId: string) => void;
}

export const RegistrationApprovalsView: React.FC<RegistrationApprovalsViewProps> = ({
  onRefreshSessions,
  onSelectCandidate
}) => {
  const [registrations, setRegistrations] = useState<ExamRegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Exam dates by exam id — backfills registrations saved before their exam
  // was dated (those would otherwise sit forever under "No date").
  const [examDateById, setExamDateById] = useState<Record<string, string>>({});
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [inspectReceiptUrl, setInspectReceiptUrl] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => {
    setExpandedDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchRegistrations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/registrations', {
        headers: { ...getAdminAuthHeaders() }
      });
      if (res.ok) {
        const data = await res.json();
        setRegistrations(data);
      }
    } catch (e) {
      console.error('Failed to load registrations:', e);
    } finally {
      setLoading(false);
    }
    try {
      const examsRes = await fetch('/api/exams', { cache: 'no-store' });
      if (examsRes.ok) {
        const examsData = await examsRes.json();
        if (Array.isArray(examsData)) {
          const map: Record<string, string> = {};
          examsData.forEach((e: any) => {
            if (e && e.id && typeof e.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.examDate)) {
              map[e.id] = e.examDate;
            }
          });
          setExamDateById(map);
        }
      }
    } catch (e) {
      console.error('Failed to load exam dates:', e);
    }
  };

  useEffect(() => {
    fetchRegistrations();
  }, []);

  const handleApprove = async (regId: string) => {
    setProcessingId(regId);
    try {
      const res = await fetch(`/api/registrations/${regId}/approve`, {
        method: 'POST',
        headers: { ...getAdminAuthHeaders() }
      });
      if (res.ok) {
        await fetchRegistrations();
        await onRefreshSessions();
      }
    } catch (e) {
      console.error('Approval failed:', e);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (regId: string) => {
    if (!rejectReason.trim()) {
      alert('Please provide a reason for rejecting the receipt.');
      return;
    }
    setProcessingId(regId);
    try {
      const res = await fetch(`/api/registrations/${regId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify({ reason: rejectReason.trim() })
      });
      if (res.ok) {
        setRejectingId(null);
        setRejectReason('');
        await fetchRegistrations();
      }
    } catch (e) {
      console.error('Rejection failed:', e);
    } finally {
      setProcessingId(null);
    }
  };

  // Last 7 days only — but bookings for today/future exams always stay
  // (advance bookings must survive). Older history is deleted nightly.
  // Missing exam dates resolve from the exam itself (backfill for bookings
  // made before their exam was dated).
  const examDateOf = (r: ExamRegistrationRequest): string | undefined =>
    r.examDate || examDateById[r.examId] || undefined;
  const recentRegistrations = registrations.filter(r => isRecentRegistration(r.submittedAt, examDateOf(r)));

  const filtered = recentRegistrations.filter(r => {
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    const matchesSearch =
      r.candidateName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.phone.includes(searchQuery) ||
      r.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.m10TransactionId && r.m10TransactionId.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const pendingCount = recentRegistrations.filter(r => r.status === 'pending').length;
  const approvedCount = recentRegistrations.filter(r => r.status === 'approved').length;
  const rejectedCount = recentRegistrations.filter(r => r.status === 'rejected').length;

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600 font-black text-lg shadow-sm shadow-cyan-500/10">
            m10
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                m10 Exam Registrations &amp; Payment Approval
              </h2>
              {pendingCount > 0 && (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  {pendingCount} Pending Verification
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 max-w-2xl">
              Inspect candidate payment slips transferred via <strong>m10</strong>, verify transaction IDs, and issue authentic IELTS Candidate IDs with one click.
              Showing submissions from the <strong>last 7 days</strong> — older registrations are deleted automatically every night.
            </p>
          </div>
        </div>

        <button
          onClick={fetchRegistrations}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Submissions</span>
          <span className="text-xl font-black text-slate-800 font-mono mt-0.5 block">{recentRegistrations.length}</span>
        </div>
        <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200/80 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-amber-700 block tracking-wider">Pending Review</span>
          <span className="text-xl font-black text-amber-800 font-mono mt-0.5 block">{pendingCount}</span>
        </div>
        <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200/80 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-emerald-700 block tracking-wider">Approved &amp; Enrolled</span>
          <span className="text-xl font-black text-emerald-800 font-mono mt-0.5 block">{approvedCount}</span>
        </div>
        <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-200/80 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-rose-700 block tracking-wider">Rejected Slips</span>
          <span className="text-xl font-black text-rose-800 font-mono mt-0.5 block">{rejectedCount}</span>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search candidate, phone, email, or m10 TX ID..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 shadow-2xs"
          />
        </div>

        <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${filterStatus === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
          >
            All ({registrations.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${filterStatus === 'pending' ? 'bg-white text-amber-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setFilterStatus('approved')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${filterStatus === 'approved' ? 'bg-white text-emerald-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
          >
            Approved ({approvedCount})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${filterStatus === 'rejected' ? 'bg-white text-rose-700 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
          >
            Rejected ({rejectedCount})
          </button>
        </div>
      </div>

      {/* Registrations List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
            <CreditCard className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No registration submissions found</h3>
            <p className="text-xs text-slate-400">Candidates who submit their m10 transfer receipts will appear here for verification.</p>
          </div>
        ) : (
          filtered.map(reg => {
            const isProcessing = processingId === reg.id;

            return (
              <div
                key={reg.id}
                className={`bg-white border rounded-2xl p-5 shadow-xs transition space-y-4 ${reg.status === 'pending'
                    ? 'border-amber-300/80 ring-1 ring-amber-300/30'
                    : reg.status === 'approved'
                      ? 'border-slate-200/90'
                      : 'border-slate-200 opacity-80'
                  }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Candidate Bio & Photo */}
                  <div className="flex items-start space-x-4">
                    <CandidateAvatar
                      name={reg.candidateName}
                      photoUrl={getAuthenticatedFileUrl(reg.candidatePhotoUrl) || undefined}
                      className="w-16 h-20 rounded-xl border border-slate-300 shadow-2xs shrink-0"
                      textClassName="text-lg"
                    />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                          {reg.id}
                        </span>
                        {reg.status === 'pending' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>Pending Payment Review</span>
                          </span>
                        ) : reg.status === 'approved' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Candidate ID: {reg.approvedCandidateId}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            <span>Receipt Rejected</span>
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-slate-900">{reg.candidateName}</h3>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {reg.phone}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {reg.email}
                        </span>
                        <span>•</span>
                        <span className="text-slate-600 font-semibold">{reg.examTitle}</span>
                        {reg.examDate && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">
                              {formatDateLong(reg.examDate)}
                            </span>
                          </>
                        )}
                        {reg.examSlot === 2 && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                              Slot 2{reg.examTime ? ` · ${reg.examTime}` : ''}
                            </span>
                          </>
                        )}
                        {reg.examSlot !== 2 && reg.examTime && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px] text-slate-500">
                              Slot 1 · {reg.examTime}
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          Submitted: {formatDateTime(reg.submittedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* m10 Receipt Thumbnail & Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
                    {/* Receipt Mini Box with Authenticated URL */}
                    <div
                      onClick={() => setInspectReceiptUrl(reg.m10ReceiptUrl)}
                      className="flex items-center space-x-2.5 p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition shadow-2xs group shrink-0"
                      title="Click to zoom m10 payment receipt"
                    >
                      <img
                        src={getAuthenticatedFileUrl(reg.m10ReceiptUrl)}
                        alt="m10 Slip"
                        className="w-10 h-12 object-cover rounded-lg border border-slate-300"
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />
                      <div className="text-left text-xs pr-1">
                        <span className="text-[10px] uppercase font-bold text-cyan-700 block">m10 Receipt Slip</span>
                        <span className="font-bold text-slate-800">{reg.amountAzn} AZN</span>
                        <span className="text-[10px] text-slate-400 block font-mono">{reg.m10TransactionId || 'Slip attached'}</span>
                      </div>
                      <Maximize2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-600 transition" />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpanded(reg.id)}
                        className="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1"
                        title="Toggle full candidate submitted dossier"
                      >
                        <span>{expandedDetails[reg.id] ? 'Hide Details' : 'View All Data'}</span>
                        {expandedDetails[reg.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {reg.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApprove(reg.id)}
                            disabled={isProcessing}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl text-xs transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>{isProcessing ? 'Issuing ID...' : 'Approve & Issue ID'}</span>
                          </button>

                          <button
                            onClick={() => setRejectingId(reg.id)}
                            disabled={isProcessing}
                            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-xl text-xs transition cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {reg.status === 'approved' && onSelectCandidate && reg.approvedCandidateId && (
                        <button
                          onClick={() => onSelectCandidate(reg.approvedCandidateId!)}
                          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1"
                        >
                          <span>Manage Candidate</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Dossier: All Submitted User Data (Task 6) */}
                {expandedDetails[reg.id] && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                        <FileCheck className="w-4 h-4 text-cyan-600" />
                        <span>Complete Candidate Application Dossier</span>
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Application Ref: {reg.id}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-1 text-slate-700">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Full Legal Name</span>
                        <strong className="text-slate-900 text-sm">{reg.candidateName}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Date of Birth</span>
                        <strong className="text-slate-900">{reg.dateOfBirth || '—'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Sex / Gender</span>
                        <strong className="text-slate-900">{reg.gender === 'M' ? 'Male (M)' : reg.gender === 'F' ? 'Female (F)' : reg.gender || '—'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Passport / National ID #</span>
                        <strong className="font-mono text-slate-900">{reg.idDocumentNumber || '—'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Country of Origin</span>
                        <strong className="text-slate-900">{reg.countryOfOrigin || '—'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">First Language</span>
                        <strong className="text-slate-900">{reg.firstLanguage || '—'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Phone / WhatsApp</span>
                        <strong className="font-mono text-slate-900">{reg.phone}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Email Address</span>
                        <strong className="text-slate-900">{reg.email}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Applied Exam Form</span>
                        <strong className="text-slate-900 truncate block">{reg.examTitle}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Scheme &amp; Module</span>
                        <strong className="text-slate-900">{reg.schemeCode}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Test Center</span>
                        <strong className="text-slate-900 truncate block">{reg.centreNumber || 'AZ001 - Baku Official Test Center'}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Submitted Timestamp</span>
                        <strong className="text-slate-900">{formatDateTime(reg.submittedAt)}</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">m10 Fee Amount</span>
                        <strong className="text-emerald-700 font-bold">{reg.amountAzn} AZN</strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">m10 Transaction ID</span>
                        <strong className="font-mono text-slate-900">{reg.m10TransactionId || '—'}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reject Reason Form Inline */}
                {rejectingId === reg.id && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2 text-xs">
                    <span className="font-bold text-rose-800 block">Reason for Payment Slip Rejection:</span>
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="e.g. Transaction number does not match m10 statement or amount is incomplete..."
                      className="w-full p-2 bg-white border border-rose-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setRejectingId(null)}
                        className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleReject(reg.id)}
                        disabled={isProcessing}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg cursor-pointer"
                      >
                        Confirm Rejection
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Lightbox Modal for Full Resolution m10 Receipt Inspection (Task 5) */}
      {inspectReceiptUrl && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-xl max-h-[90vh] bg-white rounded-2xl p-4 shadow-2xl overflow-hidden flex flex-col items-center">
            <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-slate-100 px-2">
              <span className="text-xs font-bold text-slate-900">m10 Official Transfer Receipt Slip</span>
              <div className="flex items-center gap-2">
                <a
                  href={getAuthenticatedFileUrl(inspectReceiptUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Full Screen</span>
                </a>
                <button
                  onClick={() => setInspectReceiptUrl(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={getAuthenticatedFileUrl(inspectReceiptUrl)}
              alt="Full Resolution m10 Receipt"
              className="max-h-[75vh] w-auto object-contain rounded-xl border border-slate-200 shadow-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
};
