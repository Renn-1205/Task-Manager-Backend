-- ============================================================
-- Supabase SQL Migration: Users table for authentication
-- Run this in your Supabase Dashboard → SQL Editor
-- ============================================================

-- Create the users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
  is_verified BOOLEAN DEFAULT FALSE,

  -- Email verification
  verification_code VARCHAR(6),
  verification_code_expires_at TIMESTAMPTZ,

  -- Password reset
  reset_password_token TEXT,
  reset_password_expires_at TIMESTAMPTZ,

  -- Tracking
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token);
CREATE INDEX IF NOT EXISTS idx_users_verification_code ON users(verification_code);

-- Auto-update the updated_at column on row changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy: Allow the service role (backend) full access
-- The backend uses the service_role key so RLS is bypassed automatically.
-- Add user-facing policies here if needed for direct Supabase client access.
