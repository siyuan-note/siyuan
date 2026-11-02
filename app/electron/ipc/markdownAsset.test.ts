import {test} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {normalizeMarkdownAsset, verifyMarkdownAssetPath} from "./markdownAsset";

test("Markdown asset requests accept relative Markdown links only", () => {
    assert.equal(normalizeMarkdownAsset(" assets/中文.MD?box=20260101000000-abcdefg#heading "), "assets/中文.MD?box=20260101000000-abcdefg");
    assert.equal(normalizeMarkdownAsset("assets/a.markdown"), "assets/a.markdown");
    for (const value of [null, "file:///secret.md", "/tmp/test.md", "https://remote/assets/a.md", "assets/a.txt", "assets/../secret.md", "assets/%2e%2e/secret.md", "assets/a%5csecret.md", "assets/./a.md", "assets/a\u0000.md"]) {
        assert.equal(normalizeMarkdownAsset(value), undefined, String(value));
    }
});

test("resolved assets cannot escape the workspace or edit decrypted temporary copies", async t => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-asset-"));
    t.after(() => fs.rm(workspace, {recursive: true, force: true}));
    const assets = path.join(workspace, "data", "assets");
    const notebook = path.join(workspace, "data", "20260101000000-abcdefg", "assets");
    const nested = path.join(workspace, "data", "20260101000000-abcdefg", "20260101000001-abcdefg", "assets");
    await fs.mkdir(nested, {recursive: true});
    await fs.mkdir(assets, {recursive: true});
    await fs.mkdir(notebook, {recursive: true});
    for (const root of [assets, notebook, nested]) {
        const file = path.join(root, "test.md");
        await fs.writeFile(file, "# Test");
        assert.equal((await verifyMarkdownAssetPath(workspace, file)).path, await fs.realpath(file));
    }
    const outside = path.join(workspace, "decrypted.md");
    await fs.writeFile(outside, "private");
    await assert.rejects(verifyMarkdownAssetPath(workspace, outside));
    await assert.rejects(verifyMarkdownAssetPath(workspace, assets));
    await assert.rejects(verifyMarkdownAssetPath(workspace, "assets/test.md"));
    if (process.platform !== "win32") {
        const link = path.join(assets, "escape.md");
        await fs.symlink(outside, link);
        await assert.rejects(verifyMarkdownAssetPath(workspace, link));
    }
});
