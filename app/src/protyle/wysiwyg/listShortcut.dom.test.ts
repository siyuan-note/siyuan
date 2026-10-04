import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const hidden = () => Object.assign(document.createElement("div"), {className: "fn__none"});
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.contentEditable = "true";
    document.body.append(root);
    const calls: {nodeElement: HTMLElement, type: string}[] = [];
    const noop = (): undefined => undefined;
    window.siyuan = {config: {keymap: {general: {}, editor: {
        general: {}, heading: {}, list: {}, insert: {
            list: {custom: "⌘J"}, "ordered-list": {custom: "⇧⌘J"}, check: {custom: "⌘L"},
        },
    }}}, menus: {menu: {element: hidden(), remove: noop}}} as any;
    const dependencies = {
        Constants: {KEYCODELIST: {27: "Escape", 38: "↑", 74: "J", 76: "L"}, MENU_BLOCK_MULTI: "multi",
            CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"},
        bindVerticalNavigationReset: noop, logKeyboardDiagnostic: noop, getAVTemplateInteractiveElement: noop,
        prepareVerticalNavigation: noop, avKeydown: noop, fixTable: noop, commonHotkey: noop,
        countBlockWord: noop, clearAtomicFocus: noop,
        setInsertWbrHTML: noop, getAtomicVerticalNavigationOwner: noop, revealTabsForTarget: noop,
        formatPainter: {deactivate: () => false},
        isMac: () => false,
        isProtyleListItemFragment: () => false,
        getAdjacentVisibleBlock: (element: Element) => element.previousElementSibling,
        hideElements: (panels: string[]) => {
            if (panels.includes("select")) {
                root.querySelectorAll(".protyle-wysiwyg--select, .protyle-wysiwyg--select-mode").forEach(element =>
                    element.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--select-mode"));
            }
        },
        turnsOneInto: (options: any) => calls.push(options),
        turnsIntoOneTransaction: (options: any) => calls.push({nodeElement: options.selectsElement[0], type: options.type}),
    };
    const {keydown, restoreGutterRange, getEditorRange} = new Function(...Object.keys(dependencies),
        source + "; return {keydown, restoreGutterRange, getEditorRange};")(...Object.values(dependencies));
    const protyle = {wysiwyg: {element: root}, selectElement: hidden(), contentElement: root,
        toolbar: {element: hidden(), subElement: hidden(), range: undefined as Range}, hint: {element: hidden()},
        options: {render: {}, toolbar: [] as IMenuItem[]}, block: {}, scroll: {}};
    keydown(protyle, root);
    let failure: unknown;
    window.addEventListener("unhandledrejection", event => {
        event.preventDefault();
        failure = event.reason;
    });
    const press = async (key: string, keyCode: number, ctrlKey = false, shiftKey = false) => {
        const event = new KeyboardEvent("keydown", {key, keyCode, ctrlKey, shiftKey, bubbles: true, cancelable: true});
        document.activeElement.dispatchEvent(event);
        await new Promise(resolve => setTimeout(resolve, 0));
        if (failure) {
            throw failure;
        }
        return event;
    };
    for (const conversion of ["OL2UL", "UL2OL", "UL2TL"]) {
        root.innerHTML = '<div data-type="NodeMindmap" data-node-id="map" class="mindmap" data-subtype="u">' +
            '<div class="mindmap-view" contenteditable="false">Map</div></div>' +
            '<div data-type="NodeParagraph" data-node-id="paragraph"><div contenteditable="true">Text</div></div>';
        const mindmap = root.firstElementChild;
        const paragraph = root.lastElementChild;
        root.focus();
        getSelection().setBaseAndExtent(paragraph.firstChild.firstChild, 0, paragraph.firstChild.firstChild, 0);
        calls.length = 0;
        await press("Escape", 27);
        check.ok(paragraph.classList.contains("protyle-wysiwyg--select-mode"));
        await press("ArrowUp", 38);
        check.ok(mindmap.classList.contains("protyle-wysiwyg--select-mode"));
        check.equal(root.querySelector(".protyle-wysiwyg--select"), null);
        check.ok(paragraph.contains(getSelection().anchorNode));
        const event = await press(conversion === "UL2TL" ? "l" : "j", conversion === "UL2TL" ? 76 : 74,
            true, conversion === "UL2OL");
        check.ok(event.defaultPrevented);
        check.equal(calls.length, 1);
        check.equal(calls[0].nodeElement, mindmap);
        check.equal(calls[0].type, conversion);

        // 点击画布后通过块标选中整块，菜单恢复选区时必须把快捷键交回正文编辑器。
        root.innerHTML = '<div data-type="NodeMindmap" data-node-id="map" class="mindmap" data-subtype="u">' +
            '<div class="mindmap-view" contenteditable="false" tabindex="0">Map</div></div>';
        const selectedMap = root.firstElementChild;
        const canvas = selectedMap.firstElementChild as HTMLElement;
        canvas.addEventListener("keydown", event => event.stopPropagation());
        canvas.focus();
        getSelection().setBaseAndExtent(canvas.firstChild, 0, canvas.firstChild, 0);
        selectedMap.classList.add("protyle-wysiwyg--select");
        protyle.toolbar.range = getEditorRange(selectedMap);
        restoreGutterRange(protyle);
        calls.length = 0;
        const clickEvent = await press(conversion === "UL2TL" ? "l" : "j", conversion === "UL2TL" ? 76 : 74,
            true, conversion === "UL2OL");
        check.ok(clickEvent.defaultPrevented);
        check.equal(calls.length, 1);
        check.equal(calls[0].nodeElement, selectedMap);
        check.equal(calls[0].type, conversion);
    }
    return "Keyboard block selection cases passed";
};

test("keyboard and gutter selection route all three mindmap list shortcuts to the editor", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const read = (name: string) => readFileSync(path.join(__dirname, name + ".ts"), "utf8");
    const extract = (file: string, names?: string[]) => {
        const source = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        if (names) {
            return names.map(name => {
                const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
                    Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === name);
                return `const ${name} = ${declaration.initializer.getText(source)};`;
            }).join("\n");
        }
        return source.statements.filter(statement => !isImportDeclaration(statement))
            .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    };
    const source = transpileModule([
        extract("../util/hasClosest"), extract("getBlock"),
        extract("../../util/keymapBindings"), extract("../util/hotKey", ["matchHotKey", "matchAuxiliaryHotKey"]),
        extract("../util/compatibility", ["isNotCtrl", "isOnlyMeta"]),
        `const {BLOCK_SELECTION_CLASS, getBlockSelectionModeElement, setBlockSelectionModeElement,
            clearBlockSelectionMode, getBlockOperationElements, getBlockSelectionStatusIDs} = (() => {${extract("blockSelection")}
            return {BLOCK_SELECTION_CLASS, getBlockSelectionModeElement, setBlockSelectionModeElement,
                clearBlockSelectionMode, getBlockOperationElements, getBlockSelectionStatusIDs};})();`, extract("listContext"),
        extract("../util/selection", ["getEditorRange", "focusBlock", "focusByRange"]),
        extract("../gutter/index", ["restoreGutterRange"]),
        extract("verticalNavigation", ["focusAtomicRegion", "focusVerticalBlockSelection"]), extract("keydown"),
    ].join("\n"), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-shortcut-test-"));
    const script = path.join(temporary, "run.cjs");
    const expression = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Keyboard block selection cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-list-shortcut-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
