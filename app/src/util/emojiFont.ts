export const NOTO_EMOJI_FONT_PATH = "appearance/fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2";

// 组合表情需覆盖完整序列的码点；这些码点对应的独立表情也使用 Noto，保证组合字形完整。
const UNICODE_17_EMOJI_RANGE = "U+200d, U+2640, U+2642, U+fe0f, U+1f3fb-1f3ff, U+1f430, U+1f468-1f469, " +
    "U+1f46f, U+1f6d8, U+1f93c, U+1f9d1, U+1fa70, U+1fa8a, U+1fa8e, U+1fac8, U+1facd, U+1faea, U+1faef";

const DEJAVU_EMOJI_PRESENTATION_UNICODE_RANGE = "U+25fd-25fe, U+2614-2615, U+2648-2653, U+267f, U+2693, U+26a1, " +
    "U+26aa-26ab, U+1f0cf, U+1f311-1f318, U+1f42d-1f42e, U+1f431, U+1f435, U+1f600-1f64f";

export const getEmojiFontStyle = (platform: "apple" | "windows11" | "other", servePath: string) => {
    let style;
    // Emojis Reset：覆盖正文和代码字体中的表情字形。
    // Emojis Additional：为系统表情字体补充指定字符和组合。
    if (platform === "apple") {
        style = `@font-face {
  font-family: "Emojis Additional";
  src: url(${servePath}${NOTO_EMOJI_FONT_PATH}) format("woff2");
  unicode-range: ${UNICODE_17_EMOJI_RANGE}, U+1fae9, U+1fac6, U+1fabe, U+1fadc, U+e50a, U+1fa89, U+1fadf, U+1f1e6-1f1ff, U+1fa8f;
}
@font-face {
  font-family: "Emojis Reset";
  src: local("Apple Color Emoji"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  unicode-range: U+21a9, U+21aa, U+2122, U+2194-2199, U+23cf, U+25b6, U+25c0, U+25fb, U+25fc, U+25aa, U+25ab, U+2600-2603,
  U+260e, U+2611, U+261d, U+2639, U+263a, U+2640, U+2642, U+2660, U+2663, U+2665, U+2666, U+2668, U+267b, U+26aa, U+26ab,
  U+2702, U+2708, U+2934, U+2935, U+1f170, U+1f171, U+1f17e, U+1f17f, U+1f202, U+1f21a, U+1f22f, U+1f232-1f23a, U+1f250,
  U+1f251, U+1fae4, U+2049, U+203c, U+3030, U+303d, U+24c2, U+26a0, U+26a1, U+26be, U+27a1, U+2b05-2b07, U+3297, U+3299, U+a9, U+ae,
  ${DEJAVU_EMOJI_PRESENTATION_UNICODE_RANGE};
  size-adjust: 115%;
}
@font-face {
  font-family: "Emojis";
  src: local("Apple Color Emoji"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  size-adjust: 115%;
}`;
    } else if (platform === "windows11") {
        style = `@font-face {
  font-family: "Emojis Additional";
  src: url(${servePath}${NOTO_EMOJI_FONT_PATH}) format("woff2");
  unicode-range: ${UNICODE_17_EMOJI_RANGE}, U+1fae9, U+1fac6, U+1fabe, U+1fadc, U+e50a, U+1fa89, U+1fadf, U+1f1e6-1f1ff, U+1f3f4, U+e0067, U+e0062,
  U+e0065, U+e006e, U+e007f, U+e0073, U+e0063, U+e0074, U+e0077, U+e006c;
  size-adjust: 85%;
}
@font-face {
  font-family: "Emojis Reset";
  src: local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  unicode-range: U+263a, U+21a9, U+2642, U+303d, U+2197, U+2198, U+2199, U+2196, U+2195, U+2194, U+2660, U+2665, U+2666,
  U+2663, U+3030, U+21aa, U+25b6, U+25c0, U+2640, U+203c, U+a9, U+ae, U+2122, ${DEJAVU_EMOJI_PRESENTATION_UNICODE_RANGE};
  size-adjust: 85%;
}
@font-face {
  font-family: "Emojis";
  src: local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  size-adjust: 85%;
}`;
    } else {
        style = `@font-face {
  font-family: "Emojis Reset";
  src: url(${servePath}${NOTO_EMOJI_FONT_PATH}) format("woff2");
  unicode-range: ${UNICODE_17_EMOJI_RANGE}, U+1f170-1f171, U+1f17e, U+1f17f, U+1f21a, U+1f22f, U+1f232-1f23a, U+1f250, U+1f251, U+1f32b, U+1f3bc,
  U+1f411, U+1f42d, U+1f42e, U+1f431, U+1f435, U+1f441, U+1f4a8, U+1f4ab, U+1f525, ${DEJAVU_EMOJI_PRESENTATION_UNICODE_RANGE},
  U+1f79, U+1f8f, U+1fa79, U+1fae4, U+1fae9, U+1fac6, U+1fabe, U+1fadf,
  U+200d, U+203c, U+2049, U+2122, U+2139, U+2194-2199, U+21a9, U+21aa, U+23cf, U+25aa, U+25ab, U+25b6, U+25c0, U+25fb-25fe,
  U+2611, U+2615, U+2618, U+261d, U+2620, U+2622, U+2623, U+2626, U+262a, U+262e, U+2638-263a, U+2640, U+2642, U+2648-2653,
  U+265f, U+2660, U+2663, U+2665, U+2666, U+267b, U+267e, U+267f, U+2692-2697, U+2699, U+269b, U+269c, U+26a0, U+26a1,
  U+26a7, U+26aa, U+26ab, U+26b0, U+26b1, U+2702, U+2708, U+2709, U+270c, U+270d, U+2712, U+2714, U+2716, U+271d, U+2733,
  U+2734, U+2744, U+2747, U+2763, U+2764, U+2934-2935, U+3030, U+303d, U+3297, U+3299, U+fe0f, U+e50a, U+a9, U+ae;
  size-adjust: 92%;
}
@font-face {
  font-family: "Emojis";
  src: url(${servePath}${NOTO_EMOJI_FONT_PATH}) format("woff2"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol"),
  local("Apple Color Emoji"),
  local("Twemoji Mozilla"),
  local("Noto Color Emoji"),
  local("Android Emoji"),
  local("EmojiSymbols");
  size-adjust: 92%;
}`;
    }
    return style;
};
