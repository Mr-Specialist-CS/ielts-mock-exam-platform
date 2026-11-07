import React, { useState, useEffect, useRef } from 'react';
import { Mic, Clock, Play, Pause, RotateCcw, CheckCircle2, User, HelpCircle, Volume2, Search, Square, Upload, Trash2, AlertCircle } from 'lucide-react';
import { CandidateSession, SpeakingEvaluation } from '../../types';
import { CandidateAvatar } from '../CandidateAvatar';
import { getAdminAuthHeaders, getAuthenticatedFileUrl } from '../../utils/adminAuth';

interface SpeakingExaminerRoomProps {
  candidates: CandidateSession[];
  selectedCandidateId: string;
  onSelectCandidate: (id: string) => void;
  onSaveSpeakingGrade: (candidateId: string, evaluation: SpeakingEvaluation) => Promise<void>;
}

export const SpeakingExaminerRoom: React.FC<SpeakingExaminerRoomProps> = ({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
  onSaveSpeakingGrade
}) => {
  const currentCandidate = candidates.find(c => c.candidateId === selectedCandidateId) || candidates[0];
  const existingEval = currentCandidate?.grading.speakingEvaluation;

  // Candidate search: live-filtering dropdown by ID or name. Results stay
  // visible while typing so the filter is obviously working.
  const [searchQuery, setSearchQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const visibleCandidates = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      c =>
        c.candidateId.toLowerCase().includes(q) ||
        c.candidateName.toLowerCase().includes(q)
    );
  })();
  const pickCandidate = (id: string) => {
    onSelectCandidate(id);
    setListOpen(false);
  };

  // Criteria scores
  const [fluency, setFluency] = useState(existingEval?.fluency || 7.5);
  const [lexical, setLexical] = useState(existingEval?.lexical || 7.0);
  const [grammar, setGrammar] = useState(existingEval?.grammar || 7.5);
  const [pronunciation, setPronunciation] = useState(existingEval?.pronunciation || 8.0);
  const [examinerNotes, setExaminerNotes] = useState(
    existingEval?.examinerNotes ||
    'Candidate spoke at length without noticeable effort. Idiomatic language used appropriately with minor hesitation.'
  );

  // Interview Stopwatch
  const [timerSec, setTimerSec] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [currentPart, setCurrentPart] = useState<'part1' | 'part2' | 'part3'>('part1');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Examiner-typed questions per interview part (empty by default, saved with the grade)
  const [partQuestions, setPartQuestions] = useState({
    part1: existingEval?.partQuestions?.part1 || '',
    part2: existingEval?.partQuestions?.part2 || '',
    part3: existingEval?.partQuestions?.part3 || ''
  });
  const PART_TITLES = {
    part1: 'Part 1: Introduction & Interview (4–5 mins)',
    part2: 'Part 2: Long Turn (3–4 mins)',
    part3: 'Part 3: Two-Way Discussion (4–5 mins)'
  } as const;
  const PART_PLACEHOLDERS = {
    part1: 'Type the Part 1 questions you ask (e.g. hometown, study, habits)…',
    part2: 'Type the Part 2 cue card topic and follow-ups…',
    part3: 'Type the Part 3 discussion questions…'
  } as const;

  // Voice recording (optional interview memo, 7-day retention)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [attachedAudioUrl, setAttachedAudioUrl] = useState(existingEval?.audioUrl || '');
  const [attachedRecordedAt, setAttachedRecordedAt] = useState(existingEval?.audioRecordedAt || '');
  const [audioRemoved, setAudioRemoved] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);
  const recordingTimerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecordingTracks = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // Sync state when candidate changes (revoke any unsaved preview)
  useEffect(() => {
    const evalData = currentCandidate?.grading.speakingEvaluation;
    setFluency(evalData?.fluency || 7.5);
    setLexical(evalData?.lexical || 7.0);
    setGrammar(evalData?.grammar || 7.5);
    setPronunciation(evalData?.pronunciation || 8.0);
    setExaminerNotes(
      evalData?.examinerNotes ||
      'Candidate spoke at length without noticeable effort. Idiomatic language used appropriately with minor hesitation.'
    );
    setPartQuestions({
      part1: evalData?.partQuestions?.part1 || '',
      part2: evalData?.partQuestions?.part2 || '',
      part3: evalData?.partQuestions?.part3 || ''
    });
    // Fresh candidate: drop unsaved preview, show stored memo (if any).
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    pendingBlobRef.current = null;
    stopRecordingTracks();
    setIsRecording(false);
    setRecordingSeconds(0);
    setAttachedAudioUrl(evalData?.audioUrl || '');
    setAttachedRecordedAt(evalData?.audioRecordedAt || '');
    setAudioRemoved(false);
    setRecordError(null);
  }, [currentCandidate?.candidateId]);

  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSec(s => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  // Release mic + preview URL on unmount.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      stopRecordingTracks();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        pendingBlobRef.current = blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        stopRecordingTracks();
      };
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch {
      setRecordError('Microphone access was denied or is not available in this browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read recording'));
      reader.readAsDataURL(blob);
    });

  const uploadRecording = async () => {
    const blob = pendingBlobRef.current;
    if (!blob || !currentCandidate) return;
    setIsUploading(true);
    setRecordError(null);
    try {
      const dataUrl = await blobToDataUrl(blob);
      const ext = (blob.type.includes('mp4') || blob.type.includes('m4a')) ? 'm4a' : 'webm';
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({
          fileData: dataUrl,
          fileName: `speaking-${currentCandidate.candidateId}-${Date.now()}.${ext}`,
          fileType: blob.type || 'audio/webm',
          uploadType: 'speaking'
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || 'Upload failed');
      setAttachedAudioUrl(data.url);
      setAttachedRecordedAt(new Date().toISOString());
      setAudioRemoved(false);
      // Preview served its purpose — the stored memo is the source of truth.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      pendingBlobRef.current = null;
    } catch (e: any) {
      setRecordError(e?.message || 'Could not upload the recording. Please retry.');
    } finally {
      setIsUploading(false);
    }
  };

  const discardPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    pendingBlobRef.current = null;
  };

  const removeAttachedAudio = () => {
    // Detached on next save; the orphaned file is auto-purged within 7 days.
    setAttachedAudioUrl('');
    setAttachedRecordedAt('');
    setAudioRemoved(true);
  };

  // Overall Speaking calculation (standard arithmetic mean rounded to nearest 0.5)
  const meanSpeaking = (fluency + lexical + grammar + pronunciation) / 4;
  const overallSpeakingBand = Math.round(meanSpeaking * 2) / 2;

  const handleSave = async () => {
    if (!currentCandidate) return;
    setIsSaving(true);
    setSaveSuccess(false);

    const evalObj: SpeakingEvaluation = {
      fluency,
      lexical,
      grammar,
      pronunciation,
      overallBand: overallSpeakingBand,
      examinerNotes,
      conductedAt: new Date().toISOString()
    };
    // Voice memo linkage: attached URL persists, explicit removal detaches
    // (null), untouched state sends nothing so the server preserves the memo.
    const payload: Record<string, unknown> = { ...evalObj, partQuestions };
    if (attachedAudioUrl) {
      payload.audioUrl = attachedAudioUrl;
      payload.audioRecordedAt = attachedRecordedAt || new Date().toISOString();
    } else if (audioRemoved) {
      payload.audioUrl = null;
      payload.audioRecordedAt = null;
    }

    await onSaveSpeakingGrade(currentCandidate.candidateId, payload as unknown as SpeakingEvaluation);
    setAudioRemoved(false);
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const adjustVal = (setter: React.Dispatch<React.SetStateAction<number>>, current: number, delta: number) => {
    const next = Math.max(0, Math.min(9, Math.round((current + delta) * 2) / 2));
    setter(next);
  };

  return (
    <div className="space-y-6">
      {/* Header & Candidate Selector */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
            <Mic className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Live Speaking Examiner Terminal</h2>
            <p className="text-xs text-slate-500">Real-time candidate evaluation with IELTS 4-criteria rubric, stopwatch and optional voice memo (7-day storage).</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setListOpen(true); }}
              onFocus={() => setListOpen(true)}
              onBlur={() => setListOpen(false)}
              onKeyDown={e => { if (e.key === 'Escape') setListOpen(false); }}
              placeholder="Search ID or name…"
              aria-label="Search candidates"
              className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 w-52 font-mono"
            />
            {listOpen && (
              <div className="absolute right-0 top-10 z-30 w-72 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl py-1">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  {visibleCandidates.length} of {candidates.length} candidates
                </p>
                {visibleCandidates.length === 0 && (
                  <p className="px-3 py-2.5 text-xs text-slate-500">No candidates match “{searchQuery.trim()}”.</p>
                )}
                {visibleCandidates.slice(0, 50).map(c => {
                  const isCurrent = c.candidateId === currentCandidate?.candidateId;
                  return (
                    <button
                      key={c.candidateId}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); pickCandidate(c.candidateId); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition cursor-pointer flex items-center gap-2 ${
                        isCurrent ? 'bg-orange-50 text-orange-900 font-bold' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="font-mono font-bold shrink-0">{c.candidateId}</span>
                      <span className="truncate">{c.candidateName}</span>
                      {isCurrent && <span className="ml-auto text-[10px] text-orange-600 font-bold shrink-0">● current</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interview Timer & Prompt Structure (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Candidate Bio & Live Stopwatch */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
              <CandidateAvatar
                name={currentCandidate?.candidateName}
                photoUrl={currentCandidate?.candidatePhotoUrl}
                className="w-12 h-12 rounded-xl border border-slate-200"
                textClassName="text-base"
              />
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{currentCandidate?.candidateName}</h3>
                <span className="font-mono text-xs text-orange-600 font-bold">{currentCandidate?.candidateId}</span>
              </div>
            </div>

            {/* Stopwatch */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                Interview Elapsed Duration
              </span>
              <div className="text-3xl font-black font-mono text-slate-900 tracking-wider">
                {Math.floor(timerSec / 60).toString().padStart(2, '0')}:{(timerSec % 60).toString().padStart(2, '0')}
              </div>
              <div className="flex justify-center space-x-2 pt-1">
                <button
                  onClick={() => setIsTimerRunning(!isTimerRunning)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer ${
                    isTimerRunning
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {isTimerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isTimerRunning ? 'Pause Clock' : 'Start Clock'}</span>
                </button>
                <button
                  onClick={() => {
                    setIsTimerRunning(false);
                    setTimerSec(0);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Voice Recording (optional interview memo, 7-day retention) */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-orange-600" />
                  Voice Recording
                </span>
                {isRecording && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-600 font-mono">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    {Math.floor(recordingSeconds / 60).toString().padStart(2, '0')}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                  </span>
                )}
              </div>

              {!isRecording && !previewUrl && !attachedAudioUrl && (
                <button
                  onClick={startRecording}
                  className="w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Record Interview</span>
                </button>
              )}

              {isRecording && (
                <button
                  onClick={stopRecording}
                  className="w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer bg-rose-600 hover:bg-rose-700 text-white"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop Recording</span>
                </button>
              )}

              {previewUrl && !isRecording && (
                <div className="space-y-2">
                  <audio controls src={previewUrl} className="w-full h-9" />
                  <div className="flex space-x-2">
                    <button
                      onClick={uploadRecording}
                      disabled={isUploading}
                      className="flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isUploading ? 'Uploading…' : 'Upload & Attach'}</span>
                    </button>
                    <button
                      onClick={() => { stopRecording(); discardPreview(); }}
                      disabled={isUploading}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition cursor-pointer disabled:opacity-50"
                      title="Discard this take"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {attachedAudioUrl && !previewUrl && (
                <div className="space-y-2">
                  <audio controls src={getAuthenticatedFileUrl(attachedAudioUrl)} className="w-full h-9" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">
                      {attachedRecordedAt
                        ? `Recorded ${new Date(attachedRecordedAt).toLocaleString()} · `
                        : ''}kept 7 days, then auto-deleted.
                    </span>
                    <div className="flex space-x-2 shrink-0">
                      <button
                        onClick={startRecording}
                        className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition cursor-pointer"
                        title="Record a replacement (old memo is replaced on save)"
                      >
                        Re-record
                      </button>
                      <button
                        onClick={removeAttachedAudio}
                        className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 rounded-lg text-[11px] font-semibold border border-slate-200 hover:border-rose-300 transition cursor-pointer"
                        title="Remove memo (detached on save)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {recordError && (
                <div className="flex items-start space-x-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{recordError}</span>
                </div>
              )}

              {!attachedAudioUrl && !previewUrl && !isRecording && (
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Optional. Memos are stored securely and auto-deleted 7 days after recording.
                </p>
              )}
            </div>

            {/* Part Switcher & Standard Script Guide */}
            <div className="space-y-3">
              <div className="flex space-x-2">
                {(['part1', 'part2', 'part3'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setCurrentPart(p)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                      currentPart === p
                        ? 'bg-orange-500 text-white shadow-2xs font-bold'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {p.replace('part', 'Part ')}
                  </button>
                ))}
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 text-slate-700 leading-relaxed">
                <div className="font-bold text-orange-700">{PART_TITLES[currentPart]}</div>
                <textarea
                  value={partQuestions[currentPart]}
                  onChange={e => setPartQuestions({ ...partQuestions, [currentPart]: e.target.value })}
                  rows={3}
                  maxLength={2000}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-sans"
                  placeholder={PART_PLACEHOLDERS[currentPart]}
                  aria-label={`${PART_TITLES[currentPart]} questions`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: 4 Rubric Criteria Sliders & Scoring (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">IELTS Speaking Assessment</h3>
              <div className="bg-orange-50 border border-orange-200 px-3 py-1 rounded-xl text-center">
                <span className="text-[9px] uppercase font-bold text-orange-700 block">Speaking Band</span>
                <span className="text-xl font-black text-orange-700 font-mono">{overallSpeakingBand.toFixed(1)}</span>
              </div>
            </div>

            {/* Criteria 1: Fluency & Coherence */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900">Fluency &amp; Coherence (FC)</span>
                  <span className="text-[10px] text-slate-500 block">Flow of speech, topic development, hesitations</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => adjustVal(setFluency, fluency, -0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base text-orange-700 w-8 text-center">
                    {fluency.toFixed(1)}
                  </span>
                  <button
                    onClick={() => adjustVal(setFluency, fluency, 0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                step="0.5"
                value={fluency}
                onChange={e => setFluency(parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>

            {/* Criteria 2: Lexical Resource */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900">Lexical Resource (LR)</span>
                  <span className="text-[10px] text-slate-500 block">Range of vocabulary, idiom usage, paraphrase</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => adjustVal(setLexical, lexical, -0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base text-orange-700 w-8 text-center">
                    {lexical.toFixed(1)}
                  </span>
                  <button
                    onClick={() => adjustVal(setLexical, lexical, 0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                step="0.5"
                value={lexical}
                onChange={e => setLexical(parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>

            {/* Criteria 3: Grammatical Range & Accuracy */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900">Grammatical Range &amp; Accuracy (GRA)</span>
                  <span className="text-[10px] text-slate-500 block">Sentence structure variety, clause mastery, error rate</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => adjustVal(setGrammar, grammar, -0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base text-orange-700 w-8 text-center">
                    {grammar.toFixed(1)}
                  </span>
                  <button
                    onClick={() => adjustVal(setGrammar, grammar, 0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                step="0.5"
                value={grammar}
                onChange={e => setGrammar(parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>

            {/* Criteria 4: Pronunciation */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900">Pronunciation (P)</span>
                  <span className="text-[10px] text-slate-500 block">Intonation, rhythm, phoneme clarity, intelligibility</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => adjustVal(setPronunciation, pronunciation, -0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base text-orange-700 w-8 text-center">
                    {pronunciation.toFixed(1)}
                  </span>
                  <button
                    onClick={() => adjustVal(setPronunciation, pronunciation, 0.5)}
                    className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                step="0.5"
                value={pronunciation}
                onChange={e => setPronunciation(parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>

            {/* Examiner Notes */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Confidential Examiner Observations
              </label>
              <textarea
                value={examinerNotes}
                onChange={e => setExaminerNotes(e.target.value)}
                rows={2}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-sans"
                placeholder="Notes on fluency, idiomatic vocabulary, or pronunciation slips..."
              />
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-semibold rounded-xl text-xs transition shadow-sm shadow-orange-500/25 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSaving ? 'Submitting Speaking Score...' : 'Save & Certify Speaking Band'}</span>
            </button>

            {saveSuccess && (
              <div className="text-center text-xs text-emerald-700 font-medium">
                ✓ Speaking assessment successfully recorded for {currentCandidate?.candidateName}!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
