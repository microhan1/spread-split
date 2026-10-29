// 「자동 맞춤」 제본선 찾기(findGutter) 시험 — 의존성 없이 Node 내장 test runner 로 돈다.
//   node --test tests/*.test.mjs
// index.html 에서 findGutter 만 떼어, tests/spreads.mjs 로 만든 가짜 펼침면에 돌린다.
// 2026-10-29 독립 QA: 그림자 없는 빽빽한 한글 본문에서 오른쪽 쪽 글자의 왼쪽 끝(줄마다 같은
// 자리에서 시작하는 글자 열)을 그림자로 보고 분할선을 57~58% 로 옮겼다. 그 경우가 아래 첫 시험.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeSpread } from './spreads.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function loadFindGutter() {
  const start = HTML.indexOf('function findGutter(');
  const end = HTML.indexOf('/* ───────── build PDF');
  assert.ok(start > 0 && end > start, 'findGutter 구간을 찾음');
  const ctx = vm.createContext({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  vm.runInContext(HTML.slice(start, end) + '\nthis.findGutter = findGutter;', ctx);
  return ctx.findGutter;
}
const findGutter = loadFindGutter();
const run = o => { const s = makeSpread(o); return findGutter(s.d, s.W, s.H); };
const pct = v => (v * 100).toFixed(1) + '%';

test('그림자 없는 한국어 본문: 분할선이 본문 안으로 가지 않는다 (오차 1% 이내)', () => {
  for (const align of ['justify', 'left']) for (const g of [0.5, 0.46, 0.535]) for (const seed of [1, 2, 3]) {
    const r = run({ script: 'ko', align, g, seed });
    assert.ok(r && r.sure, `확신 있음 ${align} g=${g}`);
    assert.ok(Math.abs(r.pos - g) <= 0.01, `${align} g=${pct(g)} → ${pct(r.pos)}`);
  }
});

test('한국어·영어 × 그림자 있음/없음 × 기움 × 안쪽 여백: 오차 1% 이내 (2.5° 기움은 1.5%)', () => {
  for (const script of ['ko', 'en']) for (const align of ['justify', 'left']) for (const shadow of [0, 0.15, 0.4])
    for (const skew of [0, 1.5, -2.5]) for (const g of [0.5, 0.46, 0.535]) for (const inner of [0.07, 0.035]) {
      const r = run({ script, align, shadow, skew, g, inner });
      const tol = Math.abs(skew) > 2 ? 0.015 : 0.01;
      const name = `${script} ${align} 그림자 ${shadow} 기움 ${skew}° 안쪽 ${inner} g=${pct(g)}`;
      assert.ok(r && r.sure, `확신 있음: ${name}`);
      assert.ok(Math.abs(r.pos - g) <= tol, `${name} → ${pct(r.pos)}`);
    }
});

test('좌우 쪽 폭이 다르고 오른쪽 종이가 더 어두워도 그림자 바닥을 잡는다', () => {
  for (const g of [0.42, 0.58, 0.44]) for (const script of ['ko', 'en']) {
    const r = run({ script, g, shadow: 0.5, shadowW: 16, tintR: 200 });
    assert.ok(r && r.sure && Math.abs(r.pos - g) <= 0.005, `${script} g=${pct(g)} → ${r && pct(r.pos)}`);
  }
});

test('한쪽 쪽이 비었으면: 그림자가 있으면 그 자리, 없으면 확신 없음 + 50%', () => {
  for (const script of ['ko', 'en']) for (const empty of ['L', 'R']) for (const g of [0.5, 0.47, 0.53]) {
    const withShadow = run({ script, empty, g, shadow: 0.4 });
    assert.ok(withShadow.sure && Math.abs(withShadow.pos - g) <= 0.005, `그림자 ${script} ${empty} g=${pct(g)} → ${pct(withShadow.pos)}`);
    const plain = run({ script, empty, g });
    assert.equal(plain.sure, false, `그림자 없음 ${script} ${empty} g=${pct(g)} 은 확신 없음`);
    assert.equal(plain.pos, 0.5);
  }
});

test('빈 펼침면은 null', () => {
  const s = makeSpread({ empty: 'L' });
  for (let i = 0; i < s.d.length; i += 4) s.d[i] = s.d[i + 1] = s.d[i + 2] = 238 + (i % 7);
  assert.equal(findGutter(s.d, s.W, s.H), null);
});

test('확신 없는 쪽은 분할선을 옮기지 않고(손으로 맞춘 선 보존), 알림 문구가 4개 언어에 있다', () => {
  assert.match(HTML, /if \(f && f\.sure\) \{ S\.pages\[i\]\.pos = /);
  assert.match(HTML, /else unsure\.push\(i \+ 1\);/);
  const n = [...HTML.matchAll(/tUnsure: '[^']*\{list\}[^']*'/g)].length;
  assert.equal(n, 4, 'tUnsure 4개 언어');
});
