const assert = require("node:assert/strict");
const {test} = require("node:test");
const {pathToFileURL} = require("node:url");
const path = require("node:path");
const {rawFormatType, readClipboardBuffer, readClipboardText, getClipboardFormats, parseClipboardFilePaths} = require("./clipboard");

const createItem = (data) => ({
    types: Object.keys(data),
    getType: async (type) => new Blob([data[type]])
});

test("clipboard preserves native Office and WPS bytes alongside text", async () => {
    const office = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 255]);
    const math = Buffer.from("<math>x</math>\0", "utf16le");
    const items = [createItem({"text/plain": "x", "text/html": "<b>x</b>"}), createItem({
        [rawFormatType("Embed Source")]: office,
        [rawFormatType("MathML")]: math,
        [rawFormatType("Kingsoft WPS 9.0 Format")]: Buffer.from([0x50, 0x4B, 0, 255])
    })];
    assert.equal(await readClipboardText(items, "text/plain"), "x");
    assert.equal(await readClipboardText(items, "text/html"), "<b>x</b>");
    assert.deepEqual(await readClipboardBuffer(items, rawFormatType("Embed Source")), office);
    assert.deepEqual(await readClipboardBuffer(items, rawFormatType("MathML")), math);
    assert.ok(getClipboardFormats(items).includes("Kingsoft WPS 9.0 Format"));
    assert.equal((await readClipboardBuffer(items, "missing")).length, 0);
});

test("clipboard raw format names round trip quoted characters", () => {
    const format = 'custom "quoted" \\ format';
    assert.deepEqual(getClipboardFormats([createItem({[rawFormatType(format)]: "x"})]), [format]);
});

test("clipboard file references decode escaped paths and reject non-file entries", () => {
    const file = path.resolve("clipboard test #1.txt");
    assert.deepEqual(parseClipboardFilePaths(`# comment\r\n${pathToFileURL(file).href}\r\nhttps://example.com/a\ninvalid\n`), [file]);
});

test("clipboard read failures propagate without returning partial data", async () => {
    const items = [{types: ["text/html"], getType: async () => { throw new Error("clipboard changed"); }}];
    await assert.rejects(readClipboardText(items, "text/html"), /clipboard changed/);
});
