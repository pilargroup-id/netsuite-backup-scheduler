export const MODULES = Object.freeze(['sales-invoice', 'item-fulfillment', 'sales-order']);

export function classify(health, nowMs, thresholdMinutes = 20) {
  if (!health || health.version !== 2 || !health.modules || typeof health.modules !== 'object') {
    return { status: 'UNKNOWN', details: ['health-v2.json missing or invalid'] };
  }
  const stale = [];
  const unknown = [];
  for (const name of MODULES) {
    const row = health.modules[name];
    const parsed = Date.parse(row?.lastSuccessAt ?? '');
    if (!Number.isFinite(parsed) || parsed > nowMs + 60_000) {
      unknown.push(`${name}: lastSuccessAt missing, invalid or in future`);
      continue;
    }
    const ageMinutes = Math.max(0, Math.floor((nowMs - parsed) / 60_000));
    if (ageMinutes >= thresholdMinutes) stale.push(`${name}: STALE ageMinutes=${ageMinutes}`);
  }
  if (unknown.length) return { status: 'UNKNOWN', details: [...unknown, ...stale] };
  if (stale.length) return { status: 'STALE', details: stale };
  return { status: 'FRESH', details: [] };
}

export function initialState() {
  return { version: 2, active: false, notified: false, incidentId: null, lastStatus: 'FRESH' };
}

// Pure state transition; caller supplies notify(kind, detail, identity).
export function transition(previous, result, nowIso, notify, thresholdMinutes = 20) {
  const state = { ...initialState(), ...(previous || {}) };
  const events = [];
  let notificationFailure = false;
  const call = (kind, detail, identity) => {
    const response = notify(kind, detail, identity);
    events.push(`${kind}: ${response}`);
    if (response !== 'SENT' && response !== 'DEDUPED') notificationFailure = true;
    return response === 'SENT' || response === 'DEDUPED';
  };

  if (result.status === 'FRESH') {
    if (state.active && state.notified) {
      const ok = call('RECOVERED', `Fast Delta freshness restored. Previous status: ${state.lastStatus}\nIncident: ${state.incidentId}`, `FRESHNESS_RECOVERED:${state.incidentId}`);
      if (!ok) return { state, events, notificationFailure, exitCode: 1 };
    }
    return { state: initialState(), events, notificationFailure, exitCode: 0 };
  }

  if (!state.active) {
    state.active = true;
    state.notified = false;
    state.incidentId = nowIso;
  }
  state.lastStatus = result.status;
  if (!state.notified) {
    const kind = result.status === 'UNKNOWN' ? 'FAILED' : 'NEEDS_REVIEW';
    const detail = `Fast Delta freshness ${result.status}\nThreshold: ${thresholdMinutes} minutes\n${result.details.join('\n')}\nIncident: ${state.incidentId}`;
    if (call(kind, detail, `FRESHNESS:${state.incidentId}`)) state.notified = true;
  } else {
    events.push('ALREADY_NOTIFIED');
  }
  return { state, events, notificationFailure, exitCode: notificationFailure ? 1 : 2 };
}
