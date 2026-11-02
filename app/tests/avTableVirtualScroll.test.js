const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const browserCases = sources => {
    const check = require("node:assert/strict");
    const frames = [];
    const Constants = {ATTRIBUTE_V_SCROLL: "data-v-scroll"};
    window.siyuan = {languages: {}};
    const getRowHTML = ({row, rowIndex}) => `<div class="av__row" data-id="${row.id}" data-index="${rowIndex}"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div><div class="av__cell">${row.id}</div></div>`;
    const dependencies = {
        "../../../constants": {Constants},
        "./row": {getRowHTML},
        "./richText": {renderAVRichTextElements() {}},
        "./backlinkScroll": {getBacklinkScrollElement: () => null},
    };
    const load = name => {
        if (!dependencies[name]) {
            check.ok(sources[name], `Unexpected module ${name}`);
            const exports = {};
            dependencies[name] = exports;
            new Function("require", "exports", "requestAnimationFrame", sources[name])(
                load, exports, callback => frames.push(callback));
        }
        return dependencies[name];
    };
    const virtual = load("./virtualScroll");
    const renderTable = new Function("clampGroupTableVirtualData", "getRowHTML", "Constants", sources.render +
        "\nreturn getTableHTMLs;")(load("./groupTableVirtual").clampGroupTableVirtualData, getRowHTML, Constants);
    const getPageSize = new Function(sources.paging + "\nreturn getPageSize;")();
    const style = document.createElement("style");
    style.textContent = `html,body {margin:0} .viewport {height:300px;overflow:auto;overflow-anchor:none}
        .av__row, .av__row--util {height:30px} .av__row {display:flex} svg {width:10px;height:10px} .fn__none {display:none}`;
    document.head.append(style);
    for (const avType of ["table", "list"]) {
        for (const pageSize of [50, 100]) {
            document.body.innerHTML = `<div class="viewport"><div class="av" data-type="NodeAttributeView" data-av-type="${avType}" data-av-id="database"><div class="av__container"><div class="av__scroll"><div class="av__body" data-page-size="${pageSize}" data-group-id=""></div></div></div></div></div>`;
            const contentElement = document.querySelector(".viewport");
            const block = document.querySelector(".av");
            const protyle = {contentElement};
            let rows = Array.from({length: 167}, (_, index) => ({id: `row-${index}`}));
            const render = () => {
                const oldBody = block.querySelector(".av__body");
                const requestedSize = getPageSize(block).unGroupPageSize;
                const firstRow = oldBody.querySelector(".av__row[data-id]");
                const restored = firstRow && block.getAttribute(Constants.ATTRIBUTE_V_SCROLL) === "true" ?
                    virtual.getBodyVirtualData(oldBody, ".av__row--util", Number(firstRow.dataset.index)) : undefined;
                const selectedItemPoints = virtual.getAVSelectedItemPoints(block);
                const view = {columns: [], rows: rows.slice(0, requestedSize), rowCount: rows.length, pageSize};
                const body = document.createElement("div");
                body.className = "av__body";
                body.dataset.groupId = "";
                body.dataset.pageSize = String(requestedSize);
                body.innerHTML = renderTable(view, block, restored);
                oldBody.replaceWith(body);
                check.ok(body.querySelectorAll(".av__row[data-id]").length <= 100);
                virtual.initVirtualScroll({protyle, blockElement: block, data: {viewType: avType, view}, selectedItemPoints});
                while (frames.length) frames.shift()();
            };
            const avClick = new Function("getAVTemplateInteractiveElement", "isOnlyMeta", "hasClosestBlock",
                "hasClosestByClassName", "avRender", "isMobile", "isCardCoverPositioning", sources.action + "\nreturn avClick;")(
                () => null, () => false, element => element.closest(".av"),
                (element, name) => element.closest("." + name), render, () => false, () => false);
            let clickError;
            block.addEventListener("click", event => {
                try { avClick(protyle, event); } catch (error) { clickError = error; }
            });
            const loadMore = () => {
                const button = block.querySelector('[data-type="av-load-more"]');
                check.ok(!button.classList.contains("fn__none"));
                button.querySelector("span").click();
                check.ifError(clickError);
            };
            render();
            if (pageSize === 50) loadMore();
            check.equal(block.querySelectorAll(".av__row[data-id]").length, 100);
            contentElement.scrollTop = contentElement.scrollHeight - contentElement.clientHeight;
            const viewportTop = contentElement.getBoundingClientRect().top;
            const anchor = [...block.querySelectorAll(".av__row[data-id]")]
                .find(row => row.getBoundingClientRect().top >= viewportTop);
            const anchorID = anchor.dataset.id;
            const anchorTop = anchor.getBoundingClientRect().top;
            anchor.classList.add("av__row--select");
            loadMore();
            check.equal(block.getAttribute(Constants.ATTRIBUTE_V_SCROLL), "true");
            const restoredAnchor = block.querySelector(`[data-id="${anchorID}"]`);
            check.ok(restoredAnchor, "loading more keeps the viewport anchor mounted");
            check.ok(Math.abs(restoredAnchor.getBoundingClientRect().top - anchorTop) < 1);
            check.ok(restoredAnchor.classList.contains("av__row--select"));
            // 加载步长独立于已加载条目和当前挂载窗口。
            check.equal(Number(block.querySelector('[data-type="set-page-size"]').dataset.size), pageSize);
            if (pageSize === 50) loadMore();
            for (let i = 0; i < 30 && !block.querySelector('[data-id="row-166"]'); i++) {
                contentElement.scrollTop = contentElement.scrollHeight;
                virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
            }
            check.ok(block.querySelector('[data-id="row-166"]'), "every loaded row remains reachable");
            check.deepEqual(virtual.getAVSelectedItemPoints(block).map(item => item.itemID), [anchorID]);
            for (let i = 0; i < 30 && !block.querySelector(`[data-id="${anchorID}"]`); i++) {
                contentElement.scrollTop -= 120;
                virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
            }
            check.ok(block.querySelector(`[data-id="${anchorID}"]`).classList.contains("av__row--select"));
            check.ok(Number(block.querySelector(".av__row[data-id]").dataset.index) > 3);
            rows = [{id: "match-0"}, {id: "match-1"}, {id: "match-2"}];
            render();
            check.deepEqual([...block.querySelectorAll(".av__row[data-id]")].map(row => row.dataset.id),
                rows.map(row => row.id));
            check.equal(block.querySelector(".av__spacer"), null);
            check.deepEqual(virtual.getAVSelectedItemPoints(block), []);
        }
    }
    return "Database table virtual scrolling passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const ts = require("typescript");
    const extract = (name, file) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"),
            ts.ScriptTarget.ES2022, true);
        const statement = source.statements.find(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name));
        assert.ok(statement);
        return ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
            compilerOptions: {target: ts.ScriptTarget.ES2022},
        }).outputText;
    };
    const sources = Object.fromEntries(["virtualScroll", "selectionState", "groupTableVirtual", "viewType",
        "capabilities", "capabilities.generated"].map(name => ["./" + name,
        ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText]));
    sources.render = extract("getTableHTMLs", "../src/protyle/render/av/render.ts");
    sources.action = extract("avClick", "../src/protyle/render/av/action.ts");
    sources.paging = extract("getPageSize", "../src/protyle/render/av/groups.ts");
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        assert.equal(await win.webContents.executeJavaScript(`(() => {
            try { return (${browserCases.toString()})(${JSON.stringify(sources)}); }
            catch (error) { return error.stack; }
        })()`),
            "Database table virtual scrolling passed");
        console.log("Database table virtual scrolling passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("table/list load-more clicks preserve viewport, selection and filtered results", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-table-virtual-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Database table virtual scrolling passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-table-virtual-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
