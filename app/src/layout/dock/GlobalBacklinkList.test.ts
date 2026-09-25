import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const response = (url: string) => url.endsWith("getGlobalBacklinks") ? {
        code: 0,
        data: {snapshot: "snapshot", total: 1, offset: 0, items: [{id: "link", hPath: "Source", anchor: "Text"}]}
    } : {code: 0, data: {items: [] as unknown[]}};
    const GlobalBacklinkList = new Function("fetchSyncPost", "GLOBAL_BACKLINK_PAGE_SIZE",
        "globalBacklinkPageWindow", "hasAVEditorSession", "waitForPendingTransactions",
        source + "\nreturn GlobalBacklinkList;")(
        async (url: string) => response(url), 50, () => ({start: 0, end: 50}),
        () => false, async (): Promise<undefined> => undefined) as typeof import("./GlobalBacklinkList").GlobalBacklinkList;
    window.siyuan = {languages: {loading: "Loading", emptyContent: "Empty", retry: "Retry"}} as unknown as typeof window.siyuan;
    const noop = (): void => undefined;
    const writes: unknown[] = [];
    const state = {get: () => ({id: "link", offset: -100}), set: (_field: string, value: unknown) => {
        writes.push(value);
    }};
    const common = {app: {} as never, state: () => state as never, foldedTypes: (): string[] => [], open: noop,
        editorAdded: noop, editorRemoved: noop, count: noop};

    const owner = document.createElement("div");
    owner.className = "protyle";
    const content = document.createElement("div");
    content.style.cssText = "height: 200px; width: 300px; overflow-y: auto";
    const spacer = document.createElement("div");
    spacer.style.height = "195px";
    const host = document.createElement("div");
    content.append(spacer, host);
    owner.append(content);
    document.body.append(owner);
    const bottomList = new GlobalBacklinkList({...common, host, scroll: content, sharedScroll: true});
    bottomList.search({id: "doc", sort: 1, containChildren: false}, false);
    await new Promise(resolve => setTimeout(resolve, 200));
    check.ok(host.querySelector(".backlinkList__item"));
    check.equal(content.scrollTop, 0, "a saved bottom backlink anchor does not move the document");
    check.equal(writes.length, 0, "shared scrolling does not overwrite a dock anchor");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    owner.prepend(editable);
    editable.focus({preventScroll: true});
    check.equal(document.activeElement, editable);
    const bottomAnchor = bottomList as unknown as {restoreAnchor: (anchor: {id: string, offset: number}) => void};
    bottomAnchor.restoreAnchor({id: "link", offset: -100});
    check.equal(content.scrollTop, 0, "backlink rendering does not scroll a focused editor");
    editable.remove();

    const dock = document.createElement("div");
    dock.style.cssText = "height: 200px; width: 300px; overflow-y: auto";
    document.body.append(dock);
    const dockList = new GlobalBacklinkList({...common, host: dock, scroll: dock, sharedScroll: false});
    const dockFooter = document.createElement("div");
    dockFooter.style.height = "500px";
    dock.append(dockFooter);
    dockList.search({id: "doc", sort: 1, containChildren: false}, false);
    await new Promise(resolve => setTimeout(resolve, 200));
    check.equal(dock.scrollTop, 100, "the dock keeps its own saved reading anchor");
    bottomList.destroy();
    dockList.destroy();
    check.ok(writes.length > 0, "the dock still persists its reading anchor");
    owner.remove();
    dock.remove();
    return "Global backlink anchor cases passed";
};

test("bottom backlinks leave the editor scroll position alone", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = readFileSync(path.join(__dirname, "GlobalBacklinkList.ts"), "utf8");
    const start = source.indexOf("const MIN_SHARED_ANCHOR_VISIBLE_HEIGHT");
    assert.ok(start >= 0);
    const compiled = transpileModule(source.slice(start).replace("export class", "class"), {
        compilerOptions: {target: ScriptTarget.ES2021}
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-global-backlink-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(compiled) + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Global backlink anchor cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-global-backlink-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
