// 시험용 가짜 펼침면 — 앱이 자동 맞춤에서 그리는 크기(가로 600px)의 RGBA 를 직접 만든다.
// 글자는 작은 획 덩어리로 흉내 낸다. 한글은 빽빽한 네모 글자, 영어는 폭이 다른 낱자.
// 안쪽 여백은 좌우 대칭(실제 책처럼), 쪽 폭이 다르면 g 가 50% 에서 벗어난다.

// 작은 결정적 난수 (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} o
 *  g        제본선 위치(0~1)
 *  script   'ko' | 'en'
 *  align    'justify' | 'left'
 *  shadow   그림자 깊이(0~1, 0 이면 없음), shadowW 그림자 폭(px)
 *  skew     기울기(도)
 *  inner    안쪽 여백(전체 폭 대비), outer 바깥 여백
 *  empty    'L' | 'R' 이면 그쪽 쪽은 비움
 *  tintR    오른쪽 쪽 종이 밝기(기본은 왼쪽과 같음)
 */
export function makeSpread(o = {}) {
  const { W = 600, H = 424, g = 0.5, script = 'ko', align = 'justify', shadow = 0, shadowW = 14,
    skew = 0, inner = 0.07, outer = 0.09, empty = null, tintR = null, seed = 1 } = o;
  const R = rng(seed);
  const paperL = 240, paperR = tintR ?? paperL;
  const ink = new Float32Array(W * H);           // 0 = 종이, 1 = 먹
  const gx = W * g;
  const lineH = 9, glyphH = script === 'ko' ? 7 : 5;
  for (const side of ['L', 'R']) {
    if (empty === side) continue;
    const xa = side === 'L' ? Math.round(W * outer) : Math.round(gx + W * inner);
    const xb = side === 'L' ? Math.round(gx - W * inner) : Math.round(W * (1 - outer));
    for (let y = Math.round(H * 0.1); y + lineH < H * 0.9; y += lineH) {
      if (R() < 0.08) continue;                   // 문단 사이 빈 줄
      // 문단 끝 줄은 짧고, 왼쪽 정렬이면 나머지 줄도 낱말 하나만큼 들쭉날쭉
      const lineEnd = R() < 0.12 ? xa + Math.round(R() * (xb - xa) * 0.9)
        : align === 'justify' ? xb : xb - Math.round(R() * 25);
      let x = xa + (R() < 0.15 ? 7 : 0);          // 들여쓰기
      while (x < lineEnd) {
        const word = script === 'ko' ? 1 + Math.floor(R() * 4) : 2 + Math.floor(R() * 7);
        for (let c = 0; c < word && x < lineEnd; c++) {
          const gw = script === 'ko' ? 7 : 2 + Math.floor(R() * 3);
          const top = y + (script === 'en' && R() < 0.3 ? -2 : 0);
          for (let yy = top; yy < y + glyphH; yy++) for (let xx = x; xx < Math.min(x + gw - 1, lineEnd); xx++)
            if (R() < (script === 'ko' ? 0.45 : 0.55)) ink[yy * W + xx] = 1;
          x += gw;
        }
        x += script === 'ko' ? 4 : 3;
      }
    }
  }
  const d = new Uint8ClampedArray(W * H * 4);
  const t = Math.tan(skew * Math.PI / 180);
  for (let y = 0; y < H; y++) {
    const dx = (y - H / 2) * t;
    for (let x = 0; x < W; x++) {
      const sx = Math.round(x - dx);               // 기운 책: 줄마다 옆으로 밀림
      let L = sx < gx ? paperL : paperR;
      if (sx >= 0 && sx < W && ink[y * W + sx]) L = 35;
      if (shadow) L *= 1 - shadow * Math.exp(-(((sx - gx) / shadowW) ** 2));
      L += (R() - 0.5) * 10;
      const k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = L; d[k + 3] = 255;
    }
  }
  return { d, W, H };
}
