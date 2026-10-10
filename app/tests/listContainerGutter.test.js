const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    const source = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname,
        "../src/protyle/gutter/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const gutter = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "Gutter");
    const render = gutter.members.find(node => node.name?.getText(source) === "render");
    const body = render.body.getText(source).split("const shouldRenderInsert")[0] + "return html; }";
    const helpers = ["protyle/gutter/container.ts", "protyle/wysiwyg/getBlock.ts"].map(file => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        return source.statements.filter(node => ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(declaration => ["getListItemGutterContainer", "getTopAloneElement",
                "getSbChildBlockCount", "getParentBlock"].includes(declaration.name.getText(source))))
            .map(node => node.getText(source)).join("\n");
    }).join("\n").replace(/export const /g, "const ");
    return ts.transpileModule(helpers + `\nfunction render(protyle, element, target) ${body}`, {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const cases = source => {
    const check = require("node:assert/strict");
    const noop = () => false;
    const dependencies = {
        Constants: {}, hideElements: noop, getCrossBlockTextRange: noop,
        getGutterSelection: () => ({isMultiSelect: false, selectElements: []}),
        getHorizontalSuperBlockChild: noop, getEmbedGutterOperationContext: noop, isInEmbedBlock: noop,
        isInAVBlock: noop, hasViewFoldContext: noop, getContainerGutterSpace: () => 0,
        hasClosestBlock: element => element.closest("[data-node-id]"),
        hasClosestByClassName: (element, name) => element?.closest("." + name),
        hasTopClosestByClassName: (element, name) => element?.closest("." + name),
        getBlockTypeName: type => type, getIconByType: () => "iconTest",
        genGutterBlockButtonHTML: data => `<button data-type="${data.type}"></button>`,
    };
    const render = new Function(...Object.keys(dependencies), source + "\nreturn render;")(...Object.values(dependencies));
    window.siyuan = {languages: {fold: "Fold"}};
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const gutter = {element: document.createElement("div"), gutterTip: "${x}"};
    const protyle = {element: root, wysiwyg: {element: root}, options: {}};
    const attr = '<div class="protyle-attr"></div>';
    for (const extra of ["", '<div data-node-id="second" data-type="NodeParagraph">Second</div>']) {
        for (const [type, cls] of [["NodeTable", "table"], ["NodeBlockquote", "bq"], ["NodeCallout", "callout"],
            ["NodeSuperBlock", "sb"], ["NodeTabs", "tabs"]]) {
            const child = '<div data-node-id="child" data-type="NodeParagraph">Child</div>';
            const content = type === "NodeCallout" ? `<div class="callout-info"><div class="callout-title">Title</div></div><div class="callout-content">${child}</div>` : child;
            root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list">
<div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action"></div>
<div data-node-id="container" data-type="${type}" class="${cls}">${content}${attr}</div>${extra}${attr}</div>${attr}</div>`;
            for (const id of ["container", "child", "item"]) {
                const element = root.querySelector(`[data-node-id="${id}"]`);
                const html = render.call(gutter, protyle, element, element);
                check.ok(html?.includes(`data-type="${type}"`), `${type}/${id}/${!!extra}: ${html}`);
                check.ok(html?.includes('data-type="NodeListItem"'), `${type}/${id}/${!!extra}: ${html}`);
            }
        }
    }
    root.innerHTML = `<div data-node-id="list" data-type="NodeList" class="list"><div data-node-id="item" data-type="NodeListItem" class="li"><div class="protyle-action"></div><div data-node-id="p" data-type="NodeParagraph">Text</div>${attr}</div>${attr}</div>`;
    check.ok(!render.call(gutter, protyle, root.querySelector('[data-node-id="p"]')).includes('data-type="NodeParagraph"'));
    return "List container gutters passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`));
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
