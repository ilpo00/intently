-- ─────────────────────────────────────────────────────────────────
-- 0015 · analytics_turn_events.arm — the online A/B arm ('A' | 'B') on each
-- turn, so the cloud analytics can compare experiment arms the same way the
-- local file store does (the TurnEvent.arm field). Null when no experiment
-- is running.
-- ─────────────────────────────────────────────────────────────────

alter table analytics_turn_events
  add column if not exists arm text check (arm in ('A', 'B'));
