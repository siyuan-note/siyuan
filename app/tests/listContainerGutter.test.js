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
    const body = full ? render.body.getText(source) :
        render.body.getText(source).split("const shouldRenderInsert")[0] + "return html; }";
    const helpers = ["protyle/gutter/container.ts", "protyle/wysiwyg/getBlock.ts", "protyle/gutter/layout.ts",
        "protyle/util/hasClosest.ts", "protyle/render/autoDirection.ts"].map(file => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        return source.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => ["getListItemGutterContainer", "getTopAloneElement",
                "getSbChildBlockCount", "getParentBlock", "getGutterMarginHeight", "getFixedGutterPosition",
                "getBacklinkGutterContentTop", "getListGutterAnchorLeft", "getContainerGutterSpace", "isContainerGutterBridge",
                "hasClosestBlock", "isBlockElement", "hasClosestByClassName", "hasTopClosestByClassName", "hasClosestByTag",
                "hasClosestByAttribute", "getAutoListDirection", "listSelector", "directionAttribute"].includes(declaration.name.getText(source))))
            .map(node => node.getText(source)).join("\n");
    }).join("\n").replace(/export const /g, "const ");
    const hoverSource = ts.createSourceFile("initUI.ts", readFileSync(path.join(__dirname,
        "../src/protyle/ui/initUI.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let hoverBinding;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(hoverSource) === "protyle.element.addEventListener" &&
            node.arguments[0].getText(hoverSource).includes('"pointerover"')) {
            hoverBinding = node.getText(hoverSource);
        }
        ts.forEachChild(node, visit);
    };
    visit(hoverSource);
    assert.ok(hoverBinding);
    const events = readFileSync(path.join(__dirname, "../src/boot/globalEvent/mousemove.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") +
        `\nfunction bindHover(protyle) { let overAttr = false; ${hoverBinding}; }`;
    return ts.transpileModule(helpers + `\nfunction render(protyle, element, target) ${body}\n` + (full ? events : ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const cases = (source, fullSource, css) => {
    const check = require("node:assert/strict");
    const noop = () => false;
    const dependencies = {
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"}, hideElements: noop, getCrossBlockTextRange: noop,
        getGutterSelection: () => ({isMultiSelect: false, selectElements: []}),
        getHorizontalSuperBlockChild: noop, getEmbedGutterOperationContext: noop, isInEmbedBlock: noop,
        isInAVBlock: noop, hasViewFoldContext: noop, getGutterFixedContainerRect: noop,
        isMobile: () => mobile, isWindow: noop, isTabGutterBridge: noop, isMac: noop,
        getAllModels: () => ({editor: [{editor: {protyle}}], backlink: []}), getAllEditor: () => [{protyle}],
        isGutterInsertStateMatched: (count, insert) => count === (insert ? 4 : 0),
        getBlockTypeName: type => type, getIconByType: () => "iconTest",
        genGutterBlockButtonHTML: data => `<button data-type="${data.type}" data-node-id="${data.nodeID}"><svg><use href="#iconTest"></use></svg></button>`,
    };
    const render = new Function(...Object.keys(dependencies), source + "\nreturn render;")(...Object.values(dependencies));
    const {render: renderFull, windowMouseMove, bindHover} = new Function(...Object.keys(dependencies),
        fullSource + "\nreturn {render, windowMouseMove, bindHover};")(...Object.values(dependencies));
    let mobile = false;
    window.siyuan = {languages: {fold: "Fold", rowTip: "Row", addBelowAbove: "Add"}, layout: {}, blockPanels: [],
        config: {editor: {fontSize: 16, rtl: false}}};
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
        const result = await win.webContents.executeJavaScript(`(() => {
            try { return {message: (${cases.toString()})(${JSON.stringify(sources())}, ${JSON.stringify(sources(true))}, ${JSON.stringify(css)})}; }
            catch (error) { return {error: error.stack}; }
        })()`);
        assert.ok(!result.error, result.error);
        console.log(result.message);
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("first list containers retain both container and list item gutters", {
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
