const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runPinnedHeader = () => {
    const check = require("node:assert/strict");
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = '<div class="table" data-node-id="table" custom-pinthead="true"><div style="width:240px;max-height:140px">' +
        '<table style="width:480px"><thead><tr><th>Left</th><th>Right</th></tr></thead><tbody>' +
        "<tr><td>1</td><td>2</td></tr>".repeat(16) + '</tbody></table><div class="protyle-action__table"></div></div></div>';
    document.body.append(root);
    try {
        const table = root.querySelector("table");
        const viewport = table.parentElement;
        const head = table.tHead;
        const border = getComputedStyle(head, "::after");
        check.equal(getComputedStyle(table).borderTopWidth, "0px");
        check.equal(border.borderTopWidth, "1px");
        check.equal(border.pointerEvents, "none");
        check.equal(border.borderTopLeftRadius, getComputedStyle(table).borderTopLeftRadius);
        check.equal(border.borderTopRightRadius, getComputedStyle(table).borderTopRightRadius);
        const cornerOverlay = getComputedStyle(table.nextElementSibling, "::before");
        check.equal(cornerOverlay.backgroundPosition, "0% 100%, 100% 100%");
        for (const [left, top] of [[0, 0], [0, 70], [90, 70], [0, 0]]) {
            viewport.scrollTo(left, top);
            const rect = viewport.getBoundingClientRect();
            check.equal(viewport.scrollTop, top);
            check.equal(viewport.scrollLeft, left);
            check.equal(head.getBoundingClientRect().top, rect.top);
            check.equal(table.getBoundingClientRect().top, rect.top - top);
        }
    } finally {
        root.remove();
    }
};

const runPinnedColumn = async () => {
    const check = require("node:assert/strict");
    const {observeTableCorners, destroyTableCorners} = window.corners;
    const pin = "custom-sy-table-pin-column";
    const marker = "data-table-pinned-column-cell";
    const active = "data-table-pinned-column-active";
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = '<div class="table" data-node-id="table" data-type="NodeTable" custom-pinthead="true">' +
        '<div style="width:350px;max-height:140px"><table style="width:600px;table-layout:fixed">' +
        '<colgroup><col style="width:150px"><col style="width:190px"><col></colgroup>' +
        "<thead><tr><th>Heading</th><th>Second</th><th>Third</th></tr></thead>" +
        '<tbody><tr><td rowspan="2">Vertical</td><td>One</td><td>Two</td></tr><tr><td>Three</td><td>Four</td></tr>' +
        '<tr><td colspan="2">Horizontal</td><td>Five</td></tr>' +
        "<tr><td>6</td><td>7</td><td>8</td></tr>".repeat(16) + "</tbody></table></div></div>";
    document.body.append(root);
    observeTableCorners(root);
    try {
        const block = root.firstElementChild;
        const table = block.querySelector("table");
        const viewport = table.parentElement;
        const firstHeader = table.tHead.rows[0].cells[0];
        const [vertical, second, horizontal] = Array.from(table.tBodies[0].rows).map(row => row.cells[0]);
        const left = () => viewport.getBoundingClientRect().left;
        viewport.scrollTo(125, 65);
        check.ok(firstHeader.getBoundingClientRect().left < left(), "existing tables scroll until pinning is enabled");
        block.setAttribute(pin, "true");
        await settle();
        check.ok(table.hasAttribute(active));
        check.ok(firstHeader.hasAttribute(marker));
        check.ok(vertical.hasAttribute(marker), "a vertical merge in the first column is pinned");
        check.ok(!second.hasAttribute(marker), "the first DOM cell can occupy the second logical column");
        check.ok(!horizontal.hasAttribute(marker), "the whole horizontal merge scrolls");
        check.equal(firstHeader.getBoundingClientRect().left, left());
        check.equal(vertical.getBoundingClientRect().left, left());
        check.ok(horizontal.getBoundingClientRect().left < left());
        check.ok(second.getBoundingClientRect().left < firstHeader.getBoundingClientRect().right);
        check.equal(table.tHead.getBoundingClientRect().top, viewport.getBoundingClientRect().top);
        const headerRect = firstHeader.getBoundingClientRect();
        check.equal(document.elementFromPoint(headerRect.left + 50, headerRect.top + headerRect.height / 2), firstHeader,
            "the pinned intersection covers and receives input over scrolled cells");
        check.notEqual(getComputedStyle(vertical).backgroundColor, "rgba(0, 0, 0, 0)");
        viewport.style.width = "195px";
        await settle();
        check.ok(!table.hasAttribute(active));
        check.equal(block.getAttribute(pin), "true", "a narrow viewport does not change the saved setting");
        check.ok(firstHeader.getBoundingClientRect().left < left());
        viewport.style.width = "350px";
        await settle();
        check.equal(firstHeader.getBoundingClientRect().left, left());
        horizontal.removeAttribute("colspan");
        horizontal.insertAdjacentHTML("afterend", "<td>New cell</td>");
        await settle();
        check.equal(horizontal.getBoundingClientRect().left, left(), "splitting a merge restores pinning");
        block.removeAttribute(pin);
        await settle();
        check.ok(!table.hasAttribute(active) && !firstHeader.hasAttribute(marker));
        check.ok(firstHeader.getBoundingClientRect().left < left());
        check.equal(table.tHead.getBoundingClientRect().top, viewport.getBoundingClientRect().top,
            "unpinning the column leaves header pinning enabled");

        const lute = window.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        lute.SetKramdownIAL(true);
        root.innerHTML = lute.Md2BlockDOM("| A | B |\n| --- | --- |\n| C | D |\n");
        root.firstElementChild.setAttribute(pin, "true");
        await settle();
        check.ok(root.querySelector(`[${marker}]`));
        for (const html of [lute.SpinBlockDOM(root.innerHTML), lute.Md2BlockDOM(lute.BlockDOM2Md(root.innerHTML))]) {
            check.match(html, new RegExp(`${pin}="true"`), "the block attribute survives editing and reload");
            check.ok(!html.includes(marker) && !html.includes(active), "DOM markers do not persist");
        }
    } finally {
        destroyTableCorners(root);
        root.remove();
    }
};

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
        await win.webContents.executeJavaScript(`(() => {const exports = {}; const require = () => ({
            TABLE_VIRTUAL_ROWS: "data-sy-table-virtual-rows", Constants: {
            TABLE_CORNERS: "data-table-corners", TABLE_CELL_CORNER: "data-table-cell-corner",
            TABLE_PINNED_COLUMN_CELL: "data-table-pinned-column-cell",
            TABLE_PINNED_COLUMN_ACTIVE: "data-table-pinned-column-active",
            CUSTOM_SY_TABLE_PIN_COLUMN: "custom-sy-table-pin-column"
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
                if (entry !== "export") {
                    await win.webContents.executeJavaScript(`(${runPinnedHeader.toString()})()`);
                    await win.webContents.executeJavaScript(`(${runPinnedColumn.toString()})()`);
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
    require("node:test").it("renders merged corners, pinned headers and pinned columns with editor, mobile, preview and export styles", {
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
