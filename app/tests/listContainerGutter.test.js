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
    const helpers = ["protyle/gutter/container.ts", "protyle/wysiwyg/getBlock.ts", "protyle/gutter/layout.ts"].map(file => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        return source.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => ["getListItemGutterContainer", "getTopAloneElement",
                "getSbChildBlockCount", "getParentBlock", "getGutterMarginHeight", "getFixedGutterPosition",
                "getBacklinkGutterContentTop", "getListGutterAnchorLeft"].includes(declaration.name.getText(source))))
            .map(node => node.getText(source)).join("\n");
    }).join("\n").replace(/export const /g, "const ");
    return ts.transpileModule(helpers + `\nfunction render(protyle, element, target) ${body}`, {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const cases = (source, fullSource) => {
    const check = require("node:assert/strict");
    const noop = () => false;
    const dependencies = {
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"}, hideElements: noop, getCrossBlockTextRange: noop,
        getGutterSelection: () => ({isMultiSelect: false, selectElements: []}),
        getHorizontalSuperBlockChild: noop, getEmbedGutterOperationContext: noop, isInEmbedBlock: noop,
        isInAVBlock: noop, hasViewFoldContext: noop, getContainerGutterSpace: () => 0,
        hasClosestBlock: element => element.closest("[data-node-id]"),
        hasClosestByClassName: (element, name) => element?.closest("." + name),
        hasTopClosestByClassName: (element, name) => element?.closest("." + name),
        hasClosestByAttribute: (element, name, value) => element.closest(`[${name}="${value}"]`),
        getAutoListDirection: () => undefined, getGutterFixedContainerRect: noop,
        isGutterInsertStateMatched: (count, insert) => count === (insert ? 4 : 0),
        getBlockTypeName: type => type, getIconByType: () => "iconTest",
        genGutterBlockButtonHTML: data => `<button data-type="${data.type}" data-node-id="${data.nodeID}"></button>`,
    };
    const render = new Function(...Object.keys(dependencies), source + "\nreturn render;")(...Object.values(dependencies));
    const renderFull = new Function(...Object.keys(dependencies), fullSource + "\nreturn render;")(...Object.values(dependencies));
    window.siyuan = {languages: {fold: "Fold"}, config: {editor: {fontSize: 16, rtl: false}}};
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
    return "List container gutters passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        const result = await win.webContents.executeJavaScript(`(() => {
            try { return {message: (${cases.toString()})(${JSON.stringify(sources())}, ${JSON.stringify(sources(true))})}; }
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
