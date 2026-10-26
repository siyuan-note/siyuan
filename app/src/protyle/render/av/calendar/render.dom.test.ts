import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const start = new Date(2026, 8, 6).getTime();
    const end = new Date(2026, 8, 13).getTime();
    const range = {start, end, timeZone: "UTC"};
    let mobile = false;
    let dragSessions = 0;
    const pageErrors: string[] = [];
    window.addEventListener("error", event => pageErrors.push(event.message));
    window.addEventListener("unhandledrejection", event => pageErrors.push(String(event.reason)));
    const previews: string[] = [];
    const dependencies = {
        Constants: {ZWSP: "", TIMEOUT_LONGPRESS: 10}, AV_DATE_TYPES: ["date"],
        isMobile: () => mobile,
        getCalendarState: () => ({anchor: start, mode: "week", rowLimit: 3, expandedWeeks: new Set()}),
        getCalendarRequestRange: () => range,
        isCalendarDateColumn: () => true,
        getCalendarUndatedHTML: () => "", bindCalendarUndated() {},
        genTabHeaderHTML: () => "", deferAvSearchRender: () => false, captureAvSearchSelection() {}, bindAvSearch() {},
        getAVSelectedItemIDs: (): string[] => [], setAVData() {}, finishAVLocate() {}, renderAVRichTextElements() {},
        getConditionalBackground: () => "", hasAVRenderTemplateResult: () => false,
        getAVBlockRefSubtype: () => "s", getFileTreeIconHTML: () => "",
        escapeAttr: (value: string) => value || "", escapeHtml: (value: string) => value || "",
        escapeHtmlTextAndAttr: (value: string) => value || "",
        replaceAVContainer: (block: HTMLElement, html: string) => { block.innerHTML = html; },
        openDatabaseRowByData: (_protyle: unknown, data: {itemID: string}) => previews.push(data.itemID),
        getCalendarDropDay: () => start,
        createCalendarPreviewLayout: () => { dragSessions++; return {place() {}, destroy() {}}; },
    };
    const api = new Function(...Object.keys(dependencies), source + "; return {renderCalendar};")(...Object.values(dependencies));
    Object.assign(window, {siyuan: {config: {lang: "en"}, languages: {untitled: "Untitled"},
        menus: {menu: {remove() {}}}}});
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const click = async (element: HTMLElement, right = false) => {
        element.scrollIntoView({block: "center"});
        await frame();
        const rect = element.getBoundingClientRect();
        const x = Math.round(right ? rect.right - 4 : rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        check.ok(element.classList.contains("av__celltext--ref") ? element.contains(hit) :
            hit?.closest("[data-calendar-item]") === element.closest("[data-calendar-item]"),
        "the primary reference participates in browser hit testing: " +
            JSON.stringify({element: element.outerHTML, hit: hit?.outerHTML, rect: rect.toJSON()}));
        await require("electron").ipcRenderer.invoke("calendar-click", x, y);
        await frame();
        await frame();
    };
    for (mobile of [false, true]) {
        document.body.className = mobile ? "body--android" : "body--windows";
        const editor = document.createElement("div");
        const block = document.createElement("div");
        block.className = "av";
        block.dataset.avId = "database";
        block.dataset.nodeId = "carrier";
        block.dataset.avType = "calendar";
        block.style.width = "960px";
        editor.append(block);
        document.body.append(editor);
        const references: string[] = [];
        editor.addEventListener("click", event => {
            const reference = (event.target as HTMLElement).closest<HTMLElement>('[data-type="block-ref"]');
            if (reference) references.push(reference.dataset.id);
        });
        const data = {viewID: "calendar", view: {
            calendar: {dateKeyID: "date", weekStart: 0}, calendarRange: range,
            columns: [{id: "primary", type: "block"}, {id: "date", type: "date", hidden: true}],
            rows: [false, true].map(detached => ({id: detached ? "detached" : "bound", cells: [
                {id: "primary", value: {type: "block", keyID: "primary", isDetached: detached,
                    block: {content: detached ? "Detached title" : "Bound title", ...(detached ? {} : {id: "document"})}}},
                {id: "date", value: {type: "date", keyID: "date", date: {content: start, content2: end - 86400000,
                    isNotEmpty: true, isNotEmpty2: true, hasEndDate: true, isNotTime: true}}},
            ]})),
        }};
        await api.renderCalendar(block, {app: {}, options: {}}, data);
        await frame();
        const reference = block.querySelector<HTMLElement>(".av__celltext--ref");
        const previousDragSessions = dragSessions;
        await click(reference);
        check.deepEqual(references, ["document"], "primary clicks reach the shared editor reference handler");
        check.equal(previews.length, 0, "primary clicks do not also open a row preview");
        reference.dispatchEvent(new TouchEvent("touchstart", {bubbles: true,
            touches: [new Touch({identifier: 1, target: reference, clientX: 10, clientY: 20})]}));
        await new Promise(resolve => setTimeout(resolve, 20));
        check.equal(dragSessions, previousDragSessions, "clicking or touching a reference never starts calendar dragging");
        await click(block.querySelector<HTMLElement>('[data-calendar-item="bound"] .av__calendar-item-content'), true);
        await click(block.querySelector<HTMLElement>('[data-calendar-item="detached"] .av__celltext'));
        check.deepEqual(previews, ["bound", "detached"], "card space and detached titles retain row previews");
        previews.length = 0;
        editor.remove();
    }
    check.deepEqual(pageErrors, [], "native interactions do not throw in event handlers");
    return "Calendar primary reference cases passed";
};

test("calendar primary references receive native clicks and bubble while card space retains previews", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const cell = createSourceFile("cell.ts", readFileSync(path.join(__dirname, "../cell.ts"), "utf8"), ScriptTarget.Latest, true);
    const renderCell = cell.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(cell) === "renderCell"));
    assert.ok(renderCell);
    const source = ["date.ts", "../blockIcon.ts", "render.ts"].map(file => readFileSync(path.join(__dirname, file), "utf8"))
        .concat(renderCell.getText(cell)).map(text => transpileModule(text.replace(/^import [\s\S]*?;\r?\n/gm, "")
            .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const css = require("sass").compile(path.resolve(__dirname, "../../../../assets/scss/base.scss"),
        {logger: require("sass").Logger.silent}).css + readFileSync(
        path.resolve(__dirname, "../../../../../appearance/themes/daylight/theme.css"), "utf8");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-calendar-render-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1100, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    ipcMain.handle("calendar-click", (_event, x, y) => {
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
            win.webContents.sendInputEvent({type, x, y, button: "left", clickCount: 1});
        }
    });
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
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
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Calendar primary reference cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-calendar-render-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
