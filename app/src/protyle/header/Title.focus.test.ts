import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    Object.assign(window, {siyuan: {mobile: {}, config: {editor: {autoDirection: false}, readonly: false}}});
    const focusByRange = (range: Range) => {
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
    };
    for (const mobile of [false, true]) {
        for (const mode of ["default", "empty", "late-unlock", "slow-new", "other-focus", "body-click", "body-input",
            "hidden", "switched", "destroyed", "readonly", "history", "existing"]) {
            let accept: (response: unknown) => void;
            const container = document.createElement("div");
            container.innerHTML = '<div class="protyle-title"><div class="protyle-title__input" contenteditable="true"></div>' +
                '<div class="protyle-attr"></div></div><div class="body" contenteditable="true">Body unchanged</div>';
            const other = document.createElement("input");
            document.body.append(container, other);
            const body = container.querySelector<HTMLElement>(".body")!;
            body.focus();
            const exports = {} as {Title: {prototype: any}};
            const noop = () => {};
            new Function("exports", "require", source)(exports, (name: string) => {
                if (name === "dayjs") return {__esModule: true,
                    default: () => ({toDate: () => new Date(Date.now() - (["existing", "slow-new"].includes(mode) ? 10000 : 0))})};
                if (name === "../../constants") return {Constants: {CUSTOM_SY_TITLE_EMPTY: "custom-sy-title-empty", CB_GET_OPENNEW: "open-new"}};
                if (name === "../util/normalizeText") return {nbsp2space: (value: string) => value};
                if (name === "../../util/fetch") return {fetchSyncPost: () => new Promise(resolve => { accept = resolve; })};
                if (name === "../render/autoDirection") return {setTitleAutoDirection: noop};
                if (name === "../util/selectionOffsets") return {focusByRange, getSelectionOffset: () => ({start: 0, end: 0})};
                if (name === "../../dialog/tooltip") return {hideTooltip: noop};
                if (name === "./documentTitleEditor") return {DocumentTitleEditor: class {
                    private wysiwyg: HTMLElement;
                    constructor(_owner: unknown, host: HTMLElement, value: {text: string}, onEditable: (element: HTMLElement) => void) {
                        this.wysiwyg = document.createElement("div");
                        this.wysiwyg.contentEditable = String(!mobile);
                        const editable = document.createElement("div");
                        editable.contentEditable = "true";
                        editable.style.minHeight = "1.625em";
                        editable.textContent = value.text;
                        this.wysiwyg.appendChild(editable);
                        host.appendChild(this.wysiwyg);
                        onEditable(editable);
                    }
                    focus() { this.wysiwyg.focus(); }
                    setReadonly() {}
                    destroy() {}
                }};
                return {};
            });
            const title = Object.assign(Object.create(exports.Title.prototype), {
                element: container.firstElementChild,
                editElement: container.querySelector(".protyle-title__input"), sourceRequest: 0,
            });
            const protyle = {element: container, block: {rootID: "20261031000000-abcdefg", action: mode === "slow-new" ? ["open-new"] : []}, notebookId: "notebook",
                options: {render: {}, history: mode === "history" ? {created: "history"} : undefined},
                disabled: mode === "late-unlock" || mode === "readonly", wysiwyg: {renderCustom: noop}};
            title.protyle = protyle;
            const text = mode === "empty" ? "" : "Template default title";
            title.render(protyle, {data: {id: protyle.block.rootID, ial: {title: text}, refCount: 0}});
            check.equal(title.editElement.contentEditable, "false", "plain title remains protected while its source loads");
            // Body rendering can clear the old readonly title's selection before the source response arrives.
            getSelection()!.removeAllRanges();
            if (mode === "other-focus") other.focus();
            if (mode === "body-click") body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
            if (mode === "body-input") body.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: "x"}));
            if (mode === "hidden") container.style.display = "none";
            if (mode === "switched") protyle.block.rootID = "another-document";
            if (mode === "destroyed") title.destroy();
            if (mode === "late-unlock") protyle.disabled = false;
            accept!({code: 0, data: {text, empty: !text, blockDOM: "title", revision: "r0"}});
            await new Promise(resolve => setTimeout(resolve, 0));
            const expectedFocus = ["default", "empty", "late-unlock", "slow-new"].includes(mode);
            check.equal(title.element.contains(document.activeElement), expectedFocus, `${mobile ? "mobile" : "desktop"}: ${mode}`);
            if (expectedFocus) {
                check.equal(getSelection()!.toString(), text, "new titles select their default text for replacement");
                check.ok(title.editElement.contains(getSelection()!.anchorNode), "empty titles still own the insertion point");
                const inserted = document.execCommand("insertText", false, "Renamed");
                // Native typing can replace an empty carrier, but must stay in the title region.
                check.equal(title.element.textContent, "Renamed",
                    `immediate typing edits the title: ${JSON.stringify({mobile, mode, inserted, active: document.activeElement?.outerHTML,
                        title: title.element.innerHTML, body: body.innerHTML})}`);
                check.equal(body.textContent, "Body unchanged");
            }
            container.remove();
            other.remove();
            getSelection()!.removeAllRanges();
        }
    }
    return "New document title focus cases passed";
};

test("new document titles select editable text after source loading without stealing later focus", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(join(__dirname, "Title.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(join(tmpdir(), "siyuan-title-focus-test-"));
    const script = join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    win.webContents.on("console-message", event => console.error(event.message));
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /New document title focus cases passed/);
    } finally {
        if (resolve(temporary, "..") === resolve(tmpdir()) && temporary.startsWith(join(tmpdir(), "siyuan-title-focus-test-"))) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
