-- Cloudflare D1 Migration: System Settings
-- Migration 0003_system_settings.sql

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
