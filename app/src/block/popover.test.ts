import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isCallExpression, isClassDeclaration, isConstructorDeclaration,
    isExpressionStatement, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, keyboardSource: string) => {
    const check = require("node:assert/strict");
    const requests: ((response: unknown) => void)[] = [];
    let tooltip = "";
    const assetRequests: {path: string, signal: AbortSignal, receive: (response: unknown) => void}[] = [];
    const ocrRequests: ((text: string | undefined | {text: string, failed: boolean}) => void)[] = [];
    class Panel {
        element = document.createElement("div");
        editors: {protyle: IProtyle}[] = [];
        targetElement: HTMLElement;
        refDefs: IRefDefs[];

        constructor(options: {targetElement: HTMLElement, refDefs: IRefDefs[]}) {
            this.targetElement = options.targetElement;
            this.refDefs = options.refDefs;
            this.element.className = "block__popover";
            this.element.dataset.pin = "false";
            this.element.dataset.level = "1";
            this.element.dataset.oid = "test";
            document.body.append(this.element);
        }

        destroy() {
            this.element.remove();
            const index = window.siyuan.blockPanels.findIndex(item => item.element === this.element);
            window.siyuan.blockPanels.splice(index, 1);
        }
    }
    const dependencies = {
        BlockPanel: Panel,
        fetchSyncPost: () => new Promise(resolve => requests.push(resolve)),
        getImageOCRResult: () => new Promise<{text: string, failed: boolean} | undefined>(resolve => ocrRequests.push(result =>
            resolve(typeof result === "string" ? {text: result, failed: false} : result))),
        hideTooltip: () => { tooltip = ""; },
        showTooltip: (text: string) => { tooltip = text; },
        fetchPost: (_url: string, body: {path: string}, receive: (response: unknown) => void,
                    _before: unknown, _after: unknown, signal: AbortSignal) => {
            assetRequests.push({path: body.path, receive, signal});
        },
        isLocalPath: (value: string) => value.startsWith("assets/"),
        getAssetExtension: (value: string) => require("node:path").posix.extname(value),
        getAssetName: (value: string) => require("node:path").posix.basename(value, require("node:path").posix.extname(value))
            .replace(/-\d{14}-\w{7}$/, ""),
        Constants: {TIMEOUT_INPUT: 5},
        isTouchDevice: () => false,
        isTouchHoverInput: () => false,
        isInteractiveTooltipTarget: () => false,
        isEncryptedBox: () => false,
        isAbove: () => false,
    };
    const api = new Function(...Object.keys(dependencies), source +
        "; return {initBlockPopover, suspendBlockPopover, showPopover};")(...Object.values(dependencies));
    window.siyuan = {
        config: {editor: {floatWindowMode: 0, floatWindowDelay: 20}},
        menus: {menu: {element: document.createElement("div")}},
        blockPanels: [],
        languages: {ocrResult: "OCR text", ocrNoText: "No OCR text", ocrFailed: "OCR recognition failed",
            emptyContent: "No related content found", modifiedAt: "Modified", createdAt: "Created",
            listItemActionTip: "List menu and attributes"},
    } as unknown as typeof window.siyuan;
    window.JSAndroid = {} as typeof window.JSAndroid;
    const root = document.createElement("div");
    root.className = "mindmap-view";
    root.innerHTML = '<span data-type="block-ref" data-id="test">Reference</span>';
    document.body.append(root);
    const ref = root.firstElementChild as HTMLElement;
    const hover = () => ref.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const penHover = () => ref.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "pen"}));
    const settle = () => new Promise(resolve => setTimeout(resolve, 60));
    const suspend = () => api.suspendBlockPopover(root, new PointerEvent("pointerdown"));
    api.initBlockPopover({});

    // 按下前已排队的悬停任务必须取消，结束交互也不补开。
    hover();
    let resume = suspend();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    resume();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 1, "fresh hover resumes after interaction");
    resume = suspend();
    check.equal(window.siyuan.blockPanels.length, 0, "an existing temporary panel closes on interaction");
    resume();

    hover();
    await settle();
    const pinned = window.siyuan.blockPanels[0];
    pinned.element.dataset.pin = "true";
    resume = suspend();
    check.equal(window.siyuan.blockPanels[0], pinned, "pinned panels survive interaction");
    resume();
    pinned.destroy();

    // 多个脑图交互分别释放，取消其中一个不能恢复另一个的悬停。
    const otherRoot = document.createElement("div");
    document.body.append(otherRoot);
    resume = suspend();
    const resumeOther = api.suspendBlockPopover(otherRoot, new PointerEvent("pointerdown"));
    resume();
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0);
    resumeOther();

    // 引用查询在松手之后才完成时，仍属于已取消的悬停任务。
    window.siyuan.shiftIsPressed = true;
    hover();
    check.equal(requests.length, 1);
    window.siyuan.shiftIsPressed = false;
    resume = suspend();
    resume();
    requests.shift()({code: 0, data: {refDefs: [{refID: "test"}]}});
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "late reference queries cannot reopen the panel");

    ref.dataset.type = "virtual-block-ref";
    delete ref.dataset.id;
    hover();
    await settle();
    check.equal(requests.length, 1);
    resume = suspend();
    resume();
    requests.shift()({code: 0, data: {refDefs: [{refID: "virtual"}]}});
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "late virtual reference queries are also cancelled");
    ref.dataset.type = "block-ref";
    ref.dataset.id = "test";

    penHover();
    resume = suspend();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "pen hover timers are cancelled with mouse hover timers");
    resume();
    penHover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 1);
    check.equal(window.siyuan.config.editor.floatWindowMode, 0);
    check.equal(window.siyuan.config.editor.floatWindowDelay, 20);

    const imageRoot = document.createElement("span");
    imageRoot.className = "img";
    const image = document.createElement("img");
    image.title = "Caption %3Cem%3E & details";
    image.alt = "<literal> description";
    imageRoot.append(image);
    document.body.append(imageRoot);
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, "Caption %3Cem%3E &amp; details<br>&lt;literal> description");
    check.equal(image.title, "Caption %3Cem%3E & details");
    check.equal(image.alt, "<literal> description");
    image.setAttribute("data-title", image.title);
    image.removeAttribute("title");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, "Caption %3Cem%3E &amp; details<br>&lt;literal> description");
    check.equal(image.hasAttribute("title"), false);
    image.removeAttribute("data-title");
    image.title = "";
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, "&lt;literal> description");
    image.title = image.alt;
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, "&lt;literal> description");

    image.title = "";
    image.alt = "";
    image.setAttribute("data-src", "assets/photo%20%3Cname%3E-20260930090000-abcdefg.png");
    Object.defineProperties(image, {naturalWidth: {value: 1920}, naturalHeight: {value: 1080}});
    image.style.width = "100px";
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, "photo &lt;name>.png<br>PNG · 1920 × 1080");
    check.equal(assetRequests.length, 1);
    assetRequests[0].receive({code: 0, data: {hSize: "2 MiB"}});
    check.match(tooltip, /PNG · 1920 × 1080 · 2 MiB$/);
    ocrRequests[0]("<script> & text\nsecond line");
    await Promise.resolve();
    check.match(tooltip, /OCR text:<br>&lt;script> &amp; text<br>second line$/);
    check.match(tooltip, /2 MiB/);
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    document.body.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(assetRequests[1].signal.aborted, true);
    tooltip = "later target";
    assetRequests[1].receive({code: 0, data: {hSize: "stale"}});
    ocrRequests[1]("stale OCR");
    await Promise.resolve();
    check.equal(tooltip, "later target");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const unavailable = tooltip;
    assetRequests[2].receive({code: 1, data: null});
    check.equal(tooltip, unavailable);
    ocrRequests[2](" \n ");
    await Promise.resolve();
    check.equal(tooltip, unavailable, "empty OCR leaves only the existing image information");
    image.setAttribute("data-src", "https://example.com/photo.webp");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.match(tooltip, /photo.webp.*WEBP · 1920 × 1080/);
    check.equal(assetRequests.length, 3);
    check.equal(ocrRequests.length, 3, "remote images do not query OCR");
    image.setAttribute("data-src", "assets/encrypted.png?box=encrypted");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(assetRequests.length, 3);
    check.equal(ocrRequests.length, 3, "encrypted resources do not query OCR");
    image.setAttribute("data-src", "assets/long-ocr.png");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const longText = "x".repeat(201);
    ocrRequests[3](longText);
    await Promise.resolve();
    check.ok(tooltip.endsWith("x".repeat(200) + "..."));
    check.equal(tooltip.includes(longText), false);
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests[4]("1\r\n2\r3\n4\n5\n6\n7");
    await Promise.resolve();
    check.ok(tooltip.endsWith("1<br>2<br>3<br>4<br>5<br>6..."));
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests[5]("😀".repeat(201));
    await Promise.resolve();
    check.ok(tooltip.endsWith("😀".repeat(200) + "..."), "truncation does not split surrogate pairs");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests[6]("<".repeat(201));
    await Promise.resolve();
    check.ok(tooltip.endsWith("&lt;".repeat(200) + "..."), "truncation precedes HTML escaping");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests[7]("x".repeat(200));
    await Promise.resolve();
    check.ok(tooltip.endsWith("x".repeat(200)));
    check.equal(tooltip.endsWith("..."), false, "exact-length text remains complete");
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests[8]("1\n2\n3\n4\n5\n6");
    await Promise.resolve();
    check.ok(tooltip.endsWith("1<br>2<br>3<br>4<br>5<br>6"), "six complete lines remain unchanged");
    check.equal(image.title, "");
    check.equal(image.alt, "");
    window.siyuan.config.ocr = {provider: "paddleocr", model: "tiny", auto: false,
        aiModelId: "", reasoningEffort: "", thresholds: {detection: null, box: null, recognition: null},
        showText: false, showEmpty: false, showError: false};
    const previousOCRRequests = ocrRequests.length;
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(ocrRequests.length, previousOCRRequests, "disabled tooltip options skip OCR reads but retain asset information");
    check.match(tooltip, /PNG · 1920 × 1080/);
    window.siyuan.config.ocr.showEmpty = true;
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests.at(-1)("");
    await Promise.resolve();
    check.match(tooltip, /No OCR text$/);
    window.siyuan.config.ocr.showError = true;
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests.at(-1)({text: "old text", failed: true});
    await Promise.resolve();
    check.match(tooltip, /OCR recognition failed$/);
    check.equal(tooltip.includes("old text"), false);
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    ocrRequests.at(-1)(undefined);
    await Promise.resolve();
    check.doesNotMatch(tooltip, /No OCR text|OCR recognition failed/, "read failures are not recognition failures");
    window.siyuan.config.ocr.showText = true;
    image.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    window.siyuan.config.ocr.showText = false;
    ocrRequests.at(-1)("late preview");
    await Promise.resolve();
    check.equal(tooltip.includes("late preview"), false, "late responses use the latest tooltip preferences");
    const link = document.createElement("span");
    link.setAttribute("data-type", "a");
    link.setAttribute("data-href", "https://example.com/file.pdf");
    link.setAttribute("data-title", "Link title");
    document.body.append(link);
    link.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, '<span style="word-break: break-all">https://example.com/file.pdf</span><br><span>Link title</span>');
    link.setAttribute("data-href", "assets/file.pdf");
    link.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    assetRequests.at(-1).receive({code: 0, data: {hSize: "1 KiB", hUpdated: "Updated", hCreated: "Created"}});
    check.equal(tooltip, '<span style="word-break: break-all">assets/file.pdf</span> 1 KiB<br><span>Link title</span><br>Modified Updated<br>Created Created');
    link.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    assetRequests.at(-1).receive({code: 1});
    check.equal(tooltip, '<span style="word-break: break-all">assets/file.pdf</span><br><span>Link title</span>');
    const url = document.createElement("span");
    url.className = "av__celltext--url ariaLabel";
    url.setAttribute("aria-label", "https://example.com/");
    url.setAttribute("data-name", "Column title");
    document.body.append(url);
    url.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    check.equal(tooltip, '<span style="word-break: break-all">https://example.com/</span><br><span>Column title</span>');

    const editor = document.createElement("div");
    editor.className = "protyle";
    editor.innerHTML = '<div data-type="NodeListItem"><div class="protyle-action"><span>1.</span></div></div>';
    document.body.append(editor);
    const marker = editor.querySelector("span");
    const hoverMarker = () => marker.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    hoverMarker();
    check.equal(tooltip, "List menu and attributes", "ordinary editors retain the list action tooltip");
    editor.dataset.protyleLite = "true";
    hoverMarker();
    check.equal(tooltip, "", "standalone Lite editors hide the unavailable list actions");
    editor.dataset.protyleLite = "false";
    hoverMarker();
    check.equal(tooltip, "List menu and attributes", "reused non-Lite hosts retain the tooltip");
    const fragment = document.createElement("div");
    fragment.className = "protyle-lite-fragment";
    document.body.append(fragment);
    fragment.append(editor);
    hoverMarker();
    check.equal(tooltip, "", "fragment editors continue to hide the list action tooltip");
    editor.remove();
    fragment.remove();

    window.siyuan.blockPanels.slice().forEach(panel => panel.destroy());
    window.siyuan.dialogs = [];
    let mac = true;
    const keyboard = new Function("isMac", "showPopover", "Constants", keyboardSource +
        "; return {filterHotkey, windowKeyUp, bindMindmapKeyboard};")(
        () => mac, api.showPopover, {KEYCODELIST: {}});
    keyboard.bindMindmapKeyboard(root);
    const outer = document.createElement("div");
    outer.className = "protyle-wysiwyg";
    document.body.append(outer);
    outer.append(root);
    let outerReleases = 0;
    outer.addEventListener("keyup", () => outerReleases++);
    const nodeEditor = document.createElement("div");
    nodeEditor.className = "mindmap-view__editor";
    nodeEditor.contentEditable = "true";
    // 节点编辑器在冒泡阶段隔离按键释放，容器仍需同步修饰键状态。
    nodeEditor.addEventListener("keyup", event => event.stopPropagation());
    root.append(nodeEditor);
    const keydown = (event: KeyboardEvent) => keyboard.filterHotkey(event, {});
    const keyup = (event: KeyboardEvent) => keyboard.windowKeyUp({}, event);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    for (const platform of ["mac", "windows"]) {
        mac = platform === "mac";
        const key = mac ? "Meta" : "Control";
        const modifier = mac ? {metaKey: true} : {ctrlKey: true};
        for (const target of [root, nodeEditor]) {
            window.siyuan.config.editor.floatWindowMode = 1;
            hover();
            check.equal(window.siyuan.blockPanels.length, 0, `${platform}: hover alone does not open a panel`);
            target.dispatchEvent(new KeyboardEvent("keydown", {key, ...modifier, bubbles: true}));
            check.equal(window.siyuan.ctrlIsPressed, true);
            check.equal(window.siyuan.blockPanels.length, 1, `${platform}: pressing the modifier over a reference opens it`);
            target.dispatchEvent(new KeyboardEvent("keyup", {key, bubbles: true}));
            check.equal(window.siyuan.ctrlIsPressed, false, `${platform}: releasing inside a mindmap clears the modifier`);
            document.body.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            await settle();
            hover();
            await settle();
            check.equal(window.siyuan.blockPanels.length, 0, `${platform}: released modifiers cannot trigger another panel`);
            hover();
            target.dispatchEvent(new KeyboardEvent("keydown", {key, ...modifier, bubbles: true}));
            check.equal(window.siyuan.blockPanels.length, 1, `${platform}: the next modifier press still works`);
            target.dispatchEvent(new KeyboardEvent("keyup", {key, bubbles: true}));
            document.body.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
            await settle();
            check.equal(window.siyuan.blockPanels.length, 0);
        }
    }
    for (const key of ["Shift", "Alt"]) {
        const field = key === "Shift" ? "shiftIsPressed" : "altIsPressed";
        nodeEditor.dispatchEvent(new KeyboardEvent("keydown", {
            key, shiftKey: key === "Shift", altKey: key === "Alt", bubbles: true,
        }));
        check.equal(window.siyuan[field], true);
        nodeEditor.dispatchEvent(new KeyboardEvent("keyup", {key, bubbles: true}));
        check.equal(window.siyuan[field], false, `${key} cannot remain pressed after node editing`);
        check.equal(document.body.classList.contains("body--shift-pressed"), false);
    }
    window.siyuan.config.editor.floatWindowMode = 0;
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 1, "ordinary hover mode still opens a panel");
    window.siyuan.blockPanels[0].destroy();
    window.siyuan.config.editor.floatWindowMode = 2;
    hover();
    await settle();
    check.equal(window.siyuan.blockPanels.length, 0, "disabled mode never opens a panel");
    check.equal(outerReleases, 0, "mindmap key releases do not reach the source editor");
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    outer.remove();
    return "Popover interaction cases passed";
};

const getKeyboardSource = () => {
    const read = (file: string) => createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"),
        ScriptTarget.Latest, true);
    const variables = (file: string, names: string[]) => {
        const source = read(file);
        const statements = source.statements.filter(statement => isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length);
        return statements.map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    };
    const controllerSource = read("../protyle/render/listMindmap/index.ts");
    const controller = controllerSource.statements.find(isClassDeclaration);
    const controllerConstructor = controller.members.find(isConstructorDeclaration);
    const releases = controllerConstructor.body.statements.filter(statement => isExpressionStatement(statement) &&
        isCallExpression(statement.expression) &&
        statement.expression.expression.getText(controllerSource) === "this.host.addEventListener" &&
        statement.expression.arguments[0]?.getText(controllerSource) === '"keyup"');
    const viewSource = read("../protyle/render/listMindmap/view.ts");
    const view = viewSource.statements.find(isClassDeclaration);
    const viewConstructor = view.members.find(isConstructorDeclaration);
    const isolation = viewConstructor.body.statements.find(statement =>
        statement.getText(viewSource).includes('"compositionend"') && statement.getText(viewSource).includes(".forEach"));
    assert.ok(isolation);
    return transpileModule([
        variables("../protyle/util/compatibility.ts", ["isOnlyMeta", "isNotCtrl"]),
        variables("../boot/globalEvent/commonHotkey.ts", ["filterHotkey"]),
        variables("../boot/globalEvent/keyup.ts", ["windowKeyUp"]),
        `const bindMindmapKeyboard = host => {
            const options = {host};
            (function () {
                ${releases.map(statement => statement.getText(controllerSource)).join("\n")}
                ${isolation.getText(viewSource)}
            }).call({host, options: {}, listen: (target, type, handler, options) => target.addEventListener(type, handler, options)});
        };`,
    ].join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
};

test("mindmap interactions release modifiers and preserve hover preferences and pinned panels", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 20000,
}, async () => {
    const source = ["../protyle/util/hasClosest.ts", "../protyle/wysiwyg/listContext.ts", "../util/escape.ts", "../protyle/render/imageTitle.ts", "../protyle/render/imageTooltip.ts", "panelOwnership.ts", "popoverLifecycle.ts", "popover.ts"].map(file => transpileModule(
        readFileSync(path.join(__dirname, file), "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}},
    ).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-popover-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(getKeyboardSource())})`)}));
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
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 15000, windowsHide: true});
        assert.match(result.stdout, /Popover interaction cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
