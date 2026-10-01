import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {createSourceFile, isIfStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (renderSource: string, resizeSource: string, luteSource: string, css: string,
                            bridgeSource: string, coreSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    document.body.replaceChildren();
    new Function(luteSource)();
    const lute = Lute.New();
    const style = document.createElement("style");
    style.textContent = css + `
        :root { --b3-theme-on-surface-light: #888; --b3-theme-on-surface: #555;
            --b3-theme-primary: #4285f4; --b3-border-color: #ddd; --b3-border-radius: 6px;
            --b3-theme-background: #fff; --b3-theme-on-background: #222; }
        body { margin: 0; padding: 24px; }
        .protyle-wysiwyg { font-size: 24px; }
    `;
    document.head.appendChild(style);
    const render = new Function(renderSource + "\nreturn renderIFrameResize;")();
    const updates: {before: string, after: string}[] = [];
    const start = new Function("protyle", "target", "nodeElement", "event", "documentSelf", "mostRight", "mostBottom", "y",
        "focusBlock", "updateTransaction", "img3115", resizeSource);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.dataset.readonly = "false";
    document.body.appendChild(root);
    const bridgeCore = {};
    new Function("exports", coreSource)(bridgeCore);
    const bridge = {} as {initTouchDragBridge: () => void};
    new Function("exports", "require", bridgeSource)(bridge, (id: string) => id === "./touchDragBridgeCore" ? bridgeCore : {
        Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150},
        isInAndroid: () => false, ipcRenderer: {on() {}}, stopScrollAnimation() {},
    });
    Object.assign(window, {siyuan: {touchDragActive: false}});
    bridge.initTouchDragBridge();
    const create = (type = "NodeIFrame", legacy = false) => {
        root.innerHTML = `<div class="iframe" data-node-id="20261002120000-aaaaaaa" data-type="${type}"
            style="width:300px;height:180px"><div class="iframe-content"><iframe src="about:blank"
            ${legacy ? 'style="width:280px;height:160px" width="280" height="160"' : ""}></iframe>
            <span class="protyle-action__drag" contenteditable="false"></span></div></div>`;
        return root.firstElementChild as HTMLElement;
    };
    for (const type of ["NodeIFrame", "NodeWidget"]) {
        const block = create(type);
        const original = lute.BlockDOM2StdMd(root.innerHTML);
        const corner = block.querySelector(".protyle-action__drag");
        render(root);
        render(block);
        check.equal(block.querySelectorAll(".protyle-block-resize").length, 3);
        check.equal(corner, block.querySelector('[data-resize-axis="both"]'));
        check.equal(lute.BlockDOM2StdMd(root.innerHTML), original, "derived handles preserve serialized source");
        for (const axis of ["width", "height", "both"]) {
            const handle = block.querySelector<HTMLElement>(`[data-resize-axis="${axis}"]`);
            const rect = handle.getBoundingClientRect();
            const frame = block.querySelector("iframe").getBoundingClientRect();
            check.equal(handle.getAttribute("data-prevent-swipe"), "true");
            if (axis !== "height") {
                check.ok(rect.right > frame.right, `${axis} hit region extends beyond the right edge`);
            }
            if (axis !== "width") {
                check.ok(rect.bottom > frame.bottom, `${axis} hit region extends beyond the bottom edge`);
            }
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            check.equal(document.elementFromPoint(x, y), handle, `${axis} handle is not clipped`);
            const decoration = getComputedStyle(handle, "::after");
            check.ok(parseFloat(decoration.width) <= 24);
            check.ok(parseFloat(decoration.height) <= 24);
        }
        for (const legacy of [false, true]) {
            for (const axis of ["width", "height", "both"]) {
                const current = create(type, legacy);
                render(current);
                const iframe = current.querySelector("iframe");
                const width = iframe.clientWidth;
                const height = iframe.clientHeight;
                const handle = current.querySelector<HTMLElement>(`[data-resize-axis="${axis}"]`);
                updates.length = 0;
                const before = current.outerHTML;
                start({disabled: false}, handle, current, {clientX: 400}, document, 1000, 1000, 300,
                    () => {}, (_owner: unknown, node: HTMLElement, html: string) => updates.push({before: html, after: node.outerHTML}),
                    () => check.fail("iframe resizing must not normalize images"));
                check.equal(iframe.style.width, legacy ? "280px" : "");
                check.equal(iframe.style.height, legacy ? "160px" : "");
                document.onmousemove(new MouseEvent("mousemove", {clientX: 440, clientY: 350}));
                check.equal(current.style.width, axis === "height" ? "300px" : `${width + 40}px`);
                check.equal(current.style.height, axis === "width" ? "180px" : `${height + 50}px`);
                if (axis === "width") {
                    check.equal(iframe.style.height, legacy ? "160px" : "");
                    check.equal(iframe.getAttribute("height"), legacy ? "160" : null);
                } else if (axis === "height") {
                    check.equal(iframe.style.width, legacy ? "280px" : "");
                    check.equal(iframe.getAttribute("width"), legacy ? "280" : null);
                }
                document.onmouseup(new MouseEvent("mouseup"));
                check.equal(updates.length, 1);
                check.equal(updates[0].before, before, "undo retains the exact source including historical dimensions");
                check.equal(current.classList.contains("iframe--drag"), false);
                check.equal(handle.classList.contains("touch-resize-active"), false);
                check.equal(document.onmousemove, null);
                check.equal(document.onmouseup, null);
            }
        }
    }
    const centered = create();
    centered.style.margin = "0 auto";
    render(centered);
    const centeredWidth = centered.querySelector("iframe").clientWidth;
    start({disabled: false}, centered.querySelector('[data-resize-axis="width"]'), centered,
        {clientX: 400}, document, 1000, 1000, 300, () => {}, () => {}, () => {});
    document.onmousemove(new MouseEvent("mousemove", {clientX: 420, clientY: 300}));
    check.equal(centered.style.width, `${centeredWidth + 40}px`, "centered blocks resize symmetrically");
    document.onmouseup(new MouseEvent("mouseup"));
    for (const axis of ["width", "height", "both"]) {
        const block = create();
        render(block);
        const handle = block.querySelector<HTMLElement>(`[data-resize-axis="${axis}"]`);
        const rect = handle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const width = block.querySelector("iframe").clientWidth;
        const height = block.querySelector("iframe").clientHeight;
        updates.length = 0;
        handle.addEventListener("mousedown", event => start({disabled: false}, handle, block, event,
            document, 1000, 1000, event.clientY, () => {},
            (_owner: unknown, node: HTMLElement, html: string) => updates.push({before: html, after: node.outerHTML}), () => {}));
        const dispatch = (type: string, offset: number) => {
            const point = new Touch({identifier: 1, target: handle, clientX: x + offset, clientY: y + offset, radiusX: 1, radiusY: 1});
            const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                touches: type === "touchend" ? [] : [point], changedTouches: [point]});
            handle.dispatchEvent(event);
            return event;
        };
        dispatch("touchstart", 0);
        check.equal(dispatch("touchmove", 20).defaultPrevented, true, `${axis} touch drag claims the gesture`);
        dispatch("touchend", 20);
        check.equal(block.style.width, axis === "height" ? "300px" : `${width + 20}px`);
        check.equal(block.style.height, axis === "width" ? "180px" : `${height + 20}px`);
        check.equal(updates.length, 1);
        check.equal(document.onmousemove, null);
        check.equal(handle.classList.contains("touch-resize-active"), false);
    }
    const readonly = create();
    render(readonly);
    root.dataset.readonly = "true";
    check.equal(getComputedStyle(readonly.querySelector(".protyle-block-resize")).display, "none");
    root.dataset.readonly = "false";
    const video = create("NodeVideo");
    render(video);
    check.equal(video.querySelector(".protyle-block-resize"), null);
    video.querySelector("iframe").replaceWith(document.createElement("video"));
    const videoContent = video.querySelector("video");
    videoContent.style.width = "300px";
    videoContent.style.height = "180px";
    start({disabled: false}, video.querySelector(".protyle-action__drag"), video, {clientX: 400},
        document, 1000, 1000, 300, () => {}, () => {}, () => {});
    document.onmousemove(new MouseEvent("mousemove", {clientX: 420, clientY: 330}));
    check.equal(videoContent.style.width, "320px");
    check.equal(videoContent.style.height, "210px");
    document.onmouseup(new MouseEvent("mouseup"));
    root.innerHTML = lute.Md2BlockDOM("![sample](assets/sample.png)");
    const image = root.querySelector("img");
    image.style.width = "100px";
    image.style.height = "60px";
    start({disabled: false}, image.parentElement.querySelector(".protyle-action__drag"), root.firstElementChild,
        {clientX: 400}, document, 1000, 1000, 300, () => {}, () => {}, () => {});
    document.onmousemove(new MouseEvent("mousemove", {clientX: 420, clientY: 330}));
    check.equal(image.parentElement.style.width, "120px");
    check.equal(image.style.height, "");
    document.onmouseup(new MouseEvent("mouseup"));
    const preview = create();
    preview.classList.add("mindmap-view__preview-block");
    render(preview);
    check.equal(preview.querySelector(".protyle-block-resize"), null);
    preview.className = "iframe protyle-wysiwyg__embed";
    render(preview);
    check.equal(preview.querySelector(".protyle-block-resize"), null);
    const block = create();
    render(block);
    const host = document.createElement("div");
    host.className = "mindmap-view";
    host.style.setProperty("--mindmap-view-height", "180px");
    host.innerHTML = '<div class="mindmap-view__viewport"><div style="position:absolute;left:320px">Clipped content</div></div>';
    for (const axis of ["width", "height", "both"]) {
        const handle = document.createElement("div");
        handle.className = "mindmap-view__resize protyle-block-resize touch-resize-active";
        handle.dataset.resizeAxis = axis;
        host.appendChild(handle);
    }
    const mindmap = document.createElement("div");
    mindmap.dataset.nodeId = "20261002120000-bbbbbbb";
    mindmap.dataset.type = "NodeMindmap";
    mindmap.dataset.mindmapViewRendered = "true";
    mindmap.appendChild(host);
    root.appendChild(mindmap);
    check.equal(getComputedStyle(host).overflow, "visible");
    check.equal(getComputedStyle(host.firstElementChild).overflow, "hidden");
    for (const handle of host.querySelectorAll<HTMLElement>(".mindmap-view__resize")) {
        const rect = handle.getBoundingClientRect();
        check.equal(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2), handle,
            JSON.stringify({axis: handle.dataset.resizeAxis, rect: rect.toJSON(), root: root.getBoundingClientRect().toJSON(), viewport: innerWidth}));
        const decoration = getComputedStyle(handle, "::after");
        check.ok(parseFloat(decoration.width) <= 24);
        check.ok(parseFloat(decoration.height) <= 24);
    }
    host.classList.add("fullscreen");
    check.equal(getComputedStyle(host.querySelector(".mindmap-view__resize")).display, "none");
    host.classList.remove("fullscreen");
    block.querySelectorAll(".protyle-block-resize").forEach(handle => handle.classList.add("touch-resize-active"));
    return "IFrame, widget and mind map resize cases passed";
};

test("external resize handles preserve source, independent axes, historical dimensions and clipping", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"), ScriptTarget.ES2021, true);
    let resize = "";
    const visit = (node: import("typescript").Node) => {
        if (isIfStatement(node) && node.expression.getText(source) === '!protyle.disabled && target.classList.contains("protyle-action__drag")') {
            resize = node.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(resize);
    const resizeSource = transpileModule(`function resize() { ${resize} }`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText.replace(/^function resize\(\) \{/, "").replace(/\}\s*$/, "");
    const renderSource = transpileModule(readFileSync("src/protyle/render/iframeResize.ts", "utf8").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const css = compileString('@use "protyle/protyle"; @use "component/typography"; @use "business/resize";',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-block-resize-test-"));
    const script = path.join(temporary, "run.cjs");
    const bridgeSources = ["src/util/touchDragBridge.ts", "src/util/touchDragBridgeCore.ts"].map(file =>
        transpileModule(readFileSync(file, "utf8"), {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText);
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        [renderSource, resizeSource, readFileSync("stage/protyle/js/lute/lute.min.js", "utf8"), css, ...bridgeSources]
            .map(value => JSON.stringify(value)).join(",") + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 700,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: !!process.env.SIYUAN_RESIZE_PREVIEW}});
    win.webContents.setBackgroundThrottling(false);
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        if (process.env.SIYUAN_RESIZE_PREVIEW) {
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            require("fs").writeFileSync(process.env.SIYUAN_RESIZE_PREVIEW + "-light.png", (await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript("document.documentElement.style.setProperty('--b3-theme-background', '#202124'); document.documentElement.style.setProperty('--b3-border-color', '#555'); document.body.style.background = '#202124';");
        if (process.env.SIYUAN_RESIZE_PREVIEW) {
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            require("fs").writeFileSync(process.env.SIYUAN_RESIZE_PREVIEW + "-dark.png", (await win.webContents.capturePage()).toPNG());
        }
        win.setSize(390, 700);
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        if (!await win.webContents.executeJavaScript("matchMedia('(any-pointer: coarse)').matches")) {
            throw new Error("Touch emulation must enable coarse pointer media queries");
        }
        if (process.env.SIYUAN_RESIZE_PREVIEW) {
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            require("fs").writeFileSync(process.env.SIYUAN_RESIZE_PREVIEW + "-narrow.png", (await win.webContents.capturePage()).toPNG());
        }
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /resize cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-block-resize-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
