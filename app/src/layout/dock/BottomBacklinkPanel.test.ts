import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const wait = () => new Promise(resolve => setTimeout(resolve, 100));
    const created: Array<{options: any, destroyed: boolean, refreshes: number}> = [];
    let registrations = 0;
    let removals = 0;
    class Backlink {
        private record: typeof created[number];
        constructor(options: any) {
            this.record = {options, destroyed: false, refreshes: 0};
            created.push(this.record);
            options.element.classList.add("sy__backlink");
            options.element.innerHTML = '<div class="backlinkList">Backlinks</div>';
            queueMicrotask(() => options.emptyChange(false));
        }
        refreshDirty() { this.record.refreshes++; }
        switchBlock(blockId: string, rootId: string, notebookId: string) {
            Object.assign(this.record.options, {blockId, rootId, notebookId});
        }
        destroy() { this.record.destroyed = true; }
    }
    const {BottomBacklinkPanel, getBottomBacklinkBlockId} = new Function("Backlink", "setPadding", source +
        "\nreturn {BottomBacklinkPanel, getBottomBacklinkBlockId};")(Backlink, () => {});
    window.siyuan = {config: {editor: {backlinkShowBottom: true}}} as unknown as typeof window.siyuan;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const owner = document.createElement("div");
    owner.className = "protyle";
    owner.innerHTML = '<div class="protyle-content"><div class="protyle-wysiwyg"></div></div>';
    document.body.append(owner);
    const content = owner.firstElementChild as HTMLElement;
    content.style.cssText = "height:200px;width:360px;overflow-y:auto";
    const wysiwyg = content.firstElementChild as HTMLElement;
    wysiwyg.style.cssText = "height:1800px;flex:none";
    const protyle = {app: {}, element: owner, contentElement: content, wysiwyg: {element: wysiwyg},
        notebookId: "encrypted-box", block: {id: "doc", rootID: "doc", parentID: "", showAll: false, scroll: true}};
    const panel = new BottomBacklinkPanel(protyle, () => {
        registrations++;
        return () => {removals++;};
    });
    panel.update();
    const element = content.querySelector<HTMLElement>(".sy__backlink--bottom");
    check.ok(element);
    check.equal(element.classList.contains("fn__none"), true, "partial documents hide bottom backlinks");
    await wait();
    check.equal(created.length, 0);
    wysiwyg.setAttribute("data-bottom-eof", "true");
    await wait();
    check.equal(element.classList.contains("fn__none"), false);
    check.equal(created.length, 0, "backlinks outside the prefetch margin remain unloaded");
    content.scrollTop = content.scrollHeight;
    await wait();
    check.equal(created.length, 1);
    check.equal(created[0].options.blockId, "doc");
    check.equal(created[0].options.notebookId, "encrypted-box");
    check.equal(registrations, 1);
    check.equal(element.classList.contains("sy__backlink--pending"), false);
    check.equal(getComputedStyle(element.querySelector(".backlinkList")).overflowY, "visible",
        "mobile bottom backlinks share document scrolling");
    const dock = document.createElement("div");
    dock.className = "sy__backlink";
    dock.innerHTML = '<div class="backlinkList"></div>';
    document.body.append(dock);
    check.equal(getComputedStyle(dock.firstElementChild).overflowY, "auto", "mobile dock retains independent scrolling");
    panel.update();
    check.equal(content.querySelectorAll(".sy__backlink--bottom").length, 1);
    check.equal(created.length, 1);
    created[0].options.emptyChange(true);
    check.equal(element.classList.contains("fn__none"), true);
    created[0].options.emptyChange(false);
    check.equal(element.classList.contains("fn__none"), false);
    protyle.block.showAll = true;
    protyle.block.id = "zoomed";
    check.equal(getBottomBacklinkBlockId(protyle), "zoomed");
    panel.refresh();
    check.equal(created[0].options.blockId, "zoomed");
    const staleCallback = created[0].options.emptyChange;
    window.siyuan.config.editor.backlinkShowBottom = false;
    panel.update();
    check.equal(created[0].destroyed, true);
    check.equal(removals, 1);
    check.equal(content.querySelector(".sy__backlink--bottom"), null);
    window.siyuan.config.editor.backlinkShowBottom = true;
    panel.update();
    staleCallback(true);
    check.equal(content.querySelector(".sy__backlink--bottom").classList.contains("fn__none"), false,
        "a destroyed panel cannot hide its replacement");
    panel.destroy();
    await wait();
    check.equal(content.querySelector(".sy__backlink--bottom"), null);
    owner.remove();
    dock.remove();
    style.remove();
    return "Bottom backlink browser cases passed";
};

test("bottom backlinks preserve lazy loading, visibility, cleanup and mobile scrolling", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = readFileSync(path.join(__dirname, "BottomBacklinkPanel.ts"), "utf8");
    const compiled = transpileModule(source.slice(source.indexOf("export const getBottomBacklinkBlockId"))
        .replace(/export /g, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const css = compile(path.join(__dirname, "../../assets/scss/mobile.scss"), {logger: {warn: () => {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-bottom-backlink-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(compiled) + "," + JSON.stringify(css) + ")")}));
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
        assert.match(result.stdout, /Bottom backlink browser cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-bottom-backlink-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
