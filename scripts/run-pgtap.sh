#!/usr/bin/env bash
set -e

echo "=== Running PostgreSQL 15 pgTAP Test Suites ==="

# 1. Suite 1
echo ""
echo "--- 1. Invariants and Seed Data (01_invariants_and_seeds.test.sql) ---"
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/tests/database/01_invariants_and_seeds.test.sql
"

# 2. Suite 2
echo ""
echo "--- 2. RLS Policies and Owner Isolation (02_rls_and_isolation.test.sql) ---"
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/tests/database/02_rls_and_isolation.test.sql
"

# 3. Suite 3
echo ""
echo "--- 3. RPC Contracts, Security Boundaries & Internationalization (03_rpc_contracts.test.sql) ---"
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/tests/database/03_rpc_contracts.test.sql
"

# 4. Suite 4
echo ""
echo "--- 4. Authoritative Johari Calculation Engine & Parity Verification (04_authoritative_calculation.test.sql) ---"
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/tests/database/04_authoritative_calculation.test.sql
"

# 5. Suite 5
echo ""
echo "--- 5. Results Presentation & Retrieval (05_results_presentation.test.sql) ---"
su - postgres -c "
/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /app/applet/supabase/tests/database/05_results_presentation.test.sql
"

echo ""
echo "=== All pgTAP Suites Completed Successfully ==="
