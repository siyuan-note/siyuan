import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {createSourceFile, isIfStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, resizeSource: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(sources.lute)();
    const lute = Lute.New();
    const script = document.createElement("script");
    script.textContent = sources.mermaid;
    document.head.appendChild(script);
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
    const api = {} as typeof import("./mermaidRender");
    const image = {} as typeof import("./imageResize");
    new Function("exports", sources.image)(image);
    const closest = {} as typeof import("../util/hasClosest");
    new Function("exports", sources.closest)(closest);
    Object.assign(window, {siyuan: {config: {appearance: {mode: 0}}}, DOMPurify: {sanitize: (value: string) => value}});
    new Function("exports", "require", sources.renderer)(api, () => ({
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"}, addScript: async () => {},
        ensureBrowserCompatibility: async () => {},
        isFoldedRenderContent: () => false, isZenumlDiagram: () => false,
        getMermaidLayout: (): undefined => undefined, applyMermaidLayout: (value: string) => value,
        ...closest,
        genIconHTML: () => '<div class="protyle-icons"></div>', getHostCapabilities: () => ({remoteKernel: false}),
        escapeHtml: (value: string) => value,
    }));
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const waitForRender = async (element: Element) => {
        await settle();
        for (let count = 0; count < 100 && !element.querySelector("svg"); count++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        check.ok(element.querySelector("svg"), element.outerHTML);
        await settle();
    };
    const render = async (element: Element) => {
        api.mermaidRender(element);
        await waitForRender(element);
    };
    const create = async (alignment = "", width = "33%",
                          source = "graph LR; A[First Mermaid diagram node]-->B[Second Mermaid diagram node];") => {
        root.style.zoom = "";
        root.innerHTML = lute.Md2BlockDOM("```mermaid\n" + source + "\n```");
        const block = root.firstElementChild as HTMLElement;
        check.equal(block.dataset.subtype, "mermaid");
        block.style.width = width;
        block.style.textAlign = alignment;
        await render(block);
        check.equal(block.querySelectorAll(":scope > .protyle-block-resize").length, 1);
        return block;
    };
    const automaticSource = 'flowchart LR\n    A["1"] --> B["2"] --> C["3"] --> D["4"]\n    D -. "哈哈哈" .-> B';
    let automaticWidth = 0;
    const checkAutomaticWidth = (block: Element) => {
        const svgWidth = block.querySelector("svg").getBoundingClientRect().width;
        check.ok(Math.abs(svgWidth - automaticWidth) < 1, "alignment preserves the automatic diagram size: " +
            JSON.stringify({alignment: (block as HTMLElement).style.textAlign, expected: automaticWidth, actual: svgWidth}));
        const parentRect = root.getBoundingClientRect();
        const parentStyle = getComputedStyle(root);
        const blockRect = block.getBoundingClientRect();
        check.ok(blockRect.left >= parentRect.left + parseFloat(parentStyle.paddingLeft) - 1);
        check.ok(blockRect.right <= parentRect.right - parseFloat(parentStyle.paddingRight) + 1,
            "automatic widths stay inside the editor");
    };
    for (const alignment of ["", "left", "center", "right"]) {
        const block = await create(alignment, "", automaticSource);
        check.equal(block.style.width, "", "automatic widths render without persisting a width");
        if (!alignment) {
            automaticWidth = block.querySelector("svg").getBoundingClientRect().width;
            check.ok(automaticWidth > 0);
        }
        checkAutomaticWidth(block);
        const before = lute.BlockDOM2Md(block.outerHTML);
        window.siyuan.config.appearance.mode = 1;
        api.refreshMermaidTheme(block);
        await waitForRender(block);
        checkAutomaticWidth(block);
        check.equal(lute.BlockDOM2Md(block.outerHTML), before, "theme changes preserve automatic widths and alignment");
        window.siyuan.config.appearance.mode = 0;
        root.innerHTML = lute.Md2BlockDOM(before);
        await render(root.firstElementChild);
        checkAutomaticWidth(root.firstElementChild);
        check.equal(lute.BlockDOM2Md(root.innerHTML), before, "automatic widths render again after reopening");
    }
    const hiddenDiagram = lute.Md2BlockDOM("```mermaid\ngraph TD; A-->B;\n```");
    root.innerHTML = '<div class="bq" data-node-id="folded" data-type="NodeBlockquote" fold="1">' +
        '<div data-node-id="summary">Summary</div>' + hiddenDiagram + "</div>";
    const foldedDiagram = root.querySelector('[data-subtype="mermaid"]');
    check.equal(foldedDiagram.getClientRects().length, 0);
    api.mermaidRender(foldedDiagram);
    await settle();
    check.equal(foldedDiagram.hasAttribute("data-render"), false, "folded diagrams wait for expansion");
    root.firstElementChild.removeAttribute("fold");
    await waitForRender(foldedDiagram);
    const card = document.createElement("div");
    card.className = "card__block card__block--hideh";
    document.body.appendChild(card);
    card.appendChild(root);
    root.innerHTML = '<div data-node-id="heading" data-type="NodeHeading" custom-riff-decks="deck">Question</div>' + hiddenDiagram;
    const cardDiagram = root.querySelector('[data-subtype="mermaid"]');
    check.equal(cardDiagram.getClientRects().length, 0);
    api.mermaidRender(cardDiagram);
    await settle();
    check.equal(cardDiagram.hasAttribute("data-render"), false, "flashcard answers wait until revealed");
    card.classList.remove("card__block--hideh");
    await waitForRender(cardDiagram);
    document.body.appendChild(root);
    card.remove();
    const updates: {before: string, after: string}[] = [];
    const start = new Function("getImageResizeWidth", "protyle", "target", "nodeElement", "event", "documentSelf",
        "mostRight", "mostBottom", "y", "focusBlock", "updateTransaction", "img3115", resizeSource);
    const begin = (block: HTMLElement, event: MouseEvent, disabled = false) => {
        updates.length = 0;
        start(image.getImageResizeWidth, {disabled}, block.querySelector(":scope > .protyle-block-resize"), block,
            event, document, root.getBoundingClientRect().right, 1000, event.clientY, () => {},
            (_owner: unknown, node: HTMLElement, old: string) => updates.push({before: old, after: node.outerHTML}), () => {});
    };
    for (const alignment of ["", "left", "center", "right"]) {
        const block = await create(alignment);
        const rect = block.getBoundingClientRect();
        const parentRect = root.getBoundingClientRect();
        const parentStyle = getComputedStyle(root);
        const left = parentRect.left + parseFloat(parentStyle.paddingLeft);
        const right = parentRect.right - parseFloat(parentStyle.paddingRight);
        if (alignment === "center") {
            check.ok(Math.abs(rect.left + rect.right - left - right) < 1, "33% blocks center");
        } else if (alignment === "right") {
            check.ok(Math.abs(rect.right - right) < 1, "33% blocks align right");
        } else {
            check.equal(rect.left, left);
        }
        const handle = block.querySelector<HTMLElement>(":scope > .protyle-block-resize");
        const handleRect = handle.getBoundingClientRect();
        check.equal(document.elementFromPoint(handleRect.left + handleRect.width / 2,
            handleRect.top + handleRect.height / 2), handle,
        JSON.stringify({alignment, rect: rect.toJSON(), handle: handleRect.toJSON(),
            parent: parentRect.toJSON(), width: innerWidth}));
        const width = parseFloat(getComputedStyle(block).width);
        const svgWidth = block.querySelector("svg").getBoundingClientRect().width;
        const before = lute.BlockDOM2Md(block.outerHTML);
        check.doesNotMatch(before, /protyle-block-resize|data-resize-axis/);
        begin(block, new MouseEvent("mousedown", {clientX: handleRect.left, clientY: handleRect.top}));
        document.onmousemove(new MouseEvent("mousemove", {clientX: handleRect.left - 20, clientY: handleRect.top + 50}));
        document.onmouseup(new MouseEvent("mouseup"));
        const expected = width - (alignment === "center" ? 40 : 20);
        check.ok(Math.abs(parseFloat(block.style.width) - expected) < 0.1,
            JSON.stringify({alignment, initial: width, expected, actual: block.style.width, viewport: innerWidth}));
        check.equal(block.style.height, "", "width dragging preserves the SVG aspect ratio");
        check.ok(block.querySelector("svg").getBoundingClientRect().width < svgWidth, "the diagram shrinks with the block");
        check.equal(updates.length, 1);
        check.equal(lute.BlockDOM2Md(updates[0].before), before);
        const after = lute.BlockDOM2Md(block.outerHTML);
        root.innerHTML = lute.Md2BlockDOM(before);
        await render(root.firstElementChild);
        check.equal(lute.BlockDOM2Md(root.innerHTML), before, "undo retains percentage widths and alignment");
        root.innerHTML = lute.Md2BlockDOM(after);
        await render(root.firstElementChild);
        check.equal(lute.BlockDOM2Md(root.innerHTML), after, "redo retains the resized width");
        api.refreshMermaidTheme(root);
        await render(root.firstElementChild);
        check.equal(root.querySelectorAll(".protyle-block-resize").length, 1, "theme rendering does not duplicate handles");
    }
    const zoomed = await create("center", "160px");
    root.style.zoom = "1.5";
    begin(zoomed, new MouseEvent("mousedown", {clientX: 300}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 315}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.equal(zoomed.style.width, "180px", "dragging accounts for editor zoom and centered placement");
    const bounded = await create("left", "100%");
    begin(bounded, new MouseEvent("mousedown", {clientX: 300}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 3000}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.ok(bounded.getBoundingClientRect().right <= root.getBoundingClientRect().right + 1, "width stays inside the editor");
    begin(bounded, new MouseEvent("mousedown", {clientX: 300}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: -3000}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.equal(bounded.style.width, "17px");
    const borderBox = await create("left", "160px");
    borderBox.style.boxSizing = "border-box";
    borderBox.style.border = "1px solid";
    begin(borderBox, new MouseEvent("mousedown", {clientX: 300}));
    document.onmousemove(new MouseEvent("mousemove", {clientX: 320}));
    document.onmouseup(new MouseEvent("mouseup"));
    check.equal(borderBox.style.width, "180px", "theme box sizing preserves drag distances");
    const touchBlock = await create("center", "160px");
    const core = {};
    const bridge = {} as {initTouchDragBridge: () => void};
    new Function("exports", sources.core)(core);
    new Function("exports", "require", sources.bridge)(bridge, (id: string) => id === "./touchDragBridgeCore" ? core : {
        Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150},
        isInAndroid: () => false, isInHarmony: () => false, isMobile: () => false,
        ipcRenderer: {on() {}}, stopScrollAnimation() {},
    });
    bridge.initTouchDragBridge();
    const handle = touchBlock.querySelector<HTMLElement>(":scope > .protyle-block-resize");
    handle.addEventListener("mousedown", event => begin(touchBlock, event));
    const touchRect = handle.getBoundingClientRect();
    for (const type of ["touchstart", "touchmove", "touchend"]) {
        const touch = new Touch({identifier: 1, target: handle, radiusX: 1, radiusY: 1,
            clientX: touchRect.left + touchRect.width / 2 - (type === "touchstart" ? 0 : 20),
            clientY: touchRect.top + touchRect.height / 2});
        handle.dispatchEvent(new TouchEvent(type, {bubbles: true, cancelable: true,
            touches: type === "touchend" ? [] : [touch], changedTouches: [touch]}));
    }
    check.equal(touchBlock.style.width, "120px", "touch resizing shares the desktop width and alignment behavior");
    check.equal(updates.length, 1);
    check.equal(document.onmousemove, null);
    root.dataset.readonly = "true";
    check.equal(getComputedStyle(handle).display, "none");
    begin(touchBlock, new MouseEvent("mousedown"), true);
    check.equal(document.onmousemove, null, "read-only content cannot start resizing");
    root.dataset.readonly = "false";
    const sb = document.createElement("div");
    sb.className = "sb";
    root.appendChild(sb);
    sb.appendChild(touchBlock);
    check.equal(getComputedStyle(handle).display, "none", "columns retain their own width controls");
    begin(touchBlock, new MouseEvent("mousedown"));
    check.equal(document.onmousemove, null);
    for (const className of ["protyle-wysiwyg__embed", "mindmap-view__preview-block", "b3-typography"]) {
        const preview = document.createElement("div");
        preview.className = className;
        preview.innerHTML = lute.Md2BlockDOM("```mermaid\ngraph TD; A-->B;\n```");
        const previewBlock = preview.firstElementChild as HTMLElement;
        previewBlock.style.width = "33%";
        previewBlock.style.textAlign = "center";
        (className === "b3-typography" ? document.body : root).appendChild(preview);
        await render(preview);
        check.equal(preview.querySelector(".protyle-block-resize"), null, "previews do not expose editing controls");
        const previewRect = preview.getBoundingClientRect();
        const blockRect = previewBlock.getBoundingClientRect();
        check.ok(Math.abs(blockRect.left + blockRect.right - previewRect.left - previewRect.right) < 1,
            "previews retain centered block placement");
        preview.remove();
    }
    return "Mermaid resize cases passed";
};

test("Mermaid automatic widths and width handles support alignment, visibility, replay, zoom and touch", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
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
        .outputText + "\nreturn resize.call(this);";
    const sources = {
        renderer: compile("src/protyle/render/mermaidRender.ts"), image: compile("src/protyle/render/imageResize.ts"),
        closest: compile("src/protyle/util/hasClosest.ts"),
        lute: readFileSync("stage/protyle/js/lute/lute.min.js", "utf8"),
        mermaid: readFileSync("stage/protyle/js/mermaid/mermaid.min.js", "utf8"),
        bridge: compile("src/util/touchDragBridge.ts"), core: compile("src/util/touchDragBridgeCore.ts"),
    };
    const css = compileString('@use "util/function"; @use "protyle/protyle"; @use "component/typography"; @use "business/card";',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const mobileCSS = compileString('@use "main/mobile";',
        {loadPaths: ["src/assets/scss"], logger: {warn() {}, debug() {}}}).css;
    const code = (styles: string) => "const __name = value => value; (" + browserCases.toString() + ")(" +
        [sources, resizeSource, styles].map(value => JSON.stringify(value)).join(",") + ")";
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mermaid-resize-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 700,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.setBackgroundThrottling(false);
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code(css))}));
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
        win.setSize(390, 700);
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code(css + mobileCSS))}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, windowsHide: true, timeout: 55000});
        assert.match(result.stdout, /Mermaid resize cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-mermaid-resize-test-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});
