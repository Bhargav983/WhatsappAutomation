const { spawn } = require('node:child_process');
const path = require('node:path');

process.env.NODE_ENV = 'production';
const child = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/server/index.ts'], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
