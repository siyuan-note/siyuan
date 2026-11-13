import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string, treeSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const load = (code: string) => {
        const exports: Record<string, any> = {};
        new Function("exports", "require", code)(exports, () => ({}));
        return exports;
    };
    const {bindBacklinkSelection} = load(source);
    const {Tree} = load(treeSource);
    window.siyuan = {} as typeof window.siyuan;
    const makePanel = () => {
        const element = document.createElement("section");
        element.tabIndex = -1;
        element.innerHTML = '<div class="backlinkList"><li data-treetype="backlink" data-node-id="a" class="b3-list-item"><span class="b3-list-item__toggle"><svg><use></use></svg></span>Backlink</li><div class="preview"><input><li class="b3-list-item--focus">Editor selection</li></div></div>' +
            '<div class="backlinkMList"><li data-treetype="backlink" data-node-id="b" class="b3-list-item">Mention</li></div>';
        document.body.append(element);
        let toggles = 0;
        for (const list of element.querySelectorAll(".backlinkList, .backlinkMList")) {
            const tree = Object.create(Tree.prototype);
            tree.element = list;
            tree.toggleClick = () => { toggles++; element.focus(); };
            tree.click = tree.toggleClick;
            tree.bindEvent();
        }
        return {element, dispose: bindBacklinkSelection(element), toggles: () => toggles};
    };
    const panel = makePanel();
    const [backlink, mention] = panel.element.querySelectorAll('[data-treetype="backlink"]');
    const pointer = (target: Element, pointerType = "mouse") => target.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, pointerType,
    }));
    const click = (target: Element) => {
        pointer(target);
        target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    };
    const selected = (target: Element) => target.classList.contains("b3-list-item--focus");
    click(backlink.querySelector("use"));
    check.equal(panel.toggles(), 1);
    panel.element.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
    check.equal(selected(backlink), true, "entering panel focus preserves selection");
    click(backlink.querySelector("use"));
    check.equal(panel.toggles(), 2);
    check.equal(selected(backlink), true, "repeated toggles preserve selection");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.addEventListener("pointerdown", event => event.stopPropagation());
    pointer(outside);
    check.equal(selected(backlink), false, "capture handles stopped propagation");
    click(backlink);
    click(mention);
    check.equal(selected(backlink), false);
    check.equal(selected(mention), true);
    panel.element.querySelector(".preview li").classList.add("b3-list-item--focus");
    pointer(panel.element.querySelector(".preview"), "touch");
    check.equal(selected(mention), false, "touching preview clears header");
    check.equal(selected(panel.element.querySelector(".preview li")), true, "editor selection is untouched");
    click(backlink);
    panel.element.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
    panel.element.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.equal(selected(backlink), true, "keyboard events preserve navigation anchor");
    outside.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
    check.equal(selected(backlink), false, "focus leaving panel clears selection");
    const other = makePanel();
    click(mention);
    click(other.element.querySelector('[data-treetype="backlink"]'));
    check.equal(selected(mention), false, "instances clear independently");
    const replacement = backlink.cloneNode(true) as Element;
    backlink.replaceWith(replacement);
    replacement.classList.add("b3-list-item--focus");
    pointer(outside);
    check.equal(selected(replacement), false, "refreshed headers are included");
    panel.dispose();
    panel.dispose();
    replacement.classList.add("b3-list-item--focus");
    pointer(outside);
    outside.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
    check.equal(selected(replacement), true, "destroy removes both listeners");
    other.dispose();
    panel.element.remove();
    other.element.remove();
    outside.remove();
    return "Backlink selection browser cases passed";
};

test("backlink selection clears outside interaction and preserves keyboard state", {timeout: 30000}, async () => {
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const source = compile("backlinkSelection.ts");
    const treeSource = compile("../../util/Tree.ts");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-backlink-selection-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.on("console-message", (event) => console.error(event.message));
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(treeSource) + ")")}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Backlink selection browser cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
