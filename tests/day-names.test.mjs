import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDayName, validateDayName, renameDay } from '../public/day-names.js';
import { handleApi, handleTrips, validateDays } from '../server/api.js';
import { handleSharing } from '../server/sharing.js';
import { localDatabase } from '../scripts/local-db.mjs';

test('day names trim ordinary text and restore the correct numbered fallback', () => {
 assert.equal(validateDayName('  京都散步與咖啡  ', 1), '京都散步與咖啡');
 assert.equal(validateDayName('', 0), '第1天');
 assert.equal(validateDayName('   ', 4), '第5天');
 assert.equal(validateDayName(undefined, 2), '第3天');
 assert.equal(validateDayName('旅'.repeat(120), 0).length, 120);
 assert.throws(() => validateDayName('旅'.repeat(121), 0), /120/);
 for (const value of [null, {}, [], 123, '第一天\n下一行', '\t有控制字元', 'bad\u0000value']) {
  assert.throws(() => validateDayName(value, 0));
 }
 for (const index of [-1, 0.5, Infinity, '0']) assert.throws(() => validateDayName('主題', index));
});

test('renaming clones the whole snapshot and changes only one day title', () => {
 const source = [{ title: '舊名稱', isoDate: '2027-04-12', stops: [{ id: 'one', name: '景點', flight: { number: 'BR116' } }] }, { title: '第二天', stops: [] }];
 const next = renameDay(source, 0, '  新名稱  ');
 assert.equal(next[0].title, '新名稱');
 assert.equal(source[0].title, '舊名稱');
 assert.notEqual(next[0].stops[0], source[0].stops[0]);
 assert.deepEqual(next[0].stops, source[0].stops);
 assert.deepEqual(next[1], source[1]);
 assert.equal(renameDay(source, 1, '')[1].title, '第2天');
 assert.throws(() => renameDay(source, 2, '沒有這天'));
 assert.throws(() => renameDay(null, 0, '名稱'));
});

test('editors get an explicit save form; viewers get escaped read-only headings', () => {
 const title = '"><img src=x onerror="alert(1)">';
 const editor = renderDayName({ title }, 0, { canEdit: true });
 assert.match(editor, /<form[^>]*data-day-name-form[^>]*data-day-index="0"/);
 assert.match(editor, /name="dayName"/);
 assert.match(editor, /for="day-name-0"/);
 assert.match(editor, /id="day-name-0"/);
 assert.match(editor, /type="submit">儲存名稱/);
 assert.match(editor, /maxlength="120"/);
 assert.match(editor, /&quot;&gt;&lt;img/);
 assert.doesNotMatch(editor, /<img|<script|<button[^>]*>.*<input/s);
 const viewer = renderDayName({ title }, 0, { canEdit: false });
 assert.match(viewer, /<h3 class="day-name-heading">/);
 assert.doesNotMatch(viewer, /<form|<input|<button|<img/);
 assert.doesNotMatch(renderDayName({ title: '觀光' }, 0), /<input/);
 assert.doesNotMatch(renderDayName({ title: '觀光' }, 0, { canEdit: 'false' }), /<input/);
});

test('API validation preserves only custom names while the calendar stays authoritative', () => {
 const trip = { id: 'my-trip', startDate: '2027-04-12', endDate: '2027-04-13', timezone: 'Asia/Taipei' };
 const output = validateDays([{ title: '  自訂主題  ', date: 'evil', isoDate: '2000-01-01', stops: [] }, { title: '', stops: [] }], trip);
 assert.equal(output[0].title, '自訂主題');
 assert.equal(output[0].isoDate, '2027-04-12');
 assert.equal(output[0].date, '4/12');
 assert.equal(output[1].title, '第2天');
 assert.throws(() => validateDays([{ title: '旅'.repeat(121), stops: [] }, { stops: [] }], trip), /120/);
});

const origin = 'https://trip.example', owner = 'owner@example.com', viewer = 'viewer@example.com';
function request(path, method = 'GET', body, email = owner) {
 return new Request(origin + path, {
  method, headers: { 'oai-authenticated-user-id': email, Origin: origin, 'Content-Type': 'application/json', 'X-Trip-Client': 'multi-2' },
  body: body === undefined ? undefined : JSON.stringify(body),
 });
}

test('saved day names survive cloud reload, viewer reads and previous snapshots', async () => {
 const DB = localDatabase(), env = { DB, OWNER_EMAIL: owner };
 try {
  const created = await handleTrips(request('/api/trips', 'POST', { title: '日期命名驗證', startDate: '2027-04-12', endDate: '2027-04-13' }), env);
  assert.equal(created.status, 201);
  const data = await created.json(), endpoint = '/api/trip?trip=' + data.trip.id;
  data.days[0].title = '機場與市區散步';
  data.days[1].title = '咖啡 & 博物館';
  const save = await handleApi(request(endpoint, 'PUT', { days: data.days, revision: 0, mutationId: 'custom-names' }), env);
  assert.equal(save.status, 200);
  const reloaded = await (await handleApi(request(endpoint), env)).json();
  assert.deepEqual(reloaded.days.map(day => day.title), ['機場與市區散步', '咖啡 & 博物館']);
  const shared = await handleSharing(request('/api/shares?trip=' + data.trip.id, 'PUT', { email: viewer, role: 'viewer', enabled: true }), env);
  assert.equal(shared.status, 200);
  const view = await (await handleApi(request(endpoint, 'GET', undefined, viewer), env)).json();
  assert.deepEqual(view.days.map(day => day.title), reloaded.days.map(day => day.title));
  assert.equal(view.previous, null);
  assert.equal((await handleApi(request(endpoint, 'PUT', { days: data.days, revision: 1, mutationId: 'viewer-denied' }, viewer), env)).status, 403);
  data.days[0].title = '  ';
  assert.equal((await handleApi(request(endpoint, 'PUT', { days: data.days, revision: 1, mutationId: 'fallback-name' }), env)).status, 200);
  const again = await (await handleApi(request(endpoint), env)).json();
  assert.equal(again.days[0].title, '第1天');
  assert.equal(again.previous[0].title, '機場與市區散步');
  data.days[0].title = '超'.repeat(121);
  assert.equal((await handleApi(request(endpoint, 'PUT', { days: data.days, revision: 2, mutationId: 'invalid-name' }), env)).status, 400);
  const unchanged = await (await handleApi(request(endpoint), env)).json();
  assert.equal(unchanged.revision, 2);
  assert.equal(unchanged.days[0].title, '第1天');
 } finally {
  DB.close();
 }
});
