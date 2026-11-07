import React, { useState, useEffect } from 'react';
import { Award, FileCheck2, BookOpen, Headphones, PenTool, Mic, CheckCircle2, XCircle, MessageSquare, AlertCircle, Eye, Printer, ZoomIn, X, Image as ImageIcon, Download, FileText, Lock, Clock } from 'lucide-react';
import { CandidateSession, Exam, Question, isExamPaperReleased, getExamResultsReleaseMs } from '../../types';
import { CandidateAvatar } from '../CandidateAvatar';
import { formatDateLong } from '../../utils/formatDate';
import { checkAnswerMatch, isSessionAllGradesFinalized, getSessionGradingProgress, multiSlotResults } from '../../utils/ieltsScoring';

interface ReviewRow {
  key: string;
  number: number;
  prompt?: string;
  studentAns: string;
  accepted: string;
  ok: boolean;
  explanation?: string;
}

/**
 * Flatten questions into review rows — one per question number. A 2-letter
 * multi starting at 11 expands into rows 11 and 12, each with its own
 * correct letter and per-letter verdict.
 */
function buildReviewRows(
  questions: Question[],
  answers: Record<string, string>,
  overrides?: Record<string, boolean>
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const q of questions) {
    if (q.type === 'multiple_choice_multi') {
      const ov = overrides?.[q.id];
      for (const s of multiSlotResults(q, answers[q.id], ov)) {
        rows.push({
          key: `${q.id}#${s.number}`,
          number: s.number,
          prompt: q.prompt,
          studentAns: s.pickedLetter || '',
          accepted: s.correctLetter,
          ok: s.ok,
          explanation: q.explanation
        });
      }
    } else {
      const ov = overrides?.[q.id];
      const ok = ov !== undefined ? ov : checkAnswerMatch(answers[q.id], q.acceptedAnswers);
      rows.push({
        key: q.id,
        number: q.number,
        prompt: q.prompt,
        studentAns: answers[q.id] || '',
        accepted: q.acceptedAnswers.join(' / '),
        ok,
        explanation: q.explanation
      });
    }
  }
  return rows;
}

const ReviewRowCard: React.FC<{ row: ReviewRow }> = ({ row }) => (
  <div
    className={`p-4 rounded-xl border transition ${
      row.ok
        ? 'bg-emerald-50/50 border-emerald-200'
        : 'bg-rose-50/50 border-rose-200'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start space-x-3">
        <span className="w-6 h-6 rounded-lg bg-slate-100 font-mono text-xs font-bold flex items-center justify-center shrink-0 text-slate-700 border border-slate-200">
          {row.number}
        </span>
        <div className="space-y-1 text-xs">
          <div className="text-slate-800 font-medium">{row.prompt}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] pt-1 font-mono">
            <span>
              Your Answer:{' '}
              <strong className={row.ok ? 'text-emerald-700' : 'text-rose-700'}>
                {row.studentAns || '(Unanswered)'}
              </strong>
            </span>
            <span>
              Accepted Key(s):{' '}
              <strong className="text-slate-700">{row.accepted}</strong>
            </span>
          </div>
          {row.explanation && (
            <div className="text-[11px] text-slate-500 italic pt-1">
              Note: {row.explanation}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-1.5 shrink-0">
        {row.ok ? (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Correct</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
            <XCircle className="w-3.5 h-3.5" />
            <span>Incorrect</span>
          </span>
        )}
      </div>
    </div>
  </div>
);

interface StudentReviewPageProps {
  session: CandidateSession;
  exam: Exam;
  onOpenTrfModal: () => void;
}

export const StudentReviewPage: React.FC<StudentReviewPageProps> = ({
  session,
  exam,
  onOpenTrfModal
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'listening' | 'reading' | 'writing' | 'speaking'>('overview');
  const [showImageZoom, setShowImageZoom] = useState(false);

  const lScore = session.grading.listeningScore;
  const rScore = session.grading.readingScore;
  const wScore = session.grading.writingAdminEvaluation || session.grading.writingAiEvaluation;
  const sScore = session.grading.speakingEvaluation;
  const overall = session.grading.finalOverallBand;
  const cefr = session.grading.cefrLevel;
  const isAllFinalized = isSessionAllGradesFinalized(session);
  const gradingProgress = getSessionGradingProgress(session);

  // Flattened questions for review
  const allListeningQuestions = exam.listening.sections.flatMap(s => s.questions);
  const allReadingQuestions = exam.reading.passages.flatMap(p => p.questions);

  // Generate complete downloadable / printable exam paper HTML
  const generatePrintablePaperHtml = () => {
    const rowHtml = (row: ReviewRow) => `
        <tr style="border-bottom: 1px solid #e2e8f0; background: ${row.ok ? '#f0fdf4' : '#fff1f2'};">
          <td style="padding: 10px; font-weight: bold; width: 40px;">${row.number}</td>
          <td style="padding: 10px;">${row.prompt}</td>
          <td style="padding: 10px; font-family: monospace; font-weight: bold; color: ${row.ok ? '#166534' : '#991b1b'};">${row.studentAns || '—'}</td>
          <td style="padding: 10px; font-family: monospace; color: #475569;">${row.accepted}</td>
          <td style="padding: 10px; font-weight: bold; color: ${row.ok ? '#16a34a' : '#dc2626'}; text-align: center;">${row.ok ? '✓ CORRECT' : '✗ MISTAKE'}</td>
        </tr>
      `;
    const lQuestionsHtml = buildReviewRows(
      allListeningQuestions,
      session.listeningState.answers,
      lScore?.overrides
    ).map(rowHtml).join('');

    const rQuestionsHtml = buildReviewRows(
      allReadingQuestions,
      session.readingState.answers,
      rScore?.overrides
    ).map(rowHtml).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>IELTS Examination Paper & Candidate Review - ${session.candidateName} (${session.candidateId})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 30px; margin: 0 auto; max-width: 900px; }
    h1, h2, h3 { color: #0f172a; margin-top: 1.5em; margin-bottom: 0.5em; }
    .header-box { border: 2px solid #ea580c; border-radius: 12px; padding: 20px; background: #fff7ed; margin-bottom: 25px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px; }
    .scores-table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; text-align: left; }
    .scores-table th { background: #f8fafc; padding: 10px; border-bottom: 2px solid #cbd5e1; }
    .scores-table td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .questions-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 15px 0; }
    .questions-table th { background: #f1f5f9; padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: left; }
    .task-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin: 15px 0; background: #f8fafc; }
    .essay-box { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; white-space: pre-wrap; font-family: Georgia, serif; line-height: 1.7; font-size: 14px; }
    .footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #fdba74; padding-bottom: 10px; margin-bottom: 12px;">
      <div>
        <h1 style="margin: 0; font-size: 22px; color: #9a3412;">IELTS Gate Official Examination Paper & Review</h1>
        <div style="font-size: 12px; color: #c2410c; margin-top: 3px;">Detailed Answer Review & Mistakes Evaluation Report</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 11px; color: #9a3412; font-weight: bold;">TRF NUMBER</div>
        <div style="font-family: monospace; font-size: 15px; font-weight: bold;">${session.trfNumber}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><strong>Candidate:</strong> ${session.candidateName}</div>
      <div><strong>Candidate ID:</strong> <span style="font-family: monospace;">${session.candidateId}</span></div>
      <div><strong>Exam Form:</strong> ${session.examTitle}</div>
      <div><strong>Date of Birth:</strong> ${session.dateOfBirth || '—'}</div>
      <div><strong>Test Date:</strong> ${formatDateLong(session.createdAt || Date.now())}</div>
      <div><strong>Status:</strong> ${isAllFinalized ? 'Certified & Published' : 'Preliminary Evaluation'}</div>
    </div>
  </div>

  <h2>Official Band Score Summary</h2>
  <table class="scores-table">
    <thead>
      <tr>
        <th>Listening</th>
        <th>Reading</th>
        <th>Writing</th>
        <th>Speaking</th>
        <th style="background: #ea580c; color: white;">Overall Band</th>
        <th style="background: #ea580c; color: white;">CEFR Level</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="font-size: 18px; font-weight: bold;">${lScore?.band ? lScore.band.toFixed(1) : '—'}</td>
        <td style="font-size: 18px; font-weight: bold;">${rScore?.band ? rScore.band.toFixed(1) : '—'}</td>
        <td style="font-size: 18px; font-weight: bold;">${wScore?.overallBand ? wScore.overallBand.toFixed(1) : '—'}</td>
        <td style="font-size: 18px; font-weight: bold;">${sScore?.overallBand ? sScore.overallBand.toFixed(1) : '—'}</td>
        <td style="font-size: 22px; font-weight: 900; color: #ea580c;">${isAllFinalized && overall !== undefined ? overall.toFixed(1) : '—'}</td>
        <td style="font-size: 16px; font-weight: bold; color: #047857;">${isAllFinalized && cefr ? cefr : '—'}</td>
      </tr>
    </tbody>
  </table>

  <div class="page-break"></div>

  <h2>1. Listening Module Breakdown & Mistakes</h2>
  <p style="font-size: 12px; color: #64748b;">Raw Score: ${lScore?.raw || 0} / ${lScore?.total || allListeningQuestions.length} Correct</p>
  <table class="questions-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Question Prompt</th>
        <th>Candidate Answer</th>
        <th>Correct / Accepted Answer</th>
        <th style="text-align: center;">Result</th>
      </tr>
    </thead>
    <tbody>
      ${lQuestionsHtml}
    </tbody>
  </table>

  <div class="page-break"></div>

  <h2>2. Reading Module Breakdown & Mistakes</h2>
  <p style="font-size: 12px; color: #64748b;">Raw Score: ${rScore?.raw || 0} / ${rScore?.total || allReadingQuestions.length} Correct</p>
  <table class="questions-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Question Prompt</th>
        <th>Candidate Answer</th>
        <th>Correct / Accepted Answer</th>
        <th style="text-align: center;">Result</th>
      </tr>
    </thead>
    <tbody>
      ${rQuestionsHtml}
    </tbody>
  </table>

  <div class="page-break"></div>

  <h2>3. Writing Module Paper & Examiner Evaluation</h2>

  <div class="task-box">
    <h3>Task 1: Academic Report (Band: ${wScore?.task1Band?.overall ? wScore.task1Band.overall.toFixed(1) : '—'})</h3>
    <p style="font-size: 13px; color: #475569;"><strong>Prompt:</strong> ${exam.writing.task1.prompt}</p>
    <h4>Candidate's Written Response (${session.writingState.task1Response ? session.writingState.task1Response.trim().split(/\\s+/).length : 0} words):</h4>
    <div class="essay-box">${session.writingState.task1Response || '(No response submitted)'}</div>
  </div>

  <div class="task-box">
    <h3>Task 2: Discursive Essay (Band: ${wScore?.task2Band?.overall ? wScore.task2Band.overall.toFixed(1) : '—'})</h3>
    <p style="font-size: 13px; color: #475569;"><strong>Prompt:</strong> ${exam.writing.task2.prompt}</p>
    <h4>Candidate's Written Response (${session.writingState.task2Response ? session.writingState.task2Response.trim().split(/\\s+/).length : 0} words):</h4>
    <div class="essay-box">${session.writingState.task2Response || '(No response submitted)'}</div>
  </div>

  ${(session.grading.writingAdminEvaluation?.examinerFeedback || session.grading.writingAiEvaluation?.feedbackSummary) ? `
    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 15px; margin: 15px 0;">
      <h4 style="margin: 0 0 8px 0; color: #166534;">Senior Examiner Feedback & Guidance:</h4>
      <p style="margin: 0; font-size: 13px; color: #14532d;">${session.grading.writingAdminEvaluation?.examinerFeedback || session.grading.writingAiEvaluation?.feedbackSummary}</p>
    </div>
  ` : ''}

  <h2>4. Speaking Module Evaluation</h2>
  <div class="task-box">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0;">Speaking Interview Band: ${sScore?.overallBand ? sScore.overallBand.toFixed(1) : '—'}</h3>
      <span style="font-size: 12px; font-family: monospace;">FC: ${sScore?.fluency || '—'} | LR: ${sScore?.lexical || '—'} | GRA: ${sScore?.grammar || '—'} | PR: ${sScore?.pronunciation || '—'}</span>
    </div>
    <p style="font-size: 13px; color: #475569; margin-top: 8px;"><strong>Examiner Observations:</strong> ${sScore?.examinerNotes || 'Interview evaluation completed and archived.'}</p>
  </div>

  <div class="footer">
    <p>IELTS Gate Automated Assessment & Proctor Network • Official Verification: https://igmock.examination.workers.dev/verify/${session.candidateId}</p>
  </div>
</body>
</html>`;
  };

  const handleDownloadPaper = () => {
    const htmlContent = generatePrintablePaperHtml();
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `IELTS_Exam_Paper_${session.candidateId}_${session.trfNumber}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintPaper = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(generatePrintablePaperHtml());
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    } else {
      window.print();
    }
  };

  // Two-slot exam days: the whole paper (questions, answers, scores) stays
  // hidden until the second session ends (or the admin releases it), so
  // slot-1 finishers cannot leak it to slot-2 candidates. Re-checked live
  // so the page unlocks itself once release passes.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!isExamPaperReleased(exam, nowMs)) {
    const releaseMs = getExamResultsReleaseMs(exam);
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 sm:p-10 shadow-xs text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-amber-50 border-2 border-amber-200 text-amber-600">
            <Clock className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Results Pending</h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-md mx-auto">
              <strong className="text-slate-800">{session.candidateName}</strong> ({session.candidateId}) — your{' '}
              <strong className="text-slate-800">{session.examTitle}</strong>
              {session.examSlot ? ` (Slot ${session.examSlot})` : ''} answers are recorded and safe.
              Questions, answers and scores unlock automatically once all sessions of this exam day finish
              {releaseMs ? <> (around <strong className="text-slate-800">{new Date(releaseMs).toLocaleString()}</strong>)</> : ''}.
            </p>
          </div>
          <p className="text-[11px] text-slate-400">This page refreshes itself — no need to log out.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Candidate Scorecard Header */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <CandidateAvatar
                name={session.candidateName}
                photoUrl={session.candidatePhotoUrl}
                className="w-20 h-20 rounded-2xl border-2 border-slate-200 shadow-2xs"
                textClassName="text-xl"
              />
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">{session.candidateName}</h1>
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {session.candidateId}
                </span>
              </div>
              <p className="text-xs text-slate-500">{session.examTitle}</p>
              <div className="flex items-center space-x-2 text-[11px] text-slate-500 pt-1">
                <span>TRF Reference: <strong className="text-slate-800 font-mono">{session.trfNumber}</strong></span>
                <span>•</span>
                <span className={isAllFinalized ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                  {isAllFinalized ? 'Results Finalized & Certified' : 'Grades Pending Examiner Finalization'}
                </span>
              </div>
            </div>
          </div>

          {/* Overall Band Pill & Download Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center min-w-[130px] shadow-2xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                Overall Band
              </span>
              <div className="text-4xl font-black text-slate-900 mt-0.5 tracking-tight">
                {isAllFinalized && overall !== undefined ? overall.toFixed(1) : '—'}
              </div>
              {isAllFinalized && cefr ? (
                <span className="inline-block mt-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  CEFR Level {cefr}
                </span>
              ) : (
                <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Pending Finalization
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 w-full sm:w-auto">
              {/* Task 3: Download Full Paper & Mistakes Button */}
              <button
                type="button"
                onClick={handleDownloadPaper}
                className="flex items-center justify-center space-x-2 py-2.5 px-4 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                title="Download self-contained offline exam paper with all mistakes and correct answers"
              >
                <Download className="w-4 h-4" />
                <span>Download Exam Paper &amp; Mistakes</span>
              </button>

              <button
                type="button"
                onClick={handlePrintPaper}
                className="flex items-center justify-center space-x-2 py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition shadow-2xs cursor-pointer"
                title="Print exam paper to PDF"
              >
                <Printer className="w-4 h-4 text-slate-400" />
                <span>Print to PDF</span>
              </button>

              {isAllFinalized ? (
                <button
                  type="button"
                  onClick={onOpenTrfModal}
                  className="flex items-center justify-center space-x-2 py-2 px-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4 text-emerald-600" />
                  <span>View Official TRF</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl text-xs font-medium cursor-not-allowed select-none"
                  title="Official TRF certificate is locked until all 4 module grades are finalized"
                >
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>TRF Locked (Pending All Grades)</span>
                </div>
              )}
            </div>
          </div>
        </div>

          {/* Result eligibility: records auto-delete 180 days (~6 months) after the test */}
          {(() => {
            const testTime = new Date(session.createdAt || Date.now()).getTime();
            const expiry = new Date(testTime + 180 * 24 * 60 * 60 * 1000);
            return (
              <div className="mt-4 flex items-start space-x-2 p-3 bg-sky-50 border border-sky-200 rounded-2xl text-[11px] text-sky-900 leading-relaxed">
                <Clock className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <span>
                  Your result stays available until <strong>{formatDateLong(expiry)}</strong> (6 months from your test date).
                  Records older than 180 days are automatically and permanently deleted.
                </span>
              </div>
            );
          })()}

          {!isAllFinalized && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5">
            <div className="flex items-start space-x-2.5 text-xs text-amber-900 font-semibold">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Official Test Report Form (TRF) certificate is locked until all 4 module grades are finalized. Listening and Reading scores are evaluated below; Writing and Live Speaking assessments are currently undergoing examiner review.
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
              <div className={`p-2.5 rounded-xl border ${gradingProgress.hasListening ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-white border-amber-200 text-amber-800'}`}>
                <span className="text-[10px] uppercase font-bold block text-slate-500 font-sans">Listening</span>
                <span className="font-bold">{gradingProgress.hasListening ? `Band ${gradingProgress.listeningBand?.toFixed(1)} ✓` : 'Pending'}</span>
              </div>
              <div className={`p-2.5 rounded-xl border ${gradingProgress.hasReading ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-white border-amber-200 text-amber-800'}`}>
                <span className="text-[10px] uppercase font-bold block text-slate-500 font-sans">Reading</span>
                <span className="font-bold">{gradingProgress.hasReading ? `Band ${gradingProgress.readingBand?.toFixed(1)} ✓` : 'Pending'}</span>
              </div>
              <div className={`p-2.5 rounded-xl border ${gradingProgress.hasWriting ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-white border-amber-200 text-amber-800'}`}>
                <span className="text-[10px] uppercase font-bold block text-slate-500 font-sans">Writing</span>
                <span className="font-bold">{gradingProgress.hasWriting ? `Band ${gradingProgress.writingBand?.toFixed(1)} ✓` : '⏳ Examiner Review'}</span>
              </div>
              <div className={`p-2.5 rounded-xl border ${gradingProgress.hasSpeaking ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-white border-amber-200 text-amber-800'}`}>
                <span className="text-[10px] uppercase font-bold block text-slate-500 font-sans">Speaking</span>
                <span className="font-bold">{gradingProgress.hasSpeaking ? `Band ${gradingProgress.speakingBand?.toFixed(1)} ✓` : '⏳ Examiner Interview'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-orange-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Score Breakdown</span>
        </button>

        <button
          onClick={() => setActiveTab('listening')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'listening'
              ? 'bg-orange-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Headphones className="w-4 h-4" />
          <span>Listening ({lScore?.band || '—'} Band)</span>
        </button>

        <button
          onClick={() => setActiveTab('reading')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'reading'
              ? 'bg-orange-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Reading ({rScore?.band || '—'} Band)</span>
        </button>

        <button
          onClick={() => setActiveTab('writing')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'writing'
              ? 'bg-orange-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>Writing &amp; Sticky Notes ({wScore?.overallBand || '—'} Band)</span>
        </button>

        <button
          onClick={() => setActiveTab('speaking')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeTab === 'speaking'
              ? 'bg-orange-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Mic className="w-4 h-4" />
          <span>Speaking ({sScore?.overallBand || '—'} Band)</span>
        </button>
      </div>

      {/* Tab Content: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 text-center shadow-xs">
              <Headphones className="w-5 h-5 mx-auto text-orange-600 mb-2" />
              <span className="text-xs text-slate-500 font-medium">Listening</span>
              <div className="text-3xl font-black text-slate-900 mt-1">
                {lScore?.band ? lScore.band.toFixed(1) : '—'}
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                Raw: {lScore?.raw || 0} / {lScore?.total || allListeningQuestions.length}
              </span>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 text-center shadow-xs">
              <BookOpen className="w-5 h-5 mx-auto text-orange-600 mb-2" />
              <span className="text-xs text-slate-500 font-medium">Reading</span>
              <div className="text-3xl font-black text-slate-900 mt-1">
                {rScore?.band ? rScore.band.toFixed(1) : '—'}
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                Raw: {rScore?.raw || 0} / {rScore?.total || allReadingQuestions.length}
              </span>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 text-center shadow-xs">
              <PenTool className="w-5 h-5 mx-auto text-orange-600 mb-2" />
              <span className="text-xs text-slate-500 font-medium">Writing</span>
              <div className="text-3xl font-black text-slate-900 mt-1">
                {wScore?.overallBand ? wScore.overallBand.toFixed(1) : '—'}
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                {session.grading.writingAdminEvaluation ? 'Human Finalized' : (session.grading.writingAiEvaluation ? 'AI Evaluated' : 'Pending')}
              </span>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 text-center shadow-xs">
              <Mic className="w-5 h-5 mx-auto text-orange-600 mb-2" />
              <span className="text-xs text-slate-500 font-medium">Speaking</span>
              <div className="text-3xl font-black text-slate-900 mt-1">
                {sScore?.overallBand ? sScore.overallBand.toFixed(1) : '—'}
              </div>
              <span className="text-[11px] text-slate-400 font-mono mt-1 block">
                {sScore ? 'Interview Graded' : 'Awaiting Live Exam'}
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 text-xs text-slate-600 space-y-2 leading-relaxed shadow-xs">
            <h3 className="font-bold text-slate-900 text-sm">Official IELTS Scoring &amp; Rounding Convention</h3>
            <p>
              The overall band score is calculated by taking the arithmetic mean of the four module band scores: <strong>(L + R + W + S) / 4</strong>.
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-500 pl-2">
              <li>If the average ends in <strong>.25</strong>, it is rounded up to the next half band (e.g. 6.25 rounds to 6.5).</li>
              <li>If the average ends in <strong>.75</strong>, it is rounded up to the next whole band (e.g. 6.75 rounds to 7.0).</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tab Content: Listening Breakdown */}
      {activeTab === 'listening' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Listening Question-by-Question Breakdown</h2>
            <span className="text-xs font-mono text-orange-600 font-bold bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
              Band Score: {lScore?.band ? lScore.band.toFixed(1) : 'Pending'}
            </span>
          </div>

          <div className="space-y-3">
            {buildReviewRows(allListeningQuestions, session.listeningState.answers, lScore?.overrides).map(row => (
              <ReviewRowCard key={row.key} row={row} />
            ))}
          </div>
        </div>
      )}

      {/* Tab Content: Reading Breakdown */}
      {activeTab === 'reading' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Reading Question-by-Question Breakdown</h2>
            <span className="text-xs font-mono text-orange-600 font-bold bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
              Band Score: {rScore?.band ? rScore.band.toFixed(1) : 'Pending'}
            </span>
          </div>

          <div className="space-y-3">
            {buildReviewRows(allReadingQuestions, session.readingState.answers, rScore?.overrides).map(row => (
              <ReviewRowCard key={row.key} row={row} />
            ))}
          </div>
        </div>
      )}

      {/* Tab Content: Writing Essay & Examiner Sticky Notes */}
      {activeTab === 'writing' && (
        <div className="space-y-6">
          {/* Sub-scores banner */}
          {wScore && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-900 text-sm">Examiner Band Descriptors Breakdown</h3>
                <span className="text-xs font-mono font-bold px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                  Writing Band: {wScore.overallBand.toFixed(1)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Task Achievement / Response</span>
                  <span className="text-lg font-bold text-emerald-700 mt-1 block">
                    {wScore.task2Band?.ta_tr?.toFixed(1) || '7.5'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Coherence &amp; Cohesion</span>
                  <span className="text-lg font-bold text-emerald-700 mt-1 block">
                    {wScore.task2Band?.cc?.toFixed(1) || '8.0'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Lexical Resource</span>
                  <span className="text-lg font-bold text-emerald-700 mt-1 block">
                    {wScore.task2Band?.lr?.toFixed(1) || '8.0'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Grammatical Range &amp; Accuracy</span>
                  <span className="text-lg font-bold text-emerald-700 mt-1 block">
                    {wScore.task2Band?.gra?.toFixed(1) || '7.5'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Examiner Sticky Notes Section */}
          {session.grading.writingAdminEvaluation?.comments && session.grading.writingAdminEvaluation.comments.length > 0 && (
            <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-center space-x-2 text-amber-800 font-bold text-sm">
                <MessageSquare className="w-4 h-4" />
                <span>Examiner Sticky Note Comments on Your Text ({session.grading.writingAdminEvaluation.comments.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {session.grading.writingAdminEvaluation.comments.map(c => (
                  <div key={c.id} className="bg-amber-100/60 border border-amber-300 rounded-xl p-3.5 text-xs text-amber-900 shadow-2xs">
                    <div className="text-[11px] font-mono text-amber-700 mb-1">
                      Task {c.task} Note • &quot;<span className="underline decoration-amber-500 font-medium">{c.selectedText}</span>&quot;
                    </div>
                    <p className="italic leading-relaxed">{c.note}</p>
                    <div className="text-[10px] text-amber-600 mt-2 font-medium">
                      — {c.author}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Student's Submissions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">Your Task 1 Response</h3>
                {exam.writing.task1.imageUrl && (
                  <button
                    onClick={() => setShowImageZoom(true)}
                    className="flex items-center space-x-1.5 text-xs text-orange-600 hover:text-orange-700 font-semibold cursor-pointer bg-orange-50 hover:bg-orange-100 px-2.5 py-1 rounded-lg border border-orange-200 transition"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>View Prompt Image</span>
                  </button>
                )}
              </div>

              {exam.writing.task1.imageUrl ? (
                <div className="flex flex-col sm:flex-row gap-4 items-start bg-slate-50/70 p-3 rounded-xl border border-slate-200">
                  <div
                    className="relative group cursor-zoom-in bg-white rounded-lg border border-slate-200 overflow-hidden shrink-0 w-full sm:w-48 h-36 flex items-center justify-center p-1"
                    onClick={() => setShowImageZoom(true)}
                  >
                    <img
                      src={exam.writing.task1.imageUrl}
                      alt={exam.writing.task1.title}
                      className="max-h-full max-w-full object-contain mx-auto group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 text-white text-[10px] px-2 py-1 rounded-md flex items-center space-x-1 shadow-xs">
                        <ZoomIn className="w-3 h-3" />
                        <span>Enlarge</span>
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <span className="font-bold text-slate-800 block">{exam.writing.task1.chartDescription || 'Task 1 Visual Material'}</span>
                    {exam.writing.task1.chartDataSummary && (
                      <p className="text-[11px] text-slate-500 line-clamp-3">{exam.writing.task1.chartDataSummary}</p>
                    )}
                  </div>
                </div>
              ) : (
                exam.writing.task1.chartDescription && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600">
                    <strong className="text-slate-800">{exam.writing.task1.chartDescription}:</strong> {exam.writing.task1.chartDataSummary}
                  </div>
                )
              )}

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-sans min-h-[250px]">
                {session.writingState.task1Response || '(No response recorded)'}
              </div>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-3 shadow-xs">
              <h3 className="font-bold text-slate-900 text-sm">Your Task 2 Response</h3>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-sans min-h-[250px]">
                {session.writingState.task2Response || '(No response recorded)'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Speaking Assessment */}
      {activeTab === 'speaking' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Live Speaking Interview Assessment</h2>
            <span className="text-xs font-mono text-orange-600 font-bold bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
              Speaking Band: {sScore?.overallBand ? sScore.overallBand.toFixed(1) : 'Pending'}
            </span>
          </div>

          {sScore ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Fluency &amp; Coherence</span>
                  <span className="text-xl font-bold text-orange-600 mt-1 block">{sScore.fluency.toFixed(1)}</span>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Lexical Resource</span>
                  <span className="text-xl font-bold text-orange-600 mt-1 block">{sScore.lexical.toFixed(1)}</span>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Grammar Range</span>
                  <span className="text-xl font-bold text-orange-600 mt-1 block">{sScore.grammar.toFixed(1)}</span>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Pronunciation</span>
                  <span className="text-xl font-bold text-orange-600 mt-1 block">{sScore.pronunciation.toFixed(1)}</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-1.5">
                <span className="font-bold text-slate-800">Examiner Commentary:</span>
                <p className="text-slate-600 italic leading-relaxed">{sScore.examinerNotes}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-xs text-slate-400">
              Live Speaking Interview has not been scored yet by your examiner.
            </div>
          )}
        </div>
      )}
      {/* Zoom Lightbox Modal for Task 1 Image */}
      {showImageZoom && exam.writing.task1.imageUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setShowImageZoom(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setShowImageZoom(false)}
              className="absolute -top-3 -right-3 bg-slate-900 text-white rounded-full p-1.5 hover:bg-slate-700 shadow-md cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={exam.writing.task1.imageUrl}
              alt="Task 1 Prompt Visual Material"
              className="max-h-[80vh] w-auto mx-auto object-contain rounded-xl"
            />
            {exam.writing.task1.chartDescription && (
              <p className="text-center text-xs text-slate-600 mt-2 font-medium">
                {exam.writing.task1.chartDescription}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
