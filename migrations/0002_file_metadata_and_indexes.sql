-- Cloudflare D1 Migration: File Metadata and Performance Indexes
-- Migration 0002_file_metadata_and_indexes.sql

CREATE TABLE IF NOT EXISTS file_metadata (
  key TEXT PRIMARY KEY,
  fileName TEXT NOT NULL,
  fileType TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  isPrivate INTEGER DEFAULT 0,
  uploadedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_examId ON sessions(examId);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_admin_tokens_expiresAt ON admin_tokens(expiresAt);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lockedUntil ON rate_limits(lockedUntil);
