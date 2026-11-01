import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {
    ArrowFunction, createSourceFile, isArrowFunction, isBlock, isCallExpression, isClassDeclaration,
    isIfStatement, isPropertyDeclaration, isStringLiteral, ScriptTarget, transpileModule,
} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");
const text = readFileSync("src/protyle/wysiwyg/index.ts", "utf8");
const source = createSourceFile("index.ts", text, ScriptTarget.Latest, true);
const handlers = new Map<string, ArrowFunction>();
const visit = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
        isStringLiteral(node.arguments[0]) && isArrowFunction(node.arguments[1])) {
        handlers.set(node.arguments[0].text, node.arguments[1]);
    }
    node.forEachChild(visit);
};
visit(source);
const mouseDown = handlers.get("mousedown").body;
const click = handlers.get("click").body;
assert.ok(isBlock(mouseDown) && isBlock(click));
const state = source.statements.filter(isClassDeclaration).flatMap(node => Array.from(node.members))
    .find(node => isPropertyDeclaration(node) && node.name.getText(source) === "mouseDownWithMeta");
assert.ok(state);
const branch = (condition: string) => {
    const result = click.statements.find(node => isIfStatement(node) && node.expression.getText(source) === condition);
    assert.ok(result, condition);
    return result.getText(source);
};
const compatibility = readFileSync("src/protyle/util/compatibility.ts", "utf8")
    .match(/export const isOnlyMeta = [\s\S]*?(?=\nexport const isNotCtrl)/)[0].replace("export ", "");

const harnessSource = (mobile: boolean) => transpileModule(parse(`
${compatibility}
let mobileBlur = false;
class Harness {
    ${state.getText(source)}
    mousedown(event) { ${mouseDown.statements[0].getText(source)} }
    click(event) {
        ${click.statements.slice(0, 2).map(node => node.getText(source)).join("\n")}
        ${branch("protyle.toolbar.isMultiSelectMode()")}
        ${branch("this.preventClick")}
        const ctrlIsPressed = isOnlyMeta(event);
        const embedItemElement = hasClosestByClassName(event.target, "protyle-wysiwyg__embed");
        ${branch("embedItemElement")}
        return "continued";
    }
}
return new Harness();`, {MOBILE: mobile}, false, true), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const createHarness = (code: string, dependencies: Record<string, unknown>) =>
    new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));

const fixture = (mobile = false, mac = false) => {
    const opens: Array<{id: string; position?: string; keepCursor?: boolean}> = [];
    const embed = {getAttribute: () => "source-block"};
    let multiSelect = false;
    let stopped = 0;
    const harness = createHarness(harnessSource(mobile), {
        isMac: () => mac,
        hasClosestByClassName: () => embed,
        checkFold: (_id: string, callback: (zoomIn: boolean, action: string[]) => void) => callback(false, ["focus"]),
        openFileById: (options: typeof opens[number]) => opens.push(options),
        openMobileFileById: (_app: unknown, id: string) => opens.push({id}),
        activeBlur: () => {},
        Constants: {CB_GET_HL: "highlight", CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "scroll"},
        protyle: {app: {}, toolbar: {isMultiSelectMode: () => multiSelect}},
    });
    const event = (options: Partial<MouseEvent> = {}) => ({
        button: 0, detail: 1, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        stopPropagation() { stopped++; }, preventDefault() {}, ...options,
    });
    return {opens, harness,
        down: (options: Partial<MouseEvent> = {}) => harness.mousedown(event(options)),
        click: (options: Partial<MouseEvent> = {}) => harness.click(event(options)),
        multiSelect: (enabled: boolean) => multiSelect = enabled,
        stopped: () => stopped,
    };
};

for (const mobile of [false, true]) {
    for (const mac of [false, true]) {
        const modifier = mac ? {metaKey: true} : {ctrlKey: true};
        const platform = `${mobile ? "mobile" : "desktop"}, ${mac ? "Command" : "Ctrl"}`;
        test(`embed navigation requires the modifier at both mouse down and click (${platform})`, () => {
            const f = fixture(mobile, mac);
            f.down();
            assert.equal(f.click(modifier), "continued");
            assert.equal(f.opens.length, 0, "preparing to copy after selecting text must not navigate");
            f.down(modifier);
            f.click();
            assert.equal(f.opens.length, 0, "releasing the modifier before click must not navigate");
            f.down(modifier);
            f.click(modifier);
            assert.equal(f.opens.length, 1);
            assert.equal(f.opens[0].id, "source-block");
            if (!mobile) {
                assert.equal(f.opens[0].keepCursor, true);
            }
        });
        test(`embed clicks consume modifier state even when handled early (${platform})`, () => {
            const f = fixture(mobile, mac);
            f.click(modifier);
            assert.equal(f.opens.length, 0, "a click without mouse down must not navigate");
            f.down(modifier);
            f.multiSelect(true);
            f.click(modifier);
            f.multiSelect(false);
            f.click(modifier);
            f.down(modifier);
            f.harness.preventClick = true;
            f.click(modifier);
            f.click(modifier);
            assert.equal(f.opens.length, 0);
            f.down(modifier);
            f.down();
            f.click(modifier);
            assert.equal(f.opens.length, 0, "a new gesture replaces a cancelled mouse down");
            f.down(modifier);
            f.click({...modifier, detail: 0});
            f.click(modifier);
            assert.equal(f.opens.length, 0, "keyboard or programmatic clicks cannot reuse mouse state");
            f.down({...modifier, button: 2});
            f.click(modifier);
            assert.equal(f.opens.length, 0, "right mouse down cannot authorize left-click navigation");
        });
    }
    test(`Shift and Alt retain their embed opening behavior (${mobile ? "mobile" : "desktop"})`, () => {
        for (const [modifier, position] of [[{shiftKey: true}, "bottom"], [{altKey: true}, "right"]] as const) {
            const f = fixture(mobile);
            f.down();
            f.click(modifier);
            assert.equal(f.opens.length, 1);
            assert.equal(f.opens[0].position, mobile ? undefined : position);
            assert.equal(f.stopped(), 1);
        }
    });
}

test("native text selection followed by Ctrl/Command does not navigate, while deliberate modifier clicks do", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-embed-click-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
const assert = require("node:assert/strict");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 900, height: 500,
        webPreferences: {nodeIntegration: false, contextIsolation: true, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(
            "const __name = value => value; (" + ${JSON.stringify(browserSetup.toString())} + ")(" + ${JSON.stringify(JSON.stringify(harnessSource(false)))} + "," + (process.platform === "darwin") + ")");
        const evaluate = code => win.webContents.executeJavaScript(code);
        const modifier = process.platform === "darwin" ? "meta" : "control";
        const send = async (type, point, modifiers = []) => {
            win.webContents.sendInputEvent({type, ...point, button: "left", clickCount: 1, modifiers});
            await evaluate("0");
        };
        const from = await evaluate("point(2)");
        const to = await evaluate("point(20)");
        for (const existing of [false, true]) {
            await evaluate("reset(" + existing + ")");
            const start = existing ? await evaluate("point(10)") : from;
            await send("mouseMove", start);
            await send("mouseDown", start, existing ? [modifier] : []);
            if (!existing) {
                for (let i = 1; i <= 6; i++) {
                    await send("mouseMove", {x: Math.round(from.x + (to.x - from.x) * i / 6), y: to.y}, ["leftButtonDown"]);
                }
            }
            await send("mouseUp", existing ? start : to, [modifier]);
            const result = await evaluate("({opens: opens.length, selected: selectedOnClick, clicks})");
            assert.equal(result.clicks, 1, "the native gesture must deliver a click");
            assert.ok(result.selected.length > 0, "the text selection must survive: " + JSON.stringify({existing, ...result}));
            assert.equal(result.opens, existing ? 1 : 0,
                existing ? "deliberate Ctrl click with an existing selection opens the source" : "select then copy does not open it");
        }
        console.log("Native embed click cases passed");
        app.exit(0);
    } catch (error) {console.error(error); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Native embed click cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-embed-click-")) {
            rmSync(temporary, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        }
    }
});

const browserSetup = (code: string, mac: boolean) => {
    document.body.innerHTML = '<div class="protyle-wysiwyg__embed" data-id="source-block" style="font:20px monospace;padding:20px"><div id="text" contenteditable="true">alpha bravo charlie delta echo foxtrot golf hotel india juliet</div></div>';
    const state = window as unknown as {opens: unknown[]; clicks: number; selectedOnClick: string; reset: (existing: boolean) => void;
        point: (offset: number) => {x: number; y: number}};
    state.opens = [];
    state.clicks = 0;
    const embed = document.querySelector<HTMLElement>(".protyle-wysiwyg__embed");
    const harness = new Function("isMac", "hasClosestByClassName", "checkFold", "openFileById", "Constants", "protyle", code)(
        () => mac, (target: Element, name: string) => target.closest("." + name),
        (_id: string, callback: (zoomIn: boolean, action: string[]) => void) => callback(false, []),
        (options: unknown) => state.opens.push(options), {}, {app: {}, toolbar: {isMultiSelectMode: () => false}});
    embed.addEventListener("mousedown", event => harness.mousedown(event));
    embed.addEventListener("click", event => {
        state.clicks++;
        state.selectedOnClick = getSelection().toString();
        harness.click(event);
    });
    const text = document.getElementById("text");
    state.reset = existing => {
        text.focus();
        const range = document.createRange();
        range.setStart(text.firstChild, 2);
        range.setEnd(text.firstChild, existing ? 20 : 2);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        state.opens.length = 0;
        state.clicks = 0;
    };
    state.point = offset => {
        const range = document.createRange();
        range.setStart(text.firstChild, offset);
        range.setEnd(text.firstChild, offset + 1);
        const rect = range.getBoundingClientRect();
        return {x: Math.round(rect.left + 1), y: Math.round(rect.top + rect.height / 2)};
    };
};
