const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile) => {
    const assert = require("node:assert/strict");
    const path = require("node:path").posix;
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const waitForDialogLayout = async dialog => {
        const container = dialog.element.querySelector(".b3-dialog__container");
        for (let attempt = 0; !dialog.element.classList.contains("b3-dialog--open") && attempt < 100; attempt++) {
            await tick();
        }
        assert.equal(dialog.element.classList.contains("b3-dialog--open"), true, "the dialog has opened before measuring its layout");
        await Promise.all(container.getAnimations().map(animation => animation.finished));
        assert.equal(getComputedStyle(container).transform, "none", "the dialog opening animation has finished");
    };
    document.head.innerHTML = "";
    document.body.innerHTML = '<div class="av__panel"><div class="b3-menu"></div></div>';
    document.body.className = "body--windows";
    new Function(sources.icons)();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const menu = document.querySelector(".b3-menu");
    if (mobile) {
        menu.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
        // 与移动端数据库底部面板的初始高度一致，内容通过面板内部滚动访问。
        menu.style.height = "56vh";
    }
    const lang = sources.languages;
    const currentCondition = {column: "status", operator: "=", value: {type: "select", mSelect: [{content: "Done"}]}};
    const database = {id: "source", name: "Tasks", keyValues: [
        {key: {id: "primary", name: "Name", type: "block"}, values: [{blockID: "sample", type: "block", block: {content: "Watering"}}]},
        {key: {id: "status", name: "Status", type: "select", options: [{name: "Done"}]}},
        {key: {id: "tags", name: "Tags", type: "mSelect", options: [{name: "Work"}]}},
        {key: {id: "finished", name: "Completion time", type: "date"}},
        {key: {id: "number", name: "Number", type: "number"}},
        {key: {id: "text", name: "Text", type: "text"}},
        {key: {id: "relation", name: "Time logs", type: "relation", relation: {avID: "target"}}},
    ], automations: {spec: 1, rules: [{id: "rule", name: "Record completion time", enabled: false, trigger: "changed", keyID: "status",
        conditions: [currentCondition], actions: [{type: "edit", target: "current", fields: {finished: {mode: "currentTime"}}}]}]}};
    const targetDatabase = {...database, id: "target", name: "Time logs"};
    const transactions = [];
    const templatePreviews = [];
    const searches = [];
    const scopePreviews = [];
    const scopeRequests = [];
    let fieldMenu;
    let collectionTypeInput;
    let nextID = 0;
    window.Lute = {NewNodeID: () => `generated-${++nextID}`};
    window.siyuan = {languages: lang, config: {}, notebooks: [], zIndex: 0, dialogs: [], storage: {}, blockPanels: [],
        menus: {menu: {element: document.createElement("div"), remove() {
            document.querySelectorAll("body > .b3-menu").forEach(popup => popup.remove());
        }}}};
    const mocks = {
        "menus/menuToggle": {toggleMenu: options => {options.build(); options.show();}},
        "plugin/Menu": {Menu: class {
            items = [];
            element = document.createElement("div");
            addItem(item) {
                this.items.push(item);
                if (item.bind) {
                    this.element.innerHTML = '<div class="b3-menu__items"><div></div></div>';
                    const custom = this.element.firstElementChild.firstElementChild;
                    custom.innerHTML = item.label;
                    item.bind(custom);
                }
            }
            open() {
                document.querySelectorAll("body > .b3-menu").forEach(popup => popup.remove());
                this.element.className = `b3-menu${mobile ? " b3-menu--fullscreen b3-menu--sheet" : ""}`;
                if (mobile) {
                    this.element.style.top = "auto";
                    this.element.style.bottom = "0";
                    this.element.style.height = "56vh";
                    this.element.style.transform = "translateY(0)";
                }
                document.body.append(this.element);
                fieldMenu = {items: this.items, element: this.element};
            }
            close() { this.element.remove(); }
            showSubMenu() {}
        }},
        "util/functions": {isMobile: () => mobile},
        "constants": {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_CONFIRM: "confirm"}},
        "util/genID": {genUUID: () => `dialog-${++nextID}`},
        "util/zIndex": {getZIndex: () => 0, isAbove: () => false},
        "dialog/moveResize": {moveResize() {}},
        "dialog/anchoredInput": {getAnchoredInputMask() {}},
        "block/panelOwnership": {getDialogBlockPanel() {}, destroyDialogBlockPanels() {}},
        "dialog/inputDialog": {openInputDialog: options => { collectionTypeInput = options; }},
        "block/Panel": {BlockPanel: class {constructor(options) {scopePreviews.push(options);}}},
        "util/pathName": {movePathTo: options => scopeRequests.push(options)},
        "util/fetch": {fetchSyncPost: async (url, request) => {
            if (url.includes("previewAttributeViewTemplate")) {
                templatePreviews.push(request);
                return {code: 0, data: {type: "date", date: {content: 1792713600000, isNotEmpty: true, isNotTime: true}}};
            }
            if (url.includes("getHPathByID")) return {code: 0, data: "/Tasks"};
            if (url === "/api/av/reviewAttributeViewCollection") {
                const items = Array.from({length: 20}, (_, index) => ({itemID: `entry-${index}`,
                    blockID: index % 3 === 2 ? "" : `block-${index}`, isDetached: index % 3 === 2,
                    content: index === 0 ? "<img src=x onerror=alert(1)>" : `Collected entry ${index + 1} with manually maintained fields`,
                    hPath: "/Tasks/" + "a-long-document-title".repeat(8),
                    reason: index % 3 === 2 ? "detached" : undefined, status: ["matched", "unmatched", "unknown"][index % 3]}));
                return {code: 0, data: {ruleVersion: "snapshot", matched: 7, unmatched: 7, unknown: 6, hasMore: false,
                    items: items.filter(item => !request.status || item.status === request.status)}};
            }
            if (url.includes("previewAttributeViewCollection")) return {code: 0, data: {hasMore: false, blocks: [
                {id: "bound", content: "Bound block", hPath: "/Tasks", collected: true},
                {id: "new", content: "Unbound block", hPath: "/Tasks", collected: false},
            ]}};
            return {code: 0, data: {av: request.id === "source" ? database : targetDatabase}};
        },
        fetchPost: (_url, _request, callback) => searches.push(() => callback({code: 0, data: {rows: {values: [
            {blockID: "related", block: {content: "Related"}},
        ]}}}))},
        "protyle/wysiwyg/transaction": {transaction: (_protyle, perform, undo) => transactions.push(structuredClone({perform, undo}))},
        "protyle/util/transactionQueue": {waitForPendingTransactions: async () => {}},
        "protyle/render/av/view": {getFieldsByData: data => data.view.columns},
        "protyle/render/av/col": {getColIconByType: () => "iconDatabase"},
        "protyle/render/av/color": {getAVColorStyle: () => ""},
        "protyle/render/av/cell": {getCellValueText: value => value.text?.content || "",
            genCellValue: (type, value) => ({type, mSelect: value})},
        "protyle/render/av/relation": {openSearchAV: options => options.callback({dataset: {avId: "target"}})},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
    };
    const cache = {};
    const load = name => {
        if (name === "dialog") name = "dialog/index";
        if (mocks[name]) return mocks[name];
        if (cache[name]) return cache[name];
        if (!sources[name]) return {};
        const exports = {};
        cache[name] = exports;
        new Function("exports", "require", sources[name])(exports, request => request === "dayjs" ? {default: require("dayjs")} :
            load(path.normalize(path.join(path.dirname(name), request))));
        return exports;
    };
    const resizeMenu = () => {
        if (mobile) {
            void menu.offsetHeight;
        } else {
            load("protyle/render/av/automationPosition").setAutomationMenuPosition(menu, {right: window.innerWidth, bottom: 100});
        }
    };
    window.addEventListener("resize", resizeMenu);
    await load("protyle/render/av/automation").openAutomationMenu({protyle: {options: {}, block: {rootID: "document"}},
        blockElement: {dataset: {nodeId: "carrier"}}, avID: "source", menuElement: menu, onResize: resizeMenu});
    const get = selector => {const element = menu.querySelector(selector); assert.ok(element, selector); return element;};
    const change = async (selector, value) => {
        const element = get(selector);
        element.value = value;
        element.dispatchEvent(new Event("change", {bubbles: true}));
        await tick();
    };
    const click = async selector => {get(selector).dispatchEvent(new MouseEvent("click", {bubbles: true})); await tick();};
    const latest = () => transactions.at(-1).perform[0].data.rules[0];
    const assertSearchAlignment = (popup, inputSelector, listSelector) => {
        const input = popup.querySelector(inputSelector).getBoundingClientRect();
        const list = popup.querySelector(listSelector);
        const row = list.querySelector(".b3-list-item:not(.fn__none)").getBoundingClientRect();
        assert.ok(Math.abs(input.left - row.left) <= 1, "search and list entries share their left edge");
        assert.ok(Math.abs(input.right - row.right - (list.offsetWidth - list.clientWidth)) <= 1,
            `search and entries share their right inset: ${input.right}/${row.right}`);
        const items = list.closest(".b3-menu__items");
        const filter = list.closest(".b3-menu__filter");
        const edge = popup.getBoundingClientRect().left + parseFloat(getComputedStyle(popup).borderLeftWidth) +
            parseFloat(getComputedStyle(items).paddingLeft) + parseFloat(getComputedStyle(filter).paddingLeft);
        assert.ok(Math.abs(input.left - edge) <= 1, "search and rows use the common menu inset without a second margin");
    };
    const assertChipActionSpacing = (listSelector, buttonSelector) => {
        const chips = Array.from(get(listSelector).querySelectorAll(".b3-chip"));
        assert.ok(chips.length > 0, "spacing checks require visible chips");
        const bottom = Math.max(...chips.map(chip => chip.getBoundingClientRect().bottom));
        const gap = get(buttonSelector).getBoundingClientRect().top - bottom;
        const expected = mobile ? 22 : 8;
        assert.ok(Math.abs(gap - expected) <= 1,
            `${listSelector} keeps the platform's chip spacing before its add button: ${gap}, expected ${expected}`);
    };
    const sections = menu.querySelectorAll("section");
    assert.equal(sections.length, 3);
    assert.ok(sections[0].contains(get("[data-trigger]")));
    assert.ok(sections[1].contains(get("[data-source-conditions]")));
    assert.ok(sections[2].contains(get("[data-actions]")));
    assert.equal(get('[data-action="rules"]').getAttribute("aria-label"), lang.automationRule);
    assert.equal(get("[data-enabled]").getAttribute("aria-label"), lang.enable);
    assert.ok(get("[data-enabled]").classList.contains("ariaLabel"), "the enable switch exposes its label as a tooltip");
    assert.equal(get("[data-trigger-field] option").textContent, lang.automationAnyField);
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    assert.equal(transactions.length, 0, "opening settings must preserve the stored rule");
    assert.equal(get("[data-notify-success]").checked, true, "legacy rules notify by default");
    get("[data-notify-success]").click();
    assert.equal(latest().notifyOnSuccess, false);
    assert.equal(latest().enabled, false, "notification settings do not enable a rule");
    get("[data-notify-success]").click();
    assert.equal(latest().notifyOnSuccess, true);
    const nameRect = get('[data-action="rename-rule"]').getBoundingClientRect();
    const enabledRect = get("[data-enabled]").getBoundingClientRect();
    assert.ok(Math.abs((nameRect.top + nameRect.bottom) / 2 - (enabledRect.top + enabledRect.bottom) / 2) <= 1,
        `the enable switch aligns with the rule name: ${JSON.stringify({mobile, width: window.innerWidth,
            nameRect, enabledRect, font: getComputedStyle(menu).font, rowGap: getComputedStyle(get("[data-enabled]").parentElement).rowGap})}`);
    const ruleRect = nameRect;
    for (const action of ["rules", "add-rule"]) {
        const button = get(`[data-action="${action}"]`).getBoundingClientRect();
        assert.ok(Math.abs((ruleRect.top + ruleRect.bottom) / 2 - (button.top + button.bottom) / 2) <= 1,
            "rule actions align with the selector rather than its label");
    }
    for (const property of ["width", "height", "padding", "color", "borderRadius"]) {
        assert.equal(getComputedStyle(get('[data-action="rules"]'))[property],
            getComputedStyle(get('[data-action="add-rule"]'))[property],
            `the rule arrow uses the same ${property} as the adjacent add icon`);
    }
    assert.equal(get('[data-action="rename-rule"]').getAttribute("aria-label"), lang.rename);
    assert.equal(get('[data-action="rules"]').contains(get("[data-rule-name]")), false,
        "name editing and rule switching have independent buttons");
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    await require("electron").ipcRenderer.invoke("automation-focus");
    const beginRename = async () => {
        await click('[data-action="rename-rule"]');
        const input = get("[data-rule-name-input]");
        assert.equal(document.activeElement, input);
        assert.equal(input.selectionStart, 0);
        assert.equal(input.selectionEnd, input.value.length);
        assert.equal(menu.querySelector('[data-action="rename-rule"]'), null);
        assert.ok(get('[data-action="rules"]'), "the rule switcher stays accessible while editing");
        return input;
    };
    const nameKey = (input, key, options = {}) => {
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true, ...options});
        input.dispatchEvent(event);
        return event;
    };
    const writesBeforeInlineRename = transactions.length;
    const cancelledName = await beginRename();
    cancelledName.value = "Cancelled name";
    assert.equal(nameKey(cancelledName, "Escape").defaultPrevented, true);
    cancelledName.dispatchEvent(new Event("blur"));
    assert.equal(transactions.length, writesBeforeInlineRename, "Escape and the following blur do not save");
    assert.equal(get("[data-rule-name]").textContent, "Record completion time");
    assert.equal(document.activeElement, get('[data-action="rename-rule"]'), "cancelling restores keyboard focus");
    for (const value of ["   ", "Record completion time"]) {
        const input = await beginRename();
        input.value = value;
        input.blur();
        assert.equal(input.isConnected, false, "blur closes name editing");
        assert.equal(transactions.length, writesBeforeInlineRename, "blank and unchanged names do not save");
        assert.equal(get("[data-rule-name]").textContent, "Record completion time");
    }
    get('[data-action="rename-rule"]').focus();
    await require("electron").ipcRenderer.invoke("automation-enter");
    await tick();
    const composedName = get("[data-rule-name-input]");
    composedName.value = '  <completion> & "time"  ';
    assert.equal(nameKey(composedName, "Enter", {isComposing: true}).defaultPrevented, false);
    assert.equal(nameKey(composedName, "Escape", {isComposing: true}).defaultPrevented, false);
    assert.equal(nameKey(composedName, "Enter", {keyCode: 229}).defaultPrevented, false);
    assert.equal(composedName.isConnected, true, "IME keys keep the editor open");
    assert.equal(transactions.length, writesBeforeInlineRename);
    nameKey(composedName, "Enter");
    composedName.dispatchEvent(new Event("blur"));
    assert.equal(transactions.length, writesBeforeInlineRename + 1, "Enter and blur submit one transaction");
    assert.equal(latest().name, '<completion> & "time"');
    assert.equal(latest().enabled, true, "renaming preserves an enabled rule");
    assert.equal(get("[data-rule-name]").textContent, '<completion> & "time"', "names render as text");
    assert.equal(get("[data-rule-name]").children.length, 0);
    assert.equal(transactions.at(-1).undo[0].data.rules[0].name, "Record completion time");
    assert.equal(database.automations.rules[0].name, "Record completion time", "the loaded snapshot is untouched");
    const restoredName = await beginRename();
    restoredName.value = "Record completion time";
    restoredName.blur();
    assert.equal(transactions.length, writesBeforeInlineRename + 2, "blur saves a changed name");
    assert.equal(transactions.at(-1).undo[0].data.rules[0].name, '<completion> & "time"');
    get("[data-enabled]").click();
    await click('[data-action="rules"]');
    const rulePopup = fieldMenu.element;
    assertSearchAlignment(rulePopup, "[data-search]", "[data-rules]");
    rulePopup.querySelector("[data-rename]").click();
    const renameInput = rulePopup.querySelector("[data-rules] input");
    renameInput.value = "Cancelled";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    const writesBeforeRename = transactions.length;
    assert.equal(latest().name, "Record completion time", "Escape cancels renaming");
    rulePopup.querySelector("[data-rename]").click();
    const nextName = rulePopup.querySelector("[data-rules] input");
    nextName.value = "Renamed completion";
    nextName.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    assert.equal(transactions.length, writesBeforeRename + 1);
    assert.equal(latest().name, "Renamed completion");
    assert.equal(transactions.at(-1).undo[0].data.rules[0].name, "Record completion time");
    const searchRules = rulePopup.querySelector("[data-search]");
    searchRules.value = "missing";
    searchRules.dispatchEvent(new Event("input"));
    assert.equal(rulePopup.querySelectorAll("[data-id]").length, 0);
    searchRules.value = "renamed";
    searchRules.dispatchEvent(new Event("input"));
    assert.equal(rulePopup.querySelectorAll("[data-id]").length, 1);
    rulePopup.querySelector(".b3-list-item__text").click();
    await tick();
    const removals = [
        ['[data-source-conditions] [data-condition="0"]', '[data-source-conditions] [data-action="remove-condition"]'],
        ['[data-actions] [data-index="0"]', '[data-actions] [data-action="remove-action"]'],
        ['[data-field-id="finished"]', '[data-actions] [data-action="remove-field"]'],
    ];
    // 可见性由媒体查询决定：带触摸屏的桌面主机在未模拟触控时同样命中 coarse 指针
    const touchControls = matchMedia("(hover: none), (any-pointer: coarse)").matches;
    if (mobile) {
        assert.ok(matchMedia("(hover: none)").matches, "touch emulation switches the hover capability");
    }
    for (const [rowSelector, buttonSelector] of removals) {
        const button = get(buttonSelector);
        button.scrollIntoView({block: "center"});
        await require("electron").ipcRenderer.invoke("automation-pointer", window.innerWidth - 2, 2);
        await tick();
        const before = button.getBoundingClientRect();
        assert.equal(getComputedStyle(button).opacity, touchControls ? "1" : "0",
            "removal is contextual on desktop and visible on touch");
        button.focus();
        assert.equal(getComputedStyle(button).opacity, "1", "keyboard focus reveals the removal button");
        button.blur();
        const rowRect = get(rowSelector).getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("automation-pointer", Math.round(rowRect.left + 8), Math.round(rowRect.top + 8));
        await tick();
        assert.equal(getComputedStyle(button).opacity, "1",
            `hovering the item's content reveals its removal button: ${rowSelector}, ${JSON.stringify(rowRect)}, ${Array.from(document.querySelectorAll(":hover"), item => item.className).join(" / ")}`);
        assert.equal(button.getBoundingClientRect().right, before.right, "revealing removal does not change its position");
    }
    await require("electron").ipcRenderer.invoke("automation-pointer", window.innerWidth - 2, 2);
    const originalConditions = structuredClone(database.automations.rules[0].conditions);
    await click('[data-source-conditions] [data-type="selectTrigger"]');
    assert.notEqual(get('[data-source-conditions] [data-type="selectDropdown"]').style.display, "none");
    await click(".av__automation-section");
    assert.equal(get('[data-source-conditions] [data-type="selectDropdown"]').style.display, "none",
        "clicking outside a condition dismisses its dropdown");
    await click('[data-source-conditions] [data-type="selectTrigger"]');
    await click('[data-source-conditions] [data-type="selectDropdown"]');
    assert.notEqual(get('[data-source-conditions] [data-type="selectDropdown"]').style.display, "none",
        "internal interaction does not dismiss the dropdown");
    await click('[data-source-conditions] [data-type="selectTrigger"]');
    assert.equal(get('[data-source-conditions] [data-type="selectDropdown"]').style.display, "none",
        "clicking the same trigger still toggles the dropdown closed");
    await click("[data-source-conditions] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Tags").click();
    await tick();
    await click('[data-column="tags"] [data-type="selectTrigger"]');
    await click('[data-column="tags"] [data-type="selectOption"]');
    assert.equal(latest().conditions[1].value.mSelect[0].content, "Work");
    assert.notEqual(get('[data-column="tags"] [data-type="selectDropdown"]').style.display, "none",
        "selecting an option keeps the dropdown open for further choices");
    await click('[data-column="status"] [data-type="selectTrigger"]');
    assert.equal(get('[data-column="tags"] [data-type="selectDropdown"]').style.display, "none",
        "opening another condition closes the previous dropdown even when paths match");
    await click('[data-column="tags"] [data-type="selectTrigger"]');
    assert.equal(get('[data-column="status"] [data-type="selectDropdown"]').style.display, "none");
    await click(".av__automation-section");
    assert.equal(get('[data-column="tags"] [data-type="selectDropdown"]').style.display, "none");
    await click('[data-source-conditions] [data-condition="1"] [data-action="remove-condition"]');
    await click("[data-source-conditions] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Time logs").click();
    await tick();
    await change('[data-column="relation"] [data-type="operation"]', "Contains any item");
    await click('[data-column="relation"] [data-type="relationFilterTrigger"]');
    assert.notEqual(get('[data-column="relation"] [data-type="relationFilterDropdown"]').style.display, "none");
    await click(".av__automation-section");
    searches.splice(0).forEach(finish => finish());
    assert.equal(get('[data-column="relation"] [data-type="relationFilterDropdown"]').style.display, "none",
        "late relation results do not reopen a dismissed dropdown");
    await change('[data-column="relation"] [data-type="operation"]', "Contains");
    const keywordInput = get('[data-column="relation"] [data-type-rel="relation"]');
    keywordInput.focus();
    keywordInput.value = "Related";
    keywordInput.dispatchEvent(new Event("input", {bubbles: true}));
    keywordInput.blur();
    await click(".av__automation-section");
    searches.splice(0).forEach(finish => finish());
    assert.equal(menu.querySelector('[data-type="relList"]'), null, "late keyword results do not recreate a dismissed candidate list");
    keywordInput.focus();
    keywordInput.dispatchEvent(new Event("input", {bubbles: true}));
    searches.splice(0).forEach(finish => finish());
    assert.equal(get('[data-type="relList"]').style.display, "block");
    keywordInput.blur();
    await click(".av__automation-section");
    assert.equal(get('[data-type="relList"]').style.display, "none");
    await click('[data-source-conditions] [data-condition="1"] [data-action="remove-condition"]');
    assert.deepEqual(latest().conditions, originalConditions);
    await click("[data-source-conditions] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Number").click();
    await tick();
    const numberCondition = get('[data-source-conditions] [data-column="number"]');
    const fieldRect = numberCondition.querySelector(".av__field-wrapper").getBoundingClientRect();
    const operatorRect = numberCondition.querySelector('[data-type="operation"]').getBoundingClientRect();
    const valueRect = numberCondition.querySelector('[data-type="filterValue"]').getBoundingClientRect();
    const removeRect = numberCondition.closest("[data-condition]").querySelector('[data-action="remove-condition"]').getBoundingClientRect();
    assert.ok(Math.abs(fieldRect.top - operatorRect.top) <= 1, "field and operator stay aligned");
    assert.ok(Math.abs(fieldRect.top - valueRect.top) <= 1, "a short number condition stays on one line");
    assert.ok(Math.abs(removeRect.right - numberCondition.closest("[data-condition]").getBoundingClientRect().right) <= 1,
        "removal aligns with the right edge of the condition row");
    await click("[data-source-conditions] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Text").click();
    await tick();
    const numberRow = get('[data-source-conditions] [data-condition="1"]');
    const textRow = get('[data-source-conditions] [data-condition="2"]');
    const sourceAddButton = get("[data-source-conditions] [data-add-condition]");
    assert.ok(textRow.getBoundingClientRect().top - numberRow.getBoundingClientRect().bottom >= 8, "conditions have visible spacing");
    assert.ok(sourceAddButton.getBoundingClientRect().top - textRow.getBoundingClientRect().bottom >= 8, "the add button is separated from existing conditions");
    await click("[data-source-conditions] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 560, 900);
    const conditionTheme = document.createElement("style");
    document.head.append(conditionTheme);
    for (const name of ["daylight", "midnight"]) {
        conditionTheme.textContent = sources[name];
        get("[data-source-conditions]").scrollIntoView({block: "center"});
        await tick();
        const currentNumber = get('[data-source-conditions] [data-column="number"]');
        const currentText = get('[data-source-conditions] [data-column="text"]');
        const numberField = currentNumber.querySelector(".av__field-wrapper").getBoundingClientRect();
        const numberValue = currentNumber.querySelector('[data-type="filterValue"]').getBoundingClientRect();
        assert.ok(Math.abs(numberField.top - numberValue.top) <= 1, "a short condition also fits on narrow screens");
        assert.ok(currentText.querySelector('[data-type="filterValue"]').clientWidth >= 48, "wrapped text values keep usable input space");
        for (const row of get("[data-source-conditions]").querySelectorAll("[data-condition]")) {
            assert.ok(row.scrollWidth <= row.clientWidth + 1, "conditions do not overflow");
            const field = row.querySelector(".av__field-wrapper").getBoundingClientRect();
            const remove = row.querySelector('[data-action="remove-condition"]').getBoundingClientRect();
            assert.ok(Math.abs(remove.right - row.getBoundingClientRect().right) <= 1, "all condition removal buttons align to the right");
            assert.ok(remove.top >= field.top && remove.bottom <= field.bottom + 1,
                `removal stays with the first line of a wrapped condition: ${JSON.stringify({field, remove})}`);
        }
        await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${mobile ? 360 : 560}-${name}-conditions`);
    }
    conditionTheme.remove();
    await click('[data-source-conditions] [data-condition="3"] [data-action="remove-condition"]');
    await click('[data-source-conditions] [data-condition="2"] [data-action="remove-condition"]');
    await click('[data-source-conditions] [data-condition="1"] [data-action="remove-condition"]');
    assert.deepEqual(latest().conditions, originalConditions);
    await change("[data-target]", "related");
    await change("[data-relation]", "relation");
    assert.equal(get("[data-status]").classList.contains("ft__error"), true);
    await click('[data-action="add-field"]');
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    await change("[data-mode]", "currentTime");
    assert.deepEqual(latest().conditions, originalConditions);
    assert.deepEqual(latest().actions[0].fields, {finished: {mode: "currentTime", value: {type: "date"}}});
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    await click("[data-target-filters] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    assert.equal(latest().actions[0].filters[0].column, "finished");
    assert.deepEqual(latest().conditions, originalConditions);
    await click("[data-target-filters] [data-add-condition]");
    fieldMenu.items.find(item => item.label === "Status").click();
    await tick();
    await click('[data-target-filters] [data-type="selectTrigger"]');
    assert.notEqual(get('[data-target-filters] [data-type="selectDropdown"]').style.display, "none");
    await click('[data-source-conditions] [data-type="selectTrigger"]');
    assert.equal(get('[data-target-filters] [data-type="selectDropdown"]').style.display, "none",
        "source and target conditions do not retain each other's dropdowns");
    await click(".av__automation-section");
    await click('[data-target-filters] [data-condition="1"] [data-action="remove-condition"]');
    await click('[data-target-filters] [data-action="remove-condition"]');
    assert.equal(latest().actions[0].filters.length, 0);
    assert.deepEqual(latest().conditions, originalConditions);
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    assert.equal(get("[data-status]").classList.contains("fn__none"), true);
    await change("[data-action-type]", "add");
    assert.equal(get("[data-target]").labels[0].querySelector("span").textContent, lang.database);
    assert.equal(get("[data-target-filters]").textContent, "");
    await change("[data-action-type]", "edit");
    assert.equal(get("[data-target]").labels[0].querySelector("span").textContent, lang.automationTarget);
    await change("[data-trigger]", "added");
    assert.equal(menu.querySelector("[data-trigger-field]"), null);
    assert.deepEqual(latest().conditions, originalConditions);
    await change("[data-trigger]", "changed");
    await change("[data-target]", "filtered");
    await click('[data-action="database"]');
    assert.equal(latest().actions[0].avID, "target");
    assert.ok(get("[data-target-filters] [data-add-condition]"));
    assert.deepEqual(latest().conditions, originalConditions);
    await change("[data-target]", "current");
    await click('[data-action="add-field"]');
    fieldMenu.items.find(item => item.label === "Completion time").click();
    await tick();
    await change("[data-mode]", "currentTime");
    const theme = document.createElement("style");
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 560, 620);
    // 非 100% 缩放下窗口内容高度可能有 1 像素的取整偏差
    for (let attempt = 0; Math.abs(window.innerHeight - 620) > 1 && attempt < 100; attempt++) { await tick(); }
    assert.ok(Math.abs(window.innerHeight - 620) <= 1,
        `the resized viewport is ready before testing assignment scrolling: ${window.innerHeight}`);
    get("[data-mode]").scrollIntoView({block: "center"});
    await tick();
    const scroller = get(".b3-menu__items");
    const assignmentScrollTop = scroller.scrollTop;
    assert.ok(assignmentScrollTop > 0, `the assignment is reached by scrolling before changing its mode: ${assignmentScrollTop}`);
    await change("[data-mode]", "template");
    assert.ok(Math.abs(scroller.scrollTop - assignmentScrollTop) <= 1,
        `switching to a template preserves the scrolled assignment: ${assignmentScrollTop} -> ${scroller.scrollTop}`);
    assert.ok(get("[data-mode]").getBoundingClientRect().top >= scroller.getBoundingClientRect().top,
        "the assignment remains visible after its template editor expands");
    await change("[data-mode]", "currentTime");
    get("[data-mode]").scrollIntoView({block: "center"});
    await tick();
    const repeatedScrollTop = scroller.scrollTop;
    await change("[data-mode]", "template");
    assert.ok(Math.abs(scroller.scrollTop - repeatedScrollTop) <= 1, "repeated mode switches also preserve scrolling");
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 560, 900);
    assert.equal(transactions.at(-1).perform[0].data.spec, 2, "templates use the new format");
    assert.ok(latest().timeZone, "the rule records the frontend timezone");
    const editor = get("[data-template]");
    editor.value = '.action{((now).AddDate 0 0 7).Format "2006-01-02"}';
    editor.dispatchEvent(new Event("input", {bubbles: true}));
    editor.dispatchEvent(new Event("change", {bubbles: true}));
    assert.match(latest().actions[0].fields.finished.template, /AddDate 0 0 7/);
    const assertFieldSpacing = () => {
        const fields = get("[data-fields]");
        const lastField = fields.lastElementChild;
        const gap = get('[data-action="add-field"]').getBoundingClientRect().top - lastField.getBoundingClientRect().bottom;
        assert.ok(gap >= 7 && gap <= 9, `the final field keeps a single 8px gap before the add button: ${gap}`);
    };
    assertFieldSpacing();
    get("[data-template-preview]").open = true;
    await tick();
    assertFieldSpacing();
    await change("[data-template-item]", "sample");
    await change("[data-template-time]", "2026-10-16T15:30");
    const writesBeforePreview = transactions.length;
    await click("[data-template-run]");
    assert.equal(templatePreviews.length, 1);
    assert.equal(templatePreviews[0].triggerTime, "2026-10-16T15:30");
    assert.equal(transactions.length, writesBeforePreview, "preview never saves or changes entries");
    assert.ok(get("[data-template-result]").textContent);
    assert.ok(get("[data-template-time]").getBoundingClientRect().bottom < get("[data-template-result]").getBoundingClientRect().top,
        "preview inputs precede the result");
    editor.value = '.action{field "finished"}';
    editor.dispatchEvent(new Event("input", {bubbles: true}));
    editor.dispatchEvent(new Event("change", {bubbles: true}));
    assert.ok(get('[data-template-input="finished"]'));
    assert.equal(get("[data-template-result]").textContent, "", "editing inputs invalidates old previews");
    const previewDate = get('[data-template-input="finished"]');
    previewDate.value = "2026-10-14";
    previewDate.dispatchEvent(new Event("input", {bubbles: true}));
    const writesBeforeInputPreview = transactions.length;
    await click("[data-template-run]");
    assert.equal(templatePreviews.at(-1).inputs.finished, "2026-10-14");
    assert.equal(transactions.length, writesBeforeInputPreview, "editing sample dates never saves a rule or entry");
    document.head.append(theme);
    const longRuleName = await beginRename();
    longRuleName.value = "Long automation name ".repeat(12).trim();
    nameKey(longRuleName, "Enter");
    for (const width of mobile ? [360, 740] : [560, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const fontSize of ["", "28px"]) {
            menu.style.fontSize = fontSize;
            await tick();
            assertFieldSpacing();
            get("[data-template-preview]").open = false;
            await tick();
            assertFieldSpacing();
            get("[data-template-preview]").open = true;
            await tick();
            assert.ok(get('[data-action="rules"]').getBoundingClientRect().width > 0);
            for (const element of [menu, get(".av__automation-body"), ...menu.querySelectorAll("section, [data-index]")]) {
                assert.ok(element.scrollWidth <= element.clientWidth + 1, `${mobile}/${width}/${fontSize}: content overflows`);
            }
            const nameInput = await beginRename();
            const inputRect = nameInput.getBoundingClientRect();
            const switchRect = get('[data-action="rules"]').getBoundingClientRect();
            assert.ok(inputRect.width > 0 && inputRect.right <= switchRect.left,
                "long names keep the editor and rule switcher on the same row");
            nameKey(nameInput, "Escape");
        }
        menu.style.fontSize = "";
        for (const name of ["daylight", "midnight"]) {
            theme.textContent = sources[name];
            get(".b3-menu__items").scrollTop = 0;
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}`);
            const nameInput = await beginRename();
            const visibleRect = nameInput.getBoundingClientRect();
            const panelRect = menu.getBoundingClientRect();
            assert.ok(visibleRect.top >= panelRect.top && visibleRect.bottom <= panelRect.bottom,
                `name editing stays visible inside its panel: ${JSON.stringify({mobile, visibleRect, panelRect, itemsRect: get(".b3-menu__items").getBoundingClientRect()})}`);
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-rename`);
            nameKey(nameInput, "Escape");
            get('[data-action="add-action"]').scrollIntoView({block: "nearest"});
            await tick();
            assert.ok(get('[data-action="add-action"]').getBoundingClientRect().bottom <= window.innerHeight + 1,
                `${mobile}/${width}: actions remain reachable by scrolling: ${JSON.stringify(get('[data-action="add-action"]').getBoundingClientRect())}`);
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-actions`);
        }
    }
    const shortRuleName = await beginRename();
    shortRuleName.value = "Renamed completion";
    nameKey(shortRuleName, "Enter");
    await change("[data-trigger]", "block");
    assert.ok(!get("[data-source-conditions]").textContent.includes("undefined"), "collection controls use defined localized labels");
    assert.equal(get("[data-collection-removal-tip]").textContent, lang.automationCollectionTip);
    assert.equal(get("[data-rule-change-tip]").textContent, lang.automationCollectionRuleChangeTip);
    assert.equal(get("[data-source-conditions]").closest("section").textContent.includes(lang.automationBlockConditions), true);
    assert.equal(menu.querySelector("[data-add-condition]"), null);
    const targetControl = get("[data-tag-target]").closest(".av__automation-control");
    const typeControl = get("[data-types]").closest(".av__automation-control");
    const tagControl = get("[data-tags]").closest(".av__automation-control");
    assert.equal(targetControl.nextElementSibling, typeControl, "collection target precedes block types");
    assert.equal(typeControl.nextElementSibling, tagControl, "tag conditions follow block types");
    assert.ok(get("[data-scope]"));
    assert.equal(get("[data-scope-control] > .av__automation-control-label").textContent, lang.automationCollectionScope);
    assert.equal(get("[data-scope-control] > .av__automation-control-label").closest("button"), null);
    assert.ok(get("[data-scope]").textContent.includes(lang.addAttr), "scope has its own add button like the other groups");
    assert.ok(get("[data-scope]").compareDocumentPosition(get(".av__automation-source-list")) & Node.DOCUMENT_POSITION_PRECEDING,
        "the add scope action follows existing entries");
    const writesBeforeScopePreview = transactions.length;
    const sourceButton = get("[data-preview-document]");
    assert.equal(sourceButton.tagName, "BUTTON");
    await click("[data-preview-document]");
    sourceButton.focus();
    assert.equal(document.activeElement, sourceButton, "scope document titles are keyboard focusable");
    await require("electron").ipcRenderer.invoke("automation-enter");
    await tick();
    assert.equal(scopePreviews.length, 2, "scope documents support pointer and native keyboard button activation");
    assert.equal(scopePreviews[0].targetElement, sourceButton);
    assert.deepEqual(scopePreviews[0].refDefs, [{refID: "document"}]);
    assert.equal(scopePreviews[0].isBacklink, false);
    assert.equal(menu.isConnected, true, "preview preserves the automation panel");
    assert.ok(menu.querySelector("[data-trigger]"));
    assert.equal(transactions.length, writesBeforeScopePreview, "preview does not change collection configuration");
    assert.equal(get(".popover__block").dataset.id, "document", "the document icon keeps its hover preview");
    await click("[data-scope]");
    scopeRequests[0].cb(["/", "/new-document.sy", "/new-document.sy"], ["notebook", "notebook", "notebook"]);
    await tick();
    assert.deepEqual(latest().blockSource.notebookIDs, ["notebook"]);
    assert.deepEqual(latest().blockSource.documentIDs, ["document", "new-document"], "scope additions retain existing entries and deduplicate");
    await click('[data-remove="document"][data-index="1"]');
    await click('[data-remove="notebook"]');
    assert.deepEqual(latest().blockSource.documentIDs, ["document"]);
    assert.equal(get('[data-action="manage-collection"]').disabled, false, "management remains available without an enabled rule");
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    assert.equal(menu.querySelector('[data-action="preview-collection"]'), null, "rule actions do not contain database-level management");
    assert.equal(latest().actions[0].type, "collect");
    assert.deepEqual(database.automations.rules[0].conditions, [currentCondition]);
    for (const width of mobile ? [360, 740] : [420, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const name of ["daylight", "midnight"]) {
            theme.textContent = sources[name];
            for (const fontSize of ["", "28px"]) {
                menu.style.fontSize = fontSize;
                await tick();
                const tagsRect = get("[data-tags]").getBoundingClientRect();
                const typesRect = get("[data-types]").getBoundingClientRect();
                const addRect = get("[data-add-attribute]").getBoundingClientRect();
                assert.ok(tagsRect.left >= 0 && tagsRect.right <= window.innerWidth, "collection form stays inside the viewport");
                for (const selector of ["[data-scope]", "[data-types]", "[data-add-attribute]"]) {
                    const button = get(selector);
                    assert.equal(button.getBoundingClientRect().left, tagsRect.left, "collection controls align with the form");
                    assert.ok(button.scrollWidth <= button.clientWidth + 1, "collection controls wrap without horizontal overflow");
                    assert.ok(parseFloat(getComputedStyle(button).lineHeight) >= parseFloat(getComputedStyle(button).fontSize) * 1.2,
                        "wrapped collection controls leave enough line height for large fonts");
                    button.focus();
                    assert.equal(document.activeElement, button, "collection controls remain keyboard focusable");
                }
                assert.ok(typesRect.height > 0 && addRect.height > 0);
                const targetButton = get("[data-tag-target]");
                assert.ok(targetButton.scrollWidth <= targetButton.clientWidth + 1, "collection targets wrap with shared button styles");
                assert.ok(targetButton.getBoundingClientRect().right <= window.innerWidth, "collection targets stay inside narrow layouts");
                assert.equal(menu.querySelector("[data-attr-name]"), null, "attribute editors stay collapsed until needed");
            }
            menu.style.fontSize = "";
            get("[data-source-conditions]").scrollIntoView({block: "center"});
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-collection`);
        }
    }
    await click("[data-types] svg");
    const typePopup = fieldMenu.element;
    const typeList = typePopup.querySelector("[data-type-list]");
    const customCallout = typePopup.querySelector("[data-custom-callout]");
    assert.equal(typeList.lastElementChild, customCallout, "custom callout is the final scrollable list entry");
    for (const width of mobile ? [360, 740] : [420, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const name of ["daylight", "midnight"]) {
            theme.textContent = sources[name];
            for (const size of [16, 24]) {
                typePopup.style.fontSize = `${size}px`;
                typeList.scrollTop = 0;
                await tick();
                assertSearchAlignment(typePopup, "[data-type-search]", "[data-type-list]");
                const popupWidth = typePopup.getBoundingClientRect().width;
                if (!mobile) {
                    assert.ok(popupWidth <= (size === 16 ? 242 : 338), "type menu stays compact while scaling for larger text");
                }
                assert.ok(popupWidth <= window.innerWidth, "compact menu stays within narrow viewports");
                const popupRect = typePopup.getBoundingClientRect();
                assert.ok(popupRect.top >= -1 && popupRect.bottom <= window.innerHeight + 1,
                    "opened search menus stay vertically inside the viewport");
                const first = typeList.firstElementChild.getBoundingClientRect();
                for (const item of typeList.children) {
                    assert.ok(Math.abs(item.getBoundingClientRect().width - first.width) <= 1, "all type rows stretch to the same full width");
                }
                assert.ok(typeList.scrollHeight > typeList.clientHeight, "long type lists scroll inside the popup");
                assert.ok(customCallout.getBoundingClientRect().top > typeList.getBoundingClientRect().bottom,
                    "custom callout is not pinned below the search list");
                typeList.scrollTop = typeList.scrollHeight;
                assert.ok(customCallout.getBoundingClientRect().bottom <= typeList.getBoundingClientRect().bottom + 1,
                    "the final custom action is reachable by scrolling");
                typeList.scrollTop = 0;
                await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-${size === 16 ? "types" : "types-large"}`);
            }
        }
    }
    typePopup.style.fontSize = "";
    typePopup.querySelector('[data-collection-type="l"]').click();
    assert.deepEqual(latest().blockSource.types, ["l"]);
    assertChipActionSpacing("[data-type-chips]", "[data-types]");
    typePopup.querySelector('[data-collection-type="l:o"]').click();
    assert.deepEqual(latest().blockSource.types, ["l:o"]);
    assert.equal(transactions.at(-1).perform[0].data.spec, 3);
    assert.equal(typePopup.isConnected, true, "type selection keeps the searchable list open");
    const typeSearch = typePopup.querySelector("[data-type-search]");
    typeSearch.value = lang.heading1;
    typeSearch.dispatchEvent(new Event("input"));
    assert.equal(typePopup.querySelector('[data-collection-type="l:o"]').classList.contains("fn__none"), true);
    assert.equal(typePopup.querySelector('[data-collection-type="h:h1"]').classList.contains("fn__none"), false);
    typePopup.querySelector("[data-custom-callout]").click();
    collectionTypeInput.onConfirm("CUSTOM", {destroy() {}});
    assert.deepEqual(latest().blockSource.types, ["l:o", "callout:CUSTOM"]);
    await click("[data-types]");
    fieldMenu.element.querySelectorAll("[data-collection-type]").forEach(item => item.click());
    await tick();
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 420, 900);
    menu.style.fontSize = "28px";
    await tick();
    assert.ok(latest().blockSource.types.length > 10);
    assert.ok(get("[data-types]").scrollWidth <= get("[data-types]").clientWidth + 1, "many selected block types wrap");
    assert.equal(menu.querySelectorAll("[data-type-chips] .b3-chip").length, latest().blockSource.types.length);
    assertChipActionSpacing("[data-type-chips]", "[data-types]");
    const draftWrites = transactions.length;
    await click("[data-add-attribute] svg");
    assert.equal(transactions.length, draftWrites, "adding an attribute starts an unsaved draft");
    const attributeName = get("[data-attr-name]");
    assert.equal(document.activeElement, attributeName, "adding an attribute focuses its name");
    assert.equal(attributeName.value, "custom-");
    assert.deepEqual([attributeName.selectionStart, attributeName.selectionEnd], [7, 7],
        "the caret starts after the custom attribute prefix");
    await change("[data-attr-name]", "custom-status");
    await click("[data-attr-operator]");
    fieldMenu.items.find(item => item.label === lang.filterOperatorIs).click();
    await change("[data-attr-value]", "ready");
    assert.equal(transactions.length, draftWrites, "editing a draft does not save it");
    await click("[data-confirm-attribute]");
    assert.deepEqual(latest().blockSource.attributes, [{name: "custom-status", operator: "equals", value: "ready"}]);
    assertChipActionSpacing("[data-attribute-chips]", "[data-add-attribute]");
    await click("[data-edit-attribute]");
    await change("[data-attr-value]", "cancelled");
    get("[data-attr-value]").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await tick();
    assert.deepEqual(latest().blockSource.attributes, [{name: "custom-status", operator: "equals", value: "ready"}]);
    await click('[data-remove-filter="attribute"]');
    assert.equal(latest().blockSource.attributes.length, 0);
    for (const [nameOperator, label, name] of [
        ["contains", lang.filterOperatorContains, "dailynote"],
        ["regex", lang.regex, "^custom-\\D+-[0-9]{8}$"],
    ]) {
        await click("[data-add-attribute]");
        await click("[data-attr-name-operator]");
        assert.equal(fieldMenu.items.find(item => item.label === lang.filterOperatorIs).checked, true);
        fieldMenu.items.find(item => item.label === label).click();
        await change("[data-attr-name]", name);
        await click("[data-confirm-attribute]");
        assert.deepEqual(latest().blockSource.attributes, [{name, nameOperator, operator: "exists"}]);
        assert.equal(transactions.at(-1).perform[0].data.spec, 6);
        await click("[data-edit-attribute]");
        assert.equal(get("[data-attr-name]").value, name, "regex escapes retain their case");
        await click("[data-cancel-attribute]");
        await click('[data-remove-filter="attribute"]');
    }
    await click('[data-match="tagMatch"]');
    fieldMenu.items.find(item => item.label === lang.filterMatchAny).click();
    assert.equal(latest().blockSource.tagMatch, "or");
    await click('[data-match="attributeMatch"]');
    fieldMenu.items.find(item => item.label === lang.filterMatchAny).click();
    assert.equal(latest().blockSource.attributeMatch, "or");
    assert.equal(get("[data-tag-target] span").textContent, lang.default);
    assert.equal(latest().blockSource.tagTarget, undefined, "existing rules retain their collection granularity");
    for (const [value, label] of [["block", lang.automationCollectionTargetBlock], ["container", lang.automationCollectionTargetContainer], ["", lang.default]]) {
        await click("[data-tag-target]");
        const targetOption = fieldMenu.items.find(item => item.label === get("[data-tag-target] span").textContent);
        assert.equal(targetOption.checked, true, "the current target is checked in the shared menu");
        fieldMenu.items.find(item => item.label === label).click();
        assert.equal(latest().blockSource.tagTarget, value || undefined);
        assert.equal(transactions.at(-1).perform[0].data.spec, 6);
        assert.equal(get("[data-tag-target] span").textContent, label);
        assert.ok(get("[data-tag-target]").scrollWidth <= get("[data-tag-target]").clientWidth + 1, "all target labels wrap at narrow widths and large fonts");
        assert.equal(get("[data-tag-target-change-tip]").classList.contains("fn__none"), false);
        assert.ok(get("[data-tag-target-change-tip]").textContent.includes(lang.automationCollectionTargetChangeTip));
        if (value === "container") {
            get("[data-tag-target]").scrollIntoView({block: "center"});
            await tick();
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${window.innerWidth}-midnight-collection`);
        }
    }
    await click("[data-tags] button");
    const tagInput = get("[data-tags] input");
    tagInput.value = " #todo# ";
    tagInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await tick();
    assert.deepEqual(latest().blockSource.tags, ["todo"]);
    assert.equal(get("[data-tags] .b3-chip span").textContent, "todo");
    assertChipActionSpacing("[data-tags] .b3-chips", "[data-tags] button");
    await click("[data-tags] button");
    get("[data-tags] input").value = "todo";
    get("[data-tags] input").dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await tick();
    assert.equal(menu.querySelectorAll("[data-tags] .b3-chip").length, 1, "tag normalization removes duplicates");
    await click("[data-tags] .b3-chip__close");
    assert.deepEqual(latest().blockSource.tags, []);
    const writesBeforeReview = transactions.length;
    database.automations.rules = [structuredClone(latest())];
    await click('[data-action="manage-collection"]');
    assert.equal(window.siyuan.dialogs.length, 1, "collection review uses the shared dialog on desktop and mobile");
    const reviewDialog = window.siyuan.dialogs[0];
    await waitForDialogLayout(reviewDialog);
    const reviewBody = reviewDialog.element.querySelector(".b3-dialog__body");
    const reviewContent = reviewDialog.element.querySelector(".av__collection-manager");
    const reviewTabs = reviewDialog.element.querySelector("[data-collection-view]").parentElement;
    assert.equal(reviewTabs.parentElement, reviewBody, "view navigation sits above the padded scrolling content");
    reviewTabs.style.setProperty("--b3-ui-tab-min-height", "35px");
    await Promise.all(reviewTabs.firstElementChild.getAnimations().map(animation => animation.finished));
    assert.equal(getComputedStyle(reviewTabs.firstElementChild).minHeight, "35px", "view tabs respect shared tab sizing");
    reviewTabs.style.removeProperty("--b3-ui-tab-min-height");
    await Promise.all(reviewTabs.firstElementChild.getAnimations().map(animation => animation.finished));
    assert.equal(reviewDialog.element.querySelectorAll("[data-results] img").length, 0, "source text is escaped");
    assert.equal(transactions.length, writesBeforeReview, "reviewing entries does not mutate the database");
    const reviewTheme = document.createElement("style");
    document.head.append(reviewTheme);
    for (const width of mobile ? [360, 740] : [420, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const fontSize of [16, 24]) {
            document.documentElement.style.setProperty("--b3-font-size", `${fontSize}px`);
            for (const name of ["daylight", "midnight"]) {
                reviewTheme.textContent = sources[name];
                await tick();
                await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-review`);
                for (const element of reviewDialog.element.querySelectorAll(".b3-dialog__body, .b3-dialog__action, .av__collection-tabs, .item__text, [data-results], button")) {
                    assert.ok(element.scrollWidth <= element.clientWidth + 1,
                        `${mobile}/${width}/${fontSize}: review content overflows ${element.className}: ${element.scrollWidth}/${element.clientWidth}`);
                    const rect = element.getBoundingClientRect();
                    assert.ok(rect.left >= -1 && rect.right <= window.innerWidth + 1, "review controls stay within the viewport");
                }
                const tabsRect = reviewTabs.getBoundingClientRect();
                const bodyRect = reviewBody.getBoundingClientRect();
                assert.ok(Math.abs(tabsRect.left - bodyRect.left) < 1 && Math.abs(tabsRect.right - bodyRect.right) < 1,
                    "view navigation spans the dialog without a padded inset");
                reviewContent.scrollTop = reviewContent.scrollHeight;
                assert.equal(reviewTabs.getBoundingClientRect().top, tabsRect.top, "scrolling results keeps view navigation in place");
                assert.equal(reviewBody.scrollTop, 0, "content scrolling does not scroll the dialog body");
                reviewContent.scrollTop = 0;
                const previous = reviewDialog.element.querySelector("[data-prev]").getBoundingClientRect();
                const cleanup = reviewDialog.element.querySelector("[data-cleanup]").getBoundingClientRect();
                if (cleanup.top > previous.bottom) {
                    assert.ok(cleanup.top - previous.bottom >= 8,
                        `wrapped review actions preserve their spacing: ${JSON.stringify({mobile, width, fontSize, theme: name,
                            previous, cleanup, gap: cleanup.top - previous.bottom,
                            transform: getComputedStyle(reviewDialog.element.querySelector(".b3-dialog__container")).transform,
                            rowGap: getComputedStyle(reviewDialog.element.querySelector(".b3-dialog__action")).rowGap})}`);
                }
                reviewDialog.element.querySelector("[data-cleanup]").click();
                await tick();
                const confirmation = window.siyuan.dialogs[1];
                await waitForDialogLayout(confirmation);
                for (const element of confirmation.element.querySelectorAll(".b3-dialog__body, button")) {
                    assert.ok(element.scrollWidth <= element.clientWidth + 1, "confirmation wraps at narrow widths and large fonts");
                }
                await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-review-confirm`);
                confirmation.element.querySelector("#cancelDialogConfirmBtn").click();
                await tick();
            }
        }
    }
    reviewDialog.element.querySelector("[data-cleanup]").click();
    await tick();
    assert.equal(window.siyuan.dialogs.length, 2, "cleanup requires explicit confirmation");
    await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${window.innerWidth}-midnight-review-confirm`);
    document.querySelector("#cancelDialogConfirmBtn").click();
    await tick();
    assert.equal(transactions.length, writesBeforeReview, "canceling cleanup preserves all entries");
    reviewDialog.element.querySelector("[data-cleanup]").click();
    await tick();
    document.querySelector("#confirmDialogConfirmBtn").click();
    await tick();
    const cleanup = transactions.at(-1).perform[0];
    assert.equal(cleanup.action, "cleanupAttrViewBlocks");
    assert.equal(cleanup.data.items.length, 7, "cleanup only submits the page's unmatched entries");
    assert.equal(cleanup.data.ruleVersion, "snapshot");
    reviewDialog.element.querySelector('[data-collection-status="matched"]').click();
    await tick();
    assert.equal(reviewDialog.element.querySelectorAll("[data-results] img").length, 0, "matching source text is escaped");
    assert.equal(reviewDialog.element.querySelectorAll("[data-remove-item]").length, 0, "matching entries have no removal action");
    reviewDialog.element.querySelector('[data-collection-status="unknown"]').click();
    await tick();
    assert.ok(reviewDialog.element.querySelector("[data-results]").textContent.includes(lang.automationCollectionReasonDetached));
    assert.equal(reviewDialog.element.querySelector("[data-cleanup]").classList.contains("fn__none"), true);
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 420, 900);
    await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${window.innerWidth}-midnight-review-unknown`);
    reviewDialog.element.querySelector("[data-remove-item]").click();
    await tick();
    document.querySelector("#confirmDialogConfirmBtn").click();
    await tick();
    assert.equal(transactions.at(-1).perform[0].action, "removeAttrViewBlock");
    assert.equal(transactions.at(-1).undo[0].action, "insertAttrViewBlock");
    reviewDialog.element.querySelector('[data-collection-view="rules"]').click();
    await tick();
    assert.equal(reviewDialog.element.querySelector("[data-status-tabs]").classList.contains("fn__none"), true);
    assert.equal(reviewDialog.element.querySelector("[data-collection-rule]").options.length, 1);
    assert.ok(reviewDialog.element.querySelector("[data-results]").textContent.includes(lang.automationCollectionNotCollected));
    await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${window.innerWidth}-midnight-review-rules`);
    reviewDialog.element.querySelector("[data-collect]").click();
    await tick();
    assert.equal(transactions.at(-1).perform[0].action, "collectAttrViewBlocks");
    assert.deepEqual(transactions.at(-1).perform[0].data.blockIDs, ["new"]);
    reviewDialog.destroy();
    reviewTheme.remove();
    await tick();
    await click('[data-action="add-rule"]');
    const secondID = transactions.at(-1).perform[0].data.rules[1].id;
    const newRuleName = await beginRename();
    assert.equal(newRuleName.value, lang.databaseAutomations, "new rules can be named in the editor");
    newRuleName.value = "New collection";
    get('[data-action="rules"]').focus();
    assert.equal(transactions.at(-1).perform[0].data.rules[1].name, "New collection");
    assert.equal(transactions.at(-1).perform[0].data.rules[1].enabled, false, "naming an incomplete rule keeps it disabled");
    assert.equal(transactions.at(-1).undo[0].data.rules[1].name, lang.databaseAutomations);
    assert.equal(transactions.at(-1).perform[0].data.rules[0].name, "Renamed completion");
    get('[data-action="rules"]').focus();
    await require("electron").ipcRenderer.invoke("automation-enter");
    await tick();
    fieldMenu.element.querySelector('[data-id="rule"] .b3-list-item__text').click();
    await tick();
    assert.equal(get("[data-rule-name]").textContent, "Renamed completion");
    await click('[data-action="rules"]');
    fieldMenu.element.querySelector(`[data-id="${secondID}"] .b3-list-item__text`).click();
    await tick();
    assert.equal(get("[data-rule-name]").textContent, "New collection", "switching rules retains the committed name");
    await click('[data-action="rules"]');
    fieldMenu.element.querySelector('[data-id="rule"] [data-more]').click();
    const deletionTip = fieldMenu.element.querySelector('[data-id="rule"] [data-rule-change-tip]');
    assert.equal(deletionTip.textContent, lang.automationCollectionRuleChangeTip);
    assert.ok(deletionTip.scrollWidth <= deletionTip.clientWidth + 1, "the collection deletion notice wraps on narrow screens");
    assert.equal(fieldMenu.element.querySelector('[data-id="rule"] .b3-menu__submenu').style.display, "block");
    fieldMenu.element.querySelector('[data-id="rule"] [data-delete]').click();
    await tick();
    assert.equal(transactions.at(-1).perform[0].data.rules.length, 1);
    assert.equal(transactions.at(-1).perform[0].data.rules[0].id, secondID, "deleting another rule preserves the current rule");
    assert.equal(transactions.at(-1).undo[0].data.rules.length, 2);
    await click('[data-action="rules"]');
    fieldMenu.element.querySelector("[data-delete]").click();
    await tick();
    assert.equal(transactions.at(-1).perform[0].data.rules.length, 0);
    assert.ok(get('[data-action="rules"]'), "deleting the current rule opens a fresh disabled draft");
    assert.equal(get("[data-enabled]").checked, false);
    const draftName = await beginRename();
    draftName.value = "Named draft";
    nameKey(draftName, "Enter");
    assert.equal(latest().name, "Named draft", "an empty database's draft can be named directly");
    assert.equal(latest().enabled, false);
    assert.deepEqual(transactions.at(-1).undo[0].data.rules, []);
    window.removeEventListener("resize", resizeMenu);
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow, ipcMain} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1000, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            ipcMain.handle("automation-size", (_event, width, height) => win.setContentSize(width, height));
            ipcMain.handle("automation-focus", () => win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true}));
            ipcMain.handle("automation-enter", () => {
                win.webContents.focus();
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "ENTER"});
                win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "ENTER"});
            });
            ipcMain.handle("automation-pointer", (_event, x, y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", x, y}));
            ipcMain.handle("automation-capture", async (_event, name) => {
                if (!process.env.SIYUAN_AUTOMATION_CAPTURE_DIR) return;
                assert.match(name, /^(desktop|mobile)-\d+-(daylight|midnight)(-rename|-actions|-conditions|-collection|-review|-review-confirm|-review-unknown|-review-rules|-types|-types-large)?$/);
                win.webContents.invalidate();
                await new Promise(resolve => setTimeout(resolve, 150));
                fs.writeFileSync(path.join(process.env.SIYUAN_AUTOMATION_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
            });
            const ts = require("typescript");
            const sass = require("sass");
            const sources = {icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"),
                languages: JSON.parse(fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"))};
            for (const name of ["automation", "automationRules", "automationPosition", "automationTemplate", "capabilities", "capabilities.generated", "filter", "filterTree", "fieldValueEditor", "blockCollection", "collectionConditions", "collectionReference", "collectionReview", "selectPosition", "filterDropdown"]) {
                sources[`protyle/render/av/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
                }).outputText;
            }
            sources["menus/aliasInput"] = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/menus/aliasInput.ts"), "utf8"), {
                compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
            }).outputText;
            for (const name of ["dialog/index", "dialog/confirmDialog"]) {
                sources[name] = ts.transpileModule(fs.readFileSync(path.join(__dirname,
                    `../src/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
                }).outputText;
            }
            for (const name of ["escape", "setPosition", "upDownHint"]) {
                sources[`util/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/util/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS},
                }).outputText;
            }
            for (const name of ["daylight", "midnight"]) sources[name] = fs.readFileSync(path.join(__dirname, `../appearance/themes/${name}/theme.css`), "utf8");
            for (const mobile of [false, true]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
                if (mobile) {
                    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
                }
                const css = sources.daylight + sass.compile(path.join(__dirname, `../src/assets/scss/${mobile ? "mobile" : "base"}.scss`), {logger: sass.Logger.silent}).css;
                await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${mobile})`);
            }
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("automation guidance preserves inline naming, source and target filters, explicit activation, collection and responsive layout", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-automation-panel-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 60000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
