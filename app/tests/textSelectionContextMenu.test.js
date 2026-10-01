const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const sources = () => {
    const editor = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname,
        "../src/protyle/wysiwyg/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const bindings = [];
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(editor) === "this.element.addEventListener" &&
            ["contextmenu", "pointerdown"].includes(node.arguments[0]?.text) &&
            node.getText(editor).includes("beforeContextmenuRange")) {
            bindings.push(node.getText(editor));
        }
        ts.forEachChild(node, visit);
    };
    visit(editor);
    assert.equal(bindings.length, 2);
    const selection = ts.createSourceFile("selection.ts", readFileSync(path.join(__dirname,
        "../src/protyle/util/selection.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const range = selection.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(selection) === "getEditorRange"));
    assert.ok(range);
    const wordSelection = readFileSync(path.join(__dirname, "../src/mobile/util/wordSelection.ts"), "utf8")
        .replace("export const ", "const ");
    const preprocess = (source, mobile) => {
        const active = [true];
        return source.split("\n").filter(line => {
            const condition = line.match(/^\s*\/\/\/ #if (.+)/);
            if (condition) {
                active.push(active.at(-1) && Function(`return ${condition[1]
                    .replaceAll("MOBILE", String(mobile)).replaceAll("BROWSER", "true")}`)());
            } else if (/^\s*\/\/\/ #else/.test(line)) {
                active[active.length - 1] = active.at(-2) && !active.at(-1);
            } else if (/^\s*\/\/\/ #endif/.test(line)) {
                active.pop();
            } else {
                return active.at(-1);
            }
            return false;
        }).join("\n");
    };
    return [false, true].map(mobile => ts.transpileModule(preprocess(
        `const bind = function(protyle) {let beforeContextmenuRange; ${bindings.join(";\n")};};\n` +
        range.getText(selection).replace("export ", "") + "\n" + wordSelection, mobile), {
        compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
    }).outputText);
};

const cases = async compiled => {
    const check = require("node:assert/strict");
    for (const mobile of [false, true]) {
        document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="true">${
            ["first", "middle", "last", "outside"].map(id =>
                `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${id} text</div></div>`).join("")}</div>`;
        const root = document.body.firstElementChild;
        const blocks = Array.from(root.children);
        const texts = blocks.map(block => block.firstElementChild.firstChild);
        const selection = getSelection();
        const menus = [];
        const callbacks = {};
        const protyle = {element: root, wysiwyg: {element: root}, toolbar: {
            isMultiSelectMode: () => false, element: document.createElement("div"),
        }, gutter: {renderMenu: () => menus.push({blockMenu: true})}};
        protyle.toolbar.element.classList.add("fn__none");
        const closest = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest("[data-node-id]");
        const dependencies = {
            isMobile: () => mobile,
            getBlockSelectionModeElement: () => undefined,
            isInEmbedBlock: () => undefined,
            hasClosestBlock: closest,
            hasClosestByClassName: (node, name) => node.closest(`.${name}`),
            hasClosestByAttribute: (node, name, value) => node.closest(`[${name}="${value}"]`),
            isNotEditBlock: () => false,
            requestSpellcheckContext: async () => undefined,
            addSpellcheckMenuItems() {},
            getAtomicVerticalNavigationOwner: () => undefined,
            getContenteditableElement: element => element.querySelector('[contenteditable="true"]'),
            window: {siyuan: {menus: {menu: {remove() {}, popup() {}, fullscreen() {}}}}},
        };
        const api = Function(...Object.keys(dependencies), `${compiled[Number(mobile)]}\nreturn {bind, getEditorRange};`)(
            ...Object.values(dependencies));
        dependencies.contentMenu = (owner, block) => {
            const range = api.getEditorRange(block);
            menus.push({block, text: range.toString(), copy: () => api.getEditorRange(block).toString()});
        };
        const bind = Function(...Object.keys(dependencies), `${compiled[Number(mobile)]}\nreturn bind;`)(
            ...Object.values(dependencies));
        bind.call({element: {addEventListener: (name, callback) => {callbacks[name] = callback;}}}, protyle);
        // 使用真实 DOM Range 覆盖正反向跨块选区，菜单操作仍应读取完整选区。
        for (const reversed of [false, true]) {
            for (const target of blocks.slice(0, 3)) {
                selection.setBaseAndExtent(texts[reversed ? 2 : 0], reversed ? 4 : 2,
                    texts[reversed ? 0 : 2], reversed ? 2 : 4);
                const expected = selection.getRangeAt(0).toString();
                const visibleText = selection.toString();
                menus.length = 0;
                callbacks.pointerdown();
                await callbacks.contextmenu({shiftKey: false, target: target.firstElementChild, detail: {},
                    clientX: 20, clientY: 20, stopPropagation() {}, preventDefault() {}});
                check.equal(menus.length, 1, `menu on ${target.dataset.nodeId}, mobile=${mobile}, reversed=${reversed}`);
                check.equal(menus[0].block, blocks[0]);
                check.equal(menus[0].text, expected);
                check.equal(menus[0].copy(), expected);
                check.equal(selection.toString(), visibleText);
            }
        }
        // 桌面端在未选中的块中右键，不应误用另一处的非空选区。
        if (!mobile) {
            menus.length = 0;
            callbacks.pointerdown();
            await callbacks.contextmenu({shiftKey: false, target: blocks[3].firstElementChild, detail: {},
                clientX: 20, clientY: 20, stopPropagation() {}, preventDefault() {}});
            check.equal(menus.length, 0);
        }
        selection.collapse(texts[1], 3);
        menus.length = 0;
        callbacks.pointerdown();
        await callbacks.contextmenu({shiftKey: false, target: blocks[1].firstElementChild, detail: {},
            clientX: 20, clientY: 20, stopPropagation() {}, preventDefault() {}});
        check.equal(menus.length, 1);
        check.equal(menus[0].block, blocks[1]);
        check.equal(selection.isCollapsed, true);

        // 长按菜单扩展 Android 的中文单字选区，并保留思源菜单与后续复制读取的选区。
        texts[1].textContent = "我的天空大地呀为什么";
        dependencies.window.JSAndroid = {getWordSelection(text, start, end) {
            check.deepEqual({text, start, end}, {text: "我的天空大地呀为什么", start: 8, end: 9});
            return "[7,10]";
        }};
        selection.setBaseAndExtent(texts[1], 8, texts[1], 9);
        menus.length = 0;
        callbacks.pointerdown();
        let prevented = false;
        await callbacks.contextmenu({shiftKey: false, target: blocks[1].firstElementChild, detail: {},
            clientX: 20, clientY: 20, stopPropagation() {}, preventDefault() { prevented = true; }});
        check.equal(prevented, true);
        check.equal(menus.length, 1);
        check.equal(menus[0].text, "为什么");
        check.equal(menus[0].copy(), "为什么");
        check.equal(selection.toString(), "为什么");
        delete dependencies.window.JSAndroid;
    }
    return "Text selection context menu cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true,
        }});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            const result = await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`);
            assert.equal(result, "Text selection context menu cases passed");
            console.log(result);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    require("node:test").test("context menus preserve forward and backward cross-block text selections", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-text-menu-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Text selection context menu cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
