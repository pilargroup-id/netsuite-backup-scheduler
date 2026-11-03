import fs from 'node:fs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CLIENT_ID, CERTIFICATE_ID, PRIVATE_KEY_PATH } from '../credentials/netsuite-secrets.mjs';
export const BASE_URL = 'https://6930902.suitetalk.api.netsuite.com';
const TOKEN_URL = `${BASE_URL}/services/rest/auth/oauth2/v1/token`;
export async function token() {
  if (!CLIENT_ID || !CERTIFICATE_ID || !PRIVATE_KEY_PATH) throw new Error('NetSuite secrets not configured');
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({
    iss: CLIENT_ID, scope: ['rest_webservices'], aud: TOKEN_URL,
    iat: now, exp: now + 300, jti: crypto.randomUUID()
  }, fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'), {
    algorithm: 'PS256', keyid: CERTIFICATE_ID, header: { typ: 'JWT' }
  });
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OAuth HTTP ${response.status}: ${text}`);
  const value = JSON.parse(text).access_token;
  if (!value) throw new Error('OAuth token missing');
  return value;
}
// Retry policy mirrors existing successful SI/IF scripts.
export async function suiteql(access, sql, limit = 1000, offset = 0, attempts = 3) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: sql })
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`SuiteQL HTTP ${res.status}: ${text}\nSQL: ${sql}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
}
export async function fetchAll(access, sql, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await suiteql(access, sql, pageSize, offset);
    const items = page.items ?? [];
    rows.push(...items);
    if (!page.hasMore) return rows;
    if (!items.length || offset >= 999000) throw new Error('SuiteQL pagination problem');
  }
}
