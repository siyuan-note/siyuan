import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {cloneAVCellValueSnapshot} from "./cellValue";
import {getInlineFontFamilyStyle} from "../../toolbar/fontFamilyCore";
import {
    AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES,
    AV_RICH_TEXT_EDITOR_ALLOWED_TAGS,
    AV_RICH_TEXT_PREVIEW_ALLOWED_ATTRIBUTES,
    AV_RICH_TEXT_PREVIEW_ALLOWED_TAGS,
    AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS,
    configureAVRichTextLute,
    createAVPlainTextEditValue,
    createAVPlainTextValue,
    createAVRichTextStyleBackslashEncoding,
    createAVRichTextValue,
    getAVTextCopyContent,
    getAVTextPlainContent,
    getAVTextSource,
    getAVRichTextSafeURL,
    isAVRichTextExecutableCodeLanguage,
    projectAVRichTextPlainBlocks,
    protectAVRichTextKramdownStyleEntities,
    restoreAVRichTextStyleEntities,
    sanitizeAVRichTextInlineMemoContent,
    sanitizeAVRichTextInlineStyle,
} from "./richTextValue";

const hasDOM = typeof globalThis.document?.createElement === "function";

describe("attribute view text source compatibility", () => {
    it("keeps legacy Markdown-looking content literal", () => {
        const literal = "**literal** ((20240101000000-abcdefg \"reference\")) $x$";
        const value: IAVCellValue = {type: "text", text: {content: literal}};

        assert.deepEqual(getAVTextSource(value), {kind: "plain", content: literal});
        assert.equal(getAVTextPlainContent(value), literal);
    });

    it("uses only a valid rich envelope as the rich source", () => {
        const value: IAVCellValue = {
            type: "text",
            text: {
                content: "Projected text",
                rich: {spec: 1, format: "kramdown", content: "**Rich** source"},
            },
        };

        assert.deepEqual(getAVTextSource(value), {kind: "rich", content: "**Rich** source"});
        assert.equal(getAVTextPlainContent(value), "Projected text");
        assert.deepEqual(getAVTextSource({
            type: "text",
            text: {content: "Explicitly plain", rich: null},
        }), {kind: "plain", content: "Explicitly plain"});
        assert.deepEqual(getAVTextSource({
            type: "text",
            text: {
                content: "Unsupported envelope",
                rich: {spec: 2, format: "kramdown", content: "**not active**"},
            },
        } as unknown as IAVCellValue), {kind: "plain", content: "Unsupported envelope"});
    });

    it("keeps the plain projection authoritative for copy and export consumers", () => {
        const value: IAVCellValue = {
            type: "text",
            text: {
                content: "first\nsecond",
                rich: {spec: 1, format: "kramdown", content: "first\n\nsecond"},
            },
        };

        assert.equal(getAVTextPlainContent(value), "first\nsecond");
        value.text.content = "\n  first\nsecond  \n";
        assert.equal(getAVTextCopyContent(value), "first\nsecond");
    });

    it("identifies only executable code fence languages", () => {
        for (const language of [
            "abc", "echarts", "flowchart", "graphviz", "infographic", "mermaid", "mindmap", "plantuml",
        ]) {
            assert.equal(isAVRichTextExecutableCodeLanguage(language), true);
        }
        assert.equal(isAVRichTextExecutableCodeLanguage("GraphViz options"), true);
        assert.equal(isAVRichTextExecutableCodeLanguage("javascript"), false);
        assert.equal(isAVRichTextExecutableCodeLanguage("go options"), false);
    });

    it("encodes only staged text style delimiters for Kramdown", () => {
        const code = String.raw`<span data-type="text" style="font-family: 'Code\Font';">literal</span>`;
        const style = String.raw`font-family: var(--b3-font-family-emoji-reset), 'Semi>` + "`" + String.raw`; \'Quoted\' \\ 字体', ` +
            "var(--b3-font-family-editor), var(--b3-font-family);";
        const firstSentinel = "\uE000av-rich-text-style-0\uF8FF";
        const encoding = createAVRichTextStyleBackslashEncoding(code + firstSentinel);
        const markdown = encoding.encodeMarkdown(`${encoding.protectStyle(style)}\n${code}`);

        assert.notEqual(encoding.sentinel, firstSentinel);
        assert.equal((code + firstSentinel).includes(encoding.sentinel), false);
        assert.equal(markdown, `${style.replaceAll("\\", "&#92;").replaceAll("`", "&#96;")}\n${code}`);
        assert.equal(markdown.includes(encoding.sentinel), false);
    });

    it("protects text span IAL style entities without treating arbitrary dollars as math", () => {
        const styled = '<span title="a>b" data-type="strong text">styled</span>' +
            '{: custom="a}>b" style="font-family: \'Semi&gt;; &#92;\'Quoted&#92;\' &amp; 字体\';" ' +
            'other="&#92;"}';
        const nested = '<span data-type="strong"><span data-type="text">nested</span>' +
            '{: style="font-family: \'A&#92;B\';"}</span>';
        const plain = '<span data-type="strong">plain</span>{: style="font-family: \'A&#92;B\';"}';
        const fake = '<span data-type="text">fake</span>{: style="font-family: \'A&#92;B\';"}';
        const source = [
            styled,
            nested,
            plain,
            "```html",
            fake,
            "```",
            "~~~~",
            fake,
            "~~~~",
            `\`${fake}\``,
            `\`\`${fake}\`\``,
            `$${fake}$`,
            `$$${fake}$$`,
            "$$",
            fake,
            "$$",
            `\`cross\r\n${fake}\r\nline\``,
            "prose &#92;",
            `\`unclosed ${styled}`,
        ].join("\r\n");
        const protectedStyle = protectAVRichTextKramdownStyleEntities(source);
        const restoredSource = protectedStyle.protections.reduce((content, protection) =>
            content.replaceAll(protection.token, protection.encoded), protectedStyle.content);
        const decoded = restoreAVRichTextStyleEntities(protectedStyle.content, protectedStyle.protections);

        assert.equal(restoredSource, source);
        assert.deepEqual(protectedStyle.protections.map((item) => item.encoded), [
            "&gt;", "&#92;", "&#92;", "&amp;", "&#92;", "&#92;", "&#92;", "&gt;", "&#92;", "&#92;", "&amp;",
        ]);
        assert.match(decoded, /font-family: 'Semi>; \\'Quoted\\' & 字体';/);
        assert.equal(protectedStyle.content.includes(plain), true);
        assert.equal(protectedStyle.content.includes("```html\r\n" + fake + "\r\n```"), true);
        assert.equal(protectedStyle.content.includes("~~~~\r\n" + fake + "\r\n~~~~"), true);
        assert.equal(protectedStyle.content.includes(`\`${fake}\``), true);
        assert.equal(protectedStyle.content.includes(`\`\`${fake}\`\``), true);
        assert.equal(protectedStyle.content.includes(`$${fake}$`), false);
        assert.equal(protectedStyle.content.includes(`$$${fake}$$`), false);
        assert.equal(protectedStyle.content.includes("$$\r\n" + fake + "\r\n$$"), true);
        assert.equal(protectedStyle.content.includes(`\`cross\r\n${fake}\r\nline\``), true);
        assert.equal(protectedStyle.content.includes("prose &#92;"), true);
    });

    it("handles long malformed delimiter input in a single scan", () => {
        const unmatchedRuns = Array.from({length: 512}, (_, index) => "`".repeat(index + 1) + "x").join("");
        const occupiedSentinels = Array.from({length: 4096}, (_, index) =>
            `\uE000av-rich-text-style-${index.toString(36)}\uF8FF`).join("");
        const styled = '<span data-type="text">styled</span>' +
            '{: style="font-family: \'A`B` &#92; 字体\';"}';
        const source = "\\".repeat(65536) + unmatchedRuns + occupiedSentinels + styled;
        const protectedStyle = protectAVRichTextKramdownStyleEntities(source);
        const encoding = createAVRichTextStyleBackslashEncoding(occupiedSentinels);

        assert.equal(protectedStyle.protections.length, 3);
        assert.deepEqual(protectedStyle.protections.map((item) => item.encoded), ["`", "`", "&#92;"]);
        assert.equal(protectedStyle.content.includes(protectedStyle.protections[0].token), true);
        assert.equal(encoding.sentinel, "\uE000av-rich-text-style-35s\uF8FF");
    });

    it("round-trips complex styles through the bundled Lute parser", () => {
        if (typeof Lute === "undefined") {
            require("../../../../stage/protyle/js/lute/lute.min.js");
        }
        const lute = Lute.New();
        lute.SetTextMark(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetKramdownIAL(true);
        lute.SetSpin(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetSanitize(true);
        const fontFamily = getInlineFontFamilyStyle("A`B` Semi; 'Quoted' > \\ & {} 字体");
        const style = `font-family: ${fontFamily};`;
        const blockDOM = '<div data-type="NodeParagraph"><div contenteditable="true">' +
            `<span data-type="text" style="${style}">font</span>` +
            "</div></div>";
        const writeEncoding = createAVRichTextStyleBackslashEncoding(blockDOM);
        const protectedBlockDOM = blockDOM.replace(style, writeEncoding.protectStyle(style));
        const persisted = writeEncoding.encodeMarkdown(lute.BlockDOM2Md(protectedBlockDOM).trim());
        const source = `$5 ${persisted} $10`;
        const protectedStyle = protectAVRichTextKramdownStyleEntities(source);
        const parsed = lute.Md2BlockDOM(protectedStyle.content);
        const restored = restoreAVRichTextStyleEntities(parsed, protectedStyle.protections);

        assert.match(persisted, /&#92;/);
        assert.match(persisted, /&#96;/);
        assert.match(persisted, /&gt;/);
        assert.equal(protectedStyle.protections.length > 0, true);
        assert.match(restored, /\$5 /);
        assert.match(restored, / \$10/);
        assert.equal(restored.includes(`data-type="text" style="${style}"`), true);
        assert.doesNotMatch(restored, /\{:\s*style=/);
    });

    it("keeps canonical multiline code spans literal through the bundled Lute parser", () => {
        if (typeof Lute === "undefined") {
            require("../../../../stage/protyle/js/lute/lute.min.js");
        }
        const lute = Lute.New();
        lute.SetTextMark(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetKramdownIAL(true);
        lute.SetSpin(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetSanitize(true);
        const literal = "&lt;span data-type=&quot;text&quot;&gt;x&lt;/span&gt;" +
            "{: style=&quot;font-family: A&amp;#92;B;&quot;}";
        const blockDOM = '<div data-type="NodeParagraph"><div contenteditable="true">' +
            `<span data-type="code">start\n${literal}\nend</span>` +
            "</div></div>";
        const markdown = lute.BlockDOM2Md(blockDOM).trim();
        const protectedStyle = protectAVRichTextKramdownStyleEntities(markdown);
        const parsed = lute.Md2BlockDOM(protectedStyle.content);

        assert.match(markdown, /start\n/);
        assert.deepEqual(protectedStyle.protections, []);
        assert.match(parsed, /data-type="code"/);
        assert.match(parsed, /&amp;#92;/);
    });

    it("projects block content with the same newline rules as the kernel", () => {
        if (typeof Lute === "undefined") {
            require("../../../../stage/protyle/js/lute/lute.min.js");
        }
        const lute = Lute.New();
        lute.SetTextMark(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetKramdownIAL(true);
        lute.SetSpin(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetSanitize(true);
        const paragraph = lute.BlockDOM2Content(lute.Md2BlockDOM("first"));
        const code = lute.BlockDOM2Content(lute.Md2BlockDOM("```txt\ncode\n\n```"));
        const next = lute.BlockDOM2Content(lute.Md2BlockDOM("next"));

        assert.equal(code, "code\n\n");
        assert.equal(projectAVRichTextPlainBlocks([paragraph, code, next]), "first\ncode\nnext");
        assert.equal(projectAVRichTextPlainBlocks([paragraph, ""]), "first");
        assert.equal(projectAVRichTextPlainBlocks([], "fallback\n"), "fallback\n");
    });

    it("keeps image emoji aliases literal while preserving Unicode emoji", () => {
        if (typeof Lute === "undefined") {
            require("../../../../stage/protyle/js/lute/lute.min.js");
        }
        const lute = Lute.New();
        lute.SetTextMark(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetKramdownIAL(true);
        lute.SetSpin(true);
        lute.SetProtyleWYSIWYG(true);
        lute.SetSanitize(true);
        configureAVRichTextLute(lute);
        const markdown = ":siyuan: 😀";
        const blockDOM = lute.Md2BlockDOM(markdown);

        assert.equal(blockDOM.includes("<img"), false);
        assert.match(blockDOM, /:siyuan: 😀/);
        assert.equal(lute.BlockDOM2Content(blockDOM), markdown);
    });

    it("restores every fixed inline syntax switch on the isolated Lute", () => {
        const values = new Map<PropertyKey, boolean>();
        const lute = new Proxy({}, {
            get: (_target, property) => (enabled: boolean) => values.set(property, enabled),
        }) as Lute;

        assert.equal(configureAVRichTextLute(lute), lute);
        for (const property of [
            "SetCustomBlock", "SetGitConflict", "SetInlineAsterisk", "SetInlineUnderscore",
            "SetGFMStrikethrough", "SetSup", "SetSub", "SetTag", "SetInlineMath", "SetMark",
            "SetFullWidthStrikethrough",
        ]) {
            assert.equal(values.get(property), true, property);
        }
        for (const property of ["SetEmoji", "SetGFMStrikethrough1", "SetExportNormalizeTaskListMarker"]) {
            assert.equal(values.get(property), false, property);
        }
    });

    it("uses a strict active-content and interaction policy for previews", () => {
        for (const tag of ["audio", "embed", "iframe", "img", "object", "script", "style", "video"]) {
            assert.equal(AV_RICH_TEXT_PREVIEW_ALLOWED_TAGS.includes(tag), false);
            assert.equal(AV_RICH_TEXT_EDITOR_ALLOWED_TAGS.includes(tag), false);
        }
        for (const attribute of ["onerror", "onclick", "src", "srcdoc", "xlink:href"]) {
            assert.equal(AV_RICH_TEXT_PREVIEW_ALLOWED_ATTRIBUTES.includes(attribute), false);
            if (attribute !== "xlink:href") {
                assert.equal(AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES.includes(attribute), false);
            }
        }
        assert.deepEqual(AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS, ["sup"]);
        assert.equal(sanitizeAVRichTextInlineMemoContent(
            "&amp;lt;img src=x onerror=alert(1)&amp;gt;memo&lt;/img&gt;"
        ), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("2 < 3\tline\nnext\r\u200D\u200F"),
            "2 < 3\tline\nnext\r\u200D\u200F");
        assert.equal(sanitizeAVRichTextInlineMemoContent("heart <3"), "heart <3");
        assert.equal(sanitizeAVRichTextInlineMemoContent("2 &lt; 3"), "2 &lt; 3");
        assert.equal(sanitizeAVRichTextInlineMemoContent('<span title=">">memo</span>'), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("<script"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("memo </span"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("memo <!--"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("memo <?xml"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("&lt;script&gt;"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("memo\u0000content"), "");
        assert.equal(sanitizeAVRichTextInlineMemoContent("memo\u007Fcontent"), "");

        let deeplyEncodedMemo = "&";
        for (let depth = 0; depth < 8; depth++) {
            deeplyEncodedMemo = deeplyEncodedMemo.replace(/&/g, "&amp;");
        }
        assert.equal(sanitizeAVRichTextInlineMemoContent(deeplyEncodedMemo), "");

        for (const unsafe of [
            "javascript:alert(1)",
            "java\nscript:alert(1)",
            "java\u200Bscript:alert(1)",
            "javascript&colon;alert(1)",
            "javascript&amp;colon;alert(1)",
            "java%73cript:alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///tmp/payload.html",
            "blob:https://example.com/id",
            "ftp://example.com/file",
            "https:example.com",
            "http:///path",
            "siyuan:/blocks/20240101000000-abcdefg",
            "mailto://example.com",
            "mailto:/user@example.com",
            "tel://12025550123",
            "//",
            "///path",
            "/javascript:alert(1)",
            "folder:name",
            "assets/../payload.html",
            "%zz",
            "\\\\server\\payload.html",
            " https://example.com",
        ]) {
            assert.equal(getAVRichTextSafeURL(unsafe), "");
        }
        for (const safe of [
            "https://example.com/a?q=v#f", "mailto:user@example.com", "tel:+12025550123",
            "siyuan://blocks/20240101000000-abcdefg", "web+siyuan://blocks/20240101000000-abcdefg",
            "../relative/note.md", "/relative/note.md", "#section", "?q=v", "//example.com/path",
            "assets/file with space.pdf", "assets/percent%25.txt",
        ]) {
            assert.equal(getAVRichTextSafeURL(safe), safe);
        }
    });

    it("keeps only supported inline color declarations", () => {
        assert.equal(sanitizeAVRichTextInlineStyle(
            "background-color: var(--b3-font-background8); color:var(--b3-font-color2);"
        ), "color: var(--b3-font-color2); background-color: var(--b3-font-background8);");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: var(--b3-inline-builtin-info-color, var(--b3-card-info-color)); " +
            "background-color: var(--b3-inline-builtin-info-background-color, " +
            "var(--b3-card-info-background));"
        ), "color: var(--b3-inline-builtin-info-color, var(--b3-card-info-color)); " +
            "background-color: var(--b3-inline-builtin-info-background-color, " +
            "var(--b3-card-info-background));");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: var(--b3-inline-style-20260821120000-abcdefg-color, #AABBCC); " +
            "background-color: var(--b3-inline-style-20260821120000-abcdefg-background-color, #112233);"
        ), "color: var(--b3-inline-style-20260821120000-abcdefg-color, #aabbcc); " +
            "background-color: var(--b3-inline-style-20260821120000-abcdefg-background-color, #112233);");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: red; background-image: url(https://example.com/pixel); " +
            "background-color: var(--b3-font-background13);"
        ), "background-color: var(--b3-font-background13);");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: var(--b3-font-color14); background-color: var(--b3-font-color1);"
        ), "");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: var(--b3-font-color8, url(https://example.com/pixel));"
        ), "");
    });

    it("normalizes the complete inline font style set", () => {
        const fontFamily = getInlineFontFamilyStyle("Semi; 'Quoted' > \\ 字体");
        const style = [
            "unicode-bidi: isolate",
            `font-family: ${fontFamily}`,
            "direction: rtl",
            "font-size: .56em",
            "-webkit-text-fill-color: transparent",
            "-webkit-text-stroke: 0.2px var(--b3-theme-on-background)",
            "text-shadow: 1px 1px var(--b3-theme-surface-lighter), " +
            "2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), " +
            "4px 4px var(--b3-theme-surface-lighter)",
            "--b3-parent-background: var(--b3-font-background2)",
        ].join("; ") + ";";

        assert.equal(sanitizeAVRichTextInlineStyle(style), [
            "font-size: 0.56em;",
            `font-family: ${fontFamily};`,
            "-webkit-text-stroke: 0.2px var(--b3-theme-on-background);",
            "-webkit-text-fill-color: transparent;",
            "text-shadow: 1px 1px var(--b3-theme-surface-lighter), " +
            "2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), " +
            "4px 4px var(--b3-theme-surface-lighter);",
            "direction: rtl;",
            "unicode-bidi: isolate;",
        ].join(" "));
    });

    it("drops incomplete or non-canonical inline style declarations", () => {
        const maximumFontFamily = getInlineFontFamilyStyle("字".repeat(256));
        assert.equal(sanitizeAVRichTextInlineStyle(
            `font-size: 72.00px; font-family: ${maximumFontFamily};`
        ), `font-size: 72px; font-family: ${maximumFontFamily};`);
        assert.equal(sanitizeAVRichTextInlineStyle(
            "color: var(--b3-font-color2); -webkit-text-stroke: 0.2px var(--b3-theme-on-background); " +
            "direction: ltr; font-size: 8px; font-family: url(https://example.com/font);"
        ), "color: var(--b3-font-color2);");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "-webkit-text-fill-color: transparent; unicode-bidi: isolate; font-size: 4.51em; " +
            "text-shadow: 1px 1px red;"
        ), "");
        assert.equal(sanitizeAVRichTextInlineStyle(
            "font-family: var(--b3-font-family-emoji-reset), 'unterminated; color: var(--b3-font-color2);"
        ), "");
        assert.equal(sanitizeAVRichTextInlineStyle(
            `font-family: ${getInlineFontFamilyStyle("字".repeat(257))};`
        ), "");
    });
});

describe("attribute view text value creation", () => {
    it("creates a rich envelope without mutating the source snapshot", () => {
        const source: IAVCellValue = {
            id: "cell-id",
            type: "text",
            isDetached: true,
            text: {content: "old", rich: null},
        };
        const created = createAVRichTextValue("**new**", "new", source);

        assert.deepEqual(created, {
            id: "cell-id",
            type: "text",
            isDetached: true,
            text: {
                content: "new",
                rich: {spec: 1, format: "kramdown", content: "**new**"},
            },
        });
        assert.deepEqual(source.text, {content: "old", rich: null});
    });

    it("supports omitted and explicit-null rich state for plain writes", () => {
        assert.deepEqual(createAVPlainTextValue("plain"), {
            type: "text",
            text: {content: "plain"},
        });
        assert.deepEqual(createAVPlainTextValue("plain", undefined, true), {
            type: "text",
            text: {content: "plain", rich: null},
        });
    });

    it("preserves template rich text only while its plain projection is unchanged", () => {
        const source: IAVCellValue = {
            type: "text",
            text: {
                content: "projected",
                rich: {spec: 1, format: "kramdown", content: "**projected**"},
            },
        };

        assert.deepEqual(createAVPlainTextEditValue("projected", source).text, source.text);
        assert.deepEqual(createAVPlainTextEditValue("changed", source).text,
            {content: "changed", rich: null});
        assert.deepEqual(createAVPlainTextEditValue("legacy", {type: "text", text: {content: "old"}}).text,
            {content: "legacy"});
        assert.notEqual(createAVPlainTextEditValue("projected", source).text.rich, source.text.rich);
    });

    it("preserves rich data in independent undo snapshots and removes rendered HTML", () => {
        const value: IAVCellValue = {
            type: "text",
            renderedContent: "<strong>preview</strong>",
            text: {
                content: "preview",
                rich: {spec: 1, format: "kramdown", content: "**preview**"},
            },
        };
        const snapshot = cloneAVCellValueSnapshot(value);

        assert.equal(snapshot.renderedContent, undefined);
        assert.deepEqual(snapshot.text, value.text);
        snapshot.text!.rich!.content = "changed";
        assert.equal(value.text!.rich!.content, "**preview**");
    });
});

describe("attribute view rich text DOM policy", () => {
    it("drops unsupported blocks and preserves supported inline marks", {
        skip: hasDOM ? false : "The Node test environment does not provide a DOM implementation",
    }, async () => {
        Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
        const richText = await import("./richText");
        const blockDOM = [
            '<div data-type="NodeHeading" data-subtype="h2"><div contenteditable="true">heading</div></div>',
            '<div data-type="NodeParagraph"><div contenteditable="true">',
            '<span data-type="tag">tag</span>',
            '<span data-type="file-annotation-ref">annotation</span>',
            '<span data-type="inline-memo" data-inline-memo-content="memo">memo</span>',
            '<span data-type="strong" style="color: var(--b3-font-color2);">unstyled strong</span>',
            '<span data-type="strong text" style="color: var(--b3-font-color2);">styled strong</span>',
            "</div></div>",
            '<div data-type="NodeImage"><span class="img">image</span></div>',
            '<div data-type="NodeTable">table</div>',
            '<div data-type="NodeHTMLBlock">html</div>',
            '<div data-type="NodeBlockQueryEmbed">embed</div>',
            '<div data-type="NodeCodeBlock" data-subtype="mermaid" class="render-node">diagram</div>',
            '<div data-type="NodeCodeBlock" data-subtype="GraphViz options" class="code-block">graph</div>',
        ].join("");
        const sanitized = richText.sanitizeAVRichTextBlockDOM(blockDOM);

        assert.match(sanitized, /data-type="NodeParagraph"[^>]*>.*heading/s);
        assert.match(sanitized, /data-type="tag"/);
        assert.match(sanitized, /data-type="file-annotation-ref"/);
        assert.match(sanitized, /data-type="inline-memo"/);
        assert.match(sanitized, /data-type="strong">unstyled strong/);
        assert.match(sanitized, /data-type="strong text" style="color: var\(--b3-font-color2\);">styled strong/);
        for (const type of ["NodeHeading", "NodeImage", "NodeTable", "NodeHTMLBlock", "NodeBlockQueryEmbed"]) {
            assert.doesNotMatch(sanitized, new RegExp(`data-type="${type}"`));
        }
        assert.doesNotMatch(sanitized, /data-subtype="mermaid"/);
        assert.doesNotMatch(sanitized, /data-subtype="GraphViz options"/);
    });

    it("does not expose generated structure IDs and keeps rendered links identifiable", {
        skip: hasDOM && typeof Lute !== "undefined" ? false :
            "The Node test environment does not provide DOM and Lute globals",
    }, async () => {
        Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
        const richText = await import("./richText");
        const html = richText.getAVRichTextPreviewHTML("[SiYuan](https://b3log.org/siyuan)");

        assert.doesNotMatch(html, /\sid="[^"]+"/);
        assert.match(html, /data-type="[^"]*a[^"]*"/);
        assert.match(html, /data-href="https:\/\/b3log\.org\/siyuan"/);
    });

    it("flattens inline memo HTML and removes dangerous preview links", {
        skip: hasDOM && typeof Lute !== "undefined" ? false :
            "The Node test environment does not provide DOM and Lute globals",
    }, async () => {
        Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
        const richText = await import("./richText");
        const markdown = '<span data-type="inline-memo" data-inline-memo-content="' +
            "&lt;img src=x onerror=alert(1)&gt;&lt;span data-type=file-annotation-ref " +
            'data-id=javascript:alert(1)&gt;spoof&lt;/span&gt;">memo</span>\n\n' +
            "[unsafe](javascript:alert(1))";
        const html = richText.getAVRichTextPreviewHTML(markdown);

        assert.doesNotMatch(html, /<(?:img|script|iframe)\b/i);
        assert.doesNotMatch(html, /\son\w+=/i);
        assert.doesNotMatch(html, /javascript:/i);
        assert.doesNotMatch(html, /data-type="file-annotation-ref"/i);
        assert.match(html, /<sup>\([^<]*spoof[^<]*\)<\/sup>/i);
    });

    it("round-trips escaped font family names through Kramdown style IAL", {
        skip: hasDOM && typeof Lute !== "undefined" ? false :
            "The Node test environment does not provide DOM and Lute globals",
    }, async () => {
        Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: "test"});
        const richText = await import("./richText");
        const fontFamily = getInlineFontFamilyStyle("Semi; 'Quoted' 字体");
        const blockDOM = '<div data-type="NodeParagraph"><div contenteditable="true">' +
            `<span data-type="text" style="font-family: ${fontFamily};">font</span>` +
            "</div></div>";
        const serialized = richText.serializeAVRichTextBlockDOM(blockDOM);

        assert.doesNotMatch(serialized.markdown, /\\'/);
        assert.match(serialized.markdown, /&#92;'Quoted&#92;'/);
        assert.equal(richText.serializeAVRichTextBlockDOM(serialized.blockDOM).markdown, serialized.markdown);
    });
});
