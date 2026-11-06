const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const makeSources = () => {
    const ts = require("typescript");
    const transpile = text => ts.transpileModule(text, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const extract = (name, file) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"),
            ts.ScriptTarget.ES2022, true);
        let declaration;
        const visit = node => {
            if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node;
            ts.forEachChild(node, visit);
        };
        visit(source);
        assert.ok(declaration, `Missing declaration ${name} in ${file}`);
        return transpile(`const ${declaration.getText(source)};`);
    };
    const sources = Object.fromEntries(["virtualScroll", "selectionState", "groupTableVirtual", "tableRowHeights",
        "viewType", "capabilities", "capabilities.generated", "columnWindow", "columnVirtualScroll", "rangeSelect",
        "cellValue", "locationValue", "columnPresentation"].map(name => ["./" + name,
        transpile(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"))]));
    for (const [file, names] of Object.entries({
        row: ["getRowHTML", "getFreezeDragHTML"],
        render: ["getTableHTMLs"],
        cell: ["genCellValue", "renderCell", "renderCellAttr", "cellScrollIntoView", "updateAttrViewCellInOtherElements"],
        col: ["addAttrViewColAnimation", "genColDataByType"],
        dateFormat: ["getDefaultDateFormat"],
        action: ["updateAttrViewCellAnimation", "removeAttrViewColAnimation"],
        keydown: ["avKeydown"],
        locate: ["finishAVLocate"],
        richTextValue: ["getAVTextSource"],
        conditionalColor: ["getConditionalItemStyle", "getConditionalCellStyle", "getConditionalBackground"],
    })) {
        for (const name of names) sources[name] = extract(name, `../src/protyle/render/av/${file}.ts`);
    }
    sources.renderImageBlob = extract("renderImageBlob", "../src/protyle/export/util.ts");
    const sass = require("sass");
    sources.css = sass.compile(path.join(__dirname, "../src/assets/scss/base.scss"), {
        logger: sass.Logger.silent,
    }).css;
    sources.themes = Object.fromEntries(["daylight", "midnight"].map(theme => [theme,
        readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8")]));
    return sources;
};

const browserCases = async sources => {
    const check = require("node:assert/strict");
    const frameQueue = new Map();
    let frameID = 0;
    window.requestAnimationFrame = callback => {
        frameQueue.set(++frameID, callback);
        return frameID;
    };
    window.cancelAnimationFrame = id => frameQueue.delete(id);
    const settle = async () => {
        for (let index = 0; index < 100; index++) {
            await Promise.resolve();
            const pending = [...frameQueue];
            frameQueue.clear();
            pending.forEach(([, callback]) => callback(performance.now()));
            await Promise.resolve();
            if (!frameQueue.size) return;
        }
        check.fail("Combined row/column windows did not settle within 100 frames");
    };
    const constants = {ATTRIBUTE_V_SCROLL: "data-v-scroll", TIMEOUT_LOAD: 0, PROTYLE_CDN: ""};
    const closest = (element, name) => element?.closest?.("." + name) || null;
    window.siyuan = {
        languages: new Proxy({}, {get: (_target, name) => String(name)}),
        config: {keymap: {editor: {general: {newNameFile: "new-file", newNameSettingFile: "new-template"}}}},
        menus: {menu: {element: document.createElement("div"), remove() {}}},
    };
    window.siyuan.menus.menu.element.className = "fn__none";
    const dependencies = {
        "../../../constants": {Constants: constants},
        "./backlinkScroll": {getBacklinkScrollElement: () => null},
        "./richText": {renderAVRichTextElements() {}},
        "../../util/hasClosest": {hasClosestByClassName: closest},
    };
    const load = name => {
        if (!dependencies[name]) {
            check.ok(sources[name], `Unexpected module ${name}`);
            const exports = {};
            dependencies[name] = exports;
            new Function("require", "exports", sources[name])(load, exports);
        }
        return dependencies[name];
    };
    const extract = (name, scope = {}) => new Function(...Object.keys(scope), sources[name] + `\nreturn ${name};`)(
        ...Object.values(scope));
    const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const shared = {Constants: constants, escapeAttr: escape, escapeHtml: escape,
        escapeHtmlTextAndAttr: escape, escapeAriaLabel: escape, ...load("./capabilities"),
        ...load("./cellValue"), ...load("./viewType"), hasClosestByClassName: closest,
        hasClosestBlock: element => element.closest(".av"), renderAVRichTextElements() {},
        renderAVBlockIcon: () => "", getColIconByType: () => "iconText", getCalcValue: () => "",
        updateAVSelectionStatus() {}, addDragFill() {}, matchHotKey: () => false, isMobile: () => false,
    };
    shared.getAVTextSource = extract("getAVTextSource", {AV_RICH_TEXT_SPEC: 1, AV_RICH_TEXT_FORMAT: "markdown"});
    shared.genCellValue = extract("genCellValue", shared);
    shared.renderCell = extract("renderCell", shared);
    shared.renderCellAttr = extract("renderCellAttr", shared);
    shared.getConditionalBackground = extract("getConditionalBackground", {getAVBackgroundColor: () => ""});
    shared.getConditionalItemStyle = extract("getConditionalItemStyle", shared);
    shared.getConditionalCellStyle = extract("getConditionalCellStyle", shared);
    shared.getFreezeDragHTML = extract("getFreezeDragHTML", shared);
    shared.getRowHTML = extract("getRowHTML", shared);
    dependencies["./row"] = {getRowHTML: shared.getRowHTML, updateAVSelectionStatus() {}};
    const virtual = load("./virtualScroll");
    const columns = load("./columnWindow");
    const selection = load("./selectionState");
    const range = load("./rangeSelect");
    Object.assign(shared, virtual, columns, selection, range, load("./groupTableVirtual"), load("./columnPresentation"));
    const renderTable = extract("getTableHTMLs", shared);
    shared.cellScrollIntoView = extract("cellScrollIntoView", shared);
    shared.updateAttrViewCellAnimation = extract("updateAttrViewCellAnimation", shared);
    shared.getDefaultDateFormat = extract("getDefaultDateFormat", shared);
    shared.genColDataByType = extract("genColDataByType", shared);
    shared.getFieldsByData = data => data.view.columns;
    shared.openMenuPanel = () => {};
    const addColumn = extract("addAttrViewColAnimation", shared);
    const updateMirrors = extract("updateAttrViewCellInOtherElements", shared);
    const removeColumn = extract("removeAttrViewColAnimation", shared);
    const keydown = extract("avKeydown", shared);
    const clearSelections = block => {
        range.clearAVCellRange(block);
        range.clearAVItemSelection(block, true);
        document.getSelection().removeAllRanges();
    };
    const themeStyle = document.createElement("style");
    const productStyle = document.createElement("style");
    productStyle.textContent = sources.css;
    const fixtureStyle = document.createElement("style");
    fixtureStyle.textContent = `html,body {display:block;margin:0;height:auto;overflow:visible}
        .fixture-viewport {height:300px;width:660px;overflow:auto;overflow-anchor:none;position:relative}
        .fixture-viewport .protyle-wysiwyg {padding:0;font-size:16px}
        .fixture-viewport .av {width:640px;--b3-parent-background:var(--b3-theme-background)}
        .fixture-viewport .av__body {float:left}`;
    document.head.append(themeStyle, productStyle, fixtureStyle);
    const rowsOf = block => [...block.querySelectorAll(".av__row[data-id]")];
    const close = (actual, expected, message) => check.ok(Math.abs(actual - expected) < 1,
        `${message}: ${actual} != ${expected}`);
    const create = ({rowCount = 60, columnCount = 35, longRows = [], id = "database"} = {}) => {
        const viewport = document.createElement("div");
        viewport.className = "fixture-viewport";
        viewport.innerHTML = `<div class="protyle-wysiwyg"><div class="av" data-type="NodeAttributeView"
            data-node-id="block-${document.querySelectorAll(".av").length}" data-av-id="${id}" data-av-type="table">
            <div class="av__container"><div class="av__scroll"><div class="av__body" data-group-id=""
            data-page-size="100"></div></div></div></div></div>`;
        document.body.append(viewport);
        const block = viewport.querySelector(".av");
        const view = {columns: Array.from({length: columnCount}, (_, index) => ({id: `c${index}`,
            type: index === 0 ? "block" : "text", name: `Column ${index}`, width: "120px",
            pin: index === 1, wrap: true, hidden: false})),
        rows: Array.from({length: rowCount}, (_, row) => ({id: `r${row}`,
            cells: Array.from({length: columnCount}, (_, column) => {
                const type = column === 0 ? "block" : "text";
                const value = {id: `value-${row}-${column}`, keyID: `c${column}`, blockID: `r${row}`, type, isDetached: true,
                    [type]: {content: longRows.includes(row) && column === columnCount - 2 ?
                        "Long wrapped text ".repeat(45) : `Value ${row},${column}`}};
                return {id: value.id, valueType: type, value};
            })})), rowCount, pageSize: 100, showIcon: false};
        const data = {viewType: "table", view, id};
        const protyle = {contentElement: viewport, wysiwyg: {element: document.body}};
        const body = block.querySelector(".av__body");
        body.innerHTML = renderTable(view, block);
        const natural = new Map(rowsOf(block).map(row => [row.dataset.id, row.getBoundingClientRect().height]));
        const fullWidth = block.querySelector(".av__scroll").scrollWidth;
        virtual.initVirtualScroll({protyle, blockElement: block, data});
        return {block, viewport, view, data, protyle, body, natural, fullWidth,
            scroll: block.querySelector(".av__scroll")};
    };
    const dispose = fixture => {
        columns.disposeAVColumnWindow(fixture.block);
        fixture.viewport.remove();
    };
    const scrollRows = async (fixture, top) => {
        fixture.viewport.scrollTop = top;
        virtual.trimAVRowsSync(fixture.block, fixture.viewport.getBoundingClientRect());
        await settle();
    };
    const scrollColumns = async (fixture, left) => {
        fixture.scroll.scrollLeft = left;
        fixture.scroll.dispatchEvent(new Event("scroll"));
        await settle();
    };
    const visibleColumn = (fixture, cell) => {
        check.ok(cell?.isConnected, "Navigation materializes its target cell");
        const rect = cell.getBoundingClientRect();
        const scrollRect = fixture.scroll.getBoundingClientRect();
        const sticky = cell.closest(".av__row").querySelector(".av__colsticky");
        const left = sticky.contains(cell) ? scrollRect.left : sticky.getBoundingClientRect().right;
        check.ok(rect.left >= left - 1 && rect.right <= scrollRect.right + 1,
            `Navigation exposes target column: ${rect.left},${rect.right} within ${left},${scrollRect.right}`);
    };
    const viewportFilled = fixture => {
        const rect = fixture.viewport.getBoundingClientRect();
        const rows = rowsOf(fixture.block);
        check.ok(rows.some(row => row.getBoundingClientRect().bottom > rect.top &&
            row.getBoundingClientRect().top < rect.bottom), "Jump reaches mounted rows without another scroll");
        const first = rows[0];
        const last = rows.at(-1);
        check.ok(first.dataset.index === "0" || first.getBoundingClientRect().top <= rect.top + 1,
            "Stationary frame fills the upper viewport gap");
        check.ok(Number(last.dataset.index) === fixture.view.rows.length - 1 ||
            last.getBoundingClientRect().bottom >= rect.bottom - 1, "Stationary frame fills the lower viewport gap");
    };
    const summaries = [];
    for (const theme of Object.keys(sources.themes)) {
        themeStyle.textContent = sources.themes[theme];
        for (const [rowCount, columnCount, tall] of [[60, 35, false], [100, 22, false],
            [60, 35, true], [100, 22, true]]) {
            const fixture = create({rowCount, columnCount, longRows: tall ? [0, Math.floor(rowCount / 2)] : []});
            await settle();
            const initialRows = rowsOf(fixture.block);
            const first = initialRows[0];
            const initialCells = fixture.block.querySelectorAll(".av__row[data-id] .av__cell").length;
            check.ok(initialRows.length < rowCount, "Initial row window is reduced");
            check.ok(initialCells < initialRows.length * columnCount / 2, "Initial column window is reduced too");
            if (tall) check.ok(fixture.natural.get("r0") > 500, "Product CSS wraps the offscreen tallest text cell");
            check.equal(first.querySelector(`[data-col-id="c${columnCount - 2}"]`), null);
            close(first.getBoundingClientRect().height, fixture.natural.get("r0"), "Offscreen highest cell retains row height");
            const sticky = first.querySelector(".av__colsticky");
            const stickyLeft = sticky.getBoundingClientRect().left;
            for (const left of [fixture.fullWidth, fixture.fullWidth / 2, 0]) {
                await scrollColumns(fixture, left);
                check.equal(first.querySelector(".av__colsticky"), sticky, "Frozen container identity is stable");
                check.ok(sticky.querySelector('[data-col-id="c0"]') && sticky.querySelector('[data-col-id="c1"]'));
                close(sticky.getBoundingClientRect().left, stickyLeft, "Frozen columns stay at the viewport edge");
                close(first.getBoundingClientRect().height, fixture.natural.get("r0"), "Horizontal scroll preserves tallest row");
                close(fixture.scroll.scrollWidth, fixture.fullWidth, "Horizontal scroll preserves width");
            }
            const lastID = `r${rowCount - 1}`;
            for (const top of [fixture.viewport.scrollHeight, 0, fixture.viewport.scrollHeight / 2,
                fixture.viewport.scrollHeight, 0]) {
                await scrollRows(fixture, top);
                viewportFilled(fixture);
                const mounted = rowsOf(fixture.block);
                check.ok(mounted.length <= shared.getTableRowBudget(fixture.view), "Row window respects its cell budget");
                check.ok(mounted.every(row => row.querySelectorAll(".av__cell").length < columnCount),
                    "Rows created during vertical scrolling receive column windows");
            }
            await scrollRows(fixture, fixture.viewport.scrollHeight);
            check.ok(fixture.block.querySelector(`[data-id="${lastID}"]`), "Bottom jump reaches the last loaded row");
            check.equal(first.isConnected, false, "Vertical scrolling unmounts initial rows");
            check.equal(first.querySelectorAll(".av__cell").length, columnCount,
                "Detached rows are restored completely for safe reuse");
            await scrollRows(fixture, 0);
            const returned = fixture.block.querySelector('[data-id="r0"]');
            check.ok(returned && returned !== first, "Returning to the top uses the real row renderer");
            close(returned.getBoundingClientRect().height, fixture.natural.get("r0"), "Recreated tall rows keep measured height");
            summaries.push(`${theme} ${rowCount}x${columnCount}${tall ? " tall" : ""}: ${initialRows.length} rows/${initialCells} cells`);
            dispose(fixture);
            await settle();
        }
    }

    const navigation = create();
    await settle();
    let row = rowsOf(navigation.block)[0];
    const initialColumns = [...row.querySelectorAll(".av__cell")].map(cell => Number(cell.dataset.colId.slice(1)));
    const boundary = Math.max(...initialColumns);
    check.equal(row.querySelector(`[data-col-id="c${boundary + 1}"]`), null);
    range.setAVCellAnchor(navigation.block, row.querySelector(`[data-col-id="c${boundary}"]`));
    const right = new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true});
    check.equal(keydown(right, navigation.block, navigation.protyle, () => false), true);
    await settle();
    let target = row.querySelector(`[data-col-id="c${boundary + 1}"]`);
    visibleColumn(navigation, target);
    check.equal(selection.getAVCellSelection(navigation.block).focus.colID, `c${boundary + 1}`);
    const shifted = new KeyboardEvent("keydown", {key: "ArrowRight", shiftKey: true, cancelable: true});
    keydown(shifted, navigation.block, navigation.protyle, () => false);
    await settle();
    visibleColumn(navigation, row.querySelector(`[data-col-id="c${boundary + 2}"]`));
    check.equal(selection.getAVCellSelection(navigation.block).cells.length, 2, "Shift navigation extends real cell selection");
    clearSelections(navigation.block);
    await scrollColumns(navigation, 0);
    check.equal(row.querySelector('[data-col-id="c20"]'), null);
    const request = {itemID: "r0", keyID: "c20", select: false};
    let located = false;
    const finishLocate = extract("finishAVLocate", {...shared, getAVLocateRequest: () => request,
        clearAVLocateRequest: () => { located = true; }, getBacklinkScrollElement: () => null,
        scrollBacklinkTarget: () => false, scrollCenter() {}});
    const locate = async keyID => {
        request.keyID = keyID;
        located = false;
        const previousLeft = navigation.scroll.scrollLeft;
        finishLocate(navigation.block, navigation.protyle, {...navigation.data,
            target: {itemID: "r0", groupID: "", index: 0, status: "visible"}});
        check.equal(located, true);
        visibleColumn(navigation, row.querySelector(`[data-col-id="${keyID}"]`));
        await settle();
        visibleColumn(navigation, row.querySelector(`[data-col-id="${keyID}"]`));
        if (keyID === "c0") close(navigation.scroll.scrollLeft, previousLeft, "Locating frozen cells preserves horizontal position");
    };
    for (const columnID of ["c20", "c33", "c0"]) await locate(columnID);
    columns.prepareAVColumnWindow(navigation.block);
    const covered = row.querySelector('[data-col-id="c20"]');
    await scrollColumns(navigation, navigation.scroll.scrollLeft + covered.getBoundingClientRect().left -
        navigation.scroll.getBoundingClientRect().left - 100);
    const coveredRect = covered.getBoundingClientRect();
    check.ok(coveredRect.left > navigation.scroll.getBoundingClientRect().left &&
        coveredRect.right < row.querySelector(".av__colsticky").getBoundingClientRect().right,
    "The locate target can be inside the scroller but entirely covered by frozen columns");
    await locate("c20");
    clearSelections(navigation.block);
    dispose(navigation);
    await settle();

    const firstMirror = create();
    const secondMirror = create();
    await settle();
    const value = {id: "edited-value", type: "text", text: {content: "New value from mirror A"}};
    columns.ensureAVColumnWindow(firstMirror.block, "c33", "r0");
    const source = firstMirror.block.querySelector('[data-id="r0"] [data-col-id="c33"]');
    check.equal(secondMirror.block.querySelector('[data-id="r0"] [data-col-id="c33"]'), null,
        "Mirror B starts with its edited column detached");
    shared.updateAttrViewCellAnimation(source, value);
    updateMirrors(firstMirror.protyle, "database", "r0", "c33", value, source);
    await settle();
    await scrollColumns(secondMirror, secondMirror.fullWidth);
    check.equal(secondMirror.block.querySelector('[data-id="r0"] [data-col-id="c33"] .av__celltext').textContent,
        value.text.content, "Horizontal scrolling shows the propagated value rather than cached stale content");
    await scrollRows(secondMirror, secondMirror.viewport.scrollHeight);
    await scrollRows(secondMirror, 0);
    check.equal(secondMirror.block.querySelector('[data-id="r0"] [data-col-id="c33"] .av__celltext').textContent,
        value.text.content, "Newly rendered rows use the updated model value");
    await scrollColumns(secondMirror, 0);
    check.equal(secondMirror.block.querySelector('[data-id="r0"] [data-col-id="c32"]'), null);
    removeColumn(firstMirror.block, "c32");
    await settle();
    for (const fixture of [firstMirror, secondMirror]) {
        for (const left of [fixture.fullWidth, 0, fixture.fullWidth / 2]) await scrollColumns(fixture, left);
        columns.prepareAVColumnWindow(fixture.block);
        const remaining = fixture.view.columns.map(column => column.id).filter(id => id !== "c32");
        check.equal(fixture.block.querySelector('.av__cell[data-col-id="c32"]'), null,
            "Deleted offscreen columns cannot reappear from the column cache");
        rowsOf(fixture.block).forEach(item => check.deepEqual([...item.querySelectorAll(".av__cell")]
            .map(cell => cell.dataset.colId), remaining, "Deleting one column preserves every other column"));
    }
    await scrollRows(secondMirror, secondMirror.viewport.scrollHeight);
    await scrollRows(secondMirror, 0);
    columns.prepareAVColumnWindow(secondMirror.block);
    check.equal(secondMirror.block.querySelector('.av__cell[data-col-id="c32"]'), null,
        "New rows in mirror B cannot resurrect a deleted column while awaiting the next server render");
    rowsOf(secondMirror.block).forEach(item => check.deepEqual([...item.querySelectorAll(".av__cell")]
        .map(cell => cell.dataset.colId), firstMirror.view.columns.map(column => column.id).filter(id => id !== "c32"),
    "Vertical rerender preserves every surviving column in its original order"));
    firstMirror.view.columns.splice(firstMirror.view.columns.findIndex(column => column.id === "c31"), 1);
    removeColumn(firstMirror.block, "c31");
    await settle();
    for (const fixture of [firstMirror, secondMirror]) {
        await scrollRows(fixture, fixture.viewport.scrollHeight);
        await scrollRows(fixture, 0);
        columns.prepareAVColumnWindow(fixture.block);
        const surviving = Array.from({length: 35}, (_, index) => `c${index}`).filter(id => !["c31", "c32"].includes(id));
        rowsOf(fixture.block).forEach(item => {
            check.deepEqual([...item.querySelectorAll(".av__cell")].map(cell => cell.dataset.colId), surviving,
                "Deleting after the source field list is spliced keeps both mirrors aligned");
            check.equal(item.querySelector('[data-col-id="c34"] .av__celltext').textContent,
                `Value ${item.dataset.index},34`, "Surviving cell values remain under their matching columns");
        });
        check.equal(fixture.view.rows[0].cells.length, surviving.length);
    }
    dispose(firstMirror);
    dispose(secondMirror);
    await settle();

    const removedFrozenBoundary = create();
    try {
        await settle();
        removeColumn(removedFrozenBoundary.block, "c1");
        await settle();
        await scrollRows(removedFrozenBoundary, removedFrozenBoundary.viewport.scrollHeight);
        await scrollRows(removedFrozenBoundary, 0);
        columns.prepareAVColumnWindow(removedFrozenBoundary.block);
        const header = removedFrozenBoundary.block.querySelector(".av__row--header");
        const frozenIDs = item => [...item.querySelectorAll(".av__colsticky .av__cell")]
            .map(cell => cell.dataset.colId);
        rowsOf(removedFrozenBoundary.block).forEach(item => {
            check.deepEqual(frozenIDs(item), frozenIDs(header),
                "Removing the freeze boundary keeps recreated rows aligned with the header's frozen columns");
            check.deepEqual(frozenIDs(item), [], "Removing the only pinned column clears the frozen range");
        });
        check.equal(header.querySelector(".av__colsticky--freeze"), null,
            "The header drops its obsolete frozen container after the boundary is deleted");
        check.equal(header.querySelector(".block__icons").dataset.pinindex, "-1",
            "The header records the cleared freeze boundary");
    } finally {
        dispose(removedFrozenBoundary);
        await settle();
    }

    const insertionFailures = [];
    for (const [previousID, metadataInserted] of [["c20", false], ["c0", false], ["c1", false], ["c20", true]]) {
        const fixture = create();
        try {
            await settle();
            const id = "inserted-text";
            const expected = Array.from({length: 35}, (_, index) => `c${index}`);
            expected.splice(expected.indexOf(previousID) + 1, 0, id);
            if (metadataInserted) {
                fixture.view.columns.splice(fixture.view.columns.findIndex(column => column.id === previousID) + 1,
                    0, shared.genColDataByType("text", id, "Inserted text"));
            }
            addColumn({blockElement: fixture.block, protyle: fixture.protyle, type: "text",
                name: "Inserted text", id, previousID, data: metadataInserted ? fixture.data : undefined});
            columns.prepareAVColumnWindow(fixture.block);
            const checkOrder = message => rowsOf(fixture.block).forEach(item => {
                check.deepEqual([...item.querySelectorAll(".av__cell")].map(cell => cell.dataset.colId), expected, message);
                const stickyColumns = [...item.querySelectorAll(".av__colsticky .av__cell")].map(cell => cell.dataset.colId);
                check.deepEqual(stickyColumns, previousID === "c0" ? ["c0", id, "c1"] : ["c0", "c1"],
                    "Insertion preserves the frozen boundary and exact column order");
                check.equal(item.querySelector('[data-col-id="c34"] .av__celltext').textContent,
                    `Value ${item.dataset.index},34`, "Insertion does not shift existing values into the new column");
            });
            checkOrder("New columns appear immediately in existing rows");
            await settle();
            await scrollRows(fixture, fixture.viewport.scrollHeight);
            await scrollRows(fixture, 0);
            columns.prepareAVColumnWindow(fixture.block);
            checkOrder("Columns inserted after an offscreen anchor survive vertical row recreation");
            check.equal(fixture.view.rows[0].cells.length, 36, "Insertion updates the loaded row models");
            check.equal(fixture.view.columns.filter(column => column.id === id).length, 1,
                "Preinserted metadata remains unique while missing row cells are added");
        } catch (error) {
            insertionFailures.push(`After ${previousID}${metadataInserted ? " with metadata already present" : ""}: ${error.stack}`);
        } finally {
            dispose(fixture);
            await settle();
        }
    }
    check.equal(insertionFailures.length, 0, insertionFailures.join("\n"));

    for (const safari of [false, true]) {
        for (const failed of [false, true]) {
            const fixture = create();
            await settle();
            let finish;
            let started = false;
            const cloning = new Promise((resolve, reject) => { finish = failed ? reject : resolve; });
            const clone = () => { started = true; return cloning; };
            window.htmlToImage = {toBlob: clone};
            window.modernScreenshot = {domToBlob: clone};
            const renderImage = extract("renderImageBlob", {...shared, previewElement: fixture.viewport,
                exportDialog: {element: {querySelector: () => fixture.viewport}},
                updateExportImageLayout() {}, getExportImageSize: () => ({width: 640, height: 300}),
                isExportImageSizeSupported: () => true, isIPhone: () => false, isIPad: () => false,
                isSafari: () => safari, addScript: async () => {}, getExportImageLocalFontCSS: () => "",
                getExportImageFontCSS: async () => "", IMAGE_PLACEHOLDER: "placeholder"});
            const pending = renderImage();
            while (!started) await new Promise(resolve => setTimeout(resolve, 0));
            const fullRows = () => check.ok(rowsOf(fixture.block).every(item =>
                item.querySelectorAll(".av__cell").length === fixture.view.columns.length));
            fullRows();
            await scrollColumns(fixture, fixture.fullWidth);
            await scrollRows(fixture, fixture.viewport.scrollHeight);
            fullRows();
            check.ok(fixture.block.querySelector('[data-id="r59"]'), "Export suspension covers newly rendered rows too");
            if (failed) {
                finish(new Error("Synthetic screenshot failure"));
                await check.rejects(pending, /Synthetic screenshot failure/);
            } else {
                finish("image-blob");
                check.equal(await pending, "image-blob");
            }
            await settle();
            check.ok(rowsOf(fixture.block).every(item => item.querySelectorAll(".av__cell").length < 35),
                "Screenshot success and failure both release column suspension");
            dispose(fixture);
            await settle();
        }
    }
    return {passed: true, summaries};
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv.at(-1));
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const sources = makeSources();
    const win = new BrowserWindow({show: false, width: 1000, height: 900,
        webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("about:blank");
        const result = await win.webContents.executeJavaScript(`(async () => {
            try { return await (${browserCases.toString()})(${JSON.stringify(sources)}); }
            catch (error) { return {error: error.stack}; }
        })()`);
        assert.equal(result.passed, true, result.error);
        console.log("Combined database windows passed: " + result.summaries.join("; "));
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
    require("node:test").test("real table and cell renderers integrate row/column windows, navigation, mirrors and export", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 90000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-window-integration-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 80000});
            assert.match(stdout, /Combined database windows passed/);
            console.log(stdout.trim());
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-window-integration-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
