const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const compile = source => ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText;
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length);
        return compile(statements.map(statement => statement.getText(source)).join("\n").replace(/export const /g, "const "));
    };
    return {
        functions: [
            extract("block/util.ts", ["genEmptyElement", "genSBElement", "refreshSbResize", "rebalanceSbWidth", "refreshSbAndPersistWidth"]),
            extract("block/superBlock.ts", ["getSuperBlockCommand", "getSuperBlockCommandLayout", "getSuperBlockTailHeadings"]),
            extract("block/insertSuperBlock.ts", ["genEmptySuperBlock", "focusInsertedBlock", "insertSuperBlockChild", "createSuperBlockColumn"]),
            extract("protyle/wysiwyg/transaction.ts", ["turnsIntoOneTransaction"]),
            extract("protyle/util/selection.ts", ["focusByWbr", "focusByRange"]),
            extract("protyle/wysiwyg/getBlock.ts", ["getContenteditableElement", "getParentBlock"]),
            extract("mobile/util/keyboardToolbar.ts", ["getSlashItem", "renderSlashMenu"]),
        ].join("\n"),
        hint: compile(readFileSync(path.join(__dirname, "../src/protyle/hint/index.ts"), "utf8")),
    };
};

const cases = async source => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetSuperBlock(true);
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const Constants = {ZWSP: "\u200b", BLOCK_HINT_KEYS: ["(("], INLINE_TYPE: [],
        SIYUAN_RENDER_CODE_LANGUAGES: [], ATTRIBUTE_EDITING: "data-editing"};
    window.siyuan = {config: {editor: {spellcheck: false}}, storage: {},
        languages: {horizontalSuperBlock: "Horizontal super block", verticalSuperBlock: "Vertical super block"}};
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.dataset.nodeId = "doc";
    document.body.append(root);
    const style = document.createElement("style");
    style.textContent = '.sb[data-sb-layout="col"]{display:flex}.sb__resize{width:10px;margin:0 5px;flex:none}';
    document.head.append(style);
    const stored = document.createElement("div");
    stored.dataset.nodeId = "doc";
    const protyle = {lute, wysiwyg: {element: root}, block: {rootID: "doc"}, toolbar: {},
        options: {hint: {extend: [{key: "/", hint: () => []}]}, upload: {}}, app: {plugins: []}};
    let submitted = [];
    let keyboardRequests = 0;
    let mobile = false;
    const transaction = (_protyle, forward, backward) => submitted.push({forward, backward});
    const getEditorRange = () => protyle.toolbar.range;
    const deps = {
        Constants,
        transaction,
        getEditorRange,
        getUndoFocusContext: () => ({undoFocusId: "original"}),
        hideElements: () => root.querySelectorAll(".protyle-wysiwyg--select").forEach(node => node.classList.remove("protyle-wysiwyg--select")),
        scrollCenter: () => {},
        isMobile: () => mobile,
        restoreEditorFocusRange: (_element, range) => {
            check.ok(root.contains(range.startContainer));
            protyle.toolbar.range = range;
            return true;
        },
        callMobileAppShowKeyboard: () => keyboardRequests++,
        getEmbedChildOperationParentID: () => undefined,
        revealTabsForTarget: () => {},
        getSemanticMarkerPrefixLengthForNode: () => 0,
        hasPreviousSibling: node => node.previousSibling,
        hasClosestBlock: node => (node.nodeType === 1 ? node : node.parentElement).closest("[data-node-id]"),
        hasClosestByClassName: (node, name) => (node.nodeType === 1 ? node : node.parentElement).closest(`.${name}`),
        isProtyleListItemFragment: () => false,
        shouldCaptureHintUndoFocus: () => false,
        isBuiltinSlashHint: () => true,
        areProtylePluginExtensionsEnabled: () => false,
        getHostCapabilities: () => ({widgets: false, remoteKernel: true}),
        isDisabledFeature: () => true,
        isInAndroid: () => false,
        isBuiltinInlineStyleVisible: () => false,
        normalizeHTMLAssetIFrameBlockDOM: value => value,
        fetchSyncPost: async (url, data) => {
            check.equal(url, "/api/block/getBlockDOM");
            return {code: 0, data: {dom: stored.querySelector(`[data-node-id="${data.id}"]`).outerHTML}};
        },
        setFold: (_protyle, target) => {
            target.removeAttribute("fold");
            return {
                doOperations: [{action: "setAttrs", id: target.dataset.nodeId, data: '{"fold":""}'}],
                undoOperations: [{action: "setAttrs", id: target.dataset.nodeId, data: '{"fold":"1"}'}],
                ready: Promise.resolve(),
            };
        },
    };
    const api = new Function(...Object.keys(deps), source.functions + `
        const refreshSbs = element => {
            refreshSbResize(element);
            element.querySelectorAll('.sb').forEach(refreshSbResize);
        };
        return {insertSuperBlockChild, createSuperBlockColumn, getSuperBlockCommand, getSuperBlockCommandLayout,
            genEmptySuperBlock, renderSlashMenu, focusByWbr, focusByRange,
            getContenteditableElement};`)(...Object.values(deps));
    Object.assign(deps, api);
    deps.updateTransaction = (_protyle, element, previous) => transaction(protyle,
        [{action: "update", id: element.dataset.nodeId, data: element.outerHTML}],
        [{action: "update", id: element.dataset.nodeId, data: previous}]);
    const hintExports = {};
    new Function("require", "exports", source.hint)(() => deps, hintExports);
    const hint = Object.create(hintExports.Hint.prototype);
    const children = node => Array.from(node.children).filter(child => child.dataset.nodeId);
    const shape = node => children(node).map(child => ({
        id: child.dataset.nodeId, type: child.dataset.type, layout: child.dataset.sbLayout,
        style: child.getAttribute("style") || "", fold: child.getAttribute("fold") || "",
        text: child.querySelector(":scope > [contenteditable]")?.textContent.replace(/\u200b/g, ""),
        children: shape(child),
    }));
    const find = id => id === "doc" ? stored : stored.querySelector(`[data-node-id="${id}"]`);
    const headingGroups = new Map();
    const replay = operations => operations.forEach(operation => {
        const node = find(operation.id);
        if (operation.action === "delete") {
            check.ok(node, `Missing deletion target ${operation.id}`);
            node.remove();
        } else if (operation.action === "foldHeading" || operation.action === "unfoldHeading") {
            if (operation.action === "foldHeading") {
                node.setAttribute("fold", "1");
            } else {
                node.removeAttribute("fold");
            }
        } else if (operation.action === "setAttrs") {
            Object.entries(JSON.parse(operation.data)).forEach(([name, value]) => value ?
                node.setAttribute(name, value) : node.removeAttribute(name));
        } else if (operation.action === "update") {
            node.outerHTML = lute.SpinBlockDOM(operation.data);
        } else {
            let moving = node;
            if (operation.action !== "move") {
                const template = document.createElement("template");
                template.innerHTML = lute.SpinBlockDOM(operation.data);
                moving = template.content.firstElementChild;
            }
            // 重放内核记录的折叠标题移动集合，验证隐藏内容不会成为独立分栏或丢失。
            let group = [];
            if (operation.action === "move" && moving.dataset.type === "NodeHeading" && moving.getAttribute("fold") === "1") {
                if (!headingGroups.has(operation.id)) {
                    let next = moving.nextElementSibling;
                    const ids = [];
                    while (next?.dataset.nodeId && next.dataset.type !== "NodeHeading") {
                        ids.push(next.dataset.nodeId);
                        next = next.nextElementSibling;
                    }
                    headingGroups.set(operation.id, ids);
                }
                group = headingGroups.get(operation.id).map(find);
            }
            if (operation.action === "appendInsert") {
                find(operation.parentID).lastElementChild.before(moving);
            } else if (operation.action === "prependInsert") {
                find(operation.parentID).prepend(moving);
            } else if (operation.nextID) {
                find(operation.nextID).before(moving);
            } else if (operation.previousID) {
                find(operation.previousID).after(moving);
            } else {
                find(operation.parentID).prepend(moving);
            }
            let previous = moving;
            group.forEach(child => { previous.after(child); previous = child; });
        }
    });
    const select = node => {
        const range = document.createRange();
        range.selectNodeContents(node.querySelector("[contenteditable=true]") || node);
        range.collapse(true);
        protyle.toolbar.range = range;
        api.focusByRange(range);
    };
    const reset = markdown => {
        root.innerHTML = lute.Md2BlockDOM(markdown);
        submitted = [];
        headingGroups.clear();
        select(root.firstElementChild);
    };
    const capture = () => {
        stored.innerHTML = root.innerHTML;
        return shape(stored);
    };
    const verifyReplay = (before, hasHiddenContent = false) => {
        check.equal(submitted.length, 1, "one action must use one undo step");
        const {forward, backward} = submitted[0];
        replay(forward);
        const after = shape(stored);
        if (!hasHiddenContent) {
            check.deepEqual(after, shape(root), "persisted structure matches the displayed blocks");
        }
        replay(backward);
        check.deepEqual(shape(stored), before, "undo restores IDs, order, content, and widths");
        replay(forward);
        check.deepEqual(shape(stored), after, "redo restores the same layout");
        return after;
    };
    for (const layout of ["col", "row"]) {
        for (const position of ["start", "end"]) {
            for (mobile of [false, true]) {
                reset(`{{{${layout}\nA\n\n{{{row\nB\n\nC\n}}}\n\n> Quote\n}}}`);
                const target = root.firstElementChild;
                children(target)[0].style.cssText = "width:calc(60% - 10px);flex:none;color:red";
                children(target)[1].style.cssText = "width:calc(30% - 10px);flex:none";
                const ids = children(target).map(node => node.dataset.nodeId);
                const before = capture();
                const keyboardsBefore = keyboardRequests;
                await api.insertSuperBlockChild(protyle, target, position);
                check.equal(children(target).length, 4);
                const added = children(target)[position === "start" ? 0 : 3];
                check.equal(added.dataset.type, "NodeParagraph");
                check.deepEqual(children(target).filter(node => node !== added).map(node => node.dataset.nodeId), ids);
                check.ok(added.contains(getSelection().focusNode));
                check.equal(keyboardRequests - keyboardsBefore, Number(mobile));
                verifyReplay(before);
            }
        }
    }
    for (const position of ["left", "right"]) {
        for (const content of ["B", "> Quote", "{{{row\nInner A\n\nInner B\n}}}", "{{{col\nInner A\n\nInner B\n}}}", "## Heading"]) {
            reset(`{{{col\n{{{row\nA\n\n${content}\n\nC\n}}}\n\nOutside\n}}}`);
            const outer = root.firstElementChild;
            const vertical = children(outer)[0];
            const target = children(vertical)[1];
            const originalID = target.dataset.nodeId;
            const originalParentID = vertical.dataset.nodeId;
            select(target);
            const before = capture();
            await api.createSuperBlockColumn(protyle, target, position);
            check.equal(children(outer).length, 2, "outer columns remain unchanged");
            check.equal(children(vertical).length, 3);
            const horizontal = children(vertical)[1];
            check.equal(horizontal.dataset.sbLayout, "col");
            check.equal(children(horizontal).length, 2);
            check.equal(children(horizontal)[position === "left" ? 1 : 0].dataset.nodeId, originalID);
            check.equal(horizontal.parentElement.dataset.nodeId, originalParentID);
            const added = children(horizontal)[position === "left" ? 0 : 1];
            check.ok(added.contains(getSelection().focusNode));
            verifyReplay(before);
        }
        reset("{{{row\nA\n\n## Folded\n\nHidden\n\n## Boundary\n}}}");
        const target = children(root.firstElementChild)[1];
        target.setAttribute("fold", "1");
        const hidden = children(root.firstElementChild)[2];
        const before = capture();
        hidden.remove();
        select(target);
        await api.createSuperBlockColumn(protyle, target, position);
        verifyReplay(before, true);
        const persistedHeading = find(target.dataset.nodeId);
        check.equal(persistedHeading.parentElement.dataset.sbLayout, "row");
        check.equal(find(hidden.dataset.nodeId).parentElement, persistedHeading.parentElement);
        check.equal(children(persistedHeading.parentElement.parentElement).length, 2);
    }
    reset("{{{row\n## Folded\n\n### Nested folded\n\nHidden\n}}}");
    const target = root.firstElementChild;
    children(target)[0].setAttribute("fold", "1");
    const nestedHeading = children(target)[1];
    nestedHeading.setAttribute("fold", "1");
    const beforeHiddenAppend = capture();
    children(target).slice(1).forEach(child => child.remove());
    await api.insertSuperBlockChild(protyle, target, "end");
    verifyReplay(beforeHiddenAppend, true);
    check.equal(children(find(target.dataset.nodeId)).at(-1).dataset.type, "NodeParagraph");
    check.equal(children(find(target.dataset.nodeId))[2].textContent.replace(/\u200b/g, ""), "Hidden");
    check.notEqual(children(find(target.dataset.nodeId))[0].getAttribute("fold"), "1");
    check.notEqual(find(nestedHeading.dataset.nodeId).getAttribute("fold"), "1");
    reset("{{{row\n## Folded\n\nHidden\n\n## Boundary\n\nVisible\n}}}");
    const bounded = root.firstElementChild;
    const earlierHeading = children(bounded)[0];
    earlierHeading.setAttribute("fold", "1");
    const beforeBoundary = capture();
    children(bounded)[1].remove();
    await api.insertSuperBlockChild(protyle, bounded, "end");
    verifyReplay(beforeBoundary, true);
    check.equal(find(earlierHeading.dataset.nodeId).getAttribute("fold"), "1", "unrelated folded sections stay folded");
    reset("{{{row\nA\n\nB\n}}}");
    const folded = root.firstElementChild;
    folded.setAttribute("fold", "1");
    const beforeUnfold = capture();
    await api.insertSuperBlockChild(protyle, folded, "end");
    check.notEqual(folded.getAttribute("fold"), "1");
    check.ok(children(folded).at(-1).contains(getSelection().focusNode));
    verifyReplay(beforeUnfold);
    for (const layout of ["col", "row"]) {
        for (const text of ["/", "before / after"]) {
            for (const container of ["document", "list", "quote", "super", "lite"]) {
                protyle.lite = container === "lite";
                const markdown = container === "list" ? `- ${text}` : container === "quote" ? `> ${text}` :
                    container === "super" ? `{{{row\n${text}\n\nOther\n}}}` : text;
                reset(markdown);
                const paragraph = root.querySelector('[data-type="NodeParagraph"]');
                paragraph.setAttribute("custom-test", "preserved");
                paragraph.style.color = "red";
                const editable = paragraph.querySelector("[contenteditable=true]");
                const range = document.createRange();
                range.setStart(editable.firstChild, text.indexOf("/") + 1);
                range.collapse(true);
                protyle.toolbar.range = range;
                api.focusByRange(range);
                hint.splitChar = "/";
                hint.lastIndex = text.indexOf("/");
                const before = capture();
                hint.fill(api.getSuperBlockCommand(layout), protyle, false);
                const created = Array.from(root.querySelectorAll(".sb")).find(node =>
                    children(node).length === 2 && children(node).every(child => child.dataset.type === "NodeParagraph" &&
                        child.textContent.replace(/\u200b/g, "") === ""));
                check.ok(created, `two empty paragraphs: ${layout}, ${text}, ${container}: ${root.innerHTML}`);
                check.equal(created.dataset.sbLayout, layout);
                if (text === "/") {
                    check.equal(created.getAttribute("custom-test"), "preserved");
                    check.equal(created.style.color, "red");
                }
                check.ok(children(created)[0].contains(getSelection().focusNode));
                if (text !== "/") {
                    check.ok(root.textContent.includes("before  after"));
                }
                verifyReplay(before);
                check.equal(new Set(Array.from(root.querySelectorAll("[data-node-id]")).map(node => node.dataset.nodeId)).size,
                    root.querySelectorAll("[data-node-id]").length);
            }
        }
    }
    protyle.lite = false;
    hint.bindUploadEvent = () => {};
    protyle.hint = hint;
    const toolbar = document.createElement("div");
    toolbar.innerHTML = '<div class="keyboard__util"></div>';
    api.renderSlashMenu(protyle, toolbar);
    for (const layout of ["col", "row"]) {
        const button = Array.from(toolbar.querySelectorAll("button")).find(item =>
            decodeURIComponent(item.dataset.value) === api.getSuperBlockCommand(layout));
        check.ok(button);
        check.equal(button.dataset.focus, "true", "mobile insertion restores keyboard focus");
        reset("\u200b");
        const before = capture();
        hint.fill(decodeURIComponent(button.dataset.value), protyle, false);
        check.equal(root.firstElementChild.dataset.sbLayout, layout);
        check.equal(children(root.firstElementChild).length, 2);
        check.ok(children(root.firstElementChild)[0].contains(getSelection().focusNode));
        verifyReplay(before);
    }
    const unchanged = root.innerHTML;
    submitted = [];
    protyle.disabled = true;
    await api.insertSuperBlockChild(protyle, root.querySelector(".sb"), "start");
    await api.createSuperBlockColumn(protyle, root.querySelector(".sb [data-node-id]"), "left");
    check.equal(root.innerHTML, unchanged);
    check.equal(submitted.length, 0);
    return "Super block creation cases passed";
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname,
            "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(async () => { try {
            return await (${cases.toString()})(${JSON.stringify(sources())});
        } catch (error) { return error.stack; } })()`);
        assert.equal(result, "Super block creation cases passed");
        console.log(result);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("super block insertion and slash creation preserve nested content, focus, undo and redo", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-super-block-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Super block creation cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
