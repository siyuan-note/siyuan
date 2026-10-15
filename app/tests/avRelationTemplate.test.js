const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = sources => {
    const assert = require("node:assert/strict");
    const escape = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    window.siyuan = {languages: {untitled: "Untitled"}, config: {editor: {allowHTMLBLockScript: false}}};
    const sanitized = [];
    window.DOMPurify = {sanitize: content => {
        sanitized.push(content);
        return content;
    }};
    const dependencies = {
        "../../../plugin/Menu": {Menu: class {
            constructor(_id, closeCB) {
                this.closeCB = closeCB;
                this.element = document.createElement("div");
                this.element.innerHTML = "<div></div>";
                document.body.appendChild(this.element);
            }
            open() {}
            close() { this.closeCB(); this.element.remove(); }
        }},
        "./col": {getColIconByType: () => "iconText"},
        "../../../emoji": {unicode2Emoji: () => ""},
        "../../util/compatibility": {setStorageVal: () => {}},
        "../../../util/escape": {escapeAttr: escape, escapeHtml: escape, escapeHtmlTextAndAttr: escape},
        "../../../emoji/fileTreeIcon": {getFileTreeIconHTML: () => ""},
        "../../../util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: true})},
    };
    const load = name => {
        if (!dependencies[name]) {
            const exports = {};
            dependencies[name] = exports;
            if (sources[name]) {
                new Function("require", "exports", sources[name])(load, exports);
            }
        }
        return dependencies[name];
    };
    const {renderCell, genCellValueByElement} = load("./cell");
    const {bindKeyboard} = load("./relationKeyboardBinding");
    const keyboardList = document.createElement("div");
    keyboardList.innerHTML = '<div><div data-type="setRelationCell" data-relation-type="selected" class="b3-menu__item--current">Selected one</div>' +
        '<div data-type="setRelationCell" data-relation-type="selected">Selected two</div></div>' +
        '<div><div data-type="setRelationCell" data-relation-type="candidate">Match</div></div>' +
        '<button data-type="setRelationCell" data-relation-type="create">Create</button>' +
        '<button data-type="setRelationCell" data-relation-type="create" disabled>Disabled</button>';
    document.body.replaceChildren(keyboardList);
    const keyboardInput = document.createElement("input");
    keyboardInput.value = "query";
    const keyboardState = {keyword: "query", loading: false, page: 1};
    const activated = [];
    bindKeyboard(keyboardList, keyboardInput, keyboardState, (_protyle, _block, item) => activated.push(item));
    const press = (key, input = keyboardInput, isComposing = false) => {
        const event = new KeyboardEvent("keydown", {key, cancelable: true, isComposing});
        input.dispatchEvent(event);
        return event;
    };
    press("Enter");
    assert.equal(activated.at(-1).dataset.relationType, "candidate");
    press("ArrowDown");
    press("Enter");
    assert.equal(activated.at(-1).textContent, "Create");
    press("ArrowDown");
    press("Enter");
    assert.equal(activated.at(-1).dataset.relationType, "candidate");
    keyboardList.querySelector('[data-relation-type="candidate"]').remove();
    press("Enter");
    assert.equal(activated.at(-1).dataset.relationType, "create");
    assert.ok(activated.every(item => item.dataset.relationType !== "selected"));
    const beforePending = activated.length;
    keyboardState.loading = true;
    keyboardState.page = 0;
    assert.equal(press("Enter").defaultPrevented, true);
    keyboardState.loading = false;
    press("Enter");
    keyboardState.page = 1;
    keyboardInput.value = "changed";
    press("Enter");
    keyboardInput.value = "query";
    press("Enter", keyboardInput, true);
    const pendingInput = document.createElement("input");
    pendingInput.value = "query";
    bindKeyboard(keyboardList, pendingInput, keyboardState, () => activated.push(null), 1);
    assert.equal(press("Enter", pendingInput).defaultPrevented, true);
    assert.equal(activated.length, beforePending);
    keyboardList.querySelector('[data-relation-type="create"]').setAttribute("disabled", "");
    press("Enter");
    assert.equal(activated.length, beforePending);
    keyboardInput.value = keyboardState.keyword = "";
    press("ArrowDown");
    press("Enter");
    assert.equal(activated.at(-1).textContent, "Selected one");
    assert.equal(keyboardList.querySelectorAll('[data-relation-type="selected"]').length, 2);
    const {deselect} = load("./relationSelection");
    const selectionMenu = document.createElement("div");
    selectionMenu.innerHTML = `<div data-relation-type="selectedRows"><div data-relation-type="selected" data-row-id="one" draggable="true">
<span class="av__relation-table-check"><svg><use xlink:href="#iconCheck"></use></svg></span>
<span class="av__relation-table-primary"><svg class="fn__grab"></svg><span class="b3-menu__label" data-content="One">One</span></span>
</div></div><div data-relation-type="candidateRows"><div data-relation-type="candidate" data-row-id="two">Two</div></div>`;
    document.body.replaceChildren(selectionMenu);
    const deselectedRow = selectionMenu.querySelector('[data-row-id="one"]');
    let refreshed = false;
    selectionMenu.addEventListener("relationrefresh", () => {
        refreshed = true;
    });
    deselect(deselectedRow, selectionMenu, (_protyle, _node, value) => {
        assert.deepEqual(value.blockIDs, []);
        assert.deepEqual(value.contents, []);
    });
    assert.equal(refreshed, true);
    assert.equal(selectionMenu.querySelectorAll("[data-row-id]").length, 2);
    assert.equal(deselectedRow.parentElement.dataset.relationType, "candidateRows");
    assert.equal(deselectedRow.hasAttribute("draggable"), false);
    assert.equal(deselectedRow.querySelector(".fn__grab"), null);
    assert.equal(deselectedRow.querySelector("use").getAttribute("xlink:href"), "#iconUncheck");
    const {createPosition} = load("./relationPosition");
    for (const rowClass of ["av__row", "av__gallery-item", "av__calendar-item", ""]) {
        const blockElement = document.createElement("div");
        const attribute = rowClass === "av__gallery-item" ? "data-field-id" : "data-col-id";
        const markup = rowClass ? `<div class="${rowClass}" data-id="row"><div ${attribute}="column"></div></div>` :
            `<div data-row-id="row" ${attribute}="column"></div>`;
        blockElement.innerHTML = markup;
        document.body.replaceChildren(blockElement);
        const cell = blockElement.querySelector(`[${attribute}]`);
        cell.getBoundingClientRect = () => ({left: 200, bottom: 300, width: 100, height: 30});
        const positions = [];
        let resets = 0;
        const position = createPosition({blockElement, cellElements: [cell], menuElement: {}},
            () => resets++, (_menu, left, bottom, height) => positions.push([left, bottom, height]));
        position();
        blockElement.innerHTML = markup;
        cell.getBoundingClientRect = () => ({left: 0, bottom: 0, width: 0, height: 0});
        const replacement = blockElement.querySelector(`[${attribute}]`);
        replacement.getBoundingClientRect = () => ({left: 220, bottom: 320, width: 100, height: 30});
        position(true);
        replacement.getBoundingClientRect = () => ({left: 0, bottom: 0, width: 0, height: 0});
        position(true);
        blockElement.replaceChildren();
        position(true);
        assert.deepEqual(positions, [[200, 300, 30], [220, 320, 30], [220, 320, 30], [220, 320, 30]]);
        assert.equal(resets, 3);
    }
    const {genAVValueHTML, getAVTemplateInteractiveElement} = load("./attributeValue");
    for (const isDetached of [true, false]) {
        for (const renderedContent of [undefined, "", '<b>Formatted</b><a href="https://example.com">Link</a>']) {
            const item = {type: "block", id: "value", keyID: "primary", blockID: "row", isDetached,
                block: {content: "Raw <title>", id: "bound-block", refSubtype: "s"},
                ...(renderedContent === undefined ? {} : {hasRenderTemplate: true}),
                ...(renderedContent ? {renderedContent} : {})};
            const relation = {type: "relation", relation: {blockIDs: ["row"], contents: [item]}};
            for (const layout of ["table", "list", "calendar", "gallery", "kanban", "attributes"]) {
                const cell = document.createElement("div");
                cell.innerHTML = layout === "attributes" ? genAVValueHTML(relation) :
                    renderCell(relation, 0, true, layout);
                document.body.replaceChildren(cell);
                const label = cell.querySelector(".av__celltext");
                assert.equal(label.textContent, renderedContent === undefined ? "Raw <title>" :
                    renderedContent ? "FormattedLink" : "");
                assert.equal(label.classList.contains("av__celltext--template"), renderedContent !== undefined);
                const recovered = genCellValueByElement("relation", cell);
                assert.deepEqual(recovered.relation.blockIDs, ["row"]);
                assert.equal(recovered.relation.contents[0].block.content, "Raw <title>");
                assert.equal(recovered.relation.contents[0].blockID, "row");
                assert.equal(recovered.relation.contents[0].hasRenderTemplate, undefined);
                assert.equal(recovered.relation.contents[0].renderedContent, undefined);
                if (!isDetached) {
                    assert.equal(label.dataset.id, "bound-block");
                    assert.equal(label.dataset.subtype, "s");
                }
                if (renderedContent) {
                    assert.equal(getAVTemplateInteractiveElement(label.querySelector("a")), label.querySelector("a"));
                }
            }
        }
    }
    assert.ok(sanitized.includes(""));
    assert.ok(sanitized.some(content => content.includes("<b>Formatted</b>")));
    window.siyuan.storage = {};
    const {bindRelationLayout} = load("./relationLayout");
    const root = document.createElement("div");
    root.innerHTML = '<button data-type="relationFields"></button>' +
        '<div class="av__relation-table-header"><span data-relation-column="primary"></span><span data-relation-column="other"></span></div>' +
        '<div class="av__relation-table-row"><span data-relation-column="primary">Entry</span><span data-relation-column="other">Value</span></div>';
    const columns = [{id: "primary", name: "Title"}, {id: "other", name: "Other"}];
    const update = bindRelationLayout(root, "database", () => {});
    update(columns, "32px 240px 160px");
    root.querySelector("button").click();
    const fields = () => document.querySelector(".av__relation-fields");
    assert.equal(root.contains(fields()), false);
    assert.equal(root.querySelector("button").getAttribute("aria-expanded"), "true");
    assert.equal(fields().querySelector('[data-column="primary"]').getAttribute("aria-disabled"), "true");
    const other = fields().querySelector('[data-column="other"]');
    other.click();
    assert.equal(root.querySelectorAll('[data-relation-column="other"].fn__none').length, 2);
    assert.equal(fields().querySelector("input"), null);
    assert.equal(fields().querySelector('[data-column="other"] .b3-menu__action use').getAttribute("xlink:href"), "#iconEye");
    assert.deepEqual(window.siyuan.storage["local-av-relation-layout"].database.hidden, ["other"]);
    update(columns, "32px 240px 160px");
    update.close();
    assert.equal(fields(), null);
    assert.equal(root.querySelector("button").getAttribute("aria-expanded"), "false");
    window.siyuan.storage["local-av-relation-layout"].database.widths.primary = 360;
    const reopened = root.cloneNode(true);
    bindRelationLayout(reopened, "database", () => {})(columns, "32px 240px 160px");
    assert.equal(reopened.querySelectorAll('[data-relation-column="other"].fn__none').length, 2);
    assert.match(reopened.querySelector(".av__relation-table-row").style.gridTemplateColumns, /360px/);
    const independent = root.cloneNode(true);
    bindRelationLayout(independent, "another", () => {})(columns, "32px 240px 160px");
    assert.equal(independent.querySelectorAll('[data-relation-column="other"].fn__none').length, 0);
    const many = [...columns, {id: "third", name: "Third"}, {id: "fourth", name: "Fourth"}, {id: "fifth", name: "Fifth"}];
    const defaults = root.cloneNode(true);
    const updateDefaults = bindRelationLayout(defaults, "defaults", () => {});
    updateDefaults(many, "32px 240px 160px 160px 160px 160px");
    defaults.querySelector("button").click();
    assert.equal(fields().querySelector('[data-column="fourth"] .b3-menu__action use').getAttribute("xlink:href"), "#iconEyeoff");
    assert.equal(fields().querySelector('[data-column="fifth"] .b3-menu__action use').getAttribute("xlink:href"), "#iconEye");
    fields().querySelector('[data-column="fifth"]').click();
    assert.deepEqual(window.siyuan.storage["local-av-relation-layout"].defaults.hidden, []);
    updateDefaults(many, "32px 240px 160px 160px 160px 160px");
    assert.equal(fields().querySelector('[data-column="fifth"] .b3-menu__action use').getAttribute("xlink:href"), "#iconEyeoff");
    fields().querySelector('[data-all="hide"]').click();
    assert.deepEqual(window.siyuan.storage["local-av-relation-layout"].defaults.hidden, ["other", "third", "fourth", "fifth"]);
    fields().querySelector('[data-all="show"]').click();
    assert.deepEqual(window.siyuan.storage["local-av-relation-layout"].defaults.hidden, []);
    defaults.querySelectorAll(".av__relation-table-header, .av__relation-table-row").forEach(row => {
        for (const id of ["third", "fourth", "fifth"]) {
            const cell = document.createElement("span");
            cell.dataset.relationColumn = id;
            row.append(cell);
        }
    });
    const dragField = (source, target) => {
        const transfer = new DataTransfer();
        const from = fields().querySelector(`[data-column="${source}"]`);
        const to = fields().querySelector(`[data-column="${target}"]`);
        from.dispatchEvent(new DragEvent("dragstart", {bubbles: true, cancelable: true, dataTransfer: transfer}));
        to.dispatchEvent(new DragEvent("dragover", {bubbles: true, cancelable: true, dataTransfer: transfer,
            clientY: to.getBoundingClientRect().top - 1}));
        to.dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    };
    dragField("fourth", "other");
    const order = element => Array.from(element.querySelectorAll(".av__relation-table-header [data-relation-column]"))
        .map(cell => cell.dataset.relationColumn);
    assert.deepEqual(order(defaults), ["primary", "fourth", "other", "third", "fifth"]);
    assert.deepEqual(window.siyuan.storage["local-av-relation-layout"].defaults.order, order(defaults));
    dragField("other", "primary");
    dragField("primary", "third");
    assert.deepEqual(order(defaults), ["primary", "fourth", "other", "third", "fifth"]);
    const childChanges = new MutationObserver(() => {});
    childChanges.observe(defaults, {childList: true, subtree: true});
    updateDefaults(many, "32px 240px 120px 130px 140px 150px");
    assert.equal(childChanges.takeRecords().length, 0);
    childChanges.disconnect();
    assert.match(defaults.querySelector(".av__relation-table-header").style.gridTemplateColumns, /140px 120px 130px 150px/);
    updateDefaults.close();
    const restored = defaults.cloneNode(true);
    restored.querySelectorAll('[data-relation-column="third"]').forEach(cell => {
        cell.dataset.relationColumn = "new";
    });
    const restoreLayout = bindRelationLayout(restored, "defaults", () => {});
    restoreLayout([many[0], many[1], many[3], many[4], {id: "new", name: "New"}], "32px 240px 120px 140px 150px 160px");
    assert.deepEqual(order(restored), ["primary", "fourth", "other", "fifth", "new"]);
    const style = document.createElement("style");
    style.textContent = sources.relationCSS;
    document.head.append(style);
    const preview = document.createElement("div");
    preview.className = "av__relation-panel";
    const {renderRow} = load("./relationPreview");
    const previewColumns = [{id: "primary", type: "block"}, {id: "text", type: "text", wrap: true}];
    for (const fontSize of [14, 24]) {
        preview.style.fontSize = fontSize + "px";
        preview.innerHTML = ["", "Text", "First\nSecond\nThird", '<img src=x onerror="bad()">'].map(text =>
            renderRow({id: "row", cells: [{value: {type: "block", keyID: "primary", isDetached: true,
                block: {content: "Entry"}}}, {value: {type: "text", keyID: "text", text: {content: text}}}]},
            previewColumns, "candidate", "32px 180px 100px")).join("");
        document.body.append(preview);
        const heights = Array.from(preview.querySelectorAll(".av__relation-table-row")).map(row => row.getBoundingClientRect().height);
        assert.ok(heights.every(height => height === heights[0]));
        assert.equal(preview.querySelectorAll('[data-wrap="true"]').length, 0);
        assert.equal(preview.querySelectorAll("img").length, 0);
        assert.equal(preview.children[2].querySelector('[data-dtype="text"]').title, "First\nSecond\nThird");
    }
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
        const sources = Object.fromEntries(["cell", "cellValue", "attributeValue", "blockIcon", "relationLayout", "relationKeyboard", "capabilities", "capabilities.generated"].map(name => ["./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        const relationSource = readFileSync(path.join(__dirname, "../src/protyle/render/av/relation.ts"), "utf8");
        const keyboardStart = relationSource.indexOf('    inputElement.addEventListener("keydown", (event) => {');
        const keyboardEnd = relationSource.indexOf('    inputElement.addEventListener("input",', keyboardStart);
        assert.ok(keyboardStart > 0 && keyboardEnd > keyboardStart);
        sources["./relationKeyboardBinding"] = ts.transpileModule(`
const {getRelationKeyboardTarget} = require("./relationKeyboard");
export const bindKeyboard = (listElement, inputElement, state, setRelationCell, searchTimer) => {
const options = {menuElement: listElement, cellElements: []};
${relationSource.slice(keyboardStart, keyboardEnd)} };`,
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        const rowStart = relationSource.indexOf("const genRelationRowHTML =");
        const rowEnd = relationSource.indexOf("const genRelationRowsHTML =", rowStart);
        sources["./relationPreview"] = ts.transpileModule(`
const escapeAttr = require("../../../util/escape").escapeAttr;
const escapeHtmlTextAndAttr = require("../../../util/escape").escapeHtmlTextAndAttr;
const getRelationPrimaryCell = row => row.cells[0];
const hasAVRenderTemplateResult = () => false;
const getAVBlockIconHTML = () => "";
const getCellValueText = value => value.text.content;
${relationSource.slice(rowStart, rowEnd)}
export const renderRow = genRelationRowHTML;`,
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        const avCSS = readFileSync(path.join(__dirname, "../src/assets/scss/business/_av.scss"), "utf8");
        sources.relationCSS = require("sass").compileString(avCSS.slice(avCSS.indexOf(".av__relation-panel {"),
            avCSS.indexOf(".av__option-colors {"))).css;
        const valueStart = relationSource.indexOf("const getRelationValue =");
        const valueEnd = relationSource.indexOf("const genCreatedRelationRowHTML =", valueStart);
        const deselectStart = relationSource.indexOf('            target.dataset.relationType = "candidate";');
        const deselectEnd = relationSource.indexOf("        } else if (rowId)", deselectStart);
        assert.ok(valueStart > 0 && valueEnd > valueStart && deselectStart > 0 && deselectEnd > deselectStart);
        sources["./relationSelection"] = ts.transpileModule(
            `${relationSource.slice(valueStart, valueEnd)}
export const deselect = (target, menuElement, updateCellsValue) => { const protyle = {}, nodeElement = {}, cellElements = [];
${relationSource.slice(deselectStart, deselectEnd)} };`,
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        const positionStart = relationSource.indexOf("    let anchorElement =");
        const positionEnd = relationSource.indexOf("    const resize =", positionStart);
        assert.ok(positionStart > 0 && positionEnd > positionStart);
        sources["./relationPosition"] = ts.transpileModule(
            `export const createPosition = (options, resetPosition, setPosition) => { let positionInitialized = false;
${relationSource.slice(positionStart, positionEnd)} return positionMenu; };`,
            {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
        await win.loadURL("data:text/html,<html><body></body></html>");
        const failure = await win.webContents.executeJavaScript(`Promise.resolve().then(() =>
            (${runCases.toString()})(${JSON.stringify(sources)})).then(() => null, error => error.stack || String(error))`);
        assert.equal(failure, null);
        console.log("AV relation template cases passed");
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
    require("node:test").it("renders related primary templates while retaining raw values and navigation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-relation-template-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV relation template cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-relation-template-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
