const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = (full = false) => {
    const ts = require("typescript");
    const source = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname,
        "../src/protyle/gutter/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const gutter = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "Gutter");
    const render = gutter.members.find(node => node.name?.getText(source) === "render");
    const getNodeElement = gutter.members.find(node => node.name?.getText(source) === "getNodeElement");
    const renderMenu = gutter.members.find(node => node.name?.getText(source) === "renderMenu");
    let multiSelectAction;
    const collectMultiSelect = node => {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
            property.name?.getText(source) === "id" && property.initializer?.getText(source) === '"multiSelect"')) {
            multiSelectAction = node.properties.find(property => property.name?.getText(source) === "click").initializer;
        }
        ts.forEachChild(node, collectMultiSelect);
    };
    collectMultiSelect(renderMenu);
    assert.ok(multiSelectAction);
    const menuType = renderMenu.body.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "type"));
    const interactions = [];
    const collectInteractions = node => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
            ['"dragstart"', '"click"'].includes(node.arguments[0].getText(source))) {
            interactions.push(node.getText(source));
        }
        ts.forEachChild(node, collectInteractions);
    };
    const constructor = gutter.members.find(ts.isConstructorDeclaration);
    collectInteractions(constructor);
    const restoreGutter = constructor.body.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "restoreGutter"));
    const body = full ? render.body.getText(source) :
        render.body.getText(source).split("const shouldRenderInsert")[0] + "return html; }";
    const helpers = ["protyle/gutter/container.ts", "protyle/gutter/hover.ts", "protyle/wysiwyg/getBlock.ts", "protyle/gutter/layout.ts",
        "protyle/util/hasClosest.ts", "protyle/render/autoDirection.ts", "mobile/util/blockSelection.ts"].map(file => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        return source.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => ["getListItemGutterContainer", "getTopAloneElement",
                "getSbChildBlockCount", "getParentBlock", "getGutterMarginHeight", "getFixedGutterPosition",
                "getBacklinkGutterContentTop", "getListGutterAnchorLeft", "getContainerGutterSpace", "isContainerGutterBridge",
                "cancelGutterHover", "renderGutterOnHover", "pendingGutterHovers",
                "hasClosestBlock", "isBlockElement", "hasClosestByClassName", "hasTopClosestByClassName", "hasClosestByTag",
                "hasClosestByAttribute", "getAutoListDirection", "listSelector", "directionAttribute",
                "getMobileBlockSelectionElement"].includes(declaration.name.getText(source))))
            .map(node => node.getText(source)).join("\n");
    }).join("\n").replace(/export const /g, "const ");
    const hoverSource = ts.createSourceFile("initUI.ts", readFileSync(path.join(__dirname,
        "../src/protyle/ui/initUI.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let hoverBinding;
    let leaveBinding;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(hoverSource) === "protyle.element.addEventListener" &&
            node.arguments[0].getText(hoverSource).includes('"pointerover"')) {
            hoverBinding = node.getText(hoverSource);
        }
        if (ts.isCallExpression(node) && node.expression.getText(hoverSource) === "protyle.element.addEventListener" &&
            node.arguments[0].getText(hoverSource) === '"mouseleave"' && node.getText(hoverSource).includes("cancelGutterHover")) {
            leaveBinding = node.getText(hoverSource);
        }
        ts.forEachChild(node, visit);
    };
    visit(hoverSource);
    assert.ok(hoverBinding);
    assert.ok(leaveBinding);
    const events = readFileSync(path.join(__dirname, "../src/boot/globalEvent/mousemove.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") +
        `\nfunction bindHover(protyle) { let overAttr = false; ${leaveBinding}; ${hoverBinding}; }`;
    const interactionSource = `function getNodeElement(protyle, element) ${getNodeElement.body.getText(source)}
function mobileMultiSelect(protyle, nodeElement) {
    ${menuType.getText(source)}
    return (${multiSelectAction.getText(source)})();
}
function bindInteractions(protyle) {
    let isGutterDragging = false;
    let dragCleanupController;
    ${restoreGutter.getText(source)}
    ${interactions.join("\n")};
}`;
    return ts.transpileModule(helpers + `\nfunction render(protyle, element, target) ${body}\n` +
        (full ? events + interactionSource : ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const cases = async (source, fullSource, css) => {
    const check = require("node:assert/strict");
    const noop = () => false;
    let multiSelect = false;
    const clicked = [];
    const folded = [];
    const dependencies = {
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", ZWSP: "|", SIYUAN_DROP_BLOCK: "block",
            SIYUAN_DROP_GUTTER: "gutter:"}, hideElements: noop, getCrossBlockTextRange: noop,
        getGutterSelection: selected => ({isMultiSelect: multiSelect, selectElements: selected}),
        getGutterSelectionTarget: (selected, element) => selected.find(item => item === element || item.contains(element)),
        getHorizontalSuperBlockChild: noop, getEmbedGutterOperationContext: noop, isInEmbedBlock: noop,
        isInAVBlock: noop, hasViewFoldContext: noop, getGutterFixedContainerRect: noop,
        isMobile: () => mobile, isWindow: noop, isTabGutterBridge: noop, isMac: noop,
        getAllModels: () => ({editor: [{editor: {protyle}}], backlink: []}), getAllEditor: () => [{protyle}],
        isGutterInsertStateMatched: (count, insert) => count === (insert ? 4 : 0),
        getBlockTypeName: type => type, getIconByType: () => "iconTest",
        genGutterBlockButtonHTML: data => `<button data-type="${data.type}" data-node-id="${data.nodeID}"><svg><use href="#iconTest"></use></svg><span ${data.draggable ? 'draggable="true"' : ""}></span></button>`,
        hideTooltip: noop, clearSelect: noop, isOnlyMeta: noop, isEncryptedBox: noop,
        prepareCrossBlockTextSelection: noop, getContenteditableElement: element => element.querySelector('[contenteditable="true"]'),
        genEmptyElement: () => {const element = document.createElement("div"); element.innerHTML = '<div contenteditable="true"></div>'; return element;},
        getLangByType: type => type,
        setDragTipGhost: noop, stringifyBlockDragData: JSON.stringify, restoreGutterRange: noop,
        setFold: (_owner, element) => {folded.push(element.dataset.nodeId); return {fold: 1};},
        markGutterForFoldRestore: () => true, isGutterTouchDragging: noop,
        toggleMenu: options => options.build(null, {show: callback => callback()}),
    };
    const render = new Function(...Object.keys(dependencies), source + "\nreturn render;")(...Object.values(dependencies));
    const {render: renderFull, windowMouseMove, bindHover, getNodeElement, bindInteractions, mobileMultiSelect} = new Function(...Object.keys(dependencies),
        fullSource + "\nreturn {render, windowMouseMove, bindHover, getNodeElement, bindInteractions, mobileMultiSelect};")(...Object.values(dependencies));
    let mobile = false;
    window.siyuan = {languages: {fold: "Fold", rowTip: "Row", addBelowAbove: "Add"}, layout: {}, blockPanels: [],
        config: {editor: {fontSize: 16, rtl: false}, system: {workspaceDir: "test"}}};
    const style = document.createElement("style");
    style.textContent = `body {margin:0; width:1000px; height:800px} .protyle-wysiwyg {margin:80px 180px;width:500px}
        .li {position:relative;padding-left:34px} .protyle-action {position:absolute;left:0;top:0;width:24px;height:34px}
        .mindmap-view {margin:12px;height:160px} .protyle-gutters {position:fixed;display:flex}
        .protyle-gutters > button {box-sizing:border-box;width:24px;height:24px;padding:0}`;
    document.head.append(style);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const gutter = {element: document.createElement("div"), gutterTip: "${x}"};
    gutter.element.className = "protyle-gutters";
    document.body.append(gutter.element);
    const protyle = {element: root, contentElement: root, wysiwyg: {element: root}, options: {}};
    const attr = '<div class="protyle-attr"></div>';
    for (const extra of ["", '<div data-node-id="second" data-type="NodeParagraph">Second</div>']) {
        for (const [type, cls] of [["NodeTable", "table"], ["NodeBlockquote", "bq"], ["NodeCallout", "callout"],
            ["NodeSuperBlock", "sb"], ["NodeTabs", "tabs"], ["NodeMindmap", "list"],
            ["NodeList", "list"], ["NodeAttributeView", "av"], ["NodeCodeBlock", "code-block"],
            ["NodeIFrame", "iframe"]]) {
            const child = '<div data-node-id="child" data-type="NodeParagraph">Child</div>';
            const content = type === "NodeCallout" ? `<div class="callout-info"><div class="callout-title">Title</div></div><div class="callout-content">${child}</div>` : child;
            root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list">
<div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action"></div>
<div data-node-id="container" data-type="${type}" class="${cls}">${content}${attr}</div>${extra}${attr}</div>${attr}</div>`;
            if (type === "NodeMindmap" || type === "NodeList") {
                const container = root.querySelector('[data-node-id="container"]');
                container.setAttribute("custom-sy-list-mindmap", "1");
                container.insertAdjacentHTML("afterbegin", '<div class="mindmap-view"></div>');
            }
            for (const id of ["container", "child", "item"]) {
                const element = root.querySelector(`[data-node-id="${id}"]`);
                const html = render.call(gutter, protyle, element, element);
                check.ok(html?.includes(`data-type="${type}" data-node-id="container"`), `${type}/${id}/${!!extra}: ${html}`);
                check.ok(html?.includes('data-type="NodeListItem"'), `${type}/${id}/${!!extra}: ${html}`);
            }
            for (const subtype of ["u", "o", "t"]) {
                root.querySelector('[data-node-id="list"]').setAttribute("data-subtype", subtype);
                root.querySelector('[data-node-id="item"]').setAttribute("data-subtype", subtype);
                const container = root.querySelector('[data-node-id="container"]');
                const marker = root.querySelector(".protyle-action");
                check.equal(render.call(gutter, protyle, marker, marker),
                    render.call(gutter, protyle, container, container), `${type}/${subtype}/${!!extra}: marker gutters`);
                const positions = [container, marker, root.querySelector('[data-node-id="item"]')].map(element => {
                    renderFull.call(gutter, protyle, element, element);
                    return [gutter.element.style.left, gutter.element.style.top];
                });
                check.deepEqual(positions[0], positions[1], `${type}/${subtype}/${!!extra}: marker position`);
                check.deepEqual(positions[0], positions[2], `${type}/${subtype}/${!!extra}: item position`);
                check.ok(parseFloat(positions[0][0]) < marker.getBoundingClientRect().left,
                    `${type}: gutter must stay left of the list marker`);
                check.ok(gutter.element.getBoundingClientRect().right <= marker.getBoundingClientRect().left,
                    `${type}: gutter must not overlap the list marker`);
            }
        }
    }
    root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list"><div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action"></div><div data-node-id="p" data-type="NodeParagraph">Text</div>${attr}</div>${attr}</div>`;
    check.ok(!render.call(gutter, protyle, root.querySelector('[data-node-id="p"]')).includes('data-type="NodeParagraph"'));
    check.equal(render.call(gutter, protyle, root.querySelector(".protyle-action")),
        render.call(gutter, protyle, root.querySelector('[data-node-id="p"]')));

    // 使用实际样式与两条悬停入口，覆盖容器多子块及序标之间的连续移动。
    style.textContent = css + `\n:root {--b3-font-size-editor:16px;--b3-font-family:Arial}
        body {margin:0} .protyle {position:relative;width:1000px;height:700px}
        .protyle-wysiwyg {padding:60px 180px;font-size:16px;line-height:1.625}
        .mindmap-view {height:140px} .av__views {height:48px} .av__row {height:40px}
        .av__body {height:160px} .iframe iframe {height:120px;width:240px}`;
    const pane = document.createElement("div");
    pane.className = "protyle";
    document.body.append(pane);
    pane.append(root, gutter.element);
    Object.assign(protyle, {element: pane, contentElement: pane, options: {render: {gutter: true}},
        selectElement: document.createElement("div"), gutter});
    protyle.selectElement.className = "fn__none";
    gutter.render = (...args) => renderFull.apply(gutter, args);
    gutter.getNodeElement = (_owner, button) => root.querySelector(`[data-node-id="${button.dataset.nodeId}"]`);
    const errors = [];
    window.addEventListener("error", event => errors.push(event.message));
    window.addEventListener("mousemove", windowMouseMove);
    bindHover(protyle);
    mobile = true;
    bindHover(protyle);
    const state = () => ({left: gutter.element.style.left, top: gutter.element.style.top,
        ids: Array.from(gutter.element.querySelectorAll("button[data-node-id]")).map(button => button.dataset.nodeId)});
    const hover = (target, x, y) => {
        const rect = target.getBoundingClientRect();
        x ??= rect.left + Math.min(12, rect.width / 2);
        y ??= rect.top + Math.min(16, rect.height / 2);
        target.dispatchEvent(new PointerEvent(mobile ? "pointerover" : "mouseover",
            {bubbles: true, pointerType: "mouse", clientX: x, clientY: y}));
        target.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: x, clientY: y}));
        check.deepEqual(errors, []);
        return state();
    };
    const p = (id, text = id) => `<div data-node-id="${id}" data-type="NodeParagraph" class="p"><div contenteditable="true">${text}</div>${attr}</div>`;
    const fixtures = [
        ["NodeSuperBlock", "sb", p("child") + p("child2")],
        ["NodeSuperBlock", "sb", p("child") + p("child2"), "col"],
        ["NodeAttributeView", "av", '<div class="av__views">Database</div><div class="av__body"><div class="av__row" data-id="row"><div class="av__cell">Cell</div></div></div>'],
        ["NodeBlockquote", "bq", p("child") + p("child2")],
        ["NodeCallout", "callout", `<div class="callout-info"><div class="callout-title">Title</div></div><div class="callout-content">${p("child")}${p("child2")}</div>`],
        ["NodeTable", "table", "<table><tbody><tr><td>Cell</td></tr></tbody></table>"],
        ["NodeCodeBlock", "code-block", '<div class="hljs">Line<br>Line<br>Line</div>'],
        ["NodeMindmap", "list", '<div class="mindmap-view">Mindmap</div>'],
        ["NodeList", "list", '<div class="mindmap-view">Legacy mindmap</div>'],
        ["NodeList", "list", `<div data-node-id="nested-item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div>${p("child")}${attr}</div>`],
        ["NodeIFrame", "iframe", '<div><iframe src="about:blank"></iframe></div>'],
        ["NodeTabs", "tabs", '<div class="tabs-header">Tab</div><div data-node-id="tab" data-type="NodeTabItem" class="tab-item">' + p("child") + "</div>"],
    ];
    const containerTypes = new Set(fixtures.map(([type]) => type));
    fixtures.push(...[
        ["NodeParagraph", "p"], ["NodeHeading", "h1"], ["NodeMathBlock", "render-node"],
        ["NodeHTMLBlock", "render-node"], ["NodeWidget", "iframe"], ["NodeVideo", "video"],
        ["NodeAudio", "audio"], ["NodeThematicBreak", "hr"], ["NodeBlockQueryEmbed", "render-node"],
        ["NodeCustomBlock", "protyle-custom"], ["NodeYamlFrontMatter", "code-block"],
    ].map(([type, cls]) => [type, cls, '<div contenteditable="true">Content</div>']));
    const movements = [];
    for (const platform of [false, true]) {
        mobile = platform;
        for (const [type, cls, content, layout = "row"] of fixtures) {
            for (const variant of ["u", "o", "t", "nested"]) {
                const subtype = variant === "nested" ? "u" : variant;
                const legacyMindmap = type === "NodeList" && content.includes("mindmap-view");
                root.innerHTML = `<div data-node-id="list" data-type="NodeList" data-subtype="${subtype}" class="list">
<div data-node-id="item" data-type="NodeListItem" data-subtype="${subtype}" class="li"><div class="protyle-action">1.</div>
<div data-node-id="container" data-type="${type}" class="${cls}" ${type === "NodeSuperBlock" ? `data-sb-layout="${layout}"` : ""}
${legacyMindmap ? 'custom-sy-list-mindmap="1"' : ""}>${content}${attr}</div>${p("after")}${attr}</div>${attr}</div>`;
                if (variant === "nested") {
                    root.innerHTML = `<div data-node-id="outer-list" data-type="NodeList" class="list"><div data-node-id="outer-item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div>${root.innerHTML}${attr}</div>${attr}</div>`;
                }
                gutter.element.innerHTML = "";
                gutter.element.classList.add("fn__none");
                const container = root.querySelector('[data-node-id="container"]');
                const marker = root.querySelector('[data-node-id="item"] > .protyle-action');
                const child = container.querySelector('[data-node-id="child"]');
                const target = container.querySelector(".callout-info, .av__views, .tabs-header") || child || container;
                // 脑图控制器会直接以脑图根块显示块标。
                if (type === "NodeMindmap" || legacyMindmap) {
                    gutter.render(protyle, container, container);
                } else {
                    hover(target);
                }
                const before = state();
                check.ok(before.ids.length > 0, `${type}: missing block gutter`);
                if (type !== "NodeList" || legacyMindmap) {
                    const expectedID = containerTypes.has(type) ? "container" : variant === "nested" ? "outer-item" : "item";
                    check.ok(before.ids.includes(expectedID), `${type}: missing block gutter`);
                }
                const after = hover(marker);
                if (JSON.stringify(after) !== JSON.stringify(before)) {
                    movements.push({type, subtype, mobile, before, after});
                }
                if (type === "NodeAttributeView") {
                    // 从隐藏状态先经过序标进入数据库，位置也应一致。
                    gutter.element.innerHTML = "";
                    gutter.element.classList.add("fn__none");
                    check.deepEqual(hover(marker), before, "database marker uses the same vertical offset on first entry");
                    check.deepEqual(hover(target), before, "entering the database from its marker does not move the gutter");
                    const row = container.querySelector(".av__row");
                    hover(row.firstElementChild);
                    check.equal(gutter.element.querySelector("button").dataset.rowId, "row");
                    check.equal(parseFloat(gutter.element.style.top), row.getBoundingClientRect().top,
                        "database row actions stay beside the hovered row");
                    check.deepEqual(hover(marker), before, "returning to the marker leaves database row actions");
                }
                hover(root.querySelector('[data-node-id="after"]'));
                check.ok(!state().ids.includes("container"), `${type}: unrelated content must replace the retained gutter`);
            }
        }
    }
    check.deepEqual(movements, [], "moving to the marker must preserve gutters");

    window.siyuan.config.editor.blockGutterMode = false;
    window.siyuan.menus = {menu: {element: document.createElement("div"), remove() {}, fullscreen() {}, popup() {}}};
    Object.assign(protyle, {toolbar: {range: {}}, block: {rootID: "document"}, notebookId: "notebook"});
    gutter.getNodeElement = (...args) => getNodeElement.apply(gutter, args);
    gutter.isMatchNode = () => true;
    gutter.renderMenu = (_owner, button) => clicked.push(gutter.getNodeElement(protyle, button).dataset.nodeId);
    bindInteractions.call(gutter, protyle);
    const assertTargets = ids => {
        check.deepEqual(state().ids, ids);
        for (const id of ids) {
            const button = gutter.element.querySelector(`button[data-node-id="${id}"]`);
            check.equal(gutter.getNodeElement(protyle, button), root.querySelector(`[data-node-id="${id}"]`));
            button.click();
            check.equal(clicked.at(-1), id, "each block icon opens its own menu");
            const transfer = new DataTransfer();
            button.querySelector("span").dispatchEvent(new DragEvent("dragstart", {bubbles: true, dataTransfer: transfer}));
            check.deepEqual(errors, []);
            check.ok(transfer.types.some(type => type.startsWith("gutter:") && type.includes(`|${id}|`)),
                `${id}: dragging uses the icon's exact block ID`);
            window.dispatchEvent(new Event("dragend"));
        }
        gutter.element.querySelectorAll('[data-type="fold"]').forEach(button => {
            const id = button.previousElementSibling.dataset.nodeId;
            check.ok(id, "fold controls stay adjacent to their block");
            button.click();
            check.equal(folded.at(-1), id);
        });
    };
    for (const platform of [false, true]) {
        mobile = platform;
        for (const subtype of ["u", "o", "t"]) {
            root.innerHTML = `<div data-node-id="list" data-type="NodeList" data-subtype="${subtype}" class="list"><div data-node-id="item" data-type="NodeListItem" data-subtype="${subtype}" class="li"><div class="protyle-action">-</div>${p("paragraph")}${attr}</div>${attr}</div>`;
            const paragraph = root.querySelector('[data-node-id="paragraph"]');
            gutter.render(protyle, paragraph);
            assertTargets(["list", "item"]);
            check.equal(gutter.element.classList.contains("protyle-gutters--full"), false);
            const before = state();
            check.deepEqual(hover(root.querySelector(".protyle-action")), before,
                "compact single-item indicators stay stable when moving to the list marker");
            if (mobile) {
                let selected;
                protyle.toolbar.showMultiSelectMode = (_owner, element) => { selected = element; };
                const item = root.querySelector('[data-node-id="item"]');
                mobileMultiSelect(protyle, item);
                check.equal(selected, item, "the compact list item menu selects the item instead of the whole list");
            }
            const list = root.querySelector('[data-node-id="list"]');
            list.lastElementChild.insertAdjacentHTML("beforebegin", `<div data-node-id="second-item" data-type="NodeListItem" data-subtype="${subtype}" class="li"><div class="protyle-action">-</div>${p("second-paragraph")}${attr}</div>`);
            gutter.render(protyle, paragraph);
            assertTargets(["list", "item"]);
            gutter.render(protyle, root.querySelector('[data-node-id="second-paragraph"]'));
            assertTargets(["second-item"]);
            root.querySelector('[data-node-id="second-item"]').remove();
            gutter.render(protyle, paragraph);
            assertTargets(["list", "item"]);
            paragraph.insertAdjacentHTML("afterend", p("extra-paragraph"));
            gutter.render(protyle, paragraph);
            assertTargets(["list", "item"]);
            check.equal(gutter.element.querySelector('[data-type="fold"]').previousElementSibling.dataset.nodeId, "item");
        }
        const list = `<div data-node-id="list" data-type="NodeList" class="list"><div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div>${p("paragraph")}${attr}</div>${attr}</div>`;
        for (const [html, ids] of [
            [`<div data-node-id="quote" data-type="NodeBlockquote" class="bq">${list}${attr}</div>`, ["quote", "list", "item"]],
            [`<div data-node-id="callout" data-type="NodeCallout" class="callout"><div class="callout-info">Title</div><div class="callout-content">${list}</div>${attr}</div>`, ["list", "item"]],
            [`<div data-node-id="super" data-type="NodeSuperBlock" class="sb" data-sb-layout="row">${list}${attr}</div>`, ["super", "list", "item"]],
            [`<div data-node-id="tabs" data-type="NodeTabs" class="tabs"><div class="tabs-header">Tab</div><div data-node-id="tab" data-type="NodeTabItem" class="tab-item"><div class="tab-item-content">${list}</div>${attr}</div>${attr}</div>`, ["tab", "list", "item"]],
        ]) {
            root.innerHTML = html;
            gutter.render(protyle, root.querySelector('[data-node-id="paragraph"]'));
            assertTargets(ids);
        }
    }

    window.siyuan.config.editor.blockGutterMode = true;
    for (const platform of [false, true]) {
        mobile = platform;
        for (const [type, cls, content, layout = "row"] of fixtures) {
            root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list"><div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div><div data-node-id="container" data-type="${type}" class="${cls}" data-sb-layout="${layout}">${content}${attr}</div>${p("after")}${attr}</div>${attr}</div>`;
            const container = root.querySelector('[data-node-id="container"]');
            if (type === "NodeList" && content.includes("mindmap-view")) {
                container.setAttribute("custom-sy-list-mindmap", "1");
            }
            gutter.render(protyle, container, container);
            assertTargets(["list", "item", "container"]);
            gutter.render(protyle, root.querySelector('[data-node-id="after"]'));
            assertTargets(["list", "item", "after"]);
        }
        for (const subtype of ["u", "o", "t"]) {
            root.innerHTML = `<div data-node-id="list" data-type="NodeList" data-subtype="${subtype}" class="list"><div data-node-id="item" data-type="NodeListItem" data-subtype="${subtype}" class="li"><div class="protyle-action">-</div>${p("paragraph")}${attr}</div>${attr}</div>`;
            gutter.render(protyle, root.querySelector('[data-node-id="paragraph"]'));
            assertTargets(["list", "item", "paragraph"]);
            const before = state();
            check.deepEqual(hover(root.querySelector(".protyle-action")), before,
                "moving from a paragraph to the list marker retains the complete chain");
            gutter.render(protyle, root.querySelector(".protyle-action"));
            check.equal(state().left, before.left, "direct marker entry uses the same horizontal anchor as its content");
            check.ok(gutter.element.getBoundingClientRect().right <= root.querySelector(".protyle-action").getBoundingClientRect().left,
                "complete indicators do not overlap unordered, ordered or task markers");
        }
    }

    for (const full of [false, true]) {
        window.siyuan.config.editor.blockGutterMode = full;
        for (const rtl of [false, true]) {
            window.siyuan.config.editor.rtl = rtl;
            for (const subtype of ["u", "o", "t"]) {
                root.innerHTML = `<div data-node-id="outer-list" data-type="NodeList" class="list"><div data-node-id="outer-item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div>${p("outer")}<div data-node-id="list" data-type="NodeList" data-subtype="${subtype}" class="list"><div data-node-id="item" data-type="NodeListItem" data-subtype="${subtype}" class="li"><div class="protyle-action">-</div>${p("paragraph")}${attr}</div>${attr}</div>${attr}</div>${attr}</div>`;
                const paragraph = root.querySelector('[data-node-id="paragraph"]');
                const marker = paragraph.previousElementSibling;
                gutter.render(protyle, paragraph);
                const before = state().left;
                gutter.render(protyle, marker);
                check.equal(state().left, before, `nested ${subtype} marker anchor: full=${full}, rtl=${rtl}`);
            }
        }
    }
    window.siyuan.config.editor.rtl = false;
    window.siyuan.config.editor.blockGutterMode = true;

    root.innerHTML = `<div data-node-id="outer-list" data-type="NodeList" class="list"><div data-node-id="outer-item" data-type="NodeListItem" class="li"><div class="protyle-action">-</div>${p("first")}<div data-node-id="quote" data-type="NodeBlockquote" class="bq">${p("qfirst")}<div data-node-id="tabs" data-type="NodeTabs" class="tabs"><div class="tabs-header">Tabs</div><div data-node-id="tab" data-type="NodeTabItem" class="tab-item"><div class="tab-item-content">${p("leaf")}</div>${attr}</div>${attr}</div>${attr}</div>${attr}</div>${attr}</div>`;
    gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
    assertTargets(["outer-list", "outer-item", "quote", "tabs", "tab", "leaf"]);
    const nestedState = state();
    const leafRect = root.querySelector('[data-node-id="leaf"]').getBoundingClientRect();
    check.deepEqual(hover(root.querySelector('[data-node-id="quote"]'),
        (gutter.element.getBoundingClientRect().right + leafRect.left) / 2, leafRect.top + 5), nestedState,
        "crossing ancestor padding preserves the current complete chain");
    protyle.disabled = true;
    gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
    check.equal(gutter.element.querySelectorAll('[draggable="true"]').length, 0, "read-only icons remain non-draggable");
    protyle.disabled = false;
    gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));

    const checkFullLayout = vertical => {
        const buttons = Array.from(gutter.element.querySelectorAll("button[data-node-id], button[data-type='fold']"));
        const rects = buttons.map(button => button.getBoundingClientRect());
        check.equal(new Set(rects.map(rect => vertical ? rect.left : rect.top)).size, 1,
            "complete indicators occupy one whole row or one whole column");
        for (const [index, button] of buttons.entries()) {
            const rect = rects[index];
            for (const x of [rect.left + 1, rect.right - 1]) {
                const y = rect.top + rect.height / 2;
                const target = document.elementFromPoint(x, y);
                check.equal(target?.closest("button"), button,
                    `stable pointer target: ${button.dataset.nodeId || button.dataset.type} at ${x},${y}`);
                const before = state();
                check.deepEqual(hover(target, x, y), before, "moving across indicators preserves the whole chain");
            }
        }
    };
    checkFullLayout(false);
    root.style.paddingLeft = "24px";
    gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
    checkFullLayout(true);
    const firstRect = gutter.element.querySelector("button[data-node-id]").getBoundingClientRect();
    check.ok(Math.abs(firstRect.top - root.querySelector('[data-node-id="leaf"]').getBoundingClientRect().top) <= 8,
        "a vertical chain starts at the content's first line");
    root.insertAdjacentHTML("beforeend", p("neighbor"));
    const neighbor = root.querySelector('[data-node-id="neighbor"]');
    const pause = () => new Promise(resolve => setTimeout(resolve, 200));
    for (const platform of [false, true]) {
        mobile = platform;
        gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
        const before = state();
        check.deepEqual(hover(neighbor), before, "crossing an adjacent block does not immediately replace a vertical chain");
        const button = gutter.element.querySelector('button[data-node-id="leaf"]');
        hover(button);
        await pause();
        check.deepEqual(state(), before, "entering the vertical chain cancels the pending adjacent-block switch");
        hover(neighbor);
        await pause();
        check.deepEqual(state().ids, ["neighbor"], "staying over adjacent content still switches to that block");
        gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
        const beforeLeave = state();
        hover(neighbor);
        pane.dispatchEvent(new MouseEvent("mouseleave"));
        await pause();
        check.deepEqual(state(), beforeLeave, "leaving the editor cancels its pending block switch");
    }
    neighbor.remove();
    root.style.paddingLeft = "180px";
    gutter.render(protyle, root.querySelector('[data-node-id="leaf"]'));
    checkFullLayout(false);

    pane.style.cssText = "width:320px;height:200px";
    root.style.cssText = "padding:20px 24px;width:250px";
    document.documentElement.style.setProperty("--b3-font-size-editor", "48px");
    const deepIDs = Array.from({length: 16}, (_, index) => `deep-${index}`);
    root.innerHTML = deepIDs.reduceRight((html, id) =>
        `<div data-node-id="${id}" data-type="NodeBlockquote" class="bq">${html}${attr}</div>`, p("deep-leaf"));
    gutter.render(protyle, root.querySelector('[data-node-id="deep-leaf"]'));
    check.deepEqual(state().ids, [...deepIDs, "deep-leaf"]);
    const bounds = gutter.element.getBoundingClientRect();
    const viewport = pane.getBoundingClientRect();
    check.ok(bounds.left >= viewport.left && bounds.right <= viewport.right && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
        "full indicators stay within a narrow pane with large editor fonts");
    check.equal(gutter.element.dataset.scrollable, "true", "deep chains are scrollable");
    gutter.element.scrollTop = gutter.element.scrollHeight;
    const previousButton = gutter.element.querySelector("button[data-node-id]");
    const previousScrollTop = gutter.element.scrollTop;
    gutter.render(protyle, root.querySelector('[data-node-id="deep-leaf"]'));
    check.equal(gutter.element.querySelector("button[data-node-id]"), previousButton, "repeated rendering keeps full-mode buttons stable");
    check.equal(gutter.element.scrollTop, previousScrollTop, "repeated rendering preserves the visible level");
    const lastButton = gutter.element.querySelector('button[data-node-id="deep-leaf"]');
    const lastRect = lastButton.getBoundingClientRect();
    check.equal(document.elementFromPoint(lastRect.left + lastRect.width / 2, lastRect.top + lastRect.height / 2)?.closest("button"), lastButton,
        "the innermost block remains clickable after scrolling");

    multiSelect = true;
    root.innerHTML = p("selected1") + p("selected2");
    root.querySelectorAll("[data-node-id]").forEach(element => element.classList.add("protyle-wysiwyg--select"));
    gutter.render(protyle, root.firstElementChild);
    check.deepEqual(state().ids, ["selected1"], "full mode retains the existing multi-selection target");
    check.equal(gutter.element.querySelectorAll(".protyle-gutters__line, .protyle-gutters__plus").length, 0);
    check.equal(gutter.element.classList.contains("protyle-gutters--full"), false);
    multiSelect = false;
    window.siyuan.config.editor.blockGutterMode = false;
    root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list"><div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action"></div>${p("paragraph")}${attr}</div>${attr}</div>`;
    gutter.render(protyle, root.querySelector('[data-node-id="paragraph"]'));
    check.deepEqual(state().ids.sort(), ["item", "list"], "narrow compact mode retains both list and item indicators");
    check.equal(gutter.element.style.maxHeight, "");
    check.equal(gutter.element.style.overflowY, "");
    check.equal(gutter.element.dataset.scrollable, undefined);
    return "List container gutters passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        const css = ["protyle/_wysiwyg.scss", "protyle/_protyle.scss", "util/_function.scss"].map(file =>
            require("sass").compile(path.join(__dirname, "../src/assets/scss", file), {quietDeps: true}).css).join("\n");
        const result = await win.webContents.executeJavaScript(`(async () => {
            try { return {message: await (${cases.toString()})(${JSON.stringify(sources())}, ${JSON.stringify(sources(true))}, ${JSON.stringify(css)})}; }
            catch (error) { return {error: error.stack}; }
        })()`);
        assert.ok(!result.error, result.error);
        console.log(result.message);
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("compact and full block indicators keep exact targets and remain reachable", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-list-gutter-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /List container gutters passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-list-gutter-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
