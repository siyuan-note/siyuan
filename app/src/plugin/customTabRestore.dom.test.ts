import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, forEachChild, isMethodDeclaration, isVariableStatement,
    ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const owner = {} as typeof import("./customTabOwner");
    new Function("exports", sources.owner)(owner);
    window.siyuan = {languages: {pluginTabUnavailable: "Plugin unavailable", retry: "Retry"}} as unknown as typeof window.siyuan;
    class Unused {}
    const layouts = {} as Pick<typeof import("../layout/util"), "newModelByInitData">;
    new Function("exports", "resolveCustomModelFactory", sources.layout)(layouts, owner.resolveCustomModelFactory);
    const models: Array<{type: string, tab: object}> = [];
    class Custom {
        element: HTMLElement;
        type: string;
        tab: object;
        constructor(options: {tab: {panelElement: HTMLElement}, type: string, init: (model: Custom) => void}) {
            this.element = options.tab.panelElement;
            this.type = options.type;
            this.tab = options.tab;
            options.init(this);
            models.push(this);
        }
    }
    const PluginHarness = new Function("Custom", "setCustomTabOwner", "resolveCustomTabOwner", "getAllModels",
        "isPluginDisposed", "isSettingsWindow", sources.plugin)(Custom, owner.setCustomTabOwner,
        owner.resolveCustomTabOwner, () => ({custom: models}), () => false, () => false);
    const app = {plugins: []} as unknown as import("../index").App;
    const plugin = new PluginHarness();
    Object.assign(plugin, {name: "foo", models: {}, app});
    app.plugins.push(plugin);
    const WndHarness = new Function("newModelByInitData", "isPhablet", "setPanelFocus", "saveLayout", "Editor",
        sources.wnd)(layouts.newModelByInitData, () => false, () => {}, () => {}, Unused);
    const wnd = new WndHarness();
    const panel = document.createElement("div");
    const header = document.createElement("li");
    const headers = document.createElement("ul");
    const frame = document.createElement("div");
    const outer = document.createElement("div");
    headers.append(header);
    frame.append(headers, panel);
    outer.append(frame);
    document.body.append(outer);
    const saved = {instance: "Custom", customModelType: "foobar", customModelData: {secret: "keep data"}};
    header.setAttribute("data-initdata", JSON.stringify(saved));
    const tab = {headElement: header, panelElement: panel, parent: wnd, model: undefined as Custom | undefined,
        addModel(model: Custom) { check.ok(model); this.model = model; }};
    Object.assign(wnd, {app, children: [tab], headersElement: headers});
    wnd.switchTab(header);
    check.equal(tab.model, undefined, "an unregistered factory cannot reach Tab.addModel");
    check.deepEqual(JSON.parse(header.getAttribute("data-initdata")!), saved, "placeholder keeps the saved data");
    check.equal(panel.querySelector("p")?.textContent, "Plugin unavailable");
    check.ok(panel.querySelector("button")?.classList.contains("b3-button"));
    let initialized = 0;
    plugin.addTab({type: "bar", init(custom: Custom) { initialized++; custom.element.textContent = "restored"; }});
    panel.querySelector("button")!.click();
    check.equal(initialized, 1, "retry instantiates a factory registered after layout restoration");
    check.equal(header.hasAttribute("data-initdata"), false);
    check.equal(panel.textContent, "restored");
    check.equal(owner.getCustomTabOwner(tab as unknown as import("../layout/Tab").Tab), "foo");
    models.push({type: "foodock", tab: {}});
    check.deepEqual(Object.keys(plugin.getOpenedTab()), ["bar"]);
    check.equal(plugin.getOpenedTab().bar[0], tab.model);
    // 重建插件实例后，运行时归属仍能用于查询已打开的页签。
    const replacement = new PluginHarness();
    Object.assign(replacement, {name: "foo", models: {}, app});
    app.plugins[0] = replacement;
    check.equal(replacement.getOpenedTab().bar[0], tab.model);
    replacement.models.legacy = (): undefined => undefined;
    check.ok(Object.hasOwn(replacement.getOpenedTab(), "legacy"), "nonstandard registry keys remain intact");
    // 无运行时归属的旧键有两个可能插件时，不向任何工厂传递保存的数据。
    const other = new PluginHarness();
    Object.assign(other, {name: "foob", models: {}, app});
    app.plugins.push(other);
    other.addTab({type: "ar", init() { throw new Error("ambiguous data leaked"); }});
    tab.model = undefined;
    const ambiguousTab = {...tab};
    header.setAttribute("data-initdata", JSON.stringify(saved));
    wnd.children = [ambiguousTab];
    wnd.switchTab(header);
    check.equal(ambiguousTab.model, undefined);
    check.deepEqual(JSON.parse(header.getAttribute("data-initdata")!), saved);
    check.equal(panel.querySelector("p")?.textContent, "Plugin unavailable");
    return "Custom tab restore cases passed";
};

test("custom tabs preserve lazy data, retry safely and isolate colliding plugin factories", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const compile = (text: string) => transpileModule(text, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const layout = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.Latest);
    const layoutCode = layout.statements.filter(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(layout) === "newModelByInitData"))
        .map(node => node.getText(layout)).join("\n");
    const methods = (file: string, names: string[]) => {
        const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
        const selected: string[] = [];
        const visit = (node: import("typescript").Node) => {
            if (isMethodDeclaration(node) && names.includes(node.name.getText(source))) selected.push(node.getText(source));
            forEachChild(node, visit);
        };
        visit(source);
        assert.equal(selected.length, names.length);
        return compile(`class Harness {${selected.join("\n")}}\nreturn Harness;`);
    };
    const sources = {owner: compile(readFileSync("src/plugin/customTabOwner.ts", "utf8")), layout: compile(layoutCode),
        plugin: methods("src/plugin/index.ts", ["addTab", "getOpenedTab"]), wnd: methods("src/layout/Wnd.ts", ["switchTab"])};
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-custom-tabs-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript("const __name = value => value; ("+
            ${JSON.stringify(browserCases.toString())}+")("+JSON.stringify(${JSON.stringify(sources)})+")"));
        win.destroy();app.exit(0);
    } catch(error) {console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Custom tab restore cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-custom-tabs-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
