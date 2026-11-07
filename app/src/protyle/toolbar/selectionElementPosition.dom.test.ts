import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: Record<string, string>, css: string, themes: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    const load = (source: string, modules: Record<string, unknown> = {}) => {
        const exports: any = {};
        new Function("exports", "require", source)(exports, (name: string) => modules[name] || {});
        return exports;
    };
    const topBar = {getTopBarHeight: () => document.getElementById("toolbar")!.clientHeight};
    const position = load(sources.position, {"../layout/getTopBarHeight": topBar});
    const {Toolbar} = load(sources.toolbar, {
        "../../util/setPosition": position,
        "../../layout/getTopBarHeight": topBar,
        "./selectionElementPosition": load(sources.selection),
        "./subElementLifecycle": load(sources.lifecycle),
    });
    const style = document.createElement("style");
    style.textContent = css + `
body {margin:0;font-family:Arial,sans-serif}
#toolbar {position:fixed;top:0;height:42px;width:100%}
.fixture-owner {position:fixed;top:42px;left:80px;bottom:8px;width:calc(100% - 160px)}
.fixture-content {position:absolute;top:120px;left:24px;line-height:1.625}
.fixture-text {outline:none}
`;
    document.head.append(style);
    const theme = document.createElement("style");
    document.head.append(theme);
    let cases = 0;
    for (const appearance of themes) {
        theme.textContent = appearance;
        for (const kind of ["document-title", "notebook-title", "body"]) {
            for (const multipleClick of [false, true]) {
                for (const fontSize of [16, 32, 48]) {
                    document.body.innerHTML = '<div id="toolbar"></div><div class="protyle fixture-owner"><div class="fixture-content"></div></div>';
                    const owner = document.querySelector<HTMLElement>(".fixture-owner")!;
                    const content = owner.querySelector<HTMLElement>(".fixture-content")!;
                    const host = document.createElement("div");
                    if (kind !== "body") host.className = "protyle protyle-title__rich protyle-lite-fragment";
                    host.innerHTML = '<div class="fixture-text" contenteditable="true"><span>Small </span><strong>Selected text</strong></div>';
                    content.append(host);
                    const editable = host.firstElementChild as HTMLElement;
                    editable.style.fontSize = `${fontSize}px`;
                    const larger = editable.querySelector<HTMLElement>("strong")!;
                    larger.style.fontSize = `${fontSize + 12}px`;
                    const range = document.createRange();
                    range.selectNodeContents(editable);
                    const toolbarElement = document.createElement("div");
                    toolbarElement.className = "protyle-toolbar";
                    toolbarElement.innerHTML = '<button class="protyle-toolbar__item">B</button><button class="protyle-toolbar__item">I</button>';
                    host.append(toolbarElement);
                    const subject = Object.assign(Object.create(Toolbar.prototype), {
                        element: toolbarElement, range, isMultipleClick: multipleClick,
                        rangePosition: {left: range.getBoundingClientRect().left, top: range.getBoundingClientRect().top, isBottom: false, rectIndex: 0},
                    });
                    const protyle = {element: kind === "body" ? owner : host, notebookId: "notebook",
                        block: {rootID: kind === "notebook-title" ? "notebook" : "document"}};
                    subject.setSelectionElementPosition(protyle, toolbarElement);
                    const selection = range.getBoundingClientRect();
                    const toolbar = toolbarElement.getBoundingClientRect();
                    const evidence = JSON.stringify({kind, multipleClick, fontSize, selection: selection.toJSON(), toolbar: toolbar.toJSON()});
                    check.ok(toolbar.bottom <= selection.top - 7.5, "toolbar stays above the complete selection with an 8px gap: " + evidence);
                    check.ok(toolbar.top >= 42, "toolbar stays below application controls: " + evidence);

                    const panel = document.createElement("div");
                    panel.className = "protyle-util";
                    panel.dataset.subElementSource = "selection-toolbar";
                    panel.style.height = "60px";
                    panel.style.width = "120px";
                    host.append(panel);
                    subject.setSelectionElementPosition(protyle, panel, toolbar);
                    const panelRect = panel.getBoundingClientRect();
                    check.ok(panelRect.bottom <= toolbar.top - 1.5 || panelRect.top >= selection.bottom + 1.5,
                        "appearance panels avoid the toolbar and the complete selection");

                    content.style.top = "0";
                    subject.setSelectionElementPosition(protyle, toolbarElement);
                    const topSelection = range.getBoundingClientRect();
                    const fallback = toolbarElement.getBoundingClientRect();
                    check.ok(fallback.top >= topSelection.bottom + 7.5,
                        "insufficient space above falls below the selection without application-bar clamping overlap");

                    content.style.top = "auto";
                    content.style.bottom = "0";
                    editable.style.width = "140px";
                    subject.rangePosition.isBottom = true;
                    subject.rangePosition.rectIndex = range.getClientRects().length - 1;
                    subject.setSelectionElementPosition(protyle, toolbarElement);
                    check.ok(toolbarElement.getBoundingClientRect().bottom <= range.getBoundingClientRect().top - 7.5,
                        "a selection at the bottom moves above all selected lines");
                    cases++;
                }
            }
        }
    }
    return cases;
};

test("selection toolbars avoid complete title and body selections at different fonts and zoom levels", {timeout: 45000}, async () => {
    const source = (file: string) => transpileModule(readFileSync(join(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const sources = {toolbar: source("index.ts"), selection: source("selectionElementPosition.ts"),
        position: source("../../util/setPosition.ts"), lifecycle: source("subElementLifecycle.ts")};
    const css = compile(join(__dirname, "../../assets/scss/protyle/_toolbar.scss"), {logger: Logger.silent}).css;
    const themes = ["daylight", "midnight"].map(theme => readFileSync(join(__dirname, `../../../appearance/themes/${theme}/theme.css`), "utf8"));
    const directory = mkdtempSync(join(tmpdir(), "siyuan-selection-toolbar-"));
    const script = join(directory, "run.cjs");
    const invocation = `(()=>{const __name=value=>value;return (${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(css)},${JSON.stringify(themes)});})()`;
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1000,height:720,useContentSize:true,
 webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
 win.webContents.on("console-message",event=>{if(event.level==="error")console.error(event.message);});
 try{
  await win.loadURL("about:blank");
  let cases=0;
  for(const zoom of [0.8,1,1.25]){
   win.webContents.setZoomFactor(zoom);
   cases+=await win.webContents.executeJavaScript(${JSON.stringify(invocation)});
  }
  console.log("Selection toolbar cases passed: "+cases);win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Selection toolbar cases passed: 108/);
    } finally {
        assert.equal(resolve(directory, ".."), resolve(tmpdir()));
        assert.ok(directory.startsWith(join(tmpdir(), "siyuan-selection-toolbar-")));
        rmSync(directory, {recursive: true, force: true});
    }
});
