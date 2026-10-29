// 웹판 2차 개선(2026-10-29 독립 QA 후속) 시험 — 의존성 없이 Node 내장 test runner 로 돈다.
//   node --test tests/*.test.mjs
// 브라우저 없이 볼 수 있는 것만: CSS 규칙, 4개 언어 문구, 결과 문서 정보, 자동 맞춤 작업 겹침(가짜 단추로),
// 허브 동기화 스크립트가 치환하는 사용 설명 문장. 화면 넘침·터치는 헤드리스 Edge 로 따로 봤다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GUIDE = fs.readFileSync(path.join(ROOT, 'guide.html'), 'utf8');
const LANGS = ['ko', 'en', 'zh', 'ja'];
const style = s => s.slice(s.indexOf('<style>'), s.indexOf('</style>'));
const rule = (css, sel) => {
  const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, `CSS ${sel} 규칙`);
  return m[2];
};

function loadI18n() {
  const start = HTML.indexOf('const I18N = {');
  const end = HTML.indexOf('const LANG_KEY');
  const ctx = vm.createContext({});
  vm.runInContext(HTML.slice(start, end).replace('const I18N', 'this.I18N'), ctx);
  return ctx.I18N;
}

test('휴대폰: 미리보기 그림은 세로 쓸기를 막지 않고, 손가락 끌기는 분할선 손잡이만 가로챈다', () => {
  const css = style(HTML);
  assert.match(rule(css, '.thumb'), /touch-action:\s*pan-y/);
  assert.doesNotMatch(rule(css, '.thumb'), /touch-action:\s*none/);
  assert.match(rule(css, '.cut'), /touch-action:\s*none/);
});

test('글꼴 크기는 브라우저 설정을 따른다 (px 고정 없음, 기본 16px 에서 본문 15px 그대로)', () => {
  for (const [name, s] of [['index.html', HTML], ['guide.html', GUIDE]]) {
    const css = style(s);
    assert.deepEqual(css.match(/font(-size)?:[^;}]*\d+px/g) || [], [], `${name} 에 px 글꼴`);
  }
  assert.match(rule(style(HTML), 'body'), /font:\s*\.9375rem\/1\.55/);
  assert.match(rule(style(GUIDE), 'body'), /font:\s*1rem\/1\.75/);
});

test('머리말은 좁은 폭에서 줄바꿈된다 (사용 설명 320px 「도구 열기」 넘침)', () => {
  assert.match(rule(style(GUIDE), '.topbar'), /flex-wrap:\s*wrap/);
  assert.match(rule(style(HTML), '.topbar'), /flex-wrap:\s*wrap/);
});

test('분할선·쪽별 버튼 읽기 이름에 쪽 번호 — 4개 언어', () => {
  const I = loadI18n();
  for (const l of LANGS) {
    assert.match(I[l].cutLabel, /\{n\}/, `${l} cutLabel`);
    assert.match(I[l].modeAria, /\{n\}/, `${l} modeAria`);
    assert.match(I[l].modeAria, /\{m\}/, `${l} modeAria`);
  }
  assert.equal(I.ko.cutLabel.replace('{n}', 3), '3쪽 분할선');
  // 슬라이더 범위·값 글자
  assert.match(HTML, /setAttribute\('aria-valuemin', POS_MIN \* 100\)/);
  assert.match(HTML, /setAttribute\('aria-valuemax', POS_MAX \* 100\)/);
  assert.match(HTML, /setAttribute\('aria-valuetext', fmtPct\(s\)\)/);
});

test('결과 PDF 에 원본 제목·저자를 옮기지 않는다', () => {
  const b = HTML.slice(HTML.indexOf('async function build()'), HTML.indexOf('function paintDone()'));
  assert.ok(b.length > 100);
  for (const k of ['setTitle', 'setAuthor', 'getTitle', 'getAuthor', 'setSubject', 'setKeywords']) assert.ok(!b.includes(k), k);
  assert.ok(b.includes("out.setProducer(t('producer'))"));
});

test('언어를 바꾸면 만들어 둔 결과 칸도 새 언어로 다시 그린다', () => {
  const h = HTML.slice(HTML.indexOf("document.getElementById('lang').addEventListener('change'"), HTML.indexOf('if (!window.pdfjsLib'));
  assert.match(h, /if \(!el\.done\.hidden\) paintDone\(\);/);
});

/* 자동 맞춤: 「멈추기」 뒤 곧바로 다시 눌러도 찾기 작업은 하나만 돈다 */
function loadDetect() {
  const start = HTML.indexOf('let detectJob = null');
  const end = HTML.indexOf('async function detectGutter(');
  assert.ok(start > 0 && end > start, '자동 맞춤 구간을 찾음');
  const log = [];
  let active = 0, maxActive = 0, handler = null;
  const btn = {
    disabled: false, _t: '',
    set textContent(v) { this._t = v; log.push(v); }, get textContent() { return this._t; },
    addEventListener: (_, f) => { handler = f; },
  };
  const S = { gen: 0, detecting: false, pages: Array.from({ length: 6 }, () => ({ mode: 'split', pos: null })) };
  const ctx = vm.createContext({
    S, el: { btnAuto: btn }, setTimeout,
    t: (k, v) => k === 'autoBusy' ? `${v.done}/${v.total}` : k,
    toast: () => {}, refresh: () => {},
    detectGutter: () => { active++; maxActive = Math.max(maxActive, active); return new Promise(r => setTimeout(() => { active--; r({ pos: 0.5, sure: true }); }, 15)); },
  });
  vm.runInContext(HTML.slice(start, end), ctx);
  // 진짜 브라우저처럼 꺼진 단추는 눌리지 않는다
  const click = () => btn.disabled ? undefined : handler();
  return { S, btn, log, click, max: () => maxActive };
}
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('시간 초과'); await new Promise(r => setTimeout(r, 2)); } };
const nums = log => log.map(s => s.match(/^(\d+)\//)).filter(Boolean).map(m => +m[1]);

test('자동 맞춤: 멈춘 뒤 곧바로 다시 눌러도 작업이 겹치지 않고 진행 숫자가 0부터 한 칸씩', async () => {
  const D = loadDetect();
  D.click();
  await until(() => D.log.includes('2/6'));
  D.click();                    // 멈추기
  assert.equal(D.btn.disabled, true, '멈추는 동안 단추는 꺼짐');
  D.click();                    // 곧바로 다시 — 꺼진 단추라 무시
  await until(() => !D.btn.disabled);
  const cut = D.log.length;
  D.click();                    // 앞 작업이 끝난 뒤 다시
  await until(() => D.S.detecting === false && D.log.at(-1) === 'auto' && D.log.length > cut + 1);
  assert.equal(D.max(), 1, '동시에 도는 찾기 작업은 하나');
  assert.deepEqual(nums(D.log.slice(cut)), [0, 1, 2, 3, 4, 5]);
});

test('자동 맞춤: 다른 파일을 열어 멈춘 직후 누르면 앞 작업이 끝난 뒤 시작한다', async () => {
  const D = loadDetect();
  D.click();
  await until(() => D.log.includes('1/6'));
  D.S.detecting = false; D.S.gen++;     // openFile 이 하는 일
  const cut = D.log.length;
  D.click();                            // 단추는 켜져 있음 — 앞 작업을 기다렸다가 시작
  await until(() => D.S.detecting === false && nums(D.log.slice(cut)).length === 6 && D.log.at(-1) === 'auto');
  assert.equal(D.max(), 1, '동시에 도는 찾기 작업은 하나');
  assert.deepEqual(nums(D.log.slice(cut)), [0, 1, 2, 3, 4, 5]);
});

/* 허브 sync_spreadsplit.py 가 사이트판에서 바꿔 끼우는 문장. 이 글자를 바꾸면 허브 동기화도 같이 고쳐야 한다. */
const LIB_NOTE = {
  ko: '처음 열 때 PDF를 읽는 프로그램(pdf.js, pdf-lib)을 인터넷에서 받아오기 때문에 인터넷 연결만 있으면 돼요.',
  en: 'An internet connection is only needed the first time, to fetch the PDF libraries (pdf.js and pdf-lib).',
  zh: '只有第一次打开时需要联网下载 PDF 库（pdf.js、pdf-lib）。',
  ja: '最初に開くとき PDF ライブラリ（pdf.js、pdf-lib）をダウンロードするため、その時だけインターネット接続が必要です。',
};
test('사용 설명: 「인터넷에서 받아오기」 문장은 언어마다 하나씩, 동기화가 치환할 고정 표식 안에 있다', () => {
  const spans = [...GUIDE.matchAll(/<span data-sync="lib-note">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.equal(spans.length, 4);
  for (const l of LANGS) {
    const art = GUIDE.slice(GUIDE.indexOf(`<article class="doc" data-lang="${l}">`));
    const body = art.slice(0, art.indexOf('</article>'));
    assert.ok(body.includes(`<span data-sync="lib-note">${LIB_NOTE[l]}</span>`), l);
    assert.equal(GUIDE.split(LIB_NOTE[l]).length - 1, 1, `${l} 문장은 파일 전체에서 하나`);
  }
});
