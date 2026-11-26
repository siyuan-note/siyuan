import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";

const checkLayout = (markup: string, mobile: boolean) => {
    const check = require("node:assert/strict");
    document.body.innerHTML = markup;
    const panel = document.querySelector<HTMLElement>(".file-tree, [data-type='sidebar-file']");
    const scroll = panel.querySelector<HTMLElement>("[data-file-tree-scroll]");
    const pins = panel.querySelector<HTMLElement>(".file-tree__pins");
    const pinned = pins.querySelector<HTMLElement>("[data-pin-list]");
    const files = pins.nextElementSibling as HTMLElement;
    const closed = scroll.nextElementSibling as HTMLElement;
    closed.style.transition = "none";
    const rows = (element: HTMLElement, count: number) => {
        element.innerHTML = `<ul class="b3-list" style="display:flex;flex-direction:column">${
            Array.from({length: count}, (_, index) => `<li class="b3-list-item">Document ${index}</li>`).join("")}</ul>`;
    };
    const scrolls = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 1;
    const top = (element: HTMLElement) => element.getBoundingClientRect().top;
    const bottom = (element: HTMLElement) => element.getBoundingClientRect().bottom;
    const checkFooter = () => check.ok(Math.abs(bottom(panel) - bottom(closed)) <= 1, "closed notebooks stay at the bottom");

    rows(pinned, 40);
    rows(files, 40);
    check.ok(top(files) > bottom(scroll), "long pinned content moves notebooks below the viewport");
    check.equal(scrolls(scroll), true);
    check.equal(scrolls(pinned), false);
    check.equal(scrolls(files), false);
    const position = scroll.scrollTop + bottom(pinned.querySelector("li:last-child")) - bottom(scroll);
    scroll.scrollTop = position;
    check.ok(Math.abs(bottom(pinned.querySelector("li:last-child")) - bottom(scroll)) <= 1, "the last pin scrolls into view");
    scroll.scrollTop = scroll.scrollHeight;
    check.ok(bottom(files.querySelector("li:last-child")) <= bottom(scroll) + 1, "the same scrollbar reaches the last notebook row");
    check.ok(bottom(pins.querySelector("[data-pin-heading]")) < top(scroll), "the pin heading scrolls with its rows");

    const expandedHeight = scroll.clientHeight;
    closed.style.height = "40%";
    check.ok(scroll.clientHeight < expandedHeight, "expanding closed notebooks reduces the space above");
    checkFooter();
    closed.style.height = mobile ? "42px" : "30px";

    scroll.scrollTop = 0;
    pinned.classList.add("fn__none");
    check.ok(top(files) < bottom(scroll), "collapsing pins brings notebooks into view");
    check.ok(pins.clientHeight <= 55, "collapsed pins only show the heading");
    pins.classList.add("fn__none");
    check.ok(top(files) - top(scroll) <= 2, "notebooks start at the top without pins");
    checkFooter();
};

test("pinned documents and notebooks move through the same document panel viewport", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SIYUAN_ELECTRON_HEADLESS,
    timeout: 30000,
}, async () => {
    const pinned = readFileSync(resolve(__dirname, "PinnedDocs.ts"), "utf8").match(/this\.element\.innerHTML = `([^`]+)`;/)[1]
        .replace("${window.siyuan.languages.pinnedDocs}", "Pinned");
    const layouts = [false, true].map(mobile => {
        const source = readFileSync(resolve(__dirname, mobile ? "../../mobile/dock/MobileFiles.ts" : "Files.ts"), "utf8");
        const sections = source.match(/<div class="fn__flex-1" data-file-tree-scroll>[\s\S]*?<\/ul>\r?\n<\/ul>/)[0]
            .replace("${window.siyuan.languages.closeNotebook}", "Closed notebooks")
            .replace('<div class="file-tree__items"', `<div class="file-tree__pins">${pinned}</div><div class="file-tree__items"`);
        const content = `<div style="height:40px;flex-shrink:0"></div>${sections}`;
        const markup = mobile ? `<div class="side-panel"><div class="b3-list--mobile" style="width:340px;height:620px">
            <div class="fn__flex-column" data-type="sidebar-file">${content}</div></div></div>` :
            `<div class="file-tree fn__flex-column" style="width:220px;height:380px;min-height:0">${content}</div>`;
        const css = compile(resolve(__dirname, `../../assets/scss/${mobile ? "mobile" : "base"}.scss`),
            {logger: {warn() {}, debug() {}}}).css;
        return {markup, css, mobile};
    });
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-pinned-docs-layout-"));
    const script = resolve(directory, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:800, height:800,
        webPreferences:{nodeIntegration:true, contextIsolation:false, backgroundThrottling:false, offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        for (const {markup, css, mobile} of ${JSON.stringify(layouts)}) {
            const failure = await win.webContents.executeJavaScript("document.head.innerHTML = '<style>' + " + JSON.stringify(css) + " + '</style>';" +
                "(() => { const __name = value => value; try { (" + ${JSON.stringify(checkLayout.toString())} + ")(" +
                JSON.stringify(markup) + "," + mobile + "); } catch (error) { return error.stack; } })()");
            if (failure) throw new Error((mobile ? "Mobile: " : "Desktop: ") + failure);
        }
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.env.SIYUAN_ELECTRON_HEADLESS ? ["--ozone-platform=headless", script] : [script];
        await promisify(execFile)(require("electron") as unknown as string, args,
            {env, windowsHide: true, timeout: 25000});
    } finally {
        rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
