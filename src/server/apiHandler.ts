import { GoogleGenAI } from '@google/genai';
import { IStorage, FileMetadataRecord } from './storage';
import {
  calculateIeltsOverallBand,
  bandToCefr,
  gradeListening,
  gradeReading,
  normalizeMultiKeys,
  getMultiLetters,
  mergeConsecutiveMultis
} from '../utils/ieltsScoring';
import { synthesizeParagraphBanks } from '../utils/matchingBank';
import { CandidateSession, Exam, WritingAiEvaluation, ExamRegistrationRequest, SystemSettings, MAX_EXAMS, MAX_REGISTRATIONS_PER_DATE, getExamStartMs, getExamSlotStartMs, isExamPaperReleased } from '../types';
import { defaultExam } from '../data/sampleExam';
import { isRecentRegistration } from '../utils/retention';

// In-memory fallback for local development when Cloudflare R2 "FILES" binding is absent
export const localFileCache = new Map<string, { data: Uint8Array; contentType: string }>();

export function isConstantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let mismatch = a.length === b.length ? 0 : 1;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const charA = a.charCodeAt(i) || 0;
    const charB = b.charCodeAt(i) || 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

export function generateRandomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCorsHeaders(request?: Request, env: Record<string, any> = {}): Record<string, string> {
  const origin = request?.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS || env.APP_URL || '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

  let allowOrigin = '';
  if (origin) {
    if (allowedOrigins.length === 0) {
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.endsWith('.pages.dev') ||
        origin.endsWith('.workers.dev')
      ) {
        allowOrigin = origin;
      } else {
        allowOrigin = origin;
      }
    } else if (allowedOrigins.includes(origin.toLowerCase()) || allowedOrigins.includes('*')) {
      allowOrigin = origin;
    }
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token',
    'Access-Control-Max-Age': '86400'
  };

  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}

/**
 * Recompute the overall band + CEFR from the CURRENT module bands.
 * Uses the human examiner writing confirmation (never the AI draft and never
 * stale defaults), so admin corrections to writing/speaking are always
 * reflected. Returns true when all four bands exist and the overall was set.
 */
export function recomputeOverallFromCurrentBands(session: CandidateSession): boolean {
  const l = session.grading.listeningScore?.band;
  const r = session.grading.readingScore?.band;
  const w = session.grading.writingAdminEvaluation?.overallBand;
  const s = session.grading.speakingEvaluation?.overallBand;
  if (typeof l !== 'number' || typeof r !== 'number' || typeof w !== 'number' || typeof s !== 'number') {
    return false;
  }
  session.grading.finalOverallBand = calculateIeltsOverallBand(l, r, w, s);
  session.grading.cefrLevel = bandToCefr(session.grading.finalOverallBand);
  return true;
}

/** Rolling data-retention window: user records older than this are purged. */
export const RETENTION_DAYS = 180;

/** Registrations are short-lived: submitted over this many days ago = purged
 *  by the nightly cleanup (candidate results/sessions keep RETENTION_DAYS). */
export const REGISTRATION_RETENTION_DAYS = 7;

/** Speaking voice memos are short-lived: recorded interviews are purged
 *  this many days after recording, independent of the 180-day session window. */
export const SPEAKING_AUDIO_RETENTION_DAYS = 7;

/**
 * Server-side entry gate — entry follows ONLY the posted exam's own date &
 * time (set by the admin in the Exam Wizard) plus whether that exam is
 * still the active one. No proctor-schedule layer: future start blocks,
 * as does an exam that is no longer active. Undated + active = open.
 */
export function isCandidateEntryOpen(
  settings: Pick<SystemSettings, 'activeExamId'>,
  sessionExamId: string | undefined,
  exam?: Exam | null,
  sessionSlot?: 1 | 2 | null
): boolean {
  if (exam) {
    // Two-slot days: slot-2 candidates wait for their own start time, even
    // though slot 1 (and the exam itself) is already open.
    const slot = sessionSlot === 2 && exam.examTime2 ? 2 : 1;
    const startMs = slot === 2 ? getExamSlotStartMs(exam, 2) : getExamStartMs(exam);
    if (startMs !== null && startMs > Date.now()) return false;
  }
  const active = settings.activeExamId;
  if (active && active !== 'none' && sessionExamId && sessionExamId !== active) return false;
  return true;
}

export const ENTRY_NOT_OPEN_ERROR =
  'Exam access is not open yet. Please wait for the countdown to finish.';

/**
 * The entry gate guards STARTING an exam, never continuing one. Sessions
 * actively in the exam ('in_progress', including a proctor-resumed
 * 'hard_locked' terminal) always save, move sections and submit — otherwise
 * an admin date change or exam switch mid-session would strand live
 * candidates with "exam is not open" on every transition. Sessions that
 * haven't started still wait for their exam day and active slot.
 */
export function isEntryGatedSession(session: Pick<CandidateSession, 'status'>): boolean {
  const st = session.status || 'registered';
  return st !== 'in_progress' && st !== 'hard_locked';
}

/**
 * Even wider rule for hand-ins: only a session that NEVER started waits.
 * A candidate re-clicking Submit after an already-recorded submit (stale
 * screen, double click, re-login) is already 'completed'/'finalized' — the
 * re-submit is idempotent and must succeed, never 403.
 */
export function isUnstartedSession(session: Pick<CandidateSession, 'status'>): boolean {
  return (session.status || 'registered') === 'registered';
}

// Extra instruction appended to import prompts when the source is a JSON
// file: the model must interpret the JSON structure flexibly instead of
// expecting prose, and normalize everything into the required schema.
export const JSON_SOURCE_INSTRUCTION =
  ' IMPORTANT: the source document below is JSON data, not prose. Interpret its structure flexibly — ' +
  'titles may sit under keys like title, name or heading; texts under text, content, passage or body; ' +
  'questions under questions, items or exercises; options under options, choices or alternatives; ' +
  'answers under answers, answer, key or correct. Normalize every question into the required output ' +
  'schema and AUTO-CHOOSE its type from the list, even when the input uses different names or nesting.';

// Decode a base64 JSON source file to text (validates it parses as JSON).
function decodeJsonSource(cleanB64: string): { ok: boolean; text: string } {
  try {
    const bin = Uint8Array.from(atob(cleanB64), c => c.charCodeAt(0));
    let text = new TextDecoder().decode(bin).trim();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    JSON.parse(text);
    return { ok: true, text };
  } catch {
    return { ok: false, text: '' };
  }
}

/** Keep only a sane tableDef layout (caps); null when empty/missing. Shared
 *  by the reading + listening import normalizers so table_completion JSON
 *  fills the table layout instead of being dropped. */
function sanitizeImportTableDef(raw: unknown): { title?: string; headers: string[]; rows: string[][] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as { title?: unknown; headers?: unknown; rows?: unknown };
  const headers = Array.isArray(t.headers)
    ? (t.headers as unknown[]).map(String).map(s => s.slice(0, 100)).slice(0, 12)
    : [];
  const rows = Array.isArray(t.rows)
    ? (t.rows as unknown[]).slice(0, 30).map(r =>
      (Array.isArray(r) ? r : []).map(String).map(s => s.slice(0, 300)).slice(0, 12)
    )
    : [];
  if (rows.length === 0 || rows.every(r => r.every(c => !c.trim()))) return null;
  return {
    ...(typeof t.title === 'string' && t.title ? { title: t.title.slice(0, 200) } : {}),
    headers,
    rows
  };
}

/** Keep only a sane flowDef layout (caps); null when empty/missing. */
function sanitizeImportFlowDef(raw: unknown): { title?: string; boxes: string[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as { title?: unknown; boxes?: unknown };
  const boxes = Array.isArray(t.boxes)
    ? (t.boxes as unknown[]).map(String).map(s => s.slice(0, 300)).slice(0, 30)
    : [];
  // A "||" line is a branch marker, not content — ignore it for emptiness.
  const content = boxes.filter(b => b.trim() !== '||');
  if (content.length === 0 || content.every(b => !b.trim())) return null;
  return {
    ...(typeof t.title === 'string' && t.title ? { title: t.title.slice(0, 200) } : {}),
    boxes
  };
}

/**
 * Aggregate R2 guard: an upload is accepted only if
 * current tracked bytes + incoming bytes <= this cap (9.9 GB of the 10 GB
 * free tier). Checked on every upload, before anything is written.
 */
export const R2_GUARD_BYTES = Math.floor(9.9 * 1024 * 1024 * 1024);

/** Free-tier planning constants shown in the admin panel. */
export const PLATFORM_LIMITS = {
  throughputPerDay: 125,
  historyUsers: 38000,
  retentionDays: RETENTION_DAYS,
  retentionMonths: 6
};

/** Extract an R2 object key from a same-origin /api/files/<key> URL. Null otherwise. */
function r2KeyFromFileUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^\/api\/files\/(.+)$/);
  if (!m) return null;
  try {
    const clean = decodeURIComponent(m[1]).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[\\/]+/, '');
    if (!clean || clean.includes('..')) return null;
    return clean;
  } catch {
    return null;
  }
}

/**
 * Translate a Gemini import failure into an admin-actionable message.
 * Shared by the reading + listening import endpoints so neither hides the
 * real cause behind a generic "temporarily unavailable".
 */
export function classifyAiImportError(err: unknown): string {
  const status = (err as { status?: unknown })?.status;
  const code = (err as { code?: unknown })?.code;
  const msg = String((err as { message?: unknown })?.message || (err as object) || '').toLowerCase();
  const statusNum = typeof status === 'number' ? status : parseInt(String(status || ''), 10);
  if (
    statusNum === 429 || String(code) === 'RESOURCE_EXHAUSTED' ||
    msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
    msg.includes('resource_exhausted') || msg.includes('try again later')
  ) {
    return 'AI quota is exhausted for now (free-tier limits). Please try again later — quotas reset daily — or enter the questions manually.';
  }
  if (
    statusNum === 400 || statusNum === 403 ||
    msg.includes('api key') || msg.includes('api_key') || msg.includes('permission_denied') ||
    msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('401') ||
    msg.includes('404') || msg.includes('not found')
  ) {
    return 'AI key was rejected by the provider (or the model name is retired). Ask the administrator to check GEMINI_IMPORT_API_KEY, or enter the questions manually.';
  }
  if (msg && msg !== '[object object]') {
    return `AI request failed (${msg.slice(0, 160)}). Please try again, or enter the questions manually.`;
  }
  return 'AI did not return usable questions for this document. Try a cleaner PDF, or enter the questions manually.';
}

/**
 * Every R2 object key an exam references: listening audio (catalog-level +
 * per-section), the writing task-1 diagram, and every question-level plan /
 * diagram image (image_map) in listening + reading. Keep in sync with the
 * Exam type — anything missed here becomes an orphan in file_metadata / R2
 * when the exam is deleted or the file is replaced.
 */
export function collectExamFileKeys(exam: Exam | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!exam) return keys;
  const add = (u: string | undefined | null) => {
    const k = r2KeyFromFileUrl(u);
    if (k) keys.add(k);
  };
  add(exam.listening?.audioUrl);
  for (const s of exam.listening?.sections || []) {
    add(s.audioUrl);
    for (const q of s.questions || []) add((q as { imageUrl?: string }).imageUrl);
  }
  for (const p of exam.reading?.passages || []) {
    for (const q of p.questions || []) add((q as { imageUrl?: string }).imageUrl);
  }
  add(exam.writing?.task1?.imageUrl);
  return keys;
}

/** Remove one file from every layer: R2 bucket, local dev cache, D1 tracker. */
export async function deleteStoredFile(
  storage: IStorage,
  env: Record<string, any>,
  key: string
): Promise<void> {
  if (env.FILES && typeof env.FILES.delete === 'function') {
    await env.FILES.delete(key);
  } else {
    localFileCache.delete(key);
  }
  try { await storage.deleteFileMetadata(key); } catch {}
}

/**
 * Delete file keys that nothing references any more. Shared-clone guard:
 * a key still used by any exam in `stillUsed` is skipped.
 */
export async function deleteUnreferencedFiles(
  storage: IStorage,
  env: Record<string, any>,
  keys: Set<string> | string[],
  stillUsed: Set<string>
): Promise<string[]> {
  const deleted: string[] = [];
  for (const key of keys) {
    if (stillUsed.has(key)) continue;
    try {
      await deleteStoredFile(storage, env, key);
      deleted.push(key);
    } catch (e) {
      console.warn('File cleanup: failed to remove file', key);
    }
  }
  return deleted;
}

/** Exam-asset folders: files here are referenced ONLY by exams (never by sessions/registrations). */
function isExamAssetKey(key: string): boolean {
  return key.startsWith('audio/') || key.startsWith('diagrams/') || key.startsWith('general/');
}

export interface DateOccupancy {
  /** Shared daily pool usage (registration requests + admin-added candidates). */
  taken: number;
  registrations: number;
  adminSessions: number;
  bySlot: { slot1: number; slot2: number };
}

/**
 * Daily occupancy for an exam date. The 125/day limit is a hard daily cap
 * shared by BOTH channels: m10 registration requests (non-rejected) AND
 * candidates registered directly by the admin (sessions with no
 * registrationId — approved requests are already counted once via their
 * registration and are skipped here to avoid double counting).
 */
export async function getDateOccupancy(
  storage: IStorage,
  examDate: string
): Promise<DateOccupancy> {
  const [allRegs, allSessions, examsList] = await Promise.all([
    storage.getRegistrations(),
    storage.getSessions(),
    storage.getExams().catch(() => [] as Exam[])
  ]);
  const dayRegs = allRegs.filter(r => r.examDate === examDate && r.status !== 'rejected');
  const examDateById = new Map(examsList.map(e => [e.id, e.examDate]));
  const dayAdminSessions = allSessions.filter(
    s => !s.registrationId && examDateById.get(s.examId) === examDate
  );
  const slotOf = (x: { examSlot?: 1 | 2 }): 1 | 2 => (x.examSlot === 2 ? 2 : 1);
  const bySlot = {
    slot1: dayRegs.filter(r => slotOf(r) === 1).length + dayAdminSessions.filter(s => slotOf(s) === 1).length,
    slot2: dayRegs.filter(r => slotOf(r) === 2).length + dayAdminSessions.filter(s => slotOf(s) === 2).length
  };
  return {
    taken: dayRegs.length + dayAdminSessions.length,
    registrations: dayRegs.length,
    adminSessions: dayAdminSessions.length,
    bySlot
  };
}

export interface RetentionCleanupResult {
  cutoff: string;
  ranAt: string;
  deletedSessionIds: string[];
  deletedRegistrationIds: string[];
  deletedFiles: string[];
}

/**
 * Delete old user records in the nightly cleanup: sessions (with their R2
 * photos and speaking voice memos) older than RETENTION_DAYS, registrations
 * (with receipts/photos) submitted more than REGISTRATION_RETENTION_DAYS ago,
 * and speaking voice memos (speaking/) recorded more than
 * SPEAKING_AUDIO_RETENTION_DAYS ago — the memos expire long before their
 * session does. Live exams themselves are never touched — but exam-asset
 * files (audio/, diagrams/, general/) that no remaining exam references
 * (leftovers from deleted exams or replaced uploads) ARE purged so orphan
 * audio cannot accumulate in R2 / D1.
 */
export async function runRetentionCleanup(
  storage: IStorage,
  env: Record<string, any>
): Promise<RetentionCleanupResult> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const [sessions, registrations] = await Promise.all([
    storage.getSessions(),
    storage.getRegistrations()
  ]);
  const oldSessions = sessions.filter(s => {
    const t = new Date(s.createdAt || '').getTime();
    return !isNaN(t) && t < cutoff;
  });
  const oldRegs = registrations.filter(r => !isRecentRegistration(r.submittedAt, r.examDate));

  const fileKeys = new Set<string>();
  oldSessions.forEach(s => {
    [s.candidatePhotoUrl, s.grading?.speakingEvaluation?.audioUrl].forEach(u => {
      const k = r2KeyFromFileUrl(u);
      if (k) fileKeys.add(k);
    });
  });
  oldRegs.forEach(r => {
    [r.candidatePhotoUrl, r.m10ReceiptUrl].forEach(u => {
      const k = r2KeyFromFileUrl(u);
      if (k) fileKeys.add(k);
    });
  });

  for (const s of oldSessions) {
    try { await storage.deleteSession(s.candidateId); } catch (e) { console.warn('Retention: failed to delete session', s.candidateId); }
  }
  for (const r of oldRegs) {
    try { await storage.deleteRegistration(r.id); } catch (e) { console.warn('Retention: failed to delete registration', r.id); }
  }
  const deletedFiles: string[] = [];
  for (const key of fileKeys) {
    try {
      await deleteStoredFile(storage, env, key);
      deletedFiles.push(key);
    } catch (e) {
      console.warn('Retention: failed to delete file', key);
    }
  }

  // Speaking voice memos: short 7-day retention, independent of the
  // 180-day session window. speaking/ is never part of the exam-asset orphan
  // sweep below, so expired memos are purged explicitly here (by upload age,
  // falling back to the recording timestamp when the tracker row is missing)
  // and detached from their sessions. Unlinked or replaced memos expire by
  // upload age alone, so abandoned uploads cannot accumulate either.
  try {
    const speakingCutoff = Date.now() - SPEAKING_AUDIO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const [liveSessions, trackedFiles] = await Promise.all([
      storage.getSessions(),
      storage.listFileMetadata().catch(() => [] as FileMetadataRecord[])
    ]);
    const metaByKey = new Map(trackedFiles.map(f => [f.key, f]));
    const expiredSpeaking = new Set<string>();
    trackedFiles.forEach(f => {
      if (!f.key.startsWith('speaking/')) return;
      const t = new Date(f.uploadedAt || '').getTime();
      if (!isNaN(t) && t < speakingCutoff) expiredSpeaking.add(f.key);
    });
    liveSessions.forEach(s => {
      const ev = s.grading?.speakingEvaluation;
      const k = r2KeyFromFileUrl(ev?.audioUrl);
      if (!k || !k.startsWith('speaking/') || expiredSpeaking.has(k) || metaByKey.has(k)) return;
      const rt = new Date(ev?.audioRecordedAt || '').getTime();
      if (!isNaN(rt) && rt < speakingCutoff) expiredSpeaking.add(k);
    });
    for (const key of expiredSpeaking) {
      try {
        await deleteStoredFile(storage, env, key);
        deletedFiles.push(key);
      } catch (e) {
        console.warn('Retention: failed to delete speaking recording', key);
      }
    }
    if (expiredSpeaking.size > 0) {
      for (const s of liveSessions) {
        const ev = s.grading?.speakingEvaluation;
        const k = r2KeyFromFileUrl(ev?.audioUrl);
        if (k && expiredSpeaking.has(k) && ev) {
          delete ev.audioUrl;
          delete ev.audioRecordedAt;
          try { await storage.saveSession(s); } catch (e) { console.warn('Retention: failed to detach speaking recording', s.candidateId); }
        }
      }
      console.log(`[Retention] purged ${expiredSpeaking.size} expired speaking recording(s) older than ${SPEAKING_AUDIO_RETENTION_DAYS} days`);
    }
  } catch (e) {
    console.warn('Retention: speaking-recording purge failed:', e);
  }

  // Orphan sweep: exam-asset files no remaining exam references (deleted
  // exams, replaced audio/diagrams). Live-exam files are always skipped, and
  // user records (photos/receipts) are owned by the retention above — never
  // swept here.
  try {
    const [liveExams, tracked] = await Promise.all([
      storage.getExams().catch(() => [] as Exam[]),
      storage.listFileMetadata().catch(() => [] as FileMetadataRecord[])
    ]);
    const referenced = new Set<string>();
    liveExams.forEach(e => {
      collectExamFileKeys(e).forEach(k => referenced.add(k));
    });
    const orphans = tracked
      .map(f => f.key)
      .filter(k => isExamAssetKey(k) && !referenced.has(k));
    const swept = await deleteUnreferencedFiles(storage, env, orphans, referenced);
    deletedFiles.push(...swept);
    if (swept.length > 0) console.log(`[Retention] swept ${swept.length} orphan exam file(s)`);
  } catch (e) {
    console.warn('Retention: orphan exam-file sweep failed:', e);
  }

  const ranAt = new Date().toISOString();
  try {
    const settings = await storage.getSettings();
    await storage.saveSettings({
      ...settings,
      retentionLastRun: ranAt,
      retentionLastDeleted: {
        sessions: oldSessions.length,
        registrations: oldRegs.length,
        files: deletedFiles.length
      }
    });
  } catch {}

  return {
    cutoff: new Date(cutoff).toISOString(),
    ranAt,
    deletedSessionIds: oldSessions.map(s => s.candidateId),
    deletedRegistrationIds: oldRegs.map(r => r.id),
    deletedFiles
  };
}

/**
 * Reconcile the file tracker with the actual bucket contents (new uploads are
 * tracked live; this picks up anything older). Runs inside the nightly cron.
 */
export async function syncFileInventory(
  storage: IStorage,
  env: Record<string, any>
): Promise<{ tracked: number }> {
  let tracked = 0;
  const upsert = async (key: string, fileName: string, fileType: string, fileSize: number, uploadedAt: string) => {
    try {
      await storage.saveFileMetadata({
        key,
        fileName,
        fileType,
        fileSize: fileSize || 0,
        isPrivate: key.startsWith('receipts/') || key.startsWith('documents/') || key.startsWith('speaking/'),
        uploadedAt
      });
      tracked++;
    } catch {}
  };

  if (env.FILES && typeof env.FILES.list === 'function') {
    let cursor: string | undefined = undefined;
    for (;;) {
      const page = await env.FILES.list({ limit: 1000, cursor });
      for (const obj of page?.objects || []) {
        if (!obj?.key) continue;
        await upsert(
          obj.key,
          String(obj.key).split('/').pop() || obj.key,
          obj.httpMetadata?.contentType || 'application/octet-stream',
          obj.size || 0,
          obj.uploaded ? new Date(obj.uploaded).toISOString() : new Date().toISOString()
        );
      }
      if (page?.truncated && page?.cursor) cursor = page.cursor;
      else break;
    }
  } else {
    for (const [key, cached] of localFileCache.entries()) {
      await upsert(key, key.split('/').pop() || key, cached.contentType, cached.data.byteLength, new Date().toISOString());
    }
  }
  return { tracked };
}

/** Clamp to a valid 0–9 band in 0.5 steps. */
function clampBand(val: any, fallback: number): number {
  const num = Number(val);
  if (isNaN(num)) return fallback;
  return Math.min(9, Math.max(0, Math.round(num * 2) / 2));
}

const GEMINI_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest'];

/** Real LLM grading via Gemini. Throws on any failure (caller falls back to rubric). */
export async function geminiWritingEvaluation(
  apiKey: string,
  primaryModel: string,
  task1Prompt: string,
  task2Prompt: string,
  t1: string,
  t2: string
): Promise<WritingAiEvaluation> {
  const clip = (s: string, n: number) => (s || '').slice(0, n);
  const prompt =
    'You are an IELTS Academic Writing examiner. Grade the two responses below against the official descriptors ' +
    '(Task Achievement/Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy).\n\n' +
    `TASK 1 PROMPT:\n${clip(task1Prompt, 1500)}\n\nCANDIDATE TASK 1:\n${clip(t1, 6000)}\n\n` +
    `TASK 2 PROMPT:\n${clip(task2Prompt, 1500)}\n\nCANDIDATE TASK 2:\n${clip(t2, 8000)}\n\n` +
    'Return ONLY valid JSON, no markdown, no commentary, exactly this shape:\n' +
    '{"task1Band":{"ta_tr":7.0,"cc":7.0,"lr":7.0,"gra":7.0},' +
    '"task2Band":{"ta_tr":7.0,"cc":7.0,"lr":7.0,"gra":7.0},' +
    '"errors":[{"task":1,"snippet":"...","suggestion":"...","errorType":"grammar|spelling|punctuation|word_choice","explanation":"..."}],' +
    '"feedbackSummary":"...","criteriaFeedback":{"ta_tr":"...","cc":"...","lr":"...","gra":"..."}}\n' +
    'Bands are 0-9 in 0.5 steps. List at most 12 concrete errors with short quoted snippets.';

  const models = [primaryModel, ...GEMINI_FALLBACK_MODELS.filter(m => m !== primaryModel)];
  let lastErr: any = null;
  for (const model of models) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({ model, contents: prompt });
      const text = (res.text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '');
      const parsed = JSON.parse(text);
      return sanitizeGeminiEvaluation(parsed);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gemini evaluation failed.');
}

/** Validate + clamp raw model output into a safe WritingAiEvaluation. */
function sanitizeGeminiEvaluation(raw: any): WritingAiEvaluation {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid model output.');
  const band = (v: any, fb: number) => clampBand(v, fb);
  const t1 = raw.task1Band || {};
  const t2 = raw.task2Band || {};
  const t1Overall = band(t1.overall, Math.round(((band(t1.ta_tr, 6) + band(t1.cc, 6) + band(t1.lr, 6) + band(t1.gra, 6)) / 4) * 2) / 2);
  const t2Overall = band(t2.overall, Math.round(((band(t2.ta_tr, 6) + band(t2.cc, 6) + band(t2.lr, 6) + band(t2.gra, 6)) / 4) * 2) / 2);
  const allowedTypes = ['grammar', 'spelling', 'punctuation', 'word_choice'];
  const errors = Array.isArray(raw.errors) ? raw.errors.slice(0, 12).map((e: any) => ({
    task: e?.task === 2 ? 2 : 1,
    snippet: String(e?.snippet || '').slice(0, 200),
    suggestion: String(e?.suggestion || '').slice(0, 200),
    errorType: allowedTypes.includes(e?.errorType) ? e.errorType : 'grammar',
    explanation: String(e?.explanation || '').slice(0, 500)
  })) : [];
  const cf = raw.criteriaFeedback || {};
  const str = (v: any, fb: string) => (typeof v === 'string' && v.trim() ? v.slice(0, 2000) : fb);
  return {
    task1Band: { ta_tr: band(t1.ta_tr, 6), cc: band(t1.cc, 6), lr: band(t1.lr, 6), gra: band(t1.gra, 6), overall: t1Overall },
    task2Band: { ta_tr: band(t2.ta_tr, 6), cc: band(t2.cc, 6), lr: band(t2.lr, 6), gra: band(t2.gra, 6), overall: t2Overall },
    overallBand: Math.round((((t1Overall + t2Overall * 2) / 3)) * 2) / 2,
    errors: errors as WritingAiEvaluation['errors'],
    feedbackSummary: str(raw.feedbackSummary, 'Automated evaluation completed.'),
    criteriaFeedback: {
      ta_tr: str(cf.ta_tr, ''),
      cc: str(cf.cc, ''),
      lr: str(cf.lr, ''),
      gra: str(cf.gra, '')
    },
    evaluatedAt: new Date().toISOString()
  };
}

export function jsonResponse(
  data: any,
  status = 200,
  request?: Request,
  env: Record<string, any> = {}
): Response {
  const cors = getCorsHeaders(request, env);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      ...cors
    }
  });
}

export async function requireAdmin(
  request: Request,
  storage: IStorage,
  env: Record<string, any> = {}
): Promise<{ authorized: boolean; username?: string; errorResponse?: Response }> {
  const authHeader = request.headers.get('authorization');
  let urlToken: string | null = null;
  try {
    const parsedUrl = new URL(request.url);
    urlToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('auth');
  } catch {}

  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (request.headers.get('x-admin-token')?.trim() || urlToken?.trim());

  if (!rawToken) {
    return {
      authorized: false,
      errorResponse: jsonResponse(
        {
          success: false,
          error: 'Unauthorized: Admin authentication token required.',
          message: 'Access restricted to authorized IELTS proctors only.'
        },
        401,
        request,
        env
      )
    };
  }

  const tokenHash = await hashToken(rawToken);
  const record = await storage.getAdminToken(tokenHash);
  if (!record) {
    return {
      authorized: false,
      errorResponse: jsonResponse(
        {
          success: false,
          error: 'Unauthorized: Admin session is invalid or expired.',
          message: 'Please log in again via the IELTS Gate Admin Gateway.'
        },
        401,
        request,
        env
      )
    };
  }

  return { authorized: true, username: record.username };
}

function createDefaultSession(
  cid: string,
  targetExam: Exam,
  profile: Partial<CandidateSession> = {}
): CandidateSession {
  const digitsOnly = cid.replace(/[^0-9]/g, '') || '000000';
  return {
    candidateId: cid,
    ...(profile.registrationId ? { registrationId: profile.registrationId } : {}),
    ...(profile.examSlot === 1 || profile.examSlot === 2 ? { examSlot: profile.examSlot } : {}),
    candidateName: profile.candidateName || 'Candidate',
    candidatePhotoUrl: profile.candidatePhotoUrl || '',
    dateOfBirth: profile.dateOfBirth || '',
    gender: profile.gender || 'M',
    countryOfOrigin: profile.countryOfOrigin || 'Azerbaijan',
    firstLanguage: profile.firstLanguage || 'Azerbaijani',
    idDocumentNumber: profile.idDocumentNumber || '',
    centreNumber: profile.centreNumber || targetExam.centreNumber || 'AZ001 - Baku Official IELTS Test Center',
    schemeCode: profile.schemeCode || 'Academic Standard',
    examId: targetExam.id,
    examTitle: targetExam.title,
    createdAt: new Date().toISOString(),
    status: 'registered',
    currentSection: 'listening',
    trfNumber: `26GB01428${digitsOnly}001A`,
    lockStatus: {
      violations: 0,
      isLocked: false,
      lockHistory: []
    },
    listeningState: {
      bufferedPercent: 0,
      audioPlayed: false,
      reviewTimerRemaining: 120,
      answers: {},
      highlights: [],
      completed: false,
      audioPositionSeconds: 0
    },
    readingState: {
      timeRemainingSeconds: (targetExam.reading?.durationMinutes || 60) * 60,
      answers: {},
      highlights: [],
      completed: false
    },
    writingState: {
      timeRemainingSeconds: (targetExam.writing?.durationMinutes || 60) * 60,
      task1Response: '',
      task2Response: '',
      completed: false
    },
    grading: {
      isFinalized: false
    },
    lastSavedAt: new Date().toISOString()
  };
}

export async function handleApiRequest(
  request: Request,
  storage: IStorage,
  env: Record<string, any> = {}
): Promise<Response> {
  try {
    const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request, env)
    });
  }

  const ADMIN_USERNAME = env.ADMIN_USERNAME || (typeof process !== 'undefined' ? process?.env?.ADMIN_USERNAME : '') || '';
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD || (typeof process !== 'undefined' ? process?.env?.ADMIN_PASSWORD : '') || '';

  // 1. Health
  // NOTE: bump `build` on every production deploy — it is shown in the
  // navbar so a stale (cached) terminal is visible at a glance.
  if (pathname === '/api/health' && method === 'GET') {
    return jsonResponse({ status: 'ok', time: new Date().toISOString(), persistence: Boolean(env.DB), build: '20260913-clickonce' }, 200, request, env);
  }

  // 1b. System Settings (Exam Fee & m10 Details)
  if (pathname === '/api/settings') {
    if (method === 'GET') {
      const settings = await storage.getSettings();
      return jsonResponse(settings, 200, request, env);
    }
    if (method === 'POST') {
      const auth = await requireAdmin(request, storage, env);
      if (!auth.authorized) return auth.errorResponse!;

      const body = await request.json().catch(() => ({}));
      const current = await storage.getSettings();

      // If updating activeExamId specifically without full price/m10 payload
      if (body.activeExamId !== undefined && body.examPriceAzn === undefined && body.m10PhoneNumber === undefined) {
        const rawExamId = body.activeExamId;
        const activeExamId = (rawExamId === 'none' || rawExamId === null || rawExamId === '' || rawExamId === undefined)
          ? null
          : String(rawExamId).trim();

        const updatedSettings: SystemSettings = {
          ...current,
          activeExamId,
          updatedAt: new Date().toISOString(),
          updatedBy: auth.username || 'admin'
        };

        await storage.saveSettings(updatedSettings);
        return jsonResponse({ success: true, settings: updatedSettings }, 200, request, env);
      }

      const examPriceAzn = Number(body.examPriceAzn);
      const m10PhoneNumber = String(body.m10PhoneNumber || '').trim();
      const m10AccountHolder = String(body.m10AccountHolder || '').trim();

      if (isNaN(examPriceAzn) || examPriceAzn <= 0) {
        return jsonResponse({ success: false, error: 'Valid exam price in AZN is required.' }, 400, request, env);
      }
      if (!m10PhoneNumber) {
        return jsonResponse({ success: false, error: 'm10 phone number is required.' }, 400, request, env);
      }
      if (!m10AccountHolder) {
        return jsonResponse({ success: false, error: 'Account holder name is required.' }, 400, request, env);
      }

      const rawActiveExamId = body.activeExamId !== undefined ? body.activeExamId : current.activeExamId;
      const activeExamId = (rawActiveExamId === 'none' || rawActiveExamId === null || rawActiveExamId === '' || rawActiveExamId === undefined)
        ? null
        : String(rawActiveExamId).trim();

      const updatedSettings: SystemSettings = {
        examPriceAzn,
        m10PhoneNumber,
        m10AccountHolder,
        activeExamId,
        isConfigured: true,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.username || 'admin'
      };

      await storage.saveSettings(updatedSettings);
      return jsonResponse({ success: true, settings: updatedSettings }, 200, request, env);
    }
  }

  // 1b2. Public retention policy (result eligibility window for candidates)
  if (pathname === '/api/retention-policy' && method === 'GET') {
    return jsonResponse({
      retentionDays: RETENTION_DAYS,
      retentionMonths: PLATFORM_LIMITS.retentionMonths,
      registrationRetentionDays: REGISTRATION_RETENTION_DAYS,
      speakingAudioRetentionDays: SPEAKING_AUDIO_RETENTION_DAYS,
      message: `Candidate results remain available for ${RETENTION_DAYS} days (~${PLATFORM_LIMITS.retentionMonths} months) and are then automatically deleted. Registrations are kept for ${REGISTRATION_RETENTION_DAYS} days after submission. Speaking voice recordings are kept for ${SPEAKING_AUDIO_RETENTION_DAYS} days after recording.`
    }, 200, request, env);
  }

  // 1b3. Storage stats + platform limits (Admin)
  if (pathname === '/api/admin/storage-stats' && method === 'GET') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;
    const stats = await storage.getStorageStats();
    const settings = await storage.getSettings();
    return jsonResponse({
      success: true,
      stats,
      limits: PLATFORM_LIMITS,
      retentionLastRun: settings.retentionLastRun || null,
      retentionLastDeleted: settings.retentionLastDeleted || null
    }, 200, request, env);
  }

  // 1c. Set Active Mock Exam (Admin selects active exam or sets no exam active)
  if (pathname === '/api/admin/active-exam' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json().catch(() => ({}));
    const rawExamId = body.activeExamId;
    const activeExamId = (rawExamId === 'none' || rawExamId === null || rawExamId === '' || rawExamId === undefined)
      ? null
      : String(rawExamId).trim();

    const currentSettings = await storage.getSettings();
    const updatedSettings: SystemSettings = {
      ...currentSettings,
      activeExamId,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.username || 'admin'
    };

    await storage.saveSettings(updatedSettings);
    return jsonResponse({
      success: true,
      activeExamId,
      message: activeExamId ? `Active exam set to "${activeExamId}"` : 'Currently, there is not an active exam'
    }, 200, request, env);
  }

  // 1d. Exam Access Schedule (closed / scheduled / open)
  if (pathname === '/api/admin/exam-schedule' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json().catch(() => ({}));
    const { examAccessMode, examScheduledAt } = body as {
      examAccessMode?: SystemSettings['examAccessMode'];
      examScheduledAt?: string | null;
    };

    const validModes: Array<NonNullable<SystemSettings['examAccessMode']>> = ['closed', 'scheduled', 'open'];
    if (examAccessMode !== undefined && !validModes.includes(examAccessMode as any)) {
      return jsonResponse({ error: 'Invalid examAccessMode. Must be closed, scheduled, or open.' }, 400, request, env);
    }

    if (examAccessMode === 'scheduled') {
      if (!examScheduledAt) {
        return jsonResponse({ error: 'examScheduledAt is required when examAccessMode is scheduled.' }, 400, request, env);
      }
      if (isNaN(new Date(examScheduledAt).getTime())) {
        return jsonResponse({ error: 'Invalid examScheduledAt datetime.' }, 400, request, env);
      }
    }

    const currentSettings = await storage.getSettings();
    const nowIso = new Date().toISOString();
    const nextMode = examAccessMode || currentSettings.examAccessMode || 'closed';
    const updatedSettings: SystemSettings = {
      ...currentSettings,
      examAccessMode: nextMode,
      examScheduledAt: examScheduledAt !== undefined ? (examScheduledAt || null) : (currentSettings.examScheduledAt ?? null),
      examOpenedAt: nextMode === 'open' ? (currentSettings.examOpenedAt || nowIso) : currentSettings.examOpenedAt ?? null,
      updatedAt: nowIso,
      updatedBy: auth.username || 'admin'
    };

    await storage.saveSettings(updatedSettings);
    return jsonResponse({ success: true, settings: updatedSettings }, 200, request, env);
  }

  // 1e. Immediately open exam access
  if (pathname === '/api/admin/open-exam' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const currentSettings = await storage.getSettings();
    const nowIso = new Date().toISOString();
    const updatedSettings: SystemSettings = {
      ...currentSettings,
      examAccessMode: 'open',
      examOpenedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: auth.username || 'admin'
    };

    await storage.saveSettings(updatedSettings);
    return jsonResponse({
      success: true,
      settings: updatedSettings,
      message: 'Exam access is now OPEN. Candidates may enter.'
    }, 200, request, env);
  }

  // 1f. Immediately close exam access
  if (pathname === '/api/admin/close-exam' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const currentSettings = await storage.getSettings();
    const nowIso = new Date().toISOString();
    const updatedSettings: SystemSettings = {
      ...currentSettings,
      examAccessMode: 'closed',
      updatedAt: nowIso,
      updatedBy: auth.username || 'admin'
    };

    await storage.saveSettings(updatedSettings);
    return jsonResponse({
      success: true,
      settings: updatedSettings,
      message: 'Exam access is now CLOSED.'
    }, 200, request, env);
  }

  // 2. Secure File Upload -> Cloudflare R2 (Phases 6 & 7)
  if (pathname === '/api/upload' && method === 'POST') {
    let binaryData: Uint8Array | null = null;
    let fileName = 'uploaded-file';
    let mimeType = 'application/octet-stream';
    let uploadCategory = 'general';

    const contentTypeHeader = request.headers.get('content-type') || '';
    if (contentTypeHeader.includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null);
      if (!formData) {
        return jsonResponse({ success: false, error: 'Invalid multipart form data' }, 400, request, env);
      }
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return jsonResponse({ success: false, error: 'No file provided in form field "file"' }, 400, request, env);
      }
      const fileBlob = file as File;
      fileName = fileBlob.name || 'uploaded-file';
      mimeType = fileBlob.type || 'application/octet-stream';
      uploadCategory = (formData.get('type') as string) || (formData.get('category') as string) || 'general';
      const arrayBuf = await fileBlob.arrayBuffer();
      binaryData = new Uint8Array(arrayBuf);
    } else {
      const body = await request.json().catch(() => ({}));
      const { fileData, fileName: rawFileName, fileType, uploadType } = body;
      if (!fileData || typeof fileData !== 'string') {
        return jsonResponse({ success: false, error: 'No fileData string provided' }, 400, request, env);
      }
      if (rawFileName) fileName = String(rawFileName);
      if (fileType) mimeType = String(fileType);
      if (uploadType) uploadCategory = String(uploadType);

      if (fileData.startsWith('data:')) {
        const matches = fileData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          const rawBase64 = matches[2];
          const binaryStr = atob(rawBase64);
          binaryData = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) binaryData[i] = binaryStr.charCodeAt(i);
        } else {
          return jsonResponse({ success: false, error: 'Malformed data URL' }, 400, request, env);
        }
      } else {
        try {
          const binaryStr = atob(fileData);
          binaryData = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) binaryData[i] = binaryStr.charCodeAt(i);
        } catch {
          const encoder = new TextEncoder();
          binaryData = encoder.encode(fileData);
        }
      }
    }

    if (!binaryData || binaryData.byteLength === 0) {
      return jsonResponse({ success: false, error: 'Empty file payload' }, 400, request, env);
    }

    // MIME & Extension validation
    const allowedImageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const allowedAudioMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a', 'audio/aac', 'audio/x-m4a'];
    const isImage = allowedImageMimes.includes(mimeType.toLowerCase());
    const isAudio = allowedAudioMimes.includes(mimeType.toLowerCase());

    if (!isImage && !isAudio) {
      return jsonResponse({
        success: false,
        error: `Unsupported file type "${mimeType}". Only safe images (JPEG, PNG, WebP) and audio (MP3, WAV, OGG, WebM) are permitted.`
      }, 400, request, env);
    }

    // Per-type size limits (client compresses first; server enforces hard caps).
    const category = (uploadCategory || '').toLowerCase();
    const isReceipt = category.includes('receipt');
    const isPhoto = category.includes('photo');
    let maxSizeBytes = 5 * 1024 * 1024;
    let limitLabel = '5 MB';
    let limitTip = '';
    if (isAudio) {
      maxSizeBytes = 50 * 1024 * 1024;
      limitLabel = '50 MB';
      limitTip = ' Tip: re-export voice audio as MP3 64–96 kbps mono (30 min ≈ 14–21 MB).';
    } else if (isReceipt) {
      maxSizeBytes = 1 * 1024 * 1024;
      limitLabel = '1 MB';
      limitTip = ' Tip: upload a JPEG/PNG screenshot — it is auto-compressed, no need for full-resolution photos.';
    } else if (isPhoto) {
      maxSizeBytes = 500 * 1024;
      limitLabel = '500 KB';
      limitTip = ' Tip: identity photos are auto-scaled to 300×380 — a small file is enough.';
    }
    if (binaryData.byteLength > maxSizeBytes) {
      const sizeMb = (binaryData.byteLength / 1048576).toFixed(1);
      return jsonResponse({
        success: false,
        error: `File size ${sizeMb} MB exceeds the ${limitLabel} limit for this file type.${limitTip}`
      }, 413, request, env);
    }

    // Determine extension and safe category folder
    const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
    let safeExt = extMatch ? extMatch[1].toLowerCase() : isAudio ? 'mp3' : 'jpg';
    if (!/^[a-z0-9]{2,5}$/.test(safeExt)) safeExt = isAudio ? 'mp3' : 'jpg';

    let folder = 'general';
    if (uploadCategory === 'receipt' || uploadCategory.includes('receipt')) folder = 'receipts';
    else if (uploadCategory === 'photo' || uploadCategory.includes('photo')) folder = 'photos';
    else if (uploadCategory === 'speaking' || uploadCategory.includes('speaking')) folder = 'speaking';
    else if (uploadCategory === 'audio' || isAudio) folder = 'audio';
    else if (uploadCategory === 'diagram') folder = 'diagrams';

    const randomId = crypto.randomUUID ? crypto.randomUUID() : generateRandomToken(16);
    const objectKey = `${folder}/${randomId}.${safeExt}`;

    // Aggregate guard: current + incoming must fit under the cap.
    try {
      const usage = await storage.getStorageStats();
      const currentBytes = usage?.r2Bytes || 0;
      if (currentBytes + binaryData.byteLength > R2_GUARD_BYTES) {
        const usedGb = (currentBytes / 1073741824).toFixed(2);
        return jsonResponse({
          success: false,
          error: `Storage is full (${usedGb} GB of 9.9 GB used). New uploads are paused until space is freed by the automatic nightly cleanup.`
        }, 413, request, env);
      }
    } catch (e) {
      console.error('Storage guard check failed:', e);
      return jsonResponse({
        success: false,
        error: 'Storage availability check failed. Please try again shortly.'
      }, 503, request, env);
    }

    // Store in Cloudflare R2 if available, or local dev cache
    if (env.FILES && typeof env.FILES.put === 'function') {
      await env.FILES.put(objectKey, binaryData, {
        httpMetadata: { contentType: mimeType }
      });
    } else {
      localFileCache.set(objectKey, { data: binaryData, contentType: mimeType });
    }

    // Track bytes for the storage gauge / retention accounting (best effort).
    try {
      await storage.saveFileMetadata({
        key: objectKey,
        fileName: fileName.replace(/[^a-zA-Z0-9._-]/g, '_'),
        fileType: mimeType,
        fileSize: binaryData.byteLength,
        isPrivate: folder === 'receipts' || folder === 'documents' || folder === 'speaking',
        uploadedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('File metadata tracking failed:', e);
    }

    const publicUrl = `/api/files/${objectKey}`;
    return jsonResponse({
      success: true,
      url: publicUrl,
      key: objectKey,
      fileName: fileName.replace(/[^a-zA-Z0-9._-]/g, '_'),
      fileType: mimeType,
      size: binaryData.byteLength
    }, 201, request, env);
  }

  // 2a. Reading Document Import (Admin only, in-memory — source file NEVER saved).
  // Same contract as server.ts POST /api/admin/reading-import-parse.
  // Uses ONLY env.GEMINI_IMPORT_API_KEY (no fallback). Errors are classified
  // so the admin can tell key-missing vs quota vs parse problems apart.
  if (pathname === '/api/admin/reading-import-parse' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;
    const KEY_MISSING_ERROR =
      'AI import key is not configured on the server (GEMINI_IMPORT_API_KEY). Ask the administrator to set it, or enter the passage and questions manually.';
    const classifyImportError = (err: unknown): string => {
      const status = (err as { status?: unknown })?.status;
      const code = (err as { code?: unknown })?.code;
      const msg = String((err as { message?: unknown })?.message || err || '').toLowerCase();
      const statusNum = typeof status === 'number' ? status : parseInt(String(status || ''), 10);
      if (
        statusNum === 429 || String(code) === 'RESOURCE_EXHAUSTED' ||
        msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
        msg.includes('resource_exhausted') || msg.includes('try again later')
      ) {
        return 'AI quota is exhausted for now (free-tier limits). Please try again later — quotas reset daily — or enter the passage and questions manually.';
      }
      if (
        statusNum === 400 || statusNum === 403 ||
        msg.includes('api key') || msg.includes('api_key') || msg.includes('permission_denied') ||
        msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('401')
      ) {
        return 'AI key was rejected by the provider. Ask the administrator to check GEMINI_IMPORT_API_KEY, or enter the passage and questions manually.';
      }
      if (msg && msg !== '[object object]') {
        return `AI request failed (${msg.slice(0, 160)}). Please try again, or enter the passage and questions manually.`;
      }
      return 'AI did not return usable questions for this document. Try a cleaner PDF, or enter the passage and questions manually.';
    };
    try {
      const body = await request.json().catch(() => ({} as Record<string, unknown>));
      const fileName = String(body.fileName || 'document');
      const mimeType = String(body.mimeType || '');
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
      if (!fileBase64) {
        return jsonResponse({ error: 'No document provided. Choose a PDF or JSON file.' }, 400, request, env);
      }
      const ext = (fileName.toLowerCase().split('.').pop() || '');
      const mime = mimeType.toLowerCase();
      const isPdf = mime === 'application/pdf' || ext === 'pdf';
      const isJson = mime === 'application/json' || ext === 'json';
      if (!isPdf && !isJson) {
        return jsonResponse({ error: 'Unsupported file. Please upload a PDF file. For JSON, use the Paste JSON option.' }, 400, request, env);
      }
      const cleanB64 = fileBase64.includes(',') ? String(fileBase64.split(',').pop()) : fileBase64;
      if (Math.floor(cleanB64.length * 0.75) > 15 * 1024 * 1024) {
        return jsonResponse({ error: 'Document is too large. Please use a file under 15 MB.' }, 400, request, env);
      }
      if (isJson) {
        const probe = decodeJsonSource(cleanB64);
        if (!probe.ok) {
          return jsonResponse({ error: 'This file is not valid JSON. Please check the file and try again.' }, 400, request, env);
        }
        if (!probe.text) {
          return jsonResponse({ error: 'This JSON file is empty. Please check the file and try again.' }, 400, request, env);
        }
      }
      const importKey = String(env.GEMINI_IMPORT_API_KEY || '').trim();
      if (!importKey || importKey === 'YOUR_GEMINI_IMPORT_API_KEY') {
        return jsonResponse({ error: KEY_MISSING_ERROR }, 503, request, env);
      }
      const allowedTypes = [
        'multiple_choice', 'multiple_choice_multi', 'true_false_not_given', 'yes_no_not_given',
        'matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings',
        'fill_in_the_blank', 'sentence_completion', 'summary_completion', 'short_answer',
        'diagram_label', 'map_label', 'table_completion', 'flowchart_completion', 'flowchart_completion_text', 'image_map'
      ].join(', ');
      const prompt =
        'You are an IELTS Academic Reading parser. The attached document contains UP TO THREE reading passages ' +
        '(Passage 1, Passage 2, Passage 3 in order), each followed by its own questions. ' +
        'Extract EVERY passage with its FULL text and EVERY question under the correct passage. ' +
        'AUTO-CHOOSE the most appropriate question type per question from this exact list: ' +
        allowedTypes + '. ' +
        'Return STRICT JSON only (no markdown, no commentary) with this schema: ' +
        '{"passages": [{"passageTitle": string, "passageText": string (full text, paragraphs preserved), "questions": [' +
        '{"type": string (one of the list), "prompt": string (question stem, keep numbering out; may be "" ONLY for table_completion where gaps live in tableDef), ' +
        '"instructionLine": string (the EXACT shared instruction for its question group, e.g. "Write NO MORE THAN TWO WORDS AND/OR A NUMBER.", or ""), ' +
        '"wordLimit": number or null, "maxSelections": number or null (only for multiple_choice_multi), ' +
        '"options": string[] (for choice/matching types; paragraph matching answered by bare letters carries the explicit range, e.g. ["A".."H"]), ' +
        '"acceptedAnswers": string[] (correct answer(s)), ' +
        '"tableDef": {"title": string, "headers": string[], "rows": string[][]} (table_completion ONLY, on the FIRST question of each consecutive table group; gaps marked with ___ in row-major order; omit otherwise), ' +
        '"flowDef": {"title": string, "boxes": string[]} (flowchart_completion_text ONLY, on the FIRST question of each consecutive type-in flow group; boxes top-to-bottom, gaps marked with ___ in order, "||" entry branches the boxes below it into 2 columns; omit otherwise), ' +
        '"explanation": ""}]}]}. ' +
        'Rules: keep original wording; do not invent questions or passages; keep "explanation" empty; ' +
        'PROMPT RULES (mandatory, never violate): every question MUST have a complete non-empty "prompt" containing its FULL text. ' +
        'For true_false_not_given / yes_no_not_given the prompt is the COMPLETE statement. ' +
        'For completion types the prompt MUST contain ___ marking exactly one gap per question. ' +
        'For multiple choice the prompt is the full stem (options go in "options", never inside prompt). ' +
        'For matching types the prompt is the item to match (statement, name, heading context). ' +
        'Never leave prompt empty, never put only an answer key without its stem. ' +
        'instructionLine: copy the shared group instruction VERBATIM onto EVERY question of that group ' +
        '(e.g. all of Q1-5 carry "Choose ONE WORD ONLY from the text for each answer."); most groups DO show an instruction — copy it; use "" only when the paper truly shows none above that group. ' +
        'FIDELITY: passageText holds ONLY reading content, paragraphs in order separated by a blank line; keep markers ("{A} ...", "Section A ...") at paragraph starts; ' +
        'STRIP running heads/feet, watermarks, page numbers, URLs, facebook/telegram links, "IELTSFever Academic Reading 128" headers; ' +
        'passageTitle is the bare title only. BANKS: copy any option bank (A-L, A-G, i-x List of Headings) VERBATIM into "options" on EVERY question of its group; ' +
        'multiple_choice_multi uses maxSelections=required count and ONE acceptedAnswers row PER correct letter (e.g. ["B", "D"] — never a combined "B, D" row; each letter earns its own question number). Emit exactly ONE question object per shared stem (e.g. ONE record for Questions 15–16 with acceptedAnswers ["A", "C"]) — never one record per letter. ' +
        'TABLES: a table/form/note with N numbered gaps becomes N consecutive table_completion questions (one per gap, row-major order: top row first, left cell first); gaps live in tableDef rows as ___ (several gaps may share one cell), NOT in prompt (prompt may be "" or the row label); FULL tableDef {"title": string, "headers": string[], "rows": string[][]} goes ONLY on the FIRST question of the group and its ___ count MUST equal N. Copy every cell VERBATIM — keep • bullets, original line order, and every line including gap-less ones; never drop, merge, reorder, or paraphrase any line. ' +
        'FLOWCHARTS (auto-split by bank): a flow-chart with a visible option bank becomes flowchart_completion WITH that bank in "options" on EVERY question; a flow-chart with NO bank becomes N consecutive flowchart_completion_text questions (one per gap, top-to-bottom box order) with FULL flowDef {"title": string, "boxes": string[]} ONLY on the FIRST question and its ___ count equal to N (prompt may be "" or the box label). A "||" boxes entry branches the boxes below it into a 2-column side-by-side row; it is a layout marker with no gap. flowchart_completion_text is only for box-and-arrow diagrams; notes/forms with section headers and bullets are table_completion (each bullet line a row; headers and example lines are gap-less rows), never flowchart_completion_text. Mark gaps only with ___ (never ***). ' +
        'at most 40 questions TOTAL across all passages; ' +
        'decorative illustrations with no numbered question produce NO question; only create diagram_label/map_label/image_map when the paper explicitly numbers one.';
      // PDFs go as binary (selectable AND scanned pages).
      type DocPart = { text: string } | { inlineData: { mimeType: string; data: string } };
      let parts: DocPart[];
      if (isPdf) {
        parts = [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: cleanB64 } }];
      } else {
        const decoded = decodeJsonSource(cleanB64);
        if (!decoded.ok) {
          return jsonResponse({ error: 'This file is not valid JSON. Please check the file and try again.' }, 400, request, env);
        }
        if (!decoded.text) {
          return jsonResponse({ error: 'This JSON file is empty. Please check the file and try again.' }, 400, request, env);
        }
        parts = [{ text: prompt + JSON_SOURCE_INSTRUCTION + '\n\nSOURCE JSON:\n' + decoded.text.slice(0, 200000) }];
      }
      const normalizeQuestion = (q: Record<string, unknown>) => ({
        type: String(q.type || 'short_answer'),
        prompt: String(q.prompt || ''),
        instructionLine: String(q.instructionLine || ''),
        wordLimit: typeof q.wordLimit === 'number' ? q.wordLimit : null,
        maxSelections: typeof q.maxSelections === 'number' ? q.maxSelections : null,
        options: Array.isArray(q.options) ? (q.options as unknown[]).map(String).slice(0, 20) : [],
        acceptedAnswers: (() => {
          const rows: string[] = Array.isArray(q.acceptedAnswers) ? (q.acceptedAnswers as unknown[]).map(String).slice(0, 10) : [''];
          // Multi-choice: one accepted letter per row — split legacy combined
          // rows ("B, D", "D/E") so each letter earns its own mark.
          if (String(q.type) !== 'multiple_choice_multi') return rows;
          const letters = getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: rows });
          return letters.length > 0 ? letters : rows;
        })(),
        ...(String(q.type) === 'table_completion'
          ? (() => {
            const def = sanitizeImportTableDef(q.tableDef);
            return def ? { tableDef: def } : {};
          })()
          : {}),
        ...(String(q.type) === 'flowchart_completion_text'
          ? (() => {
            const def = sanitizeImportFlowDef(q.flowDef);
            return def ? { flowDef: def } : {};
          })()
          : {}),
        explanation: String(q.explanation || '')
      });
      const ai = new GoogleGenAI({ apiKey: importKey });
      let draft: { passages?: unknown; passageTitle?: unknown; passageText?: unknown; questions?: unknown } | null = null;
      let lastErr: unknown = null;
      for (const model of ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.8-flash']) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: parts as { text?: string; inlineData?: { mimeType: string; data: string } }[] }],
            config: { responseMimeType: 'application/json', maxOutputTokens: 65536, temperature: 0 }
          });
          const rawText = (response as { text?: string }).text;
          if (!rawText) continue;
          const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          try {
            draft = JSON.parse(cleaned);
          } catch {
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
              try { draft = JSON.parse(cleaned.slice(start, end + 1)); } catch { draft = null; }
            }
          }
          if (draft && (Array.isArray((draft as { passages?: unknown }).passages) || Array.isArray((draft as { questions?: unknown }).questions))) break;
          draft = null;
        } catch (err) { lastErr = err; }
      }
      let rawPassages: Record<string, unknown>[] = [];
      if (draft && Array.isArray((draft as { passages?: unknown }).passages)) {
        rawPassages = (draft as { passages: Record<string, unknown>[] }).passages;
      } else if (draft && (typeof (draft as { passageText?: unknown }).passageText === 'string' || Array.isArray((draft as { questions?: unknown }).questions))) {
        const d = draft as { passageTitle?: unknown; passageText?: unknown; questions?: unknown };
        rawPassages = [{ passageTitle: d.passageTitle, passageText: d.passageText, questions: d.questions }];
      }
      rawPassages = rawPassages.slice(0, 3);
      if (rawPassages.length === 0) {
        console.warn('Reading import AI parse failed:', lastErr);
        return jsonResponse({ error: classifyImportError(lastErr) }, 502, request, env);
      }
      let remaining = 40;
      return jsonResponse({
        success: true,
        draft: {
          passages: rawPassages.map(p => {
            const qs = Array.isArray(p.questions) ? (p.questions as Record<string, unknown>[]) : [];
            const take = qs.slice(0, remaining);
            remaining -= take.length;
            const merged = mergeConsecutiveMultis(take.map(normalizeQuestion));
            // Paragraph matching has no printed bank: synthesize A–H range.
            synthesizeParagraphBanks(merged, String(p.passageText || ''));
            return {
              passageTitle: String(p.passageTitle || '').slice(0, 200),
              passageText: String(p.passageText || '').slice(0, 60000),
              questions: merged
            };
          })
        }
      }, 200, request, env);
    } catch (err) {
      console.warn('Reading import failed:', err);
      return jsonResponse({ error: classifyImportError(err) }, 502, request, env);
    }
  }

  // 2a2. Listening Document Import (Admin only, in-memory — source file NEVER saved).
  // Same contract family as the reading import: one file with up to 4 sections;
  // only section titles/context + questions are extracted (audio stays separate).
  // Uses ONLY env.GEMINI_IMPORT_API_KEY (no fallback). Friendly AI message on failure.
  if (pathname === '/api/admin/listening-import-parse' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;
    const FRIENDLY_AI_ERROR =
      'AI import is temporarily unavailable. Please try again in a moment or enter the section questions manually.';
    try {
      const body = await request.json().catch(() => ({} as Record<string, unknown>));
      const fileName = String(body.fileName || 'document');
      const mimeType = String(body.mimeType || '');
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
      if (!fileBase64) {
        return jsonResponse({ error: 'No document provided. Choose a PDF or JSON file.' }, 400, request, env);
      }
      const ext = (fileName.toLowerCase().split('.').pop() || '');
      const mime = mimeType.toLowerCase();
      const isPdf = mime === 'application/pdf' || ext === 'pdf';
      const isJson = mime === 'application/json' || ext === 'json';
      if (!isPdf && !isJson) {
        return jsonResponse({ error: 'Unsupported file. Please upload a PDF file. For JSON, use the Paste JSON option.' }, 400, request, env);
      }
      const cleanB64 = fileBase64.includes(',') ? String(fileBase64.split(',').pop()) : fileBase64;
      if (Math.floor(cleanB64.length * 0.75) > 15 * 1024 * 1024) {
        return jsonResponse({ error: 'Document is too large. Please use a file under 15 MB.' }, 400, request, env);
      }
      if (isJson) {
        const probe = decodeJsonSource(cleanB64);
        if (!probe.ok) {
          return jsonResponse({ error: 'This file is not valid JSON. Please check the file and try again.' }, 400, request, env);
        }
        if (!probe.text) {
          return jsonResponse({ error: 'This JSON file is empty. Please check the file and try again.' }, 400, request, env);
        }
      }
      const importKey = String(env.GEMINI_IMPORT_API_KEY || '').trim();
      if (!importKey || importKey === 'YOUR_GEMINI_IMPORT_API_KEY') {
        return jsonResponse({ error: 'AI import key is not configured on the server (GEMINI_IMPORT_API_KEY). Ask the administrator to set it, or enter the section questions manually.' }, 503, request, env);
      }
      const allowedTypes = [
        'multiple_choice', 'multiple_choice_multi', 'true_false_not_given', 'yes_no_not_given',
        'matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings',
        'fill_in_the_blank', 'sentence_completion', 'summary_completion', 'short_answer',
        'diagram_label', 'map_label', 'table_completion', 'flowchart_completion', 'flowchart_completion_text', 'image_map'
      ].join(', ');
      const prompt =
        'You are an IELTS Listening parser. The attached document contains the questions for UP TO FOUR listening sections ' +
        '(Section 1, Section 2, Section 3, Section 4 in order), each with its questions. There is NO audio in the document — extract ONLY section headings and questions. ' +
        'Extract EVERY section with its title/context line and EVERY question under the correct section. ' +
        'AUTO-CHOOSE the most appropriate question type per question from this exact list: ' +
        allowedTypes + '. ' +
        'Return STRICT JSON only (no markdown, no commentary) with this schema: ' +
        '{"sections": [{"sectionTitle": string, "context": string (one-line setting/topic description or ""), "questions": [' +
        '{"type": string (one of the list), "prompt": string (question stem, keep numbering out; may be "" ONLY for table_completion where gaps live in tableDef), ' +
        '"instructionLine": string (e.g. "Write NO MORE THAN TWO WORDS AND/OR A NUMBER." or ""), ' +
        '"wordLimit": number or null, "maxSelections": number or null (only for multiple_choice_multi), ' +
        '"options": string[] (for choice/matching types), ' +
        '"acceptedAnswers": string[] (correct answer(s)), ' +
        '"tableDef": {"title": string, "headers": string[], "rows": string[][]} (table_completion ONLY, on the FIRST question of each consecutive table group; gaps marked with ___ in row-major order; omit otherwise), ' +
        '"flowDef": {"title": string, "boxes": string[]} (flowchart_completion_text ONLY, on the FIRST question of each consecutive type-in flow group; boxes top-to-bottom, gaps marked with ___ in order, "||" entry branches the boxes below it into 2 columns; omit otherwise), ' +
        '"explanation": ""}]}]}. ' +
        'Rules: keep original wording; do not invent questions or sections; keep "explanation" empty; ' +
        'multiple_choice_multi: emit exactly ONE question object per shared stem (e.g. ONE record for Questions 15–16 with acceptedAnswers ["A", "C"]) — never one record per letter; maxSelections = required count. ' +
        'instructionLine: copy the shared group instruction VERBATIM onto EVERY question of that group (most groups DO show one — copy it; use "" only when the paper truly shows none). ' +
        'TABLES: a table/form/note with N numbered gaps becomes N consecutive table_completion questions (one per gap, row-major order: top row first, left cell first); gaps live in tableDef rows as ___ (several gaps may share one cell), NOT in prompt (prompt may be "" or the row label); FULL tableDef {"title": string, "headers": string[], "rows": string[][]} goes ONLY on the FIRST question of the group and its ___ count MUST equal N; copy every cell VERBATIM — keep • bullets, original line order, and every line including gap-less ones; never drop, merge, reorder, or paraphrase any line. ' +
        'at most 40 questions TOTAL across all sections; ' +
        'diagrams/maps without readable text: still create the question with type diagram_label/map_label and empty acceptedAnswers.';
      // PDFs go as binary; JSON sources go as text (validated above).
      type DocPart = { text: string } | { inlineData: { mimeType: string; data: string } };
      let parts: DocPart[];
      if (isPdf) {
        parts = [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: cleanB64 } }];
      } else {
        const decoded = decodeJsonSource(cleanB64);
        if (!decoded.ok) {
          return jsonResponse({ error: 'This file is not valid JSON. Please check the file and try again.' }, 400, request, env);
        }
        if (!decoded.text) {
          return jsonResponse({ error: 'This JSON file is empty. Please check the file and try again.' }, 400, request, env);
        }
        parts = [{ text: prompt + JSON_SOURCE_INSTRUCTION + '\n\nSOURCE JSON:\n' + decoded.text.slice(0, 200000) }];
      }
      const normalizeQuestion = (q: Record<string, unknown>) => ({
        type: String(q.type || 'short_answer'),
        prompt: String(q.prompt || ''),
        instructionLine: String(q.instructionLine || ''),
        wordLimit: typeof q.wordLimit === 'number' ? q.wordLimit : null,
        maxSelections: typeof q.maxSelections === 'number' ? q.maxSelections : null,
        options: Array.isArray(q.options) ? (q.options as unknown[]).map(String).slice(0, 20) : [],
        acceptedAnswers: (() => {
          const rows: string[] = Array.isArray(q.acceptedAnswers) ? (q.acceptedAnswers as unknown[]).map(String).slice(0, 10) : [''];
          // Multi-choice: one accepted letter per row — split legacy combined
          // rows ("B, D", "D/E") so each letter earns its own mark.
          if (String(q.type) !== 'multiple_choice_multi') return rows;
          const letters = getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: rows });
          return letters.length > 0 ? letters : rows;
        })(),
        ...(String(q.type) === 'table_completion'
          ? (() => {
            const def = sanitizeImportTableDef(q.tableDef);
            return def ? { tableDef: def } : {};
          })()
          : {}),
        ...(String(q.type) === 'flowchart_completion_text'
          ? (() => {
            const def = sanitizeImportFlowDef(q.flowDef);
            return def ? { flowDef: def } : {};
          })()
          : {}),
        explanation: String(q.explanation || '')
      });
      const ai = new GoogleGenAI({ apiKey: importKey });
      let draft: { sections?: unknown } | null = null;
      let lastErr: unknown = null;
      for (const model of ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.8-flash']) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: parts as { text?: string; inlineData?: { mimeType: string; data: string } }[] }],
            config: { responseMimeType: 'application/json', maxOutputTokens: 65536, temperature: 0 }
          });
          const rawText = (response as { text?: string }).text;
          if (!rawText) continue;
          const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          try {
            draft = JSON.parse(cleaned);
          } catch {
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
              try { draft = JSON.parse(cleaned.slice(start, end + 1)); } catch { draft = null; }
            }
          }
          if (draft && Array.isArray((draft as { sections?: unknown }).sections)) break;
          draft = null;
        } catch (err) { lastErr = err; }
      }
      let rawSections: Record<string, unknown>[] = [];
      if (draft && Array.isArray((draft as { sections?: unknown }).sections)) {
        rawSections = (draft as { sections: Record<string, unknown>[] }).sections;
      }
      rawSections = rawSections.slice(0, 4);
      if (rawSections.length === 0) {
        console.warn('Listening import AI parse failed:', lastErr);
        return jsonResponse({ error: classifyAiImportError(lastErr) }, 502, request, env);
      }
      let remaining = 40;
      return jsonResponse({
        success: true,
        draft: {
          sections: rawSections.map(s => {
            const qs = Array.isArray(s.questions) ? (s.questions as Record<string, unknown>[]) : [];
            const take = qs.slice(0, remaining);
            remaining -= take.length;
            return {
              sectionTitle: String(s.sectionTitle || '').slice(0, 200),
              context: String(s.context || '').slice(0, 2000),
              questions: mergeConsecutiveMultis(take.map(normalizeQuestion))
            };
          })
        }
      }, 200, request, env);
    } catch (err) {
      console.warn('Listening import failed:', err);
      return jsonResponse({ error: classifyAiImportError(err) }, 502, request, env);
    }
  }

  // 2b. File Retrieval & Private Access Gate (Phase 8)
  const fileMatch = pathname.match(/^\/api\/files\/(.+)$/);
  if (fileMatch && method === 'GET') {
    const rawKey = decodeURIComponent(fileMatch[1]);
    const cleanKey = rawKey.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[\\/]+/, '');

    // Private Access Control: Receipts, identity documents and speaking
    // voice memos are private (candidate voice is sensitive).
    const isPrivate = cleanKey.startsWith('receipts/') || cleanKey.startsWith('documents/') || cleanKey.startsWith('speaking/');
    if (isPrivate) {
      const auth = await requireAdmin(request, storage, env);
      if (!auth.authorized) {
        return jsonResponse({
          success: false,
          error: 'Unauthorized: Private administrative document.',
          message: 'Access restricted to authorized IELTS proctors.'
        }, 401, request, env);
      }
    }

    // Total size is needed for HTTP Range (media seeking / audio resume).
    let totalSize: number | null = null;
    let contentType = 'application/octet-stream';

    // Parse "Range: bytes=start-end" (single range; what <audio> sends).
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null; // inclusive
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes\s*=\s*(\d*)-(\d*)/);
      if (m) {
        if (m[1] !== '') rangeStart = parseInt(m[1], 10);
        if (m[2] !== '') rangeEnd = parseInt(m[2], 10);
      }
    }

    const cors = getCorsHeaders(request, env);
    const baseHeaders = {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      ...cors
    };

    /** Normalize a parsed Range header against a known total. Null = serve full body. */
    const normalizeRange = (total: number): { start: number; end: number } | null => {
      if (rangeStart === null && rangeEnd === null) return null;
      let start: number;
      let end: number;
      if (rangeStart !== null) {
        start = rangeStart;
        end = rangeEnd ?? total - 1;
      } else {
        // Suffix range "bytes=-N": last N bytes
        start = Math.max(0, total - (rangeEnd as number));
        end = total - 1;
      }
      if (start >= total) return null;
      start = Math.max(0, start);
      end = Math.max(start, Math.min(end, total - 1));
      return { start, end };
    };

    if (env.FILES && typeof env.FILES.get === 'function') {
      if (rangeStart !== null || rangeEnd !== null) {
        const head = await env.FILES.head(cleanKey);
        if (!head) {
          return jsonResponse({ error: 'File not found' }, 404, request, env);
        }
        totalSize = head.size;
        contentType = head.httpMetadata?.contentType || 'application/octet-stream';
        const r = normalizeRange(totalSize);
        if (!r) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${totalSize}`, ...baseHeaders, 'Content-Type': 'text/plain' }
          });
        }
        const { start, end } = r;
        const obj = await env.FILES.get(cleanKey, { range: { offset: start, length: end - start + 1 } });
        if (!obj) {
          return jsonResponse({ error: 'File not found' }, 404, request, env);
        }
        return new Response(obj.body as any, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': String(end - start + 1)
          }
        });
      }
      const obj = await env.FILES.get(cleanKey);
      if (!obj) {
        return jsonResponse({ error: 'File not found' }, 404, request, env);
      }
      return new Response(obj.body as any, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' }
      });
    }

    if (localFileCache.has(cleanKey)) {
      const cached = localFileCache.get(cleanKey)!;
      totalSize = cached.data.byteLength;
      contentType = cached.contentType;
      if (rangeStart !== null || rangeEnd !== null) {
        const r = normalizeRange(totalSize);
        if (!r) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${totalSize}`, ...baseHeaders, 'Content-Type': 'text/plain' }
          });
        }
        const { start, end } = r;
        return new Response(cached.data.slice(start, end + 1) as any, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': String(end - start + 1)
          }
        });
      }
      return new Response(cached.data as any, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': contentType }
      });
    }

    return jsonResponse({ error: 'File not found' }, 404, request, env);
  }

  // 3. Admin Login (Phases 3, 4 & 5)
  if (pathname === '/api/admin/login' && method === 'POST') {
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const now = Date.now();

    // Check rate-limiting lockout
    const attemptRecord = await storage.getRateLimit(clientIp);
    if (attemptRecord && attemptRecord.lockedUntil > now) {
      const waitSeconds = Math.ceil((attemptRecord.lockedUntil - now) / 1000);
      return jsonResponse({
        success: false,
        error: `Too many failed login attempts. Terminal locked for security. Please retry in ${waitSeconds}s.`,
        locked: true,
        waitSeconds
      }, 429, request, env);
    }

    // Strict credential check: fail safely if credentials are not configured in environment
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      console.error('[CRITICAL SECURITY ERROR] ADMIN_USERNAME or ADMIN_PASSWORD secrets are not configured in Cloudflare environment.');
      return jsonResponse({
        success: false,
        error: 'Administrator credentials are not configured on this server.',
        message: 'Please set ADMIN_USERNAME and ADMIN_PASSWORD via Cloudflare Worker secrets.'
      }, 503, request, env);
    }

    const body = await request.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || !password) {
      return jsonResponse({ success: false, error: 'Username and password are required.' }, 400, request, env);
    }

    const usernameMatch = username.trim() === ADMIN_USERNAME;
    const passwordMatch = isConstantTimeEqual(String(password), ADMIN_PASSWORD);

    if (!usernameMatch || !passwordMatch) {
      const currentCount = (attemptRecord?.count || 0) + 1;
      let lockedUntil = 0;
      if (currentCount >= 5) {
        lockedUntil = now + 60 * 1000;
      }
      await storage.saveRateLimit(clientIp, { count: currentCount, lockedUntil });
      const attemptsRemaining = Math.max(0, 5 - currentCount);

      return jsonResponse({
        success: false,
        error: 'Invalid administrator credentials. Access restricted to authorized IELTS proctors only.',
        attemptsRemaining,
        locked: currentCount >= 5,
        waitSeconds: currentCount >= 5 ? 60 : undefined
      }, 401, request, env);
    }

    await storage.clearRateLimit(clientIp);

    // Cryptographically random 256-bit token; store SHA-256 hash in storage
    const rawToken = generateRandomToken(32);
    const tokenHash = await hashToken(rawToken);

    await storage.saveAdminToken(tokenHash, {
      token: tokenHash,
      username: ADMIN_USERNAME,
      createdAt: now
    });

    return jsonResponse({
      success: true,
      token: rawToken,
      username: ADMIN_USERNAME,
      role: 'Chief Proctor & Master Examiner',
      expiresIn: 86400
    }, 200, request, env);
  }

  // 4. Admin Verify Token (Phase 4)
  if (pathname === '/api/admin/verify' && method === 'GET') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) {
      return auth.errorResponse!;
    }
    return jsonResponse({
      authenticated: true,
      username: auth.username || ADMIN_USERNAME,
      role: 'Chief Proctor & Master Examiner'
    }, 200, request, env);
  }

  // 5. Admin Logout (Phase 5)
  if (pathname === '/api/admin/logout' && method === 'POST') {
    const authHeader = request.headers.get('authorization');
    const rawToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : request.headers.get('x-admin-token')?.trim();

    if (rawToken) {
      const tokenHash = await hashToken(rawToken);
      await storage.deleteAdminToken(tokenHash);
    }
    return jsonResponse({ success: true, message: 'Administrator successfully logged out.' }, 200, request, env);
  }

/**
 * Exam-save migration: split legacy combined multi rows ("B, D") into one
 * accepted letter per row, so every saved exam follows the per-letter model
 * (one mark per question number). Runs on exam create/update.
 */
function normalizeExamMultis(exam: Exam): void {
  const sections = exam?.listening?.sections;
  if (Array.isArray(sections)) {
    sections.forEach(s => {
      if (Array.isArray(s.questions)) s.questions = s.questions.map(q => normalizeMultiKeys(q as any) as any);
    });
  }
  const passages = (exam as Exam)?.reading?.passages;
  if (Array.isArray(passages)) {
    passages.forEach(p => {
      if (Array.isArray((p as any).questions)) (p as any).questions = (p as any).questions.map((q: any) => normalizeMultiKeys(q));
    });
  }
}

  // 6. Admin Auth Policy
  if (pathname === '/api/admin/auth-policy' && method === 'GET') {
    return jsonResponse({
      requiredUsername: ADMIN_USERNAME,
      passwordRequirements: 'High-entropy complex 24-character security key',
      lockoutPolicy: '5 failed attempts triggers 60s lockout',
      sessionDurationHours: 24
    });
  }

  // 7. Exams list (Public)
  if (pathname === '/api/exams' && method === 'GET') {
    const list = await storage.getExams();
    return jsonResponse(list, 200, request, env);
  }

  // 8. Exam create/update (Admin). Updates always allowed; NEW exam forms
  // are rejected once the catalog holds MAX_EXAMS (delete one first).
  if (pathname === '/api/exams' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const updatedExam: Exam = await request.json().catch(() => ({}));
    if (!updatedExam || !updatedExam.title) {
      return jsonResponse({ success: false, error: 'Exam title is required' }, 400, request, env);
    }
    if (!updatedExam.id) {
      updatedExam.id = `exam-ielts-${Date.now()}`;
    }
    const existingExams = await storage.getExams();
    const previous = existingExams.find(e => e && e.id === updatedExam.id);
    const isNew = !previous;
    if (isNew && existingExams.length >= MAX_EXAMS) {
      return jsonResponse({
        success: false,
        error: `Exam catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an existing exam before creating a new one.`,
        limit: MAX_EXAMS
      }, 400, request, env);
    }
    const previousKeys = collectExamFileKeys(previous);
    normalizeExamMultis(updatedExam);
    await storage.saveExam(updatedExam);
    // Cascade: files removed/replaced by this save (old audio, swapped
    // diagrams) must not linger in R2 / D1 as orphans.
    let deletedFiles: string[] = [];
    if (previousKeys.size > 0) {
      try {
        const nextKeys = collectExamFileKeys(updatedExam);
        const removed = [...previousKeys].filter(k => !nextKeys.has(k));
        if (removed.length > 0) {
          const remaining = await storage.getExams().catch(() => [] as Exam[]);
          const stillUsed = new Set<string>();
          remaining.forEach(e => {
            if (e.id !== updatedExam.id) collectExamFileKeys(e).forEach(k => stillUsed.add(k));
          });
          nextKeys.forEach(k => stillUsed.add(k));
          deletedFiles = await deleteUnreferencedFiles(storage, env, removed, stillUsed);
        }
      } catch (e) {
        console.warn('Exam save: replaced-file cleanup failed:', e);
      }
    }
    return jsonResponse({ success: true, exam: updatedExam, deletedFiles }, 201, request, env);
  }

  // 9. Single Exam details (GET: Public, PUT/DELETE: Admin)
  const examMatch = pathname.match(/^\/api\/exams\/([^\/]+)$/);
  if (examMatch) {
    const examId = decodeURIComponent(examMatch[1]);
    if (method === 'GET') {
      const exam = await storage.getExam(examId);
      if (!exam) return jsonResponse({ error: 'Exam not found' }, 404, request, env);
      return jsonResponse(exam, 200, request, env);
    }
    if (method === 'PUT') {
      const auth = await requireAdmin(request, storage, env);
      if (!auth.authorized) return auth.errorResponse!;

      const updatedExam: Exam = await request.json().catch(() => ({}));
      if (!updatedExam.id) updatedExam.id = examId;
      const existingExams = await storage.getExams();
      const previous = existingExams.find(e => e && e.id === updatedExam.id);
      const isNew = !previous;
      if (isNew && existingExams.length >= MAX_EXAMS) {
        return jsonResponse({
          success: false,
          error: `Exam catalog is full (${MAX_EXAMS}/${MAX_EXAMS}). Delete an existing exam before creating a new one.`,
          limit: MAX_EXAMS
        }, 400, request, env);
      }
      const previousKeys = collectExamFileKeys(previous);
      normalizeExamMultis(updatedExam);
      await storage.saveExam(updatedExam);
      // Cascade: files removed/replaced by this save (old audio, swapped
      // diagrams) must not linger in R2 / D1 as orphans.
      let deletedFiles: string[] = [];
      if (previousKeys.size > 0) {
        try {
          const nextKeys = collectExamFileKeys(updatedExam);
          const removed = [...previousKeys].filter(k => !nextKeys.has(k));
          if (removed.length > 0) {
            const remaining = await storage.getExams().catch(() => [] as Exam[]);
            const stillUsed = new Set<string>();
            remaining.forEach(e => {
              if (e.id !== updatedExam.id) collectExamFileKeys(e).forEach(k => stillUsed.add(k));
            });
            nextKeys.forEach(k => stillUsed.add(k));
            deletedFiles = await deleteUnreferencedFiles(storage, env, removed, stillUsed);
          }
        } catch (e) {
          console.warn('Exam save: replaced-file cleanup failed:', e);
        }
      }
      return jsonResponse({ success: true, exam: updatedExam, deletedFiles }, 200, request, env);
    }
    if (method === 'DELETE') {
      const auth = await requireAdmin(request, storage, env);
      if (!auth.authorized) return auth.errorResponse!;

      // Collect every file key first (audio, diagrams, question images).
      const doomed = await storage.getExam(examId).catch(() => undefined);
      const ownKeys = collectExamFileKeys(doomed);

      await storage.deleteExam(examId);

      // A deleted exam can no longer be the active one — clear the stale
      // pointer so entry can never resolve against a ghost exam.
      try {
        const settings = await storage.getSettings().catch(() => null);
        if (settings && settings.activeExamId === examId) {
          await storage.saveSettings({
            ...settings,
            activeExamId: null,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('Exam delete: failed to clear stale active exam:', e);
      }

      // Delete its files (R2 object + D1 tracker) unless another exam still
      // references them (cloned exams share the same /api/files/ URLs).
      let deletedFiles: string[] = [];
      if (ownKeys.size > 0) {
        const remaining = await storage.getExams().catch(() => [] as Exam[]);
        const stillUsed = new Set<string>();
        remaining.forEach(e => {
          collectExamFileKeys(e).forEach(k => stillUsed.add(k));
        });
        deletedFiles = await deleteUnreferencedFiles(storage, env, ownKeys, stillUsed);
      }
      return jsonResponse({ success: true, message: `Exam ${examId} deleted.`, deletedFiles }, 200, request, env);
    }
  }

  // 10. Global answer edit (Admin)
  const globalAnswerMatch = pathname.match(/^\/api\/exams\/([^\/]+)\/global-answer-edit$/);
  if (globalAnswerMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const examId = decodeURIComponent(globalAnswerMatch[1]);
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const questionId = typeof body.questionId === 'string' ? body.questionId : '';
    // Accept both field names: the admin UI sends `newAcceptedAnswers`.
    const rawKey = Array.isArray(body.acceptedAnswers) ? body.acceptedAnswers : body.newAcceptedAnswers;
    const acceptedAnswers = Array.isArray(rawKey) ? rawKey.map(String) : null;
    if (!questionId || !acceptedAnswers) {
      return jsonResponse({ success: false, error: 'Valid questionId and acceptedAnswers array required' }, 400, request, env);
    }

    const exam = await storage.getExam(examId);
    if (!exam) return jsonResponse({ error: 'Exam not found' }, 404, request, env);

    let found = false;
    for (const sec of exam.listening.sections) {
      for (const q of sec.questions) {
        if (q.id === questionId) {
          q.acceptedAnswers = acceptedAnswers;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      for (const p of exam.reading.passages) {
        for (const q of p.questions) {
          if (q.id === questionId) {
            q.acceptedAnswers = acceptedAnswers;
            found = true;
            break;
          }
        }
      }
    }
    if (!found) {
      return jsonResponse({ success: false, error: `Question ${questionId} not found in exam ${examId}. No changes applied.` }, 404, request, env);
    }
    await storage.saveExam(exam);

    const allSessions = await storage.getSessions();
    let regradedCount = 0;
    for (const sess of allSessions) {
      if (sess.examId === examId) {
        let touched = false;
        if (sess.listeningState.answers[questionId] !== undefined) {
          sess.grading.listeningScore = gradeListening(sess, exam);
          touched = true;
        }
        if (sess.readingState.answers[questionId] !== undefined) {
          sess.grading.readingScore = gradeReading(sess, exam);
          touched = true;
        }
        if (touched) {
          // Finalized TRFs must reflect the corrected bands immediately.
          recomputeOverallFromCurrentBands(sess);
          sess.lastSavedAt = new Date().toISOString();
          await storage.saveSession(sess);
          regradedCount++;
        }
      }
    }
    return jsonResponse({ success: true, message: `Updated answers and regraded ${regradedCount} candidates.`, affectedCandidatesCount: regradedCount, exam }, 200, request, env);
  }

  // 11. Sessions list (Admin: restricted to authorized proctors)
  if (pathname === '/api/sessions' && method === 'GET') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const list = await storage.getSessions();
    return jsonResponse(list, 200, request, env);
  }

  // 12. Sessions create (Admin)
  if (pathname === '/api/sessions' && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json().catch(() => ({}));
    const examsList = await storage.getExams();
    const defaultEx = examsList[0] || defaultExam;
    const targetExam = (body.examId ? await storage.getExam(body.examId) : undefined) || defaultEx;

    // Same shared daily cap as public registration: admin-added candidates
    // occupy the 125/day pool too.
    if (typeof targetExam.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetExam.examDate)) {
      const usage = await getDateOccupancy(storage, targetExam.examDate);
      if (usage.taken >= MAX_REGISTRATIONS_PER_DATE) {
        return jsonResponse({
          success: false,
          error: `No seats left for ${targetExam.examDate} (${MAX_REGISTRATIONS_PER_DATE}/${MAX_REGISTRATIONS_PER_DATE} taken, including admin-added candidates).`,
          examDate: targetExam.examDate,
          capacity: MAX_REGISTRATIONS_PER_DATE
        }, 400, request, env);
      }
    }

    const digits = Math.floor(100000 + Math.random() * 900000).toString();
    const candidateId = `IG-${digits}`;
    const newSession = createDefaultSession(candidateId, targetExam, body);
    if (body.examSlot === 1 || body.examSlot === 2) newSession.examSlot = body.examSlot;
    await storage.saveSession(newSession);
    return jsonResponse(newSession, 201, request, env);
  }
  // 13. Single Session GET (Candidate / Session lookup)
  const sessionMatch = pathname.match(/^\/api\/sessions\/([^\/]+)$/);
  if (sessionMatch && method === 'GET') {
    const candidateId = decodeURIComponent(sessionMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Candidate session not found' }, 404, request, env);
    return jsonResponse(session, 200, request, env);
  }

  // 14. Session profile update (Admin)
  const profileMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/profile$/);
  if (profileMatch && method === 'PUT') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(profileMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);

    const body = await request.json().catch(() => ({}));
    if (body.candidateName && typeof body.candidateName === 'string') session.candidateName = body.candidateName.trim();
    if (body.dateOfBirth && typeof body.dateOfBirth === 'string') session.dateOfBirth = body.dateOfBirth.trim();
    if (body.gender && typeof body.gender === 'string') session.gender = body.gender.trim();
    if (body.countryOfOrigin && typeof body.countryOfOrigin === 'string') session.countryOfOrigin = body.countryOfOrigin.trim();
    if (body.firstLanguage && typeof body.firstLanguage === 'string') session.firstLanguage = body.firstLanguage.trim();
    if (body.idDocumentNumber && typeof body.idDocumentNumber === 'string') session.idDocumentNumber = body.idDocumentNumber.trim();
    if (body.centreNumber && typeof body.centreNumber === 'string') session.centreNumber = body.centreNumber.trim();
    if (body.schemeCode && typeof body.schemeCode === 'string') session.schemeCode = body.schemeCode.trim();
    if (body.candidatePhotoUrl && typeof body.candidatePhotoUrl === 'string') session.candidatePhotoUrl = body.candidatePhotoUrl.trim();
    if (body.examSlot === 1 || body.examSlot === 2) session.examSlot = body.examSlot;

    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 15. Registrations GET list (Admin)
  if (pathname === '/api/registrations' && method === 'GET') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const list = await storage.getRegistrations();
    return jsonResponse(list, 200, request, env);
  }

  // 16. Registrations POST create (Public candidate portal)
  if (pathname === '/api/registrations' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { candidateName, m10ReceiptUrl } = body;
    if (!candidateName || typeof candidateName !== 'string' || !candidateName.trim()) {
      return jsonResponse({ error: 'Valid candidate name is required.' }, 400, request, env);
    }
    if (!m10ReceiptUrl || typeof m10ReceiptUrl !== 'string') {
      return jsonResponse({ error: 'A valid m10 payment receipt URL or uploaded document is required.' }, 400, request, env);
    }

    const regDigits = Math.floor(100000 + Math.random() * 900000).toString();
    const regId = `REG-${regDigits}`;
    const examsList = await storage.getExams();
    const targetExam = (body.examId ? await storage.getExam(body.examId) : undefined) || examsList[0] || defaultExam;

    const currentSettings = await storage.getSettings();
    const effectiveFee = (currentSettings.isConfigured && typeof currentSettings.examPriceAzn === 'number')
      ? currentSettings.examPriceAzn
      : (Number(body.amountAzn) || 0);

    const examDate = typeof targetExam.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetExam.examDate)
      ? targetExam.examDate
      : undefined;

    // Two-slot days: the candidate picks slot 1 or 2 (defaults to 1).
    const examSlot: 1 | 2 = body.examSlot === 2 && targetExam.examTime2 ? 2 : 1;
    const slotTime = examSlot === 2 && targetExam.examTime2 ? targetExam.examTime2 : targetExam.examTime;

    // Per-date capacity (SHARED across both slots AND both channels): at most
    // MAX_REGISTRATIONS_PER_DATE active claims per exam day — m10 requests
    // plus admin-added candidates. Rejected requests free their slot.
    if (examDate) {
      const usage = await getDateOccupancy(storage, examDate);
      if (usage.taken >= MAX_REGISTRATIONS_PER_DATE) {
        return jsonResponse({
          success: false,
          error: `Registration for ${examDate} is full (${MAX_REGISTRATIONS_PER_DATE}/${MAX_REGISTRATIONS_PER_DATE} spots taken). Please choose another exam date.`,
          examDate,
          capacity: MAX_REGISTRATIONS_PER_DATE
        }, 400, request, env);
      }
    }

    const newRequest: ExamRegistrationRequest = {
      id: regId,
      candidateName: candidateName.trim().slice(0, 150),
      candidatePhotoUrl: typeof body.candidatePhotoUrl === 'string' ? body.candidatePhotoUrl.trim() : '',
      dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '1998-08-14',
      gender: body.gender === 'F' ? 'F' : 'M',
      countryOfOrigin: typeof body.countryOfOrigin === 'string' ? body.countryOfOrigin.trim() : 'Azerbaijan',
      firstLanguage: typeof body.firstLanguage === 'string' ? body.firstLanguage.trim() : 'Azerbaijani',
      idDocumentNumber: typeof body.idDocumentNumber === 'string' ? body.idDocumentNumber.trim().slice(0, 50) : '',
      phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '+994 50 000 00 00',
      email: typeof body.email === 'string' ? body.email.trim().slice(0, 100) : `candidate.${regDigits}@ieltsgate.az`,
      examId: targetExam.id,
      examTitle: targetExam.title,
      examDate,
      examTime: typeof slotTime === 'string' && /^\d{1,2}:\d{2}/.test(slotTime)
        ? slotTime
        : undefined,
      examSlot,
      schemeCode: typeof body.schemeCode === 'string' ? body.schemeCode.trim() : 'Academic Standard',
      centreNumber: targetExam.centreNumber || 'AZ001 - Baku Official IELTS Test Center',
      paymentMethod: 'm10',
      m10ReceiptUrl: m10ReceiptUrl.trim(),
      m10TransactionId: typeof body.m10TransactionId === 'string' ? body.m10TransactionId.trim() : `M10-${Date.now().toString().slice(-8)}`,
      amountAzn: effectiveFee,
      status: 'pending',
      submittedAt: new Date().toISOString()
    };
    await storage.saveRegistration(newRequest);
    return jsonResponse({ success: true, request: newRequest, ...newRequest }, 201, request, env);
  }

  // 16b. Public availability for an exam date (no PII, counts only)
  if (pathname === '/api/registration-availability' && method === 'GET') {
    const parsedUrl = new URL(request.url);
    const examDate = (parsedUrl.searchParams.get('examDate') || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      return jsonResponse({ success: false, error: 'Valid examDate (YYYY-MM-DD) is required.' }, 400, request, env);
    }
    const usage = await getDateOccupancy(storage, examDate);
    return jsonResponse({
      success: true,
      examDate,
      registered: usage.taken,
      bySlot: usage.bySlot,
      adminAdded: usage.adminSessions,
      capacity: MAX_REGISTRATIONS_PER_DATE,
      spotsLeft: Math.max(0, MAX_REGISTRATIONS_PER_DATE - usage.taken),
      isFull: usage.taken >= MAX_REGISTRATIONS_PER_DATE
    }, 200, request, env);
  }

  // 17. Single registration GET (Candidate lookup: privacy safe)
  const regMatch = pathname.match(/^\/api\/registrations\/([^\/]+)$/);
  if (regMatch && method === 'GET') {
    const regId = decodeURIComponent(regMatch[1]);
    const reqItem = await storage.getRegistration(regId);
    if (!reqItem) return jsonResponse({ error: 'Registration request not found' }, 404, request, env);

    // Sanitize response: do not expose raw national ID document publicly on unauthenticated lookup
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) {
      return jsonResponse({
        id: reqItem.id,
        candidateName: reqItem.candidateName,
        status: reqItem.status,
        submittedAt: reqItem.submittedAt,
        examTitle: reqItem.examTitle,
        examDate: reqItem.examDate,
        examTime: reqItem.examTime,
        examSlot: reqItem.examSlot,
        schemeCode: reqItem.schemeCode,
        centreNumber: reqItem.centreNumber,
        approvedCandidateId: reqItem.approvedCandidateId,
        rejectionReason: reqItem.status === 'rejected' ? reqItem.rejectionReason : undefined
      }, 200, request, env);
    }

    return jsonResponse(reqItem, 200, request, env);
  }

  // 18. Approve registration (Admin)
  const regApproveMatch = pathname.match(/^\/api\/registrations\/([^\/]+)\/approve$/);
  if (regApproveMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const regId = decodeURIComponent(regApproveMatch[1]).trim().toUpperCase();
    const reg = await storage.getRegistration(regId);
    if (!reg) return jsonResponse({ error: 'Registration request not found' }, 404, request, env);

    // Issue a fresh random IG number — deliberately DIFFERENT from the REG
    // digits — and link the two explicitly both ways.
    let candidateId = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      const digits = Math.floor(100000 + Math.random() * 900000).toString();
      const trial = `IG-${digits}`;
      if (trial === reg.id) continue;
      const clash = await storage.getSession(trial).catch(() => undefined);
      if (!clash) {
        candidateId = trial;
        break;
      }
    }
    if (!candidateId) {
      return jsonResponse({ error: 'Could not issue a unique Candidate ID. Please retry.' }, 500, request, env);
    }
    const examsList = await storage.getExams();
    const matchedExam = (reg.examId ? await storage.getExam(reg.examId) : undefined) || examsList[0] || defaultExam;

    const newSession = createDefaultSession(candidateId, matchedExam, {
      registrationId: reg.id,
      candidateName: reg.candidateName,
      candidatePhotoUrl: reg.candidatePhotoUrl,
      dateOfBirth: reg.dateOfBirth,
      gender: reg.gender,
      countryOfOrigin: reg.countryOfOrigin,
      firstLanguage: reg.firstLanguage,
      idDocumentNumber: reg.idDocumentNumber,
      schemeCode: reg.schemeCode,
      centreNumber: reg.centreNumber,
      examSlot: reg.examSlot === 2 ? 2 : 1
    });

    reg.status = 'approved';
    reg.approvedCandidateId = candidateId;
    reg.reviewedAt = new Date().toISOString();

    await storage.saveRegistration(reg);
    await storage.saveSession(newSession);

    return jsonResponse({
      success: true,
      message: `Registration ${reg.id} verified & approved. Candidate ID issued: ${candidateId}`,
      candidateId,
      session: newSession
    }, 200, request, env);
  }

  // 19. Reject registration (Admin)
  const regRejectMatch = pathname.match(/^\/api\/registrations\/([^\/]+)\/reject$/);
  if (regRejectMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const regId = decodeURIComponent(regRejectMatch[1]).trim().toUpperCase();
    const reg = await storage.getRegistration(regId);
    if (!reg) return jsonResponse({ error: 'Registration request not found' }, 404, request, env);
    const body = await request.json().catch(() => ({}));
    reg.status = 'rejected';
    reg.rejectionReason = body.reason || 'Payment verification failed on m10 statement.';
    reg.reviewedAt = new Date().toISOString();
    await storage.saveRegistration(reg);
    return jsonResponse({ success: true, message: `Registration ${reg.id} rejected.`, registration: reg }, 200, request, env);
  }

  // 20. Session sync (Candidate-scoped, strict validation)
  const syncMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/sync$/);
  if (syncMatch && method === 'POST') {
    const candidateId = decodeURIComponent(syncMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    // Entry gate: only unstarted ('registered') sessions wait. Started
    // sessions always save, even if the admin re-dated or switched exams.
    if (isEntryGatedSession(session)) {
      const settings = await storage.getSettings().catch(() => ({} as SystemSettings));
      const exam = session.examId ? await storage.getExam(session.examId).catch(() => undefined) : undefined;
      if (!isCandidateEntryOpen(settings, session.examId, exam || undefined, session.examSlot)) {
        console.warn(`[Gate] BLOCK sync cid=${candidateId} status=${session.status} examId=${session.examId} active=${settings.activeExamId} date=${exam?.examDate} ${exam?.examTime || ''}`);
        return jsonResponse({ error: ENTRY_NOT_OPEN_ERROR, code: 'EXAM_NOT_OPEN', detail: { status: session.status, examId: session.examId } }, 403, request, env);
      }
    }
    const body = await request.json().catch(() => ({}));
    const { status, currentSection, listeningState, readingState, writingState } = body;

    // Security check: Candidate cannot tamper with locked state or finalized scores
    if (status && session.status !== 'hard_locked' && ['registered', 'in_progress', 'completed'].includes(status)) {
      session.status = status;
    }
    if (currentSection && ['listening', 'reading', 'writing', 'review'].includes(currentSection)) {
      session.currentSection = currentSection;
    }
    if (listeningState && typeof listeningState === 'object') {
      session.listeningState = {
        ...session.listeningState,
        answers: { ...session.listeningState.answers, ...(listeningState.answers || {}) },
        bufferedPercent: typeof listeningState.bufferedPercent === 'number' ? listeningState.bufferedPercent : session.listeningState.bufferedPercent,
        audioPlayed: Boolean(listeningState.audioPlayed ?? session.listeningState.audioPlayed),
        reviewTimerRemaining: typeof listeningState.reviewTimerRemaining === 'number' ? listeningState.reviewTimerRemaining : session.listeningState.reviewTimerRemaining,
        highlights: Array.isArray(listeningState.highlights) ? listeningState.highlights : (session.listeningState.highlights || []),
        audioPositionSeconds: typeof listeningState.audioPositionSeconds === 'number' ? Math.max(0, Math.floor(listeningState.audioPositionSeconds)) : (session.listeningState.audioPositionSeconds || 0)
      };
    }
    if (readingState && typeof readingState === 'object') {
      session.readingState = {
        ...session.readingState,
        answers: { ...session.readingState.answers, ...(readingState.answers || {}) },
        timeRemainingSeconds: typeof readingState.timeRemainingSeconds === 'number' ? readingState.timeRemainingSeconds : session.readingState.timeRemainingSeconds,
        highlights: Array.isArray(readingState.highlights) ? readingState.highlights : session.readingState.highlights
      };
    }
    if (writingState && typeof writingState === 'object') {
      session.writingState = {
        ...session.writingState,
        task1Response: typeof writingState.task1Response === 'string' ? writingState.task1Response : session.writingState.task1Response,
        task2Response: typeof writingState.task2Response === 'string' ? writingState.task2Response : session.writingState.task2Response,
        timeRemainingSeconds: typeof writingState.timeRemainingSeconds === 'number' ? writingState.timeRemainingSeconds : session.writingState.timeRemainingSeconds
      };
    }

    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 21. Lock violation (Candidate reporting)
  const lockMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/lock-violation$/);
  if (lockMatch && method === 'POST') {
    const candidateId = decodeURIComponent(lockMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'Focus lost / window defocus detected';

    session.lockStatus.violations += 1;
    session.lockStatus.lockHistory.push({ timestamp: new Date().toISOString(), reason });

    if (session.lockStatus.violations >= 2) {
      session.lockStatus.isLocked = true;
      session.lockStatus.lockReason = `HARD LOCK: 2 integrity violations recorded. Unauthorized window or tab switch detected.`;
      session.status = 'hard_locked';
    } else {
      session.lockStatus.lockReason = `Warning: Candidate navigated away from exam screen.`;
    }
    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session, isHardLocked: session.lockStatus.isLocked }, 200, request, env);
  }

  // 22. Reset lock / Reset session (Admin)
  const resetLockMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/(?:reset-lock|reset-session)$/);
  if (resetLockMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(resetLockMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    session.lockStatus.isLocked = false;
    session.lockStatus.violations = 0;
    session.lockStatus.lockReason = undefined;
    session.lockStatus.lockHistory.push({
      timestamp: new Date().toISOString(),
      reason: `Admin (${auth.username || 'proctor'}) manually reset exam session lockdown.`
    });
    if (session.status === 'hard_locked') session.status = 'in_progress';
    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, message: `Session ${session.candidateId} reset successfully.`, session }, 200, request, env);
  }

  // 23. Submit section (Candidate-scoped authoritative grading)
  const submitSectionMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/submit-section$/);
  if (submitSectionMatch && method === 'POST') {
    const candidateId = decodeURIComponent(submitSectionMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const body = await request.json().catch(() => ({}));
    const sectionName = body.section;
    const exam = (session.examId ? await storage.getExam(session.examId) : undefined) || defaultExam;
    // Entry gate: only sessions that never started wait. Section submits
    // and re-submits are idempotent — never block them.
    if (isUnstartedSession(session)) {
      const gateSettings = await storage.getSettings().catch(() => ({} as SystemSettings));
      if (!isCandidateEntryOpen(gateSettings, session.examId, exam, session.examSlot)) {
        console.warn(`[Gate] BLOCK submit-section cid=${candidateId} status=${session.status} examId=${session.examId} active=${gateSettings.activeExamId}`);
        return jsonResponse({ error: ENTRY_NOT_OPEN_ERROR, code: 'EXAM_NOT_OPEN', detail: { status: session.status, examId: session.examId } }, 403, request, env);
      }
    }

    if (sectionName === 'listening') {
      session.grading.listeningScore = gradeListening(session, exam);
      session.currentSection = 'reading';
      session.listeningState.completed = true;
    } else if (sectionName === 'reading') {
      session.grading.readingScore = gradeReading(session, exam);
      session.currentSection = 'writing';
      session.readingState.completed = true;
    } else if (sectionName === 'writing') {
      session.writingState.completed = true;
      session.currentSection = 'review';
      session.status = 'completed';
    }
    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 24. AI Writing Evaluation (Admin Examiner operation).
  // Requires GEMINI_API_KEY. Any AI failure is reported as an error —
  // there is no silent fallback. Output is always a DRAFT — the overall band
  // still requires human examiner confirmation + admin finalize.
  const aiWritingMatch = pathname.match(/^\/api\/(?:sessions|grading)\/([^\/]+)\/writing-ai$/);
  if (aiWritingMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(aiWritingMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);

    const apiKey = (env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return jsonResponse({
        success: false,
        error: 'AI evaluation is not configured: GEMINI_API_KEY is missing on the server.'
      }, 503, request, env);
    }

    const t1 = session.writingState.task1Response || '';
    const t2 = session.writingState.task2Response || '';
    if (!t1.trim() && !t2.trim()) {
      return jsonResponse({
        success: false,
        error: 'Nothing to grade: both writing responses are empty.'
      }, 400, request, env);
    }
    const exam = (session.examId ? await storage.getExam(session.examId) : undefined) || defaultExam;

    try {
      const evaluation = await geminiWritingEvaluation(
        apiKey,
        (env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
        exam.writing.task1.prompt,
        exam.writing.task2.prompt,
        t1,
        t2
      );
      session.grading.writingAiEvaluation = evaluation;
      session.lastSavedAt = new Date().toISOString();
      await storage.saveSession(session);
      return jsonResponse({ success: true, provider: 'gemini', aiEvaluation: evaluation }, 200, request, env);
    } catch (e: any) {
      console.error('Gemini evaluation failed:', e?.message || e);
      return jsonResponse({
        success: false,
        error: `AI evaluation failed: ${e?.message || 'the AI service did not return a usable grading. Please try again shortly.'}`
      }, 502, request, env);
    }
  }

  // 25. Finalize Writing Scores (Admin Examiner)
  const finalizeWritingMatch = pathname.match(/^\/api\/(?:sessions\/([^\/]+)\/finalize-writing-admin|grading\/([^\/]+)\/writing)$/);
  if (finalizeWritingMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(finalizeWritingMatch[1] || finalizeWritingMatch[2]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const body = await request.json().catch(() => ({}));

    // Authoritative score range validation (0.0 to 9.0)
    const validBand = (val: any, fallback: number) => {
      const num = Number(val);
      return !isNaN(num) && num >= 0 && num <= 9 ? Math.round(num * 2) / 2 : fallback;
    };

    const overallBand = validBand(body.overallBand, 7.0);
    const t1 = body.task1Band || {};
    const t2 = body.task2Band || {};

    session.grading.writingAdminEvaluation = {
      task1Band: {
        ta_tr: validBand(t1.ta_tr, 7.0),
        cc: validBand(t1.cc, 7.0),
        lr: validBand(t1.lr, 7.0),
        gra: validBand(t1.gra, 7.0),
        overall: validBand(t1.overall, 7.0)
      },
      task2Band: {
        ta_tr: validBand(t2.ta_tr, 7.0),
        cc: validBand(t2.cc, 7.0),
        lr: validBand(t2.lr, 7.0),
        gra: validBand(t2.gra, 7.0),
        overall: validBand(t2.overall, 7.0)
      },
      overallBand,
      comments: Array.isArray(body.comments) ? body.comments : [],
      adminFeedback: typeof body.adminFeedback === 'string' ? body.adminFeedback : 'Approved by Admin Examiner.',
      examinerFeedback: typeof body.examinerFeedback === 'string' ? body.examinerFeedback : undefined,
      isFinalized: true,
      finalizedAt: new Date().toISOString(),
      finalizedBy: typeof body.finalizedBy === 'string' ? body.finalizedBy : (auth.username || 'Admin Senior Examiner')
    };

    // A corrected writing band must immediately refresh the overall.
    recomputeOverallFromCurrentBands(session);

    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 26. Grade Speaking (Admin Examiner)
  const speakingMatch = pathname.match(/^\/api\/(?:sessions\/([^\/]+)\/grade-speaking|grading\/([^\/]+)\/speaking)$/);
  if (speakingMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(speakingMatch[1] || speakingMatch[2]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const body = await request.json().catch(() => ({}));

    const validBand = (val: any, fallback: number) => {
      const num = Number(val);
      return !isNaN(num) && num >= 0 && num <= 9 ? Math.round(num * 2) / 2 : fallback;
    };

    const fluency = validBand(body.fluency, 7.0);
    const lexical = validBand(body.lexical, 7.0);
    const grammar = validBand(body.grammar, 7.0);
    const pronunciation = validBand(body.pronunciation, 7.0);
    const overallBand = validBand(body.overallBand, Math.round(((fluency + lexical + grammar + pronunciation) / 4) * 2) / 2);

    session.grading.speakingEvaluation = {
      fluency,
      lexical,
      grammar,
      pronunciation,
      overallBand,
      examinerNotes: typeof body.examinerNotes === 'string' ? body.examinerNotes : 'Speaking test concluded according to official IELTS standards.',
      conductedAt: new Date().toISOString(),
      evaluatedAt: new Date().toISOString(),
      // Examiner-typed part questions: sanitized free text (absent = preserve).
      ...(() => {
        const prev = session.grading.speakingEvaluation;
        const clean = (v: any) => typeof v === 'string' ? v.slice(0, 2000) : '';
        if (body.partQuestions && typeof body.partQuestions === 'object') {
          return {
            partQuestions: {
              part1: clean(body.partQuestions.part1),
              part2: clean(body.partQuestions.part2),
              part3: clean(body.partQuestions.part3)
            }
          };
        }
        if (prev?.partQuestions) return { partQuestions: prev.partQuestions };
        return {};
      })(),
      // Voice memo linkage: only recordings stored under speaking/ are
      // accepted. Absent key = preserve existing; explicit null = detach.
      ...(() => {
        const prev = session.grading.speakingEvaluation;
        if (typeof body.audioUrl === 'string' && body.audioUrl.startsWith('/api/files/speaking/')) {
          return {
            audioUrl: body.audioUrl,
            audioRecordedAt: typeof body.audioRecordedAt === 'string' ? body.audioRecordedAt : new Date().toISOString()
          };
        }
        if (body.audioUrl === null || body.audioUrl === '') return {};
        if (prev?.audioUrl) return { audioUrl: prev.audioUrl, audioRecordedAt: prev.audioRecordedAt };
        return {};
      })()
    };
    // A corrected speaking band must immediately refresh the overall.
    recomputeOverallFromCurrentBands(session);
    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 27. Override Question (Admin)
  const overrideMatch = pathname.match(/^\/api\/(?:sessions\/([^\/]+)\/manual-override-question|grading\/([^\/]+)\/override-question)$/);
  if (overrideMatch && method === 'POST') {
    const auth = await requireAdmin(request, storage, env);
    if (!auth.authorized) return auth.errorResponse!;

    const candidateId = decodeURIComponent(overrideMatch[1] || overrideMatch[2]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const { module, questionId, isCorrect } = await request.json().catch(() => ({}));
    if (!module || !questionId || typeof isCorrect !== 'boolean') {
      return jsonResponse({ success: false, error: 'Valid module, questionId, and isCorrect boolean required' }, 400, request, env);
    }

    const exam = (session.examId ? await storage.getExam(session.examId) : undefined) || defaultExam;

    if (module === 'listening') {
      if (!session.grading.listeningScore) session.grading.listeningScore = gradeListening(session, exam);
      if (!session.grading.listeningScore.overrides) session.grading.listeningScore.overrides = {};
      session.grading.listeningScore.overrides[questionId] = isCorrect;
      session.grading.listeningScore = gradeListening(session, exam);
    } else if (module === 'reading') {
      if (!session.grading.readingScore) session.grading.readingScore = gradeReading(session, exam);
      if (!session.grading.readingScore.overrides) session.grading.readingScore.overrides = {};
      session.grading.readingScore.overrides[questionId] = isCorrect;
      session.grading.readingScore = gradeReading(session, exam);
    }

    // Refresh the overall from current bands (no stale defaults).
    recomputeOverallFromCurrentBands(session);

    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, session }, 200, request, env);
  }

  // 28. Submit (student) vs Finalize (admin). Student submit marks the exam
  // completed and auto-grades Listening/Reading, but NEVER certifies the
  // overall band. Certification happens only via an explicit admin finalize
  // once BOTH human examiner confirmations (writing + speaking) exist.
  const finalizeExamMatch = pathname.match(/^\/api\/sessions\/([^\/]+)\/(?:finalize-exam|submit)$/);
  if (finalizeExamMatch && method === 'POST') {
    const candidateId = decodeURIComponent(finalizeExamMatch[1]);
    const session = await storage.getSession(candidateId);
    if (!session) return jsonResponse({ error: 'Session not found' }, 404, request, env);
    const exam = (session.examId ? await storage.getExam(session.examId) : undefined) || defaultExam;

    if (!session.grading.listeningScore) {
      session.grading.listeningScore = gradeListening(session, exam);
    }
    if (!session.grading.readingScore) {
      session.grading.readingScore = gradeReading(session, exam);
    }
    session.writingState.completed = true;
    session.currentSection = 'review';
    session.status = 'completed';

    const admin = await requireAdmin(request, storage, env);
    if (admin.authorized) {
      const missing: string[] = [];
      if (!session.grading.listeningScore) missing.push('listening');
      if (!session.grading.readingScore) missing.push('reading');
      if (!session.grading.writingAdminEvaluation) missing.push('writing (examiner confirmation required)');
      if (!session.grading.speakingEvaluation) missing.push('speaking (examiner confirmation required)');
      if (missing.length > 0) {
        session.lastSavedAt = new Date().toISOString();
        await storage.saveSession(session);
        return jsonResponse({
          success: false,
          error: 'Cannot finalize: examiner confirmations are still pending.',
          missing
        }, 400, request, env);
      }
      // All four bands are guaranteed present by the missing-check above.
      recomputeOverallFromCurrentBands(session);
      session.grading.isFinalized = true;
      session.grading.finalizedAt = session.grading.finalizedAt || new Date().toISOString();

      session.lastSavedAt = new Date().toISOString();
      await storage.saveSession(session);
      return jsonResponse({ success: true, finalized: true, session }, 200, request, env);
    }

    // Student submit path: only sessions that never started wait — a
    // candidate handing in (or re-handing in) finished work is never turned
    // away, even if the admin re-dated or switched exams meanwhile. The
    // overall stays uncertified until admin finalizes.
    if (isUnstartedSession(session)) {
      const studentGateSettings = await storage.getSettings().catch(() => ({} as SystemSettings));
      if (!isCandidateEntryOpen(studentGateSettings, session.examId, exam, session.examSlot)) {
        console.warn(`[Gate] BLOCK submit cid=${candidateId} status=${session.status} examId=${session.examId} active=${studentGateSettings.activeExamId} date=${exam?.examDate} ${exam?.examTime || ''}`);
        return jsonResponse({ error: ENTRY_NOT_OPEN_ERROR, code: 'EXAM_NOT_OPEN', detail: { status: session.status, examId: session.examId } }, 403, request, env);
      }
    }
    console.log(`[Submit] ok cid=${candidateId} status=${session.status} examId=${session.examId}`);
    session.lastSavedAt = new Date().toISOString();
    await storage.saveSession(session);
    return jsonResponse({ success: true, finalized: false, session }, 200, request, env);
  }

  // 29. Public Verification (Phases 9 & 10: Strict Privacy Protection - No National ID / First Language PII)
  const verifyMatch = pathname.match(/^\/api\/verify\/([^\/]+)$/);
  if (verifyMatch && method === 'GET') {
    const rawId = decodeURIComponent(verifyMatch[1]).toUpperCase().trim();
    const digits = rawId.replace(/[^0-9]/g, '');

    const allSessions = await storage.getSessions();
    const session = allSessions.find(s => {
      const sCid = s.candidateId.toUpperCase().trim();
      const sTrf = (s.trfNumber || '').toUpperCase().trim();
      const sDigits = sCid.replace(/[^0-9]/g, '');
      return sCid === rawId || sTrf === rawId || (digits.length >= 4 && (sDigits === digits || sTrf.includes(digits)));
    });

    // Overall is certified only with BOTH human examiner confirmations.
    const writingConfirmed = session?.grading.writingAdminEvaluation &&
      typeof session.grading.writingAdminEvaluation.overallBand === 'number';
    const speakingConfirmed = session?.grading.speakingEvaluation &&
      typeof session.grading.speakingEvaluation.overallBand === 'number';
    if (!session || !session.grading.isFinalized || !writingConfirmed || !speakingConfirmed ||
        typeof session.grading.finalOverallBand !== 'number') {
      return jsonResponse({
        verified: false,
        message: 'No verified official Test Report Form found for the supplied identifier.'
      }, 404, request, env);
    }

    // Two-slot exams: results stay unpublished until the paper is released
    // (after the second session ends, or via admin release).
    if (session.examId) {
      const paperExam = await storage.getExam(session.examId).catch(() => undefined);
      if (paperExam && !isExamPaperReleased(paperExam)) {
        return jsonResponse({
          verified: false,
          message: 'Results for this exam day are not published yet. Please check back after all sessions finish.'
        }, 404, request, env);
      }
    }

    // Official Certified TRF Verification record: exposes only certified results, strictly omits PII
    return jsonResponse({
      verified: true,
      candidateId: session.candidateId,
      trfNumber: session.trfNumber,
      candidateName: session.candidateName,
      candidatePhotoUrl: session.candidatePhotoUrl,
      examTitle: session.examTitle,
      testDate: session.grading.finalizedAt || session.createdAt,
      testCenter: session.centreNumber || 'AZ001 - Baku Official IELTS Test Center',
      schemeCode: session.schemeCode || 'Academic Standard',
      scores: {
        listening: session.grading.listeningScore?.band,
        reading: session.grading.readingScore?.band,
        writing: session.grading.writingAdminEvaluation?.overallBand,
        speaking: session.grading.speakingEvaluation?.overallBand,
        overall: session.grading.finalOverallBand,
        overallBand: session.grading.finalOverallBand,
        cefr: session.grading.cefrLevel,
        cefrLevel: session.grading.cefrLevel
      }
    }, 200, request, env);
  }

      return jsonResponse({ error: `Not found: ${method} ${pathname}` }, 404);
    } catch (err: any) {
      console.error('[API Handler Error]:', err);
      return jsonResponse({
        success: false,
        error: 'Database / Server Error',
        message: err?.message || 'Database operation failed.',
        status: 500
      }, 500);
    }
  }
