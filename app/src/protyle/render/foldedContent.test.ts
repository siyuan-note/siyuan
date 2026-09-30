import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const api: typeof import("./foldedContent") = new Function(sources.visibility +
        "\nreturn {isFoldedRenderContent, registerFoldedRenderRoot, unregisterFoldedRenderRoot};")();
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.contentEditable = "true";
    root.innerHTML = '<div class="callout" data-node-id="outer" data-type="NodeCallout" fold="1">' +
        '<div class="callout-info"><span class="callout-title">Title</span></div><div class="callout-content">' +
        '<div class="tabs" data-node-id="tabs" data-type="NodeTabs" data-tabs-ready="true" fold="1">' +
        '<div class="tabs-header protyle-action"><button class="tabs-tab">First</button></div>' +
        '<div class="tab-item"><div class="tab-item-content"><div data-subtype="math" data-content="x">' +
        '<div>Source formula</div></div><div data-type="NodeAttributeView"></div>' +
        '<div data-type="NodeBlockQueryEmbed"></div></div></div></div></div></div>';
    document.body.appendChild(root);
    const outer = root.firstElementChild;
    const tabs = root.querySelector<HTMLElement>(".tabs");
    const math = root.querySelector<HTMLElement>('[data-subtype="math"]');
    check.equal(api.isFoldedRenderContent(math), false, "independent rendering keeps full content");
    api.registerFoldedRenderRoot(root);
    check.equal(api.isFoldedRenderContent(math), true);
    check.equal(api.isFoldedRenderContent(outer), false, "container summaries remain renderable");
    check.equal(api.isFoldedRenderContent(outer, true), true);
    const original = outer.innerHTML;
    const requests: string[] = [];
    const never = () => new Promise<void>(() => {});
    const dependencies = {...api, Constants: {PROTYLE_CDN: "cdn"},
        addStyle: () => {}, addScript: (url: string) => { requests.push(url); return never(); },
        loadECharts: () => { requests.push("echarts"); return never(); },
    };
    const mathRender = new Function(...Object.keys(dependencies), sources.math + "\nreturn mathRender;")(
        ...Object.values(dependencies));
    const summaries = document.createElement("div");
    summaries.innerHTML = '<div class="li" data-node-id="item" data-type="NodeListItem" fold="1">' +
        '<div class="protyle-action"></div><div class="p" data-node-id="summary" data-type="NodeParagraph">' +
        '<div contenteditable="true"><span data-subtype="math" data-content="x"></span></div></div>' +
        '<div class="p" data-node-id="hidden" data-type="NodeParagraph">' +
        '<div contenteditable="true"><span data-subtype="math" data-content="y"></span></div></div></div>';
    root.appendChild(summaries);
    const summary = summaries.querySelector<HTMLElement>('[data-node-id="summary"]');
    const hidden = summaries.querySelector<HTMLElement>('[data-node-id="hidden"]');
    check.notEqual(getComputedStyle(summary).display, "none");
    check.equal(getComputedStyle(hidden).display, "none");
    check.equal(api.isFoldedRenderContent(summary.firstElementChild.firstElementChild), false);
    check.equal(api.isFoldedRenderContent(hidden.firstElementChild.firstElementChild), true);
    mathRender(summaries);
    check.equal(requests.length, 1, "visible folded summaries still initialize KaTeX");
    outer.querySelector(".callout-title").appendChild(summaries);
    check.equal(api.isFoldedRenderContent(summary.firstElementChild.firstElementChild), false,
        "folded callout titles remain renderable");
    outer.querySelector(".callout-content").appendChild(summaries);
    check.equal(api.isFoldedRenderContent(summary.firstElementChild.firstElementChild), true,
        "an outer hidden region still defers the inner visible summary");
    summaries.remove();
    requests.length = 0;
    mathRender(root);
    check.equal(requests.length, 0, "folded math must not initialize KaTeX");
    for (const language of ["abc", "echarts", "graphviz", "flowchart", "plantuml", "mermaid"]) {
        const diagram = document.createElement("div");
        diagram.dataset.subtype = language;
        tabs.querySelector(".tab-item-content").appendChild(diagram);
        const name = language === "echarts" ? "chart" : language;
        const render = new Function(...Object.keys(dependencies), sources[name] + `\nreturn ${name}Render;`)(
            ...Object.values(dependencies));
        render(root);
        check.equal(requests.length, 0, `${language} must defer library loading`);
        check.equal(diagram.hasAttribute("data-render"), false);
        diagram.remove();
    }
    for (const name of ["av", "block"]) {
        const render = new Function(...Object.keys(dependencies), sources[name] + `\nreturn ${name}Render;`)(
            ...Object.values(dependencies));
        if (name === "av") {
            await render(root, {});
        } else {
            render({}, root);
        }
        check.equal(root.querySelector('[data-type="NodeAttributeView"]').hasAttribute("data-render"), false);
        check.equal(root.querySelector('[data-type="NodeBlockQueryEmbed"]').hasAttribute("data-render"), false);
    }
    const renders: string[] = [];
    const observerDependencies = {...api,
        processRender: (element: Element) => { renders.push(element.getAttribute("data-node-id")); mathRender(element); },
        highlightRender: () => {}, avRender: () => Promise.resolve(), blockRender: () => {},
    };
    const lifecycle: typeof import("../util/foldedRender") = new Function(...Object.keys(observerDependencies),
        sources.observer + "\nreturn {initFoldedRender, destroyFoldedRender};")(...Object.values(observerDependencies));
    const owner = {wysiwyg: {element: root}, contentElement: root} as unknown as IProtyle;
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    lifecycle.initFoldedRender(owner);
    tabs.removeAttribute("fold");
    await frame();
    check.equal(requests.length, 0, "an inner expansion remains deferred while its parent is folded");
    check.equal(renders.length, 0);
    outer.removeAttribute("fold");
    await frame();
    check.deepEqual(renders, ["outer"]);
    check.equal(requests.length, 1, "expansion resumes formula initialization");
    check.ok(outer.contains(math), "expansion preserves the source node");
    outer.setAttribute("fold", "1");
    tabs.setAttribute("fold", "1");
    await frame();
    tabs.removeAttribute("fold");
    outer.removeAttribute("fold");
    await frame();
    check.deepEqual(renders, ["outer", "outer"], "nested expansions share one render pass");
    lifecycle.destroyFoldedRender(owner);
    const count = renders.length;
    outer.setAttribute("fold", "1");
    outer.removeAttribute("fold");
    await frame();
    check.equal(renders.length, count, "destroyed editors release expansion observers");
    check.equal(api.isFoldedRenderContent(math), false);
    outer.setAttribute("fold", "1");
    tabs.setAttribute("fold", "1");
    check.equal(outer.innerHTML, original, "folding never removes or serializes source content");

    for (const width of [220, 700]) {
        for (const fontSize of [16, 32]) {
            for (const color of ["light", "dark"]) {
                root.style.width = `${width}px`;
                root.style.fontSize = `${fontSize}px`;
                document.body.dataset.themeMode = color;
                outer.removeAttribute("fold");
                tabs.querySelector<HTMLElement>(".tab-item-content").style.height = "400px";
                for (const orientation of ["horizontal", "vertical"]) {
                    tabs.dataset.tabsOrientation = orientation;
                    tabs.removeAttribute("fold");
                    const expanded = tabs.getBoundingClientRect().height;
                    tabs.setAttribute("fold", "1");
                    check.ok(tabs.getBoundingClientRect().height < expanded / 2);
                    check.equal(getComputedStyle(tabs.querySelector(".tab-item")).display, "none");
                    check.equal(getComputedStyle(tabs.querySelector(".tabs-header")).display, "flex");
                }
                outer.setAttribute("fold", "1");
                check.equal(getComputedStyle(outer.querySelector(".callout-content")).display, "none");
                check.ok(outer.getBoundingClientRect().height < fontSize * 5);
                const mindmap = document.createElement("div");
                mindmap.dataset.type = "NodeMindmap";
                mindmap.dataset.nodeId = "map";
                mindmap.dataset.mindmapViewRendered = "true";
                mindmap.style.height = "500px";
                mindmap.innerHTML = '<div class="mindmap-item" data-node-id="item" data-type="NodeMindmapItem">Root title</div>' +
                    '<div class="mindmap-view" style="--mindmap-view-height:500px"></div>';
                root.appendChild(mindmap);
                const expanded = mindmap.getBoundingClientRect().height;
                mindmap.setAttribute("fold", "1");
                check.ok(mindmap.getBoundingClientRect().height < expanded / 2);
                check.equal(getComputedStyle(mindmap.querySelector(".mindmap-view")).display, "none");
                check.equal(getComputedStyle(mindmap.firstElementChild).display, "block");
                mindmap.removeAttribute("fold");
                check.equal(mindmap.style.height, "500px", "folding preserves the configured height");
                check.equal(mindmap.getBoundingClientRect().height, expanded);
                mindmap.remove();
            }
        }
    }
    const sb = document.createElement("div");
    sb.className = "sb";
    sb.dataset.sbLayout = "col";
    sb.dataset.nodeId = "sb";
    sb.innerHTML = '<div data-node-id="left">Left</div><div class="sb__resize"></div><div data-node-id="right">Right</div>';
    root.appendChild(sb);
    root.dataset.readonly = "true";
    check.equal(getComputedStyle(sb.querySelector(".sb__resize")).display, "none");
    root.dataset.readonly = "false";
    check.notEqual(getComputedStyle(sb.querySelector(".sb__resize")).display, "none");
    root.remove();
    return "Folded rendering cases passed";
};

test("folded containers defer components and resume without changing source content", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const files = {visibility: "foldedContent.ts", observer: "../util/foldedRender.ts", math: "mathRender.ts",
        abc: "abcRender.ts", chart: "chartRender.ts", graphviz: "graphvizRender.ts", flowchart: "flowchartRender.ts",
        plantuml: "plantumlRender.ts", mermaid: "mermaidRender.ts", av: "av/render.ts", block: "blockRender.ts"};
    const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => {
        const text = readFileSync(path.resolve(__dirname, file), "utf8");
        const source = createSourceFile(file, text, ScriptTarget.Latest, true).statements
            .filter(statement => !isImportDeclaration(statement)).map(statement => statement.getText()).join("\n");
        return [key, transpileModule(source.replace(/^export /gm, ""), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText];
    }));
    const css = require("sass").compile(path.resolve(__dirname, "../../assets/scss/base.scss"), {
        logger: require("sass").Logger.silent,
    }).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-folded-render-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)})`)}));
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 25000, windowsHide: true,
        });
        assert.match(result.stdout, /Folded rendering cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-folded-render-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
