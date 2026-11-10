import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = (renderSource: string, actionsSource: string, css: string, mobile: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const dependencies = {
        window: {siyuan: {config: {}, languages: {more: "More", rollback: "Rollback", downloadRollback: "Download and rollback"}}},
        isMobile: () => mobile, snapshotMemos: new WeakMap(), updateRepoSelection() {},
        escapeHtml: (value: string) => value, escapeAttr: (value: string) => value,
        renderSnapshotActions: new Function(actionsSource + ";return renderSnapshotActions;")(),
    };
    const render = new Function(...Object.keys(dependencies), renderSource + ";return renderRepoItem;")(...Object.values(dependencies));
    document.body.innerHTML = `<div class="history__snapshots${mobile ? " history__snapshots--mobile" : ""} history__snapshots--narrow fn__flex-column" data-source="local" style="height:100%"><div class="history__snapshot-columns"><div class="history__repo history__snapshot-pane"><div class="fn__flex fn__flex-1 history__panel"><ul data-type="repoList" class="b3-list b3-list--background fn__flex-1"></ul></div></div></div></div>`;
    const list = document.querySelector<HTMLElement>("ul");
    const element = {querySelector: (selector: string) => selector.includes("repoList") ? list : {getAttribute: () => "[]"}};
    for (const width of [320, 400, 768]) {
        document.body.style.width = `${width}px`;
        for (const fontSize of [14, 24]) {
            document.body.style.fontSize = `${fontSize}px`;
            for (const type of ["getRepoSnapshots", "getRepoTagSnapshots", "getCloudRepoSnapshots", "getCloudRepoTagSnapshots"]) {
                const snapshots = Array.from({length: 30}, (_, index) => ({
                    id: "a".repeat(39) + index, memo: "Memo", tag: type.includes("Tag") ? "long-tag".repeat(20) : "",
                    hCreated: "2026-11-06 22:56:15", hSize: "225.33 MB", systemOS: "android", systemName: "localhost",
                }));
                render({data: {snapshots}}, element, type);
                const row = list.querySelector<HTMLElement>("li");
                const content = row.firstElementChild as HTMLElement;
                const description = `${type}, width ${width}, font ${fontSize}`;
                content.scrollTop = 20;
                content.scrollLeft = 20;
                check.equal(content.scrollTop, 0, `snapshot content cannot scroll vertically: ${description}`);
                check.equal(content.scrollLeft, 0, `snapshot content cannot scroll horizontally: ${description}`);
                const action = row.querySelector<HTMLElement>(mobile ? '[data-type="more"]' : ".b3-list-item__action");
                check.ok(action.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom + 1,
                    `actions remain inside their row: ${description}`);
                check.ok(list.scrollHeight > list.clientHeight, `the snapshot list can scroll: ${description}`);
                list.scrollTop = 100;
                check.equal(list.scrollTop, 100);
                list.scrollTop = 0;
                check.ok(list.scrollWidth <= list.clientWidth + 1, `long tags wrap inside the list: ${description}`);
            }
        }
    }
    return "Snapshot list scroll passed";
};

const runSnapshotScroll = async (mobile: boolean) => {
    const source = readFileSync(path.join(__dirname, "history.ts"), "utf8");
    const renderSource = source.slice(source.indexOf("const renderRepoItem ="), source.indexOf("const clearRepoPreview ="));
    let include = true;
    const selected = renderSource.split("\n").filter(line => {
        if (line.includes("/// #if MOBILE")) {
            include = mobile;
        } else if (line.includes("/// #else")) {
            include = !mobile;
        } else if (line.includes("/// #endif")) {
            include = true;
        } else {
            return include;
        }
        return false;
    }).join("\n");
    const compileSource = (text: string) => transpileModule(text, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const actions = compileSource(readFileSync(path.join(__dirname, "snapshotActions.ts"), "utf8").replace("export ", ""));
    const css = compile(path.join(__dirname, `../assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: {warn: () => {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-snapshot-scroll-"));
    const script = path.join(temporary, "run.cjs");
    const expression = "const __name = value => value; (() => {try {return (" + browserCases.toString() + ")(" +
        [compileSource(selected), actions, css, mobile].map(value => JSON.stringify(value)).join(",") + ");} catch (error) {return error.stack;}})()";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 800, height: 850,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
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
        assert.match(result.stdout, /Snapshot list scroll passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-snapshot-scroll-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} snapshot content stays in its row and scrolling belongs to the list`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, () => runSnapshotScroll(mobile));
}
