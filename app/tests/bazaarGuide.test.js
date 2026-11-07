const assert = require("node:assert/strict");
const {readFileSync, readdirSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const keys = [
    "sortByReleaseTimeDesc", "sortByReleaseTimeAsc",
    "bazaarHideUnsupportedVersion", "bazaarHideIncompatiblePlatform",
];
const readJSON = file => JSON.parse(readFileSync(path.join(appRoot, file), "utf8"));
const textContent = node => (node.Data ?? node.TextMarkTextContent ?? "") +
    (node.Children ?? []).map(textContent).join("");
const guides = [
    {
        language: "en",
        file: "guide/20210808180117-6v0mkxr/20200923234011-ieuun1p/20210808180303-axh6q1d/20200924095938-a9p5450.sy",
        section: "20201225221416-enetgqg",
        filterTerms: ["separately or together", "off by default", "each package type", "Downloaded and update lists are unaffected"],
        releaseTerms: ["first listing time", "missing or invalid dates appear last"],
    },
    {
        language: "zh-CN",
        file: "guide/20210808180117-czj9bvb/20200812220555-lj3enxa/20210808180320-qgr0b3q/20200922102318-oz84yu3.sy",
        section: "20201225215903-j4268ow",
        filterTerms: ["分别或同时", "默认不勾选", "按包类型保存", "不影响已下载和更新列表"],
        releaseTerms: ["首次收录时间", "缺失或无效的时间排在末尾"],
    },
    {
        language: "zh-TW",
        file: "guide/20211226090932-5lcq56f/20211226115423-d5z1joq/20211226121109-f060fkg/20211226121326-v5kpxfp.sy",
        section: "20211226121625-afma4ct",
        filterTerms: ["分別或同時", "預設不勾選", "按套件類型儲存", "不影響已下載和更新清單"],
        releaseTerms: ["首次收錄時間", "缺失或無效的時間排在末尾"],
    },
    {
        language: "ja",
        file: "guide/20240530133126-axarxgx/20240530101000-4qitucx/20240530101000-xr22qn8/20240530101000-bpj42r0.sy",
        section: "20240530101000-foh7a5f",
        filterTerms: ["個別に、または同時に", "初期状態では無効", "パッケージの種類ごとに保存", "ダウンロード済み一覧と更新一覧には影響しません"],
        releaseTerms: ["初回掲載日時", "日時が欠けているか無効なパッケージは末尾"],
    },
];

test("marketplace release sorting and compatibility filters have complete translated labels", () => {
    const english = readJSON("appearance/langs/en.json");
    const files = readdirSync(path.join(appRoot, "appearance/langs")).filter(file => file.endsWith(".json"));
    for (const file of files) {
        const language = readJSON(`appearance/langs/${file}`);
        for (const key of keys) {
            assert.equal(typeof language[key], "string", `${file}: ${key}`);
            assert.ok(language[key].trim(), `${file}: ${key}`);
            assert.doesNotMatch(language[key], /[.。।…]$/, `${file}: ${key}`);
            if (file !== "en.json") {
                assert.notEqual(language[key], english[key], `${file}: ${key} must be translated`);
            }
        }
        assert.equal(new Set(keys.map(key => language[key])).size, keys.length, file);
    }
});

for (const guide of guides) {
    test(`${guide.language} marketplace guide describes online filters and first-listing sorting beside installation`, () => {
        const document = readJSON(guide.file);
        assert.equal(document.Type, "NodeDocument");
        assert.equal(document.ID, path.basename(guide.file, ".sy"));
        assert.equal(document.Properties.id, document.ID);
        const sectionIndex = document.Children.findIndex(node => node.ID === guide.section);
        assert.ok(sectionIndex >= 0);
        const heading = document.Children[sectionIndex];
        const section = [];
        for (const node of document.Children.slice(sectionIndex + 1)) {
            if (node.Type === "NodeHeading" && node.HeadingLevel <= heading.HeadingLevel) {
                break;
            }
            section.push(node);
        }
        assert.equal(section[0].Type, "NodeList");
        const language = readJSON(`appearance/langs/${guide.language}.json`);
        const paragraphs = keys.map(key => {
            const matches = section.filter(node => node.Type === "NodeParagraph" &&
                node.Children?.some(child => child.Type === "NodeTextMark" &&
                    child.TextMarkType === "kbd" && child.TextMarkTextContent === language[key]));
            assert.equal(matches.length, 1, `${guide.language}: ${key}`);
            return matches[0];
        });
        assert.equal(paragraphs[0], paragraphs[1]);
        assert.equal(paragraphs[2], paragraphs[3]);
        assert.notEqual(paragraphs[0], paragraphs[2]);
        for (const term of guide.filterTerms) {
            assert.ok(textContent(paragraphs[2]).includes(term), `${guide.language}: ${term}`);
        }
        for (const term of guide.releaseTerms) {
            assert.ok(textContent(paragraphs[0]).includes(term), `${guide.language}: ${term}`);
        }
        for (const paragraph of new Set(paragraphs)) {
            assert.match(paragraph.ID, /^\d{14}-[a-z0-9]{7}$/);
            assert.equal(paragraph.Properties.id, paragraph.ID);
            assert.match(paragraph.Properties.updated, /^\d{14}$/);
            assert.ok(paragraph.Properties.updated >= paragraph.ID.slice(0, 14));
            assert.ok(heading.Properties.updated >= paragraph.Properties.updated);
            assert.ok(document.Properties.updated >= paragraph.Properties.updated);
            assert.match(textContent(paragraph), /[.。]$/);
            for (const inline of paragraph.Children) {
                assert.ok(["NodeText", "NodeTextMark"].includes(inline.Type));
                assert.equal(inline.ID, undefined);
                assert.equal(inline.Properties?.id, undefined);
            }
        }
    });
}
