# Johari Window Assessment Application

A production-grade, collaborative web application implementing the psychological Johari Window framework. Enables subjects to conduct self-assessments, distribute cryptographically secure single-use invitation tokens to peers, aggregate feedback anonymously, and calculate mathematically authoritative 4-quadrant matrices via PostgreSQL.

---

## 1. Architectural Overview

- **Frontend**: React 19 SPA powered by Vite, Tailwind CSS, Lucide icons, and accessible component designs.
- **Backend & Server-side Proxy**: Express server with Vite middleware integration in development and static asset serving in production (`server.ts`).
- **Database & Authoritative Engine**: PostgreSQL 15 / Supabase with Row Level Security (RLS), atomic stored procedures (RPCs), and strict relational constraints.
- **Mathematical Invariants**:
  - The 55 canonical adjectives are strictly partitioned across four pairwise-disjoint quadrants:
    - $\text{OPEN} = S \cap P$ (Known to Self & Known to Others)
    - $\text{BLIND} = P - S$ (Unknown to Self & Known to Others)
    - $\text{HIDDEN} = S - P$ (Known to Self & Unknown to Others)
    - $\text{UNKNOWN} = U - (S \cup P)$ (Unknown to Self & Unknown to Others)
  - $\text{OPEN} + \text{BLIND} + \text{HIDDEN} + \text{UNKNOWN} = 55$.
  - Peer feedback frequencies are calculated per trait and never affect quadrant classification.
- **Privacy & Security Hardening**:
  - 256-bit unpadded Base64URL invitation tokens stored strictly as SHA-256 digests (`token_hash`).
  - Tokens read exclusively from URL hash fragments (`/invite#<token>`) and never sent via HTTP GET or stored in logs/cookies/localStorage.
  - Single-use consumption enforced atomically via database row locks (`SELECT FOR UPDATE`).
  - Strict 5-response privacy threshold unless explicitly overridden by owner with affirmative privacy acknowledgement.
  - Rate limiting via HMAC-keyed SHA-256 client IP buckets.
  - Client-side executive PDF report generation via `jsPDF`.

---

## 2. Environment Variables

Create a `.env` file in the project root based on `.env.example`:

| Variable | Description | Exposure |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (e.g. `https://xyz.supabase.co` or `http://127.0.0.1:54322`) | Client-safe |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key | Client-safe |
| `SUPABASE_SECRET_KEY` | Supabase secret key / service-role key for backend proxy operations | Server-only |
| `PORT` | Node.js / Express server listening port (defaults to `3000`) | Server-only |
| `APP_URL` | Canonical app URL used when generating invitation links (e.g. `http://localhost:3000`) | Server-only |

---

## 3. Database Setup & Migrations

All migrations reside in `supabase/migrations/`:

1. `20261106000001_initial_schema.sql`: Core tables, check constraints, canonical 55-adjective seed data.
2. `20261106000002_rls_policies.sql`: Row Level Security policies and isolation for owners and anonymous respondents.
3. `20261106000003_owner_create_session.sql`: `rpc_owner_create_session` with 20 active non-finalized session limit.
4. `20261106000004_owner_submit_self_assessment.sql`: `rpc_owner_submit_self_assessment_and_open` with atomic token hash insertion.
5. `20261106000005_participant_submission_rpc.sql`: `rpc_participant_validate_token` and atomic `rpc_participant_submit_feedback`.
6. `20261106000006_owner_reissue_invites_rpc.sql`: `rpc_owner_reissue_invite` and `rpc_owner_bulk_reissue_unused_invites` with 200 lifetime cap.
7. `20261106000007_authoritative_calculation_rpc.sql`: `rpc_owner_finalize_session` authoritative set math and snapshot creation.
8. `20261106000008_owner_results_rpc.sql`: `rpc_owner_get_results` enforcing owner access and unfinalized session rejection.

### Applying Migrations Locally

```bash
# Set up and migrate local PostgreSQL 15 instance:
./scripts/setup-postgres.sh
```

---

## 4. Running Tests

### Vitest Unit & Component Suites
```bash
npm test
# Or run with full output:
npx vitest run
```

### PostgreSQL 15 pgTAP Test Suites
```bash
./scripts/run-pgtap.sh
```
Runs 5 comprehensive database test suites:
1. `01_invariants_and_seeds.test.sql`: 55 canonical adjectives, constraints, enums.
2. `02_rls_and_isolation.test.sql`: RLS policies, multi-tenant owner isolation.
3. `03_rpc_contracts.test.sql`: Token issuance, atomic consumption, rate limits, reissuance.
4. `04_authoritative_calculation.test.sql`: Authoritative Johari math and mandatory test vector.
5. `05_results_presentation.test.sql`: Results snapshot retrieval, unfinalized session rejection, owner enforcement.

---

## 5. Deployment Instructions

### Full-Stack Build & Run
```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript and build production bundle
npm run build

# 3. Start production server
npm run dev # or node server.ts with NODE_ENV=production
```

### Supabase Edge Functions Deployment (Optional)
If deploying backend operations directly to Supabase Edge Functions instead of the Express proxy:
```bash
supabase functions deploy submit-self-assessment
supabase functions deploy submit-participant-feedback
supabase functions deploy reissue-invite
supabase functions deploy bulk-reissue-unused
```

### SMTP Configuration (for Auth Confirmation)
When using hosted Supabase Auth:
1. Navigate to **Project Settings > Authentication > SMTP Settings**.
2. Enable Custom SMTP.
3. Configure your provider (e.g. SendGrid, Resend, Amazon SES, Postmark) with TLS/SSL on port 587 or 465.
4. Set Sender Name: `Johari Window Assessment` and Sender Email: `noreply@yourdomain.com`.
