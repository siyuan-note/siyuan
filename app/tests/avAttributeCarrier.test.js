const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async () => {
    const assert = require("node:assert/strict");
    const requests = [];
    const transactions = [];
    let tables;
    Object.assign(window, {
        siyuan: {languages: {database: "Database", removeAV: "Remove", newCol: "New column"}},
        attributeViewRenderID: 0,
        attributeTableData: new WeakMap(),
        fetchPost: (url, data, callback) => {
            requests.push({url, data});
            if (url.endsWith("getAttributeViewKeys")) {
                callback({data: tables});
            } else if (url.endsWith("getAttributeViewBacklinks")) {
                callback({data: {total: 0, items: []}});
            }
        },
        renderAVRichTextElements: () => {},
        getColIconByType: () => "iconDatabase",
        genAVAttributeRowHTML: ({value}) => `<div data-row-id="${value.blockID}" data-col-id="${value.keyID}"></div>`,
        getPageSize: () => ({unGroupPageSize: 20, groupPageSize: {}}),
        getAVBatchEditMode: () => "replace",
        transformCellValue: (_type, value) => value,
        objEquals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        getCellValueText: () => "",
        dayjs: () => ({format: () => "20260909120000"}),
        transaction: (_protyle, doOperations, undoOperations) => transactions.push({doOperations, undoOperations}),
    });
    const protyle = {};
    for (const detached of [true, false]) {
        const itemID = detached ? "detached-item" : "bound-item";
        const row = {avID: "database", itemID, valueID: "primary-value", databaseBlockID: "carrier-b"};
        const primary = {id: row.valueID, keyID: "primary", blockID: itemID, type: "block",
            isDetached: detached, block: {content: "Title", ...(detached ? {} : {id: "bound-block"})}};
        tables = [{avID: row.avID, blockIDs: ["carrier-a", "carrier-b"], keyValues: [
            {key: {id: "primary", type: "block"}, values: [primary]},
        ]}];
        const element = document.createElement("div");
        element.className = "custom-attr";
        document.body.replaceChildren(element);
        let callbackCount = 0;
        const render = () => window.renderAVAttribute(element, itemID, protyle, () => callbackCount++, row);
        render();
        let block = element.querySelector('[data-type="NodeAttributeView"]');
        assert.equal(block.dataset.nodeId, "carrier-b");
        assert.equal(block.dataset.attributeId, itemID);
        assert.equal(block.querySelector("[data-row-id]").dataset.rowId, itemID);
        assert.equal(window.attributeTableData.get(block), tables[0]);
        for (const type of ["select", "relation", "date", "edit"]) {
            window.openMenuPanel({protyle, blockElement: block, type});
            assert.equal(requests.at(-1).url, "/api/av/renderAttributeView");
            assert.equal(requests.at(-1).data.blockID, "carrier-b");
        }
        for (const type of ["select", "mSelect", "relation"]) {
            const oldValue = {type, ...(type === "relation" ? {relation: {blockIDs: [], contents: []}} : {mSelect: []})};
            const newValue = {type, ...(type === "relation" ?
                {relation: {blockIDs: ["related-item"], contents: []}} : {mSelect: [{content: "Option", color: "1"}]})};
            const cells = [{rowID: itemID, colID: "field", cell: {id: "value", value: oldValue}, column: {type}}];
            await window.updateCellsValue(protyle, block, newValue, undefined, undefined, undefined,
                false, false, false, cells, false);
            const {doOperations, undoOperations} = transactions.at(-1);
            for (const operations of [doOperations, undoOperations]) {
                assert.equal(operations[0].action, "updateAttrViewCell");
                assert.equal(operations[0].avID, row.avID);
                assert.equal(operations[0].rowID, itemID);
                assert.equal(operations[0].blockID, "carrier-b");
                assert.equal(operations[1].action, "doUpdateUpdated");
                assert.equal(operations[1].id, "carrier-b");
            }
            assert.deepEqual(doOperations[0].data[type === "relation" ? "relation" : "mSelect"],
                newValue[type === "relation" ? "relation" : "mSelect"]);
            assert.deepEqual(undoOperations[0].data, oldValue);
        }
        row.databaseBlockID = "carrier-a";
        render();
        assert.equal(element.querySelectorAll('[data-type="NodeAttributeView"]').length, 1);
        assert.equal(element.firstElementChild, block);
        assert.equal(block.dataset.nodeId, "carrier-a");
        assert.equal(callbackCount, 2);
        assert.equal(requests.filter(request => request.url.endsWith("getAttributeViewKeys")).at(-1).data.itemID, itemID);
    }
    // 普通块属性仍以真实块为上下文，不被所在数据库的其他镜像替换。
    const element = document.createElement("div");
    document.body.replaceChildren(element);
    window.renderAVAttribute(element, "document-block", protyle);
    assert.equal(element.firstElementChild.dataset.nodeId, "document-block");
    assert.equal(element.firstElementChild.dataset.attributeId, "document-block");
    assert.deepEqual(requests.filter(request => request.url.endsWith("getAttributeViewKeys")).at(-1).data,
        {id: "document-block"});
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const root = path.join(__dirname, "../src/protyle/render/av");
        const extract = (name, names) => {
            const text = readFileSync(path.join(root, name + ".ts"), "utf8");
            if (!names) {
                return text;
            }
            const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
            const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
                statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
            assert.equal(statements.length, names.length);
            return statements.map(statement => "export " + statement.getText(source).replace(/^export /, "")).join("\n");
        };
        // 执行实际渲染、菜单请求和事务组装函数，仅隔离网络、富文本显示与编辑器外壳。
        const sources = [extract("cellValue"), extract("dragFillValue", ["rebindAVCellValue"]),
            extract("blockAttr", ["renderAVAttribute", "renderAttributeViewBacklinks"]),
            extract("openMenuPanel", ["openMenuPanel"]), extract("cell", ["updateCellsValue"])].map(source =>
            ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText);
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`(() => {
            for (const source of ${JSON.stringify(sources)}) {
                const exports = {};
                new Function("exports", source)(exports);
                Object.assign(window, exports);
            }
        })()`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log("Attribute carrier cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("keeps database item identity separate from the physical attribute carrier", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-carrier-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Attribute carrier cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-carrier-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
