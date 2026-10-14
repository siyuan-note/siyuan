const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const read = file => readFileSync(path.join(__dirname, "../src", file), "utf8");
    const parsed = ts.createSourceFile("transaction.ts", read("protyle/wysiwyg/transaction.ts"), ts.ScriptTarget.Latest, true);
    const statements = parsed.statements.filter(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration =>
            ["turnsIntoTransaction", "turnsIntoOneTransaction"].includes(declaration.name.getText(parsed))));
    assert.equal(statements.length, 2);
    return ts.transpileModule((read("protyle/toolbar/blockTypeCore.ts") + "\n" +
        statements.map(statement => statement.getText(parsed)).join("\n")).replace(/^export /gm, ""),
    {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
};

const browserCases = async source => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetSuperBlock(true);
    lute.SetDataTask(true);
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.dataset.nodeId = "doc";
    document.body.append(editor);
    const batches = [];
    const noop = () => {};
    const dependencies = {
        Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
        transaction: (_protyle, forward, backward) => batches.push({forward, backward}),
        hideElements: noop, processRender: noop, highlightRender: noop, avRender: noop, blockRender: noop,
        disposeCustomBlocksInElement: noop, focusBlock: noop, focusByWbr: noop, refreshSbs: noop,
        getPreviousBlockSibling: node => node.previousElementSibling,
        getNextBlockSibling: node => node.nextElementSibling,
        getParentBlock: node => node.parentElement.matches(".callout-content, .tab-item-content") ?
            node.parentElement.parentElement : node.parentElement,
        getEmbedChildOperationParentID: () => undefined,
        getSbChildBlockCount: node => node.querySelectorAll(":scope > [data-node-id]").length,
        isListHeadingContainer: () => false,
        cancelSB: () => { throw new Error("The unselected superblock must not be cancelled"); },
    };
    const api = new Function(...Object.keys(dependencies), source +
        "\nreturn {turnsIntoTransaction, turnsIntoOneTransaction, getTextSelectionBlock, getBlockTypeOptions};")(...Object.values(dependencies));
    window.siyuan = {config: {editor: {spellcheck: false}}};
    const protyle = {lute, wysiwyg: {element: editor}, block: {rootID: "doc", parentID: "doc"},
        observerLoad: {disconnect: noop}};
    const find = id => id === "doc" ? editor : editor.querySelector(`[data-node-id="${id}"]`);
    const replay = operations => operations.forEach(operation => {
        let node = find(operation.id);
        if (operation.action === "delete") { node.remove(); return; }
        if (operation.action === "update") { node.outerHTML = operation.data; return; }
        if (operation.action === "insert") {
            const template = document.createElement("template");
            template.innerHTML = operation.data;
            node = template.content.firstElementChild;
        } else {
            check.equal(operation.action, "move");
        }
        if (operation.nextID) {
            find(operation.nextID).before(node);
        } else if (operation.previousID) {
            find(operation.previousID).after(node);
        } else {
            let parent = find(operation.parentID);
            parent = parent.querySelector(":scope > .callout-content, :scope > .tab-item-content") || parent;
            const first = parent.querySelector(":scope > [data-node-id]");
            if (first) { first.before(node); }
            else if (parent.lastElementChild?.classList.contains("protyle-attr")) { parent.lastElementChild.before(node); }
            else { parent.append(node); }
        }
    });
    const shape = () => Array.from(editor.querySelectorAll("[data-node-id]")).map(node => ({
        attributes: Array.from(node.attributes).filter(attr => attr.name !== "data-editing")
            .map(attr => [attr.name, attr.value]).sort(),
        parent: node.parentElement.closest("[data-node-id]")?.dataset.nodeId,
        text: node.textContent,
    }));
    const actions = [["NodeParagraph", "heading2"], ["NodeHeading", "paragraph"], ["NodeHeading", "heading3"],
        ...["list", "orderedList", "check", "quote", "callout"].map(key => ["NodeParagraph", key])];
    for (const parentType of ["root", "NodeListItem", "NodeBlockquote", "NodeCallout", "NodeTabItem", "NodeSuperBlock"]) {
        for (const [sourceType, key] of actions) {
            batches.length = 0;
            editor.innerHTML = "";
            let parent = editor;
            if (parentType !== "root") {
                parent = document.createElement("div");
                parent.dataset.type = parentType;
                parent.dataset.nodeId = "parent";
                parent.setAttribute("custom-test", "keep-parent");
                if (parentType === "NodeSuperBlock") { parent.className = "sb"; parent.dataset.sbLayout = "row"; }
                if (parentType === "NodeListItem") {
                    parent.className = "li";
                    parent.dataset.subtype = "u";
                    const list = document.createElement("div");
                    list.className = "list";
                    list.dataset.type = "NodeList";
                    list.dataset.subtype = "u";
                    list.dataset.nodeId = "outer-list";
                    list.setAttribute("custom-test", "keep-list");
                    editor.append(list);
                    list.append(parent);
                } else {
                    editor.append(parent);
                }
                if (["NodeCallout", "NodeTabItem"].includes(parentType)) {
                    const content = document.createElement("div");
                    content.className = parentType === "NodeCallout" ? "callout-content" : "tab-item-content";
                    parent.append(content);
                    parent = content;
                }
            }
            parent.innerHTML = lute.Md2BlockDOM("Before\n\n" + (sourceType === "NodeHeading" ? "## " : "") +
                "Selected **words** with remaining content\n\nAfter");
            const blocks = parent.querySelectorAll(":scope > [data-node-id]");
            const block = blocks[1];
            block.setAttribute("custom-test", "keep-target");
            blocks[0].setAttribute("custom-test", "keep-sibling");
            const targetID = block.dataset.nodeId;
            const parentElement = block.parentElement;
            const siblings = [blocks[0].outerHTML, blocks[2].outerHTML];
            const before = shape();
            const range = document.createRange();
            range.setStart(block.firstElementChild.firstChild, 1);
            range.setEnd(block.firstElementChild.firstChild, 5);
            check.equal(api.getTextSelectionBlock({editor, range, disabled: false, lite: false}), block);
            const option = api.getBlockTypeOptions(block).find(item => item.key === key);
            check.equal(option.disabled, false, parentType + " " + key);
            const options = {protyle, selectsElement: [block], type: option.type, level: option.level};
            if (["Blocks2Ps", "Blocks2Hs"].includes(option.type)) { api.turnsIntoTransaction(options); }
            else { await api.turnsIntoOneTransaction(options); }
            check.equal(batches.length, 1);
            check.ok(find(targetID), "keep the content block ID");
            check.equal(find(targetID).getAttribute("custom-test"), "keep-target");
            check.equal(parentElement.firstElementChild.outerHTML, siblings[0]);
            check.equal(parentElement.lastElementChild.outerHTML, siblings[1]);
            if (parentType !== "root") {
                check.equal(find("parent").dataset.type, parentType);
                check.equal(find("parent").getAttribute("custom-test"), "keep-parent");
                check.equal(batches[0].forward.some(operation => operation.id === "parent"), false);
                check.equal(batches[0].backward.some(operation => operation.id === "parent"), false);
            }
            const after = shape();
            replay(batches[0].backward);
            check.deepEqual(shape(), before, parentType + " " + key + " undo");
            replay(batches[0].forward);
            check.deepEqual(shape(), after, parentType + " " + key + " redo");
        }
    }
    editor.innerHTML = '<div data-node-id="parent" data-type="NodeSuperBlock" class="sb">' + lute.Md2BlockDOM("Only child") + "</div>";
    const child = editor.querySelector(".sb > [data-node-id]");
    const before = editor.innerHTML;
    for (const key of ["list", "orderedList", "check", "quote", "callout"]) {
        check.equal(api.getBlockTypeOptions(child).find(item => item.key === key).disabled, true);
    }
    check.equal(editor.innerHTML, before, "capability checks must not mutate DOM");
    editor.remove();
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        await win.webContents.executeJavaScript(`(${browserCases.toString()})(${JSON.stringify(sources())})`);
        console.log("Block type conversion and undo cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("real Lute preserves block IDs, content and custom attributes across paragraph and heading types", () => {
        require("../stage/protyle/js/lute/lute.min.js");
        const lute = globalThis.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        lute.SetKramdownIAL(true);
        const paragraph = lute.Md2BlockDOM("Selected **words** and remaining content").replace("<div ", '<div custom-test="keep" ');
        const id = paragraph.match(/data-node-id="([^"]+)"/)[1];
        for (let level = 1; level <= 6; level++) {
            const heading = lute.Blocks2Hs(paragraph, level);
            assert.ok(heading.includes(`data-node-id="${id}"`));
            assert.ok(heading.includes(`data-subtype="h${level}"`));
            const restored = lute.Blocks2Ps(heading);
            for (const result of [heading, restored]) {
                assert.ok(result.includes('custom-test="keep"'));
                assert.ok(result.includes(`data-node-id="${id}"`));
                assert.ok(result.includes('Selected <span data-type="strong">words</span> and remaining content'));
            }
            assert.ok(restored.includes('data-type="NodeParagraph"'));
        }
    });
    require("node:test").it("loads the real conversion functions used by the DOM integration cases", () => {
        assert.match(sources(), /const turnsIntoTransaction/);
        assert.match(sources(), /const turnsIntoOneTransaction/);
    });
    require("node:test").it("converts the selected text block using real Lute transactions with undo and redo", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-block-type-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Block type conversion and undo cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-block-type-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
