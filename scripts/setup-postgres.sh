#!/usr/bin/env bash
set -e

echo "=== Initializing PostgreSQL 15 Environment ==="

# 1. Create postgres user if not exists
if ! id postgres >/dev/null 2>&1; then
  useradd -m postgres
fi

# 2. Extract postgres binaries and pgtap if not already extracted
if [ ! -f /tmp/pg/usr/lib/postgresql/15/bin/postgres ]; then
  mkdir -p /tmp/pg /tmp/pgdata
  cd /tmp/pg
  apt-get update -qq
  apt-get download -qq postgresql-15 postgresql-client-15 postgresql-15-pgtap
  for f in *.deb; do
    dpkg -x "$f" .
  done
  chown -R postgres:postgres /tmp/pg /tmp/pgdata
  su - postgres -c "/tmp/pg/usr/lib/postgresql/15/bin/initdb -D /tmp/pgdata --auth=trust --no-instructions"
fi

# 3. Start PostgreSQL daemon if not running
if ! su - postgres -c "/tmp/pg/usr/lib/postgresql/15/bin/pg_ctl -D /tmp/pgdata status" >/dev/null 2>&1; then
  su - postgres -c "/tmp/pg/usr/lib/postgresql/15/bin/pg_ctl -D /tmp/pgdata -l /tmp/pgdata/logfile -o '-p 54322 -k /tmp' start"
fi

# 4. Bootstrap auth schema and roles
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c \"
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE
);
DO \\\$\$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null; END \\\$\\\$;
DO \\\$\$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null; END \\\$\\\$;
DO \\\$\$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null; END \\\$\\\$;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS \\\$\$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
\\\$\\\$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
\"
"

# 5. Apply migrations in order
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000001_initial_schema.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000002_adjectives_seed.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000003_rls_and_permissions.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000004_rpc_contracts.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000005_rate_limiting.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000006_reissue_hardening.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000007_authoritative_calculation.sql
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/migrations/20261106000008_owner_results_rpc.sql
"

echo "=== PostgreSQL 15 Setup & Migrations Ready ==="
