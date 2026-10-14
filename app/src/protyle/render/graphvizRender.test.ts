import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, styles: string[], library: string) => {
    const check: typeof assert = require("node:assert/strict");
    const Viz = new Function("module", "exports", library + "\nreturn globalThis.Viz;")(undefined, undefined);
    const viz = await Viz.instance();
    for (const engine of ["dot", "neato", "fdp", "circo", "twopi"]) {
        const result = viz.render("digraph { a -> b }", {engine, format: "svg"});
        check.equal(result.status, "success", engine);
        check.match(result.output, /<svg/);
    }
    const dependencies = {
        Viz: {instance: () => Promise.resolve(viz)},
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"},
        addScript: () => Promise.resolve(), isFoldedRenderContent: () => false,
        hasClosestByClassName: () => false,
        genIconHTML: () => '<div class="protyle-icons"></div>',
        getHostCapabilities: () => ({remoteKernel: false}),
        Lute: {UnEscapeHTMLStr: (value: string) => value},
        escapeHtml: (value: string) => {
            const element = document.createElement("div");
            element.textContent = value;
            return element.innerHTML;
        },
    };
    const render: typeof import("./graphvizRender").graphvizRender = new Function(...Object.keys(dependencies),
        source + "\nreturn graphvizRender;")(...Object.values(dependencies));
    const style = document.createElement("style");
    document.head.appendChild(style);
    const fixture = 'digraph { subgraph cluster_group { label="分组"; ' +
        'a [label="开始"]; b [label=<<TABLE BORDER="0"><TR><TD>HTML label</TD></TR></TABLE>>]; } ' +
        'c [shape=record,label="left|right"]; a -> b [label="next"]; b -> c; }';
    for (const css of styles) {
        style.textContent = css;
        for (const className of ["protyle-wysiwyg", "b3-typography"]) {
            for (const width of [240, 720]) {
                const root = document.createElement("div");
                root.className = className;
                root.style.width = `${width}px`;
                root.innerHTML = '<div data-subtype="graphviz"><div></div></div>';
                document.body.appendChild(root);
                const block = root.firstElementChild;
                block.setAttribute("data-content", fixture);
                render(block);
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(block.querySelector(".ft__error"), null);
                const svg = block.querySelector<SVGSVGElement>("svg");
                check.ok(svg);
                check.equal(svg.querySelectorAll(".node").length, 3);
                check.equal(svg.querySelectorAll(".edge").length, 2);
                check.match(svg.textContent, /开始/);
                check.match(svg.textContent, /HTML label/);
                check.ok(svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0);
                check.ok(svg.getBoundingClientRect().width > 0);
                const exported = new DOMParser().parseFromString(svg.outerHTML, "image/svg+xml");
                check.equal(exported.querySelector("parsererror"), null);
                const previous = svg.outerHTML;
                render(block);
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(block.querySelector("svg").outerHTML, previous, "rendered blocks remain unchanged");
                block.setAttribute("data-render", "false");
                block.setAttribute("data-content", "digraph { a -> }");
                render(block);
                await new Promise(resolve => setTimeout(resolve, 0));
                check.match(block.querySelector(".ft__error").textContent, /graphviz render error/);
                root.remove();
            }
        }
    }
    return "Graphviz rendering passed";
};

test("bundled Graphviz renders through desktop, mobile and export paths", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const file = path.resolve(__dirname, "graphvizRender.ts");
    const statements = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true).statements;
    const source = transpileModule(statements.filter(statement => !isImportDeclaration(statement))
        .map(statement => statement.getText()).join("\n").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const library = readFileSync(path.resolve(__dirname, "../../../stage/protyle/js/graphviz/viz.js"), "utf8");
    const sass = require("sass");
    const styles = ["base", "mobile"].map(name => sass.compile(
        path.resolve(__dirname, `../../assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-graphviz-render-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL('data:text/html,<html><head><base href="https://test.invalid/"></head><body></body></html>');
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(styles)}, ${JSON.stringify(library)})`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 25000, windowsHide: true,
        });
        assert.match(result.stdout, /Graphviz rendering passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-graphviz-render-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
