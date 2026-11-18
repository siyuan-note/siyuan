import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtmlTextAndAttr} from "../util/escape";
import {getAssetsPreviewPath} from "./previewPath";

test("keeps regular asset preview paths unchanged", () => {
    assert.equal(getAssetsPreviewPath("assets/image.png"), "assets/image.png");
});

test("adds an exact data path for notebook and document asset previews", () => {
    assert.equal(
        getAssetsPreviewPath("assets/video.mp4", "20260821000000-abcdefg/20260821000001-hijklmn/assets/video.mp4"),
        "assets/video.mp4?dataPath=20260821000000-abcdefg%2F20260821000001-hijklmn%2Fassets%2Fvideo.mp4"
    );
});

test("preserves existing asset query parameters", () => {
    assert.equal(
        getAssetsPreviewPath("assets/image.png?thumbnail=256", "20260821000000-abcdefg/assets/image.png"),
        "assets/image.png?thumbnail=256&dataPath=20260821000000-abcdefg%2Fassets%2Fimage.png"
    );
});

const renderAssetsSource = createSourceFile("renderAssets.ts", readFileSync(join(__dirname, "renderAssets.ts"), "utf8"),
    ScriptTarget.Latest);
const genAssetHTMLDeclaration = renderAssetsSource.statements.find(node => isVariableStatement(node) &&
    node.declarationList.declarations.some(item => item.name.getText(renderAssetsSource) === "genAssetHTML"));
assert.ok(genAssetHTMLDeclaration);
const genAssetHTMLCode = transpileModule(
    `${genAssetHTMLDeclaration.getText(renderAssetsSource).replace(/^export\s+/, "")}\ngenAssetHTML;`, {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText;
const genAssetHTML = (type: string, pathString: string, imgName: string, linkName: string, htmlAsIframe = false) =>
    runInNewContext(genAssetHTMLCode, {
        escapeAttr,
        escapeHtmlTextAndAttr,
        isHTMLFilePath: () => false,
        getHTMLAssetIFrameSrc: (value: string) => value,
        isBrowserRenderableImagePath: () => true,
        Lute: {NewNodeID: () => "20260101000000-abcdefg"},
        dayjs: () => ({format: () => "20260101000000"}),
        Constants: {
            ZWSP: "\u200b",
            SIYUAN_ASSETS_AUDIO: [".mp3"],
            SIYUAN_ASSETS_IMAGE: [".png"],
            SIYUAN_ASSETS_VIDEO: [".mp4"],
        },
    })(type, pathString, imgName, linkName, htmlAsIframe);

test("genAssetHTML escapes untrusted paths and image names", () => {
    const html = genAssetHTML(".png", "assets/cover\" onerror=\"window.__a=1.png",
        "n<img src=y onerror=\"window.__b=1\">", "link");
    assert.ok(html.includes("src=\"assets/cover&quot; onerror=&quot;window.__a=1.png\""));
    assert.ok(html.includes("alt=\"n&lt;img src=y onerror=&quot;window.__b=1&quot;&gt;\""));
    assert.ok(!html.includes("<img src=y"));
});

test("genAssetHTML escapes untrusted href and label", () => {
    const html = genAssetHTML(".txt", "assets/x\" onclick=\"window.__c=1", "", "<img src=z>");
    assert.ok(html.includes("data-href=\"assets/x&quot; onclick=&quot;window.__c=1\""));
    assert.ok(html.includes("&lt;img src=z&gt;"));
    assert.ok(!html.includes("<img src=z"));
});
