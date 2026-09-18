import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {describe, it} from "node:test";
import {getEmojiFontStyle, NOTO_EMOJI_FONT_PATH} from "./emojiFont";

const appPath = path.resolve(__dirname, "../..");
const sequences: string[] = JSON.parse(readFileSync(path.join(appPath, "tests/fixtures/unicode17-emoji.json"), "utf8"));
const categories: IEmoji[] = JSON.parse(readFileSync(path.join(appPath, "appearance/emojis/conf.json"), "utf8"));

describe("Unicode 17 emoji fonts", () => {
    it("covers every code point of the 163 new fully qualified sequences in each platform override", () => {
        assert.equal(sequences.length, 163);
        for (const platform of ["apple", "windows11", "other"] as const) {
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
            const style = getEmojiFontStyle(platform, "");
            const mainFace = style.slice(style.lastIndexOf("@font-face"));
            assert.ok(mainFace.includes(`src: local("${native}")`));
            assert.ok(!mainFace.includes(NOTO_EMOJI_FONT_PATH));
        }
        const other = getEmojiFontStyle("other", "");
        assert.ok(other.slice(other.lastIndexOf("@font-face")).includes(`src: url(${NOTO_EMOJI_FONT_PATH})`));
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
