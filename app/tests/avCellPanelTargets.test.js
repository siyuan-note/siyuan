const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");

const directory = path.join(__dirname, "../src/protyle/render/av");
const compile = text => ts.transpileModule(text, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const extract = (file, names) => {
    const source = ts.createSourceFile(file, readFileSync(path.join(directory, file), "utf8"),
        ts.ScriptTarget.ES2022, true);
    const statements = source.statements.filter(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
    assert.equal(statements.length, names.length, file);
    return statements.map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
};
const functions = [
    extract("cell.ts", ["getStoredCellValueByElement", "genCellValueByElement", "genCellValue",
        "createCellInputTarget", "captureAVCellInput", "updateCellsValue"]),
    extract("openMenuPanel.ts", ["openMenuPanel"]),
    extract("date.ts", ["bindDateEvent", "getFullYearTime"]),
    extract("lunarDate.ts", ["bindLunarDateEvent"]),
    extract("panels/date.ts", ["datePanel"]),
    extract("select.ts", ["bindSelectEvent", "removeCellOption", "addColOptionOrCell", "setColOption"]),
    extract("relation.ts", ["getRelationCellScope", "getRelationValue", "setRelationCell"]),
    extract("asset.ts", ["getVisibleAssetValues", "isAssetCellMenuCurrent", "getAssetHTML", "resolveAssetCellElement", "updateAssetCell", "editAssetItem",
        "captureAssetCellUpload", "captureAVAssetUploadHandler", "getUploadedAssetValues"]),
].join("\n");
const compiledFunctions = compile(functions);
const modules = new Map();
const load = name => {
    if (!modules.has(name)) {
        const exports = {};
        runInNewContext(compile(readFileSync(path.join(directory, `${name}.ts`), "utf8")), {
            exports, require: dependency => load(dependency.replace(/^\.\//, "")),
        });
        modules.set(name, exports);
    }
    return modules.get(name);
};
const plain = value => JSON.parse(JSON.stringify(value));
const element = (dataset = {}, classes = []) => {
    const classNames = new Set(classes);
    const result = Object.assign(new EventTarget(), {
        dataset, isConnected: true, style: {}, textContent: "", clientHeight: 20,
        classList: {add: name => classNames.add(name), remove: name => classNames.delete(name),
            contains: name => classNames.has(name)},
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        focus() {}, select() {}, remove() {this.isConnected = false;}, insertAdjacentHTML() {},
        getBoundingClientRect: () => ({left: 0, top: 0, bottom: 30, width: 200, height: 30}),
    });
    const key = name => name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result.getAttribute = name => result.dataset[key(name)] ?? null;
    result.setAttribute = (name, value) => {result.dataset[key(name)] = value;};
    result.removeAttribute = name => {delete result.dataset[key(name)];};
    result.hasAttribute = name => key(name) in result.dataset;
    return result;
};
const option = content => ({content, color: "1"});
const asset = name => ({type: "file", name, content: `assets/${name}.txt`});
const relation = id => ({blockIDs: [id], contents: [{type: "block", block: {content: id}, isDetached: true}]});

const fixture = (type, {count = 1, batch = "", groups = false, cached = true, related = false} = {}) => {
    const transactions = [];
    const dateBindings = [];
    const datePositionBindings = [];
    const getInlineDateType = input => input.dataset.datePickerType || input.type;
    const getInlineDateValue = input => getInlineDateType(input) === "datetime-local" ? input.value.replace(" ", "T") : input.value;
    const setInlineDateValue = (input, value) => {
        const type = getInlineDateType(input);
        const normalized = type === "datetime-local" ? value.replace(" ", "T") : value;
        input.value = type === "datetime-local" && load("../../../datePicker/model").validateDateValue(normalized, {type, step: "any"}) === "valid" ?
            normalized.replace("T", " ") : value;
    };
    const validateInlineDateInput = input => {
        const type = getInlineDateType(input);
        const value = type === "datetime-local" ? input.value.replace(" ", "T") : input.value;
        return load("../../../datePicker/model").validateDateValue(value, {
            type, min: input.min, max: input.max, step: input.step, required: input.required,
            stepBase: input.defaultValue || "",
        }) === "valid";
    };
    const owner = {contains: () => true};
    const values = Array.from({length: count}, (_, index) => ({
        id: `value-${index}`, keyID: "column", blockID: `row-${index}`, type,
        ...(type === "date" ? {date: {content: 123 + index, isNotEmpty: true, isNotTime: true}} :
            type === "relation" ? {relation: relation(`old-${index}`)} :
            type === "mAsset" ? {mAsset: [asset(`old-${index}`)]} : {mSelect: [option(`old-${index}`)]}),
    }));
    const columns = [{id: "column", type, options: [{name: "new", color: "1"}]}];
    const rows = values.map((value, index) => ({id: `row-${index}`, cells: [{id: value.id, value, valueType: type}]}));
    const view = {id: groups ? "group-a" : "view", columns, rows};
    const state = {data: cached ? {id: "database", viewType: "table", viewID: "view",
        view: groups ? {id: "view", columns, groups: [view]} : view} : undefined};
    if (related) state.relationHost = {viewID: "view", sourceBlockID: "source-block", active: true, available: true,
        readonly: () => false, relationContext: {sourceAvID: "source", sourceItemID: "source-row", relationKeyID: "relation-key"}};
    const block = element({avId: "database", nodeId: "carrier", avType: "table"});
    const protyle = {block: {rootID: "document"}, options: {upload: {filename: name => name}}, disabled: false, toolbar: {}};
    const cells = values.map((value, index) => {
        const cell = element({id: value.id, colId: "column", dtype: type,
            cellValue: encodeURIComponent(JSON.stringify(value)),
            ...(!cached || batch ? {avId: "database", rowId: `row-${index}`, type} : {}),
            ...(batch ? {avBatchOriginalValue: encodeURIComponent(JSON.stringify(value)), avBatchMode: batch} : {}),
        });
        cell.row = element({id: `row-${index}`});
        cell.group = element({groupId: groups && !batch ? "group-a" : ""});
        cell.closest = selector => selector.includes("av__body") ? cell.group :
            selector.includes("av__row") ? cell.row : null;
        return cell;
    });
    const mounted = [...cells];
    block.contains = cell => mounted.includes(cell) && cell.isConnected;
    block.querySelector = selector => selector.includes("av-search") ? null : mounted.find(cell =>
        cell.isConnected && selector.includes(`data-id="${cell.row.dataset.id}"`) &&
        (!selector.includes("data-group-id") || selector.includes(`data-group-id="${cell.group.dataset.groupId}"`))) || null;
    const menu = element();
    const input = element();
    input.value = "";
    const chips = element();
    const menuItems = element();
    menuItems.scrollTop = 0;
    menu.lastElementChild = menuItems;
    menuItems.lastElementChild = element();
    const relatedItems = [];
    const relationRoot = element({keyId: "column"});
    const selectedRows = {append: target => relatedItems.push(target)};
    const candidateRows = {prepend: target => relatedItems.splice(relatedItems.indexOf(target), 1)};
    menu.parentElement = element();
    menu.querySelector = selector => ({input, ".b3-chips": chips, ".b3-menu__items": menuItems,
        ".av__relation": relationRoot, '[data-relation-type="selectedRows"]': selectedRows,
        '[data-relation-type="candidateRows"]': candidateRows})[selector] || null;
    menu.querySelectorAll = selector => selector === '[data-relation-type="selected"]' ? relatedItems : [];
    const document = {querySelector: () => null, querySelectorAll: () => [], body: {contains: target => target.isConnected}};
    const window = {siyuan: {config: {}, languages: {}, menus: {menu: {remove() {}}}}};
    const context = {
        ...load("capabilities"), ...load("cellValue"), ...load("batchValue"), ...load("dragFillValue"),
        ...load("viewType"), ...load("dateSubmit"), ...load("selectionState"), ...load("panelTarget"),
        ...load("assetUploadTarget"),
        document, window, CustomEvent, setTimeout,
        cellValues: plain(values),
        getAVData: () => state.data,
        getAVHostIdentity: target => target.dataset.avHost || target.dataset.nodeId,
        getAVCellEditorOwner: () => owner, getAVRelationHost: () => state.relationHost,
        canEditAVHost: (_block, editor) => !editor.disabled && !window.siyuan.config.readonly &&
            !window.siyuan.isPublish && !editor.options.history?.created && !editor.options.history?.snapshot &&
            (!state.relationHost || state.relationHost.active && state.relationHost.available && !state.relationHost.readonly()),
        hasClosestBlock: cell => block.contains(cell) ? block : null,
        hasClosestByClassName: (cell, name) => name === "b3-menu" ? menu :
            name === "custom-attr" && cell.dataset.avId ? {} : null,
        getColId: cell => cell.dataset.colId,
        getFieldIdByCellElement: cell => cell.dataset.rowId || cell.row.dataset.id,
        getTypeByCellElement: cell => cell.dataset.dtype,
        getFieldsByData: data => data.view.columns,
        getPageSize: () => ({}), isAVRenderData: () => true,
        fetchPost: (_url, _payload, callback) => {state.openCallback = callback;},
        fetchSyncPost: async () => state.fetchResponse,
        getCellText: () => "old", getCellValueText: () => "old", escapeAttr: value => value,
        objEquals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", SIYUAN_ASSETS_IMAGE: []},
        dayjs: () => ({format: () => "time"}), formatDateValue: () => "date",
        getAVResolvedColor: () => undefined, isMobile: () => false,
        escapeAriaLabel: value => value, escapeHtml: value => value,
        applyAVColorPalette() {}, getAVCustomColors: () => [], getAVColorGridHTML: () => "",
        getAVColorOrder: () => [], AV_MANAGE_CUSTOM_COLORS_TYPE: "manage",
        mobileConfirmDialog: (_title, _text, callback) => {state.confirm = callback;},
        Menu: class {
            constructor(_id, callback) {
                this.items = [];
                this.closeCallback = callback;
                this.input = element();
                this.description = element();
                this.element = element();
                this.element.querySelector = selector => selector === "input" ? this.input : this.description;
                this.element.querySelectorAll = () => [this.input, this.description];
                state.submenu = this;
            }
            addItem(item) {this.items.push(item);}
            addSeparator() {}
            open() {}
            fullscreen() {}
        },
        getSelectHTML: () => "", setSelectMenuPosition() {},
        getInlineDateType, getInlineDateValue, setInlineDateValue, validateInlineDateInput,
        // 几何/ResizeObserver 在 datePosition.dom.test.ts 验证；这里保留宿主绑定与释放契约。
        bindDatePanelPosition: (menuElement, getAnchor) => {
            assert.ok(menuElement);
            assert.equal(typeof getAnchor, "function");
            const binding = {menuElement, getAnchor, destroyed: false};
            datePositionBindings.push(binding);
            return () => {binding.destroyed = true;};
        },
        bindInlineDatePicker: (host, inputs, options) => {
            assert.ok(host);
            assert.equal(inputs.length, 2);
            const binding = {host, inputs, options, active: undefined, destroyed: false};
            dateBindings.push(binding);
            inputs.forEach(input => {
                input.dataset.datePickerType = input.type;
                input.type = "text";
            });
            return {
                activate: input => {assert.ok(inputs.includes(input)); binding.active = input;},
                validate: () => !binding.destroyed && inputs.every(validateInlineDateInput),
                update() {},
                destroy: () => {binding.destroyed = true;},
            };
        },
        bindLunarDateEditor: options => {state.lunarEditor = options;},
        bindAssetEvent: options => {state.boundMenu = options;},
        removeCompressURL: value => value, openMenu: () => [], isBrowserRenderableImagePath: () => false,
        base64ToURL: async () => state.base64Response,
        updateAttrViewCellAnimation() {}, updateAVSelectedCellValue() {}, updateCopyRelatedItems() {},
        updateAttrViewCellInOtherElements: (_protyle, _avID, rowID, colID, value, cell) => {
            if (state.data) load("cellValue").updateAVCachedCellValue(state.data.view, rowID, colID, value);
            if (cell?.dataset.avBatchOriginalValue) {
                cell.dataset.avBatchChanged = "true";
                cell.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
            }
        },
        transaction: (_protyle, operations, undo, options) => transactions.push({operations, undo, options}),
        captureUploadDocument: (_protyle, options) => options,
        getAssetUploadSuccesses: result => result.successes, pathPosix: () => path.posix,
        showMessage: message => assert.fail(`unexpected message: ${message}`),
    };
    const api = runInNewContext(compiledFunctions + "\n({openMenuPanel, bindDateEvent, datePanel, updateCellsValue," +
        "bindSelectEvent, addColOptionOrCell, removeCellOption, setColOption, setRelationCell, updateAssetCell, captureAssetCellUpload," +
        "getAssetHTML, editAssetItem, captureAVCellInput, captureAVAssetUploadHandler});", context);
    api.openMenuPanel({type: type === "mAsset" ? "asset" : type === "mSelect" ? "select" : type,
        protyle, blockElement: block, cellElements: cells});
    assert.equal(typeof cells.resolveAVCellInput, "function");
    const panel = element();
    menu.closest = selector => selector === ".av__panel" ? panel : null;
    context.setAVCellPanelTarget(panel, block, cells);
    if (type === "mAsset") api.getAssetHTML(cells);
    const unmount = () => cells.forEach(cell => {cell.isConnected = false;});
    const select = () => api.addColOptionOrCell(protyle, state.data, cells,
        element({name: "new", color: "1"}), menu, block);
    const selectRelation = async () => {
        const target = element({rowId: "new", relationType: "candidate"}, ["b3-menu__item"]);
        const label = element({content: "New relation"});
        const primary = element();
        target.querySelector = selector => selector === ".b3-menu__label" ? label : primary;
        await api.setRelationCell(protyle, block, target, cells);
    };
    const editDate = (dirty = true, {value = "2026-11-06", change = "input", constraints = {}} = {}) => {
        const transactionCount = transactions.length;
        const inputs = Array.from({length: 4}, () => element());
        inputs[0].defaultValue = "2026-11-06";
        inputs[1].defaultValue = "";
        inputs[0].value = value;
        inputs[1].value = "";
        inputs.slice(0, 2).forEach(input => {input.type = "date"; input.dataset.value = input.value;});
        Object.assign(inputs[0], constraints);
        inputs[2].checked = false;
        inputs[3].checked = false;
        const host = element();
        const menuElement = {querySelectorAll: () => inputs,
            querySelector: selector => selector === "[data-date-inline]" ? host : null};
        const panelContext = {options: {protyle, blockElement: block, cellElements: cells, requireExplicitChange: true},
            data: state.data, fields: columns, menuElement, cellRect: cells.at(-1).getBoundingClientRect()};
        api.datePanel.bind(panelContext);
        const close = panelContext.closeCB;
        const position = datePositionBindings.at(-1);
        assert.equal(position.menuElement, menuElement);
        assert.deepEqual(plain(position.getAnchor()), plain(panelContext.cellRect));
        const binding = dateBindings.at(-1);
        assert.equal(binding.host, host);
        assert.deepEqual(Array.from(binding.inputs), inputs.slice(0, 2));
        assert.equal(binding.active, inputs[0]);
        assert.equal(inputs[0].type, "text");
        assert.equal(inputs[1].type, "text");
        assert.equal(transactions.length, transactionCount, "mount and activation cannot write the date prefill");
        if (dirty) {
            if (change === "select") {
                binding.options.onChange(inputs[0], {value, draft: value, valid: validateInlineDateInput(inputs[0]), kind: "select"});
            } else {
                inputs[0].dispatchEvent(new Event(change));
            }
        }
        return {inputs, close: () => {
            close();
            assert.equal(binding.destroyed, true, "closing releases the shared inline binding");
            assert.equal(position.destroyed, true, "closing releases the date panel positioning binding");
        }};
    };
    const saveDate = (dirty = true, options = {}) => editDate(dirty, options).close();
    const save = type === "date" ? saveDate : type === "relation" ? selectRelation : type === "mAsset" ?
        () => api.updateAssetCell({protyle, blockElement: block, cellElements: cells, addValue: [asset("new")]}) : select;
    return {api, state, context, cells, view, columns, rows, owner, block, protyle, menu, panel, transactions, window,
        save, saveDate, editDate, unmount};
};

for (const type of ["date", "select", "mSelect", "relation", "mAsset"]) {
    test(`${type} panel captures its target before fetch and saves after the row is unmounted`, async () => {
        const f = fixture(type, {groups: true});
        f.unmount();
        await f.save();
        assert.equal(f.transactions.length, 1);
        const operation = f.transactions[0].operations[0];
        assert.equal(operation.action, "updateAttrViewCell");
        assert.equal(operation.avID, "database");
        assert.equal(operation.keyID, "column");
        assert.equal(operation.rowID, "row-0");
        assert.equal(operation.id, "value-0");
        if (type === "date") assert.equal(operation.data.date.content, new Date("2026-11-06 00:00").getTime());
        else if (type === "relation") assert.deepEqual(plain(operation.data.relation.blockIDs), ["new"]);
        else if (type === "mAsset") assert.deepEqual(plain(operation.data.mAsset), [asset("old-0"), asset("new")]);
        else assert.equal(operation.data.mSelect.at(-1).content, "new");
    });
    for (const [name, invalidate] of [
        ["view switch", f => {f.state.data.viewID = "other";}],
        ["pending view switch", f => {f.block.setAttribute("custom-sy-av-view", "other");}],
        ["field deletion", f => {f.view.columns = [];}],
        ["field retyping", f => {f.columns[0].type = "url";}],
        ["readonly", f => {f.protyle.disabled = true;}],
        ["owner switch", f => {f.owner.contains = () => false;}],
        ["display instance switch", f => {f.block.dataset.nodeId = "other";}],
        ["group removal", f => {f.state.data.view.groups = [{...f.view, id: "other"}];}],
    ]) {
        test(`${type} panel ignores saves and late opening responses after ${name}`, async () => {
            const f = fixture(type, {groups: true});
            f.unmount();
            invalidate(f);
            await f.state.openCallback({code: 0, data: f.state.data});
            await f.save();
            assert.equal(f.transactions.length, 0);
        });
    }
    test(`${type} panel undo resolves current values after column reorder`, async () => {
        const f = fixture(type);
        const current = f.rows[0].cells[0].value;
        if (type === "date") current.date.content = 987;
        else if (type === "relation") current.relation = relation("current");
        else if (type === "mAsset") current.mAsset = [asset("current")];
        else current.mSelect = [option("current")];
        const expected = plain(current);
        f.columns.unshift({id: "other", type});
        f.rows[0].cells.unshift({id: "other-value", value: {type}});
        f.unmount();
        await f.save();
        assert.deepEqual(plain(f.transactions[0].undo[0].data), expected);
    });
    for (const [name, invalidate] of [
        ["host object", f => {f.state.relationHost = {...f.state.relationHost};}],
        ["source database", f => {f.state.relationHost.relationContext.sourceAvID = "other";}],
        ["source item", f => {f.state.relationHost.relationContext.sourceItemID = "other";}],
        ["relation field", f => {f.state.relationHost.relationContext.relationKeyID = "other";}],
        ["source block", f => {f.state.relationHost.sourceBlockID = "other";}],
        ["host permissions", f => {f.state.relationHost.readonly = () => true;}],
    ]) {
        test(`${type} related panel cancels when its ${name} changes within the same view`, async () => {
            const f = fixture(type, {related: true});
            f.unmount();
            invalidate(f);
            await f.save();
            assert.equal(f.transactions.length, 0);
        });
    }
}

test("explicit-change date panel cancellation does not save a prefilled date", () => {
    const f = fixture("date");
    f.unmount();
    f.saveDate(false);
    assert.equal(f.transactions.length, 0);
});

test("explicitly selecting an unchanged inline date commits against the captured target", () => {
    const f = fixture("date");
    f.unmount();
    f.saveDate(true, {change: "select"});
    assert.equal(f.transactions.length, 1);
    assert.equal(f.transactions[0].operations[0].rowID, "row-0");
    assert.equal(f.transactions[0].operations[0].data.date.content, new Date("2026-11-06 00:00").getTime());
});

for (const [name, value, constraints] of [
    ["impossible day", "2026-02-30", {}],
    ["unfinished draft", "2026-11-", {}],
    ["required empty", "", {required: true}],
    ["minimum", "2026-11-06", {min: "2026-11-07"}],
    ["maximum", "2026-11-06", {max: "2026-11-05"}],
    ["step", "2026-11-06", {min: "2026-11-05", step: "2"}],
]) {
    test(`date stable-target saves reject ${name} through the real date model`, () => {
        const f = fixture("date");
        f.unmount();
        f.saveDate(true, {value, constraints});
        assert.equal(f.transactions.length, 0);
    });
}

test("date clear action keeps its stable target after unmount", () => {
    const f = fixture("date");
    f.unmount();
    f.api.datePanel.actions.clearDate({data: f.state.data, fields: f.columns, avPanelElement: element(),
        options: {protyle: f.protyle, blockElement: f.block, cellElements: f.cells}},
    {event: {preventDefault() {}, stopPropagation() {}}});
    assert.equal(f.transactions[0].operations[0].data.date.isNotEmpty, false);
    assert.equal(f.transactions[0].undo[0].data.date.content, 123);
});

test("multi-select chip removal and repeated saves read current values while offscreen", () => {
    const f = fixture("mSelect");
    f.unmount();
    f.save();
    f.api.removeCellOption(f.protyle, f.cells, element({content: "old-0"}), f.block);
    assert.deepEqual(plain(f.transactions[1].operations[0].data.mSelect), [option("new")]);
    assert.deepEqual(plain(f.transactions[1].undo[0].data.mSelect), [option("old-0"), option("new")]);
});

const selectKeyboardFixture = (type, {checked = false, create = false} = {}) => {
    const f = fixture(type);
    const input = f.menu.querySelector("input");
    const chip = element({content: "old-0"});
    const candidate = element({name: checked ? "old-0" : create ? "created" : "new", color: "1"});
    const next = element({colId: "column"});
    candidate.querySelector = selector =>
        (checked && selector === ".b3-menu__checked") || (create && selector === ".b3-menu__accelerator") ? element() : null;
    const queryMenu = f.menu.querySelector;
    f.menu.querySelector = selector => selector.startsWith(".b3-chips .b3-chip") ? chip : queryMenu(selector);
    const state = {closed: false, prepared: 0, scrolled: []};
    f.context.document.querySelector = selector => selector === ".av__panel" && !state.closed ? f.panel : null;
    f.menu.parentElement.addEventListener("click", event => {state.closed = event.detail === "close";});
    f.context.upDownHint = () => candidate;
    f.context.isAVContinuousInputKey = event => !event.repeat && !event.shiftKey;
    f.context.prepareAVContinuousInput = (protyle, block, cells, onNext) => {
        assert.equal(protyle, f.protyle);
        assert.equal(block, f.block);
        assert.equal(cells[0], f.cells[0]);
        state.prepared++;
        return () => onNext(next);
    };
    f.context.cellScrollIntoView = (block, cell) => {assert.equal(block, f.block); state.scrolled.push(cell);};
    f.api.bindSelectEvent(f.protyle, f.state.data, f.menu, f.cells, f.block);
    const enter = (options = {}) => input.dispatchEvent(Object.assign(new Event("keydown", {cancelable: true}), {
        key: "Enter", ...options,
    }));
    return {f, state, enter, next};
};

for (const options of [{}, {create: true}, {checked: true}]) {
    test(`single-select Enter advances after ${options.checked ? "clearing" : options.create ? "creating" : "choosing"} an option`, () => {
        const {f, state, enter, next} = selectKeyboardFixture("select", options);
        assert.equal(enter(), false);
        assert.equal(state.closed, true);
        assert.equal(state.prepared, 1);
        assert.equal(f.transactions.length, 1);
        assert.deepEqual(state.scrolled, []);
        f.transactions[0].options.callback();
        assert.deepEqual(state.scrolled, [next]);
    });
}

test("single-select Enter ignores held keys and leaves later cell or panel focus intact", () => {
    const {f, state, enter} = selectKeyboardFixture("select");
    enter({isComposing: true});
    enter({repeat: true});
    assert.equal(f.transactions.length, 0);
    enter();
    const complete = f.transactions[0].options.callback;
    state.closed = false;
    complete();
    state.closed = true;
    f.context.setAVCellSelection(f.block, {});
    complete();
    assert.deepEqual(state.scrolled, []);
});

test("multi-select Enter updates the current cell and keeps the option panel open", () => {
    const {f, state, enter} = selectKeyboardFixture("mSelect");
    assert.equal(enter(), false);
    assert.equal(f.transactions.length, 1);
    const {operations, options} = f.transactions[0];
    assert.deepEqual(plain(operations[0].data.mSelect), [option("old-0"), option("new")]);
    assert.equal(options.callback, undefined);
    assert.equal(state.closed, false);
    assert.equal(state.prepared, 0);
});

const attributePanelFixture = (type = "mSelect") => {
    const f = fixture(type, {cached: false});
    f.state.data = {id: "database", viewType: "table", view: {columns: f.columns}};
    f.context.getAVData = () => undefined;
    let currentBlock = f.block;
    let currentCell = f.cells[0];
    f.block.dataset.attributeId = "document";
    currentCell.classList.add("custom-attr__avvalue");
    const panel = element();
    panel.contains = target => target === currentBlock && target.isConnected;
    panel.querySelector = selector => currentBlock.isConnected &&
        ["av-id", "attribute-id", "node-id"].every(name =>
            selector.includes(`[data-${name}="${currentBlock.getAttribute(`data-${name}`)}"]`)) ? currentBlock : null;
    f.owner.closest = () => panel;
    const bindCell = () => {
        currentBlock.contains = target => target === currentCell && target.isConnected;
        currentBlock.querySelector = selector => currentCell.isConnected &&
            ["row-id", "col-id", "type"].every(name =>
                selector.includes(`[data-${name}="${currentCell.getAttribute(`data-${name}`)}"]`)) ? currentCell : null;
    };
    bindCell();
    f.context.hasClosestBlock = target => currentBlock.contains(target) ? currentBlock : null;
    f.context.updateAttrViewCellInOtherElements = (_protyle, _avID, _rowID, _colID, value, cell) => {
        assert.equal(cell, currentCell);
        cell.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
    };
    f.api.captureAVCellInput(f.protyle, f.block, f.cells);
    const repaint = (replaceBlock = true) => {
        const dataset = {...currentCell.dataset};
        currentCell.isConnected = false;
        if (replaceBlock) {
            currentBlock.isConnected = false;
            currentBlock = element({...currentBlock.dataset});
        }
        currentCell = element(dataset, ["custom-attr__avvalue"]);
        bindCell();
        return {block: currentBlock, cell: currentCell};
    };
    return {...f, panel, repaint, current: () => ({block: currentBlock, cell: currentCell})};
};

for (const replaceBlock of [false, true]) {
    for (const mobile of [false, true]) {
        test(`attribute lunar dates save ranges and times after ${replaceBlock ? "body" : "field"} refreshes (${mobile ? "mobile" : "desktop"})`, () => {
            const f = attributePanelFixture("date");
            f.context.isMobile = () => mobile;
            f.cells[0].dataset.dateFormat = "lunar";
            f.api.bindDateEvent({protyle: f.protyle, data: f.state.data, blockElement: f.block,
                cellElements: f.cells, menuElement: f.menu});
            const value = {content: new Date("2026-08-10 12:30").getTime(), isNotEmpty: true,
                content2: new Date("2026-08-12 15:45").getTime(), isNotEmpty2: true,
                hasEndDate: true, isNotTime: false};
            const current = f.repaint(replaceBlock);
            const before = JSON.parse(decodeURIComponent(current.cell.dataset.cellValue));
            f.state.lunarEditor.update(value);
            assert.equal(f.transactions.length, 1);
            const saved = f.transactions[0].operations[0].data.date;
            for (const key of Object.keys(value)) {
                assert.equal(saved[key], value[key]);
            }
            assert.deepEqual(plain(f.transactions[0].undo[0].data), before);
            assert.equal(f.cells[0], current.cell);
        });
    }

    test(`attribute dates save consecutive edits across ${replaceBlock ? "body" : "field"} refreshes`, () => {
        const f = attributePanelFixture("date");
        for (const day of [10, 11, 12]) {
            const before = plain(JSON.parse(decodeURIComponent(f.current().cell.dataset.cellValue)));
            const editor = f.editDate(true, {value: `2026-08-${day}`});
            const current = f.repaint(replaceBlock);
            current.cell.dataset.id = `refreshed-value-${day}`;
            const refreshed = {...before, id: current.cell.dataset.id};
            current.cell.dataset.cellValue = encodeURIComponent(JSON.stringify(refreshed));
            current.block.setAttribute("updated", `refreshed-${day}`);
            editor.close();
            assert.equal(f.transactions.length, day - 9);
            const transaction = f.transactions.at(-1);
            const operation = transaction.operations[0];
            assert.equal(operation.action, "updateAttrViewCell");
            assert.equal(operation.avID, "database");
            assert.equal(operation.blockID, "carrier");
            assert.equal(operation.keyID, "column");
            assert.equal(operation.rowID, "row-0");
            assert.equal(operation.id, `refreshed-value-${day}`);
            assert.equal(operation.data.date.content, new Date(`2026-08-${day} 00:00`).getTime());
            assert.deepEqual(plain(transaction.undo[0].data), refreshed);
            assert.equal(transaction.undo[1].data, `refreshed-${day}`);
            assert.equal(f.cells[0], current.cell);
        }
    });

    test(`attribute dates clear the refreshed ${replaceBlock ? "body" : "field"} with an undo snapshot`, () => {
        const f = attributePanelFixture("date");
        const current = f.repaint(replaceBlock);
        const before = plain(JSON.parse(decodeURIComponent(current.cell.dataset.cellValue)));
        f.api.datePanel.actions.clearDate({data: f.state.data, fields: f.columns, avPanelElement: element(),
            options: {protyle: f.protyle, blockElement: f.block, cellElements: f.cells}},
        {event: {preventDefault() {}, stopPropagation() {}}});
        assert.equal(f.transactions.length, 1);
        assert.equal(f.transactions[0].operations[0].data.date.isNotEmpty, false);
        assert.deepEqual(plain(f.transactions[0].undo[0].data), before);
        assert.equal(f.cells[0], current.cell);
    });

    test(`attribute multi-select keeps adding and removing after ${replaceBlock ? "body" : "field"} refreshes`, () => {
        const f = attributePanelFixture();
        f.save();
        f.repaint(replaceBlock);
        const add = name => f.api.addColOptionOrCell(f.protyle, f.state.data, f.cells,
            element({name, color: "1"}), f.menu, f.block);
        add("second");
        assert.equal(f.transactions.length, 2);
        assert.deepEqual(plain(f.transactions[1].operations[0].data.mSelect),
            [option("old-0"), option("new"), option("second")]);
        f.repaint(replaceBlock);
        f.api.removeCellOption(f.protyle, f.cells, element({content: "old-0"}), f.block);
        f.repaint(replaceBlock);
        f.api.removeCellOption(f.protyle, f.cells, element({content: "new"}), f.block);
        f.repaint(replaceBlock);
        add("third");
        assert.equal(f.transactions.length, 5);
        assert.deepEqual(plain(f.transactions[4].operations[0].data.mSelect), [option("second"), option("third")]);
        assert.deepEqual(plain(f.transactions[3].undo[0].data.mSelect), [option("new"), option("second")]);
        for (const transaction of f.transactions) {
            const operation = transaction.operations[0];
            assert.equal(operation.avID, "database");
            assert.equal(operation.rowID, "row-0");
            assert.equal(operation.keyID, "column");
        }
        assert.equal(f.cells[0], f.current().cell);
    });
}

for (const [name, invalidate] of [
    ["document switch", f => {f.protyle.block.rootID = "other";}],
    ["panel removal", f => {f.panel.querySelector = () => null;}],
    ["database change", f => {f.current().block.dataset.avId = "other";}],
    ["display instance change", f => {f.current().block.dataset.nodeId = "other";}],
    ["attribute target change", f => {f.current().block.dataset.attributeId = "other";}],
    ["row change", f => {f.current().cell.dataset.rowId = "other";}],
    ["field change", f => {f.current().cell.dataset.colId = "other";}],
    ["field deletion", f => {f.current().cell.isConnected = false;}],
    ["field retyping", f => {f.current().cell.dataset.type = "select";}],
    ["readonly", f => {f.protyle.disabled = true;}],
    ["global readonly", f => {f.window.siyuan.config.readonly = true;}],
    ["history preview", f => {f.protyle.options.history = {created: true};}],
]) {
    test(`attribute dates reject save and clear after refresh and ${name}`, () => {
        const f = attributePanelFixture("date");
        const editor = f.editDate();
        f.repaint();
        invalidate(f);
        editor.close();
        f.api.datePanel.actions.clearDate({data: f.state.data, fields: f.columns, avPanelElement: element(),
            options: {protyle: f.protyle, blockElement: f.block, cellElements: f.cells}},
        {event: {preventDefault() {}, stopPropagation() {}}});
        assert.equal(f.transactions.length, 0);
    });
}

for (const [name, invalidate] of [
    ["document switch", f => {f.protyle.block.rootID = "other";}],
    ["panel removal", f => {f.panel.querySelector = () => null;}],
    ["database change", f => {f.current().block.dataset.avId = "other";}],
    ["display instance change", f => {f.current().block.dataset.nodeId = "other";}],
    ["attribute target change", f => {f.current().block.dataset.attributeId = "other";}],
    ["row change", f => {f.current().cell.dataset.rowId = "other";}],
    ["field deletion", f => {f.current().cell.isConnected = false;}],
    ["field retyping", f => {f.current().cell.dataset.type = "select";}],
    ["readonly", f => {f.protyle.disabled = true;}],
    ["global readonly", f => {f.window.siyuan.config.readonly = true;}],
    ["history preview", f => {f.protyle.options.history = {created: true};}],
]) {
    test(`attribute multi-select rejects add and removal after refresh and ${name}`, () => {
        const f = attributePanelFixture();
        f.save();
        f.repaint();
        invalidate(f);
        f.save();
        f.api.removeCellOption(f.protyle, f.cells, element({content: "old-0"}), f.block);
        assert.equal(f.transactions.length, 1);
    });
}

test("attribute multi-select does not follow an in-place change to another attribute target", () => {
    const f = attributePanelFixture();
    f.current().block.dataset.attributeId = "other";
    f.save();
    assert.equal(f.transactions.length, 0);
});

test("attribute multi-select uses refreshed concurrent values for edits and undo", () => {
    const f = attributePanelFixture();
    f.save();
    const {cell} = f.repaint();
    const current = JSON.parse(decodeURIComponent(cell.dataset.cellValue));
    current.mSelect.push(option("concurrent"));
    cell.dataset.cellValue = encodeURIComponent(JSON.stringify(current));
    f.api.removeCellOption(f.protyle, f.cells, element({content: "new"}), f.block);
    assert.equal(f.transactions.length, 2);
    assert.deepEqual(plain(f.transactions[1].operations[0].data.mSelect), [option("old-0"), option("concurrent")]);
    assert.deepEqual(plain(f.transactions[1].undo[0].data.mSelect), current.mSelect);
});

test("mobile attribute multi-select continues after refresh without reopening the keyboard", () => {
    const f = attributePanelFixture();
    f.context.isMobile = () => true;
    f.menu.querySelector("input").focus = () => assert.fail("an option tap must not focus the search input");
    f.save();
    f.repaint();
    f.api.addColOptionOrCell(f.protyle, f.state.data, f.cells,
        element({name: "second", color: "1"}), f.menu, f.block);
    assert.equal(f.transactions.length, 2);
    assert.deepEqual(plain(f.transactions[1].operations[0].data.mSelect),
        [option("old-0"), option("new"), option("second")]);
});

test("asset removal reads panel state updated by the previous offscreen save", () => {
    const f = fixture("mAsset");
    f.unmount();
    f.save();
    f.api.getAssetHTML(f.cells);
    f.api.updateAssetCell({protyle: f.protyle, blockElement: f.block, cellElements: f.cells, removeIndex: 1});
    assert.deepEqual(plain(f.transactions[1].operations[0].data.mAsset), [asset("old-0")]);
    assert.deepEqual(plain(f.transactions[1].undo[0].data.mAsset), [asset("old-0"), asset("new")]);
});

for (const type of ["mSelect", "mAsset"]) {
    test(`${type} grouped batch add preserves every original row and marks its proxy changed`, () => {
        const f = fixture(type, {count: 2, batch: "add", groups: true});
        f.columns[0].hidden = true;
        f.unmount();
        f.save();
        const operations = f.transactions[0].operations.filter(item => item.action === "updateAttrViewCell");
        assert.deepEqual(plain(operations.map(item => item.rowID)), ["row-0", "row-1"]);
        operations.forEach((operation, index) => {
            assert.deepEqual(plain(operation.data[type]), type === "mAsset" ?
                [asset(`old-${index}`), asset("new")] : [option(`old-${index}`), option("new")]);
            assert.equal(f.cells[index].dataset.avBatchChanged, "true");
        });
    });
}

test("relation batch add uses each offscreen row and preserves its unrelated relations", async () => {
    const f = fixture("relation", {count: 2, batch: "add", groups: true});
    f.unmount();
    await f.save();
    const operations = f.transactions[0].operations.filter(item => item.action === "updateAttrViewCell");
    assert.deepEqual(plain(operations.map(item => item.rowID)), ["row-0", "row-1"]);
    operations.forEach((operation, index) => {
        assert.deepEqual(plain(operation.data.relation.blockIDs), [`old-${index}`, "new"]);
        assert.equal(f.cells[index].dataset.avBatchChanged, "true");
    });
});

test("date save rechecks its owner after an asynchronous field configuration fetch", async () => {
    const f = fixture("date", {cached: false});
    let resolve;
    f.state.fetchResponse = new Promise(done => {resolve = done;});
    const pending = f.api.updateCellsValue(f.protyle, f.block,
        {content: 987, isNotEmpty: true, isNotTime: true}, f.cells);
    f.owner.contains = () => false;
    resolve({code: 0, data: f.columns});
    await pending;
    assert.equal(f.transactions.length, 0);
});

test("relation batch add resolves concurrent values for undo and merging", async () => {
    const f = fixture("relation", {count: 2, batch: "add", groups: true});
    f.rows.forEach((row, index) => {row.cells[0].value.relation = relation(`current-${index}`);});
    f.unmount();
    await f.save();
    const operations = f.transactions[0].operations.filter(item => item.action === "updateAttrViewCell");
    operations.forEach((operation, index) => {
        assert.deepEqual(plain(operation.data.relation.blockIDs), [`current-${index}`, "new"]);
        assert.deepEqual(plain(f.transactions[0].undo[index].data.relation.blockIDs), [`current-${index}`]);
    });
});

test("asset upload carries the opening resolver through its copied cell array", () => {
    const f = fixture("mAsset");
    const upload = f.api.captureAssetCellUpload(f.protyle, f.block, f.cells, null);
    f.unmount();
    assert.equal(upload.document.isAvailable(), true);
    upload.apply({successes: [{name: "uploaded.txt", path: "assets/uploaded.txt", index: 0}]});
    assert.equal(f.transactions[0].operations[0].data.mAsset.at(-1).content, "assets/uploaded.txt");
    f.state.data.viewID = "other";
    assert.equal(upload.document.isAvailable(), false);
    upload.apply({successes: [{name: "stale.txt", path: "assets/stale.txt", index: 0}]});
    assert.equal(f.transactions.length, 1);
});

for (const action of ["remove", "edit"]) {
    const apply = (f, index = 0) => f.api.updateAssetCell({protyle: f.protyle, blockElement: f.block,
        cellElements: f.cells, ...(action === "remove" ? {removeIndex: index} :
            {updateValue: {index, value: asset("edited")}})});
    test(`asset ${action} follows the displayed identity after concurrent insertion and live DOM refresh`, () => {
        const f = fixture("mAsset");
        const current = f.rows[0].cells[0].value;
        current.mAsset.unshift(asset("concurrent"));
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify(current));
        f.unmount();
        apply(f);
        assert.deepEqual(plain(f.transactions[0].operations[0].data.mAsset), action === "remove" ?
            [asset("concurrent")] : [asset("concurrent"), asset("edited")]);
        assert.deepEqual(plain(f.transactions[0].undo[0].data.mAsset), [asset("concurrent"), asset("old-0")]);
    });
    test(`asset ${action} does nothing when the displayed target has been deleted`, () => {
        const f = fixture("mAsset");
        f.rows[0].cells[0].value.mAsset = [asset("concurrent")];
        f.unmount();
        apply(f);
        assert.equal(f.transactions.length, 0);
    });
    test(`asset ${action} preserves the selected occurrence among duplicate attachments`, () => {
        const f = fixture("mAsset");
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify({type: "mAsset",
            mAsset: [asset("old-0"), asset("old-0")]}));
        f.api.getAssetHTML(f.cells);
        f.rows[0].cells[0].value.mAsset = [asset("concurrent"), asset("old-0"), asset("old-0")];
        f.unmount();
        apply(f, 1);
        assert.deepEqual(plain(f.transactions[0].operations[0].data.mAsset), action === "remove" ?
            [asset("concurrent"), asset("old-0")] : [asset("concurrent"), asset("old-0"), asset("edited")]);
    });
    test(`asset ${action} does not redirect a missing duplicate occurrence`, () => {
        const f = fixture("mAsset");
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify({type: "mAsset",
            mAsset: [asset("old-0"), asset("old-0")]}));
        f.api.getAssetHTML(f.cells);
        f.unmount();
        apply(f, 1);
        assert.equal(f.transactions.length, 0);
    });
}

test("batch upload accepts hidden asset columns and rows in a later group", () => {
    const f = fixture("mAsset", {groups: true, batch: "add"});
    f.state.data.view.groups.unshift({id: "first", columns: f.columns, rows: []});
    f.columns[0].hidden = true;
    f.unmount();
    const upload = f.api.captureAssetCellUpload(f.protyle, f.block, f.cells, null);
    assert.equal(upload.document.isAvailable(), true);
    upload.apply({successes: [{name: "uploaded.txt", path: "assets/uploaded.txt", index: 0}]});
    assert.equal(f.transactions[0].operations[0].data.mAsset.at(-1).content, "assets/uploaded.txt");
});

for (const action of ["remove", "edit"]) {
    for (const state of ["reordered", "deleted", "duplicate", "missing duplicate"]) {
        test(`uncached asset ${action} resolves the displayed identity after ${state} DOM updates`, () => {
            const f = fixture("mAsset", {cached: false});
            const original = asset("old-0");
            const duplicate = state.includes("duplicate");
            const setAssets = values => {
                f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify({
                    ...f.rows[0].cells[0].value, mAsset: values,
                }));
            };
            if (duplicate) {
                setAssets([original, original]);
                f.api.getAssetHTML(f.cells);
            }
            const current = state === "deleted" ? [asset("concurrent")] : state === "missing duplicate" ?
                [asset("concurrent"), original] : state === "duplicate" ?
                    [asset("concurrent"), original, original] : [asset("concurrent"), original];
            setAssets(current);
            const index = duplicate ? 1 : 0;
            f.api.updateAssetCell({protyle: f.protyle, blockElement: f.block, cellElements: f.cells,
                ...(action === "remove" ? {removeIndex: index} : {updateValue: {index, value: asset("edited")}})});
            if (state === "deleted" || state === "missing duplicate") {
                assert.equal(f.transactions.length, 0);
                return;
            }
            const expected = [asset("concurrent"), ...(duplicate ? [original] : []),
                ...(action === "edit" ? [asset("edited")] : [])];
            assert.deepEqual(plain(f.transactions[0].operations[0].data.mAsset), expected);
            assert.deepEqual(plain(f.transactions[0].undo[0].data.mAsset), current);
        });
    }
}

test("upload-driven panel refresh shares its displayed asset identities with the original action context", () => {
    const f = fixture("mAsset");
    const upload = f.api.captureAssetCellUpload(f.protyle, f.block, f.cells, f.menu);
    f.unmount();
    upload.apply({successes: [{name: "uploaded.txt", path: "assets/uploaded.txt", index: 0}]});
    f.rows[0].cells[0].value.mAsset.unshift(asset("concurrent"));
    f.api.updateAssetCell({protyle: f.protyle, blockElement: f.block, cellElements: f.cells, removeIndex: 1});
    assert.deepEqual(plain(f.transactions[1].operations[0].data.mAsset), [asset("concurrent"), asset("old-0")]);
});

for (const changedOwner of [false, true]) {
    test(`paste upload captured after panel targets unmount ${changedOwner ? "rejects another display instance" : "uses the original panel resolver"}`, async () => {
        const f = fixture("mAsset");
        const panel = element();
        panel.querySelector = selector => selector === ".b3-form__upload" ? element() : null;
        f.context.setAVCellPanelTarget(panel, changedOwner ? element() : f.block, f.cells);
        f.context.document.querySelector = selector => selector === ".av__panel" ? panel : null;
        f.block.querySelectorAll = () => assert.fail("panel paste must not recapture later DOM selections");
        f.unmount();
        const apply = f.api.captureAVAssetUploadHandler(f.protyle, f.block);
        await apply({successes: [{name: "pasted.txt", path: "assets/pasted.txt", index: 0}]});
        assert.equal(f.transactions.length, changedOwner ? 0 : 1);
        if (!changedOwner) assert.equal(f.transactions[0].operations[0].data.mAsset.at(-1).content, "assets/pasted.txt");
    });
}

for (const action of ["remove", "edit"]) {
    test(`asset submenu ${action} keeps its original identity when the parent panel rerenders`, async () => {
        const f = fixture("mAsset");
        const original = {type: "file", name: "original", content: "https://example.com/original"};
        f.rows[0].cells[0].value.mAsset = [original];
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify(f.rows[0].cells[0].value));
        f.api.getAssetHTML(f.cells);
        f.api.editAssetItem({protyle: f.protyle, blockElement: f.block, cellElements: f.cells,
            ...original, index: 0, rect: {right: 20, bottom: 30, width: 20, height: 30}});
        const submenu = f.state.submenu;
        f.rows[0].cells[0].value.mAsset.unshift(asset("concurrent"));
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify(f.rows[0].cells[0].value));
        f.api.getAssetHTML(f.cells);
        f.unmount();
        if (action === "remove") submenu.items.find(item => item.id === "delete").click();
        else {
            submenu.input.value = "https://example.com/edited";
            await submenu.closeCallback();
        }
        const actual = plain(f.transactions[0].operations[0].data.mAsset);
        assert.deepEqual(actual, action === "remove" ? [asset("concurrent")] :
            [asset("concurrent"), {...original, content: "https://example.com/edited"}]);
    });
}

for (const sameHost of [true, false]) {
    test(`an awaited asset edit saves its original row without repainting a newer ${sameHost ? "same-host row" : "display instance"} panel`, async () => {
        const f = fixture("mAsset");
        const original = {type: "image", name: "original", content: "https://example.com/original.png"};
        f.rows[0].cells[0].value.mAsset = [original];
        f.cells[0].dataset.cellValue = encodeURIComponent(JSON.stringify(f.rows[0].cells[0].value));
        f.api.getAssetHTML(f.cells);
        let activePanel = f.panel;
        let activeMenu = f.menu;
        f.menu.innerHTML = "original panel";
        f.context.document.querySelector = selector => selector === ".av__panel" ? activePanel :
            selector === ".av__panel > .b3-menu" ? activeMenu : null;
        let finishUpload;
        f.state.base64Response = new Promise(resolve => {finishUpload = resolve;});
        f.api.editAssetItem({protyle: f.protyle, blockElement: f.block, cellElements: f.cells,
            ...original, index: 0, rect: {right: 20, bottom: 30, width: 20, height: 30}});
        f.state.submenu.input.value = "data:image/png;base64,AAAA";
        const pending = f.state.submenu.closeCallback();
        assert.equal(f.transactions.length, 0);

        f.panel.remove();
        f.menu.remove();
        f.unmount();
        const value = {id: "other-value", type: "mAsset", mAsset: [asset("other-row")]};
        f.rows.push({id: "other-row", cells: [{id: value.id, value, valueType: "mAsset"}]});
        const otherCell = element({dtype: "mAsset", colId: "column", rowId: "other-row",
            cellValue: encodeURIComponent(JSON.stringify(value))});
        const otherCells = [otherCell];
        const otherBlock = sameHost ? f.block : element({avId: "database", nodeId: "other-instance", avType: "table"});
        f.api.captureAVCellInput(f.protyle, otherBlock, otherCells);
        activePanel = element();
        activeMenu = element();
        activeMenu.innerHTML = "other row panel";
        activeMenu.closest = () => activePanel;
        f.context.setAVCellPanelTarget(activePanel, otherBlock, otherCells);

        finishUpload(["https://example.com/edited.png"]);
        await pending;
        assert.equal(f.transactions.length, 1);
        assert.equal(f.transactions[0].operations[0].rowID, "row-0");
        assert.equal(f.transactions[0].operations[0].data.mAsset[0].content, "https://example.com/edited.png");
        assert.equal(activeMenu.innerHTML, "other row panel");
        assert.equal(f.state.boundMenu, undefined);
        assert.equal(f.menu.innerHTML, "original panel");

        f.api.updateAssetCell({protyle: f.protyle, blockElement: f.block, cellElements: f.cells,
            addValue: [asset("later-original-save")]});
        assert.equal(f.transactions.length, 2);
        assert.equal(activeMenu.innerHTML, "other row panel");
        assert.equal(f.state.boundMenu, undefined);
    });
}

const optionSubmenu = f => {
    f.columns[0].options.push({name: "old-0", color: "1", desc: "description"});
    const target = element({name: "old-0", color: "1", desc: "description"});
    target.closest = () => target;
    target.parentElement = target;
    f.api.setColOption(f.protyle, f.state.data, target, f.block, false, f.cells);
    const submenu = f.state.submenu;
    submenu.input.value = "old-0";
    submenu.description.value = "description";
    return {
        rename: () => {submenu.input.value = "renamed"; submenu.closeCallback();},
        remove: () => {submenu.items.find(item => item.id === "delete").click();},
        color: () => {
            const grid = element();
            submenu.items.at(-1).bind(grid);
            const button = element({color: "2"}, ["color__square"]);
            button.closest = () => button;
            const event = new Event("click");
            Object.defineProperty(event, "target", {value: button});
            grid.dispatchEvent(event);
        },
    };
};

for (const action of ["rename", "remove", "color"]) {
    test(`option ${action} retains the column-wide operation and refreshes an unmounted target`, () => {
        const f = fixture("mSelect");
        const submenu = optionSubmenu(f);
        f.rows[0].cells[0].value.mSelect.push(option("concurrent"));
        f.unmount();
        submenu[action]();
        if (action === "remove") f.state.confirm();
        assert.equal(f.transactions.length, 1);
        const operation = f.transactions[0].operations[0];
        assert.equal(operation.action, action === "remove" ? "removeAttrViewColOption" : "updateAttrViewColOption");
        assert.equal(operation.id, "column");
        assert.equal(operation.avID, "database");
        assert.equal(operation.rowID, undefined);
        const current = f.rows[0].cells[0].value.mSelect;
        assert.ok(current.some(item => item.content === "concurrent"));
        if (action === "remove") assert.equal(current.some(item => item.content === "old-0"), false);
        else if (action === "rename") assert.equal(current[0].content, "renamed");
        else assert.equal(current[0].color, "2");
        assert.ok(f.cells[0], "the detached panel reference remains usable");
    });
    test(`option ${action} stops after the owning view or permission changes`, () => {
        const f = fixture("mSelect");
        const submenu = optionSubmenu(f);
        if (action === "remove") submenu.remove();
        f.state.data.viewID = "other";
        f.protyle.disabled = true;
        if (action === "remove") f.state.confirm();
        else submenu[action]();
        assert.equal(f.transactions.length, 0);
        assert.equal(f.rows[0].cells[0].value.mSelect[0].content, "old-0");
    });
}
