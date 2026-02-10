import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase URL or Service Role Key in environment variables");
}

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in environment variables");
}

// Use the service role key for server-side operations (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ─── Migration SQL ───────────────────────────────────────────
const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(6),
    verification_code_expires_at TIMESTAMPTZ,
    reset_password_token TEXT,
    reset_password_expires_at TIMESTAMPTZ,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token);
  CREATE INDEX IF NOT EXISTS idx_users_verification_code ON users(verification_code);

  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at'
    ) THEN
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END;
  $$;
`;

const CREATE_TASKS_TABLE = `
  CREATE TABLE IF NOT EXISTS tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date DATE,
    priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status VARCHAR(20) DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'completed')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    class_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'set_tasks_updated_at'
    ) THEN
      CREATE TRIGGER set_tasks_updated_at
        BEFORE UPDATE ON tasks
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END;
  $$;
`;

const CREATE_CLASSES_TABLE = `
  CREATE TABLE IF NOT EXISTS classes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    invite_code VARCHAR(8) UNIQUE NOT NULL,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_classes_invite_code ON classes(invite_code);

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'set_classes_updated_at'
    ) THEN
      CREATE TRIGGER set_classes_updated_at
        BEFORE UPDATE ON classes
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END;
  $$;
`;

const CREATE_CLASS_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS class_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(class_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_class_members_class ON class_members(class_id);
  CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id);
`;

const ADD_TASKS_CLASS_COLUMN = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'class_id'
    ) THEN
      ALTER TABLE tasks ADD COLUMN class_id UUID;
    END IF;
  END;
  $$;

  CREATE INDEX IF NOT EXISTS idx_tasks_class_id ON tasks(class_id);
`;

const ADD_TASKS_CLASS_FK = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'tasks_class_id_fkey'
    ) THEN
      ALTER TABLE tasks ADD CONSTRAINT tasks_class_id_fkey
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
    END IF;
  END;
  $$;
`;

const CREATE_NOTIFICATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN (
      'task_assigned', 'task_completed', 'task_overdue', 'class_joined'
    )),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
`;

// ─── Connect & run migration ─────────────────────────────────
export const connectDB = async () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log("✅ PostgreSQL connected");

    // Run migration — creates tables + indexes + triggers if they don't exist
    await client.query(CREATE_USERS_TABLE);
    console.log("✅ Users table ready");

    await client.query(CREATE_TASKS_TABLE);
    console.log("✅ Tasks table ready");

    await client.query(CREATE_CLASSES_TABLE);
    console.log("✅ Classes table ready");

    await client.query(CREATE_CLASS_MEMBERS_TABLE);
    console.log("✅ Class members table ready");

    await client.query(ADD_TASKS_CLASS_COLUMN);
    console.log("✅ Tasks class_id column ready");

    await client.query(ADD_TASKS_CLASS_FK);
    console.log("✅ Tasks ↔ Classes FK ready");

    await client.query(CREATE_NOTIFICATIONS_TABLE);
    console.log("✅ Notifications table ready");

    await client.end();
  } catch (err) {
    console.error("❌ Database setup failed:", err.message);
    await client.end().catch(() => {});
    process.exit(1);
  }
};

export default supabase;
