import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const history: {before: string; after: string; undo: Record<string, string>; redo: Record<string, string>}[] = [];
    const noop = () => {};
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const holder = document.createElement("div");
    document.body.append(holder);
    let editable = true;
    const constants = {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
        CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data", CUSTOM_SY_CODE_TAB_SPACES: "custom-sy-code-tab-spaces"};
    const blockDOM = (markdown: string) => {
        const element = document.createElement("div");
        element.innerHTML = lute.Md2BlockDOM(markdown);
        return element;
    };
    const dependencies = {Constants: constants, canEdit: () => editable, showMessage: (message: string) => check.fail(message),
        disposeCustomBlocksInElement: noop, processRender: noop, highlightRender: noop, avRender: noop, blockRender: noop,
        genListItemElement: () => blockDOM("- New\n").firstElementChild.firstElementChild,
        updateTransaction: (_owner: unknown, list: HTMLElement, before: string, undo: Record<string, string>,
                            extra: {context: Record<string, string>}) => history.push({before,
            after: api.cleanListMindmapHTML(list.outerHTML), undo, redo: extra.context}),
    };
    const api = new Function(...Object.keys(dependencies), source +
        "; return {readListMindmap, cleanListMindmapHTML, applyListMindmapListInput, retagMindmapBranch, replaceListMindmapContent, InputController};")(...Object.values(dependencies));
    for (const [legacy, fullscreen] of [[false, false], [true, false], [false, true], [true, true]]) {
        holder.replaceChildren(...Array.from(blockDOM("- Alpha\n  - Child\n- Beta\n  - Grandchild\n- Gamma\n").children));
        const list = holder.firstElementChild as HTMLElement;
        if (!legacy) api.retagMindmapBranch(list, true);
        const read = () => api.readListMindmap(list);
        const [a, b, c] = Array.from(list.children).filter((item: HTMLElement) => item.dataset.nodeId)
            .map((item: HTMLElement) => item.dataset.nodeId);
        const html = (id: string) => read().nodes.get(id).contentBlocks.map((block: HTMLElement) =>
            api.cleanListMindmapHTML(block.outerHTML)).join("");
        const original = list.outerHTML;
        const descendants = read().nodes.get(b).children.map((node: {id: string}) => node.id);
        check.equal(api.applyListMindmapListInput(list, b, {kind: "indent", html: html(b)}).id, b);
        check.equal(read().nodes.get(b).parentId, a);
        check.deepEqual(read().nodes.get(b).children.map((node: {id: string}) => node.id), descendants);
        check.equal(api.applyListMindmapListInput(list, b, {kind: "outdent", html: html(b)}).id, b);
        check.equal(list.outerHTML, original, "indent/outdent preserve content, IDs and branch order");
        for (const [id, kind] of [[a, "indent"], [a, "outdent"], [a, "mergePrevious"], [c, "mergeNext"]]) {
            check.equal(api.applyListMindmapListInput(list, id, {kind, html: html(id)}), undefined);
        }
        check.equal(api.applyListMindmapListInput(list, b, {kind: "split", html: "stale"}), undefined);
        check.equal(list.outerHTML, original, "invalid boundaries and stale text do not mutate data");
        const host = document.createElement("div");
        host.className = "mindmap-view";
        host.innerHTML = '<div class="mindmap-view__viewport"><div class="mindmap-view__node">Derived canvas</div></div>';
        const marker = document.createComment("mindmap-view");
        if (fullscreen) {
            document.body.append(host);
            list.append(marker);
        } else {
            list.append(host);
        }
        const assertCanvas = () => {
            check.equal(list.querySelectorAll(":scope > .mindmap-view").length, fullscreen ? 0 : 1,
                "structural input retains exactly the original canvas without inserting a clone");
            check.equal(host.parentElement, fullscreen ? document.body : list);
            const markers = Array.from(list.childNodes).filter(node => node.nodeType === Node.COMMENT_NODE &&
                node.nodeValue === "mindmap-view");
            check.deepEqual(markers, fullscreen ? [marker] : [], "fullscreen retains its exact single return marker");
            for (const entry of history) {
                check.doesNotMatch(entry.before + entry.after, /Derived canvas|class="mindmap-view"|<!--mindmap-view-->/,
                    "transactions contain source content only");
            }
        };
        const controller = new api.InputController();
        const edits: {id: string; selection: Record<string, string>}[] = [];
        let focused = b;
        Object.assign(controller, {list, host, owner: {block: {rootID: "document"}, wysiwyg: {element: holder}}, disposed: false,
            model: read(), view: {getSelectedId: () => focused, focusNode: (id: string) => { focused = id; },
                getContentHost: () => holder},
            refresh: () => { controller.model = read(); },
            edit: async (id: string, _host: HTMLElement, _replace: string, _clipboard: unknown, selection: Record<string, string>) => {
                edits.push({id, selection});
            }});
        const paragraph = read().nodes.get(b).contentBlocks[0].cloneNode(true) as HTMLElement;
        paragraph.querySelector('[contenteditable="true"]').textContent = "Be";
        const after = blockDOM("ta\n\n> Rich content\n");
        const extraID = after.lastElementChild.getAttribute("data-node-id");
        const selection = {undoFocusId: paragraph.dataset.nodeId, undoFocusStart: "2", undoFocusEnd: "2"};
        let finished = 0;
        controller.activeEditor = {finish: async () => { finished++; controller.activeEditor = undefined; return true; }};
        await controller.listInput(b, {kind: "split", html: html(b), before: paragraph.outerHTML, after: after.innerHTML}, selection);
        assertCanvas();
        check.equal(finished, 1);
        const splitID = focused;
        check.notEqual(splitID, b);
        check.equal(read().nodes.get(b).contentBlocks[0].querySelector('[contenteditable="true"]').textContent, "Be");
        check.match(read().nodes.get(splitID).element.textContent, /ta.*Rich content/s);
        check.equal(edits.at(-1).selection.undoFocusStart, "0");
        check.deepEqual(JSON.parse(history.at(-1).undo.undoFocusMindmapSelection), selection);
        check.equal(history.at(-1).redo.undoFocusId, splitID);
        const transactionCount = history.length;
        await controller.listInput(splitID, {kind: "indent", html: html(splitID)}, edits.at(-1).selection);
        assertCanvas();
        check.equal(read().nodes.get(splitID).parentId, b);
        await controller.listInput(splitID, {kind: "outdent", html: html(splitID)}, edits.at(-1).selection);
        assertCanvas();
        check.equal(read().nodes.get(splitID).parentId, read().nodes.get(b).parentId);
        await controller.listInput(splitID, {kind: "mergePrevious", html: html(splitID)}, edits.at(-1).selection);
        assertCanvas();
        check.equal(history.length, transactionCount+3, "each structural edit is one transaction");
        check.equal(read().nodes.has(splitID), false);
        check.ok(read().nodes.get(b).contentBlocks.some((block: HTMLElement) => block.dataset.nodeId === extraID));
        const merged = history.at(-1);
        const restore = (html: string) => { const dom = document.createElement("div"); dom.innerHTML = html;
            controller.replaceClipboardSource(dom.firstElementChild); controller.refresh(); };
        restore(merged.before);
        assertCanvas();
        check.equal(read().nodes.has(splitID), true, "undo restores the separate node and all body IDs");
        restore(merged.after);
        assertCanvas();
        check.equal(read().nodes.has(splitID), false, "redo restores the merged body");
        const moved = read().nodes.get(b).children.map((node: {id: string}) => node.id);
        await controller.listInput(a, {kind: "mergeNext", html: html(a)});
        assertCanvas();
        check.equal(read().nodes.has(b), false);
        moved.forEach((id: string) => check.equal(read().nodes.get(id).parentId, a, "merge preserves descendant branches"));
        check.ok(read().nodes.get(a).contentBlocks.some((block: HTMLElement) => block.dataset.nodeId === extraID));
        check.equal(read().nodes.has(c), true);
        const fresh = blockDOM("- Before\n").firstElementChild;
        if (!legacy) api.retagMindmapBranch(fresh, true);
        const inserted = api.applyListMindmapListInput(list, a, {kind: "before", html: html(a)}, fresh.firstElementChild);
        check.equal(read().nodes.get(a).element.previousElementSibling.dataset.nodeId, inserted.id);
        const noChange = list.outerHTML;
        controller.model = read();
        const count = history.length;
        await controller.listInput(c, {kind: "split", html: "stale", before: "stale", after: "stale"});
        editable = false;
        await controller.listInput(c, {kind: "before", html: html(c)});
        editable = true;
        controller.activeEditor = {finish: async () => false};
        await controller.listInput(c, {kind: "before", html: html(c)});
        controller.activeEditor = undefined;
        for (const interrupt of ["editor", "document"]) {
            controller.activeEditor = {finish: async () => {
                if (interrupt === "editor") controller.editRequest = (controller.editRequest || 0) + 1;
                else controller.owner.block.rootID = "other-document";
                controller.activeEditor = undefined;
                return true;
            }};
            await controller.listInput(c, {kind: "before", html: html(c)});
            controller.owner.block.rootID = "document";
        }
        check.equal(history.length, count);
        check.equal(list.outerHTML, noChange, "failed saves, stale requests and readonly mode preserve source");
        const canonical = blockDOM("");
        canonical.innerHTML = lute.SpinBlockDOM(api.cleanListMindmapHTML(list.outerHTML));
        check.ok(api.readListMindmap(canonical.firstElementChild).nodes.has(c), "Lute preserves the resulting hierarchy");
        host.remove();
    }
    holder.remove();
    return "Mindmap list input cases passed";
};

test("mindmap list input preserves rich blocks, branch identity, transaction focus and undo snapshots", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const sourceFile = createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
    const controller = sourceFile.statements.find(isClassDeclaration);
    const names = ["listInput", "change", "replaceClipboardSource", "replaceSourceChildren"];
    const methods = controller.members.filter(item => names.includes(item.name?.getText(sourceFile)));
    assert.equal(methods.length, names.length);
    const source = ["../../wysiwyg/listContext.ts", "summary.ts", "connectors.ts", "appearance.ts", "model.ts", "listInput.ts"]
        .map(name => compile(readFileSync(path.join(__dirname, name), "utf8"))).join("\n") +
        compile(`class InputController {${methods.map(item => item.getText(sourceFile)).join("\n")}}`);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-list-input-"));
    const script = path.join(temporary, "run.cjs");
    const code = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(${JSON.stringify(readFileSync(path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js"), "utf8"))});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Mindmap list input cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-mindmap-list-input-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
