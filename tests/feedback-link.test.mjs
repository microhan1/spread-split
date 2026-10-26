// 꼬리말 「의견 보내기」 링크 시험 — 의존성 없이 Node 내장 test runner 로 돈다.
//   node --test tests/*.test.mjs
// 네트워크 요청은 하지 않는다. index.html 의 i18n·applyLang 부분만 떼어 가짜 DOM 위에서 돌리고,
// 허브 저장소(D:\my\ReadBooksProject)가 있으면 sync_spreadsplit.py 를 임시 폴더로 돌려 사본·서비스 워커까지 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LANGS = ['ko', 'en', 'zh', 'ja'];
const SITE = 'https://chaekgalpi.co.kr';
const HUB = process.env.HUB_ROOT || 'D:\\my\\ReadBooksProject';
const SYNC = path.join(HUB, 'DotNet', 'tools', 'AppsSync', 'sync_spreadsplit.py');
const HUB_SITE = path.join(HUB, 'DotNet', 'ReadBook.Api', 'wwwroot', 'apps', 'spreadsplit');

const decode = s => s.replaceAll('&amp;', '&');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const footer = () => {
  const m = HTML.match(/<footer[^>]*>([\s\S]*?)<\/footer>/g);
  assert.equal(m?.length, 1, '꼬리말은 하나');
  return m[0];
};

/* 가짜 DOM: 태그를 정규식으로 읽어 id·data-* 가 있는 요소만 만든다. applyLang 이 쓰는 만큼만. */
function fakeDom() {
  const els = [];
  for (const m of HTML.matchAll(/<(\w+)(\s[^>]*)?>/g)) {
    const a = attrs(m[2] || '');
    if (!a.id && !Object.keys(a).some(k => k.startsWith('data-'))) continue;
    const dataset = {};
    for (const k in a) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[k];
    els.push({ tag: m[1], id: a.id, href: a.href, target: a.target, dataset, innerHTML: '', value: '', title: '',
      setAttribute(k, v) { this[k] = v; } });
  }
  const sel = { '[data-i18n]': 'i18n', '[data-i18n-title]': 'i18nTitle', '[data-i18n-aria]': 'i18nAria' };
  return {
    els,
    documentElement: { lang: 'ko' },
    title: '',
    getElementById: id => els.find(e => e.id === id) || null,
    querySelectorAll: s => els.filter(e => e.dataset[sel[s]] !== undefined),
  };
}

/* index.html 스크립트에서 i18n ~ applyLang 까지(「const I18N」부터 「const $ =」 앞까지)만 떼어 돌린다. */
function loadI18n({ languages = ['ko-KR'], saved = null } = {}) {
  const start = HTML.indexOf('const I18N = {');
  const end = HTML.indexOf('const $ = (s, r = document)');
  assert.ok(start > 0 && end > start, 'i18n 구간을 찾음');
  const document = fakeDom();
  const mem = saved ? { 'spreadSplit.lang': saved } : {};
  const ctx = vm.createContext({
    document, navigator: { languages, language: languages[0] },
    localStorage: { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } },
  });
  const api = vm.runInContext(HTML.slice(start, end) + ';({ I18N, applyLang, detectLang, t, lang: () => LANG })', ctx);
  return { ...api, document, link: () => document.getElementById('lnkFeedback'), tools: () => document.getElementById('lnkFootTools') };
}

function expectFeedback(href, lang) {
  const u = new URL(href);
  assert.equal(u.origin, SITE);
  assert.equal(u.pathname, (lang === 'ko' ? '' : '/en') + '/tools/spreadsplit', `${lang} 경로`);
  assert.equal(u.searchParams.get('utm_source'), 'web');
  assert.equal(u.searchParams.get('utm_medium'), 'feedback');
  assert.equal(u.hash, '#feedback');
  assert.ok(!href.includes('pwa'));
}

/* ── a. 꼬리말 마크업 ── */
test('a. 꼬리말에 lnkFeedback 이 정확히 1개, 절대 주소·utm·#feedback', () => {
  assert.equal(HTML.match(/id="lnkFeedback"/g).length, 1);
  const f = footer();
  const tag = f.match(/<a [^>]*id="lnkFeedback"[^>]*>/)[0];
  const a = attrs(tag);
  assert.ok(a.href.startsWith(SITE + '/tools/spreadsplit?'), a.href);
  expectFeedback(a.href, 'ko');
  assert.equal(a['data-track'], 'spreadsplit-web-feedback');
  assert.equal(a['data-i18n'], 'footFeedback');
  assert.equal(a.rel, 'noopener', '새 탭 링크는 noopener');
  assert.match(f, />의견 보내기<\/a>/);
  // 「책갈피 툴 전체」 바로 옆
  assert.match(f, /data-i18n="footTools">책갈피 툴 전체<\/a> · <a [^>]*id="lnkFeedback"/);
});

test('a. 파일 어디에도 utm_source=pwa 가 없다', () => {
  assert.ok(!HTML.includes('utm_source=pwa'));
});

test('a. 의견 링크는 페이지 이동뿐 — 폼·fetch·sendBeacon 으로 파일을 보내는 코드가 새로 생기지 않았다', () => {
  assert.ok(!/<form\b/i.test(HTML));
  assert.ok(!/sendBeacon|XMLHttpRequest/.test(HTML));
  assert.ok(!/\bfetch\(/.test(HTML), '원본은 fetch 를 쓰지 않는다');
});

/* ── b. 언어 전환 ── */
test('b. ko → en → ko 전환에 따라 주소가 바뀐다', () => {
  const s = loadI18n();
  s.applyLang('ko'); expectFeedback(s.link().href, 'ko');
  s.applyLang('en'); expectFeedback(s.link().href, 'en');
  s.applyLang('ko'); expectFeedback(s.link().href, 'ko');
});

test('b. 지원 언어 전부(ko·en·zh·ja), 한국어 외는 /en/', () => {
  const s = loadI18n();
  for (const l of LANGS) {
    s.applyLang(l);
    assert.equal(s.lang(), l);
    expectFeedback(s.link().href, l);
    assert.equal(s.tools().href, SITE + (l === 'ko' ? '' : '/en') + '/tools');
  }
});

test('b. 모든 언어 쌍 순서로 바꿔도 앞 언어 주소가 남지 않는다', () => {
  const s = loadI18n();
  for (const a of LANGS) for (const b of LANGS) {
    s.applyLang(a); s.applyLang(b);
    expectFeedback(s.link().href, b);
  }
});

test('b. 알 수 없는 언어는 이 앱의 기본 언어(en)로 → /en/', () => {
  const s = loadI18n();
  for (const bad of ['fr', 'zh-CN', 'KO', '', undefined, null]) {
    s.applyLang('ko');
    s.applyLang(bad);
    assert.equal(s.lang(), 'en', String(bad));
    expectFeedback(s.link().href, 'en');
  }
  // 'I18N[lang]' 검사를 통과하는 원래부터의 틈('__proto__')에서도 의견 링크는 기본 언어 쪽 /en/ 이다
  s.applyLang('ko'); s.applyLang('__proto__');
  expectFeedback(s.link().href, 'en');
});

test('b. 첫 화면 언어(브라우저 언어·저장값)에 맞는 주소', () => {
  const cases = [
    [{ languages: ['ko-KR', 'en'] }, 'ko'],
    [{ languages: ['ja-JP'] }, 'ja'],
    [{ languages: ['zh-CN', 'zh'] }, 'zh'],
    [{ languages: ['fr-FR', 'de'] }, 'en'],
    [{ languages: ['en-US'], saved: 'ko' }, 'ko'],
    [{ languages: ['ko-KR'], saved: 'xx' }, 'ko'],
  ];
  for (const [opt, want] of cases) {
    const s = loadI18n(opt);
    s.applyLang(s.detectLang());
    assert.equal(s.lang(), want, JSON.stringify(opt));
    expectFeedback(s.link().href, want);
  }
});

/* ── c. 문구 ── */
test('c. footFeedback·footTools 가 모든 언어 사전에 있고 비어 있지 않다', () => {
  const { I18N } = loadI18n();
  assert.deepEqual(Object.keys(I18N).sort(), [...LANGS].sort());
  const want = { ko: '의견 보내기', en: 'Send feedback', zh: '发送反馈', ja: 'ご意見を送る' };
  for (const l of LANGS) {
    assert.equal(I18N[l].footFeedback, want[l]);
    assert.ok(I18N[l].footTools && I18N[l].footTools.trim(), `${l} footTools`);
  }
});

test('c. 전환 뒤 링크 글자가 그 언어 문구로 바뀐다', () => {
  const s = loadI18n();
  const seen = new Set();
  for (const l of [...LANGS, 'ko']) {
    s.applyLang(l);
    assert.equal(s.link().innerHTML, s.I18N[l].footFeedback);
    assert.equal(s.tools().innerHTML, s.I18N[l].footTools);
    seen.add(s.link().innerHTML);
  }
  assert.equal(seen.size, LANGS.length, '언어마다 글자가 다르다');
});

/* ── e. 회귀 ── */
test('e. 화면에 쓰인 data-i18n 키가 모든 언어 사전에 있다', () => {
  const { I18N } = loadI18n();
  const keys = new Set([...HTML.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map(m => m[1]));
  for (const l of LANGS) for (const k of keys) assert.ok(k in I18N[l], `${l}.${k}`);
});

test('e. 기존 링크·이동 장치가 그대로다', () => {
  assert.ok(HTML.includes(`if (location.hostname.endsWith('github.io')) location.replace('https://chaekgalpi.co.kr/apps/spreadsplit/' + location.search + location.hash);`));
  assert.ok(HTML.includes('<link rel="canonical" href="https://chaekgalpi.co.kr/apps/spreadsplit/">'));
  assert.ok(HTML.includes('<a href="https://chaekgalpi.co.kr/apps/spreadsplit/">https://chaekgalpi.co.kr/apps/spreadsplit/</a>'), 'noscript 안내');
  assert.match(HTML, /<a class="link-btn" id="guideLink" href="guide\.html" target="_blank" rel="noopener">/);
  const s = loadI18n();
  for (const l of LANGS) { s.applyLang(l); assert.equal(s.document.getElementById('guideLink').href, 'guide.html#' + l); }
  assert.match(footer(), /href="https:\/\/chaekgalpi\.co\.kr\/tools" id="lnkFootTools"/);
});

test('e. 페이지 스크립트가 문법 오류 없이 읽힌다', () => {
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 2);
  for (const s of scripts) new vm.Script(s);
  assert.equal(HTML.match(/<\/body>/g).length, 1, '허브 동기화가 </body> 를 한 번만 찾는다');
});

/* ── d·f. 허브 사본·서비스 워커 (허브 저장소가 있을 때만) ── */
const hasHub = fs.existsSync(SYNC) && fs.existsSync(path.join(HUB_SITE, 'sw.js'));
let syncOut = null;
function runSync() {
  if (syncOut) return syncOut;
  syncOut = fs.mkdtempSync(path.join(os.tmpdir(), 'spreadsplit-sync-'));
  // --out 이면 사이트 사본은 건드리지 않고 임시 폴더에만 쓴다(sync_spreadsplit.py main 참고).
  execFileSync('python', [SYNC, '--src', ROOT, '--out', syncOut], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  return syncOut;
}
after(() => { if (syncOut) fs.rmSync(syncOut, { recursive: true, force: true }); });
const swVersion = s => s.match(/const VERSION = '([^']*)';/)[1];
const swAssets = s => JSON.parse(s.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replaceAll("'", '"'));

test('d. 허브 동기화가 새 원본에 그대로 붙고, sw.js VERSION 이 바뀐다', { skip: !hasHub && '허브 저장소 없음' }, () => {
  const out = runSync();
  const idx = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.equal(idx.match(/id="lnkFeedback"/g).length, 1);
  assert.ok(!/cdnjs|jsdelivr/.test(idx));
  const before = swVersion(fs.readFileSync(path.join(HUB_SITE, 'sw.js'), 'utf8'));
  const after = swVersion(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'));
  assert.match(after, /^spreadsplit-[0-9a-f]{10}$/);
  assert.notEqual(after, before, `옛 ${before} → 새 ${after}`);
});

test('d. 미리 저장 목록(ASSETS)이 모두 있는 파일을 가리킨다', { skip: !hasHub && '허브 저장소 없음' }, () => {
  const out = runSync();
  const assets = swAssets(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'));
  assert.ok(assets.length > 5);
  for (const a of assets) {
    const rel = a === './' ? 'index.html' : a;
    // 아이콘·manifest 는 동기화가 만들지 않고 사이트 사본에 있는 그대로 쓴다
    assert.ok(fs.existsSync(path.join(out, rel)) || fs.existsSync(path.join(HUB_SITE, rel)), a);
  }
});

/* 서비스 워커 fetch 처리기를 가짜 self·caches·fetch 위에서 돌린다. */
function loadSw(src, { online }) {
  const handlers = {};
  const cache = new Map([['/apps/spreadsplit/', 'CACHED:index'], ['./', 'CACHED:index']]);
  const store = { match: async k => cache.get(typeof k === 'string' ? k : new URL(k.url).pathname) ?? null, put: async () => {} };
  const ctx = vm.createContext({
    self: { location: { origin: SITE }, addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => store, match: async k => cache.get(k) ?? null, keys: async () => [] },
    fetch: async () => { if (!online) throw new TypeError('offline'); return { ok: true, clone() { return this; }, body: 'NET' }; },
    URL, Response: { error: () => 'ERROR' }, Promise,
  });
  vm.runInContext(src, ctx);
  return async (url, mode = 'navigate') => {
    let responded = null;
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: p => { responded = p; }, waitUntil() {} });
    return responded === null ? 'PASS-THROUGH' : await responded;
  };
}

test('f. 오프라인: 의견 링크(ko·en)는 서비스 워커가 가로채지 않아 저장본 화면이 대신 뜨지 않는다', { skip: !hasHub && '허브 저장소 없음' }, async () => {
  const sw = fs.readFileSync(path.join(runSync(), 'sw.js'), 'utf8');
  for (const online of [false, true]) {
    const go = loadSw(sw, { online });
    for (const l of LANGS) {
      const s = loadI18n(); s.applyLang(l);
      assert.equal(await go(s.link().href), 'PASS-THROUGH', `${l} online=${online}`);
      assert.equal(await go(s.tools().href), 'PASS-THROUGH');
    }
    // 같은 origin 의 상대 주소였더라도(허브 안 /tools/…) 범위 밖이라 그대로 보낸다
    assert.equal(await go(SITE + '/tools/spreadsplit?utm_source=web&utm_medium=feedback#feedback'), 'PASS-THROUGH');
  }
  // 대조군: 앱 화면 자체는 오프라인에서 저장본으로 열린다(처리기가 살아 있음을 확인)
  const off = loadSw(sw, { online: false });
  assert.equal(await off(SITE + '/apps/spreadsplit/'), 'CACHED:index');
});
