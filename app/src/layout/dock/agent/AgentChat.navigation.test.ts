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
        '" style="position:absolute;left:80px;top:20px;width:360px;height:400px">' +
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
        resolveNavMarker: (clientY: number) => HTMLElement | null;
        rebuildNavMarkers: () => void;
        updateActiveMarker: () => void;
    };
    const panel = document.querySelector<HTMLElement>(".sy__agentChat");
    const wrap = document.querySelector<HTMLElement>(".agent-chat__messages-wrap");
    chat.messagesContainer = document.querySelector(".agent-chat__messages");
    chat.initNavRail(wrap);
    chat.messagesContainer.addEventListener("scroll", () => chat.updateActiveMarker());
    chat.entries = [
        {type: "user", id: "first", content: 'First <img src=x> & "quoted" %2F'},
        {type: "assistant", id: "intermediate", content: "Intermediate response"},
        {type: "thinking", id: "thinking", content: "Private reasoning"},
        {type: "assistant", id: "answer", content: 'Answer <img src=x> & "quoted"'},
        {type: "assistant", id: "tool", content: ""},
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
    check.equal(getComputedStyle(rail).pointerEvents, "none", "the collapsed painting space cannot intercept clicks");
    await move(first.left + first.width / 2, first.top + first.height / 2);
    check.equal(getComputedStyle(tip).animationName, "none", "navigation previews appear without a delayed animation");
    check.equal(rail.getBoundingClientRect().width, initialWidth, "hover never shifts marker layout");
    check.ok(first.width <= 24, "collapsed markers have narrow hit targets");
    check.equal(getComputedStyle(rail).pointerEvents, "auto", "hover activates the whole expanded rail");
    check.equal(chat.messagesContainer.scrollTop, 0, "hover never jumps");
    check.equal(tip.classList.contains("fn__none"), false);
    check.equal(tip.querySelector(".agent-chat__nav-title").textContent, chat.entries[0].content,
        "preview preserves literal HTML, quotes and percent sequences");
    check.equal(tip.querySelector(".agent-chat__nav-summary").textContent, chat.entries[3].content,
        "preview uses the last nonempty response in this turn and excludes thinking and tool-only entries");
    check.equal(tip.querySelectorAll("img, a, button").length, 0, "message content cannot create interactive preview elements");
    check.equal(markers[0].style.getPropertyValue("--nav-scale"), "4.2");
    check.ok(Math.abs(parseFloat(markers[1].style.getPropertyValue("--nav-scale")) - 3.4) < 0.001);
    await new Promise(resolve => setTimeout(resolve, 150));
    const paint = getComputedStyle(markers[0], "::before");
    const scale = new DOMMatrix(paint.transform).a;
    const paintLeft = first.right - parseFloat(paint.right) - parseFloat(paint.width) * scale;
    check.ok(scale >= 4, "the hovered line grows to at least four times its resting width");
    check.ok(paintLeft >= rail.getBoundingClientRect().left, "the extended line stays inside the scroll clip");
    check.ok(tip.getBoundingClientRect().right < paintLeft, "the preview leaves the whole extended line visible");
    const expandedX = paintLeft + 2;
    await move(expandedX, first.top + first.height / 2);
    check.equal(tip.querySelector(".agent-chat__nav-title").textContent, chat.entries[0].content,
        "moving sideways onto the extended line keeps the preview open");
    const lower = markers[1].getBoundingClientRect();
    await move(expandedX, lower.top + lower.height / 2);
    check.equal(tip.textContent, "Second question", "moving vertically in the expanded area activates another question");
    await move(expandedX, first.top + first.height / 2);
    check.equal(tip.querySelector(".agent-chat__nav-title").textContent, chat.entries[0].content,
        "the expanded area supports switching back without reentering the narrow markers");
    check.equal(getComputedStyle(tip).pointerEvents, "none", "preview cannot intercept clicks");
    const next = markers[1].getBoundingClientRect();
    check.ok(Math.abs(first.bottom - next.top) < 0.1, "adjacent hit targets have no gap");
    // 原生鼠标坐标会取整，逐像素检查须使用整数坐标以匹配实际命中区域。
    for (let y = Math.ceil(first.top + first.height / 2); y < next.bottom; y++) {
        await move(first.left + first.width / 2, y);
        check.equal(tip.classList.contains("fn__none"), false, "preview stays visible between lines");
        check.equal(tip.querySelector(".agent-chat__nav-title").textContent, y < next.top ? chat.entries[0].content : "Second question",
            `preview at y=${y}, next marker starts at ${next.top}`);
    }
    // 分数缩放下接缝的命中会被浏览器反复改判，预览必须由坐标解析并保持稳定。
    const seam = next.top;
    const seamTexts = new Set<string>();
    for (let i = 0; i < 20; i++) {
        rail.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientY: seam - 0.001}));
        seamTexts.add(tip.querySelector(".agent-chat__nav-title").textContent || "");
    }
    check.equal(seamTexts.size, 1, "preview never alternates around a marker seam");
    check.equal(Array.from(seamTexts)[0], chat.entries[0].content, "a coordinate above the seam previews the upper marker");
    rail.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientY: seam + 0.001}));
    check.equal(tip.textContent, "Second question", "a coordinate below the seam previews the lower marker");
    check.equal(tip.querySelector(".agent-chat__nav-summary"), null, "unanswered questions do not reuse an earlier response");
    check.equal((chat.resolveNavMarker(seam - 0.001) as HTMLElement).dataset.messageId, "first",
        "click resolution above the seam matches the preview");
    check.equal((chat.resolveNavMarker(seam + 0.001) as HTMLElement).dataset.messageId, "second",
        "click resolution below the seam matches the preview");
    await move(first.left + first.width / 2, first.top + first.height / 2);
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
    check.equal(markers[0].style.getPropertyValue("--nav-scale"), "", "leaving restores the short lines");
    check.equal(getComputedStyle(rail).pointerEvents, "none", "leaving restores the narrow activation area");
    check.equal(chat.messagesContainer.scrollTop, 0, "copying never jumps");
    const second = markers[1].getBoundingClientRect();
    await move(second.left + 10, second.top + 4);
    check.equal(tip.textContent, "Second question", "hover updates only the selected message preview");
    await click(second.left - 20, second.top + 0.5);
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
    // 接缝上预览与点击必须指向同一条消息，避免「预览上一条、跳转下一条」。
    chat.entries = [
        {type: "user", id: "first", content: "Upper question"},
        {type: "user", id: "second", content: "Lower question"},
    ];
    chat.rebuildNavMarkers();
    const seamTop = (rail.children[1] as HTMLElement).getBoundingClientRect().top;
    chat.messagesContainer.querySelectorAll(".agent-chat__msg--jumped").forEach(
        element => element.classList.remove("agent-chat__msg--jumped"));
    chat.messagesContainer.scrollTop = 0;
    rail.dispatchEvent(new MouseEvent("click", {bubbles: true, clientY: seamTop - 0.001}));
    check.equal(chat.messagesContainer.querySelector('[data-message-id="first"]').classList.contains("agent-chat__msg--jumped"),
        true, "clicking above the seam jumps to the upper message");
    check.equal(chat.messagesContainer.querySelector('[data-message-id="second"]').classList.contains("agent-chat__msg--jumped"),
        false, "clicking above the seam never jumps to the lower message");

    // 短问题居中后仍在顶部判断线下方，后续长回答保证跳转不受底部夹限影响。
    chat.messagesContainer.innerHTML = "";
    chat.entries = ["first", "second", "third"].map(id => ({type: "user", id, content: id}));
    for (const entry of chat.entries) {
        const message = document.createElement("div");
        message.className = "agent-chat__msg agent-chat__msg--user";
        message.dataset.messageId = entry.id;
        message.textContent = entry.content;
        const answer = document.createElement("div");
        answer.style.cssText = "height:800px;flex-shrink:0";
        chat.messagesContainer.append(message, answer);
    }
    chat.rebuildNavMarkers();
    for (const fontSize of [14, 32]) {
        panel.style.fontSize = `${fontSize}px`;
        await new Promise(resolve => setTimeout(resolve, 400));
        for (const index of [2, 0, 1]) {
            const marker = rail.children[index] as HTMLElement;
            const bounds = marker.getBoundingClientRect();
            rail.dispatchEvent(new MouseEvent("click", {bubbles: true, clientY: bounds.top + bounds.height / 2}));
            await new Promise(resolve => setTimeout(resolve, 800));
            check.equal(marker.classList.contains("agent-chat__nav-rail-marker--active"), true,
                `centered short question ${index} is active at font size ${fontSize}: ` + JSON.stringify({
                    top: chat.messagesContainer.scrollTop, height: chat.messagesContainer.clientHeight,
                    messageTop: chat.messagesContainer.querySelector(`[data-message-id="${chat.entries[index].id}"]`)
                        .getBoundingClientRect().top, containerTop: chat.messagesContainer.getBoundingClientRect().top,
                    active: rail.querySelector(".agent-chat__nav-rail-marker--active")?.getAttribute("data-message-id"),
                }));
        }
    }
    const questions = chat.messagesContainer.querySelectorAll<HTMLElement>(".agent-chat__msg--user");
    const center = chat.messagesContainer.getBoundingClientRect().top + chat.messagesContainer.clientHeight / 2;
    chat.messagesContainer.scrollTop += questions[2].getBoundingClientRect().top - center + 2;
    await tick();
    check.equal(rail.children[2].classList.contains("agent-chat__nav-rail-marker--active"), true,
        "manual scrolling updates the active turn");
    questions[2].nextElementSibling.remove();
    chat.messagesContainer.scrollTop = chat.messagesContainer.scrollHeight;
    await tick();
    check.equal(rail.children[2].classList.contains("agent-chat__nav-rail-marker--active"), true,
        "the last short question stays active when scrolling is clamped at the bottom");
    return "Navigation cases passed";
};

const markerPaintFixture = async (css: string) => {
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.style.cssText = "margin:0;background:#fff";
    document.documentElement.style.setProperty("--b3-theme-on-surface", "#202020");
    document.documentElement.style.setProperty("--b3-theme-primary", "#0044cc");
    document.body.innerHTML = ["", " agent-chat__nav-rail-marker--active"].map((active, index) =>
        `<div class="agent-chat__nav-rail-marker${active}" style="position:absolute;left:40px;top:${40 + index * 40}px"></div>`).join("");
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
        width: innerWidth,
        height: innerHeight,
        markers: Array.from(document.body.children).map(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                left: parseFloat(style.paddingLeft), top: parseFloat(style.paddingTop),
                contentWidth: parseFloat(style.width), contentHeight: parseFloat(style.height)};
        }),
    };
};

test("agent navigation fills marker gaps and shows previews immediately", () => {
    const css = compile(path.resolve(__dirname, "../../../assets/scss/business/_ai_agent.scss"), {
        logger: Logger.silent,
    }).css;
    const rule = (selector: string) => css.match(new RegExp(`${selector} \\{([^}]+)\\}`))?.[1] || "";
    assert.doesNotMatch(rule("\\.agent-chat__nav-rail"), /\bgap\s*:/);
    assert.match(rule("\\.agent-chat__nav-rail-marker"), /padding: calc\(3px \+ var\(--nav-gap, 0px\) \/ 2\) 5px/);
    assert.match(rule("\\.tooltip--agent-nav"), /animation: none/);
});

test("agent navigation keeps previews outside its click targets, paints short lines at every zoom and stays hidden on mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const source = createSourceFile("AgentChat.ts", readFileSync(path.join(__dirname, "AgentChat.ts"), "utf8"),
        ScriptTarget.Latest, true);
    const methods: string[] = [];
    const names = new Set(["initNavRail", "resolveNavMarker", "showNavPreview", "resetNavPreview", "updateNavEmphasis",
        "rebuildNavMarkers", "updateActiveMarker", "jumpToMessage"]);
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
                if (sheet.name === "base") {
                    for (const zoom of [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
                        win.webContents.setZoomFactor(zoom);
                        const fixture = await win.webContents.executeJavaScript("(" +
                            ${JSON.stringify(markerPaintFixture.toString())} + ")(" + JSON.stringify(css) + ")");
                        const image = await win.webContents.capturePage();
                        const size = image.getSize();
                        const bitmap = image.toBitmap();
                        const scaleX = size.width / fixture.width;
                        const scaleY = size.height / fixture.height;
                        const check = require("node:assert/strict");
                        for (const [index, marker] of fixture.markers.entries()) {
                            const context = theme + " zoom=" + zoom + " active=" + Boolean(index);
                            check.ok(Math.abs(marker.width - 20) < 0.1, context + ": click width is preserved");
                            check.ok(Math.abs(marker.height - 8) < 0.1, context + ": click height is preserved");
                            check.ok(Math.abs(marker.contentWidth - 10) < 0.1, context + ": line width is preserved");
                            check.ok(Math.abs(marker.contentHeight - 2) < 0.1, context + ": line height is preserved");
                            let painted = 0;
                            for (let y = Math.floor(marker.y * scaleY); y < Math.ceil((marker.y + marker.height) * scaleY); y++) {
                                for (let x = Math.floor(marker.x * scaleX); x < Math.ceil((marker.x + marker.width) * scaleX); x++) {
                                    const offset = (y * size.width + x) * 4;
                                    if (Math.min(bitmap[offset], bitmap[offset + 1], bitmap[offset + 2]) >= 235) continue;
                                    painted++;
                                    // Allow one raster pixel for fractional positioning and antialiasing.
                                    check.ok(x >= Math.floor((marker.x + marker.left) * scaleX) - 1 &&
                                        x < Math.ceil((marker.x + marker.left + marker.contentWidth) * scaleX) + 1 &&
                                        y >= Math.floor((marker.y + marker.top) * scaleY) - 1 &&
                                        y < Math.ceil((marker.y + marker.top + marker.contentHeight) * scaleY) + 1,
                                        context + ": marker paint must stay inside the short line, outside the click padding");
                                }
                            }
                            check.ok(painted > 0, context + ": marker remains visible");
                        }
                    }
                    win.webContents.setZoomFactor(1);
                    console.log("Marker paint cases passed");
                }
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
        assert.equal(result.stdout.match(/Marker paint cases passed/g)?.length, 2);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-agent-navigation-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
