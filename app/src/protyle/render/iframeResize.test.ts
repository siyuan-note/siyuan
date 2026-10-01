import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {createSourceFile, isClassDeclaration, isIfStatement, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (renderSource: string, resizeSource: string, luteSource: string, css: string,
                            bridgeSource: string, coreSource: string, insertSources: Record<string, string>,
                            hintSource: string, menuSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    document.body.replaceChildren();
    new Function(luteSource)();
    const lute = Lute.New();
    lute.SetSpin(true);
    lute.SetProtyleWYSIWYG(true);
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
    const inserts: {operations: IOperation[], undo: IOperation[]}[] = [];
    const modules: Record<string, unknown> = {
        "src/constants": {Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"}},
        "src/util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: false})},
        "src/protyle/util/selection": {
            getEditorRange: () => window.getSelection().getRangeAt(0),
            focusBlock() {},
        },
        "src/protyle/wysiwyg/transaction": {
            transaction: (_protyle: IProtyle, operations: IOperation[], undo: IOperation[]) => inserts.push({operations, undo}),
        },
    };
    const load = (id: string): unknown => {
        if (modules[id]) {
            return modules[id];
        }
        const source = insertSources[id];
        const exports = {};
        modules[id] = exports;
        if (!source) {
            return new Proxy(exports, {get: (_target, key) => check.fail(`Unexpected insertion dependency: ${id}.${String(key)}`)});
        }
        new Function("exports", "require", source)(exports, (specifier: string) => load(
            require("node:path").posix.normalize(require("node:path").posix.join(id, "..", specifier))
        ));
        return exports;
    };
    const {insertHTML} = load("src/protyle/util/insertHTML") as typeof import("../util/insertHTML");
    for (const type of ["NodeIFrame", "NodeWidget"]) {
        for (const empty of [false, true]) {
            for (const nested of [false, true]) {
                root.innerHTML = lute.Md2BlockDOM("Insert here");
                const paragraph = root.firstElementChild;
                if (empty) {
                    paragraph.firstElementChild.replaceChildren();
                }
                const range = document.createRange();
                range.selectNodeContents(paragraph.firstElementChild);
                range.collapse(false);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
                const protyle = {lute, wysiwyg: {element: root}, toolbar: {range, getCurrentType: () => []},
                    block: {parentID: "document"}} as IProtyle;
                const frameHTML = `<iframe src="about:blank"${type === "NodeWidget" ? ' data-subtype="widget"' : ""}></iframe>`;
                const frameDOM = lute.SpinBlockDOM(frameHTML);
                const html = nested ? `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeBlockquote" class="bq">${frameDOM}<div class="protyle-attr" contenteditable="false"></div></div>` : frameDOM;
                inserts.length = 0;
                // 使用真实插入入口，保留桌面当前选区和移动端保存选区两种调用方式。
                insertHTML(html, protyle, type === "NodeWidget", type === "NodeWidget");
                const block = root.querySelector(`[data-type="${type}"]`);
                check.ok(block, `${type} inserted ${nested ? "inside a container" : "as a top-level block"}: ${root.innerHTML}`);
                check.equal(block.querySelectorAll(".protyle-block-resize").length, 3,
                    `${type} has all handles immediately after insertion`);
                check.equal(inserts.length, 1);
                const operation = inserts[0].operations.find(item => item.action === "insert");
                check.ok(operation);
                check.ok(typeof operation.data === "string");
                check.doesNotMatch(operation.data, /protyle-block-resize/, "derived handles stay out of insertion transactions");
                check.equal(lute.BlockDOM2StdMd(root.querySelector(`[data-node-id="${operation.id}"]`).outerHTML),
                    lute.BlockDOM2StdMd(operation.data),
                    "insertion preserves source after handle initialization");
            }
        }
    }
    const constants = {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", BLOCK_HINT_KEYS: ["(("], INLINE_TYPE: [] as string[]};
    const selection = window.getSelection();
    const menuElement = document.createElement("div");
    document.body.appendChild(menuElement);
    const menuEvents: string[] = [];
    const menu = {
        element: menuElement,
        popup() { menuEvents.push("popup"); },
        showSubMenu() { menuEvents.push("submenu"); },
        fullscreen() { menuEvents.push("fullscreen"); },
    };
    const iframeMenu = new Function("getHostCapabilities", "getHTMLAssetIFrameSrc", "updateTransaction", menuSource + "\nreturn iframeMenu;")(
        () => ({remoteKernel: false}),
        (load("src/asset/html") as typeof import("../../asset/html")).getHTMLAssetIFrameSrc, () => {});
    for (const mobile of [false, true]) {
        for (const empty of [false, true]) {
            for (const inList of [false, true]) {
                const text = mobile ? (empty ? "" : "Prefix ") : (empty ? "/" : "Prefix /");
                root.innerHTML = lute.Md2BlockDOM(inList ? "- Placeholder" : "Placeholder");
                const paragraph = root.querySelector<HTMLElement>('[data-type="NodeParagraph"]');
                paragraph.firstElementChild.textContent = text;
                const originalHTML = paragraph.outerHTML;
                const originalID = paragraph.dataset.nodeId;
                const range = document.createRange();
                const textNode = paragraph.firstElementChild.firstChild;
                range.setStart(textNode || paragraph.firstElementChild, text.length);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                const undoContext = {undoFocusId: originalID, undoFocusStart: String(text.length), undoFocusEnd: String(text.length)};
                const dependencies = {
                    ...(load("src/protyle/util/hasClosest") as typeof import("../util/hasClosest")),
                    ...(load("src/protyle/wysiwyg/getBlock") as typeof import("../wysiwyg/getBlock")),
                    ...(load("src/protyle/hint/blockHintRange") as typeof import("../hint/blockHintRange")),
                    Constants: constants, renderIFrameResize: render,
                    isMobile: () => mobile, isProtyleListItemFragment: () => false,
                    getSuperBlockCommandLayout: (): undefined => undefined,
                    hideElements() {},
                    getEditorRange: () => selection.getRangeAt(0),
                    getUndoFocusContext: () => undoContext,
                    focusByRange: (target: Range) => { selection.removeAllRanges(); selection.addRange(target); },
                    updateTransaction: (_owner: IProtyle, node: HTMLElement, before: string, context: Record<string, string>) => {
                        inserts.push({operations: [{action: "update", id: node.dataset.nodeId, data: node.outerHTML}],
                            undo: [{action: "update", id: originalID, data: before, context}]});
                    },
                    transaction: (_owner: IProtyle, operations: IOperation[], undo: IOperation[]) => inserts.push({operations, undo}),
                };
                const hint = new Function(...Object.keys(dependencies), hintSource + "\nreturn new Hint();")(...Object.values(dependencies)) as {
                    fill: (value: string, protyle: IProtyle) => void,
                    fillCommand: (value: string, protyle: IProtyle, updateRange: boolean) => void,
                };
                Object.assign(hint, {source: "hint", splitChar: "/", lastIndex: text.length - 1, fixImageCursor() {}});
                Object.assign(window, {siyuan: {menus: {menu}, languages: {link: "URL"}}});
                const protyle = {
                    lute, wysiwyg: {element: root}, toolbar: {range},
                    gutter: {renderMenu: (_owner: IProtyle, block: HTMLElement) => {
                        menuElement.innerHTML = '<div class="b3-menu__items"><div data-id="assetIFrame"><div class="b3-menu__submenu"><div class="b3-menu__items"></div></div></div></div>';
                        const item = iframeMenu(protyle, block)[0] as IMenu;
                        const element = document.createElement("div");
                        element.innerHTML = item.label;
                        item.bind(element);
                        menuElement.querySelector(".b3-menu__submenu > .b3-menu__items").appendChild(element);
                    }},
                } as IProtyle;
                inserts.length = 0;
                menuEvents.length = 0;
                const value = '<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups allow-storage-access-by-user-activation" src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>';
                // 桌面候选菜单调用 fill，移动端工具栏调用 fillCommand 并使用保存的选区。
                if (mobile) {
                    hint.fillCommand(value, protyle, false);
                } else {
                    hint.fill(value, protyle);
                }
                const block = root.querySelector<HTMLElement>('[data-type="NodeIFrame"]');
                check.ok(block);
                check.equal(block.querySelectorAll(".protyle-block-resize").length, 3,
                    `slash insertion initializes handles: mobile=${mobile}, empty=${empty}, list=${inList}`);
                check.deepEqual(menuEvents, mobile ? ["fullscreen"] : ["popup", "submenu"]);
                const textarea = menuElement.querySelector("textarea");
                check.equal(document.activeElement, textarea, "the URL field retains focus");
                textarea.value = "about:blank#inserted";
                textarea.dispatchEvent(new Event("change", {bubbles: true}));
                check.equal(block.querySelector("iframe").getAttribute("src"), textarea.value);
                check.equal(block.querySelectorAll(".protyle-block-resize").length, 3, "editing the URL preserves every handle");
                check.equal(inserts.length, 1, "initialization does not add a transaction");
                const restore = inserts[0].undo.find(operation => operation.id === originalID && operation.action === "update");
                check.equal(restore.data, originalHTML);
                check.equal(restore.context, undoContext);
                const inserted = inserts[0].operations.find(operation => operation.id === block.dataset.nodeId);
                check.ok(typeof inserted.data === "string");
                check.doesNotMatch(inserted.data, /protyle-block-resize/, "the insertion transaction contains only source markup");
                check.equal(block.dataset.nodeId === originalID, empty, "replacement preserves the original block ID");
                if (!empty) {
                    check.equal(paragraph.firstElementChild.textContent, "Prefix ");
                }
                const handle = block.querySelector<HTMLElement>('[data-resize-axis="width"]');
                const width = block.querySelector("iframe").clientWidth;
                updates.length = 0;
                start({disabled: false}, handle, block, {clientX: 400}, document, 2000, 2000, 300, () => {},
                    (_owner: unknown, node: HTMLElement, before: string) => updates.push({before, after: node.outerHTML}), () => {});
                document.onmousemove(new MouseEvent("mousemove", {clientX: 420, clientY: 300}));
                document.onmouseup(new MouseEvent("mouseup"));
                check.equal(block.style.width, `${width + 20}px`, "a newly inserted block resizes without a refresh");
                check.equal(updates.length, 1);
            }
        }
    }
    menuElement.remove();
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
        handle.tabIndex = axis === "both" ? -1 : 0;
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

const visibilityCases = async (move: (x: number, y: number) => Promise<void>, tab: () => Promise<void>,
                               evaluate: (code: string) => Promise<unknown>) => {
    await move(1, 1);
    await evaluate("document.querySelectorAll(\".touch-resize-active\").forEach(handle => handle.classList.remove(\"touch-resize-active\"));");
    const touchOnly = await evaluate("matchMedia('(hover: none) and (pointer: coarse)').matches");
    for (const selector of [".iframe", ".mindmap-view"]) {
        const state = await evaluate(`(() => {
            const block = document.querySelector(${JSON.stringify(selector)});
            const target = block.querySelector("iframe, .mindmap-view__viewport");
            target.tabIndex = 0;
            target.focus();
            require("node:assert/strict").equal(document.activeElement, target);
            return {opacity: Array.from(block.querySelectorAll(".protyle-block-resize")).map(handle => getComputedStyle(handle).opacity),
                x: target.getBoundingClientRect().left + 10, y: target.getBoundingClientRect().top + 10};
        })()`) as {opacity: string[], x: number, y: number};
        assert.deepEqual(state.opacity, Array(3).fill(touchOnly ? "1" : "0"), "content focus alone does not reveal mouse handles");
        await move(state.x, state.y);
        const opacity = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll(".protyle-block-resize")).map(handle => getComputedStyle(handle).opacity)`);
        assert.deepEqual(opacity, ["1", "1", "1"], "hover reveals every handle");
        await move(1, 1);
        const hidden = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll(".protyle-block-resize")).map(handle => getComputedStyle(handle).opacity)`);
        assert.deepEqual(hidden, Array(3).fill(touchOnly ? "1" : "0"), "leaving the block hides mouse handles");
        await evaluate(`(() => {
            const block = document.querySelector(${JSON.stringify(selector)});
            const handles = ["width", "height", "both"].map(axis => block.querySelector('[data-resize-axis="' + axis + '"]'));
            const rects = handles.map(handle => handle.getBoundingClientRect());
            const decorations = handles.map(handle => getComputedStyle(handle, "::after"));
            const right = rects[0].left + parseFloat(decorations[0].left) + parseFloat(decorations[0].width);
            const bottom = rects[1].top + parseFloat(decorations[1].top) + parseFloat(decorations[1].height);
            const check = require("node:assert/strict");
            check.equal(rects[2].right - parseFloat(decorations[2].right), right, "corner aligns with the right handle");
            check.equal(rects[2].bottom - parseFloat(decorations[2].bottom), bottom, "corner aligns with the bottom handle");
        })()`);
    }
    if (!touchOnly) {
        await tab();
        const focused = await evaluate(`(() => {
            const handle = document.activeElement;
            return {axis: handle.getAttribute("data-resize-axis"), opacity: getComputedStyle(handle).opacity,
                siblings: Array.from(handle.parentElement.querySelectorAll(".protyle-block-resize")).filter(item => item !== handle).map(item => getComputedStyle(item).opacity)};
        })()`);
        assert.deepEqual(focused, {axis: "width", opacity: "1", siblings: ["0", "0"]}, "keyboard focus reveals only its resize handle");
    }
};

test("external resize handles preserve source, independent axes, historical dimensions and clipping", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 90000,
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
    const insertSources = Object.fromEntries([
        "src/protyle/util/insertHTML", "src/protyle/render/iframeResize", "src/protyle/util/hasClosest",
        "src/protyle/wysiwyg/getBlock", "src/protyle/util/inlineElementBoundary", "src/protyle/util/inlineElementMarker",
        "src/protyle/util/longTextWrap", "src/protyle/util/codeBlockRenderState", "src/asset/html",
        "src/protyle/hint/blockHintRange",
    ].map(file => [file, transpileModule(readFileSync(file + ".ts", "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText]));
    const hintFile = createSourceFile("hint.ts", readFileSync("src/protyle/hint/index.ts", "utf8"), ScriptTarget.ES2021, true);
    const hintDeclaration = hintFile.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
    assert.ok(hintDeclaration && isClassDeclaration(hintDeclaration));
    const hintMethods = hintDeclaration.members.filter(member => ["fill", "fillCommand"].includes(member.name?.getText(hintFile)))
        .map(member => member.getText(hintFile)).join("\n");
    const hintSource = transpileModule(`class Hint { ${hintMethods} }`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const menuFile = createSourceFile("menu.ts", readFileSync("src/menus/protyle.ts", "utf8"), ScriptTarget.ES2021, true);
    const menuDeclaration = menuFile.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(menuFile) === "iframeMenu"));
    assert.ok(menuDeclaration);
    const menuSource = transpileModule(menuDeclaration.getText(menuFile).replace(/^export /, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const makeCode = (styles: string) => "const __name = value => value; (" + browserCases.toString() + ")(" +
        [renderSource, resizeSource, readFileSync("stage/protyle/js/lute/lute.min.js", "utf8"), styles, ...bridgeSources,
            insertSources, hintSource, menuSource]
            .map(value => JSON.stringify(value)).join(",") + ")";
    const code = makeCode(css);
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
const __name = value => value;
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 700,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: !!process.env.SIYUAN_RESIZE_PREVIEW}});
    win.webContents.setBackgroundThrottling(false);
    try {
        win.webContents.debugger.attach("1.3");
        const checkVisibility = () => (${visibilityCases.toString()})(
            (x, y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", x, y}),
            async () => {
                await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9});
                await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9});
            }, code => win.webContents.executeJavaScript(code));
        const assert = require("node:assert/strict");
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        await checkVisibility();
        if (process.env.SIYUAN_RESIZE_PREVIEW) {
            await win.webContents.executeJavaScript('document.querySelectorAll(".protyle-block-resize").forEach(handle => handle.classList.add("touch-resize-active"));');
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            require("fs").writeFileSync(process.env.SIYUAN_RESIZE_PREVIEW + "-light.png", (await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript("document.documentElement.style.setProperty('--b3-theme-background', '#202124'); document.documentElement.style.setProperty('--b3-border-color', '#555'); document.body.style.background = '#202124';");
        if (process.env.SIYUAN_RESIZE_PREVIEW) {
            await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
            require("fs").writeFileSync(process.env.SIYUAN_RESIZE_PREVIEW + "-dark.png", (await win.webContents.capturePage()).toPNG());
        }
        win.setSize(390, 700);
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
        await checkVisibility();
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: false});
        win.setSize(900, 700);
        await win.loadURL("data:text/html,<html><body></body></html>");
        // 激活触屏命中区域规则，模拟鼠标为主且同时带有触屏的设备。
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(makeCode(css.replaceAll("@media (any-pointer: coarse)", "@media all")))}));
        await checkVisibility();
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 85000});
        assert.match(result.stdout, /resize cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-block-resize-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
