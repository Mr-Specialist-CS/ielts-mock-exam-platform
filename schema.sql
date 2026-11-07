-- Cloudflare D1 Database Schema for IELTS Gate Mock Exam Platform
-- Production Serverless SQLite Schema

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'academic',
  description TEXT,
  centreNumber TEXT,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  candidateId TEXT PRIMARY KEY,
  examId TEXT NOT NULL,
  candidateName TEXT NOT NULL,
  currentSection TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  candidateName TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  examId TEXT,
  amountAzn REAL DEFAULT 45,
  status TEXT DEFAULT 'pending',
  data TEXT NOT NULL,
  submittedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_tokens (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  lockedUntil INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_metadata (
  key TEXT PRIMARY KEY,
  fileName TEXT NOT NULL,
  fileType TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  isPrivate INTEGER DEFAULT 0,
  uploadedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_examId ON sessions(examId);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_admin_tokens_expiresAt ON admin_tokens(expiresAt);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lockedUntil ON rate_limits(lockedUntil);

