require('@next/env').loadEnvConfig(process.cwd());
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const base = 'http://localhost:3000';
const cookies = new Map();
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...options.headers },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  return response;
}
async function main() {
  assert.equal((await request('/auth/login')).status, 200);
  assert.equal((await request('/api/sessions')).status, 401);
  console.log('PASS: Login page loads; unauthenticated sessions access is denied.');
  const csrf = await (await request('/api/auth/csrf')).json();
  const password = process.env.WA_AKG_TEST_PASSWORD;
  assert.ok(password, 'Set WA_AKG_TEST_PASSWORD for the login test');
  const login = await request('/api/auth/callback/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: 'ssy.balu@gmail.com', password, callbackUrl: base + '/dashboard' }),
  });
  assert.ok(login.status < 400, 'Login request failed');
  const session = await (await request('/api/auth/session')).json();
  assert.equal(session.user?.email, 'ssy.balu@gmail.com');
  assert.equal(session.user?.role, 'SUPERADMIN');
  assert.equal((await request('/dashboard')).status, 200);
  const sessions = await (await request('/api/sessions')).json();
  assert.equal(sessions.status, true);
  const config = await (await request('/api/settings/system')).json();
  assert.equal(config.data.timezone, 'Asia/Kolkata');
  console.log('PASS: Real administrator login, dashboard, sessions API, and India timezone.');
  await new Promise((resolve, reject) => {
    const socket = io(base, { path: '/api/socket/io', addTrailingSlash: false, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('WebSocket timed out')); }, 10000);
    socket.once('connect', () => { clearTimeout(timer); socket.disconnect(); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.disconnect(); reject(error); });
  });
  console.log('PASS: Live WebSocket connection.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
