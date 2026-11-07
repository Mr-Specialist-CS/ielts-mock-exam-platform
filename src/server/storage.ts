// Storage abstraction layer: supports both In-Memory (Node.js dev) and Cloudflare D1 (Edge serverless)
import { CandidateSession, Exam, ExamRegistrationRequest, SystemSettings } from '../types';
import { defaultExam } from '../data/sampleExam';
import { initialCandidateSessions } from '../data/initialCandidates';

export interface AdminTokenRecord {
  token: string;
  username: string;
  createdAt: number;
}

export interface LoginAttemptTracker {
  count: number;
  lockedUntil: number;
}

export interface FileMetadataRecord {
  key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  isPrivate: boolean;
  uploadedAt: string;
}

export interface StorageStats {
  exams: number;
  sessions: number;
  registrations: number;
  files: number;
  r2Bytes: number;
}

export interface IStorage {
  getExams(): Promise<Exam[]>;
  getExam(id: string): Promise<Exam | undefined>;
  saveExam(exam: Exam): Promise<void>;
  deleteExam(id: string): Promise<void>;

  getSessions(): Promise<CandidateSession[]>;
  getSession(rawId: string): Promise<CandidateSession | undefined>;
  saveSession(session: CandidateSession): Promise<void>;
  deleteSession(candidateId: string): Promise<void>;

  getRegistrations(): Promise<ExamRegistrationRequest[]>;
  getRegistration(idOrQuery: string): Promise<ExamRegistrationRequest | undefined>;
  saveRegistration(reg: ExamRegistrationRequest): Promise<void>;
  deleteRegistration(id: string): Promise<void>;

  saveFileMetadata(rec: FileMetadataRecord): Promise<void>;
  deleteFileMetadata(key: string): Promise<void>;
  listFileMetadata(): Promise<FileMetadataRecord[]>;
  getStorageStats(): Promise<StorageStats>;

  getAdminToken(token: string): Promise<AdminTokenRecord | undefined>;
  saveAdminToken(token: string, record: AdminTokenRecord): Promise<void>;
  deleteAdminToken(token: string): Promise<void>;

  getRateLimit(ip: string): Promise<LoginAttemptTracker | undefined>;
  saveRateLimit(ip: string, tracker: LoginAttemptTracker): Promise<void>;
  clearRateLimit(ip: string): Promise<void>;

  getSettings(): Promise<SystemSettings>;
  saveSettings(settings: SystemSettings): Promise<void>;
}

// In-Memory Storage implementation (for Node.js runtime and local fallback)
export class MemoryStorage implements IStorage {
  private exams: Record<string, Exam> = {};
  private sessions: Record<string, CandidateSession> = {};
  private registrationRequests: Record<string, ExamRegistrationRequest> = {};
  private adminTokens = new Map<string, AdminTokenRecord>();
  private rateLimits = new Map<string, LoginAttemptTracker>();
  private settings: SystemSettings = {
    isConfigured: false
  };

  constructor(seedDemo = false) {
    this.exams[defaultExam.id] = JSON.parse(JSON.stringify(defaultExam));
    if (seedDemo) {
      initialCandidateSessions.forEach(sess => {
        this.registerSessionAliases(JSON.parse(JSON.stringify(sess)));
      });
    }
  }

  private registerSessionAliases(sess: CandidateSession) {
    const cid = sess.candidateId.toUpperCase().trim();
    const digits = cid.replace(/[^0-9]/g, '');
    this.sessions[cid] = sess;
    if (digits) {
      this.sessions[`IG-${digits}`] = sess;
      this.sessions[`IG${digits}`] = sess;
      this.sessions[digits] = sess;
      this.sessions[`CAND-${digits}`] = sess;
    }
  }

  async getExams(): Promise<Exam[]> {
    const list = Object.values(this.exams);
    const seen = new Set<string>();
    return list.filter(e => {
      if (!e || !e.id || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  async getExam(id: string): Promise<Exam | undefined> {
    // Strict: no silent fallback to the default exam. Callers that want a
    // fallback apply `|| defaultExam` themselves. (The old fallback resurrected
    // deleted exams: GET /api/exams/:deletedId kept returning the default exam.)
    return this.exams[id] || (id === 'mock-ielts-academic-01' ? this.exams[defaultExam.id] : undefined);
  }

  async saveExam(exam: Exam): Promise<void> {
    this.exams[exam.id] = exam;
  }

  async deleteExam(id: string): Promise<void> {
    delete this.exams[id];
  }

  async getSessions(): Promise<CandidateSession[]> {
    const uniqueMap = new Map<string, CandidateSession>();
    Object.values(this.sessions).forEach(s => {
      if (s && s.candidateId) uniqueMap.set(s.candidateId, s);
    });
    return Array.from(uniqueMap.values());
  }

  async getSession(rawId: string): Promise<CandidateSession | undefined> {
    if (!rawId) return undefined;
    const clean = rawId.toUpperCase().trim();
    if (this.sessions[clean]) return this.sessions[clean];

    const digits = clean.replace(/[^0-9]/g, '');
    if (digits) {
      if (this.sessions[`IG-${digits}`]) return this.sessions[`IG-${digits}`];
      if (this.sessions[`IG${digits}`]) return this.sessions[`IG${digits}`];
      if (this.sessions[digits]) return this.sessions[digits];
      if (this.sessions[`CAND-${digits}`]) return this.sessions[`CAND-${digits}`];
    }

    const withoutPrefix = clean.replace(/^(IG-|IG|CAND-)/, '');
    if (this.sessions[withoutPrefix]) return this.sessions[withoutPrefix];

    return Object.values(this.sessions).find(s => {
      const sCid = s.candidateId.toUpperCase().trim();
      const sDigits = sCid.replace(/[^0-9]/g, '');
      return sCid === clean || (digits && sDigits === digits);
    });
  }

  async saveSession(session: CandidateSession): Promise<void> {
    this.registerSessionAliases(session);
  }

  async getRegistrations(): Promise<ExamRegistrationRequest[]> {
    return Object.values(this.registrationRequests).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  async getRegistration(query: string): Promise<ExamRegistrationRequest | undefined> {
    const rawId = query.trim().toUpperCase();
    const cleanDigits = rawId.replace(/[^0-9]/g, '');

    return (
      this.registrationRequests[rawId] ||
      this.registrationRequests[`REG-${cleanDigits}`] ||
      Object.values(this.registrationRequests).find(
        r =>
          r.id.toUpperCase() === rawId ||
          r.email.toLowerCase() === rawId.toLowerCase() ||
          r.phone.replace(/[^0-9]/g, '') === rawId.replace(/[^0-9]/g, '')
      )
    );
  }

  async saveRegistration(reg: ExamRegistrationRequest): Promise<void> {
    this.registrationRequests[reg.id] = reg;
  }

  async deleteSession(candidateId: string): Promise<void> {
    const clean = candidateId.toUpperCase().trim();
    Object.keys(this.sessions).forEach(k => {
      if (k === clean || this.sessions[k]?.candidateId.toUpperCase().trim() === clean) {
        delete this.sessions[k];
      }
    });
  }

  async deleteRegistration(id: string): Promise<void> {
    delete this.registrationRequests[id];
  }

  private fileMetadata = new Map<string, FileMetadataRecord>();

  async saveFileMetadata(rec: FileMetadataRecord): Promise<void> {
    this.fileMetadata.set(rec.key, rec);
  }

  async deleteFileMetadata(key: string): Promise<void> {
    this.fileMetadata.delete(key);
  }

  async listFileMetadata(): Promise<FileMetadataRecord[]> {
    return Array.from(this.fileMetadata.values());
  }

  async getStorageStats(): Promise<StorageStats> {
    const sessions = await this.getSessions();
    let r2Bytes = 0;
    this.fileMetadata.forEach(f => { r2Bytes += f.fileSize || 0; });
    return {
      exams: Object.keys(this.exams).length,
      sessions: sessions.length,
      registrations: Object.keys(this.registrationRequests).length,
      files: this.fileMetadata.size,
      r2Bytes
    };
  }

  async getAdminToken(token: string): Promise<AdminTokenRecord | undefined> {
    const rec = this.adminTokens.get(token);
    if (!rec) return undefined;
    if (Date.now() - rec.createdAt > 24 * 60 * 60 * 1000) {
      this.adminTokens.delete(token);
      return undefined;
    }
    return rec;
  }

  async saveAdminToken(token: string, record: AdminTokenRecord): Promise<void> {
    this.adminTokens.set(token, record);
  }

  async deleteAdminToken(token: string): Promise<void> {
    this.adminTokens.delete(token);
  }

  async getRateLimit(ip: string): Promise<LoginAttemptTracker | undefined> {
    return this.rateLimits.get(ip);
  }

  async saveRateLimit(ip: string, tracker: LoginAttemptTracker): Promise<void> {
    this.rateLimits.set(ip, tracker);
  }

  async clearRateLimit(ip: string): Promise<void> {
    this.rateLimits.delete(ip);
  }

  async getSettings(): Promise<SystemSettings> {
    return { ...this.settings };
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    this.settings = { ...settings, isConfigured: true };
  }
}

// Cloudflare D1 Storage Implementation (used automatically when env.DB binding is present)
export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: any[]): {
      all<T = any>(): Promise<{ results: T[]; success: boolean }>;
      first<T = any>(colName?: string): Promise<T | null>;
      run(): Promise<{ success: boolean }>;
    };
    all?<T = any>(): Promise<{ results: T[]; success: boolean }>;
    first?<T = any>(colName?: string): Promise<T | null>;
    run?(): Promise<{ success: boolean }>;
  };
  exec?(query: string): Promise<any>;
}

export class D1Storage implements IStorage {
  private d1: D1DatabaseLike;
  private env?: Record<string, any>;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(d1: D1DatabaseLike, env?: Record<string, any>) {
    this.d1 = d1;
    this.env = env;
    this.ensureInitialized().catch(err => {
      console.error('[Cloudflare D1 Initialization Error]:', err?.message || err);
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.initPromise) {
      this.initPromise = this.ensureTablesAndSeed();
    }
    await this.initPromise;
  }

  private async ensureTablesAndSeed(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      // 1. Check if tables are already in place
      let tablesNeedCreation = false;

      try {
        const checkStmt = this.d1.prepare('SELECT count(*) as count FROM exams');
        if (typeof checkStmt.first === 'function') {
          await checkStmt.first<{ count: number }>();
        } else {
          await checkStmt.bind().first<{ count: number }>();
        }
      } catch {
        tablesNeedCreation = true;
      }

      // 2. If tables are missing, create all required tables & indexes
      if (tablesNeedCreation) {
        const tableSqls = [
          `CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'academic', description TEXT, centreNumber TEXT, data TEXT NOT NULL, updatedAt TEXT NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS sessions (candidateId TEXT PRIMARY KEY, examId TEXT NOT NULL, candidateName TEXT NOT NULL, currentSection TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updatedAt TEXT NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, candidateName TEXT NOT NULL, phone TEXT, email TEXT, examId TEXT, amountAzn REAL DEFAULT 45, status TEXT DEFAULT 'pending', data TEXT NOT NULL, submittedAt TEXT NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS admin_tokens (token TEXT PRIMARY KEY, username TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS rate_limits (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, lockedUntil INTEGER NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS file_metadata (key TEXT PRIMARY KEY, fileName TEXT NOT NULL, fileType TEXT NOT NULL, fileSize INTEGER NOT NULL, isPrivate INTEGER DEFAULT 0, uploadedAt TEXT NOT NULL);`,
          `CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
        ];

        let execDone = false;
        if (this.d1.exec) {
          try {
            await this.d1.exec(tableSqls.join('\n'));
            execDone = true;
          } catch {
            execDone = false;
          }
        }

        if (!execDone) {
          for (const sql of tableSqls) {
            try {
              const prep = this.d1.prepare(sql);
              if (typeof prep.run === 'function') {
                await prep.run();
              } else if (typeof prep.bind === 'function') {
                await prep.bind().run();
              }
            } catch {}
          }
        }

        const indexSqls = [
          `CREATE INDEX IF NOT EXISTS idx_sessions_examId ON sessions(examId);`,
          `CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);`,
          `CREATE INDEX IF NOT EXISTS idx_admin_tokens_expiresAt ON admin_tokens(expiresAt);`,
          `CREATE INDEX IF NOT EXISTS idx_rate_limits_lockedUntil ON rate_limits(lockedUntil);`
        ];
        for (const idx of indexSqls) {
          try {
            const prep = this.d1.prepare(idx);
            if (typeof prep.run === 'function') {
              await prep.run();
            } else if (typeof prep.bind === 'function') {
              await prep.bind().run();
            }
          } catch {}
        }
      }

      // 3. Empty catalogs stay empty. (A previous version re-seeded the
      // default exam whenever the table was empty, which resurrected exams
      // right after an admin deleted the last one.)
    } catch (err: any) {
      console.error('[Cloudflare D1 Schema Verification Error]:', err?.message || err);
    }
  }

  async getExams(): Promise<Exam[]> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT data FROM exams ORDER BY updatedAt DESC');
      const res = await stmt.bind().all<{ data: string }>();
      if (res.results && res.results.length > 0) {
        return res.results.map(r => JSON.parse(r.data));
      }
      return [];
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query exams table - ${e?.message || e}`);
    }
  }

  async getExam(id: string): Promise<Exam | undefined> {
    try {
      const stmt = this.d1.prepare('SELECT data FROM exams WHERE id = ?');
      const res = await stmt.bind(id).first<{ data: string }>();
      if (res?.data) {
        return JSON.parse(res.data);
      }
      return undefined;
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query exam ${id} - ${e?.message || e}`);
    }
  }

  async saveExam(exam: Exam): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO exams (id, code, title, type, description, centreNumber, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      await stmt.bind(
        exam.id,
        exam.code || '',
        exam.title || '',
        exam.type || 'academic',
        exam.description || '',
        exam.centreNumber || '',
        JSON.stringify(exam),
        new Date().toISOString()
      ).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save exam ${exam.id} - ${e?.message || e}`);
    }
  }

  async deleteExam(id: string): Promise<void> {
    try {
      const stmt = this.d1.prepare('DELETE FROM exams WHERE id = ?');
      await stmt.bind(id).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to delete exam ${id} - ${e?.message || e}`);
    }
  }

  async getSessions(): Promise<CandidateSession[]> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT data FROM sessions ORDER BY updatedAt DESC');
      const res = await stmt.bind().all<{ data: string }>();
      if (res.results && res.results.length > 0) {
        return res.results.map(r => JSON.parse(r.data));
      }
      return [];
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query candidate sessions - ${e?.message || e}`);
    }
  }

  async getSession(rawId: string): Promise<CandidateSession | undefined> {
    await this.ensureInitialized().catch(() => {});
    const clean = rawId.toUpperCase().trim();
    const digits = clean.replace(/[^0-9]/g, '');
    // Strict exact-ID match only: the digit sequence must be IDENTICAL.
    // (A previous LIKE '%digits%' query let IG-34567 open IG-345678's session.)
    const keys = [clean];
    if (digits) {
      keys.push(`IG-${digits}`, `IG${digits}`, digits, `CAND-${digits}`);
    }
    try {
      const placeholders = keys.map(() => '?').join(',');
      const stmt = this.d1.prepare(`SELECT data FROM sessions WHERE UPPER(candidateId) IN (${placeholders})`);
      const res = await stmt.bind(...keys).first<{ data: string }>();
      if (res?.data) return JSON.parse(res.data);
      return undefined;
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query session for ${rawId} - ${e?.message || e}`);
    }
  }

  async saveSession(session: CandidateSession): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO sessions (candidateId, examId, candidateName, currentSection, status, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      await stmt.bind(
        session.candidateId,
        session.examId || '',
        session.candidateName || '',
        session.currentSection || 'listening',
        session.status || 'registered',
        JSON.stringify(session),
        new Date().toISOString()
      ).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save session for ${session.candidateId} - ${e?.message || e}`);
    }
  }

  async getRegistrations(): Promise<ExamRegistrationRequest[]> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT data FROM registrations ORDER BY submittedAt DESC');
      const res = await stmt.bind().all<{ data: string }>();
      if (res.results && res.results.length > 0) {
        return res.results.map(r => JSON.parse(r.data));
      }
      return [];
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query registrations - ${e?.message || e}`);
    }
  }

  async getRegistration(query: string): Promise<ExamRegistrationRequest | undefined> {
    const clean = query.trim().toUpperCase();
    try {
      const stmt = this.d1.prepare('SELECT data FROM registrations WHERE UPPER(id) = ? OR UPPER(email) = ? OR phone LIKE ?');
      const res = await stmt.bind(clean, clean, `%${clean}%`).first<{ data: string }>();
      if (res?.data) return JSON.parse(res.data);
      return undefined;
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query registration for ${query} - ${e?.message || e}`);
    }
  }

  async saveRegistration(reg: ExamRegistrationRequest): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO registrations (id, candidateName, phone, email, examId, amountAzn, status, data, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      await stmt.bind(
        reg.id,
        reg.candidateName || '',
        reg.phone || '',
        reg.email || '',
        reg.examId || '',
        reg.amountAzn || 45,
        reg.status || 'pending',
        JSON.stringify(reg),
        reg.submittedAt || new Date().toISOString()
      ).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save registration ${reg.id} - ${e?.message || e}`);
    }
  }

  async deleteSession(candidateId: string): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('DELETE FROM sessions WHERE UPPER(candidateId) = ?');
      await stmt.bind(candidateId.toUpperCase().trim()).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to delete session ${candidateId} - ${e?.message || e}`);
    }
  }

  async deleteRegistration(id: string): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('DELETE FROM registrations WHERE id = ?');
      await stmt.bind(id).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to delete registration ${id} - ${e?.message || e}`);
    }
  }

  async saveFileMetadata(rec: FileMetadataRecord): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO file_metadata (key, fileName, fileType, fileSize, isPrivate, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)'
      );
      await stmt.bind(rec.key, rec.fileName, rec.fileType, rec.fileSize || 0, rec.isPrivate ? 1 : 0, rec.uploadedAt).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save file metadata ${rec.key} - ${e?.message || e}`);
    }
  }

  async deleteFileMetadata(key: string): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('DELETE FROM file_metadata WHERE key = ?');
      await stmt.bind(key).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to delete file metadata ${key} - ${e?.message || e}`);
    }
  }

  async listFileMetadata(): Promise<FileMetadataRecord[]> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT key, fileName, fileType, fileSize, isPrivate, uploadedAt FROM file_metadata');
      const res = await stmt.bind().all<any>();
      return (res.results || []).map(r => ({
        key: String(r.key),
        fileName: String(r.fileName || ''),
        fileType: String(r.fileType || ''),
        fileSize: Number(r.fileSize || 0),
        isPrivate: Number(r.isPrivate || 0) === 1,
        uploadedAt: String(r.uploadedAt || '')
      }));
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to list file metadata - ${e?.message || e}`);
    }
  }

  async getStorageStats(): Promise<StorageStats> {
    await this.ensureInitialized().catch(() => {});
    try {
      const counts = await Promise.all([
        this.d1.prepare('SELECT COUNT(*) as c FROM exams').bind().first<{ c: number }>(),
        this.d1.prepare('SELECT COUNT(*) as c FROM sessions').bind().first<{ c: number }>(),
        this.d1.prepare('SELECT COUNT(*) as c FROM registrations').bind().first<{ c: number }>(),
        this.d1.prepare('SELECT COUNT(*) as c, COALESCE(SUM(fileSize), 0) as s FROM file_metadata').bind().first<{ c: number; s: number }>()
      ]);
      return {
        exams: Number(counts[0]?.c || 0),
        sessions: Number(counts[1]?.c || 0),
        registrations: Number(counts[2]?.c || 0),
        files: Number(counts[3]?.c || 0),
        r2Bytes: Number(counts[3]?.s || 0)
      };
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query storage stats - ${e?.message || e}`);
    }
  }

  async getAdminToken(token: string): Promise<AdminTokenRecord | undefined> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT token, username, createdAt, expiresAt FROM admin_tokens WHERE token = ?');
      const row = await stmt.bind(token).first<any>();
      if (row) {
        if (Date.now() > row.expiresAt) {
          await this.deleteAdminToken(token);
          return undefined;
        }
        return { token: row.token, username: row.username, createdAt: row.createdAt };
      }
      return undefined;
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to verify admin token - ${e?.message || e}`);
    }
  }

  async saveAdminToken(token: string, record: AdminTokenRecord): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const expiresAt = record.createdAt + 24 * 60 * 60 * 1000;
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO admin_tokens (token, username, createdAt, expiresAt) VALUES (?, ?, ?, ?)'
      );
      await stmt.bind(token, record.username, record.createdAt, expiresAt).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save admin token - ${e?.message || e}`);
    }
  }

  async deleteAdminToken(token: string): Promise<void> {
    try {
      const stmt = this.d1.prepare('DELETE FROM admin_tokens WHERE token = ?');
      await stmt.bind(token).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to delete admin token - ${e?.message || e}`);
    }
  }

  async getRateLimit(ip: string): Promise<LoginAttemptTracker | undefined> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT count, lockedUntil FROM rate_limits WHERE ip = ?');
      const row = await stmt.bind(ip).first<any>();
      if (row) {
        return { count: row.count, lockedUntil: row.lockedUntil };
      }
      return undefined;
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to query rate limit - ${e?.message || e}`);
    }
  }

  async saveRateLimit(ip: string, tracker: LoginAttemptTracker): Promise<void> {
    try {
      const stmt = this.d1.prepare('INSERT OR REPLACE INTO rate_limits (ip, count, lockedUntil) VALUES (?, ?, ?)');
      await stmt.bind(ip, tracker.count, tracker.lockedUntil).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save rate limit - ${e?.message || e}`);
    }
  }

  async clearRateLimit(ip: string): Promise<void> {
    try {
      const stmt = this.d1.prepare('DELETE FROM rate_limits WHERE ip = ?');
      await stmt.bind(ip).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to clear rate limit - ${e?.message || e}`);
    }
  }

  async getSettings(): Promise<SystemSettings> {
    await this.ensureInitialized().catch(() => {});
    try {
      const stmt = this.d1.prepare('SELECT value FROM system_settings WHERE key = ?');
      const res = await stmt.bind('global').first<{ value: string }>();
      if (res?.value) {
        return JSON.parse(res.value);
      }
      return { isConfigured: false };
    } catch (e: any) {
      return { isConfigured: false };
    }
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    await this.ensureInitialized().catch(() => {});
    try {
      const payload: SystemSettings = {
        ...settings,
        isConfigured: true
      };
      const stmt = this.d1.prepare(
        'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)'
      );
      await stmt.bind('global', JSON.stringify(payload)).run();
    } catch (e: any) {
      throw new Error(`[Cloudflare D1 Error]: Failed to save system settings - ${e?.message || e}`);
    }
  }
}
