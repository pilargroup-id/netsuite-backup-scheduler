import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const stateDir = path.join(root, 'logs', 'scheduler');

const paths = {
  lock: path.join(stateDir, '.running.lock'),
  guard: path.join(stateDir, '.lock-maintenance.guard')
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function inspect(name, directory) {
  const exists = fs.existsSync(directory);

  if (!exists) {
    return { name, exists: false, status: 'ABSENT' };
  }

  const owner = readJson(path.join(directory, 'owner.json'));

  if (!owner) {
    return {
      name,
      exists: true,
      status: 'UNKNOWN_OWNER'
    };
  }

  if (owner.host !== os.hostname()) {
    return {
      name,
      exists: true,
      status: 'FOREIGN_HOST',
      owner
    };
  }

  let pidStatus = 'UNKNOWN';

  if (Number.isInteger(owner.pid) && owner.pid > 0) {
    try {
      process.kill(owner.pid, 0);
      pidStatus = 'PID_EXISTS';
    } catch (error) {
      pidStatus = error.code === 'ESRCH'
        ? 'PID_NOT_FOUND'
        : 'UNKNOWN';
    }
  }

  return {
    name,
    exists: true,
    status: pidStatus,
    owner
  };
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  lock: inspect('lock', paths.lock),
  guard: inspect('guard', paths.guard)
}, null, 2));