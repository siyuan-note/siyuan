import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {describe, it} from "node:test";
import {getEmojiFontStyle, NOTO_EMOJI_FONT_PATH} from "./emojiFont";

const appPath = path.resolve(__dirname, "../..");
const sequences: string[] = JSON.parse(readFileSync(path.join(appPath, "tests/fixtures/unicode17-emoji.json"), "utf8"));
const categories: IEmoji[] = JSON.parse(readFileSync(path.join(appPath, "appearance/emojis/conf.json"), "utf8"));

// 按 family 取出单个 @font-face 声明，避免新增字体块改变既有断言指向的声明
const getFace = (style: string, family: string) => style.split("@font-face").find(face =>
    face.includes(`font-family: "${family}"`)) || "";

describe("Unicode 17 emoji fonts", () => {
    it("covers every code point of the 163 new fully qualified sequences in each platform override", () => {
        assert.equal(sequences.length, 163);
        for (const platform of ["apple", "windows11", "windows", "other"] as const) {
            const style = getEmojiFontStyle(platform, "../../../");
            const firstFace = style.slice(0, style.indexOf("}"));
            assert.ok(firstFace.includes(NOTO_EMOJI_FONT_PATH));
            const ranges = firstFace.match(/unicode-range: ([^;]+);/)[1].split(",").map(range => {
                const [start, end] = range.trim().slice(2).split("-").map(value => parseInt(value, 16));
                return [start, end ?? start];
            });
            for (const sequence of sequences) {
                for (const value of sequence.split("-")) {
                    const code = parseInt(value, 16);
                    assert.ok(ranges.some(([start, end]) => code >= start && code <= end), `${platform}: ${sequence} misses ${value}`);
                }
            }
        }
    });

    it("keeps native emoji sources on Apple and Windows 11 and bundled sources elsewhere", () => {
        for (const [platform, native] of [["apple", "Apple Color Emoji"], ["windows11", "Segoe UI Emoji"]] as const) {
            const mainFace = getFace(getEmojiFontStyle(platform, ""), "Emojis");
            assert.ok(mainFace.includes(`src: local("${native}")`));
            assert.ok(!mainFace.includes(NOTO_EMOJI_FONT_PATH));
        }
        assert.ok(getFace(getEmojiFontStyle("other", ""), "Emojis").includes(`src: url(${NOTO_EMOJI_FONT_PATH})`));
    });

    it("declares an ink-aligned icon face only where the native emoji metrics are off-center", () => {
        // 图标需与相邻文字的视觉中心对齐：Segoe UI Emoji 原度量会让字形比中文偏低约 0.75px，
        // 因此把 ascent/descent 改写为 80%/19%，和仍保持 99% 不改变行盒高度。
        const iconFace = getFace(getEmojiFontStyle("windows11", ""), "Emojis Icon");
        assert.ok(iconFace.includes('local("Segoe UI Emoji")'));
        assert.ok(iconFace.includes("size-adjust: 85%"));
        assert.ok(iconFace.includes("ascent-override: 80%"));
        assert.ok(iconFace.includes("descent-override: 19%"));
        assert.ok(iconFace.includes("line-gap-override: 0%"));
        // 其他平台的字体栈与文字度量不同，尚未标定，保持原有声明。
        for (const platform of ["apple", "other"] as const) {
            assert.equal(getFace(getEmojiFontStyle(platform, ""), "Emojis Icon"), "");
        }
    });

    it("aligns the bundled Windows file tree font without changing body or other platform metrics", () => {
        const windows = getEmojiFontStyle("windows", "");
        const treeFace = getFace(windows, "Emojis File Tree");
        assert.ok(treeFace.includes(`src: url(${NOTO_EMOJI_FONT_PATH})`));
        assert.ok(treeFace.includes("size-adjust: 92%"));
        assert.ok(treeFace.includes("ascent-override: 86%"));
        assert.ok(treeFace.includes("descent-override: 31%"));
        assert.ok(treeFace.includes("line-gap-override: 0%"));
        for (const family of ["Emojis", "Emojis Reset"]) {
            assert.equal(getFace(windows, family).trim(), getFace(getEmojiFontStyle("other", ""), family).trim());
        }
        for (const platform of ["apple", "windows11", "other"] as const) {
            assert.equal(getFace(getEmojiFontStyle(platform, ""), "Emojis File Tree"), "");
        }
    });

    it("resolves the same bundled font from app, PDF and offline HTML paths", () => {
        const font = readFileSync(path.join(appPath, NOTO_EMOJI_FONT_PATH));
        assert.equal(font.subarray(0, 4).toString(), "wOF2");
        for (const prefix of ["../../../", "", "http://127.0.0.1:6806/"]) {
            assert.ok(getEmojiFontStyle("windows11", prefix).includes(`url(${prefix}${NOTO_EMOJI_FONT_PATH})`));
        }
        const template = readFileSync(path.join(appPath, "src/assets/template/app/index.tpl"), "utf8");
        assert.ok(template.includes(`href="../../../${NOTO_EMOJI_FONT_PATH}"`));
        const exporter = readFileSync(path.join(appPath, "../kernel/model/appearance_export.go"), "utf8");
        assert.ok(exporter.includes(`"${NOTO_EMOJI_FONT_PATH.split("/")[2]}"`));
    });

    it("adds localized base emoji without expanding skin tone variants in the picker", () => {
        const expected: Record<string, string> = {
            "1faea": "people", "1faef": "people", "1fac8": "people", "1f9d1-200d-1fa70": "people",
            "1facd": "nature", "1f6d8": "travel", "1fa8a": "objects", "1fa8e": "objects",
        };
        const items = categories.flatMap(category => category.items);
        assert.equal(new Set(items.map(item => item.unicode)).size, items.length);
        const added = items.filter(item => sequences.includes(item.unicode));
        assert.deepEqual(added.map(item => item.unicode).sort(), Object.keys(expected).sort());
        for (const [unicode, categoryID] of Object.entries(expected)) {
            const item = categories.find(category => category.id === categoryID).items.find(item => item.unicode === unicode);
            assert.ok(item);
            for (const key of ["description", "description_zh_cn", "description_ja_jp", "keywords"] as const) {
                assert.ok(item[key]?.trim(), `${unicode}: ${key}`);
            }
            assert.notEqual(item.description, item.description_zh_cn);
            assert.notEqual(item.description, item.description_ja_jp);
            assert.ok(/^[a-f0-9]+(?:-[a-f0-9]+)*$/.test(item.unicode));
        }
    });
});
