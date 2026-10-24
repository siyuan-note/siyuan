const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const read = file => ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
        ts.ScriptTarget.Latest, true);
    const compile = code => ts.transpileModule(code.replace(/export const /g, "const "), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
    const extract = (file, names) => {
        const source = read(file);
        const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(statements.length, names.length);
        return compile(statements.map(statement => statement.getText(source)).join("\n"));
    };
    const source = read("protyle/util/editorCommonEvent.ts");
    const dropBranches = [];
    const externalDropBranches = [];
    const visit = node => {
        if (ts.isIfStatement(node) && node.expression.getText(source) === "sourceElements.length > 0") {
            dropBranches.push(node.thenStatement.getText(source));
        }
        if (ts.isIfStatement(node) && node.expression.getText(source).startsWith("!window.siyuan.dragElement &&")) {
            externalDropBranches.push(node.thenStatement.getText(source));
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(dropBranches.length, 1);
    assert.equal(externalDropBranches.length, 1);
    return {
        externalDrop: compile(`async function externalDrop(protyle, event) ${externalDropBranches[0]}`),
        uploadCapture: [
            extract("protyle/upload/index.ts", ["captureUploadInsertPosition"]),
            extract("protyle/upload/insertPosition.ts", ["captureUploadDocument", "createUploadInsertPosition"]),
        ].join("\n"),
        rangeByPoint: extract("protyle/util/selection.ts", ["getRangeByPoint"]),
        drop: compile(`async function drop(protyle, sourceElements, targetElement, targetClass, gutterTypes, event, isCopyDrag) {
            const editorElement = protyle.wysiwyg.element;
            let dragoverElement;
            ${dropBranches[0]}
        }`),
        actions: [
            extract("protyle/util/editorCommonEvent.ts", ["getTargetListItem", "getDragSourceParentID",
                "getDragSourceNextID", "moveTo", "dragSame"]),
            extract("protyle/util/dragDocument.ts", ["isSameDragEditor", "isDragTargetInSource", "isSameSiblingMove",
                "getSameSuperBlockEdgeTarget", "shouldKeepListBlockDragTarget"]),
            extract("protyle/util/foldHeadingMove.ts", ["isFoldedHeading", "getHeadingLevel", "shouldUnfoldMovedHeading"]),
            extract("protyle/wysiwyg/getBlock.ts", ["getParentBlock", "getPreviousBlockSibling", "getNextBlockSibling",
                "getTopAloneElement", "getSbChildBlockCount"]),
        ].join("\n"),
    };
};

const cases = async source => {
    const check = require("node:assert/strict");
    const lute = window.Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const protyle = {lute, wysiwyg: {element: root}, block: {rootID: "doc"}};
    let transaction;
    const api = new Function("transaction", "focusBlock", source.actions +
        "; return {dragSame, getTargetListItem, shouldKeepListBlockDragTarget, getSameSuperBlockEdgeTarget};")(
        (_protyle, forward, backward) => { transaction = {forward, backward}; }, () => {});
    let route;
    let pending;
    let execute = false;
    const drop = new Function("dragSame", "dragSb", "getTargetListItem", "shouldKeepListBlockDragTarget",
        "getSameSuperBlockEdgeTarget", source.drop + "; return drop;")(
        (...args) => {
            route = {kind: "same", sources: [...args[1]], target: args[2], bottom: args[3], copy: args[4]};
            if (execute) {
                pending = api.dragSame(...args);
                return pending;
            }
        }, (...args) => { route = {kind: "super", sources: [...args[1]], target: args[2]}; },
        api.getTargetListItem, api.shouldKeepListBlockDragTarget, api.getSameSuperBlockEdgeTarget);
    const makeList = markdown => {
        const template = document.createElement("template");
        template.innerHTML = lute.Md2BlockDOM(markdown);
        return template.content.firstElementChild;
    };
    const setup = (markdown, placement) => {
        root.replaceChildren();
        const target = makeList(markdown);
        const moving = makeList(markdown);
        moving.setAttribute("name", "source-list");
        moving.setAttribute("custom-test", "preserved");
        target.setAttribute("name", "target-list");
        const gap = document.createElement("div");
        gap.dataset.nodeId = "gap";
        gap.dataset.type = "NodeParagraph";
        if (placement === "end") {
            root.append(moving, gap, target);
        } else if (placement === "middle") {
            root.append(gap, target, moving);
        } else {
            root.append(target, moving);
        }
        route = undefined;
        transaction = undefined;
        pending = undefined;
        return {target, moving};
    };
    const run = async (moving, target, indicator, copy = false) => {
        await drop(protyle, [moving], target, [indicator],
            [moving.dataset.type.toLowerCase()], {ctrlKey: copy}, copy);
        await pending;
    };
    // 执行真实 drop 分支及移动事务，验证首尾和中间落点的列表边界、属性、编号与撤销重做。
    for (const markdown of ["1. One\n   1. Nested\n2. Two", "- One\n  - Nested\n- Two", "- [ ] One\n- [x] Two"]) {
        for (const placement of ["start", "middle", "end"]) {
            const {target, moving} = setup(markdown, placement);
            const before = root.innerHTML;
            const movingHTML = moving.outerHTML;
            const targetHTML = target.outerHTML;
            execute = false;
            const indicator = placement === "end" ? "dragover__bottom" : "dragover__top";
            await run(moving, target, indicator);
            check.deepEqual(route.sources, [moving], "a block boundary must retain the source list");
            check.equal(route.target, target, "a block boundary must retain the target list");
            execute = true;
            await run(moving, target, indicator);
            check.equal(moving.outerHTML, movingHTML);
            check.equal(target.outerHTML, targetHTML);
            check.equal(root.querySelectorAll(":scope > .list").length, 2);
            check.equal(placement === "end" ? target.nextElementSibling : target.previousElementSibling, moving);
            check.equal(transaction.forward.length, 1);
            check.equal(transaction.forward[0].id, moving.dataset.nodeId);
            check.equal(transaction.forward[0].action, "move");
            const after = root.innerHTML;
            const replay = operations => operations.forEach(operation => {
                check.equal(operation.action, "move");
                const find = id => id === "doc" ? root : root.querySelector(`[data-node-id="${id}"]`);
                const node = find(operation.id);
                if (operation.nextID) {
                    find(operation.nextID).before(node);
                } else if (operation.previousID) {
                    find(operation.previousID).after(node);
                } else {
                    find(operation.parentID).prepend(node);
                }
            });
            for (let repeat = 0; repeat < 2; repeat++) {
                replay(transaction.backward);
                check.equal(root.innerHTML, before);
                replay(transaction.forward);
                check.equal(root.innerHTML, after);
            }
        }
    }
    execute = false;
    for (const copy of [false, true]) {
        for (const indicator of ["dragover__top", "dragover__bottom"]) {
            const {target, moving} = setup("- One\n- Two", "start");
            await run(moving, target, indicator, copy);
            check.deepEqual(route.sources, [moving]);
            check.equal(route.target, target);
            check.equal(route.copy, copy);
        }
    }
    // 列表项落点仍展开源列表，保留原有同级合并与子级嵌套语义。
    for (const indicator of ["dragover__top--sibling", "dragover__bottom--sibling", "dragover__bottom--child"]) {
        const {target, moving} = setup("- One\n- Two", "start");
        const targetItem = target.querySelector(".li");
        await run(moving, targetItem, indicator);
        check.deepEqual(route.sources, Array.from(moving.querySelectorAll(":scope > .li")));
        check.equal(route.target, indicator.endsWith("--child") ? targetItem.querySelector(".p") : targetItem);
    }
    for (const indicator of ["dragover__top", "dragover__bottom"]) {
        const {target, moving} = setup("- One\n- Two", "start");
        const sourceItem = moving.querySelector(".li");
        await run(sourceItem, target, indicator);
        check.deepEqual(route.sources, [sourceItem]);
        const items = target.querySelectorAll(":scope > .li");
        check.equal(route.target, items[indicator === "dragover__top" ? 0 : items.length - 1]);
    }
    for (const indicator of ["dragover__left", "dragover__right"]) {
        const {target, moving} = setup("- One\n- Two", "start");
        await run(moving, target, indicator);
        check.equal(route.kind, "super");
        check.deepEqual(route.sources, [moving]);
        check.equal(route.target, target);
    }
    // 拖入位置和原光标位于不同段落，上传异步完成前再次移动光标也不能改变落点。
    for (const altKey of [false, true]) {
        root.innerHTML = '<div contenteditable="true">11111111</div><div contenteditable="true">22222222</div>';
        const [first, second] = root.children;
        const oldRange = document.createRange();
        oldRange.setStart(second.firstChild, 8);
        oldRange.collapse(true);
        protyle.toolbar = {range: oldRange};
        const pointRange = document.createRange();
        pointRange.setStart(first.firstChild, 4);
        pointRange.collapse(true);
        const rect = pointRange.getBoundingClientRect();
        let captured;
        let isUpload;
        const getEditorRange = () => document.getSelection().getRangeAt(0);
        const focusByRange = range => {
            document.getSelection().removeAllRanges();
            document.getSelection().addRange(range);
        };
        focusByRange(oldRange);
        const capture = new Function("getEditorRange", "getUndoFocusContext", source.uploadCapture +
            "; return captureUploadInsertPosition;")(getEditorRange, () => ({}));
        const getRangeByPoint = new Function("hasClosestByAttribute", "hasClosestByClassName", source.rangeByPoint +
            "; return getRangeByPoint;")(() => false, () => false);
        const externalDrop = new Function("hasClosestByClassName", "focusByRange", "getRangeByPoint", "isBrowser",
            "getHostCapabilities", "getLocalDropFiles", "webUtils", "uploadLocalFiles", "clearSelect", "window",
            source.externalDrop + "; return externalDrop;")(
            () => false, focusByRange, getRangeByPoint, () => false, () => ({localFileSystem: true}),
            () => [{path: "/attachment.md", size: 1}], {}, (_files, owner, upload, options) => {
                isUpload = upload;
                captured = capture(owner, options);
            }, () => {}, {siyuan: {config: {editor: {dragHTMLFileToIframe: false}}}});
        await externalDrop(protyle, {clientX: rect.left, clientY: rect.top + rect.height / 2, altKey,
            dataTransfer: {types: ["Files"], files: []}, preventDefault() {}});
        check.equal(isUpload, !altKey);
        check.equal(captured.source, "drop");
        check.equal(captured.insertPosition.range.startContainer, first.firstChild,
            "file uploads must capture the mouse drop location instead of the toolbar's old range");
        check.equal(captured.insertPosition.range.startOffset, 4);
        focusByRange(oldRange);
        check.equal(captured.insertPosition.range.startContainer, first.firstChild);
        check.equal(captured.insertPosition.range.startOffset, 4);
    }
    root.remove();
    return "List and external file drop cases passed";
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
        assert.equal(result, "List and external file drop cases passed");
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
    require("node:test").test("editor drops preserve list boundaries, undo/redo, and external file insertion positions", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-list-drop-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /List and external file drop cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
