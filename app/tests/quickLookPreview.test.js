const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const {test} = require("node:test");
const {prepareQuickLookResources} = require("../scripts/quicklook");

test("Quick Look creates static Markdown with only explicitly attached images and inert markup", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-quicklook-render-"));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    await prepareQuickLookResources(root);
    const {scripts} = JSON.parse(fs.readFileSync(path.join(root, "resources.json"), "utf8"));
    const context = vm.createContext({TextEncoder, TextDecoder, setTimeout, clearTimeout, performance, console});
    vm.runInContext("var window = globalThis;", context);
    for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), context, {filename: name});
    const text = [
        "# 中文 title", "| A | B |\n| - | - |\n| 1 | 2 |", "```js\nconst x = 1;\n```", "$E=mc^2$", "- [x] task",
        "![local](image.png) ![missing](missing.png) ![remote](https://example.invalid/private.png)",
        '<a href="https://example.invalid/" onclick="window.bad=1">Link</a>',
        '<script>window.bad=1</script><iframe src="https://example.invalid/"></iframe>',
        '<img src="cid:image-1" onerror="window.bad=1"><div contenteditable="true" style="background:url(https://example.invalid/)">readonly</div>',
        '<svg><foreignObject><div><img src="nested.png"></div></foreignObject></svg>',
    ].join("\n\n");
    const messages = {resource: "Resource unavailable", limit: "Preview limit"};
    const images = [];
    const result = context.quickLookRender(text, messages, reference => {
        images.push(reference);
        return reference === "image.png" ? "image-1" : null;
    }, () => true);
    assert.match(result.html, /<h1>中文 title<\/h1>/);
    assert.match(result.html, /<table>/);
    assert.match(result.html, /class="katex"/);
    assert.match(result.html, /class="hljs"/);
    assert.match(result.html, /<input type="checkbox" disabled checked>/);
    assert.match(result.html, /<img src="cid:image-1" alt="local">/);
    assert.match(result.html, /\[missing\]/);
    assert.match(result.html, /\[remote\]/);
    assert.match(result.html, /<a>Link<\/a>/);
    assert.doesNotMatch(result.html, /<(?:script|iframe|svg)\b|\b(?:href|onclick|onerror|contenteditable)=|https:\/\/example\.invalid/);
    assert.deepEqual(images, ["image.png", "missing.png"]);
    assert.equal(result.warning, messages.resource);
    assert.equal(context.bad, undefined);

    const many = "<b>x</b>".repeat(20001);
    assert.equal(context.quickLookRender(many, messages, () => null, () => true).error, "limit");
    assert.throws(() => context.quickLookRender("<b>x</b>".repeat(100), messages, () => null, () => false), /cancelled/);
});
