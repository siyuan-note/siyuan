import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const errors: string[] = [];
    const requests: {id: string, pinned: boolean}[] = [];
    const rows = [{id: "old", title: "Older session", createdAt: 1, pinnedAt: 0},
        {id: "active", title: "Current session", createdAt: 2, pinnedAt: 0}];
    let rejectPin = false;
    let release: () => void;
    let pending: Promise<void> | undefined;
    const store = {
        list: async () => ({sessions: rows.slice().sort((a, b) => b.pinnedAt - a.pinnedAt || b.createdAt - a.createdAt)
            .map(row => ({...row})), total: rows.length, page: 1}),
        setPinned: async (id: string, pinned: boolean) => {
            requests.push({id, pinned});
            await pending;
            if (rejectPin) {
                throw new Error("Pin failed");
            }
            rows.find(row => row.id === id).pinnedAt = pinned ? 100 : 0;
        },
    };
    const module = {exports: {} as {AgentSessionPanel: new (...args: unknown[]) => {
        render: () => Promise<void>, destroy: () => void,
    }}};
    const noop = () => {};
    const dependencies: Record<string, unknown> = {
        "./SessionStore": {SessionStore: store},
        "../../../util/escape": {escapeHtml: (value: string) => value},
        "../../../util/setPosition": {setPosition: noop},
        "../../../protyle/util/hasClosest": {hasClosestByClassName: (element: Element, name: string) => element.closest("." + name)},
        "../../../protyle/util/compatibility": {isInMobileApp: () => false, isPhablet: () => false},
        "../../../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: false})},
        "../../../menus/menuMouseScroll": {bindMenuMouseScroll: noop},
        "../../../dialog/message": {showMessage: (message: string) => errors.push(message)},
    };
    new Function("require", "module", "exports", source)((id: string) => dependencies[id] || {}, module, module.exports);
    Object.assign(window, {siyuan: {zIndex: 10, languages: {
        pinDoc: "Pin", unpinDoc: "Unpin", rename: "Rename", more: "More", delete: "Delete",
    }}});
    const trigger = document.createElement("button");
    document.body.append(trigger);
    let switched = 0;
    for (const mobile of [false, true]) {
        rows[0].pinnedAt = 0;
        requests.length = 0;
        const panel = new module.exports.AgentSessionPanel(trigger, document.body, () => "active", () => "Untitled",
            {onSwitch: async () => { switched++; }}, mobile);
        await panel.render();
        const row = () => document.querySelector<HTMLElement>('.agent-session-popup .b3-list-item[data-id="old"]');
        const pin = () => {
            row().querySelector<HTMLElement>(".agent-session-more").click();
            return row().querySelector<HTMLButtonElement>('[data-action="pin"]');
        };
        check.equal(pin().textContent, "Pin");
        pending = new Promise(resolve => { release = resolve; });
        const button = row().querySelector<HTMLButtonElement>('[data-action="pin"]');
        button.click();
        button.click();
        check.equal(requests.length, 1, "repeated clicks cannot queue duplicate pin requests");
        check.equal(button.disabled, true);
        release();
        pending = undefined;
        await tick();
        check.equal(document.querySelector(".agent-session-popup .b3-list-item").getAttribute("data-id"), "old");
        check.ok(row().querySelector('.b3-list-item__graphic use[href="#iconPin"], .b3-list-item__graphic use'));
        check.equal(pin().textContent, "Unpin");
        check.equal(switched, 0, "pinning does not activate the target session");
        panel.destroy();
        await panel.render();
        check.equal(pin().textContent, "Unpin", "reopening restores the persisted pin state");
        rejectPin = true;
        row().querySelector<HTMLButtonElement>('[data-action="pin"]').click();
        await tick();
        check.equal(errors.at(-1), "Pin failed");
        check.equal(rows[0].pinnedAt, 100, "a failed request preserves the previous pin");
        rejectPin = false;
        pin().click();
        await tick();
        check.equal(rows[0].pinnedAt, 0);
        check.equal(document.querySelector(".agent-session-popup .b3-list-item").getAttribute("data-id"), "active");
        check.deepEqual(requests.map(request => request.pinned), [true, false, false]);
        check.equal(switched, 0);
        panel.destroy();
    }
    trigger.remove();
    return "Session pin UI cases passed";
};

test("desktop and mobile session menus persist pins without switching chats", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "AgentSessionPanel.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-session-pins-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(source) + ").catch(error => { throw new Error(error.stack); })")}));
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
        assert.match(result.stdout, /Session pin UI cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-session-pins-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
