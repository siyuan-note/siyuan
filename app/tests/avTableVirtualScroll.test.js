const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const browserCases = sources => {
    const check = require("node:assert/strict");
    const frames = [];
    const flushFrames = () => {
        let count = 0;
        while (frames.length && count++ < 100) frames.shift()();
        check.equal(frames.length, 0, "viewport filling converges without another user scroll");
    };
    const Constants = {ATTRIBUTE_V_SCROLL: "data-v-scroll"};
    window.siyuan = {languages: {}};
    const getRowHTML = ({row, rowIndex, data}) => `<div class="av__row" data-id="${row.id}" data-index="${rowIndex}"${row.height ? ` style="height:${row.height}px;line-height:${row.height > 30 ? 23 : 19}px"` : ""}><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>${(data.columns.length ? data.columns : [{id: "title"}]).map(column => `<div class="av__cell" data-col-id="${column.id}" style="width:${column.width || "200px"}">${row.id}</div>`).join("")}</div>`;
    const dependencies = {
        "../../../constants": {Constants},
        "./row": {getRowHTML},
        "./richText": {renderAVRichTextElements() {}},
        "./backlinkScroll": {getBacklinkScrollElement: () => null},
        "./columnWindow": {initAVColumnWindow() {}, updateAVColumnWindow() {}},
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
    const renderDependencies = {
        ...load("./groupTableVirtual"), getRowHTML, Constants,
        escapeAttr: value => String(value || ""), escapeHtml: value => String(value || ""),
        getColIconByType: () => "iconText", getCalcValue: () => "",
    };
    const renderTable = new Function(...Object.keys(renderDependencies), sources.render +
        "\nreturn getTableHTMLs;")(...Object.values(renderDependencies));
    const getPageSize = new Function(sources.paging + "\nreturn getPageSize;")();
    const style = document.createElement("style");
    style.textContent = `html,body {margin:0} .viewport {height:300px;overflow:auto;overflow-anchor:none}
        .av__row, .av__row--util, .av__row--footer {height:30px} .av__row, .av__row--footer {display:flex}
        .av__row {box-sizing:border-box;border-bottom:1px solid black;line-height:19px}
        .av__cell {box-sizing:border-box;padding:5px 0} .av__cell, .av__calc {flex-shrink:0}
        svg {width:10px;height:10px} .fn__none {display:none}`;
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
                flushFrames();
            };
            const avClick = new Function("prepareAVColumnWindow", "getAVTemplateInteractiveElement", "isOnlyMeta", "hasClosestBlock",
                "hasClosestByClassName", "avRender", "isMobile", "isCardCoverPositioning", sources.action + "\nreturn avClick;")(
                () => {}, () => null, () => false, element => element.closest(".av"),
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
    for (const [rowCount, columnCount, tall] of [[60, 35, ""], [100, 22, ""], [60, 35, "first"],
        [60, 35, "later"], [60, 35, "initial"]]) {
        document.body.innerHTML = "<div class=\"viewport\"><div class=\"av\" data-av-type=\"table\"><div class=\"av__scroll\"><div class=\"av__body\" data-group-id=\"\"></div></div></div></div>";
        const contentElement = document.querySelector(".viewport");
        const block = document.querySelector(".av");
        const body = block.querySelector(".av__body");
        const view = {
            columns: Array.from({length: columnCount}, (_, index) => ({id: `col-${index}`, width: "200px"})),
            rows: Array.from({length: rowCount}, (_, index) => ({id: `wide-${index}`,
                height: tall ? (tall === "first" && index === 0 || tall === "later" && index === 49 ||
                    tall === "initial" && index < 25) ? 580 : 34 : 30})),
            rowCount, pageSize: 100,
        };
        body.innerHTML = renderTable(view, block);
        check.equal(block.getAttribute(Constants.ATTRIBUTE_V_SCROLL), "true");
        check.equal(body.querySelectorAll(".av__row[data-id]").length, Math.floor(900 / columnCount));
        virtual.initVirtualScroll({protyle: {contentElement}, blockElement: block, data: {viewType: "table", view}});
        flushFrames();
        let height = contentElement.scrollHeight;
        check.ok(height >= rowCount * 30, "bottom spacers preserve access to every loaded row");
        if (tall === "first") {
            check.ok(height < 3000, "a tall first row must not inflate every unseen row");
            contentElement.scrollTop = 150;
            virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
            check.ok(body.querySelector('[data-id="wide-0"]'), "an intersecting tall row stays mounted");
        }
        for (const top of [height, 0, height / 2, height, 0]) {
            contentElement.scrollTop = top;
            virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
            flushFrames();
            if (tall !== "later") {
                check.ok(Math.abs(contentElement.scrollHeight - height) < 1, "measured scroll range stays stable");
            }
            height = contentElement.scrollHeight;
            const rect = contentElement.getBoundingClientRect();
            const mounted = [...body.querySelectorAll(".av__row[data-id]")];
            check.ok(mounted.some(row => row.getBoundingClientRect().bottom > rect.top &&
                row.getBoundingClientRect().top < rect.bottom), "jumping through spacers mounts visible rows");
            check.ok(mounted.length <= Math.floor(900 / columnCount), "the window stays within the initial cell budget");
        }
        check.ok(body.querySelector('[data-id="wide-0"]'));
        contentElement.scrollTop = height;
        virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
        flushFrames();
        check.ok(body.querySelector(`[data-id="wide-${rowCount - 1}"]`));
        check.equal(view.rows.length, rowCount);
        check.equal(body.querySelectorAll(".av__cell--header").length, columnCount);
        if (rowCount === 100) {
            // 恢复窗口首行落在视口内时没有滚动方向，续帧仍须向上补齐并停止。
            body.innerHTML = renderTable(view, block,
                {renderedStart: 50, renderedEnd: 58, topSpacerHeight: 1500}, true);
            contentElement.scrollTop = 1430;
            virtual.initVirtualScroll({protyle: {contentElement}, blockElement: block,
                data: {viewType: "table", view}});
            flushFrames();
            const viewport = contentElement.getBoundingClientRect();
            const first = body.querySelector(".av__row[data-id]");
            check.ok(Number(first.dataset.index) < 50, "stationary frames prepend missing rows");
            check.ok(first.getBoundingClientRect().top <= viewport.top, "the upper viewport gap is filled");
            check.equal(frames.length, 0, "stationary gap filling terminates");
        }
    }
    {
        document.body.innerHTML = '<div class="viewport"><div class="av" data-av-type="table"><div class="av__scroll"></div></div></div>';
        const contentElement = document.querySelector(".viewport");
        const block = document.querySelector(".av");
        const columns = Array.from({length: 35}, (_, index) => ({id: `col-${index}`, width: "200px"}));
        const groups = ["first", "second"].map(id => ({id, groupHidden: 0, columns,
            rows: Array.from({length: 30}, (_, index) => ({id: `${id}-${index}`,
                height: id === "second" && index === 0 ? 580 : 34})), rowCount: 30, pageSize: 100}));
        const plan = load("./groupTableVirtual").getGroupTableRenderPlan(groups);
        check.deepEqual(plan.renderedRowCounts, {first: 24, second: 1});
        block.querySelector(".av__scroll").innerHTML = groups.map(group =>
            `<div class="av__body" data-group-id="${group.id}">${renderTable(group, block, plan.virtualData[group.id], true)}</div>`).join("");
        virtual.initVirtualScroll({protyle: {contentElement}, blockElement: block,
            data: {viewType: "table", view: {columns, rows: [], groups}}});
        flushFrames();
        const second = block.querySelector('[data-group-id="second"]');
        check.ok(parseFloat(second.querySelector(".av__spacer--bottom").style.height) < 1100,
            "one tall sample must not inflate the remaining group");
        const height = contentElement.scrollHeight;
        contentElement.scrollTop = height;
        virtual.trimAVRowsSync(block, contentElement.getBoundingClientRect());
        flushFrames();
        check.ok(second.querySelector('[data-id="second-29"]'));
        check.ok(Math.abs(contentElement.scrollHeight - height) < 1);
    }
    return "Database table virtual scrolling passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv.at(-1));
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
    const sources = Object.fromEntries(["virtualScroll", "selectionState", "groupTableVirtual", "tableRowHeights", "viewType",
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
