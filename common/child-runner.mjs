import { spawn, spawnSync } from 'node:child_process';

// Streaming subprocess; unlike spawnSync, does not buffer entire SuiteQL/BigQuery logs.
// Success requires exit 0 AND the expected terminal marker.
export function runChild(command, args, { cwd, timeoutMs, markers, onOutput = () => {}, env = process.env } = {}) {
  if (!Array.isArray(markers) || markers.length === 0) throw Error('markers required');
  return new Promise((resolve) => {
    let settled = false, timedOut = false, spawnError = null;
    let tail = '', stderrTail = '';
    let child;
    const finish = (exit, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const markerFound = markers.some(m => tail.includes(m));
      const ok = !timedOut && !spawnError && exit === 0 && markerFound;
      resolve({ ok, exit, signal, timedOut, markerFound, error: spawnError, detail: timedOut ? `TIMEOUT_${Math.round(timeoutMs / 60000)}_MIN` : spawnError ?? (exit !== 0 ? `EXIT_${exit}_SIGNAL_${signal ?? 'NONE'}` : markerFound ? null : 'SUCCESS_MARKER_MISSING'), stderrTail });
    };
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ok:false,exit:null,signal:null,timedOut:false,markerFound:false,error:e.message,detail:e.message,stderrTail:''});
      return;
    }
    const push = (data, isErr) => {
      const s = data.toString('utf8');
      onOutput(s, isErr);
      // Keep bounded output, allowing markers to cross chunk boundaries.
      tail = (tail + s).slice(-65536);
      if (isErr) stderrTail = (stderrTail + s).slice(-8192);
    };
    child.stdout?.on('data', d => push(d, false));
    child.stderr?.on('data', d => push(d, true));
    child.on('error', e => {spawnError = e.message;});
    child.on('close', finish);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        // Terminate descendant processes too; otherwise a BigQuery writer may continue
        // after the shared lock is released.
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, timeout:15000});
      } else child.kill('SIGKILL');
    }, timeoutMs);
  });
}
