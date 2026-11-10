import * as assert from "node:assert/strict";
import {promises as fs} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {savePDF} from "./savePDF";

test("PDF processing exceptions preserve the destination and clean temporary files", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-pdf-save-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const destination = path.join(directory, "note.pdf");
    await fs.writeFile(destination, "original");
    await assert.rejects(savePDF(destination, Buffer.from("new"), async () => {
        throw new Error("processing failed");
    }), /processing failed/);
    assert.equal(await fs.readFile(destination, "utf8"), "original");
    assert.deepEqual(await fs.readdir(directory), ["note.pdf"]);
});

test("PDF replacement failures clean temporary files and preserve the destination", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-pdf-save-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const destination = path.join(directory, "note.pdf");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "keep"), "original");
    await assert.rejects(savePDF(destination, Buffer.from("new"), async () => true));
    assert.equal(await fs.readFile(path.join(destination, "keep"), "utf8"), "original");
    assert.deepEqual(await fs.readdir(directory), ["note.pdf"]);
});
