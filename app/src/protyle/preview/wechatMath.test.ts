import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, loaderSource: string, cdn: string) => {
    const check: typeof assert = require("node:assert/strict");
    const addScriptSync = new Function(loaderSource + "\nreturn addScriptSync;")();
    const render: typeof import("./wechatMath").renderWechatMath = new Function("Constants", "addScriptSync",
        source + "\nreturn renderWechatMath;")({PROTYLE_CDN: cdn}, addScriptSync);
    Object.assign(window, {Lute: {UnEscapeHTMLStr: (value: string) => {
        const element = document.createElement("textarea");
        element.innerHTML = value;
        return element.value;
    }}});
    const empty = document.createElement("div");
    await render(empty);
    check.equal(window.MathJax, undefined, "documents without formulas do not load MathJax");
    const cases: Array<[string, string]> = [
        ["SPAN", "E=mc^2"],
        ["SPAN", "\\frac{a_1+b^2}{\\sqrt{x}}"],
        ["DIV", "\\frac{\\sum_{i=1}^{n} i^2}{\\sqrt{1+x^2}}"],
        ["DIV", "\\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}"],
        ["DIV", "\\begin{pmatrix}a&amp;b\\\\c&amp;d\\end{pmatrix}"],
        ["DIV", "\\begin{aligned}a&amp;=b+c\\\\x&amp;=\\frac{y}{z}\\end{aligned}"],
        ["DIV", "\\ce{2H2 + O2 -> 2H2O}"],
        ["SPAN", "\\ce{A <=> B}"],
        ["DIV", "\\cancel{x}+\\bbox[red]{y}+\\boldsymbol{z}"],
        ["DIV", "\\begin{cases}x &amp; x&gt;0\\\\-x &amp; x&lt;0\\end{cases}"],
        ["DIV", "\\require{bbm}\\mathbbm{1}"],
        ["DIV", "\\require{bboldx}\\mathbb{R}"],
        ["DIV", "\\require{dsfont}\\mathds{R}"],
        ["DIV", "x+y=z\\tag{1}"],
    ];
    const root = document.createElement("div");
    for (const [tag, math] of cases) {
        const element = document.createElement(tag);
        element.setAttribute("data-subtype", "math");
        element.setAttribute("data-content", math);
        element.innerHTML = '<span class="katex">preview</span>';
        root.appendChild(element);
    }
    document.body.appendChild(root);
    const concurrent = root.cloneNode(true) as HTMLElement;
    document.body.appendChild(concurrent);
    await Promise.all([render(root), render(concurrent)]);
    check.equal(document.querySelectorAll("#protyleMathJaxScript").length, 1);
    for (const element of Array.from(root.children)) {
        const svg = element.querySelector("svg");
        check.ok(svg, element.getAttribute("data-content"));
        check.equal(element.querySelector('[data-mml-node="merror"]'), null, element.getAttribute("data-content"));
        check.ok(svg.querySelector("path"), "glyph paths are embedded in the formula");
        check.equal(svg.querySelector("use"), null, "formulas do not reference external font caches");
        check.equal(element.querySelector("mjx-assistive-mml"), null);
        check.equal(element.querySelector(".katex"), null);
        check.equal(element.querySelector("mjx-container").getAttribute("display"), element.tagName === "DIV" ? "true" : null);
        const xml = new DOMParser().parseFromString(svg.outerHTML, "image/svg+xml");
        check.equal(xml.querySelector("parsererror"), null);
    }
    await render(root);
    check.equal(root.querySelectorAll('[data-subtype="math"] > mjx-container > svg').length, cases.length);
    check.equal(concurrent.querySelectorAll('[data-subtype="math"] > mjx-container > svg').length, cases.length);
    check.equal(document.querySelectorAll("#protyleMathJaxScript").length, 1);
    const invalid = document.createElement("div");
    invalid.innerHTML = '<span data-subtype="math" data-content="\\frac{"></span>' +
        '<span data-subtype="math" data-content="x^2"></span>';
    document.body.appendChild(invalid);
    await render(invalid);
    check.ok(invalid.firstElementChild.querySelector('[data-mml-node="merror"]'));
    check.ok(invalid.lastElementChild.querySelector("svg path"), "invalid formulas do not prevent subsequent conversion");
    document.querySelectorAll("style").forEach(style => style.remove());
    const copied = document.createElement("div");
    copied.innerHTML = root.innerHTML;
    document.body.appendChild(copied);
    for (const width of [320, 720]) {
        copied.style.width = `${width}px`;
        for (const element of Array.from(copied.children)) {
            if (element.tagName !== "DIV") {
                check.equal((element as HTMLElement).style.textAlign, "", "inline formulas preserve paragraph alignment");
                continue;
            }
            const block = element.getBoundingClientRect();
            const svg = element.querySelector("svg").getBoundingClientRect();
            check.ok(svg.width > 0, element.getAttribute("data-content"));
            check.ok(Math.abs((svg.left + svg.right) / 2 - (block.left + block.right) / 2) <= 1,
                `display formulas remain centered without MathJax styles: ${element.getAttribute("data-content")}`);
        }
    }
    return `MathJax offline conversion passed for ${cases.length} formulas`;
};

const browserSource = (file: string) => {
    const statements = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true).statements;
    return transpileModule(statements.filter(statement => !isImportDeclaration(statement))
        .map(statement => statement.getText()).join("\n").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
};

test("bundled MathJax converts WeChat formulas without network access", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = browserSource(path.resolve(__dirname, "wechatMath.ts"));
    const loaderSource = browserSource(path.resolve(__dirname, "../util/addScript.ts"));
    const cdn = pathToFileURL(path.resolve(__dirname, "../../../stage/protyle")).href;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-wechat-math-"));
    const script = path.join(temporary, "run.cjs");
    const html = path.join(temporary, "index.html");
    writeFileSync(html, "<html><head></head><body></body></html>", "utf8");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false,
        offscreen: true, backgroundThrottling: false}});
    win.webContents.on("console-message", (event) => console.log(event.message));
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest({urls: ["http://*/*", "https://*/*"]}, (details, callback) => {
        external.push(details.url);
        callback({cancel: true});
    });
    try {
        await win.loadFile(${JSON.stringify(html)});
        console.log(await Promise.race([win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(loaderSource)}, ${JSON.stringify(cdn)})`)}),
            new Promise((_, reject) => setTimeout(() => reject(new Error("MathJax conversion timed out")), 15000))]));
        require("node:assert/strict").deepEqual(external, []);
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 40000, windowsHide: true,
        });
        assert.match(result.stdout, /MathJax offline conversion passed/, result.stderr);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-wechat-math-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
