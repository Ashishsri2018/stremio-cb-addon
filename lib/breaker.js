const OUTCOMES = new Set(['ok', 'empty', 'timeout', 'error']);

function clampInt(value, fallback, min) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.floor(num));
}

function createBreaker({ threshold = 3, cooldownMs = 300000, now = Date.now } = {}) {
  const failureThreshold = clampInt(threshold, 3, 1);
  const cooldown = clampInt(cooldownMs, 300000, 0);
  const providers = new Map();

  function stateFor(id) {
    let state = providers.get(id);
    if (!state) {
      state = {
        id,
        state: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        calls: 0,
        ok: 0,
        empty: 0,
        errors: 0,
        timeouts: 0,
        skipped: 0,
        totalLatencyMs: 0,
        maxMs: 0,
        lastMs: null,
        lastError: null,
        lastSuccessAt: null,
        probeInFlight: false,
      };
      providers.set(id, state);
    }
    return state;
  }

  function effectiveState(state, time) {
    if (state.state === 'open' && time - state.openedAt >= cooldown) return 'half-open';
    return state.state;
  }

  function open(state, time) {
    state.state = 'open';
    state.openedAt = time;
    state.probeInFlight = false;
  }

  function close(state) {
    state.state = 'closed';
    state.openedAt = null;
    state.consecutiveFailures = 0;
    state.probeInFlight = false;
  }

  function attempt(id) {
    const state = stateFor(id);
    const time = now();

    if (state.state === 'open') {
      if (time - state.openedAt >= cooldown) {
        state.state = 'half-open';
        state.probeInFlight = true;
        state.calls += 1;
        return true;
      }
      state.skipped += 1;
      return false;
    }

    if (state.state === 'half-open') {
      if (state.probeInFlight) {
        state.skipped += 1;
        return false;
      }
      state.probeInFlight = true;
      state.calls += 1;
      return true;
    }

    state.calls += 1;
    return true;
  }

  function record(id, outcome, { latencyMs = 0, error = null } = {}) {
    if (!OUTCOMES.has(outcome)) return;
    const state = stateFor(id);
    const time = now();
    const latency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;

    state.lastMs = latency;
    state.totalLatencyMs += latency;
    if (latency > state.maxMs) state.maxMs = latency;

    if (outcome === 'ok' || outcome === 'empty') {
      if (outcome === 'ok') {
        state.ok += 1;
        state.lastSuccessAt = time;
      } else {
        state.empty += 1;
      }
      close(state);
      return;
    }

    if (outcome === 'timeout') state.timeouts += 1;
    else state.errors += 1;

    state.consecutiveFailures += 1;
    const message = error && (error.message || String(error));
    state.lastError = {
      outcome,
      message: message ? String(message).slice(0, 300) : null,
      at: time,
    };
    state.probeInFlight = false;

    if (state.state === 'half-open' || state.consecutiveFailures >= failureThreshold) {
      open(state, time);
    }
  }

  function score(id) {
    const state = providers.get(id);
    if (!state) return 0.5;
    return (state.ok + 1) / (state.calls + 2);
  }

  function snapshot() {
    const time = now();
    return [...providers.values()].map((state) => ({
      id: state.id,
      state: effectiveState(state, time),
      calls: state.calls,
      ok: state.ok,
      empty: state.empty,
      errors: state.errors,
      timeouts: state.timeouts,
      skipped: state.skipped,
      consecutiveFailures: state.consecutiveFailures,
      lastMs: state.lastMs,
      avgMs: state.calls > 0 ? Math.round(state.totalLatencyMs / state.calls) : null,
      maxMs: state.maxMs,
      score: Number(score(state.id).toFixed(3)),
      lastError: state.lastError
        ? { ...state.lastError, at: new Date(state.lastError.at).toISOString() }
        : null,
      lastSuccessAt: state.lastSuccessAt
        ? new Date(state.lastSuccessAt).toISOString()
        : null,
      openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
    }));
  }

  function summary(ids = null) {
    const time = now();
    const list = Array.isArray(ids) ? ids : [...providers.keys()];
    const counts = { closed: 0, open: 0, halfOpen: 0, total: list.length };

    for (const id of list) {
      const state = providers.get(id);
      const current = state ? effectiveState(state, time) : 'closed';
      if (current === 'open') counts.open += 1;
      else if (current === 'half-open') counts.halfOpen += 1;
      else counts.closed += 1;
    }

    return counts;
  }

  return { attempt, record, score, snapshot, summary };
}

module.exports = { createBreaker };
