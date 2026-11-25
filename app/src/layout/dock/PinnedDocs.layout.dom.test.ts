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
    const pins = panel.querySelector<HTMLElement>(".file-tree__pins");
    const pinned = pins.querySelector<HTMLElement>(".file-tree__pins-list");
    const files = pins.nextElementSibling as HTMLElement;
    const closed = files.nextElementSibling as HTMLElement;
    closed.style.transition = "none";
    const rows = (element: HTMLElement, count: number) => {
        element.innerHTML = `<ul class="b3-list" style="display:flex;flex-direction:column">${
            Array.from({length: count}, (_, index) => `<li class="b3-list-item">Document ${index}</li>`).join("")}</ul>`;
    };
    const scrolls = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 1;
    const bottom = (element: HTMLElement) => element.getBoundingClientRect().bottom;
    const checkFooter = () => check.ok(Math.abs(bottom(panel) - bottom(closed)) <= 1, "closed notebooks stay at the bottom");

    rows(pinned, 40);
    rows(files, 3);
    check.ok(pins.clientHeight > files.clientHeight, "pinned documents use the space left by a short tree");
    check.equal(scrolls(pinned), true);
    check.equal(scrolls(files), false);
    check.ok(Math.abs(bottom(files) - closed.getBoundingClientRect().top) <= 1, "no unused height when pins still overflow");
    checkFooter();

    rows(files, 40);
    const split = pins.clientHeight / (pins.clientHeight + files.clientHeight);
    check.ok(split > 0.37 && split < 0.44, `both long lists share the panel (${split})`);
    check.equal(scrolls(pinned), true);
    check.equal(scrolls(files), true);
    for (const element of [pinned, files]) {
        element.scrollTop = element.scrollHeight;
        check.ok(bottom(element.querySelector("li:last-child")) <= bottom(element) + 1, "last document is reachable");
    }

    const expandedHeight = files.clientHeight;
    closed.style.height = "40%";
    check.ok(files.clientHeight < expandedHeight, "expanding closed notebooks reduces the space above");
    checkFooter();
    closed.style.height = mobile ? "42px" : "30px";

    rows(pinned, 1);
    check.ok(files.clientHeight > expandedHeight, "a short pinned list lets the tree grow");
    check.equal(scrolls(pinned), false);
    rows(files, 3);
    checkFooter();

    pinned.classList.add("fn__none");
    check.ok(pins.clientHeight <= 50, "collapsed pins only show the heading");
    rows(files, 40);
    checkFooter();
    pins.classList.add("fn__none");
    check.ok(files.clientHeight > expandedHeight, "the tree gets the available height without pins");
    checkFooter();
};

test("document panel shares available height across pinned documents and notebooks", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SIYUAN_ELECTRON_HEADLESS,
    timeout: 30000,
}, async () => {
    const pinned = readFileSync(resolve(__dirname, "PinnedDocs.ts"), "utf8").match(/this\.element\.innerHTML = `([^`]+)`;/)[1]
        .replace("${window.siyuan.languages.pinnedDocs}", "Pinned");
    const layouts = [false, true].map(mobile => {
        const source = readFileSync(resolve(__dirname, mobile ? "../../mobile/dock/MobileFiles.ts" : "Files.ts"), "utf8");
        const sections = source.match(/<div class="[^"]*fn__flex-1"[^>]*><\/div>\r?\n<ul class="b3-list[\s\S]*?<\/ul>\r?\n<\/ul>/)[0]
            .replace("${window.siyuan.languages.closeNotebook}", "Closed notebooks");
        const content = `<div style="height:40px;flex-shrink:0"></div><div class="file-tree__pins fn__flex-column">${pinned}</div>${sections}`;
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
        rmSync(directory, {recursive: true, force: true});
    }
});
