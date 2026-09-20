import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const compile = (text: string) => transpileModule(text.replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const extract = (file: string, names: string[]) => {
    const source = createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"), ScriptTarget.Latest, true);
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
    assert.equal(declarations.length, names.length);
    return compile(declarations.map(declaration => declaration.getText(source)).join("\n"));
};

const cases = async (source: string) => {
    const check = require("node:assert/strict");
    const requests: {url: string, data: Record<string, string>}[] = [];
    const messages: string[] = [];
    const chartRefreshes: Element[] = [];
    const dependencies = {
        fetchPost: (url: string, data: Record<string, string>) => requests.push({url, data}),
        fetchSyncPost: () => check.fail("Preview requested database data"),
        genRenderFrame: () => {},
        isEncryptedBox: () => false,
        hasClosestByClassName: (element: HTMLElement, name: string) => element.closest(`.${name}`),
        showMessage: (message: string) => messages.push(message),
        cleanListMindmapHTML: (html: string) => html,
        chartRender: (element: Element) => chartRefreshes.push(element),
        mountProtyleLiteFragment: () => check.fail("Unsupported content was passed to the editor sanitizer"),
    };
    const api = new Function(...Object.keys(dependencies), source + "; return {customBlockRender, " +
        "registerCustomBlockRoot, setCustomBlockRootReady, unregisterCustomBlockRoot, activateCustomBlockPlugin, " +
        "deactivateCustomBlockPlugin, htmlRender, blockRender, avRender, getAVElements, getCell, getTableNode, " +
        "TablePreviewControl, refreshChartTheme, getAVRichTextUnsupportedPasteBlocks, openListMindmapEditor};")(...Object.values(dependencies));
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    document.body.append(root);
    const protyle = {wysiwyg: {element: root}, block: {rootID: "document"}};
    const block = (type: string, html = "") => {
        const element = document.createElement("div");
        element.dataset.type = type;
        element.dataset.nodeId = type;
        element.innerHTML = html;
        root.append(element);
        return element;
    };
    const preview = (element: HTMLElement) => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.classList.add("list-mindmap__preview-block");
        clone.removeAttribute("data-node-id");
        root.append(clone);
        return clone;
    };
    let sourceSetter: (content: string) => boolean;
    let renders = 0;
    const updates: string[] = [];
    window.siyuan = {
        languages: new Proxy({}, {get: (_target, key) => String(key)}),
        config: {editor: {embedBlockBreadcrumb: false, headingEmbedMode: 0}},
        ws: {app: {plugins: [{name: "preview-test", customBlockRenders: {test: {
            render: (options: {element: HTMLElement, setContent: (content: string) => boolean}) => {
                renders++;
                sourceSetter = options.setContent;
                options.element.innerHTML = "<button>Plugin control</button>";
            },
        }}}]}},
    } as unknown as typeof window.siyuan;
    const custom = block("NodeCustomBlock");
    custom.dataset.info = "preview-test/test";
    custom.dataset.content = "Preserve plugin content";
    api.registerCustomBlockRoot(root, {disabled: () => false, update: (element: HTMLElement) => {
        updates.push(element.dataset.nodeId);
    }});
    api.setCustomBlockRootReady(root, true);
    api.activateCustomBlockPlugin("preview-test");
    check.equal(renders, 1);
    const customPreview = preview(custom);
    await new Promise(resolve => setTimeout(resolve, 0));
    api.customBlockRender(root);
    check.equal(renders, 1, "plugin lifecycle observers cannot mount a writable preview");
    check.equal(customPreview.textContent, "Preserve plugin content");
    check.equal(customPreview.querySelector("button"), null);
    check.equal(sourceSetter("Source can still change"), true);
    await Promise.resolve();
    check.deepEqual(updates, ["NodeCustomBlock"]);
    check.equal(custom.dataset.content, "Source can still change");
    // 已排队的插件回调也重新确认容器归属。
    check.equal(sourceSetter("Queued change"), true);
    custom.classList.add("list-mindmap__preview-block");
    await Promise.resolve();
    check.equal(sourceSetter("Detached identity"), false);
    check.equal(updates.length, 1);
    check.equal(custom.dataset.content, "Source can still change");
    api.deactivateCustomBlockPlugin("preview-test");
    api.unregisterCustomBlockRoot(root);

    const html = block("NodeHTMLBlock", '<div class="protyle-icons"><span></span><span></span></div><div>HTML</div>');
    const htmlPreview = preview(html);
    htmlPreview.querySelector(".protyle-icons").remove();
    api.htmlRender(root);
    check.equal(html.firstElementChild.firstElementChild.getAttribute("aria-label"), "edit");
    check.equal(htmlPreview.textContent, "HTML");
    api.htmlRender(htmlPreview);

    const embed = block("NodeBlockQueryEmbed");
    embed.dataset.content = "select * from blocks limit 1";
    const embedPreview = preview(embed);
    api.blockRender(protyle, root);
    api.blockRender(protyle, embedPreview);
    check.equal(requests.length, 1);
    check.equal(requests[0].data.embedBlockID, "NodeBlockQueryEmbed");
    const database = block("NodeAttributeView", "<div>Database</div>");
    database.className = "av";
    database.dataset.avId = "database";
    const databasePreview = preview(database);
    database.dataset.render = "true";
    await api.avRender(root, protyle);
    await api.avRender(databasePreview, protyle);
    check.deepEqual(api.getAVElements(protyle, "database"), [database], "database refresh excludes preview copies");

    const chart = block("NodeCodeBlock", '<div _echarts_instance_="source-instance"><canvas></canvas></div>');
    chart.dataset.subtype = "echarts";
    preview(chart);
    const disposedCharts: Element[] = [];
    window.echarts = {dispose: (element: Element) => disposedCharts.push(element)} as unknown as typeof window.echarts;
    api.refreshChartTheme(root);
    check.deepEqual(disposedCharts, [chart.firstElementChild], "theme changes never dispose the source through a preview copy");
    check.deepEqual(chartRefreshes, [chart]);

    const table = block("NodeTable", "<table><tbody><tr><td>Cell</td></tr></tbody></table>" +
        '<div class="protyle-action__table"></div>');
    table.setAttribute("custom-pinthead", "true");
    const tablePreview = preview(table);
    const cell = table.querySelector("td");
    check.equal(api.getCell(cell.firstChild), cell);
    check.equal(api.getTableNode(cell), table);
    check.equal(api.getCell(tablePreview.querySelector("td")), undefined);
    check.equal(api.getTableNode(tablePreview.querySelector("td")), undefined);
    const controls = Object.assign(new api.TablePreviewControl(), {
        wysiwygElement: tablePreview, pinnedTableActions: new Map(),
        pinnedTableResizeObserver: {observe: () => check.fail("Preview registered a pinned table control")},
        getTableGridRect: () => check.fail("Preview registered table resize handles"),
    });
    check.equal(controls.getEdgeHover(0, 0), undefined);
    controls.renderPinnedTableFrames();
    check.equal(controls.pinnedTableActions.size, 0);

    // 复杂块在编辑入口处保留原文，不进入会丢弃不支持内容的富文本净化流程。
    const types = ["NodeTable", "NodeAttributeView", "NodeBlockQueryEmbed", "NodeCustomBlock", "NodeHTMLBlock",
        "NodeIFrame", "NodeWidget", "NodeVideo", "NodeAudio", "NodeCallout", "NodeSuperBlock", "NodeTabs"];
    for (const type of types) {
        const item = block("NodeListItem");
        item.innerHTML = `<div data-node-id="special" data-type="${type}" data-content="raw source">Keep content</div>`;
        const host = document.createElement("div");
        const original = item.outerHTML;
        check.ok(api.getAVRichTextUnsupportedPasteBlocks(item.innerHTML, true).length, type);
        check.equal(api.openListMindmapEditor({node: {element: item}, host, canEdit: () => true}), undefined);
        check.equal(item.outerHTML, original, type);
        check.equal(host.childElementCount, 0);
    }
    check.equal(messages.length, types.length);
    check.deepEqual(api.getAVRichTextUnsupportedPasteBlocks('<div data-type="NodeParagraph"><img src="asset.png"></div>', true), []);
    for (const type of ["NodeParagraph", "NodeBlockquote", "NodeMathBlock"]) {
        check.deepEqual(api.getAVRichTextUnsupportedPasteBlocks(`<div data-type="${type}">Content</div>`, true), []);
    }
    for (const language of ["go", "mermaid", "echarts", "abc", "plantuml", "graphviz", "flowchart"]) {
        const unsupported = api.getAVRichTextUnsupportedPasteBlocks(
            `<div data-type="NodeCodeBlock" data-subtype="${language}">Code</div>`, true);
        check.equal(unsupported.length, language === "go" ? 0 : 1, language);
    }
    root.remove();
    return "Special block previews passed";
};

test("special block previews cannot acquire document writes or lose unsupported source content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 20000,
}, async () => {
    const tableSource = createSourceFile("tableControl.ts", readFileSync(path.join(__dirname,
        "../../util/tableControl.ts"), "utf8"), ScriptTarget.Latest, true);
    const tableClass = tableSource.statements.find(isClassDeclaration);
    const methods = tableClass.members.filter(member => ["getEdgeHover", "renderPinnedTableFrames"]
        .includes(member.name?.getText(tableSource)));
    assert.equal(methods.length, 2);
    const source = compile(readFileSync(path.join(__dirname, "../../../plugin/customBlockRender.ts"), "utf8")) +
        extract("../htmlRender.ts", ["htmlRender"]) + extract("../blockRender.ts", ["blockRender"]) +
        extract("../chartRender.ts", ["refreshChartTheme"]) +
        extract("../av/render.ts", ["avRender", "getAVElements"]) +
        extract("../../util/tableControl.ts", ["getCell", "getTableNode"]) +
        compile(`class TablePreviewControl {${methods.map(method => method.getText(tableSource)).join("\n")}}`) +
        extract("../av/richText.ts", ["ALLOWED_BLOCK_TYPES", "isSupportedAVRichTextBlock", "getAVRichTextUnsupportedPasteBlocks"]) +
        extract("../av/richTextValue.ts", ["EXECUTABLE_CODE_LANGUAGES", "isAVRichTextExecutableCodeLanguage"]) +
        extract("editor.ts", ["nodeContent", "openListMindmapEditor"]);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-preview-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript("window.Lute = {UnEscapeHTMLStr: value => value}; void 0;");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${cases.toString()})(${JSON.stringify(source)})`)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 15000, windowsHide: true});
        assert.match(result.stdout, /Special block previews passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
