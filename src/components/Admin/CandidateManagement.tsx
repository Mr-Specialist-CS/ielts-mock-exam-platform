import React, { useState, useEffect, useRef } from 'react';
import { CandidateAvatar } from '../CandidateAvatar';
import { DateField } from '../DateField';
import {
  Users,
  UserPlus,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  Camera,
  Upload,
  X,
  User,
  Edit,
  Check,
  Sparkles,
  FileBadge,
  FileCheck2,
  Award
} from 'lucide-react';
import { CandidateSession, Exam, CandidateProfileData } from '../../types';
import { isSessionAllGradesFinalized, getSessionGradingProgress } from '../../utils/ieltsScoring';

interface CandidateManagementProps {
  sessions: CandidateSession[];
  exams?: Exam[];
  activeExamId?: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onResetSession: (candidateId: string) => Promise<void>;
  onCreateCandidate: (profile: CandidateProfileData) => Promise<void>;
  onUpdateCandidateProfile?: (candidateId: string, profile: Partial<CandidateProfileData>) => Promise<void>;
  onFinalizeExam?: (candidateId: string) => Promise<void>;
  onOpenTrf?: (session: CandidateSession) => void;
  onRefreshSessions: () => Promise<void>;
}

export const CandidateManagement: React.FC<CandidateManagementProps> = ({
  sessions,
  exams,
  activeExamId,
  onSelectCandidate,
  onResetSession,
  onCreateCandidate,
  onUpdateCandidateProfile,
  onFinalizeExam,
  onOpenTrf,
  onRefreshSessions
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<string | null>(null);

  // Candidate Registration & Profile Form State
  const [formName, setFormName] = useState('');
  const [formDigits, setFormDigits] = useState('');
  const [formPhoto, setFormPhoto] = useState('');
  const [formDob, setFormDob] = useState('');
  const [formGender, setFormGender] = useState<'M' | 'F' | 'Other'>('M');
  const [formCountry, setFormCountry] = useState('Azerbaijan');
  const [formLanguage, setFormLanguage] = useState('Azerbaijani');
  const [formIdDoc, setFormIdDoc] = useState('');
  const [formScheme, setFormScheme] = useState<'Academic Standard' | 'General Training'>('Academic Standard');
  const [formCentre, setFormCentre] = useState('AZ001 - Baku Official IELTS Test Center');
  const [formExamId, setFormExamId] = useState<string>(activeExamId || (exams && exams[0]?.id) || '');
  const [formExamSlot, setFormExamSlot] = useState<1 | 2>(1);

  // Webcam Capture State
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (activeExamId) setFormExamId(activeExamId);
    else if (exams && exams.length > 0 && !formExamId) setFormExamId(exams[0].id);
  }, [activeExamId, exams]);

  // Cleanup webcam stream on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Ensure webcam stream attaches to video element as soon as video tag renders
  useEffect(() => {
    if (isWebcamActive && videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      videoRef.current.play().catch(err => {
        console.warn('Video play interrupted:', err);
      });
    }
  }, [isWebcamActive]);

  const openCreateModal = () => {
    stopWebcam();
    setEditingCandidateId(null);
    const sixDigits = Math.floor(100000 + Math.random() * 900000).toString();
    setFormName('');
    setFormDigits(sixDigits);
    setFormPhoto('');
    setFormDob('');
    setFormGender('M');
    setFormCountry('Azerbaijan');
    setFormLanguage('Azerbaijani');
    setFormIdDoc('');
    setFormScheme('Academic Standard');
    setFormCentre('AZ001 - Baku Official IELTS Test Center');
    setFormExamId(activeExamId || (exams && exams[0]?.id) || '');
    setFormExamSlot(1);
    setIsModalOpen(true);
  };

  const openEditModal = (sess: CandidateSession) => {
    stopWebcam();
    setEditingCandidateId(sess.candidateId);
    setFormName(sess.candidateName);
    setFormDigits(sess.candidateId.replace(/[^0-9]/g, ''));
    setFormPhoto(sess.candidatePhotoUrl || '');
    setFormDob(sess.dateOfBirth || '');
    setFormGender((sess.gender as any) || 'M');
    setFormCountry(sess.countryOfOrigin || 'Azerbaijan');
    setFormLanguage(sess.firstLanguage || 'Azerbaijani');
    setFormIdDoc(sess.idDocumentNumber || '');
    setFormScheme((sess.schemeCode as any) || 'Academic Standard');
    setFormCentre(sess.centreNumber || 'AZ001 - Baku Official IELTS Test Center');
    setFormExamId(sess.examId || activeExamId || (exams && exams[0]?.id) || '');
    setFormExamSlot(sess.examSlot === 2 ? 2 : 1);
    setIsModalOpen(true);
  };

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
      if (err.name === 'NotAllowedError') {
        setWebcamError('Camera permission denied. Please allow camera access in browser bar.');
      } else {
        setWebcamError('Unable to open camera. Please use the Upload File button instead.');
      }
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
        setFormPhoto(dataUrl);
        stopWebcam();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        const rawData = ev.target?.result as string;
        if (rawData) {
          // Standardize and crop as passport photo (300x380 px) via canvas
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
              setFormPhoto(canvas.toDataURL('image/jpeg', 0.88));
            } else {
              setFormPhoto(rawData);
            }
          };
          img.onerror = () => setFormPhoto(rawData);
          img.src = rawData;
        }
      };
      reader.readAsDataURL(file);
      e.target.value = ''; // allow selecting same file again
    }
  };

  const handleSaveCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    setIsSubmitting(true);
    try {
      let persistentPhoto = formPhoto;
      if (formPhoto && formPhoto.startsWith('data:')) {
        try {
          const upRes = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: formPhoto,
              fileName: 'candidate-photo.jpg',
              uploadType: 'photo'
            })
          });
          if (upRes.ok) {
            const upData = await upRes.json();
            if (upData.url) persistentPhoto = upData.url;
          }
        } catch (e) {
          console.warn('Candidate photo upload to R2 fell back:', e);
        }
      }

      const profileData: CandidateProfileData = {
        candidateName: formName.trim(),
        candidateId: `IG-${formDigits.replace(/[^0-9]/g, '') || '104822'}`,
        candidatePhotoUrl: persistentPhoto,
        dateOfBirth: formDob,
        gender: formGender,
        countryOfOrigin: formCountry,
        firstLanguage: formLanguage,
        idDocumentNumber: formIdDoc,
        centreNumber: formCentre,
        schemeCode: formScheme,
        examId: formExamId,
        examSlot: formExamSlot
      };

      if (editingCandidateId && onUpdateCandidateProfile) {
        await onUpdateCandidateProfile(editingCandidateId, profileData);
      } else {
        await onCreateCandidate(profileData);
      }
      stopWebcam();
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = sessions.filter(s =>
    s.candidateName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.candidateId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleReset = async (cId: string) => {
    setIsResetting(cId);
    await onResetSession(cId);
    setIsResetting(null);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefreshSessions();
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200/90 p-5 rounded-2xl shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Candidate Roster &amp; Invigilator Monitor</h2>
            <p className="text-xs text-slate-500">Manage candidate sessions, monitor tab-switch violations, and reset locks.</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Roster</span>
          </button>

          <button
            onClick={openCreateModal}
            className="flex items-center space-x-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Issue Candidate ID</span>
          </button>
        </div>
      </div>

      {/* Search & Statistics Ribbon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search candidate name or ID..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700 shadow-2xs">
            Total: <strong>{sessions.length}</strong>
          </span>
          <span className="px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
            Locked: <strong>{sessions.filter(s => s.lockStatus.isLocked).length}</strong>
          </span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
            Finalized: <strong>{sessions.filter(s => s.grading.isFinalized).length}</strong>
          </span>
        </div>
      </div>

      {/* Candidate Sessions Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Candidate</th>
                <th className="px-4 py-3">Candidate ID</th>
                <th className="px-4 py-3">Current Section</th>
                <th className="px-4 py-3">Integrity Status</th>
                <th className="px-4 py-3">Overall Band</th>
                <th className="px-5 py-3 text-right">Invigilator Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(s => {
                const isLocked = s.lockStatus.isLocked || s.status === 'hard_locked';
                const violations = s.lockStatus.violations;

                return (
                  <tr key={s.candidateId} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-4">
                      <div className="flex items-center space-x-3">
                        <CandidateAvatar
                          name={s.candidateName}
                          photoUrl={s.candidatePhotoUrl}
                          className="w-8 h-8 rounded-lg border border-slate-200"
                          textClassName="text-xs"
                        />
                        <div>
                          <div className="font-bold text-slate-900">{s.candidateName}</div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{s.examTitle}</div>
                          {(() => {
                            const sessExam = (exams || []).find(e => e.id === s.examId);
                            if (!sessExam?.examTime2) return null;
                            const slot = s.examSlot === 2 ? 2 : 1;
                            const time = slot === 2 ? sessExam.examTime2 : (sessExam.examTime || '—');
                            return (
                              <span className={`inline-block mt-0.5 font-mono text-[10px] font-bold px-1.5 py-px rounded border ${
                                slot === 2
                                  ? 'text-violet-700 bg-violet-50 border-violet-200'
                                  : 'text-slate-500 bg-slate-100 border-slate-200'
                              }`}>
                                Slot {slot} · {time}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-mono font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg">
                          {s.candidateId}
                        </span>
                        {s.registrationId && (
                          <span className="font-mono text-[10px] text-slate-500" title="Issued from this registration">
                            ← {s.registrationId}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 capitalize">
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                        {s.currentSection}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      {isLocked ? (
                        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px]">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>HARD LOCKED ({violations} violations)</span>
                        </div>
                      ) : violations > 0 ? (
                        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium text-[11px]">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>1 Warning Triggered</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium text-[11px]">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Clean Session</span>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-4 font-mono">
                      {(() => {
                        const isAllFin = isSessionAllGradesFinalized(s);
                        const progress = getSessionGradingProgress(s);

                        if (isAllFin && s.grading.finalOverallBand !== undefined) {
                          return (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>{s.grading.finalOverallBand.toFixed(1)} Band</span>
                              </span>
                              <span className="text-[10px] text-emerald-600 font-sans block font-semibold">TRF Certified</span>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[10px]">
                              <span className={`px-1.5 py-0.2 rounded font-bold ${progress.hasListening ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                                L:{progress.hasListening ? progress.listeningBand?.toFixed(1) : '—'}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded font-bold ${progress.hasReading ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                                R:{progress.hasReading ? progress.readingBand?.toFixed(1) : '—'}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded font-bold ${progress.hasWriting ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                W:{progress.hasWriting ? progress.writingBand?.toFixed(1) : '⏳'}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded font-bold ${progress.hasSpeaking ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                S:{progress.hasSpeaking ? progress.speakingBand?.toFixed(1) : '⏳'}
                              </span>
                            </div>
                            <span className="text-[10px] font-semibold text-amber-700 block font-sans">
                              {progress.missingModules.length === 0 ? 'Ready to Finalize' : `Pending: ${progress.missingModules.join(', ')}`}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-5 py-4 text-right space-x-2">
                      {/* Reset Session Button */}
                      {isLocked && (
                        <button
                          onClick={() => handleReset(s.candidateId)}
                          disabled={isResetting === s.candidateId}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-[11px] transition shadow-2xs cursor-pointer"
                          title="Manually unlock candidate and allow resumption from saved state"
                        >
                          {isResetting === s.candidateId ? 'Clearing Lock...' : 'Reset Session'}
                        </button>
                      )}

                      {/* Finalize All Grades & Issue TRF button.
                          Certifies ONLY with both examiner confirmations (writing + speaking).
                          Hidden once fully certified; disabled while confirmations are pending. */}
                      {(() => {
                        if (!onFinalizeExam || isSessionAllGradesFinalized(s)) return null;
                        const pending: string[] = [];
                        if (!s.grading.listeningScore) pending.push('listening');
                        if (!s.grading.readingScore) pending.push('reading');
                        if (!s.grading.writingAdminEvaluation) pending.push('writing examiner confirmation');
                        if (!s.grading.speakingEvaluation) pending.push('speaking examiner confirmation');
                        const ready = pending.length === 0;
                        return (
                          <button
                            onClick={async () => {
                              setIsFinalizing(s.candidateId);
                              try {
                                await onFinalizeExam(s.candidateId);
                              } finally {
                                setIsFinalizing(null);
                              }
                            }}
                            disabled={isFinalizing === s.candidateId || !ready}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-2xs transition cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={ready ? 'Finalize grades and issue official TRF certificate' : `Pending examiner confirmation: ${pending.join(', ')}`}
                          >
                            <Award className="w-3 h-3" />
                            <span>{isFinalizing === s.candidateId ? 'Finalizing...' : 'Finalize Grades'}</span>
                          </button>
                        );
                      })()}

                      {/* View TRF Modal Button for Finalized candidates */}
                      {s.grading.isFinalized && isSessionAllGradesFinalized(s) && onOpenTrf && (
                        <button
                          onClick={() => onOpenTrf(s)}
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold shadow-2xs transition cursor-pointer inline-flex items-center gap-1"
                          title="View and print official Test Report Form (TRF)"
                        >
                          <FileCheck2 className="w-3 h-3 text-emerald-600" />
                          <span>View TRF</span>
                        </button>
                      )}

                      <button
                        onClick={() => openEditModal(s)}
                        className="px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg text-[11px] font-semibold border border-orange-200 transition cursor-pointer inline-flex items-center gap-1"
                        title="Edit candidate photo, personal details & assigned exam"
                      >
                        <Camera className="w-3 h-3" />
                        <span>Edit Photo &amp; Info</span>
                      </button>

                      <button
                        onClick={() => onSelectCandidate(s.candidateId)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition cursor-pointer"
                      >
                        Manage &amp; Grade
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden canvas for webcam frame snapshot capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* IELTS Official Candidate Registration & Profile Studio Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="max-w-3xl w-full bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden my-auto text-slate-800">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  <FileBadge className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {editingCandidateId ? 'Edit Candidate Profile & Identity Photo' : 'IELTS Official Candidate Registration'}
                    </h3>
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800">
                      IG-{formDigits || 'NEW'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    British Council &amp; IDP standard candidate registration with verified identity photo.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  stopWebcam();
                  setIsModalOpen(false);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCandidate} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                {/* Left Column: Passport Photo Studio (5 cols) */}
                <div className="md:col-span-5 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3.5 text-center">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    <span>Identity Photograph</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      35x45mm Official
                    </span>
                  </div>

                  {/* Photo Frame / Live Webcam Preview */}
                  <div className="relative w-full h-52 rounded-xl border-2 border-dashed border-slate-300 overflow-hidden bg-slate-100 flex items-center justify-center shadow-2xs">
                    {isWebcamActive ? (
                      <div className="relative w-full h-full bg-slate-900 flex items-center justify-center">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 border-2 border-orange-400/60 rounded-full m-4 pointer-events-none flex items-center justify-center">
                          <span className="text-[10px] text-white/80 bg-slate-900/60 px-2 py-0.5 rounded-full font-mono">
                            Align Face Here
                          </span>
                        </div>
                      </div>
                    ) : formPhoto ? (
                      <img
                        src={formPhoto}
                        alt="Candidate Identity"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                        <User className="w-10 h-10 mb-1 text-slate-300" />
                        <span className="text-[11px] font-medium">No photo selected</span>
                      </div>
                    )}
                  </div>

                  {webcamError && (
                    <p className="text-[11px] text-rose-600 font-medium">{webcamError}</p>
                  )}

                  {/* Camera / Upload Controls */}
                  <div className="space-y-2 pt-1">
                    {isWebcamActive ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={captureWebcamSnapshot}
                          className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Capture Photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={stopWebcam}
                          className="py-2 px-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={startWebcam}
                          className="py-2 px-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Take Webcam</span>
                        </button>

                        <label className="py-2 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs">
                          <Upload className="w-3.5 h-3.5 text-slate-400" />
                          <span>Upload File</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Official Candidate Credentials (7 cols) */}
                <div className="md:col-span-7 space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                      Full Legal Candidate Name (Passport / National ID)
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="Full legal candidate name"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Candidate Number (Fixed IG-)
                      </label>
                      <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                        <span className="px-2.5 py-2 bg-orange-100 text-orange-800 font-mono font-bold select-none text-xs flex items-center">
                          IG-
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={8}
                          value={formDigits}
                          onChange={e => setFormDigits(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="123456"
                          className="w-full p-2 bg-transparent text-slate-900 font-mono font-bold focus:outline-none"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Sex / Gender
                      </label>
                      <select
                        value={formGender}
                        onChange={e => setFormGender(e.target.value as any)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="M">Male (M)</option>
                        <option value="F">Female (F)</option>
                        <option value="Other">Other / Unspecified</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Date of Birth
                      </label>
                        <DateField
                          value={formDob}
                          outputFormat="dmy"
                          onChange={v => setFormDob(v || '')}
                        />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Country / Region of Origin
                      </label>
                      <input
                        type="text"
                        value={formCountry}
                        onChange={e => setFormCountry(e.target.value)}
                        placeholder="Country of origin"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        First Language
                      </label>
                      <input
                        type="text"
                        value={formLanguage}
                        onChange={e => setFormLanguage(e.target.value)}
                        placeholder="First language"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Passport / National ID Number
                      </label>
                      <input
                        type="text"
                        value={formIdDoc}
                        onChange={e => setFormIdDoc(e.target.value)}
                        placeholder="ID / Passport document number"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                      Assigned Examination Form
                    </label>
                    <select
                      value={formExamId}
                      onChange={e => { setFormExamId(e.target.value); setFormExamSlot(1); }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {exams && exams.map(ex => (
                        <option key={ex.id} value={ex.id}>
                          {ex.code ? `[${ex.code}] ` : ''}{ex.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(() => {
                    const selExam = (exams || []).find(e => e.id === formExamId);
                    if (!selExam?.examTime2) return null;
                    return (
                      <div>
                        <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                          Time Slot (two sessions this day)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {([1, 2] as const).map(slot => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setFormExamSlot(slot)}
                              className={`p-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                                formExamSlot === slot
                                  ? 'border-orange-500 bg-orange-50/60 text-orange-900 ring-1 ring-orange-500/30'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              Slot {slot} — {slot === 2 ? selExam.examTime2 : (selExam.examTime || '—')}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Test Scheme
                      </label>
                      <select
                        value={formScheme}
                        onChange={e => setFormScheme(e.target.value as any)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="Academic Standard">Academic Standard</option>
                        <option value="General Training">General Training</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                        Test Center Venue
                      </label>
                      <input
                        type="text"
                        value={formCentre}
                        onChange={e => setFormCentre(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    stopWebcam();
                    setIsModalOpen(false);
                  }}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? 'Saving Profile...'
                      : editingCandidateId
                      ? 'Update Candidate Profile'
                      : 'Register & Issue Candidate ID'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
