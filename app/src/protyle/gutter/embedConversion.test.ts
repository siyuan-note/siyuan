import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const browserCases = async (source: string, helpers: string) => {
    const check = require("node:assert/strict");
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetSuperBlock(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetBlockRef(true);
    lute.SetTabs(true);
    const root = document.createElement("div");
    document.body.append(root);
    const owner = {lute, notebookId: "notebook", block: {rootID: "root"}, wysiwyg: {element: root}} as IProtyle;
    const constants = {ATTRIBUTE_EDITING: "data-editing", CUSTOM_RIFF_DECKS: "custom-riff-decks",
        CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH: "custom-sy-embed-breadcrumb-parent-path",
        CUSTOM_SY_AV_STATIC_TEXT: "custom-sy-av-static-text-"};
    window.siyuan = {config: {editor: {headingEmbedMode: 0}}, languages: {
        refExpired: "Missing source", embedToBlocks: "Convert to regular blocks", embedToReferences: "Convert to references",
    }} as unknown as typeof window.siyuan;
    const copiedHelpers = new Function("Constants", "BLOCK_SELECTION_MODE_CLASS", helpers +
        "; return {clearBlockElement, remapTabsDOMIDs, wrapPastedTabItems, removeFoldHeading};")(constants, "block-selection-mode");
    let context: {allowChildOperation: boolean; targetElement: Element} | undefined;
    let hook: () => void;
    let pending: Promise<void> = Promise.resolve();
    let failureID = "";
    const blocks = new Map<string, string>();
    const headings = new Map<string, string>();
    const texts = new Map<string, string>();
    const calls: Array<{url: string; data: {id: string; notebook?: string}}> = [];
    const transactions: Array<{redo: IOperation[]; undo: IOperation[]}> = [];
    const messages: string[] = [];
    const deps = {...copiedHelpers, Constants: constants,
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        remapListMindmapIDs: () => {},
        showMessage: (message: string) => messages.push(message),
        escapeHtmlTextAndAttr: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
        getEmbedGutterOperationContext: () => context,
        waitForPendingTransactions: () => pending,
        focusBlock: () => {},
        disposeCustomBlocksInElement: () => {},
        processRender: () => {}, highlightRender: () => {}, blockRender: () => {}, avRender: () => {},
        transaction: (_protyle: IProtyle, redo: IOperation[], undo: IOperation[]) => transactions.push({redo, undo}),
        fetchSyncPost: async (url: string, data: {id: string; notebook?: string}) => {
            calls.push({url, data});
            hook?.();
            if (data.id === failureID) {
                return {code: -1, data: null};
            }
            return {code: 0, data: url.endsWith("getBlockDOM") ? {dom: blocks.get(data.id) || ""} :
                url.endsWith("getHeadingChildrenDOM") ? headings.get(data.id) || "" : texts.get(data.id)};
        },
    };
    const api = new Function(...Object.keys(deps), source + "; return {convertEmbed, embedConversionMenu};")(...Object.values(deps));
    const add = (markdown: string) => {
        const container = document.createElement("div");
        container.innerHTML = lute.Md2BlockDOM(markdown);
        const id = container.firstElementChild.getAttribute("data-node-id");
        blocks.set(id, container.innerHTML);
        texts.set(id, container.textContent.trim());
        return id;
    };
    const embed = (ids: string[], mode?: string) => {
        root.innerHTML = lute.Md2BlockDOM("{{select * from blocks}}");
        const node = root.firstElementChild;
        if (mode !== undefined) {
            node.setAttribute("custom-heading-mode", mode);
        }
        ids.forEach(id => {
            const result = document.createElement("div");
            result.className = "protyle-wysiwyg__embed";
            result.dataset.id = id;
            result.innerHTML = '<div class="protyle-breadcrumb">BREADCRUMB</div>' + (blocks.get(id) || "");
            node.append(result);
        });
        return node;
    };
    const apply = (operations: IOperation[]) => operations.forEach(operation => {
        if (operation.action === "update") {
            root.querySelector(`[data-node-id="${operation.id}"]`).outerHTML = operation.data;
        } else if (operation.action === "insert") {
            let previous = root.querySelector(`[data-node-id="${operation.previousID}"]`);
            // Match the kernel's folded-heading insertion boundary, rather than plain DOM insertion.
            if (previous.getAttribute("data-type") === "NodeHeading" && previous.getAttribute("fold") === "1") {
                const level = Number(previous.getAttribute("data-subtype").slice(1));
                while (previous.nextElementSibling && !(previous.nextElementSibling.getAttribute("data-type") === "NodeHeading" &&
                    Number(previous.nextElementSibling.getAttribute("data-subtype").slice(1)) <= level)) {
                    previous = previous.nextElementSibling;
                }
            }
            previous.insertAdjacentHTML("afterend", operation.data);
        } else if (operation.action === "delete") {
            root.querySelector(`[data-node-id="${operation.id}"]`).remove();
        }
    });
    const first = add("**First** ![pic](assets/pic.png)");
    const second = add("- child\n  - nested");
    let node = embed([second, first]);
    const embedID = node.getAttribute("data-node-id");
    const oldHTML = lute.SpinBlockDOM(node.outerHTML);
    const originalSources = Array.from(blocks);
    node.setAttribute("name", "Summary");
    node.setAttribute("custom-test", "preserved");
    node.setAttribute("custom-avs", "original-database");
    node.setAttribute("custom-riff-decks", "original-deck");
    node.setAttribute("custom-heading-mode", "1");
    await api.convertEmbed(owner, node, false);
    check.equal(transactions.length, 1, JSON.stringify({messages, calls, html: root.innerHTML}));
    check.equal(root.firstElementChild.getAttribute("data-type"), "NodeList");
    check.equal(root.firstElementChild.getAttribute("data-node-id"), embedID);
    check.equal(root.firstElementChild.getAttribute("name"), "Summary");
    check.equal(root.firstElementChild.getAttribute("custom-test"), "preserved");
    check.equal(root.firstElementChild.getAttribute("custom-avs"), "original-database");
    check.equal(root.firstElementChild.getAttribute("custom-riff-decks"), "original-deck");
    check.equal(root.firstElementChild.getAttribute("custom-heading-mode"), null);
    check.equal(root.children.length, 2);
    check.match(lute.BlockDOM2StdMd(root.innerHTML), /\*\*First\*\*/);
    check.match(root.innerHTML, /assets\/pic.png/);
    check.doesNotMatch(root.innerHTML, /BREADCRUMB|select \*|NodeBlockQueryEmbed/);
    const copiedIDs = Array.from(root.querySelectorAll("[data-node-id]"), block => block.getAttribute("data-node-id"));
    check.equal(copiedIDs.length, new Set(copiedIDs).size);
    check.ok(!copiedIDs.includes(first) && !copiedIDs.includes(second));
    check.deepEqual(Array.from(blocks), originalSources, "conversion must never mutate sources");
    const saved = transactions.at(-1);
    apply(saved.undo);
    check.equal(root.children.length, 1);
    check.equal(root.firstElementChild.getAttribute("data-type"), "NodeBlockQueryEmbed");
    check.match(lute.SpinBlockDOM(root.innerHTML), /select \*/);
    check.equal(root.firstElementChild.getAttribute("data-node-id"), embedID);
    apply(saved.redo);
    check.equal(root.children.length, 2);
    check.equal(root.firstElementChild.getAttribute("data-type"), "NodeList");

    texts.set(first, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; label");
    node = embed([first, second]);
    await api.convertEmbed(owner, node, true);
    check.equal(root.children.length, 2, JSON.stringify({messages, html: root.innerHTML}));
    const refs = Array.from(root.querySelectorAll<HTMLElement>('[data-type="block-ref"]'));
    check.deepEqual(refs.map(ref => ref.dataset.id), [first, second]);
    check.equal(refs[0].textContent, '<script>alert("x")</script> & label');
    check.ok(refs.every(ref => ref.dataset.subtype === "d"));
    check.equal(root.querySelector("script"), null);
    texts.set(first, "&#92;");
    node = embed([first]);
    await api.convertEmbed(owner, node, true);
    check.equal(root.querySelector('[data-type="block-ref"]').textContent, "\\");

    const heading = add("## Heading");
    const hidden = add("Hidden child");
    headings.set(heading, blocks.get(heading) + blocks.get(hidden));
    for (const mode of ["0", "1", "2"]) {
        node = embed([heading], mode);
        const start = calls.length;
        await api.convertEmbed(owner, node, false);
        check.equal(!!root.querySelector('[data-type="NodeHeading"]'), mode !== "2");
        check.equal(root.textContent.includes("Hidden child"), mode !== "1");
        check.equal(calls.slice(start).some(call => call.url.endsWith("getHeadingChildrenDOM")), mode !== "1");
    }

    node = embed([second, second]);
    await api.convertEmbed(owner, node, false);
    const overlappingIDs = Array.from(root.querySelectorAll("[data-node-id]"), block => block.getAttribute("data-node-id"));
    check.equal(overlappingIDs.length, new Set(overlappingIDs).size, "overlapping query results get independent IDs");

    const list = document.createElement("div");
    list.innerHTML = blocks.get(second);
    const listItem = list.querySelector('[data-type="NodeListItem"]');
    const listItemID = listItem.getAttribute("data-node-id");
    blocks.set(listItemID, listItem.outerHTML);
    node = embed([listItemID]);
    await api.convertEmbed(owner, node, false);
    check.equal(root.firstElementChild.getAttribute("data-type"), "NodeList");
    check.match(root.textContent, /nested/);
    check.equal(root.querySelector(`[data-node-id="${listItemID}"]`), null);

    const tabs = add("::: tabs\n@tab First\n\nFirst tab\n\n@tab Second\n\nSecond tab\n\n:::\n");
    const tabSource = document.createElement("div");
    tabSource.innerHTML = blocks.get(tabs);
    const tabItems = tabSource.querySelectorAll('[data-type="NodeTabItem"]');
    check.equal(tabItems.length, 2);
    const activeTab = tabItems[1].getAttribute("data-node-id");
    tabSource.firstElementChild.setAttribute("tabs-active-id", activeTab);
    blocks.set(tabs, tabSource.innerHTML);
    node = embed([tabs]);
    await api.convertEmbed(owner, node, false);
    const copiedTabs = root.querySelector('[data-type="NodeTabs"]');
    check.notEqual(copiedTabs.getAttribute("tabs-active-id"), activeTab);
    check.ok(copiedTabs.querySelector(`[data-node-id="${copiedTabs.getAttribute("tabs-active-id")}"]`));
    check.equal(root.querySelectorAll('[data-type="NodeTabItem"]').length, 2);

    const documentID = Lute.NewNodeID();
    blocks.set(documentID, blocks.get(first) + blocks.get(second));
    node = embed([documentID]);
    await api.convertEmbed(owner, node, false);
    check.equal(root.children.length, 2, "document embeds retain all content blocks");
    blocks.set(documentID, blocks.get(heading) + blocks.get(first));
    for (const mode of ["0", "1", "2"]) {
        node = embed([documentID], mode);
        const start = calls.length;
        await api.convertEmbed(owner, node, false);
        check.equal(root.children.length, 2, "documents beginning with headings retain all blocks in every heading mode");
        check.ok(!calls.slice(start).some(call => call.url.endsWith("getHeadingChildrenDOM")));
    }

    const folded = document.createElement("div");
    folded.innerHTML = blocks.get(heading);
    folded.firstElementChild.setAttribute("fold", "1");
    blocks.set(heading, folded.innerHTML);
    headings.set(heading, folded.innerHTML + blocks.get(hidden));
    node = embed([heading], "0");
    await api.convertEmbed(owner, node, false);
    check.equal(root.children.length, 1, "folded descendants stay out of the live editor DOM");
    const hiddenOperation = transactions.at(-1).redo.find(operation => operation.action === "insert");
    check.ok(hiddenOperation && hiddenOperation.action === "insert");
    check.match(hiddenOperation.data, /Hidden child/);
    check.equal(hiddenOperation.context.ignoreProcess, "true", "the complete hidden copy is persisted without replaying it visibly");
    const foldedOperations = transactions.at(-1);
    const convertedID = root.firstElementChild.getAttribute("data-node-id");
    const outside = add("Outside existing content");
    root.innerHTML = foldedOperations.undo.at(-1).data + blocks.get(outside);
    apply(foldedOperations.redo);
    check.deepEqual(Array.from(root.children, block => block.getAttribute("data-node-id")),
        [convertedID, hiddenOperation.id, outside], "folded-heading children must precede existing following content");
    apply(foldedOperations.undo);
    check.deepEqual(Array.from(root.children, block => block.getAttribute("data-node-id")), [convertedID, outside]);
    apply(foldedOperations.redo);
    check.deepEqual(Array.from(root.children, block => block.getAttribute("data-node-id")), [convertedID, hiddenOperation.id, outside]);

    const assertUnchanged = async (current: Element, references = false) => {
        const before = root.innerHTML;
        const count = transactions.length;
        await api.convertEmbed(owner, current, references);
        check.equal(root.innerHTML, before);
        check.equal(transactions.length, count);
    };
    node = embed([]);
    check.ok(api.embedConversionMenu(owner, node).slice(1).every((item: IMenu) => item.disabled));
    await assertUnchanged(node);
    node = embed([first, Lute.NewNodeID()]);
    await assertUnchanged(node);
    check.ok(messages.includes("Missing source"));
    failureID = first;
    node = embed([second, first]);
    await assertUnchanged(node);
    failureID = "";
    texts.set(first, "block not found");
    node = embed([first]);
    await api.convertEmbed(owner, node, true);
    check.equal(root.querySelector('[data-type="block-ref"]').textContent, "block not found", "valid content must not be treated as an error");
    texts.set(first, "First");
    node = embed([first]);
    owner.disabled = true;
    await assertUnchanged(node);
    owner.disabled = false;
    context = {allowChildOperation: false, targetElement: node};
    await assertUnchanged(node);
    context = undefined;
    owner.lite = true;
    await assertUnchanged(node);
    owner.lite = false;
    hook = () => { owner.block.rootID = "other-root"; };
    await assertUnchanged(node);
    hook = undefined;
    owner.block.rootID = "root";
    hook = () => { owner.disabled = true; };
    await assertUnchanged(node);
    hook = undefined;
    owner.disabled = false;

    node = embed([first]);
    const countBeforeEdit = transactions.length;
    hook = () => { node.setAttribute("data-content", "select * from blocks limit 1"); };
    await api.convertEmbed(owner, node, false);
    check.equal(transactions.length, countBeforeEdit);
    check.equal(node.getAttribute("data-content"), "select * from blocks limit 1");
    hook = undefined;

    node = embed([first]);
    let release: () => void;
    pending = new Promise(resolve => { release = resolve; });
    const count = transactions.length;
    const a = api.convertEmbed(owner, node, false);
    const b = api.convertEmbed(owner, node, true);
    release();
    await Promise.all([a, b]);
    check.equal(transactions.length, count + 1, "rapid repeated actions produce a single transaction");
    pending = Promise.resolve();

    node = embed([first]);
    owner.notebookId = "encrypted-notebook";
    const start = calls.length;
    await api.convertEmbed(owner, node, true);
    check.ok(calls.slice(start).every(call => call.data.notebook === "encrypted-notebook"));
    check.ok(oldHTML.includes("NodeBlockQueryEmbed"));
    return "Embed conversion cases passed";
};

test("embed conversion preserves content and order, supports undo, and guards unavailable or stale sources", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 90000,
}, async () => {
    const source = compile(readFileSync(path.join(__dirname, "embedConversion.ts"), "utf8"));
    const clear = createSourceFile("clear.ts", readFileSync(path.join(__dirname, "../util/clear.ts"), "utf8"), ScriptTarget.Latest, true);
    const helpers = compile(clear.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration =>
            ["clearViewState", "clearBlockElement"].includes(declaration.name.getText(clear))))
        .map(statement => statement.getText(clear)).join("\n")) +
        compile(readFileSync(path.join(__dirname, "../util/tabsCopy.ts"), "utf8")) +
        compile(readFileSync(path.join(__dirname, "../util/heading.ts"), "utf8"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-embed-conversion-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(helpers)})`)}));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 80000, windowsHide: true});
        assert.match(result.stdout, /Embed conversion cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-embed-conversion-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
