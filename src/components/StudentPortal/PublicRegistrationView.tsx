import React, { useState, useRef, useEffect, useCallback } from 'react';
import { formatDateLong, formatDateTime } from '../../utils/formatDate';
import {
  Shield,
  CreditCard,
  Camera,
  Upload,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Search,
  ArrowRight,
  ExternalLink,
  Phone,
  Mail,
  User,
  Calendar,
  Globe,
  BadgeCheck,
  RefreshCw,
  Sparkles,
  Lock,
  X,
  Copy
} from 'lucide-react';
import { Exam, CandidateSession, ExamRegistrationRequest, SystemSettings, getExamSlotStartMs } from '../../types';

function formatCountdown(secs: number): string {
  if (secs <= 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/** Format YYYY-MM-DD without timezone shift, e.g. "20 Sep 2026". */
function formatExamDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1] || ''} ${m[1]}`;
}

interface PublicRegistrationViewProps {
  exams?: Exam[];
  exam?: Exam | null;
  activeExamId?: string | null;
  examAccessMode?: 'closed' | 'scheduled' | 'open';
  examScheduledAt?: string | null;
  onStartExam: (session: CandidateSession) => void;
  onGoToLogin: () => void;
}

export const PublicRegistrationView: React.FC<PublicRegistrationViewProps> = ({
  exams,
  exam,
  activeExamId,
  examAccessMode = 'closed',
  examScheduledAt,
  onStartExam,
  onGoToLogin
}) => {
  const [activeTab, setActiveTab] = useState<'register' | 'lookup'>('register');

  // Authoritative active exam: candidate only sees this 1 exam
  const activeExam: Exam | null = exam !== undefined
    ? exam
    : (activeExamId ? (exams || []).find(e => e.id === activeExamId) || null : (exams?.[0] || null));

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | 'Other'>('M');
  const [country, setCountry] = useState('Azerbaijan');
  const [language, setLanguage] = useState('Azerbaijani');
  const [idDocNumber, setIdDocNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedExamId, setSelectedExamId] = useState(activeExam?.id || '');
  const [schemeCode, setSchemeCode] = useState<'Academic Standard' | 'General Training'>('Academic Standard');

  useEffect(() => {
    if (activeExam?.id) {
      setSelectedExamId(activeExam.id);
    }
  }, [activeExam]);

  // Photo State
  const [photoUrl, setPhotoUrl] = useState('');
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // m10 Payment State
  const [receiptUrl, setReceiptUrl] = useState<string>('');
  const [receiptFileName, setReceiptFileName] = useState<string>('');
  const [m10TxId, setM10TxId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<ExamRegistrationRequest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  // Dynamic System Settings (Exam Fee & m10 Details defined by admin)
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState<boolean>(true);

  // Per-date seat availability (125/date cap, shared across both time slots)
  const [availability, setAvailability] = useState<{
    registered: number; capacity: number; spotsLeft: number; isFull: boolean;
    bySlot?: { slot1: number; slot2: number };
  } | null>(null);
  // Chosen time slot on two-slot exam days (1 = first start, 2 = second).
  const [examSlot, setExamSlot] = useState<1 | 2>(1);

  useEffect(() => {
    const date = activeExam?.examDate;
    if (!date) { setAvailability(null); return; }
    fetch(`/api/registration-availability?examDate=${encodeURIComponent(date)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.success) {
          setAvailability({
            registered: data.registered, capacity: data.capacity,
            spotsLeft: data.spotsLeft, isFull: data.isFull,
            bySlot: data.bySlot
          });
        }
      })
      .catch(() => {});
  }, [activeExam?.examDate]);

  // Reset slot choice when the active exam changes.
  useEffect(() => { setExamSlot(1); }, [activeExam?.id]);

  // Proctored Exam Access Gate & Countdown State
  const [effectiveAccessMode, setEffectiveAccessMode] = useState<'closed' | 'scheduled' | 'open'>(examAccessMode);
  const [scheduledAtTime, setScheduledAtTime] = useState<string | null>(examScheduledAt || null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const [copiedCandidateId, setCopiedCandidateId] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setSystemSettings(data);
        }
      }
    } catch {
      // ignore
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    if (examAccessMode) {
      setEffectiveAccessMode(examAccessMode);
    }
  }, [examAccessMode]);

  useEffect(() => {
    if (examScheduledAt !== undefined) {
      setScheduledAtTime(examScheduledAt);
    }
  }, [examScheduledAt]);

  const computeSecondsLeft = useCallback((targetIso?: string | null) => {
    const target = targetIso !== undefined ? targetIso : scheduledAtTime;
    if (!target) return 0;
    const diff = Math.floor((new Date(target).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  }, [scheduledAtTime]);

  useEffect(() => {
    if (effectiveAccessMode !== 'scheduled' || !scheduledAtTime) {
      setCountdownSeconds(0);
      return;
    }
    const initial = computeSecondsLeft(scheduledAtTime);
    setCountdownSeconds(initial);
    if (initial <= 0) {
      setEffectiveAccessMode('open');
      return;
    }
    const interval = setInterval(() => {
      const remaining = computeSecondsLeft(scheduledAtTime);
      setCountdownSeconds(remaining);
      if (remaining <= 0) {
        setEffectiveAccessMode('open');
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [effectiveAccessMode, scheduledAtTime, computeSecondsLeft]);

  // Periodic poll on lookup tab to keep gate status synchronized with admin controls
  useEffect(() => {
    if (activeTab !== 'lookup') return;
    const interval = setInterval(() => {
      refreshSettings();
    }, 5000);
    return () => clearInterval(interval);
  }, [activeTab, refreshSettings]);

  const isExamOpen = Boolean(
    activeExam && (effectiveAccessMode === 'open' || (effectiveAccessMode === 'scheduled' && countdownSeconds <= 0))
  );
  const isCountdown = Boolean(
    activeExam && effectiveAccessMode === 'scheduled' && countdownSeconds > 0
  );
  const isExamClosed = !isExamOpen && !isCountdown;

  // Lookup State
  const [lookupQuery, setLookupQuery] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<ExamRegistrationRequest | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Sync webcam stream to video element
  useEffect(() => {
    if (isWebcamActive && videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      videoRef.current.play().catch(err => console.warn('Webcam play error:', err));
    }
  }, [isWebcamActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const startWebcam = async () => {
    setWebcamError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setWebcamError('Camera API not supported or requires localhost / HTTPS.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      mediaStreamRef.current = stream;
      setIsWebcamActive(true);
    } catch (err: any) {
      console.error('Camera access failed:', err);
      setWebcamError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera permissions in browser settings.'
          : 'Unable to open camera. Please use the Upload File button.'
      );
    }
  };

  const stopWebcam = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setIsWebcamActive(false);
  };

  const captureWebcamSnapshot = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = 300;
      canvas.height = 380;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        setPhotoUrl(dataUrl);
        stopWebcam();
      }
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        const rawData = ev.target?.result as string;
        if (rawData) {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 380;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
              const x = (canvas.width - img.width * scale) / 2;
              const y = (canvas.height - img.height * scale) / 2;
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
              setPhotoUrl(canvas.toDataURL('image/jpeg', 0.88));
            } else {
              setPhotoUrl(rawData);
            }
          };
          img.onerror = () => setPhotoUrl(rawData);
          img.src = rawData;
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFileName(file.name);
      const reader = new FileReader();
      reader.onload = ev => {
        const rawData = ev.target?.result as string;
        if (!rawData) return;
        // Downscale receipts (longest side 1280px, JPEG) so text stays
        // readable at ~150-300 KB instead of multi-MB screenshots.
        const img = new Image();
        img.onload = () => {
          const MAX_SIDE = 1280;
          const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            setReceiptUrl(canvas.toDataURL('image/jpeg', 0.82));
          } else {
            setReceiptUrl(rawData);
          }
        };
        img.onerror = () => setReceiptUrl(rawData);
        img.src = rawData;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!fullName.trim()) {
      setSubmitError('Please enter your full legal candidate name.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!receiptUrl) {
      setSubmitError('Please upload a screenshot of your completed m10 transfer receipt before submitting.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (availability?.isFull) {
      setSubmitError(
        `Registration for ${activeExam?.examDate ? formatExamDate(activeExam.examDate) : 'this exam date'} is full (${availability.registered}/${availability.capacity} spots taken). Please choose another exam date.`
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload binary files to Cloudflare R2 via /api/upload.
      // A rejected upload (e.g. over the size cap) aborts registration with a
      // clear message instead of silently embedding the file inline.
      const uploadDataUrl = async (dataUrl: string, fileName: string, uploadType: string): Promise<string> => {
        const upRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: dataUrl, fileName, uploadType })
        });
        const upData = await upRes.json().catch(() => null);
        if (!upRes.ok || !upData?.url) {
          throw new Error(upData?.error || `File upload failed (server ${upRes.status}).`);
        }
        return upData.url as string;
      };

      let persistentReceiptUrl = receiptUrl;
      if (receiptUrl.startsWith('data:')) {
        try {
          persistentReceiptUrl = await uploadDataUrl(receiptUrl, receiptFileName || 'm10-receipt.jpg', 'receipt');
        } catch (e) {
          setSubmitError(`Receipt upload rejected: ${e instanceof Error ? e.message : 'unknown error'} Please choose a smaller screenshot.`);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setIsSubmitting(false);
          return;
        }
      }

      let persistentPhotoUrl = photoUrl;
      if (photoUrl && photoUrl.startsWith('data:')) {
        try {
          persistentPhotoUrl = await uploadDataUrl(photoUrl, 'candidate-photo.jpg', 'photo');
        } catch (e) {
          setSubmitError(`Photo upload rejected: ${e instanceof Error ? e.message : 'unknown error'} Please choose a smaller photo.`);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setIsSubmitting(false);
          return;
        }
      }

      const payload = {
        candidateName: fullName.trim(),
        candidatePhotoUrl: persistentPhotoUrl,
        dateOfBirth: dob,
        gender,
        countryOfOrigin: country,
        firstLanguage: language,
        idDocumentNumber: idDocNumber || `AZE${Math.floor(10000000 + Math.random() * 90000000)}`,
        phone,
        email,
        examId: activeExam ? activeExam.id : selectedExamId,
        examTitle: activeExam ? activeExam.title : (exams?.find(e => e.id === selectedExamId)?.title || 'Official IELTS Mock Examination'),
        examSlot: activeExam?.examTime2 ? examSlot : 1,
        schemeCode,
        m10ReceiptUrl: persistentReceiptUrl,
        m10TransactionId: m10TxId || `M10-${Date.now().toString().slice(-8)}`,
        amountAzn: systemSettings?.examPriceAzn || 0
      };

      const res = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || `Registration submission failed (Status: ${res.status}). Please check your data and try again.`);
      }

      const data = await res.json();
      const savedRequest: ExamRegistrationRequest = data?.request || (data?.id ? data : null);
      if (!savedRequest || !savedRequest.id) {
        throw new Error('Registration submission failed: Server returned an invalid response.');
      }
      setSubmittedRequest(savedRequest);
      setLookupResult(savedRequest);
      setSubmitError(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setSubmittedRequest(null);
      setSubmitError(err.message || 'Registration submission failed. Please check your data and try again.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLookup = async (queryToUse?: string) => {
    const query = (queryToUse || lookupQuery).trim();
    if (!query) return;

    setIsLookingUp(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const [res] = await Promise.all([
        fetch(`/api/registrations/${encodeURIComponent(query)}`),
        refreshSettings()
      ]);
      if (!res.ok) {
        if (res.status === 404) {
          setLookupError(`No registration found matching "${query}". Please verify your reference number (e.g. REG-104928), email, or phone.`);
        } else {
          setLookupError('Unable to fetch registration status. Please try again.');
        }
        return;
      }
      const data = await res.json();
      setLookupResult(data);
    } catch (err) {
      setLookupError('Connection error while contacting registration server.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleProceedToExam = async (candidateId: string) => {
    if (!isExamOpen) return;
    try {
      const res = await fetch(`/api/sessions/${candidateId}`);
      if (res.ok) {
        const session = await res.json();
        // Two-slot days: a slot-2 candidate entering early goes through the
        // login countdown instead of jumping straight in.
        const sessExam = (exams || []).find(e => e.id === session.examId) || (activeExam && activeExam.id === session.examId ? activeExam : null);
        if (session.examSlot === 2 && sessExam?.examTime2) {
          const slot2Start = getExamSlotStartMs(sessExam, 2);
          if (slot2Start !== null && slot2Start > Date.now()) {
            onGoToLogin();
            return;
          }
        }
        onStartExam(session);
      } else {
        onGoToLogin();
      }
    } catch (e) {
      onGoToLogin();
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 text-slate-800">
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-xl shadow-md shadow-cyan-500/25">
              m10
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200">
                  Azerbaijan Official Portal
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Verified Test Center
                </span>
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                IELTS Mock Exam Registration &amp; m10 Payment
              </h1>
              <p className="text-xs text-slate-500 max-w-xl">
                Fill in your candidate details, transfer the mock test fee via <strong>m10</strong>, and upload your payment slip for instant admin approval.
              </p>
            </div>
          </div>

          <div className="flex sm:flex-col gap-2 shrink-0">
            <button
              onClick={onGoToLogin}
              className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer text-center"
            >
              Already Have Candidate ID?
            </button>
          </div>
        </div>

        {/* Tab Navigation Ribbon */}
        <div className="flex items-center bg-slate-200/70 p-1.5 rounded-2xl max-w-md mx-auto text-xs font-bold">
          <button
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2.5 px-4 rounded-xl transition cursor-pointer text-center flex items-center justify-center gap-1.5 ${activeTab === 'register'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            <FileText className="w-4 h-4" />
            <span>1. Register &amp; Pay via m10</span>
          </button>
          <button
            onClick={() => setActiveTab('lookup')}
            className={`flex-1 py-2.5 px-4 rounded-xl transition cursor-pointer text-center flex items-center justify-center gap-1.5 ${activeTab === 'lookup'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            <Search className="w-4 h-4" />
            <span>2. Check Approval Status</span>
          </button>
        </div>

        {/* TAB 1: REGISTRATION FORM */}
        {activeTab === 'register' && (
          <>
            {!activeExam && !submittedRequest ? (
              <div className="bg-white border border-slate-200/90 rounded-3xl p-8 sm:p-10 shadow-xs text-center space-y-4 animate-in fade-in">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600 shadow-2xs">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">‘Currently, there is not an active exam’</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1.5 leading-relaxed">
                    New candidate registrations are temporarily closed because there is currently no active mock examination scheduled by the administration.
                  </p>
                </div>
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('lookup')}
                    className="w-full sm:w-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    Check Existing Registration Status
                  </button>
                  <button
                    type="button"
                    onClick={onGoToLogin}
                    className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    Return to Exam Entry
                  </button>
                </div>
              </div>
            ) : submittedRequest ? (
              <div className="bg-white border-2 border-emerald-500/40 rounded-3xl p-8 shadow-sm space-y-6 text-center animate-in fade-in">
                <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Registration Submitted Successfully
                  </span>

                  <div className="pt-2">
                    <span className="text-xs text-slate-500 font-semibold block uppercase tracking-wider mb-1">
                      Your Official Registration Number
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <div className="font-mono text-2xl sm:text-3xl font-black text-orange-600 bg-orange-50 px-4 py-2 rounded-2xl border-2 border-orange-200/80 shadow-2xs select-all">
                        {submittedRequest.id}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(submittedRequest.id);
                          }
                          setCopiedRef(true);
                          setTimeout(() => setCopiedRef(false), 2500);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition cursor-pointer"
                        title="Copy Registration Number"
                      >
                        {copiedRef ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-slate-500" />
                            <span>Copy REG</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 max-w-md mx-auto pt-1 leading-relaxed">
                    Please save your registration reference number <strong className="font-mono text-slate-900">{submittedRequest.id}</strong> to check your approval status. Your candidate details and m10 receipt have been received and are pending invigilator verification.
                  </p>
                </div>

                {/* Status Box */}
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80 max-w-lg mx-auto text-left text-xs space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <span className="text-slate-500 font-semibold">Payment Status:</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                      Pending Admin Confirmation
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-slate-600">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Registration Ref:</span>
                      <strong className="font-mono text-orange-600 font-bold">{submittedRequest.id}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Candidate:</span>
                      <strong className="text-slate-900">{submittedRequest.candidateName}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Target Test:</span>
                      <strong className="text-slate-900 truncate block">{submittedRequest.examTitle}</strong>
                    </div>
                    {(submittedRequest.examDate || submittedRequest.examSlot) && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Session:</span>
                        <strong className="text-slate-900 block">
                          {submittedRequest.examDate ? formatExamDate(submittedRequest.examDate) : ''}
                          {submittedRequest.examTime ? ` · ${submittedRequest.examTime}` : ''}
                          {submittedRequest.examSlot === 2 ? ' · Slot 2' : ''}
                        </strong>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">m10 Amount:</span>
                      <strong className="text-slate-900">{submittedRequest.amountAzn} AZN</strong>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">m10 Transaction ID:</span>
                      <strong className="font-mono text-slate-900">{submittedRequest.m10TransactionId}</strong>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      setActiveTab('lookup');
                      setLookupQuery(submittedRequest.id);
                      handleLookup(submittedRequest.id);
                    }}
                    className="w-full sm:w-auto px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition shadow-sm shadow-orange-500/25 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Check Live Approval Status</span>
                  </button>

                  <button
                    onClick={() => {
                      setSubmittedRequest(null);
                      setFullName('');
                      setReceiptUrl('');
                      setReceiptFileName('');
                      setSubmitError(null);
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition"
                  >
                    Register Another Candidate
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitRegistration} className="space-y-6">
                {submitError && (
                  <div
                    id="registration-submit-error"
                    role="alert"
                    className="p-4 sm:p-5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-xs text-rose-800 shadow-xs flex items-start justify-between gap-3 animate-in fade-in"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center shrink-0 text-rose-600 mt-0.5">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <strong className="font-bold text-sm text-rose-950 block">
                          Registration Submission Failed
                        </strong>
                        <p className="text-xs text-rose-700 leading-relaxed font-medium">
                          {submitError}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubmitError(null)}
                      className="p-1 rounded-lg text-rose-400 hover:text-rose-700 hover:bg-rose-100 transition cursor-pointer shrink-0"
                      title="Dismiss error message"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Section 1: Candidate Bio-Data */}
                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">1. Candidate Information</h2>
                      <p className="text-xs text-slate-500">Provide official details as shown on your passport or identity card.</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      Step 1 of 3
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Full Legal Name (Passport / National ID) *
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        placeholder="Full legal name as shown on Passport / ID"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Date of Birth *
                      </label>
                      <input
                        type="date"
                        value={dob}
                        onChange={e => setDob(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Sex / Gender *
                      </label>
                      <select
                        value={gender}
                        onChange={e => setGender(e.target.value as any)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="M">Male (M)</option>
                        <option value="F">Female (F)</option>
                        <option value="Other">Other / Unspecified</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Country / Region of Origin *
                      </label>
                      <input
                        type="text"
                        value={country}
                        onChange={e => setCountry(e.target.value)}
                        placeholder="e.g. Azerbaijan"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        First Language (Mother Tongue) *
                      </label>
                      <input
                        type="text"
                        value={language}
                        onChange={e => setLanguage(e.target.value)}
                        placeholder="e.g. Azerbaijani"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Passport / National ID Number
                      </label>
                      <input
                        type="text"
                        value={idDocNumber}
                        onChange={e => setIdDocNumber(e.target.value)}
                        placeholder="e.g. AZE20918237"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Mobile Phone / WhatsApp (For confirmation) *
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="+994 50 123 45 67"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="candidate@example.com"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Active Examination Form
                      </label>
                      {activeExam ? (
                        <div className="p-3 bg-orange-50/80 border border-orange-200 rounded-xl space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-200 text-orange-900">
                                  {activeExam.code || activeExam.id}
                                </span>
                                <span className="text-xs font-bold text-slate-900">{activeExam.title}</span>
                              </div>
                              <p className="text-[11px] text-slate-500 line-clamp-1">{activeExam.description || 'Official 4-module IELTS Examination'}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                              Active
                            </span>
                          </div>
                          {activeExam.examDate && (
                            <div className="pt-2 border-t border-orange-200/70 text-[11px] space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-slate-600">
                                  Exam date: <strong className="text-slate-900">{formatExamDate(activeExam.examDate)}{activeExam.examTime ? ` · ${activeExam.examTime}` : ''}{activeExam.examTime2 ? ` · ${activeExam.examTime2}` : ''}</strong>
                                </span>
                                {availability ? (
                                  availability.isFull ? (
                                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">
                                      Full — registration closed for this date
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                                      {availability.spotsLeft} of {availability.capacity} spots left today
                                    </span>
                                  )
                                ) : (
                                  <span className="text-slate-400">Checking seats…</span>
                                )}
                              </div>
                              {activeExam.examTime2 && (
                                <div>
                                  <span className="block text-slate-600 font-bold uppercase text-[10px] mb-1">
                                    Choose your time slot *
                                  </span>
                                  <div className="grid grid-cols-2 gap-2">
                                    {([1, 2] as const).map(slot => {
                                      const time = slot === 2 ? activeExam.examTime2! : (activeExam.examTime || '—');
                                      const taken = availability?.bySlot ? (slot === 2 ? availability.bySlot.slot2 : availability.bySlot.slot1) : undefined;
                                      const selected = examSlot === slot;
                                      return (
                                        <button
                                          key={slot}
                                          type="button"
                                          onClick={() => setExamSlot(slot)}
                                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                                            selected
                                              ? 'border-orange-500 bg-orange-50/60 ring-1 ring-orange-500/30'
                                              : 'border-slate-200 bg-white hover:bg-slate-50'
                                          }`}
                                        >
                                          <span className={`block text-xs font-bold ${selected ? 'text-orange-900' : 'text-slate-800'}`}>
                                            Slot {slot} — {time}
                                          </span>
                                          <span className="block text-[10px] text-slate-500 mt-0.5">
                                            {taken !== undefined ? `${taken} registered` : 'Baku time'}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-semibold">
                          ‘Currently, there is not an active exam’
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 2: Biometric Identity Photo */}
                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">2. Biometric Passport Photograph</h2>
                      <p className="text-xs text-slate-500">Take a live photo via webcam or upload a standard passport picture (35x45mm).</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      Step 2 of 3
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
                    <div className="sm:col-span-5 flex flex-col items-center">
                      <div className="relative w-44 h-56 rounded-2xl border-2 border-slate-300 overflow-hidden bg-slate-100 shadow-sm flex items-center justify-center">
                        {isWebcamActive ? (
                          <div className="relative w-full h-full bg-slate-900">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 border-2 border-orange-400/70 rounded-full m-3 pointer-events-none flex items-center justify-center">
                              <span className="text-[9px] text-white/90 bg-black/60 px-2 py-0.5 rounded-full font-mono">
                                Align Face
                              </span>
                            </div>
                          </div>
                        ) : photoUrl ? (
                          <img
                            src={photoUrl}
                            alt="Candidate Identity"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                            <User className="w-12 h-12 mb-2 text-slate-300" />
                            <span className="text-[11px] font-medium">No photo selected</span>
                            <span className="text-[10px] text-slate-400">Capture or upload photo</span>
                          </div>
                        )}
                      </div>

                      {webcamError && (
                        <p className="text-[11px] text-rose-600 font-medium mt-2 text-center">{webcamError}</p>
                      )}
                    </div>

                    <div className="sm:col-span-7 space-y-3 text-xs">
                      {isWebcamActive ? (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={captureWebcamSnapshot}
                            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                          >
                            <Camera className="w-4 h-4" />
                            <span>Capture Photo Snapshot</span>
                          </button>
                          <button
                            type="button"
                            onClick={stopWebcam}
                            className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition cursor-pointer"
                          >
                            Cancel Camera
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={startWebcam}
                            className="w-full py-2.5 px-4 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <Camera className="w-4 h-4" />
                            <span>Take Live Webcam Photo</span>
                          </button>

                          <label className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs">
                            <Upload className="w-4 h-4 text-slate-400" />
                            <span>Upload Passport Photo File</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handlePhotoUpload}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 3: m10 Mobile Payment & Receipt Upload */}
                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">3. Payment via m10 &amp; Receipt Upload</h2>
                      <p className="text-xs text-slate-500">Transfer exam fee to our official m10 account and upload your payment slip.</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200">
                      Step 3 of 3
                    </span>
                  </div>

                  {/* m10 Official Card & Instructions */}
                  <div className="bg-gradient-to-br from-cyan-50 via-sky-50 to-blue-50 border border-cyan-200 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 rounded-xl bg-cyan-600 text-white font-black text-xl flex items-center justify-center shadow-md shadow-cyan-600/30">
                          m10
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-cyan-800 tracking-wider">Official Payment Receiver</span>
                          <div className="text-base font-black text-slate-900">
                            {systemSettings?.m10AccountHolder || 'Awaiting Admin Definition'}
                          </div>
                        </div>
                      </div>

                      <div className="bg-white px-4 py-2 rounded-xl border border-cyan-200 shadow-2xs text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Registration Fee</span>
                        <span className="text-lg font-black text-cyan-700 font-mono">
                          {systemSettings?.examPriceAzn != null ? `${systemSettings.examPriceAzn} AZN` : 'Fee Defined by Admin'}
                        </span>
                      </div>
                    </div>

                    {systemSettings?.isConfigured ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-white/80 p-3.5 rounded-xl border border-cyan-200/60">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">m10 Mobile Number:</span>
                            <strong className="text-slate-900 font-mono text-sm">{systemSettings.m10PhoneNumber}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">Account Holder:</span>
                            <strong className="text-slate-900">{systemSettings.m10AccountHolder}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">Bank / System:</span>
                            <strong className="text-cyan-700 font-bold">m10 (PashaPay)</strong>
                          </div>
                        </div>

                        <ol className="list-decimal list-inside text-xs text-slate-700 space-y-1.5 leading-relaxed pl-1">
                          <li>Open your <strong>m10 mobile app</strong> on your phone.</li>
                          <li>Go to <strong>Pul köçür / Transfer</strong> and send <strong>{systemSettings.examPriceAzn} AZN</strong> to <code>{systemSettings.m10PhoneNumber}</code>.</li>
                          <li>Take a screenshot of the completed transfer receipt / receipt slip and upload it below.</li>
                        </ol>
                      </>
                    ) : (
                      <div className="p-3.5 bg-cyan-100/60 border border-cyan-200 rounded-xl text-xs text-cyan-900 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-cyan-700 shrink-0 mt-0.5" />
                        <div>
                          <strong className="block font-semibold">Payment Parameters to be Defined by Admin</strong>
                          <span>The official exam fee and m10 transfer account are managed dynamically by the IELTS administrator in the Admin Panel.</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Receipt Upload Box */}
                  <div className="space-y-3">
                    <label className="block text-slate-700 font-bold uppercase text-[10px]">
                      Upload m10 Payment Receipt Screenshot (PNG/JPG) *
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                      <div className="sm:col-span-8">
                        <label className="border-2 border-dashed border-slate-300 hover:border-orange-400 rounded-2xl p-4 bg-slate-50 flex items-center justify-center gap-3 cursor-pointer transition text-center">
                          <Upload className="w-5 h-5 text-orange-500" />
                          <div className="text-left text-xs">
                            <span className="font-bold text-slate-800 block">
                              {receiptFileName || 'Click to select m10 receipt screenshot'}
                            </span>
                            <span className="text-[11px] text-slate-500">Supports PNG, JPG, JPEG from phone gallery</span>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleReceiptUpload}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          value={m10TxId}
                          onChange={e => setM10TxId(e.target.value)}
                          placeholder="m10 Transaction Code (optional)"
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono text-xs uppercase focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                    </div>

                    {/* Receipt Preview if uploaded */}
                    {receiptUrl && (
                      <div className="p-3 bg-slate-100 rounded-2xl border border-slate-200 flex items-center gap-3">
                        <img
                          src={receiptUrl}
                          alt="m10 Receipt Preview"
                          className="w-16 h-20 object-cover rounded-lg border border-slate-300 shadow-2xs"
                        />
                        <div className="text-xs">
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Receipt attached successfully
                          </span>
                          <span className="text-slate-500 block text-[11px]">Ready for administrator verification</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Submit Area with Error & Loading Feedback */}
                {submitError && (
                  <div
                    role="alert"
                    className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl text-xs text-rose-800 flex items-start gap-3 animate-in fade-in"
                  >
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <strong className="font-bold block text-sm text-rose-900">Registration Submission Failed</strong>
                      <span className="font-medium text-rose-700">{submitError}</span>
                    </div>
                  </div>
                )}

                {/* Final Submit Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-4 px-6 bg-gradient-to-r from-orange-500 via-orange-600 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold rounded-2xl text-sm transition shadow-md shadow-orange-500/25 active:scale-[0.99] disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Uploading receipt &amp; submitting registration...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Submit Registration &amp; Send Receipt to Admin</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-slate-400 text-center mt-2">
                    Our invigilator team will check your m10 receipt and confirm your Candidate ID within 15 minutes.
                  </p>
                </div>
              </form>
            )}
          </>
        )}

        {/* TAB 2: LOOKUP REGISTRATION STATUS */}
        {activeTab === 'lookup' && (
          <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Check Registration &amp; Payment Status</h2>
              <p className="text-xs text-slate-500">
                Enter your Registration Reference, email address, or mobile number.
              </p>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                handleLookup();
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={lookupQuery}
                  onChange={e => setLookupQuery(e.target.value)}
                  placeholder="Enter REG reference, phone, or email..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <button
                type="submit"
                disabled={isLookingUp}
                className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isLookingUp ? 'Searching...' : 'Check Status'}
              </button>
            </form>

            {lookupError && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{lookupError}</span>
              </div>
            )}

            {lookupResult && (
              <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50/70 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
                  <div>
                    <span className="font-mono text-xs font-black text-orange-600 bg-orange-100 px-2 py-0.5 rounded border border-orange-200">
                      {lookupResult.id}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900 mt-1">{lookupResult.candidateName}</h3>
                    <p className="text-xs text-slate-500">
                      {lookupResult.examTitle}
                      {(lookupResult as ExamRegistrationRequest).examSlot === 2 ? ' · Slot 2' : ''}
                    </p>
                  </div>

                  <div>
                    {lookupResult.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approved &amp; Candidate ID Issued
                      </span>
                    ) : lookupResult.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        <X className="w-3.5 h-3.5" />
                        Receipt Verification Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-3.5 h-3.5 animate-spin" />
                        Pending Admin Confirmation
                      </span>
                    )}
                  </div>
                </div>

                {/* Candidate details & photo */}
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 text-xs">
                  <img
                    src={lookupResult.candidatePhotoUrl}
                    alt={lookupResult.candidateName}
                    className="w-16 h-20 object-cover rounded-lg border border-slate-300 shadow-2xs shrink-0"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">m10 Amount:</span>
                      <strong className="text-slate-800">{lookupResult.amountAzn} AZN</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Transaction ID:</span>
                      <strong className="font-mono text-slate-800">{lookupResult.m10TransactionId || 'Pending'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Submitted At:</span>
                      <span className="text-slate-600">{formatDateLong(lookupResult.submittedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* If approved, show prominent candidate credentials and gate-controlled action */}
                {lookupResult.status === 'approved' && lookupResult.approvedCandidateId && (
                  <div className="space-y-4">
                    {/* Candidate Authentication Card */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center space-y-3">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Official Candidate Authentication Granted
                      </div>

                      <div>
                        <span className="text-[11px] text-slate-500 font-semibold block uppercase tracking-wider mb-1">
                          Your Official Candidate ID
                        </span>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <div className="font-mono text-2xl sm:text-3xl font-black text-orange-600 bg-white px-4 py-2 rounded-2xl border-2 border-orange-200/80 shadow-2xs select-all">
                            {lookupResult.approvedCandidateId}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (navigator.clipboard?.writeText) {
                                navigator.clipboard.writeText(lookupResult.approvedCandidateId!);
                              }
                              setCopiedCandidateId(true);
                              setTimeout(() => setCopiedCandidateId(false), 2500);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition cursor-pointer"
                            title="Copy Candidate ID"
                          >
                            {copiedCandidateId ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                <span className="text-emerald-700 font-bold">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 text-slate-500" />
                                <span>Copy ID</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                        Your m10 payment has been confirmed by the exam administration. Your candidate seat is officially verified.
                      </p>

                      {/* ─── CASE 1: EXAM IS OPEN -> Show Start Exam button ─── */}
                      {isExamOpen && (
                        <div className="pt-2 space-y-3">
                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-bold shadow-2xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Exam Session is OPEN</span>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => handleProceedToExam(lookupResult.approvedCandidateId!)}
                              className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm hover:shadow cursor-pointer"
                            >
                              <span>Start Examination Now</span>
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ─── CASE 2: EXAM IS IN COUNTDOWN -> Show Live Countdown, DO NOT show Start Exam button ─── */}
                    {isCountdown && (
                      <div className="bg-amber-50 border-2 border-amber-300/80 rounded-2xl p-6 text-center space-y-4 animate-in fade-in">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center mx-auto text-amber-600 shadow-2xs">
                          <Calendar className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-lg font-black text-slate-900 tracking-tight">Exam Starts Soon</h4>
                          {scheduledAtTime && (
                            <p className="text-xs text-slate-600 mt-0.5">
                              Scheduled for <strong className="text-slate-900 font-semibold">{scheduledAtTime ? formatDateTime(scheduledAtTime) : ''}</strong>
                            </p>
                          )}
                        </div>

                        <div className="bg-white border-2 border-amber-200 rounded-2xl p-5 max-w-sm mx-auto shadow-xs space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Time Until Exam Opens</p>
                          <div className="font-mono text-4xl sm:text-5xl font-black text-slate-900 tracking-tight tabular-nums">
                            {formatCountdown(countdownSeconds)}
                          </div>
                          <p className="text-[10px] text-slate-400">HH : MM : SS</p>
                        </div>

                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-center gap-1.5 text-amber-800 font-semibold">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            <span>Gate opens automatically when countdown reaches zero</span>
                          </div>
                          <p className="text-slate-500 max-w-md mx-auto text-[11px] leading-relaxed">
                            The <strong>Start Examination</strong> button will appear here once the countdown completes. Please remain seated and keep your Candidate ID ready.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ─── CASE 3: EXAM IS CLOSED -> Show Closed Notice, DO NOT show Start Exam button ─── */}
                    {isExamClosed && (
                      <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-6 text-center space-y-4 animate-in fade-in">
                        <div className="w-12 h-12 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center mx-auto text-rose-600 shadow-2xs">
                          <Lock className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-lg font-black text-slate-900 tracking-tight">Exam Access Closed</h4>
                          <p className="text-xs text-rose-700 max-w-md mx-auto mt-1 leading-relaxed font-medium">
                            The examination portal is currently <strong className="text-rose-900 font-bold">closed</strong> by the test center administration.
                          </p>
                        </div>

                        <div className="bg-white border border-rose-200 rounded-2xl p-4 max-w-md mx-auto text-left text-xs space-y-2 shadow-2xs">
                          <div className="flex items-start gap-2 text-slate-600">
                            <Shield className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            <span>Your candidate verification is complete and your seat is reserved.</span>
                          </div>
                          <div className="flex items-start gap-2 text-slate-600">
                            <Lock className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            <span>The <strong>Start Examination</strong> button is disabled until the Chief Proctor opens the exam session.</span>
                          </div>
                        </div>

                        <div className="pt-1 flex flex-col sm:flex-row items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleLookup(lookupResult.id);
                            }}
                            className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Refresh Gate Status</span>
                          </button>
                          <button
                            type="button"
                            onClick={onGoToLogin}
                            className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                          >
                            Return to Exam Entry
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* If rejected, show reason */}
                {lookupResult.status === 'rejected' && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-800 space-y-1">
                    <strong>Admin Verification Note:</strong>
                    <p>{lookupResult.rejectionReason || 'Receipt was not verified on m10. Please contact administration.'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
