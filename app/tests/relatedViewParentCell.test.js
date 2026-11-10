const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = mobile => {
    const ts = require("typescript");
    const {parse} = require("ifdef-loader/preprocessor");
    const root = path.join(__dirname, "../src/protyle/render/av");
    return Object.fromEntries(["relation", "cell", "cellValue", "batchValue", "dragFillValue", "host", "subItems",
        "capabilities", "capabilities.generated"].map(name => [name,
        ts.transpileModule(parse(readFileSync(path.join(root, name + ".ts"), "utf8"), {MOBILE: mobile, BROWSER: !mobile}), {
            compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
        }).outputText]));
};

const cases = async (compiled, mobile) => {
    const check = require("node:assert/strict");
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const calls = [], messages = [], candidates = [], creations = [];
    const modules = {};
    let settle;
    const languages = new Proxy({_attrView: {relatedDatabaseViewUnavailable: "Unavailable"}},
        {get: (object, key) => object[key] || String(key)});
    window.siyuan = {config: {readonly: false}, languages};
    window.Lute = {NewNodeID: () => "pending-item"};
    const deps = {
        Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
        hasClosestBlock: node => node?.closest("[data-node-id]"),
        hasClosestByClassName: (node, name) => node?.closest("." + name),
        getFieldIdByCellElement: cell => cell.closest(".av__row").dataset.id,
        getColId: cell => cell.dataset.colId,
        getAVFilteredTipContext: () => ({type: "target"}),
        isTableLikeView: view => view === "table", isMobile: () => mobile,
        objEquals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        getFieldsByData: data => data.view.columns,
        getAVColumnTextMeasurer: () => () => 40,
        getAVTableFitWidths: () => ({}), getAVRelationColumnWidth: () => "240px",
        bindRelationLayout: () => Object.assign(() => {}, {close() {}}),
        escapeAttr: value => value || "", escapeHtml: value => value || "", escapeHtmlTextAndAttr: value => value || "",
        getTopBarHeight: () => 0,
        fetchPost: (url, payload, callback, _headers, _error, signal) => new Promise(resolve => {
            check.equal(url, "/api/av/getAttributeViewRelationCandidates");
            candidates.push({payload, complete: response => { callback(response); resolve(); }});
            signal?.addEventListener("abort", resolve, {once: true});
        }),
        fetchSyncPost: (url, payload) => new Promise((resolve, reject) => {
            check.equal(url, "/api/av/createAttributeViewRelationItem");
            creations.push({payload, resolve, reject});
        }),
        fetchWithDocumentSelection: (submit, options) => options.isValid() ? submit(undefined) : Promise.resolve(null),
        showMessage: message => messages.push(message),
        transaction: (editor, forward, undo, options) => {
            const scopedForward = modules.host.prepareAVHostTransaction(editor, forward);
            const scopedUndo = modules.host.prepareAVHostTransaction(editor, undo);
            check.ok(scopedForward && scopedUndo, "parent cell commands must pass the actual host capability gate");
            calls.push({forward: scopedForward, undo: scopedUndo, options});
            if (options?.awaitResponse) return new Promise((resolve, reject) => { settle = {resolve, reject}; });
        },
        updateAttrViewCellAnimation: () => check.fail("a parent cell cannot optimistically redraw before the transaction result"),
    };
    const imports = new Proxy(deps, {get: (object, key) => key in object ? object[key] : () => undefined});
    const load = name => {
        if (modules[name]) return modules[name];
        const exports = modules[name] = {};
        new Function("require", "exports", compiled[name])(specifier => {
            const key = specifier.replace(/^\.\//, "");
            return compiled[key] ? load(key) : imports;
        }, exports);
        return exports;
    };
    Object.keys(compiled).forEach(load);
    const context = {sourceAvID: "source", sourceItemID: "source-entry", relationKeyID: "source-relation"};
    const mount = (related = true, selected = false, batch = "replace", count = 1) => {
        const block = document.createElement("div");
        block.dataset.avId = "target"; block.dataset.avType = "table";
        block.innerHTML = '<div class="av__body" data-group-id="group"></div>';
        const original = [];
        for (let index = 0; index < count; index++) {
            const row = document.createElement("div"); row.className = "av__row"; row.dataset.id = "member-" + index;
            const cell = document.createElement("div"); cell.className = "av__cell";
            cell.dataset.colId = "target-parent"; cell.dataset.dtype = "relation"; cell.dataset.id = "value-" + index;
            const value = {type: "relation", id: cell.dataset.id, keyID: cell.dataset.colId, blockID: row.dataset.id,
                relation: {blockIDs: ["old-parent-" + index], contents: [{type: "block", block: {content: "Old"}, isDetached: true}]}};
            cell.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
            cell.dataset.avBatchMode = batch;
            original.push(cell.dataset.cellValue);
            row.append(cell); block.firstElementChild.append(row);
        }
        const panel = document.createElement("div"); panel.className = "av__panel";
        panel.innerHTML = `<div class="b3-menu"><div class="av__relation" data-sub-items-parent="true">
<button class="b3-menu__item" data-row-id="new-parent" data-relation-type="${selected ? "selected" : "candidate"}"><span class="b3-menu__label" data-content="New">New</span></button></div></div>`;
        document.body.append(block, panel);
        const owner = {disabled: false, options: {}, id: "editor", app: {appId: "app"}, block: {rootID: "source-doc"}};
        const host = {relationContext: context, sourceBlockID: "source-carrier", viewID: "view", temporaryFilters: [],
            active: true, available: true, readonly: () => false, rendered() {}, failed() {}};
        if (related) {
            block.dataset.avHost = "panel-host";
            modules.host.setAVRelationHost(block, host);
        } else block.dataset.nodeId = "target-carrier";
        const editor = related ? modules.host.createAVHostProtyle(owner, block) : owner;
        const cells = [...block.querySelectorAll(".av__cell")];
        const button = panel.querySelector("button");
        let completion;
        button.onclick = () => { completion = modules.relation.setRelationCell(editor, block, button, cells); };
        return {block, panel, owner, editor, host, cells, original, click: () => { button.click(); return completion; },
            destroy: () => { modules.host.deleteAVRelationHost(block); block.remove(); panel.remove(); }};
    };

    for (const batch of ["replace", "add", "remove"]) {
        for (const selected of [false, true]) {
            const state = mount(true, selected, batch, 2), before = calls.length;
            const pending = state.click(); await tick();
            check.equal(calls.length, before + 1);
            const tx = calls.at(-1);
            check.equal(tx.options.awaitResponse, true);
            check.equal(tx.forward.length, 2); check.equal(tx.undo.length, 2);
            for (const [index, operation] of tx.forward.entries()) {
                check.equal(operation.action, "updateAttrViewCell");
                check.equal(operation.avID, "target"); check.equal(operation.keyID, "target-parent");
                check.equal(operation.rowID, "member-" + index); check.equal(operation.blockID, "source-carrier");
                check.deepEqual(operation.relationContext, context);
                check.deepEqual(operation.data.relation.blockIDs, selected ? [] : ["new-parent"]);
                check.deepEqual(tx.undo[index].data.relation.blockIDs, ["old-parent-" + index]);
                check.deepEqual(tx.undo[index].relationContext, context);
                check.equal(tx.undo[index].blockID, "source-carrier");
            }
            check.deepEqual(state.cells.map(cell => cell.dataset.cellValue), state.original);
            check.equal(state.panel.isConnected, true, "submission alone must not close the picker");
            await state.click(); check.equal(calls.length, before + 1, "repeated clicks cannot submit duplicates");
            settle.resolve(); await pending;
            check.equal(state.panel.isConnected, false); state.destroy();
        }
    }
    for (const selected of [false, true]) {
        const state = mount(false, selected, "replace", 2);
        await state.click();
        const tx = calls.at(-1);
        check.equal(tx.forward[0].action, "reparentAttrViewItems");
        check.deepEqual(tx.forward[0].srcIDs, ["member-0", "member-1"]);
        check.equal(tx.forward[0].parentID, selected ? "" : "new-parent");
        check.equal(tx.forward[0].blockID, "target-carrier");
        check.equal(tx.forward[0].groupID, "group");
        check.equal(tx.forward[0].relationContext, undefined);
        check.deepEqual(tx.undo[0], tx.forward[0]);
        check.equal(state.panel.isConnected, false); state.destroy();
    }
    for (const change of ["readonly", "inactive", "unavailable", "disposed", "disconnected"]) {
        const state = mount(), before = calls.length;
        if (change === "readonly") state.owner.disabled = true;
        if (change === "inactive") state.host.active = false;
        if (change === "unavailable") state.host.available = false;
        if (change === "disposed") modules.host.deleteAVRelationHost(state.block);
        if (change === "disconnected") state.block.remove();
        await state.click();
        check.equal(calls.length, before, change); check.equal(state.panel.isConnected, true);
        state.destroy();
    }
    for (const change of ["reject", "readonly", "replaced", "disposed", "closed"]) {
        const state = mount(), before = messages.length;
        const pending = state.click(); await tick();
        if (change === "readonly") state.owner.disabled = true;
        if (change === "replaced") modules.host.setAVRelationHost(state.block, {...state.host});
        if (change === "disposed") modules.host.deleteAVRelationHost(state.block);
        if (change === "closed") state.panel.remove();
        if (change === "reject") settle.reject(new Error("Save not confirmed"));
        else settle.resolve();
        await pending;
        check.deepEqual(state.cells.map(cell => cell.dataset.cellValue), state.original);
        check.equal(state.panel.isConnected, change !== "closed");
        check.equal(messages.length, before + Number(change === "reject"));
        check.equal(state.panel.querySelector(".av__relation").dataset.saving, undefined);
        state.destroy();
    }
    const mountPicker = (related = true, parent = false, count = 2) => {
        const state = mount(related, false, "add", count);
        state.cells.forEach(cell => { cell.dataset.colId = parent ? "target-parent" : "target-relation"; });
        const field = state.cells[0].dataset.colId;
        const av = {id: "target", viewType: "table", view: {columns: [
            {id: field, type: "relation", relation: {avID: parent ? "target" : "third"}},
        ]}, subItems: {enabled: parent, parentKeyID: "target-parent"}};
        state.panel.innerHTML = '<div class="b3-menu"></div>';
        const menu = state.panel.firstElementChild;
        menu.innerHTML = modules.relation.getRelationHTML(av, state.cells);
        let completion;
        menu.addEventListener("click", event => {
            const button = event.target.closest('[data-relation-type="create"]');
            if (button) completion = modules.relation.setRelationCell(state.editor, state.block, button, state.cells);
        });
        const bind = () => modules.relation.bindRelationEvent({menuElement: menu, blockElement: state.block,
            cellElements: state.cells, protyle: state.editor});
        return {...state, menu, field, bind, create: () => {
            const button = menu.querySelector('[data-relation-type="create"]');
            check.ok(button && !button.disabled); button.click(); return completion;
        }};
    };
    const response = {code: 0, data: {name: "Destination", blockIDs: ["destination-carrier"], notebookID: "notebook",
        columns: [{id: "primary", name: "Title", type: "block"}], rows: [], selectedRows: [], total: 0,
        newItemPreview: {primaryKey: "New item", templateID: "template"}}};
    const expectedScope = count => ({relationContext: context, sourceItemIDs: Array.from({length: count}, (_, index) => "member-" + index)});
    for (const related of [false, true]) {
        for (const parent of [false, true]) {
            for (const count of [1, 2]) {
                const state = mountPicker(related, parent, count), cleanup = state.bind();
                const candidate = candidates.at(-1);
                check.equal(candidate.payload.avID, "target"); check.equal(candidate.payload.keyID, state.field);
                check.equal(candidate.payload.blockID, related ? "source-carrier" : "target-carrier");
                check.deepEqual(candidate.payload.relationCellContext, related ? expectedScope(count) : undefined);
                check.equal(candidate.payload.relationContext, undefined);
                check.deepEqual(candidate.payload.excludeItemIDs, parent ? expectedScope(count).sourceItemIDs : undefined);
                candidate.complete(response); await tick();
                const before = creations.length, pending = state.create(); await tick();
                const created = creations.at(-1);
                check.equal(creations.length, before + 1);
                check.equal(created.payload.avID, "target"); check.equal(created.payload.keyID, state.field);
                check.equal(created.payload.blockID, related ? "source-carrier" : "target-carrier");
                check.deepEqual(created.payload.relationCellContext, related ? expectedScope(count) : undefined);
                check.equal(created.payload.relationContext, undefined);
                check.deepEqual(created.payload.cells.map(cell => cell.itemID), expectedScope(count).sourceItemIDs);
                check.deepEqual(created.payload.cells.map(cell => cell.relatedItemIDs),
                    Array.from({length: count}, (_, index) => parent ? [] : ["old-parent-" + index]));
                created.resolve({code: 0, data: {itemID: "created-item", content: "Created", isDetached: true}});
                await pending;
                check.ok(state.menu.querySelector('[data-row-id="created-item"]'));
                cleanup(); state.destroy();
            }
        }
    }
    const invalidate = (state, change) => {
        if (change === "readonly") state.owner.disabled = true;
        if (change === "inactive") state.host.active = false;
        if (change === "disposed") modules.host.deleteAVRelationHost(state.block);
        if (change === "replaced") modules.host.setAVRelationHost(state.block, {...state.host});
        if (change === "closed") state.panel.remove();
    };
    for (const change of ["readonly", "inactive", "disposed", "replaced", "closed"]) {
        const state = mountPicker(), cleanup = state.bind(), request = candidates.at(-1);
        invalidate(state, change);
        request.complete(response); await tick();
        check.equal(state.menu.querySelector('[data-relation-type="create"]'), null, change);
        const before = candidates.length;
        state.menu.dispatchEvent(new CustomEvent("relationrefresh"));
        check.equal(candidates.length, before, change);
        cleanup(); state.destroy();
    }
    for (const change of ["readonly", "inactive", "disposed", "closed"]) {
        const state = mountPicker(), before = candidates.length;
        invalidate(state, change); state.bind();
        check.equal(candidates.length, before, change); state.destroy();
    }
    {
        const state = mountPicker(), cleanup = state.bind();
        candidates.at(-1).complete({code: 1, data: null}); await tick();
        check.equal(state.menu.querySelector('[data-relation-type="create"]'), null);
        cleanup(); state.destroy();
    }
    for (const change of ["readonly", "inactive", "disposed", "closed"]) {
        const state = mountPicker(), cleanup = state.bind();
        candidates.at(-1).complete(response); await tick();
        const before = creations.length;
        invalidate(state, change); await state.create();
        check.equal(creations.length, before, change);
        cleanup(); state.destroy();
    }
    for (const change of ["readonly", "inactive", "disposed", "replaced", "closed"]) {
        const state = mountPicker(), cleanup = state.bind();
        candidates.at(-1).complete(response); await tick();
        const pending = state.create(); await tick();
        const created = creations.at(-1), before = candidates.length;
        invalidate(state, change);
        created.resolve({code: 0, data: {itemID: "late-item", content: "Late", isDetached: true}});
        await pending;
        check.equal(state.menu.querySelector('[data-row-id="late-item"]'), null, change);
        check.equal(candidates.length, before, change);
        cleanup(); state.destroy();
    }
    for (const failed of ["rejected", "membership-denied"]) {
        const state = mountPicker(), cleanup = state.bind();
        candidates.at(-1).complete(response); await tick();
        const before = messages.length;
        const pending = state.create(); await tick();
        const request = creations.at(-1);
        if (failed === "rejected") request.reject(new Error("Network unavailable"));
        else request.resolve({code: 1, data: null});
        await pending;
        check.equal(state.menu.querySelector('[data-row-id="created-item"]'), null);
        check.deepEqual(state.cells.map(cell => cell.dataset.cellValue), state.original);
        check.equal(state.menu.querySelector(".av__relation").dataset.creating, undefined);
        check.equal(messages.length, before + 1);
        cleanup(); state.destroy();
    }
    return `Related target parent cell passed: ${mobile ? "mobile" : "desktop"}`;
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]); app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
            offscreen: true, backgroundThrottling: false}});
        try {
            for (const mobile of [false, true]) {
                await win.loadURL("about:blank");
                console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources(mobile))}, ${mobile})`));
            }
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("related target parent cells preserve scoped undo and native relation pickers scope candidates and creation to current members", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-related-parent-cell-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), args, {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Related target parent cell passed: desktop/);
            assert.match(stdout, /Related target parent cell passed: mobile/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
