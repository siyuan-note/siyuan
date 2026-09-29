const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {resolveRemoteExportURL, saveRemoteExport} = require("./remoteExport");

const origin = "https://notes.example.com";

test("remote downloads accept only export attachments from the current kernel", () => {
    assert.deepEqual(resolveRemoteExportURL("/export/notes%20archive.zip", origin), {
        url: origin + "/export/notes%20archive.zip", name: "notes archive.zip",
    });
    assert.equal(resolveRemoteExportURL("/export/100%25.zip", origin).name, "100%.zip");
    for (const uri of ["https://other.example.com/export/a.zip", "//other.example.com/export/a.zip",
        "file:///export/a.zip", "/api/file/getFile", "/export/temp/a.html", "/export/%74emp/a.html",
        "/export/a%2fb.zip", "/export/%252e%252e/a.zip", "/export/a%00.zip", "/export/a.zip?download=true",
        "https://user@notes.example.com/export/a.zip", "/export/", "/export/a\\b.zip"]) {
        assert.throws(() => resolveRemoteExportURL(uri, origin), undefined, uri);
    }
});

test("canceling the save picker does not start a request", async () => {
    const result = await saveRemoteExport({uri: "/export/a.zip", origin,
        choosePath: async () => ({canceled: true}),
        fetch: () => assert.fail("Unexpected request"),
    });
    assert.deepEqual(result, {status: "canceled"});
});

test("downloads stream with the authenticated session and replace the chosen file only on completion", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-remote-export-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const filePath = path.join(directory, "chosen.zip");
    await fs.writeFile(filePath, "previous");
    const result = await saveRemoteExport({uri: "/export/source.zip", origin,
        choosePath: async name => {
            assert.equal(name, "source.zip");
            return {filePath};
        },
        fetch: async (url, options) => {
            assert.equal(url, origin + "/export/source.zip");
            assert.equal(options.credentials, "include");
            assert.equal(options.redirect, "manual");
            assert.equal(options.bypassCustomProtocolHandlers, true);
            assert.equal(await fs.readFile(filePath, "utf8"), "previous");
            return new Response("downloaded", {headers: {"Content-Disposition": "attachment; filename=ignored.zip"}});
        },
    });
    assert.deepEqual(result, {status: "success", name: "chosen.zip"});
    assert.equal(await fs.readFile(filePath, "utf8"), "downloaded");
    assert.deepEqual(await fs.readdir(directory), ["chosen.zip"]);
});

test("authentication errors, redirects, interrupted streams and aborts preserve the destination", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-remote-export-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const filePath = path.join(directory, "chosen.zip");
    const controller = new AbortController();
    controller.abort();
    for (const scenario of [
        {response: () => new Response("login", {status: 403})},
        {response: () => new Response(null, {status: 302, headers: {Location: "/check-auth"}})},
        {response: () => new Response("login", {headers: {"Content-Type": "text/html"}})},
        {response: () => new Response(new ReadableStream({start(stream) {
            stream.enqueue(new Uint8Array([1, 2, 3]));
            stream.error(new Error("connection lost"));
        }}), {headers: {"Content-Disposition": "attachment"}})},
        {response: () => new Response("data", {headers: {"Content-Disposition": "attachment"}}), signal: controller.signal},
    ]) {
        await fs.writeFile(filePath, "previous");
        await assert.rejects(saveRemoteExport({uri: "/export/a.zip", origin,
            choosePath: async () => ({filePath}), fetch: async () => scenario.response(), signal: scenario.signal,
        }));
        assert.equal(await fs.readFile(filePath, "utf8"), "previous");
        assert.deepEqual(await fs.readdir(directory), ["chosen.zip"]);
    }
});
