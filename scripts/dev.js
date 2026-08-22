import { spawn } from 'node:child_process';
import process from 'node:process';

const commands = [
  spawn('bun', ['server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit', env: process.env }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of commands) child.kill(signal);
}

for (const child of commands) {
  child.on('exit', code => {
    if (!stopping) {
      stop();
      process.exitCode = code || 1;
    }
  });
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
