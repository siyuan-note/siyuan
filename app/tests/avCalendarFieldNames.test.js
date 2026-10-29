const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {runInNewContext} = require("node:vm");
const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");
const sass = require("sass");

const calendarItem = mobile => {
    const api = {};
    const source = readFileSync(path.join(__dirname, "../src/protyle/render/av/calendar/render.ts"), "utf8");
    const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const modules = {
        "../../../../util/escape": {escapeAttr: escape, escapeHtml: escape},
        "../../../../util/functions": {isMobile: () => mobile},
        "./date": {getCalendarDate: value => value.date, isCalendarDateEditable: () => true},
        "../conditionalColor": {getConditionalBackground: () => ""},
        "../cellValue": {cellValueIsEmpty: () => false},
        "../cell": {renderCell: value => `<span class="av__celltext">${escape(value.text?.content ?? value.number?.content ?? "[ ]")}</span>`},
    };
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText + "\nexports.getEventHTML = getEventHTML;", {
        exports: api, require: name => modules[name] || {}, window: {siyuan: {config: {lang: "en"}, languages: {}}},
    });
    const values = [
        {keyID: "primary", type: "block", block: {content: "Entry title"}, text: {content: "Entry title"}},
        {keyID: "amount", type: "number", number: {content: 0}},
        {keyID: "note", type: "text", text: {content: "A_long_value_that_wraps_without_expanding_the_calendar_column"}},
        {keyID: "check", type: "checkbox", checkbox: {checked: false}},
    ];
    const row = {id: "item", cells: values.map(value => ({value}))};
    const view = {calendar: {displayFieldName: true}, columns: values.map(value => ({
        id: value.keyID, type: value.type, name: "A very long field name that must remain bounded", wrap: value.keyID === "note",
    }))};
    const date = {value: {type: "date", date: {isNotTime: true}}};
    return api.getEventHTML({event: {row, date}, starts: true, ends: true, column: 0, span: 1, lane: 0}, view, true);
};

const browserCases = (css, item) => {
    const check = require("node:assert/strict");
    document.head.innerHTML = "<style></style>";
    document.head.firstElementChild.textContent = css;
    for (const size of [16, 28]) {
        document.body.style.fontSize = size + "px";
        document.body.innerHTML = `<div class="av" data-av-type="calendar"><div class="av__calendar-events">${item}</div></div>`;
        const card = document.querySelector(".av__calendar-item");
        const content = document.querySelector(".av__calendar-item-content");
        const primary = document.querySelector('[data-field-id="primary"]');
        check.equal(primary.parentElement, content, "the primary key remains an unlabeled title");
        const rows = document.querySelectorAll(".av__calendar-field-row");
        check.equal(rows.length, 3);
        for (const row of rows) {
            const label = row.firstElementChild;
            const value = row.lastElementChild;
            const bounds = row.getBoundingClientRect();
            const nameBounds = label.getBoundingClientRect();
            const valueBounds = value.getBoundingClientRect();
            check.ok(bounds.width > 0);
            check.ok(nameBounds.width <= bounds.width * 0.4 + 1, "long names leave space for their values");
            check.ok(valueBounds.width > 0);
            check.ok(valueBounds.right <= bounds.right + 1, "values stay inside their event");
            check.ok(label.scrollWidth > label.clientWidth, "long field names truncate");
            check.equal(getComputedStyle(label).textOverflow, "ellipsis");
        }
        check.ok(content.scrollWidth <= content.clientWidth + 1, "field labels do not expand the event");
        const amount = document.querySelector('[data-field-id="amount"]');
        check.equal(amount.textContent, "0");
        check.equal(getComputedStyle(amount.firstElementChild).whiteSpace, "nowrap");
        const note = document.querySelector('[data-field-id="note"]');
        check.equal(getComputedStyle(note.firstElementChild).whiteSpace, "pre-wrap");
        check.ok(note.getBoundingClientRect().height > amount.getBoundingClientRect().height, "wrapped values retain multiple lines");
        const checkbox = document.querySelector('[data-field-id="check"]');
        check.equal(getComputedStyle(checkbox).pointerEvents, "auto");
        check.equal(checkbox.getAttribute("aria-checked"), "false");
        check.ok(checkbox.getAttribute("aria-label").length > 0);
        check.ok(card.getBoundingClientRect().right <= document.body.getBoundingClientRect().right + 1);
    }
    return "Calendar field name layout passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        try {
            for (const name of ["base", "mobile"]) {
                const styles = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css;
                for (const theme of ["daylight", "midnight"]) {
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + styles;
                    for (const width of [1280, 840, 420]) {
                        win.setSize(width, 900);
                        await win.loadURL("data:text/html,<html><body></body></html>");
                        const result = await win.webContents.executeJavaScript(
                            `(() => { try { return (${browserCases.toString()})(${JSON.stringify(css)}, ${JSON.stringify(calendarItem(name === "mobile"))}); } catch (error) { return error.stack; } })()`);
                        assert.equal(result, "Calendar field name layout passed", `${name}/${theme}/${width}`);
                    }
                }
            }
            console.log("Calendar field name layout passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    }).catch(error => { console.error(error); app.exit(1); });
} else {
    require("node:test").test("calendar field names fit desktop and mobile events in both themes at narrow widths and large editor fonts", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-fields-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Calendar field name layout passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-calendar-fields-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
