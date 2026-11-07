-- Cloudflare D1 Migration: Initial Schema
-- Migration 0001_initial.sql

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

CREATE INDEX IF NOT EXISTS idx_sessions_examId ON sessions(examId);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
