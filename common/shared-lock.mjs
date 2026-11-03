import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function createSharedLock({
  stateDir,
  worker,
  minStaleMs = 120000,
  now = () => Date.now(),
  isAlive = defaultIsAlive
}) {
  if (!stateDir || !worker) {
    throw Error('stateDir and worker required');
  }

  const lockDir = path.join(stateDir, '.running.lock');
  const guardDir = path.join(stateDir, '.lock-maintenance.guard');
  const archiveDir = path.join(stateDir, 'stale-lock-archives');
  const auditFile = path.join(stateDir, 'shared-lock-audit.jsonl');

  const identity = {
    pid: process.pid,
    host: os.hostname(),
    token: crypto.randomUUID(),
    startedAt: new Date(now()).toISOString(),
    worker
  };

  let owned = false;

  function audit(event, detail = {}) {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(
      auditFile,
      JSON.stringify({
        at: new Date(now()).toISOString(),
        event,
        worker,
        pid: process.pid,
        ...detail
      }) + '\n'
    );
  }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function sameOwner(a, b) {
    return !!(
      a && b &&
      a.pid === b.pid &&
      a.host === b.host &&
      a.token === b.token &&
      a.startedAt === b.startedAt
    );
  }

  function validOwner(owner) {
    return !!(
      owner &&
      owner.host === os.hostname() &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.token === 'string' &&
      owner.token.length > 0 &&
      Number.isFinite(Date.parse(owner.startedAt))
    );
  }

  function readLockOwner() {
    return readJson(path.join(lockDir, 'owner.json'));
  }

  function readGuardOwner() {
    return readJson(path.join(guardDir, 'owner.json'));
  }

  function withGuard(callback) {
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      fs.mkdirSync(guardDir);
    } catch (error) {
      if (error.code === 'EEXIST') {
        return {
          acquired: false,
          released: false,
          reason: 'GUARD_BUSY'
        };
      }
      throw error;
    }

    const guardIdentity = {
      ...identity,
      guardToken: crypto.randomUUID(),
      createdAt: new Date(now()).toISOString()
    };

    // If metadata creation fails, leave the guard in place.
    // Never make an uncertain guard available automatically.
    fs.writeFileSync(
      path.join(guardDir, 'owner.json'),
      JSON.stringify(guardIdentity),
      { flag: 'wx' }
    );

    try {
      return callback();
    } finally {
      const current = readGuardOwner();

      if (sameOwner(guardIdentity, current) &&
          current.guardToken === guardIdentity.guardToken) {
        try {
          fs.rmSync(guardDir, {
            recursive: true,
            force: true
          });
        } catch (error) {
          console.error(
            'GUARD CLEANUP NEEDS REVIEW:',
            error.message
          );
        }
      } else {
        console.error(
          'GUARD OWNER MISMATCH: cleanup blocked'
        );
      }
    }
  }

  function acquire() {
    return withGuard(() => {
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir);

        fs.writeFileSync(
          path.join(lockDir, 'owner.json'),
          JSON.stringify(identity),
          { flag: 'wx' }
        );

        owned = true;
        audit('ACQUIRED', { owner: identity });

        return {
          acquired: true,
          reason: 'ACQUIRED'
        };
      }

      const owner = readLockOwner();

      if (!validOwner(owner)) {
        audit('UNKNOWN_LOCK_OWNER', { owner });

        return {
          acquired: false,
          reason: 'UNKNOWN_OWNER'
        };
      }

      const ageMs = now() - Date.parse(owner.startedAt);

      if (ageMs < 0 || ageMs < minStaleMs) {
        return {
          acquired: false,
          reason: 'LOCK_HELD_RECENT'
        };
      }

      if (isAlive(owner.pid)) {
        return {
          acquired: false,
          reason: 'LOCK_OWNER_ALIVE'
        };
      }

      const verified = readLockOwner();

      if (!sameOwner(owner, verified)) {
        audit('LOCK_OWNER_CHANGED');

        return {
          acquired: false,
          reason: 'OWNER_CHANGED'
        };
      }

      fs.mkdirSync(archiveDir, { recursive: true });

      const archive = path.join(
        archiveDir,
        'stale-' + now() + '-' + crypto.randomUUID()
      );

      fs.renameSync(lockDir, archive);

      audit('STALE_ARCHIVED', {
        previousOwner: owner,
        archive
      });

      return {
        acquired: false,
        reason: 'STALE_ARCHIVED',
        archive
      };
    });
  }

  function release() {
    if (!owned) {
      return {
        released: false,
        reason: 'NOT_OWNED'
      };
    }

    return withGuard(() => {
      const current = readLockOwner();

      if (!sameOwner(identity, current)) {
        audit('RELEASE_OWNER_MISMATCH');

        return {
          released: false,
          reason: 'OWNER_MISMATCH'
        };
      }

      fs.rmSync(lockDir, {
        recursive: true,
        force: true
      });

      owned = false;
      audit('RELEASED');

      return {
        released: true,
        reason: 'RELEASED'
      };
    });
  }

  function inspect() {
    return {
      lockExists: fs.existsSync(lockDir),
      lockOwner: readLockOwner(),
      guardExists: fs.existsSync(guardDir),
      guardOwner: readGuardOwner(),
      ownedByCurrentWorker: owned
    };
  }

  return { acquire, release, inspect };
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}