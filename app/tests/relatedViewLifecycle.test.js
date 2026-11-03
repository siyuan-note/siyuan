const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return Object.fromEntries(["relatedView", "host"].map(name => [name,
        ts.transpileModule(readFileSync(path.join(__dirname, "../src/protyle/render/av", name + ".ts"), "utf8"), {
            compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
        }).outputText]));
};

const cases = async compiled => {
    const check = require("node:assert/strict");
    const pause = () => new Promise(resolve => setTimeout(resolve, 130));
    const lang = new Proxy({}, {get: (_object, key) => key === "_attrView" ? lang : String(key)});
    window.siyuan = {config: {readonly: false}, languages: lang};
    const renders = [], aborted = [], closed = [], operations = [], menus = [], requests = [], messages = [], openedRows = [], confirmations = [], openedShared = [];
    const data = new WeakMap();
    let candidateResponse = {code: 0, data: {rows: [], total: 0, newItemPreview: {targetType: "detached"}}};
    let pendingCandidates;
    let createReject = false;
    let targetCarrier = "target-carrier";
    const imports = {
        "../../util/hasClosest": {hasClosestBlock: node => node.closest("[data-node-id]")},
        "./render": {avRender: async (element, editor) => { renders.push({element, editor}); },
            initUnfoldedGroupTables() {}, setAVGroupFolded() {}},
        "./action": {avClick: (_editor, event) => { throw new Error("Unexpected native action: " + event.target.outerHTML); }},
        "./locate": {beginAVRender: element => aborted.push(element)},
        "./virtualScroll": {getAVData: element => data.get(element), setAVData: (element, value) => data.set(element, value),
            getAVSelectedItemIDs: () => ["target-entry"]},
        "./view": {getFieldsByData: () => []}, "./col": {}, "./capabilities": {},
        "./openMenuPanel": {openMenuPanel() {}},
        "./cellEditor": {closeAVCellEditor: element => closed.push(element)},
        "./openDatabaseRow": {openDatabaseRowByData: async (_editor, row) => { openedRows.push(row); return true; }},
        "../../../plugin/Menu": {Menu: class {
            constructor() { this.items = []; menus.push(this); }
            addItem(item) { this.items.push(item); }
            addSeparator() {}
            open() {}
        }},
        "../../../menus/menuToggle": {toggleMenu: options => options.build()},
        "../../../menus/menuClick": {globalClickHideMenu() {}},
        "./relatedViewColumnWidth": {applyRelatedAVColumnWidths() {}, startRelatedAVColumnResize() {}},
        "../../../util/fetch": {fetchSyncPost: async (url, payload, _callback, _show, signal) => {
            requests.push({url, payload, signal});
            if (url.endsWith("getAttributeViewKeys")) return {code: 0, data: [{avID: "target", notebookID: "target-notebook", blockIDs: targetCarrier ? [targetCarrier] : [],
                keyValues: [{key: {type: "block"}, values: [{id: "target-value", isDetached: true, block: {content: "Target title"}}]}]}]};
            if (url.endsWith("getBlockInfo")) throw new Error("Related row metadata must retain its validated notebook without a global lookup");
            if (url.endsWith("createAttributeViewRelationItem")) {
                if (createReject) throw new Error("network");
                return {code: 0, data: {itemID: "created-entry"}};
            }
            if (url.endsWith("renderAttributeView")) return {code: 0, data: {target: {status: "filtered"}}};
            if (pendingCandidates) return pendingCandidates;
            return candidateResponse;
        }},
        "../../../util/documentSelectionRequest": {fetchWithDocumentSelection: callback => callback()},
        "../../../util/escape": {escapeHtmlTextAndAttr: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")},
        "../../wysiwyg/transaction": {transaction: (_editor, forward, undo) => operations.push({forward, undo})},
        "../../../dialog/mobileDialog": {MobileDialog: class {
            constructor(options) { this.options = options; this.element = document.createElement("div");
                this.element.className = "fixture-dialog"; this.element.innerHTML = options.content; document.body.append(this.element); }
            destroy() { this.element.remove(); this.options.destroyCallback(); }
            focusWhenReady() {}
        }},
        "../../../dialog/mobileConfirmDialog": {mobileConfirmDialog: (title, message, confirm) => confirmations.push({title, message, confirm})},
        "../../../dialog/message": {showMessage: message => messages.push(message)},
        "../../../constants": {Constants: {TIMEOUT_INPUT: 10}}, "./viewVisibility": {},
        "../../../mobile/editor": {openMobileFileById: async (_app, blockID) => openedShared.push(blockID)},
        "../../../editor/util": {openFileById: async options => openedShared.push(options.id)}, "../../../editor": {},
    };
    const modules = {};
    const load = name => {
        if (Object.hasOwn(imports, name)) return imports[name];
        const key = name.replace("./", "");
        if (!compiled[key]) throw new Error("Unexpected fixture dependency: " + name);
        if (!modules[key]) {
            modules[key] = {};
            new Function("require", "exports", compiled[key])(load, modules[key]);
        }
        return modules[key];
    };
    const api = load("./relatedView"), hostAPI = load("./host");
    const table = (avID, itemID, keys = ["relation"]) => ({avID, keyValues: [
        {key: {id: "primary", type: "block"}, values: [{blockID: itemID, block: {id: "bound-physical-block"}}]},
        ...keys.map(id => ({key: {id, name: id, type: "relation", relation: {avID: "target",
            detailView: {spec: 1, enabled: true, viewID: "configured"}}}})),
    ]});
    const make = (id, tables = [table("source-a", "entry-a", ["field-a", "field-b"]), table("source-b", "entry-b")]) => {
        const body = document.createElement("div");
        body.innerHTML = tables.map(item => `<div data-av-id="${item.avID}"><div class="av__row">property</div></div>`).join("");
        document.body.append(body);
        const editor = {id, disabled: false, options: {}, app: {appId: "app"}, notebookId: "box"};
        api.mountRelatedAVViews(body, tables, editor, "source-carrier");
        const hosts = [...body.querySelectorAll("[data-av-host]")];
        return {body, editor, hosts, sync: () => api.syncRelatedAVViews(body), dispose: () => {
            api.disposeRelatedAVViews(body); body.remove();
        }};
    };
    const ready = element => {
        element.innerHTML = '<div class="av__container"><button data-type="av-switcher" class="av__mobile-view">Configured</button><button data-type="av-row-update">Bind</button><button data-type="av-add-top">Group add</button><button data-type="av-load-more">More<span data-type="set-page-size">Size</span></button><div class="av__row" data-id="target-entry"><button data-type="av-row-open">Open</button><button data-type="av-row-more">Row</button></div></div>';
        const value = {viewID: "configured", views: [{id: "configured", name: "Configured", type: "table"},
            {id: "other", name: "Other", type: "table"}, {id: "gallery", type: "gallery", name: "Cards"}], view: {filters: []}};
        data.set(element, value); hostAPI.getAVRelationHost(element).rendered(value);
    };
    for (const mobile of [false, true]) {
        document.body.classList.toggle("body--mobile", mobile);
        const current = make("window-1"), otherWindow = make("window-2", [table("source-a", "entry-a")]);
        current.body.children[1].classList.add("fn__none");
        current.sync(); otherWindow.sync();
        check.equal(renders.filter(item => current.hosts.includes(item.element)).length, 2);
        check.equal(new Set([...current.hosts, ...otherWindow.hosts].map(item => item.dataset.avHost)).size, 4);
        current.hosts.forEach(element => {
            check.equal(element.hasAttribute("data-node-id"), false);
            check.ok([...element.parentElement.parentElement.children].indexOf(element.parentElement) > 0);
            check.equal(hostAPI.getAVRelationHost(element).relationContext.sourceItemID,
                element.closest('[data-av-id="source-a"]') ? "entry-a" : "entry-b");
        });
        ready(current.hosts[0]); ready(current.hosts[1]); ready(otherWindow.hosts[0]);
        check.equal(current.hosts[0].querySelector('[data-type="av-row-update"]'), null);
        check.equal(current.hosts[0].querySelector('[data-type="av-add-top"]'), null);
        const confirmationCount = confirmations.length;
        current.hosts[0].querySelector('[data-type="set-page-size"]').click();
        check.equal(confirmations.length, confirmationCount + 1);
        check.equal(confirmations.at(-1).message, "relatedDatabaseViewSharedTip");
        const previousCandidates = candidateResponse;
        candidateResponse = {code: 0, data: {blockIDs: ["target-carrier"], notebookID: "target-notebook"}};
        const sharedBefore = openedShared.length;
        await confirmations.at(-1).confirm();
        check.ok(openedShared.length > sharedBefore);
        check.equal(openedShared.at(-1), "target-carrier");
        check.deepEqual(requests.at(-1).payload.relationContext, hostAPI.getAVRelationHost(current.hosts[0]).relationContext);
        check.equal(requests.at(-1).payload.blockID, "source-carrier");
        candidateResponse = previousCandidates;
        check.ok(current.hosts[0].querySelector('[data-type="av-row-more"]'));
        check.ok(current.hosts[0].querySelector('[data-type="av-load-more"]'));
        const remountedBind = document.createElement("button");
        remountedBind.dataset.type = "av-row-update";
        current.hosts[0].querySelector(".av__row").append(remountedBind);
        remountedBind.click();
        current.hosts[0].querySelector('[data-type="av-row-open"]').click(); await pause();
        check.deepEqual(requests.at(-1).payload, {id: "target-entry", avID: "target", itemID: "target-entry",
            blockID: "source-carrier", relationContext: hostAPI.getAVRelationHost(current.hosts[0]).relationContext});
        check.equal(openedRows.at(-1).notebookID, "target-notebook");
        check.notEqual(openedRows.at(-1).notebookID, current.editor.notebookId);
        check.equal(openedRows.at(-1).databaseBlockID, "target-carrier");
        check.equal(openedRows.at(-1).itemID, "target-entry");
        const openedCount = openedRows.length;
        targetCarrier = "";
        current.hosts[0].querySelector('[data-type="av-row-open"]').click(); await pause();
        check.equal(openedRows.length, openedCount);
        check.equal(messages.at(-1), "relatedDatabaseViewUnavailable");
        targetCarrier = "target-carrier";
        const firstHost = hostAPI.getAVRelationHost(current.hosts[0]);
        current.hosts[0].querySelector('[data-type="av-switcher"]').click();
        check.deepEqual(menus.at(-1).items.map(item => item.label), ["Configured", "Other"]);
        menus.at(-1).items[1].click();
        check.equal(firstHost.viewID, "other");
        check.equal(hostAPI.getAVRelationHost(current.hosts[1]).viewID, "configured");
        await pause();
        const fold = current.hosts[0].parentElement.querySelector('[data-related-action="fold"]');
        const key = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        fold.dispatchEvent(key); check.equal(key.defaultPrevented, false);
        fold.click(); check.equal(firstHost.active, false);
        const beforeFoldedRefresh = renders.length;
        hostAPI.notifyAVHostRefresh("window-1", "target"); await pause();
        check.equal(renders.length, beforeFoldedRefresh + 1);
        fold.click(); check.equal(firstHost.active, true);
        current.body.children[0].classList.add("fn__none");
        current.body.children[1].classList.remove("fn__none"); current.sync();
        check.equal(firstHost.active, false);
        check.equal(hostAPI.getAVRelationHost(current.hosts[2]).active, true);
        current.body.children[0].classList.remove("fn__none"); current.sync();
        check.ok(current.hosts.every(element => hostAPI.getAVRelationHost(element).active));
        ready(current.hosts[0]);
        const add = current.hosts[0].parentElement.querySelector('[data-related-action="add"]');
        add.click(); await Promise.resolve(); await Promise.resolve();
        const picker = document.querySelector(".fixture-dialog"); check.ok(picker);
        check.equal(requests.at(-1).payload.blockID, "source-carrier");
        check.deepEqual(requests.at(-1).payload.relationContext, firstHost.relationContext);
        createReject = true;
        picker.querySelector('[data-related-picker="new"]').click(); await pause();
        check.equal(picker.querySelector('[data-related-picker="new"]').disabled, false);
        check.equal(messages.at(-1), "relatedDatabaseViewUnavailable");
        const creation = requests.findLast(item => item.url.endsWith("createAttributeViewRelationItem"));
        check.deepEqual(creation.payload.cells, [{itemID: "entry-a", relatedItemIDs: []}]);
        check.deepEqual(creation.payload.relationContext, firstHost.relationContext);
        createReject = false;
        picker.querySelector('[data-related-picker="new"]').click(); await pause();
        check.equal(document.querySelector(".fixture-dialog"), null);
        check.equal(messages.at(-1), "databaseItemFiltered");
        const visibility = requests.findLast(item => item.url.endsWith("renderAttributeView"));
        check.equal(visibility.payload.targetItemID, "created-entry");
        check.equal(visibility.payload.createIfNotExist, false);
        check.deepEqual(visibility.payload.relationContext, firstHost.relationContext);
        check.equal(visibility.payload.viewID, firstHost.viewID);
        check.equal(visibility.payload.temporaryFilters, firstHost.temporaryFilters);
        for (const invalidation of ["readonly", "hidden"]) {
            let resolveCandidates;
            pendingCandidates = new Promise(resolve => { resolveCandidates = resolve; });
            add.click();
            const stalePicker = document.querySelector(".fixture-dialog");
            const staleRequest = requests.at(-1);
            check.deepEqual(staleRequest.payload.relationContext, firstHost.relationContext);
            if (invalidation === "readonly") current.editor.disabled = true;
            else current.body.children[0].classList.add("fn__none");
            api.syncRelatedAVEditor("window-1");
            check.equal(document.querySelector(".fixture-dialog"), null);
            if (invalidation === "readonly") check.equal(add.disabled, true);
            check.equal(staleRequest.signal.aborted, true);
            resolveCandidates({code: 0, data: {rows: [{id: "late-entry", cells: []}], total: 1,
                newItemPreview: {targetType: "document", notebookID: "target-notebook"}}});
            await Promise.resolve(); await Promise.resolve();
            check.equal(stalePicker.querySelector("[data-item-id]"), null);
            check.equal(stalePicker.querySelector('[data-related-picker="new"]').disabled, true);
            current.editor.disabled = false; current.body.children[0].classList.remove("fn__none"); current.sync();
            pendingCandidates = new Promise(resolve => { resolveCandidates = resolve; });
            current.hosts[0].querySelector('[data-type="set-page-size"]').click();
            const opening = confirmations.at(-1).confirm();
            check.deepEqual(requests.at(-1).payload.relationContext, firstHost.relationContext);
            const openedBefore = openedShared.length;
            if (invalidation === "readonly") current.editor.disabled = true;
            else current.body.children[0].classList.add("fn__none");
            current.sync();
            resolveCandidates({code: 0, data: {blockIDs: ["target-carrier"], notebookID: "target-notebook"}});
            await opening;
            check.equal(openedShared.length, openedBefore);
            const requestsBefore = requests.length;
            await confirmations.at(-1).confirm();
            check.equal(requests.length, requestsBefore);
            current.editor.disabled = false; current.body.children[0].classList.remove("fn__none"); current.sync();
            pendingCandidates = undefined;
        }
        current.hosts[0].querySelector('[data-type="av-row-more"]').click();
        menus.at(-1).items.find(item => item.label === "relatedDatabaseViewRemove").click();
        check.equal(operations.at(-1).forward[0].action, "updateAttrViewRelationItems");
        check.deepEqual(operations.at(-1).forward[0].data, {addItemIDs: [], removeItemIDs: ["target-entry"]});
        check.equal(operations.at(-1).forward[0].rowID, "entry-a");
        check.deepEqual(operations.at(-1).undo[0].data, {addItemIDs: ["target-entry"], removeItemIDs: []});
        firstHost.temporaryFilters = [{column: "col", operator: "IsEmpty"}];
        firstHost.viewID = "other";
        api.preserveRelatedAVViews(current.body);
        current.body.querySelectorAll(".av-related-view").forEach(element => element.remove());
        api.mountRelatedAVViews(current.body, [table("source-a", "entry-a", ["field-a", "field-b"]), table("source-b", "entry-b")], current.editor, "source-carrier");
        const replacement = current.body.querySelector("[data-av-host]");
        check.equal(hostAPI.getAVRelationHost(replacement).viewID, "other");
        check.deepEqual(hostAPI.getAVRelationHost(replacement).temporaryFilters, [{column: "col", operator: "IsEmpty"}]);
        current.sync(); ready(replacement);
        replacement.parentElement.querySelector('[data-related-action="add"]').click();
        api.invalidateRelatedAVSecurity();
        check.equal(document.querySelector(".fixture-dialog"), null);
        check.equal(replacement.querySelector(".av__row"), null);
        check.equal(data.get(replacement), undefined);
        check.equal(hostAPI.getAVRelationHost(replacement).available, false);
        check.equal(hostAPI.getAVRelationHost(replacement).active, false);
        check.match(replacement.textContent, /relatedDatabaseViewUnavailable/);
        current.dispose(); otherWindow.dispose();
        const afterDispose = renders.length;
        hostAPI.notifyAVHostRefresh("window-1", "source-a"); await pause();
        check.equal(renders.length, afterDispose);
    }
    const invalid = make("invalid", [table("source-a", "entry-a")]);
    invalid.sync();
    hostAPI.getAVRelationHost(invalid.hosts[0]).failed("<repair>");
    check.equal(invalid.hosts[0].querySelector("repair"), null);
    check.match(invalid.hosts[0].textContent, /<repair>/);
    check.equal(invalid.hosts[0].parentElement.querySelector('[data-related-action="add"]').disabled, true);
    invalid.dispose();
    check.ok(closed.length > 0 && aborted.length > 0);
    return "Related view lifecycle cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
            offscreen: true, backgroundThrottling: false}});
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`));
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("related views isolate fields and windows, stay lazy, and invalidate editor and picker lifecycles", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-related-view-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), args, {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Related view lifecycle cases passed/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
