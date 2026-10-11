import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isImportDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, styles: string[], katexPath: string) => {
    const check: typeof assert = require("node:assert/strict");
    window.katex = require(katexPath);
    window.siyuan = {config: {editor: {katexMacros: "{}"}}} as typeof window.siyuan;
    const dependencies = {
        Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"},
        addStyle: () => {}, addScript: () => Promise.resolve(),
        isFoldedRenderContent: () => false, looseJsonParse: JSON.parse,
        getHostCapabilities: () => ({remoteKernel: false}),
        getMathRenderSecurity: () => ({trust: false, sanitize: false}),
        Lute: {UnEscapeHTMLStr: (value: string) => value},
        hasClosestBlock: () => false,
        genRenderFrame: (element: HTMLElement) => { element.innerHTML = "<div><div></div></div>"; },
    };
    const render: typeof import("./mathRender").mathRender = new Function(...Object.keys(dependencies),
        source + "\nreturn mathRender;")(...Object.values(dependencies));
    const style = document.createElement("style");
    document.head.appendChild(style);
    for (const css of styles) {
        style.textContent = css;
        for (const className of ["protyle-wysiwyg", "b3-typography"]) {
            for (const width of [280, 720]) {
                for (const fontSize of [16, 32]) {
                    const root = document.createElement("div");
                    root.className = className;
                    root.style.cssText = `width:${width}px;font-size:${fontSize}px;`;
                    document.body.appendChild(root);
                    for (const tex of ["x+y", "x+y\\tag{1}", "a\\\\b"]) {
                        root.innerHTML = '<div data-subtype="math"></div>';
                        const formula = root.firstElementChild as HTMLElement;
                        formula.setAttribute("data-content", tex);
                        await render(formula);
                        check.equal(formula.querySelector(".ft__error"), null);
                        const html = formula.querySelector<HTMLElement>(".katex-html");
                        const bases = html.querySelectorAll<HTMLElement>(":scope > .katex-base");
                        check.ok(bases.length > 0);
                        if (tex.includes("\\\\")) {
                            check.equal(getComputedStyle(html).display, "block");
                            check.ok(bases[1].getBoundingClientRect().top > bases[0].getBoundingClientRect().top);
                        } else {
                            const first = bases[0].getBoundingClientRect();
                            const last = bases[bases.length - 1].getBoundingClientRect();
                            const tag = html.querySelector<HTMLElement>(".katex-tag");
                            const rect = html.getBoundingClientRect();
                            const tagWidth = tag ? tag.getBoundingClientRect().width + 10 : 0;
                            check.ok(Math.abs((first.left + last.right) / 2 -
                                (rect.left + (rect.width - tagWidth) / 2)) < 2, "formula remains centered");
                            if (tag) {
                                check.equal(getComputedStyle(tag).position, "static");
                                check.ok(tag.getBoundingClientRect().left >= last.right, "tag does not overlap formula");
                            }
                        }
                    }
                    root.remove();
                }
            }
        }
    }
    return "Math layout passed";
};

test("KaTeX block alignment, tags and newlines work on desktop, mobile and exports", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const file = path.resolve(__dirname, "mathRender.ts");
    const statements = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true).statements;
    const source = transpileModule(statements.filter(statement => !isImportDeclaration(statement))
        .map(statement => statement.getText()).join("\n").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const katexPath = path.resolve(__dirname, "../../../stage/protyle/js/katex/katex.min.js");
    const katexCSS = readFileSync(path.join(path.dirname(katexPath), "katex.min.css"), "utf8")
        .replace(/url\(fonts\//g, `url(file://${path.dirname(katexPath)}/fonts/`);
    const sass = require("sass");
    const styles = ["base", "mobile"].map(name => sass.compile(
        path.resolve(__dirname, `../../assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css + katexCSS);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-math-layout-"));
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
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(styles)}, ${JSON.stringify(katexPath)})`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 25000, windowsHide: true,
        });
        assert.match(result.stdout, /Math layout passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-math-layout-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
