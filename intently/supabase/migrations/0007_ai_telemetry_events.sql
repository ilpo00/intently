-- ─────────────────────────────────────────────────────────────────
-- Intently · 0007_ai_telemetry_events
-- Durable backing for the tiered-AI telemetry ring buffer.
-- See src/lib/ai/telemetry.ts (in-memory ring is the hot cache; this
-- table is the cross-process / multi-replica source of truth) and
-- /admin/analytics/ai (the dashboard that reads it via service_role).
--
-- Phase 1c of the admin-panel plan
-- (~/.claude/plans/composed-herding-glacier.md).
--
-- One row per `recordTurn` call in src/lib/ai/telemetry.ts. The fields
-- mirror the in-memory `SampleRecord` shape so write-through is a
-- direct projection.
--
-- RLS posture: system-level observability data, not user-scoped.
--   * Writes: service_role only (orchestrator uses
--     getSupabaseService() to insert from server code; not from any
--     client bundle).
--   * Reads: service_role only (dashboard uses
--     getSupabaseService() to read across users / processes).
--   * No anon / authenticated policies — RLS denies by default.
--
-- This mirrors the chip_events_anon analytics-read pattern from 0006
-- but goes one step further: even INSERTs are service_role, because
-- there's no reason a browser should be writing telemetry rows
-- directly (we don't want forged tier-1 hits).
-- ─────────────────────────────────────────────────────────────────

create table ai_telemetry_events (
  id                    text primary key,                              -- ulid / uuid; mints in src/lib/ai/telemetry.ts
  session_id            text,                                          -- /api/chat/session id; null if pre-session
  tier                  text not null
                        check (tier in (
                          'tier-1-deepseek',
                          'tier-2-validator',
                          'tier-3-haiku',
                          'tier-4-sonnet',
                          'fallback'
                        )),
  duration_ms           integer not null check (duration_ms >= 0),
  validation_reasons    text[]  not null default '{}'::text[],
  guardrail_disabled    boolean not null default false,
  finish_reason         text    not null,                              -- 'stop' | 'length' | 'tool_use' | model-specific
  truncated_at_length   boolean not null
                        generated always as (finish_reason = 'length') stored,
  primary_provider      text    not null,                              -- 'deepseek' / 'anthropic' / etc — `primary` is a keyword
  created_at            timestamptz not null default now()
);

-- Range scans for the dashboard ("everything in the last 7 days").
create index ai_telemetry_events_created_idx
  on ai_telemetry_events (created_at desc);

-- Tier-over-time queries ("how did tier-3 share trend last 30 days?").
create index ai_telemetry_events_tier_created_idx
  on ai_telemetry_events (tier, created_at desc);

-- ─── RLS ───────────────────────────────────────────────────────
-- Enabled with no anon / authenticated policies. service_role bypasses
-- RLS, so the orchestrator writes and the dashboard reads still work.

alter table public.ai_telemetry_events enable row level security;
