import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {createMarkdownTemporaryFile} from "./temporaryFile";

test("temporary files use SiYuan IDs and retry an occupied name without changing it", async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-id-"));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const prefix = path.join(root, ".siyuan-markdown-");
    const occupied = prefix + "20261102090807-aaaaaaa.tmp";
    await fs.writeFile(occupied, "another writer");
    let calls = 0;
    const created = await createMarkdownTemporaryFile(prefix, 0o600, fs, () =>
        ++calls === 1 ? "20261102090807-aaaaaaa" : "20261102090807-bbbbbbb");
    await created.handle.writeFile("ours");
    await created.handle.close();
    assert.equal(calls, 2);
    assert.equal(await fs.readFile(occupied, "utf8"), "another writer");
    assert.match(path.basename(created.path), /^\.siyuan-markdown-\d{14}-[a-z0-9]{7}\.tmp$/);
    assert.equal(await fs.readFile(created.path, "utf8"), "ours");
});

test("temporary name retries are bounded and permission errors are not retried", async () => {
    for (const code of ["EEXIST", "EACCES"]) {
        let calls = 0;
        const io = {open: async () => {calls++; throw Object.assign(new Error(code), {code});}};
        await assert.rejects(createMarkdownTemporaryFile("unused-", 0o600, io), {code});
        assert.equal(calls, code === "EEXIST" ? 8 : 1);
    }
});
