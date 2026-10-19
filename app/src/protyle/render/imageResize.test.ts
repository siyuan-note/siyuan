import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {createSourceFile, isIfStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, resizeSource: string, luteSource: string, css: string,
                            bridgeSource: string, coreSource: string, selectionSource: string, touchMode: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    check.equal(matchMedia("(hover: none) and (pointer: coarse)").matches, touchMode,
        "the test exercises the requested input mode");
    new Function(luteSource)();
    const lute = Lute.New();
    const api = new Function(source + "\nreturn {bindImageResize, getImageResizeWidth};")() as typeof import("./imageResize");
    const style = document.createElement("style");
    style.textContent = css + `
        body { margin: 24px; }
        :root { --b3-theme-on-surface-light: #888; --b3-theme-on-surface: #555; --b3-theme-primary: #4285f4; }
        .protyle-wysiwyg { width: min(600px, calc(100vw - 48px)); font-size: 24px; }
    `;
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.dataset.readonly = "false";
    document.body.appendChild(root);
    const dispose = api.bindImageResize(root);
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "#6495ed";
    context.fillRect(0, 0, 200, 100);
    const url = canvas.toDataURL();
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const create = async (legacy = false) => {
        root.style.zoom = "";
        root.innerHTML = lute.Md2BlockDOM('![description](assets/sample.png "caption")');
        const image = root.querySelector<HTMLImageElement>("img");
        image.loading = "eager";
        image.src = url;
        if (legacy) {
            image.style.width = "200px";
            image.style.height = "80px";
            image.setAttribute("width", "200");
            image.setAttribute("height", "80");
            image.closest<HTMLElement>(".img").style.width = "200px";
        }
        const original = lute.BlockDOM2StdMd(root.innerHTML);
        await image.decode();
        await settle();
        check.equal(lute.BlockDOM2StdMd(root.innerHTML), original, "initializing controls does not alter image data");
        return image;
    };
    const updates: {before: string, after: string}[] = [];
    const selection = new Function("clearSelect", "hideElements", "hasClosestByAttribute", "hasClosestByClassName",
        selectionSource)(
        (types: string[], element: HTMLElement) => {
            if (types.includes("img")) {
                element.querySelectorAll(".img--select").forEach(item => item.classList.remove("img--select"));
            }
        }, () => {},
        (element: HTMLElement, name: string, value: string) => element.closest(`[${name}="${value}"]`),
        (element: HTMLElement, name: string) => element.closest(`.${name}`),
    );
    root.addEventListener("mousedown", event => selection.clear(event.target, root));
    root.addEventListener("click", event => selection.select(event));
    const tap = (element: HTMLElement) => {
        element.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
        element.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    };
    const start = new Function("getImageResizeWidth", "protyle", "target", "nodeElement", "event", "documentSelf",
        "mostRight", "mostBottom", "y", "focusBlock", "updateTransaction", "img3115", resizeSource);
    const begin = (image: HTMLImageElement, axis: string, event: MouseEvent) => {
        const block = root.firstElementChild as HTMLElement;
        const handle = image.parentElement.querySelector<HTMLElement>(`.protyle-block-resize[data-resize-axis="${axis}"]`);
        start(api.getImageResizeWidth, {disabled: false}, handle, block, event, document,
            root.getBoundingClientRect().right, 1000, event.clientY, () => {},
            (_owner: unknown, node: HTMLElement, old: string) => updates.push({before: old, after: node.outerHTML}),
            (container: HTMLElement) => {
                if (container.style.minWidth) container.style.width = "";
                else container.removeAttribute("style");
            });
    };
    for (const legacy of [false, true]) {
        for (const axis of ["width", "height", "both"]) {
            const image = await create(legacy);
            tap(image);
            const block = root.firstElementChild as HTMLElement;
            const before = block.outerHTML;
            const frame = image.parentElement.querySelector<HTMLElement>(".protyle-image-resize");
            check.equal(frame.querySelectorAll(".protyle-block-resize").length, 3);
            const handle = frame.querySelector<HTMLElement>(`[data-resize-axis="${axis}"]`);
            const width = image.clientWidth;
            const height = width / 2;
            const imageRect = image.getBoundingClientRect();
            const frameRect = frame.getBoundingClientRect();
            check.equal(frameRect.top, imageRect.top);
            check.equal(frameRect.left, imageRect.left);
            check.equal(frameRect.width, imageRect.width);
            check.equal(frameRect.height, imageRect.height, "captions do not displace image handles");
            const handleRect = handle.getBoundingClientRect();
            check.equal(document.elementFromPoint(handleRect.left + handleRect.width / 2,
                handleRect.top + handleRect.height / 2), handle, "external handles remain reachable");
            check.equal(handle.dataset.preventSwipe, "true");
            const caption = image.parentElement.querySelector<HTMLElement>(".protyle-action__title");
            const captionRect = caption.getBoundingClientRect();
            check.equal(document.elementFromPoint(captionRect.left + captionRect.width / 2,
                captionRect.top + captionRect.height / 2).closest(".protyle-action__title"), caption,
            "the bottom resize handle does not intercept caption editing");
            const sourceWithControls = lute.BlockDOM2StdMd(block.outerHTML);
            frame.remove();
            check.equal(lute.BlockDOM2StdMd(block.outerHTML), sourceWithControls, "derived controls preserve serialized image source");
            await settle();
            const currentHandle = image.parentElement.querySelector<HTMLElement>(`.protyle-block-resize[data-resize-axis="${axis}"]`);
            const dx = axis === "height" ? 0 : 20;
            const dy = axis === "width" ? 0 : 10;
            updates.length = 0;
            start(api.getImageResizeWidth, {disabled: false}, currentHandle, block, {clientX: 300}, document,
                root.getBoundingClientRect().right, 1000, 200, () => {},
                (_owner: unknown, node: HTMLElement, old: string) => updates.push({before: old, after: node.outerHTML}),
                (container: HTMLElement) => {
                    if (container.style.minWidth) container.style.width = "";
                    else container.removeAttribute("style");
                });
            document.onmousemove(new MouseEvent("mousemove", {clientX: 300 + dx, clientY: 200 + dy}));
            document.onmouseup(new MouseEvent("mouseup"));
            await settle();
            check.equal(image.clientWidth, width + 20, `${axis} resizes the newly inserted image`);
            check.equal(image.clientHeight, height + 10, `${axis} retains the natural aspect ratio`);
            check.equal(updates.length, 1);
            check.equal(lute.BlockDOM2StdMd(updates[0].before), lute.BlockDOM2StdMd(before), "undo preserves historical image styles");
            check.equal(image.style.height, "");
            check.equal(image.getAttribute("height"), null);
            check.equal(image.closest(".img").classList.contains("img--drag"), false);
            check.equal(currentHandle.classList.contains("touch-resize-active"), false);
            const after = lute.BlockDOM2StdMd(block.outerHTML);
            block.outerHTML = updates[0].before;
            await settle();
            check.equal(lute.BlockDOM2StdMd(root.innerHTML), sourceWithControls, "undo restores the image source");
            root.innerHTML = updates[0].after;
            await settle();
            check.equal(lute.BlockDOM2StdMd(root.innerHTML), after, "redo restores the new width");
            check.equal(root.querySelectorAll(".protyle-block-resize").length, 3, "replay does not duplicate controls");
        }
    }
    const bridgeCore = {};
    new Function("exports", coreSource)(bridgeCore);
    const bridge = {} as {initTouchDragBridge: () => void};
    new Function("exports", "require", bridgeSource)(bridge, (id: string) => id === "./touchDragBridgeCore" ? bridgeCore : {
        Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150},
        isInAndroid: () => false, isInHarmony: () => false, isMobile: () => false,
        ipcRenderer: {on() {}}, stopScrollAnimation() {},
    });
    Object.assign(window, {siyuan: {touchDragActive: false}});
    bridge.initTouchDragBridge();
    for (const axis of ["width", "height", "both"]) {
        const image = await create();
        tap(image);
        const width = image.clientWidth;
        const handle = image.parentElement.querySelector<HTMLElement>(`.protyle-block-resize[data-resize-axis="${axis}"]`);
        handle.addEventListener("mousedown", event => begin(image, axis, event));
        const rect = handle.getBoundingClientRect();
        const dx = axis === "height" ? 0 : 20;
        const dy = axis === "width" ? 0 : 10;
        const dispatch = (type: string, moved: boolean) => {
            const touch = new Touch({identifier: 1, target: handle, clientX: rect.left + rect.width / 2 + (moved ? dx : 0),
                clientY: rect.top + rect.height / 2 + (moved ? dy : 0), radiusX: 1, radiusY: 1});
            const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                touches: type === "touchend" || type === "touchcancel" ? [] : [touch], changedTouches: [touch]});
            handle.dispatchEvent(event);
            return event;
        };
        updates.length = 0;
        dispatch("touchstart", false);
        check.equal(image.closest(".img").classList.contains("img--select"), true,
            "pressing a resize handle preserves image selection");
        check.equal(getComputedStyle(handle).visibility, "visible", "the active handle remains visible");
        check.equal(dispatch("touchmove", true).defaultPrevented, true);
        dispatch("touchend", true);
        check.equal(image.clientWidth, width + 20, `${axis} touch drag resizes the image`);
        check.equal(image.clientHeight * 2, image.clientWidth);
        check.equal(updates.length, 1);
        check.equal(document.onmousemove, null);
        check.equal(getComputedStyle(handle).visibility, "visible", "handles remain available for another drag");
        dispatch("touchstart", false);
        dispatch("touchmove", true);
        dispatch("touchend", true);
        check.equal(image.clientWidth, width + 40, `${axis} supports another drag without reselecting the image`);
        dispatch("touchstart", false);
        dispatch("touchcancel", false);
        check.equal(document.onmousemove, null, "cancelled resizing releases the touch bridge");
        check.equal(handle.classList.contains("touch-resize-active"), false);
        check.equal(getComputedStyle(handle).visibility, "visible", "cancelling a drag preserves selected handles");
    }
    const centered = await create();
    root.firstElementChild.setAttribute("style", "text-align: center");
    begin(centered, "width", new MouseEvent("mousedown", {clientX: 300, clientY: 200}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 310, clientY: 200}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.equal(centered.clientWidth, 220, "centered images expand symmetrically");
    const zoomed = await create();
    root.style.zoom = "1.5";
    await settle();
    begin(zoomed, "height", new MouseEvent("mousedown", {clientX: 300, clientY: 200}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 300, clientY: 215}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.equal(zoomed.clientWidth, 220, "vertical dragging accounts for editor scale");
    const bounded = await create();
    begin(bounded, "height", new MouseEvent("mousedown", {clientX: 300, clientY: 200}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 300, clientY: 2000}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.ok(bounded.getBoundingClientRect().right <= root.getBoundingClientRect().right + 1,
        "vertical resizing respects the editor's right boundary");
    const image = await create();
    const frame = image.parentElement.querySelector<HTMLElement>(".protyle-image-resize");
    const move = (x: number, y: number) => require("electron").ipcRenderer.invoke("image-resize-pointer", x, y);
    await move(1, 1);
    if (matchMedia("(hover: none) and (pointer: coarse)").matches) {
        const handles = Array.from(frame.querySelectorAll<HTMLElement>(".protyle-block-resize"));
        const visible = () => handles.map(handle => getComputedStyle(handle).visibility);
        const hit = (handle: HTMLElement) => {
            const rect = handle.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        };
        check.deepEqual(visible(), ["hidden", "hidden", "hidden"], "touch images initially hide all handles");
        handles.forEach(handle => check.notEqual(hit(handle), handle, "hidden handles do not intercept touches"));
        const rect = image.getBoundingClientRect();
        await move(rect.left + rect.width / 2, rect.top + rect.height / 2);
        check.deepEqual(visible(), ["hidden", "hidden", "hidden"], "touch hover does not reveal unselected handles");
        tap(image);
        check.deepEqual(visible(), ["visible", "visible", "visible"], "tapping an image reveals its handles");
        handles.forEach(handle => check.equal(hit(handle), handle, "selected handles accept touches"));
        root.insertAdjacentHTML("beforeend", lute.Md2BlockDOM("![another](assets/sample.png)"));
        const another = root.lastElementChild.querySelector<HTMLImageElement>("img");
        another.src = url;
        await another.decode();
        await settle();
        tap(another);
        check.deepEqual(visible(), ["hidden", "hidden", "hidden"], "selecting another image hides the previous handles");
        const anotherHandle = another.parentElement.querySelector<HTMLElement>(".protyle-block-resize");
        check.equal(getComputedStyle(anotherHandle).visibility, "visible");
        tap(root);
        check.equal(getComputedStyle(anotherHandle).visibility, "hidden", "tapping elsewhere clears selection");
        root.lastElementChild.remove();
        tap(image);
    } else {
        const opacity = () => Array.from(frame.querySelectorAll(".protyle-block-resize")).map(handle => getComputedStyle(handle).opacity);
        check.deepEqual(opacity(), ["0", "0", "0"]);
        const rect = image.getBoundingClientRect();
        await move(rect.left + rect.width / 2, rect.top + rect.height / 2);
        check.deepEqual(opacity(), ["1", "1", "1"], "mouse hover reveals the handles");
        await move(1, 1);
        check.deepEqual(opacity(), ["0", "0", "0"], "leaving the image hides the handles");
    }
    if (process.env.SIYUAN_IMAGE_RESIZE_PREVIEW) {
        frame.querySelectorAll(".protyle-block-resize").forEach(handle => handle.classList.add("touch-resize-active"));
        await settle();
        const mode = matchMedia("(pointer: coarse)").matches ? "touch" : "desktop";
        await require("electron").ipcRenderer.invoke("image-resize-preview", mode);
        document.body.style.background = "#202124";
        document.documentElement.style.setProperty("--b3-theme-on-surface", "#ddd");
        await settle();
        await require("electron").ipcRenderer.invoke("image-resize-preview", mode + "-dark");
        document.body.style.background = "";
        document.documentElement.style.setProperty("--b3-theme-on-surface", "#555");
        frame.querySelectorAll(".protyle-block-resize").forEach(handle => handle.classList.remove("touch-resize-active"));
    }
    root.dataset.readonly = "true";
    check.equal(getComputedStyle(frame).display, "none");
    root.dataset.readonly = "false";
    const preview = document.createElement("div");
    preview.className = "protyle-wysiwyg__embed";
    preview.innerHTML = lute.Md2BlockDOM("![preview](assets/sample.png)");
    root.appendChild(preview);
    await settle();
    check.equal(preview.querySelector(".protyle-image-resize"), null);
    root.style.zoom = "1.5";
    await settle();
    const rect = image.getBoundingClientRect();
    const overlay = frame.getBoundingClientRect();
    check.equal(overlay.width, rect.width);
    check.equal(overlay.height, rect.height);
    root.style.fontSize = "80px";
    root.dir = "rtl";
    await settle();
    check.equal(frame.getBoundingClientRect().top, image.getBoundingClientRect().top, "large fonts retain vertical alignment");
    check.equal(frame.getBoundingClientRect().left, image.getBoundingClientRect().left, "RTL retains image-edge alignment");
    dispose();
    root.innerHTML = lute.Md2BlockDOM("![after](assets/sample.png)");
    await settle();
    check.equal(root.querySelector(".protyle-image-resize"), null, "destroy disconnects image initialization");
    root.remove();
    return "Image resize cases passed";
};

test("image handles retain selection, touch visibility, source, aspect ratio and replay compatibility", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const transpile = (file: string) => transpileModule(readFileSync(file, "utf8").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const source = createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"), ScriptTarget.ES2021, true);
    let resize = "";
    let clearSelection = "";
    let selectImage = "";
    const visit = (node: import("typescript").Node) => {
        if (isIfStatement(node) && node.expression.getText(source) === '!protyle.disabled && target.classList.contains("protyle-action__drag")') {
            resize = node.getText(source);
        }
        if (isIfStatement(node) && node.expression.getText(source) === "!isToggleBlockDrag" &&
            node.getText(source).includes('hideElements(["select"], protyle)')) {
            clearSelection = node.getText(source);
        }
        if (isIfStatement(node) && node.expression.getText(source) === "!event.shiftKey && !ctrlIsPressed && imgElement") {
            selectImage = node.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(resize);
    assert.ok(clearSelection);
    assert.ok(selectImage);
    const selectionSource = transpileModule(`
        function clear(target, root) {
            const protyle = {wysiwyg: {element: root}};
            const isToggleBlockDrag = false;
            const avDragFillElement = null;
            ${clearSelection}
        }
        function select(event) {
            const imgElement = event.target.closest(".img");
            const ctrlIsPressed = false;
            const hasNextSibling = () => null;
            ${selectImage}
        }
    `, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText + "\nreturn {clear, select};";
    const resizeSource = transpileModule(`function resize() { ${resize} }`, {compilerOptions: {target: ScriptTarget.ES2021}})
        .outputText + "\nreturn resize.call(this);";
    const css = compileString('@use "protyle/protyle"; @use "component/typography"; @use "business/resize";',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const mobileCSS = compileString('@use "main/mobile";',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const bridgeSources = ["src/util/touchDragBridge.ts", "src/util/touchDragBridgeCore.ts"].map(file =>
        transpileModule(readFileSync(file, "utf8"), {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText);
    const makeCode = (styles: string, touchMode: boolean) => "const __name = value => value; (" + browserCases.toString() + ")(" +
        [transpile("src/protyle/render/imageResize.ts"), resizeSource,
            readFileSync("stage/protyle/js/lute/lute.min.js", "utf8"), styles, ...bridgeSources, selectionSource, touchMode]
            .map(value => JSON.stringify(value)).join(",") + ")";
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-resize-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 700,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.setBackgroundThrottling(false);
    win.webContents.debugger.attach("1.3");
    require("electron").ipcMain.handle("image-resize-pointer", (_event, x, y) =>
        win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", x, y}));
    require("electron").ipcMain.handle("image-resize-preview", async (_event, mode) => {
        require("fs").writeFileSync(process.env.SIYUAN_IMAGE_RESIZE_PREVIEW + "-" + mode + ".png", (await win.webContents.capturePage()).toPNG());
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(makeCode(css, false))}));
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
        win.setSize(390, 700);
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(makeCode(css + mobileCSS, true))}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, windowsHide: true, timeout: 55000});
        assert.match(result.stdout, /Image resize cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-image-resize-test-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});
