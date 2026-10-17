const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runCases = async (sources, css, mobile) => {
    const assert = require("node:assert/strict");
    const path = require("node:path").posix;
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
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
    let fieldMenu;
    let nextID = 0;
    window.Lute = {NewNodeID: () => `generated-${++nextID}`};
    window.siyuan = {languages: lang, config: {}, notebooks: [], zIndex: 0, menus: {menu: {remove() {}}}};
    const mocks = {
        "menus/menuToggle": {toggleMenu: options => {options.build(); options.show();}},
        "plugin/Menu": {Menu: class {items = []; addItem(item) {this.items.push(item);} open() {fieldMenu = {items: this.items};}}},
        "util/fetch": {fetchSyncPost: async (url, request) => url.includes("previewAttributeViewTemplate") ?
            (templatePreviews.push(request), {code: 0, data: {type: "date", date: {content: 1792713600000, isNotEmpty: true, isNotTime: true}}}) : url.includes("getHPathByID") ? {code: 0, data: "/Tasks"} :
            {code: 0, data: {av: request.id === "source" ? database : targetDatabase}},
        fetchPost: (_url, _request, callback) => searches.push(() => callback({code: 0, data: {rows: {values: [
            {blockID: "related", block: {content: "Related"}},
        ]}}}))},
        "protyle/wysiwyg/transaction": {transaction: (_protyle, perform, undo) => transactions.push(structuredClone({perform, undo}))},
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
    const sections = menu.querySelectorAll("section");
    assert.equal(sections.length, 3);
    assert.ok(sections[0].contains(get("[data-trigger]")));
    assert.ok(sections[1].contains(get("[data-source-conditions]")));
    assert.ok(sections[2].contains(get("[data-actions]")));
    assert.equal(get("[data-rule]").labels[0].textContent.includes(lang.automationRule), true);
    assert.equal(get("[data-enabled]").labels[0].textContent.trim(), "");
    assert.equal(get("[data-enabled]").getAttribute("aria-label"), lang.enable);
    assert.ok(get("[data-enabled]").classList.contains("ariaLabel"), "the enable switch exposes its label as a tooltip");
    assert.equal(get("[data-trigger-field] option").textContent, lang.automationAnyField);
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    assert.equal(transactions.length, 0, "opening settings must preserve the stored rule");
    const nameRect = get("[data-name]").getBoundingClientRect();
    const enabledRect = get("[data-enabled]").getBoundingClientRect();
    assert.ok(Math.abs((nameRect.top + nameRect.bottom) / 2 - (enabledRect.top + enabledRect.bottom) / 2) <= 1,
        "the enable switch aligns with the name input rather than its label");
    const ruleRect = get("[data-rule]").getBoundingClientRect();
    for (const action of ["add-rule", "remove-rule"]) {
        const button = get(`[data-action="${action}"]`).getBoundingClientRect();
        assert.ok(Math.abs((ruleRect.top + ruleRect.bottom) / 2 - (button.top + button.bottom) / 2) <= 1,
            "rule actions align with the selector rather than its label");
    }
    const removals = [
        ['[data-source-conditions] [data-condition="0"]', '[data-source-conditions] [data-action="remove-condition"]'],
        ['[data-actions] [data-index="0"]', '[data-actions] [data-action="remove-action"]'],
        ['[data-field-id="finished"]', '[data-actions] [data-action="remove-field"]'],
    ];
    assert.equal(matchMedia("(hover: none), (any-pointer: coarse)").matches, mobile, "touch devices have visible removal controls");
    for (const [rowSelector, buttonSelector] of removals) {
        const button = get(buttonSelector);
        button.scrollIntoView({block: "center"});
        await require("electron").ipcRenderer.invoke("automation-pointer", window.innerWidth - 2, 2);
        await tick();
        const before = button.getBoundingClientRect();
        assert.equal(getComputedStyle(button).opacity, mobile ? "1" : "0", "removal is contextual on desktop and visible on touch");
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
    get("[data-mode]").scrollIntoView({block: "center"});
    await tick();
    const scroller = get(".b3-menu__items");
    const assignmentScrollTop = scroller.scrollTop;
    assert.ok(assignmentScrollTop > 100, "the assignment is reached by scrolling before changing its mode");
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
    get("[data-template-preview]").open = true;
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
    for (const width of mobile ? [360, 740] : [560, 1000]) {
        await require("electron").ipcRenderer.invoke("automation-size", width, 900);
        for (const fontSize of ["", "28px"]) {
            menu.style.fontSize = fontSize;
            await tick();
            const selectorRect = get("[data-rule]").getBoundingClientRect();
            const nameInputRect = get("[data-name]").getBoundingClientRect();
            assert.ok(Math.abs(selectorRect.left - nameInputRect.left) <= 1 && Math.abs(selectorRect.right - nameInputRect.right) <= 1,
                `${mobile}/${width}/${fontSize}: rule selector and name input share their left and right edges`);
            for (const element of [menu, get(".av__automation-body"), ...menu.querySelectorAll("section, [data-index]")]) {
                assert.ok(element.scrollWidth <= element.clientWidth + 1, `${mobile}/${width}/${fontSize}: content overflows`);
            }
        }
        menu.style.fontSize = "";
        for (const name of ["daylight", "midnight"]) {
            theme.textContent = sources[name];
            get(".b3-menu__items").scrollTop = 0;
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}`);
            get('[data-action="add-action"]').scrollIntoView({block: "nearest"});
            await tick();
            assert.ok(get('[data-action="add-action"]').getBoundingClientRect().bottom <= 901,
                `${mobile}/${width}: actions remain reachable by scrolling: ${JSON.stringify(get('[data-action="add-action"]').getBoundingClientRect())}`);
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-actions`);
        }
    }
    await change("[data-trigger]", "block");
    assert.equal(get("[data-source-conditions]").closest("section").textContent.includes(lang.automationBlockConditions), true);
    assert.equal(menu.querySelector("[data-add-condition]"), null);
    assert.ok(get("[data-scope]"));
    assert.equal(get('[data-action="preview-collection"]').disabled, true);
    assert.equal(get("[data-status]").textContent, lang.automationReady);
    get("[data-enabled]").click();
    assert.equal(latest().enabled, true);
    assert.equal(get('[data-action="preview-collection"]').disabled, false);
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
                    button.focus();
                    assert.equal(document.activeElement, button, "collection controls remain keyboard focusable");
                }
                assert.ok(typesRect.top - tagsRect.bottom <= 12, "tag field has no extra trailing margin");
                assert.ok(addRect.top - typesRect.bottom <= 12, "empty attributes do not leave a gap");
            }
            menu.style.fontSize = "";
            get("[data-source-conditions]").scrollIntoView({block: "center"});
            await require("electron").ipcRenderer.invoke("automation-capture", `${mobile ? "mobile" : "desktop"}-${width}-${name}-collection`);
        }
    }
    await click("[data-types] svg");
    fieldMenu.items.forEach(item => item.click());
    await tick();
    await require("electron").ipcRenderer.invoke("automation-size", mobile ? 360 : 420, 900);
    menu.style.fontSize = "28px";
    await tick();
    assert.ok(latest().blockSource.types.length > 10);
    assert.ok(get("[data-types]").scrollWidth <= get("[data-types]").clientWidth + 1, "many selected block types wrap");
    await click("[data-add-attribute] svg");
    assert.equal(latest().blockSource.attributes.length, 1);
    await change("[data-attr-name]", "custom-status");
    await change("[data-attr-operator]", "equals");
    await change("[data-attr-value]", "ready");
    assert.deepEqual(latest().blockSource.attributes, [{name: "custom-status", operator: "equals", value: "ready"}]);
    await click('[data-remove="attribute"] svg');
    assert.equal(latest().blockSource.attributes.length, 0);
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
            ipcMain.handle("automation-pointer", (_event, x, y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", x, y}));
            ipcMain.handle("automation-capture", async (_event, name) => {
                if (!process.env.SIYUAN_AUTOMATION_CAPTURE_DIR) return;
                assert.match(name, /^(desktop|mobile)-\d+-(daylight|midnight)(-actions|-conditions|-collection)?$/);
                win.webContents.invalidate();
                await new Promise(resolve => setTimeout(resolve, 150));
                fs.writeFileSync(path.join(process.env.SIYUAN_AUTOMATION_CAPTURE_DIR, name + ".png"), (await win.webContents.capturePage()).toPNG());
            });
            const ts = require("typescript");
            const sass = require("sass");
            const sources = {icons: fs.readFileSync(path.join(__dirname, "../appearance/icons/litheness/icon.js"), "utf8"),
                languages: JSON.parse(fs.readFileSync(path.join(__dirname, "../appearance/langs/zh-CN.json"), "utf8"))};
            for (const name of ["automation", "automationPosition", "automationTemplate", "capabilities", "capabilities.generated", "filter", "filterTree", "fieldValueEditor", "blockCollection", "selectPosition", "filterDropdown"]) {
                sources[`protyle/render/av/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
                }).outputText;
            }
            for (const name of ["escape", "setPosition"]) {
                sources[`util/${name}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/util/${name}.ts`), "utf8"), {
                    compilerOptions: {module: ts.ModuleKind.CommonJS},
                }).outputText;
            }
            for (const name of ["daylight", "midnight"]) sources[name] = fs.readFileSync(path.join(__dirname, `../appearance/themes/${name}/theme.css`), "utf8");
            for (const mobile of [false, true]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
                await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: mobile});
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
    test("automation guidance preserves source and target filters, explicit activation, collection and responsive layout", async () => {
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
