'use strict';
// カルテ1ページ分の下地（左半分に人体図 前面・背面、右半分は白紙）をSVGで作る。
// 座標はページ全体を 1600 x 1000 とした論理座標。

const BODY_SVG = (() => {
  // 体の右半分の輪郭（中心 x=0、見る人から見て右側）。首 → 腕 → 胴 → 脚 → 股 の順。
  const half = [
    [20, 122], [24, 150],
    [60, 168], [98, 182], [118, 205],                       // 肩
    [128, 250], [136, 330], [146, 400], [154, 455],         // 腕の外側
    [160, 480], [162, 520], [154, 548], [142, 550], [134, 530], [130, 490], // 手
    [124, 460], [114, 400], [106, 330], [96, 262],          // 腕の内側
    [88, 300], [80, 370], [86, 420], [96, 470], [100, 520], // 胴・腰
    [96, 600], [84, 680], [86, 740], [72, 810], [60, 850],  // 脚の外側
    [72, 880], [64, 895], [26, 895], [24, 870],             // 足
    [26, 850], [30, 800], [28, 740], [24, 690], [16, 610], [6, 545], [0, 532] // 脚の内側・股
  ];
  const mirrored = half.slice().reverse().map(([x, y]) => [-x, y]).slice(1);
  const outline = smooth(half.concat(mirrored));

  function smooth(pts) {
    const f = (n) => Math.round(n * 10) / 10;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  const figure = (x, title, leftLabel, rightLabel, marks) => `
    <g transform="translate(${x},60)">
      <text x="0" y="-22" class="t">${title}</text>
      <text x="-112" y="60" class="lr">${leftLabel}</text>
      <text x="112" y="60" class="lr">${rightLabel}</text>
      <ellipse cx="0" cy="65" rx="46" ry="58" class="o"/>
      <path d="${outline}" class="o"/>
      ${marks}
    </g>`;

  // 前面：鎖骨・へそ・膝
  const front = `
    <path d="M-14 176 Q-50 170 -88 186 M14 176 Q50 170 88 186" class="m"/>
    <circle cx="0" cy="405" r="3" class="m"/>
    <path d="M-72 680 Q-54 690 -36 680 M72 680 Q54 690 36 680" class="m"/>`;

  // 背面：背骨・肩甲骨・お尻・膝裏
  const back = `
    <path d="M0 150 L0 470" class="m d"/>
    <path d="M28 205 Q60 198 76 210 Q70 250 56 282 Q38 250 28 205 Z" class="m"/>
    <path d="M-28 205 Q-60 198 -76 210 Q-70 250 -56 282 Q-38 250 -28 205 Z" class="m"/>
    <path d="M0 480 L0 530 M8 548 Q50 560 94 540 M-8 548 Q-50 560 -94 540" class="m"/>
    <path d="M-74 690 L-34 690 M74 690 L34 690" class="m"/>`;

  return `<svg viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">
    <style>
      .o { fill: none; stroke: #9aa4b0; stroke-width: 2.2; stroke-linejoin: round; }
      .m { fill: none; stroke: #bcc4cd; stroke-width: 1.8; }
      .d { stroke-dasharray: 6 6; }
      .t { font: 600 26px sans-serif; fill: #8a94a0; text-anchor: middle; }
      .lr { font: 22px sans-serif; fill: #a3acb6; text-anchor: middle; }
    </style>
    ${figure(210, '前面', '右', '左', front)}
    ${figure(590, '背面', '左', '右', back)}
    <line x1="800" y1="24" x2="800" y2="976" stroke="#e3e6ea" stroke-width="2"/>
  </svg>`;
})();
