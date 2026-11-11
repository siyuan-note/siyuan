const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async (preview) => {
    const check = require("node:assert/strict");
    const {renderTableCorners, observeTableCorners, destroyTableCorners} = window.corners;
    const root = document.createElement("div");
    root.className = preview ? "b3-typography" : "protyle-wysiwyg";
    document.body.append(root);
    const marker = "data-table-cell-corner";
    const tableMarker = "data-table-corners";
    const settle = () => new Promise(resolve => setTimeout(resolve, 30));
    const load = html => {
        root.innerHTML = `<table>${html}</table>`;
        renderTableCorners(root);
        return root.querySelector("table");
    };
    const has = (cell, corner) => (cell.getAttribute(marker) || "").split(" ").includes(corner);
    const verify = (table, left, right) => {
        check.ok(table.hasAttribute(tableMarker));
        const radius = parseFloat(getComputedStyle(table).getPropertyValue("--b3-table-border-radius-bottom-right")) ||
            parseFloat(getComputedStyle(table).borderBottomRightRadius);
        check.ok(radius > 0, "actual theme supplies the radius");
        for (const row of table.rows) {
            for (const cell of row.cells) {
                check.equal(has(cell, "bottom-left"), cell === left);
                check.equal(has(cell, "bottom-right"), cell === right);
                check.equal(parseFloat(getComputedStyle(cell).borderBottomLeftRadius), cell === left ? radius : 0);
                check.equal(parseFloat(getComputedStyle(cell).borderBottomRightRadius), cell === right ? radius : 0);
            }
        }
    };
    for (const font of [16, 32]) {
        root.style.fontSize = `${font}px`;
        root.style.setProperty("--b3-font-size-editor", `${font}px`);
        let table = load("<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>C</td><td>D</td></tr></tbody>");
        verify(table, table.rows[1].cells[0], table.rows[1].cells[1]);
        table = load('<tbody><tr><td rowspan="2">L</td><td>M</td><td rowspan="2">R</td></tr>' +
            '<tr><td class="fn__none"></td><td>Interior</td><td class="fn__none"></td></tr></tbody>');
        verify(table, table.rows[0].cells[0], table.rows[0].cells[2]);
        table = load('<tbody><tr><td rowspan="2" colspan="2">Both</td><td class="fn__none"></td></tr>' +
            '<tr><td class="fn__none"></td><td class="fn__none"></td></tr></tbody>');
        verify(table, table.rows[0].cells[0], table.rows[0].cells[0]);
        table = load('<thead><tr><th rowspan="2">L</th><th>R1</th></tr>' +
            '<tr><th class="fn__none"></th><th>R2</th></tr></thead>');
        verify(table, table.rows[0].cells[0], table.rows[1].cells[1]);
        table = load('<tbody><tr><td rowspan="0">L</td><td>R1</td></tr><tr><td>R2</td></tr></tbody>');
        verify(table, table.rows[0].cells[0], table.rows[1].cells[0]);
        table = load('<thead><tr><th rowspan="99">Header L</th><th>Header R</th></tr></thead>' +
            '<tbody><tr><td>L</td><td>R</td></tr></tbody><tfoot><tr><td colspan="2">Footer</td></tr></tfoot>');
        verify(table, table.rows[2].cells[0], table.rows[2].cells[0]);
        table = load("<tbody><tr><td><table><tbody><tr><td>Nested</td></tr></tbody></table></td><td>Right</td></tr></tbody>");
        verify(table, table.rows[0].cells[0], table.rows[0].cells[1]);
        const nested = table.querySelector("table");
        verify(nested, nested.rows[0].cells[0], nested.rows[0].cells[0]);
    }
    let table = load('<tbody><tr><td rowspan="2">L</td><td>R1</td></tr><tr><td class="fn__none"></td><td>R2</td></tr></tbody>');
    observeTableCorners(root);
    const original = table.innerHTML;
    table.rows[0].cells[0].removeAttribute("rowspan");
    table.rows[1].cells[0].classList.remove("fn__none");
    await settle();
    verify(table, table.rows[1].cells[0], table.rows[1].cells[1]);
    table.innerHTML = original;
    await settle();
    verify(table, table.rows[0].cells[0], table.rows[1].cells[1]);
    table.innerHTML = '<tbody><tr><td>L1</td><td>R1</td></tr><tr data-sy-table-virtual-rows="cached" ' +
        'contenteditable="false" aria-hidden="true"><td colspan="2" style="height:300px;padding:0;border:0">\u200b</td></tr></tbody>';
    await settle();
    check.equal(parseFloat(getComputedStyle(table.rows[0].cells[1]).borderBottomRightRadius), 0,
        "the last real row before a virtualized tail is not a bottom corner");
    check.equal(parseFloat(getComputedStyle(table.rows[1].cells[0]).borderBottomWidth), 0,
        "a virtualized placeholder retains its borderless layout");
    table.rows[1].outerHTML = "<tr><td>Restored L</td><td>Restored R</td></tr>";
    await settle();
    verify(table, table.rows[1].cells[0], table.rows[1].cells[1]);
    root.innerHTML = "<table><tbody><tr><td>Replacement</td></tr></tbody></table>";
    await settle();
    table = root.querySelector("table");
    verify(table, table.rows[0].cells[0], table.rows[0].cells[0]);
    destroyTableCorners(root);
    root.innerHTML = "<table><tbody><tr><td>Disposed</td></tr></tbody></table>";
    await settle();
    check.equal(root.querySelector("table").hasAttribute(tableMarker), false);
    renderTableCorners(root.querySelector("table"));
    check.ok(root.querySelector("table").hasAttribute(tableMarker), "table roots are included");
    const lute = window.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    root.innerHTML = lute.Md2BlockDOM("| A | B |\n| --- | --- |\n| C | D |\n");
    const unmarked = root.innerHTML;
    const markdown = lute.BlockDOM2Md(unmarked);
    renderTableCorners(root);
    check.ok(root.querySelector("table").hasAttribute(tableMarker));
    check.equal(lute.BlockDOM2Md(root.innerHTML), markdown);
    for (const html of [lute.SpinBlockDOM(root.innerHTML), lute.BlockDOM2HTML(root.innerHTML),
        lute.Md2BlockDOM(lute.BlockDOM2Md(root.innerHTML))]) {
        check.ok(!html.includes(tableMarker) && !html.includes(marker), "presentation markers do not persist");
        root.innerHTML = html;
        renderTableCorners(root);
        table = root.querySelector("table");
        verify(table, table.rows[table.rows.length - 1].cells[0], table.rows[table.rows.length - 1].cells[1]);
    }
    root.remove();
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
        const ts = require("typescript");
        const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/protyle/render/tableCorners.ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText;
        await win.webContents.executeJavaScript(`(() => {const exports = {}; const require = () => ({Constants: {
            TABLE_CORNERS: "data-table-corners", TABLE_CELL_CORNER: "data-table-cell-corner"
        }}); ${source}; window.corners = exports;})()`);
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        const sass = require("sass");
        for (const entry of ["base", "mobile", "export"]) {
            const css = sass.compile(path.join(__dirname, `../src/assets/scss/${entry}.scss`), {logger: sass.Logger.silent}).css;
            const cssKey = await win.webContents.insertCSS(css);
            for (const theme of ["daylight", "midnight"]) {
                const themeKey = await win.webContents.insertCSS(readFileSync(path.join(__dirname,
                    `../appearance/themes/${theme}/theme.css`), "utf8"));
                for (const preview of [false, true]) {
                    await win.webContents.executeJavaScript(`(${runCases.toString()})(${preview})`);
                }
                await win.webContents.removeInsertedCSS(themeKey);
            }
            await win.webContents.removeInsertedCSS(cssKey);
        }
        console.log("Table corner cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("renders merged table corners across editor, mobile, preview and export styles", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-table-corners-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Table corner cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-table-corners-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
