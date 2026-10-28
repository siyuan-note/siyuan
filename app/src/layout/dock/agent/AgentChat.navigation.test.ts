import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {createSourceFile, forEachChild, isMethodDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string, mobile: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.innerHTML = '<div class="sy__agentChat' + (mobile ? " sy__agentChat--mobile" : "") +
        '" style="position:absolute;left:20px;top:20px;width:360px;height:400px">' +
        '<div class="agent-chat__messages-wrap" style="height:100%">' +
        '<div class="agent-chat__messages"><button id="copy" style="position:absolute">Copy</button></div>' +
        '<span class="agent-chat__scroll-bottom agent-chat__scroll-bottom--visible"></span></div></div>' +
        '<div id="tooltip" class="fn__none"></div>';
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    const input = {} as typeof import("../../../util/hoverInput");
    new Function("exports", "require", sources.hoverInput)(input, () => ({isInIOS: () => false}));
    const tooltip = {} as typeof import("../../../dialog/tooltip");
    new Function("exports", "require", sources.tooltip)(tooltip, (id: string) => {
        if (id === "../util/hoverInput") return input;
        return {isMobile: () => false, emitToPlugins() {}, forEachPluginSubscriber() {}};
    });
    const escape = {} as typeof import("../../../util/escape");
    new Function("exports", sources.escape)(escape);
    tooltip.initTooltips();
    const Harness = new Function("showTooltip", "hideTooltip", "escapeHtmlTextAndAttr", sources.chat)(
        tooltip.showTooltip, tooltip.hideTooltip, escape.escapeHtmlTextAndAttr);
    const chat = new Harness() as {
        navRail: HTMLElement;
        entries: Array<{type: string, id: string, content: string}>;
        messagesContainer: HTMLElement;
        initNavRail: (wrap: HTMLElement) => void;
        rebuildNavMarkers: () => void;
        updateActiveMarker: () => void;
    };
    const panel = document.querySelector<HTMLElement>(".sy__agentChat");
    const wrap = document.querySelector<HTMLElement>(".agent-chat__messages-wrap");
    chat.messagesContainer = document.querySelector(".agent-chat__messages");
    chat.initNavRail(wrap);
    chat.entries = [
        {type: "user", id: "first", content: 'First <img src=x> & "quoted" %2F'},
        {type: "assistant", id: "answer", content: "Answer"},
        {type: "user", id: "second", content: "Second question"},
    ];
    for (const id of ["first", "second"]) {
        const message = document.createElement("div");
        message.className = "agent-chat__msg agent-chat__msg--user";
        message.dataset.messageId = id;
        message.style.cssText = "min-height:600px;flex-shrink:0";
        chat.messagesContainer.append(message);
    }
    chat.rebuildNavMarkers();
    const rail = chat.navRail;
    const markers = rail.querySelectorAll<HTMLElement>(".agent-chat__nav-rail-marker");
    check.equal(markers.length, 2, "only user messages appear in navigation");
    if (mobile) {
        check.equal(getComputedStyle(rail).display, "none", "mobile keeps its existing hidden navigation");
        return "Navigation cases passed";
    }
    const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const move = async (x: number, y: number) => {
        await require("electron").ipcRenderer.invoke("navigation-input", "mouseMoved", x, y);
        await tick();
    };
    const click = async (x: number, y: number) => {
        await move(x, y);
        for (const type of ["mousePressed", "mouseReleased"]) {
            await require("electron").ipcRenderer.invoke("navigation-input", type, x, y);
        }
        await tick();
    };
    const tip = document.getElementById("tooltip");
    const initialWidth = rail.getBoundingClientRect().width;
    const first = markers[0].getBoundingClientRect();
    check.ok(first.height >= 8, "markers have a usable click height");
    await move(first.left + first.width / 2, first.top + first.height / 2);
    await new Promise(resolve => setTimeout(resolve, 500));
    check.equal(rail.getBoundingClientRect().width, initialWidth, "hover never expands the clickable rail");
    check.ok(initialWidth <= 24);
    check.equal(chat.messagesContainer.scrollTop, 0, "hover never jumps");
    check.equal(tip.classList.contains("fn__none"), false);
    check.equal(tip.textContent, chat.entries[0].content, "preview preserves literal HTML, quotes and percent sequences");
    check.equal(tip.children.length, 0, "message content cannot create interactive preview elements");
    check.equal(getComputedStyle(tip).pointerEvents, "none", "preview cannot intercept clicks");
    const preview = tip.getBoundingClientRect();
    const copy = document.getElementById("copy");
    copy.style.left = `${preview.left - wrap.getBoundingClientRect().left + 5}px`;
    copy.style.top = `${preview.top - wrap.getBoundingClientRect().top + 5}px`;
    let copied = 0;
    copy.addEventListener("click", () => copied++);
    const copyRect = copy.getBoundingClientRect();
    check.ok(copyRect.left < first.left, "copy target is outside the narrow rail");
    check.equal(document.elementFromPoint(copyRect.left + 5, copyRect.top + 5), copy,
        "the copy control remains the hit target beneath the visible preview");
    await click(copyRect.left + 5, copyRect.top + 5);
    check.equal(copied, 1, "copying beside navigation still works");
    check.equal(chat.messagesContainer.scrollTop, 0, "copying never jumps");
    const second = markers[1].getBoundingClientRect();
    await move(second.left + 10, second.top + 4);
    check.equal(tip.textContent, "Second question", "hover updates only the selected message preview");
    await click(second.left + 10, second.top + 4);
    await new Promise(resolve => setTimeout(resolve, 800));
    check.ok(chat.messagesContainer.scrollTop > 0, "clicking a marker scrolls to its message");
    check.ok(chat.messagesContainer.querySelector('[data-message-id="second"]').classList.contains("agent-chat__msg--jumped"));
    chat.updateActiveMarker();
    check.equal(markers[1].classList.contains("agent-chat__nav-rail-marker--active"), true);
    chat.entries = Array.from({length: 150}, (_, i) => ({type: "user", id: `message-${i}`, content: `Question ${i}`}));
    chat.rebuildNavMarkers();
    for (const width of [240, 640]) {
        panel.style.width = `${width}px`;
        await tick();
        check.ok(rail.scrollHeight > rail.clientHeight, "long navigation remains scrollable");
        const bounds = rail.getBoundingClientRect();
        const bottom = panel.querySelector(".agent-chat__scroll-bottom").getBoundingClientRect();
        check.ok(bounds.bottom < bottom.top, "navigation leaves the return-to-bottom control clear");
        check.ok(bounds.right <= wrap.getBoundingClientRect().right - 10, "navigation leaves the message scrollbar clear");
        rail.scrollTop = rail.scrollHeight;
        await tick();
        const last = rail.lastElementChild.getBoundingClientRect();
        check.ok(last.top >= bounds.top && last.bottom <= bounds.bottom, "the last item remains reachable");
    }
    chat.entries = [];
    chat.rebuildNavMarkers();
    check.equal(rail.children.length, 0, "switching to an empty conversation removes stale markers");
    return "Navigation cases passed";
};

test("agent navigation keeps previews outside its click targets on desktop and stays hidden on mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const source = createSourceFile("AgentChat.ts", readFileSync(path.join(__dirname, "AgentChat.ts"), "utf8"),
        ScriptTarget.Latest, true);
    const methods: string[] = [];
    const names = new Set(["initNavRail", "rebuildNavMarkers", "updateActiveMarker", "jumpToMessage"]);
    const visit = (node: import("typescript").Node) => {
        if (isMethodDeclaration(node) && names.has(node.name.getText(source))) methods.push(node.getText(source));
        forEachChild(node, visit);
    };
    visit(source);
    assert.equal(methods.length, names.size);
    const transpile = (text: string) => transpileModule(text, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const sources: Record<string, string> = {chat: transpile(`class Harness {${methods.join("\n")}}\nreturn Harness;`)};
    for (const [name, file] of Object.entries({hoverInput: "util/hoverInput.ts", tooltip: "dialog/tooltip.ts", escape: "util/escape.ts"})) {
        sources[name] = transpile(readFileSync(path.resolve(__dirname, "../../..", file), "utf8"));
    }
    const sheets = ["base", "mobile"].map(name => ({name, css: compile(path.resolve(__dirname,
        `../../../assets/scss/${name}.scss`), {logger: Logger.silent}).css}));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-agent-navigation-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:900,height:700,
        webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("navigation-input", (_event,type,x,y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",
        {type,x,y,button:type === "mouseMoved" ? "none" : "left",clickCount:1}));
    try {
        for (const sheet of ${JSON.stringify(sheets)}) {
            for (const theme of ["daylight", "midnight"]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const css = require("node:fs").readFileSync(${JSON.stringify(path.resolve(__dirname, "../../../../appearance/themes"))} +
                    "/" + theme + "/theme.css", "utf8") + sheet.css;
                console.log(await win.webContents.executeJavaScript("const __name = value => value; (" +
                    ${JSON.stringify(browserCases.toString())} + ")(" + JSON.stringify(${JSON.stringify(sources)}) + "," +
                    JSON.stringify(css) + "," + (sheet.name === "mobile") + ")"));
            }
        }
        win.destroy();app.exit(0);
    } catch(error) {console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 50000});
        assert.equal(result.stdout.match(/Navigation cases passed/g)?.length, 4);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-agent-navigation-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
