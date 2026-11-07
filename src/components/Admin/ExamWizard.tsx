import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Headphones,
  BookOpen,
  PenTool,
  FileCheck,
  Layers,
  Upload,
  Mic,
  MicOff,
  Volume2,
  Image as ImageIcon,
  BarChart3,
  Eye,
  X,
  Play,
  Pause,
  RefreshCw,
  AlertCircle,
  ArrowLeft
} from 'lucide-react';
import { Exam, ListeningSection, Question, getExamResultsReleaseMs } from '../../types';
import { renumberQuestionsWithSlots, spanEndNumber, countQuestionSlots } from '../../utils/ieltsScoring';
import { Task1Chart, parseTask1ChartData, chartTemplateFor, parseTask1DraftJson, task1TemplateFor, TASK1_AI_PROMPT } from '../Task1Chart';
import { QuestionEditor } from './QuestionEditor';
import { DateField } from '../DateField';
import { DocumentImportModal } from './DocumentImportModal';
import { ListeningImportModal } from './ListeningImportModal';
import { ExamPreviewModal } from './ExamPreviewModal';
import { parseYoutubeId, youtubeEmbedUrl, probeYoutubeDuration } from '../../utils/youtube';

interface ExamWizardProps {
  currentExam: Exam;
  onSaveExam: (exam: Exam) => Promise<boolean | void>;
  /** Cancel: discard the draft and show a clean blank form (stays in wizard). */
  onCancel?: () => void;
  /** Posted Exams button: discard the draft and leave the wizard. */
  onBackToList?: () => void;
  isNewExam?: boolean;
}

export const ExamWizard: React.FC<ExamWizardProps> = ({ currentExam, onSaveExam, onCancel, onBackToList, isNewExam }) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Deep clone: several editors mutate nested section objects in place, so the
  // draft must never share references with the parent's (saved) exam object.
  // Otherwise cancelled edits would leak into the saved exam and Cancel could
  // never restore it.
  const [examData, setExamData] = useState<Exam>(() => JSON.parse(JSON.stringify(currentExam)));
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pending raw audio files awaiting binary upload on Save.
  // Previews use lightweight blob: object URLs (never base64 in state).
  const masterAudioPendingRef = useRef<{ file: File | Blob; name: string } | null>(null);
  const sectionAudioPendingRef = useRef<Record<number, { file: File | Blob; name: string } | null>>({});

  /** Upload raw audio bytes via multipart (no base64 inflation). Throws on failure. */
  const uploadAudioBlob = async (file: File | Blob, fileName: string): Promise<string> => {
    const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_AUDIO_BYTES) {
      throw new Error(
        `“${fileName}” is ${(file.size / 1048576).toFixed(1)} MB — over the 50 MB limit. ` +
        `Re-export it as MP3 64–96 kbps mono (30 min ≈ 14–21 MB) and try again.`
      );
    }
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('type', 'audio');
    const upRes = await fetch('/api/upload', { method: 'POST', body: form });
    const upData = await upRes.json().catch(() => null);
    if (!upRes.ok || !upData?.url) {
      throw new Error(upData?.error || `Audio upload failed (server ${upRes.status}).`);
    }
    return upData.url as string;
  };

  const revokePreviewUrl = (url?: string) => {
    if (url && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  };

  // Release unsaved resources: abort a live mic recording WITHOUT saving it,
  // drop pending uploads and revoke their local blob previews. The saved
  // exam (parent prop / server data) never holds blob: URLs, so every blob
  // preview in the draft is safe to revoke here.
  const discardDraftResources = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      try {
        recorder.onstop = null;
        recorder.ondataavailable = null;
      } catch (_) {}
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch (_) {}
      try {
        recorder.stream?.getTracks().forEach(t => t.stop());
      } catch (_) {}
      mediaRecorderRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    audioChunksRef.current = [];
    masterAudioPendingRef.current = null;
    sectionAudioPendingRef.current = {};
    const dropPreview = (u?: string) => {
      if (u && u.startsWith('blob:')) revokePreviewUrl(u);
    };
    dropPreview(examData.listening.audioUrl);
    examData.listening.sections.forEach(s => dropPreview(s.audioUrl));
  };

  // Full form reset: discards the draft and restores every editor to the
  // given exam (blank for a new form, saved version when cancelling an edit).
  const resetWizardTo = (target: Exam) => {
    discardDraftResources();
    // A new form (fresh blank after deploy, cancelled draft, or another exam
    // opened for edit) always starts back at Step 1 with clean editors.
    // Cloned again: the draft must not share references with the saved exam.
    setExamData(JSON.parse(JSON.stringify(target)));
    setStep(1);
    setIsSaving(false);
    setSaveSuccess(false);
    setSaveError(null);
    setActiveRecordingSection(null);
    setRecordingSeconds(0);
    setZoomedImage(null);
    setShowPreview(false);
    setListeningImportFor(null);
    setReadingImportFor(null);
    setChartJsonText(
      target.writing?.task1?.chartData ? JSON.stringify(target.writing.task1.chartData, null, 2) : ''
    );
    setChartJsonError(null);
    setTask1JsonText('');
    setTask1AppliedMsg(null);
    setTask1CopyMsg(null);
    setSectionAudioMode({
      0: target.listening?.sections?.[0]?.audioUrl ? 'audio' : 'script',
      1: target.listening?.sections?.[1]?.audioUrl ? 'audio' : 'script',
      2: target.listening?.sections?.[2]?.audioUrl ? 'audio' : 'script',
      3: target.listening?.sections?.[3]?.audioUrl ? 'audio' : 'script'
    });
    setProbingSections({});
  };

  // Cancel: throw the whole draft away. The parent swaps in a clean blank
  // form (same reset as after Save & Deploy) and the wizard stays open on
  // Step 1 — never the edited exam restored, never stale state.
  const handleCancel = () => {
    if (isSaving) return;
    discardDraftResources();
    if (onCancel) onCancel();
  };

  // Posted Exams button: same discard, but leave the wizard for the list.
  const handleBackToList = () => {
    if (isSaving) return;
    discardDraftResources();
    if (onBackToList) onBackToList();
    else if (onCancel) onCancel();
  };

  useEffect(() => {
    if (currentExam) {
      resetWizardTo(currentExam);
    }
    // Re-run only when a different exam is supplied (open/save/cancel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExam]);

  // Audio Recording State for Listening
  const [activeRecordingSection, setActiveRecordingSection] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  // Picture Zoom Modal in Task 1
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Candidate-view preview of the current (possibly unsaved) draft.
  const [showPreview, setShowPreview] = useState(false);

  // Task 1 chart-data JSON authoring (raw text + validation). Only parsed,
  // valid JSON is stored on examData.writing.task1.chartData.
  const [chartJsonText, setChartJsonText] = useState<string>(() =>
    currentExam.writing?.task1?.chartData ? JSON.stringify(currentExam.writing.task1.chartData, null, 2) : ''
  );
  const [chartJsonError, setChartJsonError] = useState<string | null>(null);

  // Task 1 Quick Setup holder: one pasted JSON fills the whole task.
  const [task1JsonText, setTask1JsonText] = useState('');
  const [task1AppliedMsg, setTask1AppliedMsg] = useState<string | null>(null);
  const [task1CopyMsg, setTask1CopyMsg] = useState<string | null>(null);

  const applyTask1Json = () => {
    if (!task1JsonText.trim()) return;
    const res = parseTask1DraftJson(task1JsonText, examData.writing.task1.chartType);
    if (!res.draft) return;
    const d = res.draft;
    setExamData(prev => ({
      ...prev,
      writing: {
        ...prev.writing,
        task1: {
          ...prev.writing.task1,
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
          chartType: d.chartType || prev.writing.task1.chartType,
          ...(d.chartDescription !== undefined ? { chartDescription: d.chartDescription } : {}),
          ...(d.chartDataSummary !== undefined ? { chartDataSummary: d.chartDataSummary } : {}),
          // Absent chartData clears any stale chart so previews never mismatch.
          chartData: d.chartData,
          visualMode: 'builtin' as const
        }
      }
    }));
    // Keep the per-chart JSON editor in sync with what was applied.
    setChartJsonText(d.chartData ? JSON.stringify(d.chartData, null, 2) : '');
    setChartJsonError(null);
    setTask1AppliedMsg('Task 1 filled from JSON — review the fields and the live preview, then Save & Deploy.');
    setTimeout(() => setTask1AppliedMsg(null), 8000);
  };

  const applyChartJson = (text: string, chartType: Exam['writing']['task1']['chartType']) => {
    setChartJsonText(text);
    if (!text.trim()) {
      setChartJsonError(null);
      setExamData(prev => ({
        ...prev,
        writing: { ...prev.writing, task1: { ...prev.writing.task1, chartData: undefined } }
      }));
      return;
    }
    const parsed = parseTask1ChartData(text, chartType);
    if (parsed.error || !parsed.data) {
      setChartJsonError(parsed.error || 'Invalid chart JSON.');
      setExamData(prev => ({
        ...prev,
        writing: { ...prev.writing, task1: { ...prev.writing.task1, chartData: undefined } }
      }));
      return;
    }
    setChartJsonError(null);
    const data = parsed.data;
    setExamData(prev => ({
      ...prev,
      writing: { ...prev.writing, task1: { ...prev.writing.task1, chartData: data } }
    }));
  };

  // Section Audio Source View Mode: 'audio' or 'script'
  const [sectionAudioMode, setSectionAudioMode] = useState<Record<number, 'audio' | 'script'>>({
    0: currentExam.listening?.sections?.[0]?.audioUrl ? 'audio' : 'script',
    1: currentExam.listening?.sections?.[1]?.audioUrl ? 'audio' : 'script',
    2: currentExam.listening?.sections?.[2]?.audioUrl ? 'audio' : 'script',
    3: currentExam.listening?.sections?.[3]?.audioUrl ? 'audio' : 'script'
  });

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      const cloned = JSON.parse(JSON.stringify(examData)) as Exam;

      // Upload task 1 diagram to R2 if base64
      if (cloned.writing?.task1?.imageUrl?.startsWith('data:')) {
        try {
          const upRes = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: cloned.writing.task1.imageUrl,
              fileName: cloned.writing.task1.imageFileName || 'diagram.jpg',
              uploadType: 'diagram'
            })
          });
          if (upRes.ok) {
            const upData = await upRes.json();
            if (upData.url) cloned.writing.task1.imageUrl = upData.url;
          } else {
            const errData = await upRes.json().catch(() => null);
            throw new Error(errData?.error || `Diagram upload failed (server ${upRes.status}).`);
          }
        } catch (e) {
          throw new Error(`Could not save: diagram image upload failed. ${e instanceof Error ? e.message : ''}`);
        }
      }

      // Upload pending master audio via binary multipart (no base64).
      const masterPending = masterAudioPendingRef.current;
      if (masterPending) {
        try {
          const url = await uploadAudioBlob(masterPending.file, masterPending.name);
          if (cloned.listening) {
            cloned.listening.audioUrl = url;
            cloned.listening.audioFileName = masterPending.name;
          }
        } catch (e) {
          throw new Error(`Could not save: master audio upload failed. ${e instanceof Error ? e.message : ''} Your audio was NOT saved — please retry.`);
        }
      }

      // Upload pending section audios via binary multipart.
      if (cloned.listening?.sections) {
        for (let i = 0; i < cloned.listening.sections.length; i++) {
          const pending = sectionAudioPendingRef.current[i];
          if (!pending) continue;
          const sec = cloned.listening.sections[i];
          try {
            const url = await uploadAudioBlob(pending.file, pending.name);
            sec.audioUrl = url;
            sec.audioFileName = pending.name;
            sec.audioSourceType = 'upload';
          } catch (e) {
            throw new Error(`Could not save: Section ${sec.sectionNumber} audio upload failed. ${e instanceof Error ? e.message : ''} Your audio was NOT saved — please retry.`);
          }
        }
      }

      // Guard: never persist local-only blob:/data: audio URLs — they would
      // silently vanish for students. Block the save instead.
      const orphanMaster = cloned.listening?.audioUrl && (cloned.listening.audioUrl.startsWith('blob:') || cloned.listening.audioUrl.startsWith('data:'));
      const orphanSection = cloned.listening?.sections?.find(s => s.audioUrl && (s.audioUrl.startsWith('blob:') || s.audioUrl.startsWith('data:')));
      if (orphanMaster || orphanSection) {
        throw new Error(
          `Could not save: ${orphanMaster ? 'master audio' : `Section ${orphanSection!.sectionNumber} audio`} is only previewed locally and was never uploaded. Please re-select the audio file and save again.`
        );
      }

      const result = await onSaveExam(cloned);
      if (result === false) {
        throw new Error('Server rejected the exam save. Your audio and changes were NOT saved — please retry.');
      }
      // Persisted server-side: free local preview URLs and clear pendings.
      revokePreviewUrl(examData.listening.audioUrl);
      examData.listening.sections.forEach(s => revokePreviewUrl(s.audioUrl));
      masterAudioPendingRef.current = null;
      sectionAudioPendingRef.current = {};
      setExamData(cloned);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to save exam:', e);
      setSaveError(e instanceof Error ? e.message : 'Failed to save exam. Your changes were NOT saved.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to handle Master Audio File Upload (1 audio for all 4 sections).
  // Stores the raw File for binary upload on Save; previews via object URL.
  const handleMasterAudioFileUpload = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    revokePreviewUrl(examData.listening.audioUrl);
    masterAudioPendingRef.current = { file, name: file.name };
    setSaveError(null);
    setExamData({
      ...examData,
      listening: {
        ...examData.listening,
        audioUploadMode: 'single',
        audioUrl: previewUrl,
        audioFileName: file.name
      }
    });
  };

  const handleRemoveMasterAudio = () => {
    revokePreviewUrl(examData.listening.audioUrl);
    masterAudioPendingRef.current = null;
    setExamData({
      ...examData,
      listening: {
        ...examData.listening,
        audioUrl: undefined,
        audioFileName: undefined
      }
    });
  };

  // Helper to handle Audio File Upload (per section).
  const handleAudioFileUpload = (file: File, sIdx: number) => {
    const previewUrl = URL.createObjectURL(file);
    // Detect audio duration from the raw file (no base64 round-trip).
    const tempAudio = new Audio(previewUrl);
    const applyTrack = (durationSec?: number) => {
      const prevUrl = examData.listening.sections[sIdx]?.audioUrl;
      revokePreviewUrl(prevUrl);
      sectionAudioPendingRef.current[sIdx] = { file, name: file.name };
      setSaveError(null);
      const updated = [...examData.listening.sections];
      updated[sIdx] = {
        ...updated[sIdx],
        audioUrl: previewUrl,
        audioFileName: file.name,
        audioDurationSeconds: durationSec || updated[sIdx].audioDurationSeconds || 45,
        audioSourceType: 'upload'
      };
      setExamData({
        ...examData,
        listening: { ...examData.listening, sections: updated }
      });
    };
    tempAudio.onloadedmetadata = () => {
      applyTrack(Math.ceil(tempAudio.duration) || 45);
    };
    // In case onloadedmetadata fails
    tempAudio.onerror = () => {
      applyTrack(undefined);
    };
  };

  // Helper for Microphone Live Recording
  const startMicrophoneRecording = async (sIdx: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const previewUrl = URL.createObjectURL(audioBlob);
        const fileName = `mic-recording-sec-${sIdx + 1}.webm`;
        const applyRecording = (durationSec: number) => {
          revokePreviewUrl(examData.listening.sections[sIdx]?.audioUrl);
          sectionAudioPendingRef.current[sIdx] = { file: audioBlob, name: fileName };
          setSaveError(null);
          const updated = [...examData.listening.sections];
          updated[sIdx] = {
            ...updated[sIdx],
            audioUrl: previewUrl,
            audioFileName: fileName,
            audioDurationSeconds: durationSec,
            audioSourceType: 'record'
          };
          setExamData({
            ...examData,
            listening: { ...examData.listening, sections: updated }
          });
        };
        const tempAudio = new Audio(previewUrl);
        tempAudio.onloadedmetadata = () => {
          applyRecording(Math.ceil(tempAudio.duration) || recordingSeconds || 30);
        };
        tempAudio.onerror = () => {
          applyRecording(recordingSeconds || 30);
        };
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setActiveRecordingSection(sIdx);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } catch (err) {
      alert('Microphone access was denied or not available in this browser.');
    }
  };

  const stopMicrophoneRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    setActiveRecordingSection(null);
  };

  // Keep question numbers continuous across the whole module after add/delete.
  // Slot-aware: a multi-letter record consumes one number per letter, so the
  // next record starts after its last covered number (no range overlaps).
  const renumberListening = (sections: ListeningSection[]): ListeningSection[] => {
    let n = 1;
    return sections.map(sec => {
      const questions = renumberQuestionsWithSlots(sec.questions, n);
      n = questions.length ? spanEndNumber(questions[questions.length - 1]) + 1 : n;
      return { ...sec, questions };
    });
  };

  // Listening document-import modal target (section index) — null = closed.
  const [listeningImportFor, setListeningImportFor] = useState<number | null>(null);

  /** Insert AI-parsed section drafts (up to 4: title/context + questions only; audio untouched). */
  const applyListeningImport = (
    items: { sectionIdx: number; title: string; context: string; questions: Question[] }[],
    impMode: 'append' | 'replace'
  ) => {
    if (!items.length) return;
    const byTarget = new Map<number, { title: string; context: string; questions: Question[] }>();
    for (const it of items) {
      if (!examData.listening.sections[it.sectionIdx]) continue;
      const prev = byTarget.get(it.sectionIdx);
      byTarget.set(it.sectionIdx, prev ? {
        title: prev.title || it.title,
        context: prev.context ? prev.context + '\n' + it.context : it.context,
        questions: [...prev.questions, ...it.questions]
      } : it);
    }
    const nextSections = examData.listening.sections.map((sec, i) => {
      const ins = byTarget.get(i);
      if (!ins) return sec;
      if (impMode === 'replace') {
        return {
          ...sec,
          title: ins.title.trim() || sec.title,
          context: ins.context.trim() || sec.context,
          questions: ins.questions
        };
      }
      return {
        ...sec,
        title: sec.title.trim() ? sec.title : ins.title.trim() || sec.title,
        context: sec.context.trim() ? sec.context : ins.context,
        questions: [...sec.questions, ...ins.questions]
      };
    });
    setExamData({ ...examData, listening: { ...examData.listening, sections: renumberListening(nextSections) } });
  };

  const updateListeningQuestions = (sIdx: number, qs: Question[]) => {
    const sections = examData.listening.sections.map((sec, i) =>
      i === sIdx ? { ...sec, questions: qs } : sec
    );
    setExamData({ ...examData, listening: { ...examData.listening, sections: renumberListening(sections) } });
  };

  const updateReadingQuestions = (pIdx: number, qs: Question[]) => {
    let n = 1;
    const passages = examData.reading.passages.map((p, i) => {
      const list = i === pIdx ? qs : p.questions;
      const questions = renumberQuestionsWithSlots(list, n);
      n = questions.length ? spanEndNumber(questions[questions.length - 1]) + 1 : n;
      return { ...p, questions };
    });
    setExamData({ ...examData, reading: { ...examData.reading, passages } });
  };

  // Reading document-import modal target (passage index) — null = closed.
  const [readingImportFor, setReadingImportFor] = useState<number | null>(null);

  /** Insert AI-parsed passage drafts (up to 3: title/text + questions) into passages. */
  const applyReadingImport = (
    items: { passageIdx: number; title: string; text: string; questions: Question[] }[],
    impMode: 'append' | 'replace'
  ) => {
    if (!items.length) return;
    const byTarget = new Map<number, { title: string; text: string; questions: Question[] }>();
    for (const it of items) {
      if (!examData.reading.passages[it.passageIdx]) continue;
      const prev = byTarget.get(it.passageIdx);
      byTarget.set(it.passageIdx, prev ? {
        title: prev.title || it.title,
        text: prev.text ? prev.text + '\n\n' + it.text : it.text,
        questions: [...prev.questions, ...it.questions]
      } : it);
    }
    const nextPassages = examData.reading.passages.map((p, i) => {
      const ins = byTarget.get(i);
      if (!ins) return p;
      if (impMode === 'replace') {
        return {
          ...p,
          title: ins.title.trim() || p.title,
          text: ins.text.trim() || p.text,
          questions: ins.questions
        };
      }
      return {
        ...p,
        title: p.title.trim() ? p.title : ins.title.trim() || p.title,
        text: p.text.trim() ? p.text : ins.text,
        questions: [...p.questions, ...ins.questions]
      };
    });
    // Renumber all reading questions globally across passages (slot-aware:
    // multi-letter records consume one number per letter).
    let n = 1;
    const renumbered = nextPassages.map(p => {
      const questions = renumberQuestionsWithSlots(p.questions, n);
      n = questions.length ? spanEndNumber(questions[questions.length - 1]) + 1 : n;
      return { ...p, questions };
    });
    setExamData({ ...examData, reading: { ...examData.reading, passages: renumbered } });
  };

  // Helper to remove audio
  const handleRemoveAudio = (sIdx: number) => {
    revokePreviewUrl(examData.listening.sections[sIdx]?.audioUrl);
    sectionAudioPendingRef.current[sIdx] = null;
    const updated = [...examData.listening.sections];
    updated[sIdx] = {
      ...updated[sIdx],
      audioUrl: undefined,
      audioFileName: undefined,
      audioSourceType: 'script'
    };
    setExamData({
      ...examData,
      listening: { ...examData.listening, sections: updated }
    });
  };

  // Link a remote URL: direct audio file OR YouTube link (watch/youtu.be/embed/shorts).
  const handleLinkSectionRemote = (sIdx: number, raw: string) => {
    const val = raw.trim();
    if (!val) return;
    const ytId = parseYoutubeId(val);
    const finalUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : val;
    const updated = [...examData.listening.sections];
    updated[sIdx] = {
      ...updated[sIdx],
      audioUrl: finalUrl,
      audioFileName: ytId ? `YouTube ${ytId}` : updated[sIdx].audioFileName || 'Remote audio link',
      audioSourceType: ytId ? 'youtube' : 'upload'
    };
    sectionAudioPendingRef.current[sIdx] = null;
    setSaveError(null);
    setExamData({
      ...examData,
      listening: { ...examData.listening, sections: updated }
    });
    // Measure the real track length: estimates are never used for recordings/links.
    probeSectionLinkDuration(sIdx, finalUrl);
  };

  // Tracks currently being measured (admin sees "Measuring…" instead of a stale estimate).
  const [probingSections, setProbingSections] = useState<Record<number, boolean>>({});

  // Measure the REAL duration of a linked track (direct file via metadata,
  // YouTube via a hidden cued player). Guarded by URL so a stale probe can
  // never overwrite a newer link; silent when measurement is unavailable.
  const probeSectionLinkDuration = (sIdx: number, url: string) => {
    const applyDuration = (secs: number | null) => {
      setProbingSections(prev => ({ ...prev, [sIdx]: false }));
      if (!secs || !isFinite(secs) || secs <= 0) return;
      setExamData(prev => {
        if (prev.listening.sections[sIdx]?.audioUrl !== url) return prev;
        if (prev.listening.sections[sIdx]?.audioDurationSeconds === secs) return prev;
        const updated = [...prev.listening.sections];
        updated[sIdx] = { ...updated[sIdx], audioDurationSeconds: secs };
        return { ...prev, listening: { ...prev.listening, sections: updated } };
      });
    };
    const ytId = parseYoutubeId(url);
    if (ytId) {
      setProbingSections(prev => ({ ...prev, [sIdx]: true }));
      probeYoutubeDuration(ytId).then(applyDuration).catch(() => applyDuration(null));
      return;
    }
    if (!/^https?:\/\//i.test(url)) return;
    setProbingSections(prev => ({ ...prev, [sIdx]: true }));
    try {
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => applyDuration(Math.ceil(probe.duration));
      probe.onerror = () => applyDuration(null);
      probe.src = url;
    } catch (_) {
      applyDuration(null);
    }
  };

  // On open: measure already-linked remote tracks (older exams saved with the
  // default estimate get their real lengths without re-linking).
  useEffect(() => {
    (currentExam.listening?.sections || []).forEach((s, i) => {
      const u = s.audioUrl;
      if (u && !u.startsWith('blob:') && !u.startsWith('data:') && s.audioSourceType !== 'script') {
        probeSectionLinkDuration(i, u);
      }
    });
    // Probe once per opened exam; the URL guard makes re-links safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExam?.id]);

  const handleLinkMasterRemote = (raw: string) => {
    const val = raw.trim();
    if (!val) return;
    const ytId = parseYoutubeId(val);
    revokePreviewUrl(examData.listening.audioUrl);
    masterAudioPendingRef.current = null;
    setSaveError(null);
    setExamData({
      ...examData,
      listening: {
        ...examData.listening,
        audioUploadMode: 'single',
        audioUrl: ytId ? `https://www.youtube.com/watch?v=${ytId}` : val,
        audioFileName: ytId ? `YouTube ${ytId}` : 'Remote master audio link'
      }
    });
  };

  // Helper for Task 1 Picture Upload
  const handleDiagramUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      setExamData({
        ...examData,
        writing: {
          ...examData.writing,
          task1: {
            ...examData.writing.task1,
            imageUrl: dataUrl,
            imageFileName: file.name,
            visualMode: 'upload'
          }
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveDiagram = () => {
    setExamData({
      ...examData,
      writing: {
        ...examData.writing,
        task1: {
          ...examData.writing.task1,
          imageUrl: undefined,
          imageFileName: undefined,
          visualMode: 'builtin'
        }
      }
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Wizard Header & Stepper */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">IELTS Mock Exam Authoring Wizard</h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                  {isNewExam ? 'New Exam Form' : examData.code || examData.id}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Construct authentic IELTS test forms with audio uploads, visual Task 1 diagrams, and multi-key scoring.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onBackToList || onCancel ? (
              <button
                type="button"
                onClick={handleBackToList}
                disabled={isSaving}
                title="Discard the draft and go back to Posted Exams"
                className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Posted Exams</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2.5 bg-white hover:bg-violet-50 text-violet-700 border border-violet-200 rounded-xl text-xs font-semibold cursor-pointer transition"
              title="Preview as candidates will see it (with answer keys)"
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              title="Discard all unsaved changes and reset this form (you stay in the wizard)"
              className="flex items-center space-x-1.5 px-3.5 py-2.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center space-x-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold transition shadow-sm shadow-orange-500/25 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSaving ? 'Deploying...' : isNewExam ? 'Save & Publish Exam' : 'Save & Deploy Exam'}</span>
            </button>
          </div>
        </div>

        {/* Step Navigation Ribbon */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
          <button
            onClick={() => setStep(1)}
            className={`py-2 px-3 rounded-xl font-semibold text-left transition border cursor-pointer ${
              step === 1
                ? 'bg-orange-500 border-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="block text-[10px] uppercase opacity-80">Step 1</span>
            <span>Metadata</span>
          </button>

          <button
            onClick={() => setStep(2)}
            className={`py-2 px-3 rounded-xl font-semibold text-left transition border cursor-pointer ${
              step === 2
                ? 'bg-orange-500 border-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="block text-[10px] uppercase opacity-80">Step 2</span>
            <span>Listening Module</span>
          </button>

          <button
            onClick={() => setStep(3)}
            className={`py-2 px-3 rounded-xl font-semibold text-left transition border cursor-pointer ${
              step === 3
                ? 'bg-orange-500 border-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="block text-[10px] uppercase opacity-80">Step 3</span>
            <span>Reading Passages</span>
          </button>

          <button
            onClick={() => setStep(4)}
            className={`py-2 px-3 rounded-xl font-semibold text-left transition border cursor-pointer ${
              step === 4
                ? 'bg-orange-500 border-orange-500 text-white shadow-xs font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="block text-[10px] uppercase opacity-80">Step 4</span>
            <span>Writing Prompts</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Exam deployed and live for all candidates! The wizard below has been reset — ready to create your next exam.</span>
        </div>
      )}

      {saveError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Step 1: Metadata */}
      {step === 1 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
            General Examination Details
          </h3>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Exam Title
                </label>
                <input
                  type="text"
                  value={examData.title}
                  onChange={e => setExamData({ ...examData, title: e.target.value })}
                  placeholder="e.g. IELTS Academic Practice Test 2"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Exam Form Code
                </label>
                <input
                  type="text"
                  value={examData.code}
                  onChange={e => setExamData({ ...examData, code: e.target.value })}
                  placeholder="e.g. IELTS-AC-2026-02"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Exam Date <span className="normal-case font-medium text-slate-400">(shown at registration · max 125/date)</span>
                </label>
                <DateField
                  value={examData.examDate}
                  outputFormat="iso"
                  onChange={v => setExamData({ ...examData, examDate: v })}
                />
              </div>
              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Exam Start Time <span className="normal-case font-medium text-slate-400">(Baku time — active exam opens automatically)</span>
                </label>
                <input
                  type="time"
                  value={examData.examTime || ''}
                  onChange={e => setExamData({ ...examData, examTime: e.target.value || undefined })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                Second Start Time (optional) <span className="normal-case font-medium text-slate-400">(same day, same paper runs twice)</span>
              </label>
              <input
                type="time"
                value={examData.examTime2 || ''}
                onChange={e => setExamData({ ...examData, examTime2: e.target.value || undefined })}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              {examData.examTime2 && examData.examTime && examData.examTime2 <= examData.examTime && (
                <p className="mt-1 text-[11px] text-amber-700 font-medium">Second time should be after the first start time.</p>
              )}
              {examData.examTime2 && (() => {
                const rel = getExamResultsReleaseMs(examData);
                return rel ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Candidate papers unlock automatically around <strong className="text-slate-700">{new Date(rel).toLocaleString()}</strong> (after the second session ends).
                  </p>
                ) : null;
              })()}
            </div>

            <div>
              <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                Exam Description &amp; Scope
              </label>
              <textarea
                rows={2}
                value={examData.description}
                onChange={e => setExamData({ ...examData, description: e.target.value })}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Examination Module
                </label>
                <select
                  value={examData.type}
                  onChange={e => setExamData({ ...examData, type: e.target.value as any })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="academic">Academic Standard</option>
                  <option value="general_training">General Training</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Test Center / Venue
                </label>
                <input
                  type="text"
                  value={examData.centreNumber}
                  onChange={e => setExamData({ ...examData, centreNumber: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase text-[10px] mb-1">
                  Unique System ID
                </label>
                <input
                  type="text"
                  value={examData.id}
                  onChange={e => setExamData({ ...examData, id: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(2)}
              className="flex items-center space-x-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <span>Next: Listening Module</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Listening Module */}
      {step === 2 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-2">
              <Headphones className="w-4 h-4 text-orange-600" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Listening Sections ({examData.listening.sections.length} Sections)
              </h3>
            </div>
            <span className="text-xs text-orange-600 font-bold">
              Total Questions: {countQuestionSlots(examData.listening.sections.flatMap(s => s.questions))}
            </span>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setListeningImportFor(0)}
              disabled={examData.listening.sections.length === 0}
              title={examData.listening.sections.length === 0 ? 'Add a section first' : 'Import section questions from PDF (audio stays separate)'}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-bold cursor-pointer transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Listening Qs from PDF</span>
            </button>
          </div>

          {/* Audio Upload Strategy Selector: 1 Master Audio vs 4 Separate Audios (Task 7) */}
          <div className="bg-orange-50/70 border border-orange-200/90 rounded-2xl p-4 space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-900 block">
              Listening Audio Upload Format (Choose 1)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <button
                type="button"
                onClick={() => setExamData({
                  ...examData,
                  listening: { ...examData.listening, audioUploadMode: 'single' }
                })}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start space-x-3 ${
                  (examData.listening.audioUploadMode === 'single' || examData.listening.audioUrl)
                    ? 'bg-white border-orange-500 shadow-sm ring-2 ring-orange-500/20'
                    : 'bg-white/60 border-slate-200 hover:bg-white'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
                  (examData.listening.audioUploadMode === 'single' || examData.listening.audioUrl)
                    ? 'border-orange-600 bg-orange-600'
                    : 'border-slate-300'
                }`}>
                  {(examData.listening.audioUploadMode === 'single' || examData.listening.audioUrl) && (
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  )}
                </div>
                <div>
                  <strong className="block text-slate-900 font-bold">Option A: 1 Master Audio File for All 4 Sections</strong>
                  <span className="text-[11px] text-slate-500 leading-tight block mt-0.5">
                    Official format: 1 continuous audio track playing smoothly across Sections 1 to 4.
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExamData({
                  ...examData,
                  listening: { ...examData.listening, audioUploadMode: 'separate' }
                })}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start space-x-3 ${
                  examData.listening.audioUploadMode === 'separate' && !examData.listening.audioUrl
                    ? 'bg-white border-orange-500 shadow-sm ring-2 ring-orange-500/20'
                    : 'bg-white/60 border-slate-200 hover:bg-white'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
                  examData.listening.audioUploadMode === 'separate' && !examData.listening.audioUrl
                    ? 'border-orange-600 bg-orange-600'
                    : 'border-slate-300'
                }`}>
                  {examData.listening.audioUploadMode === 'separate' && !examData.listening.audioUrl && (
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  )}
                </div>
                <div>
                  <strong className="block text-slate-900 font-bold">Option B: 4 Separate Audio Files (1 per Section)</strong>
                  <span className="text-[11px] text-slate-500 leading-tight block mt-0.5">
                    Upload or record individual audio files for Section 1, Section 2, Section 3, and Section 4.
                  </span>
                </div>
              </button>
            </div>

            {/* Option A Master Audio Upload Card */}
            {(examData.listening.audioUploadMode === 'single' || examData.listening.audioUrl) && (
              <div className="bg-white p-4 rounded-xl border border-orange-200 space-y-3 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 text-xs block">
                      Master Listening Audio File (All 4 Sections):
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Upload 1 MP3/WAV/M4A audio file (max 50 MB). It will play continuously throughout the entire listening module.
                    </span>
                  </div>
                  {examData.listening.audioUrl && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Master Audio Active
                    </span>
                  )}
                </div>

                {examData.listening.audioUrl ? (
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-2.5 overflow-hidden">
                      <Volume2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="truncate">
                        <span className="font-semibold text-slate-800 text-xs block truncate">
                          {examData.listening.audioFileName || 'Master Full Exam Audio Track'}
                        </span>
                        {(() => {
                          const masterYt = parseYoutubeId(examData.listening.audioUrl);
                          return masterYt ? (
                            <iframe
                              src={youtubeEmbedUrl(masterYt)}
                              title="Master YouTube preview"
                              className="w-full h-24 mt-1.5 rounded-lg border border-slate-200"
                              allow="accelerometer; encrypted-media; picture-in-picture"
                              allowFullScreen
                            />
                          ) : (
                            <audio controls src={examData.listening.audioUrl} className="h-7 mt-1.5" />
                          );
                        })()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveMasterAudio}
                      className="px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 font-semibold cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                  <label className="border-2 border-dashed border-orange-300 hover:border-orange-500 rounded-xl p-5 bg-orange-50/40 hover:bg-orange-50/70 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition text-center">
                    <Upload className="w-6 h-6 text-orange-500 mb-0.5" />
                    <span className="font-bold text-xs text-slate-800">
                      Upload 1 Master Audio File for All 4 Sections
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Click to choose MP3, WAV, or M4A audio file from your device (max 50 MB)
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleMasterAudioFileUpload(file);
                      }}
                      className="hidden"
                    />
                  </label>
                  <div className="pt-1 border-t border-orange-100">
                    <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                      Or Link Remote / YouTube URL (master track):
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="url"
                        placeholder="https://example.com/audio/master.mp3 or YouTube link"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleLinkMasterRemote((e.target as HTMLInputElement).value);
                          }
                        }}
                        className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <button
                        type="button"
                        onClick={e => {
                          const input = (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null);
                          if (input) handleLinkMasterRemote(input.value);
                        }}
                        className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        Link
                      </button>
                    </div>
                  </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6 text-xs">
            {examData.listening.sections.map((sec, sIdx) => {
              const currentMode = sectionAudioMode[sIdx] || (sec.audioUrl ? 'audio' : 'script');

              return (
                <div key={sec.id} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                  {/* Section Title Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <div>
                      <span className="font-bold text-orange-700 text-sm">
                        Section {sec.sectionNumber}: {sec.title}
                      </span>
                      <p className="text-[11px] text-slate-500">{sec.context}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-slate-500 font-mono text-[11px]">
                        Duration: {sec.audioDurationSeconds}s
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="text-slate-500 font-mono text-[11px]">
                        {countQuestionSlots(sec.questions)} questions
                      </span>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => setListeningImportFor(sIdx)}
                        title="Import section questions from PDF into this section (audio untouched)"
                        className="flex items-center space-x-1 px-2 py-1 bg-white hover:bg-orange-50 border border-orange-200 text-orange-700 rounded-lg text-[10px] font-bold cursor-pointer transition"
                      >
                        <Upload className="w-3 h-3" />
                        <span>Import Qs</span>
                      </button>
                    </div>
                  </div>

                  {/* Mode Switcher: Audio Upload/Recording vs Voice Script Scenario */}
                  <div className="flex items-center space-x-2 bg-slate-200/60 p-1 rounded-xl w-fit">
                    <button
                      type="button"
                      onClick={() => setSectionAudioMode({ ...sectionAudioMode, [sIdx]: 'audio' })}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer ${
                        currentMode === 'audio'
                          ? 'bg-white text-orange-700 shadow-xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Audio Recording &amp; Upload</span>
                      {sec.audioUrl && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setSectionAudioMode({ ...sectionAudioMode, [sIdx]: 'script' })}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer ${
                        currentMode === 'script'
                          ? 'bg-white text-orange-700 shadow-xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Voice Script Scenario (Fallback)</span>
                    </button>
                  </div>

                  {/* OPTION 1: AUDIO RECORDING & UPLOAD AREA */}
                  {currentMode === 'audio' && (
                    <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                      {sec.audioUrl ? (
                        /* Active Audio Track Loaded */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                            <div className="flex items-center space-x-2.5">
                              <Volume2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <div>
                                <span className="font-semibold text-slate-800 text-xs block">
                                  {sec.audioFileName || `Section ${sec.sectionNumber} Audio Track`}
                                </span>
                                <span className="text-[10px] text-emerald-700 font-mono">
                                  {probingSections[sIdx]
                                    ? 'Measuring real track length…'
                                    : `Real Duration: ${sec.audioDurationSeconds} seconds • Source: ${sec.audioSourceType || 'upload'}`}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAudio(sIdx)}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove Track</span>
                            </button>
                          </div>

                          {/* HTML5 Audio Preview */}
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                              Audio Playback Preview:
                            </span>
                            {(() => {
                              const yt = parseYoutubeId(sec.audioUrl);
                              return yt ? (
                                <iframe
                                  src={youtubeEmbedUrl(yt)}
                                  title={`Section ${sec.sectionNumber} YouTube preview`}
                                  className="w-full h-28 rounded-lg border border-slate-200"
                                  allow="accelerometer; encrypted-media; picture-in-picture"
                                  allowFullScreen
                                />
                              ) : (
                                <audio controls src={sec.audioUrl} className="w-full h-9" />
                              );
                            })()}
                          </div>
                        </div>
                      ) : (
                        /* No Audio Track Loaded: Upload / Mic Options */
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* File Drag & Drop Upload */}
                            <label className="border-2 border-dashed border-orange-200 hover:border-orange-400 bg-orange-50/30 rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition group">
                              <Upload className="w-6 h-6 text-orange-500 group-hover:scale-110 transition mb-2" />
                              <span className="text-xs font-bold text-slate-800">
                                Upload Audio File
                              </span>
                              <span className="text-[10px] text-slate-500 mt-0.5">
                                MP3, WAV, M4A, OGG, WebM (max 50 MB each)
                              </span>
                              <input
                                type="file"
                                accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac"
                                className="hidden"
                                onChange={e => {
                                  if (e.target.files && e.target.files[0]) {
                                    handleAudioFileUpload(e.target.files[0], sIdx);
                                  }
                                }}
                              />
                            </label>

                            {/* Live Microphone Recording */}
                            <div className="border border-slate-200 bg-slate-50 rounded-xl p-5 flex flex-col items-center justify-center text-center">
                              {activeRecordingSection === sIdx ? (
                                <div className="space-y-2">
                                  <div className="inline-flex items-center space-x-2 px-3 py-1 bg-rose-100 text-rose-700 rounded-full font-mono text-xs font-bold animate-pulse">
                                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
                                    <span>Recording: {recordingSeconds}s</span>
                                  </div>
                                  <div>
                                    <button
                                      type="button"
                                      onClick={stopMicrophoneRecording}
                                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-xs"
                                    >
                                      Stop &amp; Save Recording
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <Mic className="w-6 h-6 text-slate-500 mx-auto" />
                                  <div>
                                    <span className="text-xs font-bold text-slate-800 block">
                                      Record with Microphone
                                    </span>
                                    <span className="text-[10px] text-slate-500 block mt-0.5">
                                      Narrate Section directly
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => startMicrophoneRecording(sIdx)}
                                    className="px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-2xs"
                                  >
                                    Start Live Recording
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Direct Audio URL Input */}
                          <div className="pt-2 border-t border-slate-100">
                            <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                              Or Link Remote Hosted Audio / YouTube URL:
                            </label>
                            <div className="flex space-x-2">
                              <input
                                type="url"
                                placeholder="https://example.com/audio/section-1.mp3 or YouTube link"
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleLinkSectionRemote(sIdx, (e.target as HTMLInputElement).value);
                                  }
                                }}
                                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                              />
                              <button
                                type="button"
                                onClick={e => {
                                  const input = (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null);
                                  if (input) handleLinkSectionRemote(sIdx, input.value);
                                }}
                                className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
                              >
                                Link
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              Direct MP3/WAV/M4A link or YouTube watch / youtu.be / embed / shorts URL. YouTube plays audio-only for students.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* OPTION 2: VOICE SCRIPT / SCENARIO FALLBACK */}
                  {currentMode === 'script' && (
                    <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-[10px] text-slate-600 uppercase font-bold">
                            Voice Script / Speech Synthesis Text
                          </label>
                          <span className="text-[10px] text-slate-400">
                            Used if no audio file is uploaded or playback fails
                          </span>
                        </div>
                        <textarea
                          rows={3}
                          value={sec.audioScriptSnippet}
                          onChange={e => {
                            const updated = [...examData.listening.sections];
                            updated[sIdx].audioScriptSnippet = e.target.value;
                            setExamData({ ...examData, listening: { ...examData.listening, sections: updated } });
                          }}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          placeholder="Type or paste the spoken script for this section..."
                        />
                      </div>

                      <div className="w-48">
                        <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                          Estimated Duration (Seconds)
                        </label>
                        <input
                          type="number"
                          value={sec.audioDurationSeconds}
                          onChange={e => {
                            const updated = [...examData.listening.sections];
                            updated[sIdx].audioDurationSeconds = parseInt(e.target.value) || 45;
                            setExamData({ ...examData, listening: { ...examData.listening, sections: updated } });
                          }}
                          className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {/* Questions Manager for this Section */}
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-2">
                      Questions ({countQuestionSlots(sec.questions)})
                    </span>
                    <QuestionEditor
                      questions={sec.questions}
                      onChange={qs => updateListeningQuestions(sIdx, qs)}
                      idPrefix="l"
                      module="listening"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {listeningImportFor !== null && examData.listening.sections[listeningImportFor] && (
            <ListeningImportModal
              sections={examData.listening.sections}
              initialSectionIdx={listeningImportFor}
              onClose={() => setListeningImportFor(null)}
              onInsert={applyListeningImport}
            />
          )}

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(1)}
              className="flex items-center space-x-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex items-center space-x-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <span>Next: Reading Passages</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Reading Module */}
      {step === 3 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-orange-600" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Academic Reading Passages ({examData.reading.passages.length} Passages)
              </h3>
            </div>
            <span className="text-xs text-orange-600 font-bold">
              Total Questions: {countQuestionSlots(examData.reading.passages.flatMap(p => p.questions))}
            </span>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setReadingImportFor(0)}
              disabled={examData.reading.passages.length === 0}
              title={examData.reading.passages.length === 0 ? 'Add a passage first' : 'Import passage + questions from PDF'}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white rounded-xl text-[11px] font-bold cursor-pointer transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Reading from PDF</span>
            </button>
          </div>

          <div className="space-y-4 text-xs">
            {examData.reading.passages.map((passage, pIdx) => (
              <div key={passage.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-orange-700 text-xs">
                    Passage {passage.passageNumber}: {passage.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500 font-mono text-[11px]">
                      {countQuestionSlots(passage.questions)} questions
                    </span>
                    <button
                      onClick={() => setReadingImportFor(pIdx)}
                      title="Import passage + questions from PDF into this passage"
                      className="flex items-center space-x-1 px-2 py-1 bg-white hover:bg-orange-50 border border-orange-200 text-orange-700 rounded-lg text-[10px] font-bold cursor-pointer transition"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Import file</span>
                    </button>
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                    Passage Text Content
                  </label>
                  <textarea
                    rows={4}
                    value={passage.text}
                    onChange={e => {
                      const updated = [...examData.reading.passages];
                      updated[pIdx].text = e.target.value;
                      setExamData({ ...examData, reading: { ...examData.reading, passages: updated } });
                    }}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                {/* Questions Manager for this Passage */}
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block mb-2">
                    Questions ({countQuestionSlots(passage.questions)})
                  </span>
                  <QuestionEditor
                    questions={passage.questions}
                    onChange={qs => updateReadingQuestions(pIdx, qs)}
                    idPrefix="r"
                    module="reading"
                  />
                </div>
              </div>
            ))}
          </div>

          {readingImportFor !== null && examData.reading.passages[readingImportFor] && (
            <DocumentImportModal
              passages={examData.reading.passages}
              initialPassageIdx={readingImportFor}
              onClose={() => setReadingImportFor(null)}
              onInsert={applyReadingImport}
            />
          )}

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(2)}
              className="flex items-center space-x-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setStep(4)}
              className="flex items-center space-x-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <span>Next: Writing Prompts</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Writing Prompts */}
      {step === 4 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-2">
              <PenTool className="w-4 h-4 text-orange-600" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Writing Module Prompts (Task 1 &amp; Task 2)
              </h3>
            </div>
            <span className="text-xs text-orange-600 font-bold">60 Minutes Exam Limit</span>
          </div>

          <div className="space-y-6 text-xs">
            {/* Task 1 */}
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <span className="font-bold text-orange-700 text-xs uppercase tracking-wider">
                  Task 1: Academic Report (Min 150 words)
                </span>
                <span className="text-[11px] text-slate-500 font-medium">Standard 20 mins</span>
              </div>

              {/* Task 1 Quick Setup: one pasted JSON fills the whole task */}
              {(() => {
                const parsed = task1JsonText.trim()
                  ? parseTask1DraftJson(task1JsonText, examData.writing.task1.chartType)
                  : null;
                return (
                  <div className="p-3 bg-violet-50/60 border border-violet-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-violet-900 uppercase tracking-wider">
                        Task 1 Quick Setup (JSON) — paste once, Task 1 is fully ready
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setTask1JsonText(task1TemplateFor(examData.writing.task1.chartType));
                            setTask1AppliedMsg(null);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                        >
                          Load template
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard?.writeText(TASK1_AI_PROMPT);
                              setTask1CopyMsg('AI prompt copied — paste it into ChatGPT (or any AI) together with your chart picture, then paste the returned JSON below.');
                            } catch {
                              setTask1CopyMsg('Clipboard blocked — the AI prompt is long; ask the developer to export it another way.');
                            }
                            setTimeout(() => setTask1CopyMsg(null), 9000);
                          }}
                          className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[11px] font-bold cursor-pointer transition"
                        >
                          Copy AI prompt (for ChatGPT)
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Workflow: <strong>Copy AI prompt</strong> → paste it into ChatGPT with your chart picture → paste the
                      returned JSON below → <strong>Apply</strong>. Title, prompt, chart type, description, summary and chart
                      data all fill in at once (switches to built-in chart mode; omit <code className="font-mono bg-white px-1 border rounded">chartData</code> to clear the chart).
                    </p>
                    <textarea
                      rows={7}
                      value={task1JsonText}
                      onChange={e => {
                        setTask1JsonText(e.target.value);
                        setTask1AppliedMsg(null);
                      }}
                      spellCheck={false}
                      placeholder={task1TemplateFor(examData.writing.task1.chartType)}
                      className={`w-full p-2 bg-slate-900 text-emerald-100 border rounded-lg font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-500 ${parsed?.error ? 'border-red-400' : 'border-slate-700'}`}
                    />
                    {parsed?.error && (
                      <p className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {parsed.error}
                      </p>
                    )}
                    {task1CopyMsg && (
                      <p className="text-[11px] text-emerald-700 font-medium">{task1CopyMsg}</p>
                    )}
                    {task1AppliedMsg && (
                      <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {task1AppliedMsg}
                      </p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={applyTask1Json}
                        disabled={!parsed?.draft}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition"
                      >
                        Apply JSON to Task 1
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                  Task 1 Title
                </label>
                <input
                  type="text"
                  value={examData.writing.task1.title}
                  onChange={e =>
                    setExamData({
                      ...examData,
                      writing: {
                        ...examData.writing,
                        task1: { ...examData.writing.task1, title: e.target.value }
                      }
                    })
                  }
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                  Task 1 Prompt &amp; Report Instructions
                </label>
                <textarea
                  rows={3}
                  value={examData.writing.task1.prompt}
                  onChange={e =>
                    setExamData({
                      ...examData,
                      writing: {
                        ...examData.writing,
                        task1: { ...examData.writing.task1, prompt: e.target.value }
                      }
                    })
                  }
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Task 1 Visual Material Switcher: Upload Picture vs Built-in SVG Chart */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Task 1 Visual Material &amp; Diagram
                  </span>
                  <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        setExamData({
                          ...examData,
                          writing: {
                            ...examData.writing,
                            task1: { ...examData.writing.task1, visualMode: 'upload' }
                          }
                        })
                      }
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                        examData.writing.task1.visualMode === 'upload'
                          ? 'bg-white text-orange-600 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Upload Picture / Diagram
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExamData({
                          ...examData,
                          writing: {
                            ...examData.writing,
                            task1: { ...examData.writing.task1, visualMode: 'builtin' }
                          }
                        })
                      }
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                        examData.writing.task1.visualMode !== 'upload'
                          ? 'bg-white text-orange-600 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Built-in Vector Chart &amp; Summary
                    </button>
                  </div>
                </div>

                {/* VISUAL MODE 1: UPLOAD PICTURE / DIAGRAM */}
                {examData.writing.task1.visualMode === 'upload' ? (
                  <div className="space-y-4">
                    {examData.writing.task1.imageUrl ? (
                      /* Image Loaded */
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                          <div className="flex items-center space-x-3">
                            <img
                              src={examData.writing.task1.imageUrl}
                              alt="Task 1 Diagram Preview"
                              className="w-16 h-12 object-cover rounded-lg border border-slate-300 shadow-2xs"
                            />
                            <div>
                              <span className="font-semibold text-slate-800 text-xs block">
                                {examData.writing.task1.imageFileName || 'Task 1 Visual Diagram'}
                              </span>
                              <span className="text-[10px] text-emerald-600 font-medium">
                                Ready for student exam presentation
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => setZoomedImage(examData.writing.task1.imageUrl!)}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer transition"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                              <span>Enlarge</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleRemoveDiagram}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>

                        {/* Image Preview Box */}
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-center">
                          <img
                            src={examData.writing.task1.imageUrl}
                            alt="Uploaded Diagram"
                            className="max-h-56 max-w-full object-contain rounded-lg border border-slate-200 shadow-2xs cursor-pointer"
                            onClick={() => setZoomedImage(examData.writing.task1.imageUrl!)}
                          />
                        </div>
                      </div>
                    ) : (
                      /* Drag & Drop Upload or Remote URL */
                      <div className="space-y-4">
                        <label className="border-2 border-dashed border-orange-200 hover:border-orange-400 bg-orange-50/20 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition group">
                          <ImageIcon className="w-7 h-7 text-orange-500 group-hover:scale-110 transition mb-2" />
                          <span className="text-xs font-bold text-slate-800">
                            Click or Drag Image File Here
                          </span>
                          <span className="text-[10px] text-slate-500 mt-1">
                            Supported: PNG, JPG, JPEG, WebP, SVG (High-Res Diagrams, Charts, Maps)
                          </span>
                          <input
                            type="file"
                            accept="image/*,.png,.jpg,.jpeg,.webp,.svg"
                            className="hidden"
                            onChange={e => {
                              if (e.target.files && e.target.files[0]) {
                                handleDiagramUpload(e.target.files[0]);
                              }
                            }}
                          />
                        </label>

                        <div>
                          <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                            Or Enter Diagram Hosted URL:
                          </label>
                          <input
                            type="url"
                            placeholder="https://example.com/diagrams/ielts-task1-map.png"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                if (val.trim()) {
                                  setExamData({
                                    ...examData,
                                    writing: {
                                      ...examData.writing,
                                      task1: {
                                        ...examData.writing.task1,
                                        imageUrl: val.trim(),
                                        visualMode: 'upload'
                                      }
                                    }
                                  });
                                }
                              }
                            }}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* VISUAL MODE 2: BUILT-IN VECTOR CHART & DATA SUMMARY */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                          Chart Type
                        </label>
                        <select
                          value={examData.writing.task1.chartType}
                          onChange={e => {
                            const nextType = e.target.value as Exam['writing']['task1']['chartType'];
                            setExamData({
                              ...examData,
                              writing: {
                                ...examData.writing,
                                task1: {
                                  ...examData.writing.task1,
                                  chartType: nextType
                                }
                              }
                            });
                            // Re-validate existing JSON against the new type.
                            if (chartJsonText.trim()) applyChartJson(chartJsonText, nextType);
                          }}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="bar_chart">Comparative Bar Chart</option>
                          <option value="line_graph">Historical Line Graph</option>
                          <option value="pie_chart">Proportional Pie Chart</option>
                          <option value="process_diagram">Process Flow Diagram</option>
                          <option value="map">Comparative Plan / Map</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                          Chart Description / Headline
                        </label>
                        <input
                          type="text"
                          value={examData.writing.task1.chartDescription}
                          onChange={e =>
                            setExamData({
                              ...examData,
                              writing: {
                                ...examData.writing,
                                task1: {
                                  ...examData.writing.task1,
                                  chartDescription: e.target.value
                                }
                              }
                            })
                          }
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                        Key Data Summary (Numeric metrics for candidate reference)
                      </label>
                      <textarea
                        rows={2}
                        value={examData.writing.task1.chartDataSummary}
                        onChange={e =>
                          setExamData({
                            ...examData,
                            writing: {
                              ...examData.writing,
                              task1: {
                                ...examData.writing.task1,
                                chartDataSummary: e.target.value
                              }
                            }
                          })
                        }
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] text-slate-600 uppercase font-bold">
                          Chart Data (JSON) <span className="normal-case font-medium text-slate-400">— drives the vector chart below</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => applyChartJson(chartTemplateFor(examData.writing.task1.chartType), examData.writing.task1.chartType)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                        >
                          Load template for this chart type
                        </button>
                      </div>
                      <textarea
                        rows={8}
                        value={chartJsonText}
                        onChange={e => applyChartJson(e.target.value, examData.writing.task1.chartType)}
                        spellCheck={false}
                        placeholder={chartTemplateFor(examData.writing.task1.chartType)}
                        className={`w-full p-2 bg-slate-900 text-emerald-100 border rounded-lg font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-orange-500 ${chartJsonError ? 'border-red-400' : 'border-slate-700'}`}
                      />
                      {chartJsonError ? (
                        <p className="mt-1 text-[11px] text-red-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          {chartJsonError}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-400">
                          {chartJsonText.trim()
                            ? 'Valid — the preview below is exactly what candidates will see.'
                            : 'Empty — paste JSON or load the template. For 2+ visuals (e.g. two pie charts) paste a JSON ARRAY [{...}, {...}], each with its own "chartType". Without data, candidates see a neutral placeholder (never invented numbers).'}
                        </p>
                      )}
                    </div>

                    <div>
                      <span className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                        Live Preview (candidate view)
                      </span>
                      <div className="p-3 bg-white border border-slate-200 rounded-lg">
                        <p className="text-[12px] font-bold text-slate-800 mb-1">{examData.writing.task1.chartDescription || 'Chart title…'}</p>
                        <Task1Chart task1={examData.writing.task1} />
                        {examData.writing.task1.chartDataSummary && (
                          <p className="text-[12px] text-slate-700 border-t border-slate-200 pt-2 mt-2">
                            <strong>Summary:</strong> {examData.writing.task1.chartDataSummary}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Task 2 */}
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <span className="font-bold text-orange-700 text-xs uppercase tracking-wider">
                  Task 2: Discursive Essay (Min 250 words)
                </span>
                <span className="text-[11px] text-slate-500 font-medium">Standard 40 mins</span>
              </div>

              <div>
                <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                  Task 2 Title
                </label>
                <input
                  type="text"
                  value={examData.writing.task2.title}
                  onChange={e =>
                    setExamData({
                      ...examData,
                      writing: {
                        ...examData.writing,
                        task2: { ...examData.writing.task2, title: e.target.value }
                      }
                    })
                  }
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-600 uppercase font-bold mb-1">
                  Task 2 Essay Topic &amp; Guidance
                </label>
                <textarea
                  rows={3}
                  value={examData.writing.task2.prompt}
                  onChange={e =>
                    setExamData({
                      ...examData,
                      writing: {
                        ...examData.writing,
                        task2: { ...examData.writing.task2, prompt: e.target.value }
                      }
                    })
                  }
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-100">
            <button
              onClick={() => setStep(3)}
              className="flex items-center space-x-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center space-x-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-semibold shadow-sm shadow-orange-500/25 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSaving ? 'Deploying...' : 'Save & Publish Exam'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Image Zoom Lightbox Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl p-2 shadow-2xl overflow-hidden flex flex-col items-center">
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-4 right-4 p-2 bg-slate-900/70 hover:bg-slate-900 text-white rounded-full transition shadow-md cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomedImage}
              alt="Zoomed Diagram"
              className="max-h-[85vh] max-w-full object-contain rounded-xl"
            />
          </div>
        </div>
      )}

      {/* Candidate-view draft preview (unsaved edits included, answer keys visible) */}
      {showPreview && (
        <ExamPreviewModal
          exam={examData}
          subtitle="Unsaved draft preview — save & deploy to publish these edits to candidates."
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
};
