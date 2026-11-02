import {test} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as runtime from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {IpcMain} from "electron";
import type {Workspace} from "../shared/types";
import type {MarkdownWindows} from "../markdown/windows";

const setup = async (t: any) => {
    runtime.resetRuntimeState();
    resetElectronStub();
    let invoke: (event: any, value: unknown) => Promise<boolean>;
    mockElectron(t, {ipcMain: {on: () => {}, handle: (_channel: string, handler: typeof invoke) => { invoke = handler; }} as unknown as IpcMain});
    const registry = require("../window/windowRegistry");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-ipc-"));
    const file = path.join(directory, "data", "assets", "test.md");
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, "test");
    const target = {mode: "local", origin: "http://127.0.0.1:6806", ownsKernel: true, port: "6806"};
    const workspace = {webContentsId: 1, workspaceDir: directory, kernelTarget: target} as Workspace;
    runtime.state.workspaces.push(workspace);
    registry.setWindowKernelTarget(1, target);
    registry.markWindowInitialized(1);
    const opened: string[] = [];
    runtime.state.markdown.windows = {open: async (value: string) => { opened.push(value); }} as unknown as MarkdownWindows;
    const requests: Array<{url: string; init: RequestInit}> = [];
    const frame = {url: target.origin + "/stage/build/app/"};
    let resolve: () => Promise<unknown> = async () => ({code: 0, data: file});
    const event = {senderFrame: frame, sender: {id: 1, mainFrame: frame, session: {fetch: async (url: string, init: RequestInit) => {
        requests.push({url, init});
        return {ok: true, json: () => resolve()};
    }}}};
    require("./markdownEditors").registerMarkdownIpc();
    t.after(async () => {
        runtime.resetRuntimeState(); resetElectronStub();
        await fs.rm(directory, {recursive: true, force: true});
    });
    return {invoke: (value: unknown) => invoke(event, value), event, workspace, opened, requests, file,
        respond: (callback: () => Promise<unknown>) => { resolve = callback; }};
};

test("Markdown asset IPC resolves only through its authorized local kernel and opens the real asset", async t => {
    const h = await setup(t);
    assert.equal(await h.invoke("assets/test.md#title"), true);
    assert.deepEqual(h.opened, [await fs.realpath(h.file)]);
    assert.equal(h.requests[0].url, h.workspace.kernelTarget.origin + "/api/asset/resolveAssetPath");
    assert.equal(h.requests[0].init.body, JSON.stringify({path: "assets/test.md"}));
    assert.equal(h.requests[0].init.redirect, "error");
});

test("Markdown asset IPC rejects remote kernels, subframes, arbitrary paths and navigated windows", async t => {
    const h = await setup(t);
    for (const value of [h.file, "file:///tmp/a.md", "assets/../a.md"]) assert.equal(await h.invoke(value), false);
    h.workspace.kernelTarget.mode = "remote";
    assert.equal(await h.invoke("assets/test.md"), false);
    h.workspace.kernelTarget.mode = "local";
    const frame = h.event.senderFrame;
    h.event.senderFrame = {...frame};
    assert.equal(await h.invoke("assets/test.md"), false);
    h.event.senderFrame = frame;
    assert.equal(h.requests.length, 0);
    h.respond(async () => {
        frame.url = "https://untrusted.example/";
        return {code: 0, data: h.file};
    });
    assert.equal(await h.invoke("assets/test.md"), false);
    assert.equal(h.opened.length, 0);
});

test("Markdown asset IPC never opens a decrypted copy or a failed resolution", async t => {
    const h = await setup(t);
    h.respond(async () => ({code: -1, data: h.file}));
    assert.equal(await h.invoke("assets/test.md"), false);
    h.respond(async () => ({code: 0, data: path.join(h.workspace.workspaceDir!, "temp", "decrypted.md")}));
    assert.equal(await h.invoke("assets/test.md"), false);
    assert.equal(h.opened.length, 0);
});
