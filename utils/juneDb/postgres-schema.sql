-- June X PostgreSQL mirror schema
--
-- SQLite remains the live database. PostgreSQL stores mirrored/recovery data
-- for one or more bot instances, separated by bot_id.

CREATE TABLE IF NOT EXISTS bot_configs (
  bot_id     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, key)
);

-- Direct remote auth state. This table is used only by the dedicated
-- auth-state recovery path, not by the generic settings restore function.
CREATE TABLE IF NOT EXISTS session_auth_state (
  bot_id            TEXT PRIMARY KEY,
  session_creds     JSONB NOT NULL DEFAULT '[]'::jsonb,
  session_keys      JSONB NOT NULL DEFAULT '[]'::jsonb,
  session_auth_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_features (
  bot_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  feature    TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, group_id, feature)
);

CREATE TABLE IF NOT EXISTS group_stats (
  bot_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  stat_date  TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, group_id, stat_date)
);

CREATE TABLE IF NOT EXISTS users (
  bot_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  bot_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  reasons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, group_id, user_id)
);

CREATE TABLE IF NOT EXISTS sudoers (
  bot_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, user_id)
);

CREATE TABLE IF NOT EXISTS muted_users (
  bot_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, group_id, user_id)
);

CREATE TABLE IF NOT EXISTS kv_store (
  bot_id     TEXT NOT NULL,
  namespace  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, namespace, key)
);

CREATE TABLE IF NOT EXISTS antidelete_messages (
  bot_id     TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  stored_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS antidelete_statuses (
  bot_id    TEXT NOT NULL,
  status_id TEXT NOT NULL,
  payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, status_id)
);

CREATE TABLE IF NOT EXISTS lid_map (
  bot_id      TEXT NOT NULL,
  direction   TEXT NOT NULL,
  map_user    TEXT NOT NULL,
  map_value   TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, direction, map_user)
);

CREATE TABLE IF NOT EXISTS chatbot_profiles (
  bot_id         TEXT NOT NULL,
  profile_bot_id TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  profile        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, profile_bot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_features_bot_group ON group_features (bot_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_stats_bot_group ON group_stats (bot_id, group_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_kv_store_bot_namespace ON kv_store (bot_id, namespace);
CREATE INDEX IF NOT EXISTS idx_antidelete_messages_stored_at ON antidelete_messages (bot_id, stored_at DESC);
CREATE INDEX IF NOT EXISTS idx_antidelete_statuses_stored_at ON antidelete_statuses (bot_id, stored_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_profiles_bot_user ON chatbot_profiles (bot_id, user_id);

-- The adapter calls this function to fill missing SQLite rows during startup.
-- It deliberately returns payloads compatible with pgAdapter.restoreIntoSQLite.
CREATE OR REPLACE FUNCTION june_restore_snapshot(requested_bot_id TEXT)
RETURNS TABLE(table_name TEXT, payload JSONB)
LANGUAGE sql
STABLE
AS $$
  SELECT 'bot_configs'::TEXT,
         jsonb_build_object('key', key, 'value', value)
  FROM bot_configs
  WHERE bot_id = requested_bot_id
    AND key <> '__june_encrypted_auth_backup_v1__'

  UNION ALL
  SELECT 'group_features'::TEXT,
         jsonb_build_object('group_id', group_id, 'feature', feature, 'config', config)
  FROM group_features
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'group_stats'::TEXT,
         jsonb_build_object('group_id', group_id, 'stat_date', stat_date, 'data', data)
  FROM group_stats
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'users'::TEXT,
         jsonb_build_object('user_id', user_id, 'data', data)
  FROM users
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'warnings'::TEXT,
         jsonb_build_object('group_id', group_id, 'user_id', user_id, 'count', count, 'reasons', reasons)
  FROM warnings
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'sudoers'::TEXT,
         jsonb_build_object('user_id', user_id)
  FROM sudoers
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'muted_users'::TEXT,
         jsonb_build_object('group_id', group_id, 'user_id', user_id)
  FROM muted_users
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'kv_store'::TEXT,
         jsonb_build_object('namespace', namespace, 'key', key, 'value', value)
  FROM kv_store
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'antidelete_messages'::TEXT,
         jsonb_build_object(
           'chat_id', chat_id,
           'message_id', message_id,
           'payload', payload,
           'stored_at', FLOOR(EXTRACT(EPOCH FROM stored_at) * 1000)
         )
  FROM antidelete_messages
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'antidelete_statuses'::TEXT,
         jsonb_build_object(
           'status_id', status_id,
           'payload', payload,
           'stored_at', FLOOR(EXTRACT(EPOCH FROM stored_at) * 1000)
         )
  FROM antidelete_statuses
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'lid_map'::TEXT,
         jsonb_build_object(
           'direction', direction,
           'user', map_user,
           'value', map_value,
           'updated_at', FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)
         )
  FROM lid_map
  WHERE bot_id = requested_bot_id

  UNION ALL
  SELECT 'chatbot_profiles'::TEXT,
         jsonb_build_object('profile_bot_id', profile_bot_id, 'user_id', user_id, 'profile', profile)
  FROM chatbot_profiles
  WHERE bot_id = requested_bot_id;
$$;
