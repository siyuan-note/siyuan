const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const browserCases = async sources => {
    const check = require("node:assert/strict");
    const exports = {};
    new Function("exports", sources.core)(exports);
    const {AVColumnVirtualScroll} = exports;
    const lifecycle = {};
    new Function("require", "exports", sources.lifecycle)(name => {
        check.equal(name, "./columnVirtualScroll");
        return exports;
    }, lifecycle);
    const frames = [];
    window.requestAnimationFrame = callback => frames.push(callback);
    window.cancelAnimationFrame = () => {};
    const settle = async () => {
        await Promise.resolve();
        while (frames.length) frames.shift()();
        await Promise.resolve();
    };
    const style = document.createElement("style");
    style.textContent = `html,body {margin:0} .av__scroll {width:640px;overflow:auto}
        .av__body {float:left} .av__row {display:flex;position:relative;font:14px/23.75px sans-serif;border-bottom:1px solid gray}
        .av__cell {box-sizing:border-box;padding:5px 8px;flex-shrink:0;border-right:1px solid gray;overflow:hidden}
        .av__colsticky {display:flex;position:sticky;left:0;flex-shrink:0;background:white;z-index:1}
        .av__firstcol {width:32px;flex-shrink:0} .av__body--unfreeze .av__colsticky--freeze {position:static}
        .av__cell[data-wrap=false] {white-space:nowrap} .av__celltext {white-space:normal;overflow-wrap:anywhere}
        .fn__none {display:none}` + sources.spacerStyle;
    document.head.append(style);
    const close = (actual, expected, message) => check.ok(Math.abs(actual - expected) < 0.1,
        `${message}: ${actual} != ${expected}`);
    const create = ({rowCount = 60, columnCount = 35, groups = 1, pinned = 0, content} = {}) => {
        const header = `<div class="av__row av__row--header"><div class="av__colsticky${pinned ? " av__colsticky--freeze" : ""}"><div class="av__firstcol"></div>` +
            (pinned ? "" : "</div>") + Array.from({length: columnCount}, (_, column) =>
                `<div class="av__cell av__cell--header" data-col-id="c${column}" style="width:${120 + column % 3 * 0.25}px">Header ${column}</div>${column + 1 === pinned ? "</div>" : ""}`).join("") + "<div></div></div>";
        document.body.innerHTML = '<div class="av" data-av-type="table"><div class="av__scroll">' +
            Array.from({length: groups}, (_, group) => `<div class="av__body" data-group-id="g${group}">${header}` +
                Array.from({length: rowCount}, (_, row) => `<div class="av__row" data-id="r${row}" data-index="${row}"><div class="av__colsticky${pinned ? " av__colsticky--freeze" : ""}"><div class="av__firstcol"></div>` +
                    (pinned ? "" : "</div>") + Array.from({length: columnCount}, (_, column) =>
                        `<div class="av__cell" data-col-id="c${column}" data-wrap="${row % 2 === 0}" style="width:${120 + column % 3 * 0.25}px">${content?.(row, column, group) || `Value ${row},${column}`}</div>${column + 1 === pinned ? "</div>" : ""}`).join("") + "<div></div></div>").join("") +
                `<div class="av__row--footer">Footer ${group}</div></div>`).join("") + "</div></div>";
        return document.querySelector(".av");
    };

    for (const [rowCount, columnCount, pinned, groups] of [[60, 35, 0, 1], [100, 22, 2, 1], [12, 35, 1, 3]]) {
        const block = create({rowCount, columnCount, pinned, groups, content: (row, column) =>
            column === columnCount - 2 && row < 2 ? `<span class="av__celltext">${"Long wrapping content ".repeat(35)}</span>` : ""});
        const scroll = block.querySelector(".av__scroll");
        const rows = [...block.querySelectorAll(".av__row[data-id]")];
        const heights = rows.map(row => row.getBoundingClientRect().height);
        const width = scroll.scrollWidth;
        const totalHeight = scroll.scrollHeight;
        const far = rows[0].querySelector(`[data-col-id="c${columnCount - 2}"]`);
        const frozen = rows[0].firstElementChild;
        const measured = [];
        const controller = new AVColumnVirtualScroll(block, {onRowHeight: (row, height) => measured.push([row, height])});
        check.ok(heights[0] > 500);
        check.ok(heights[1] > 500, "nowrap cells with wrapping descendants are not fixed-height rows");
        controller.update();
        check.ok(block.querySelectorAll(".av__row[data-id] .av__cell").length < rowCount * groups * columnCount / 2,
            "both fixture sizes remove actual offscreen cells");
        check.equal(far.isConnected, false);
        check.equal(frozen.isConnected, true);
        check.equal(block.querySelectorAll(".av__cell--header").length, groups * columnCount);
        rows.forEach((row, index) => close(row.getBoundingClientRect().height, heights[index], "individual row height"));
        close(scroll.scrollWidth, width, "full width");
        close(scroll.scrollHeight, totalHeight, "full height");
        for (const left of [width, width / 2, 0, width, 0]) {
            scroll.scrollLeft = left;
            controller.update();
            rows.forEach((row, index) => close(row.getBoundingClientRect().height, heights[index], "height after horizontal scroll"));
            close(scroll.scrollWidth, width, "width after horizontal scroll");
            close(scroll.scrollHeight, totalHeight, "height after horizontal scroll");
            check.equal(rows[0].firstElementChild, frozen);
            for (let column = 0; column < pinned; column++) {
                check.ok(frozen.querySelector(`[data-col-id="c${column}"]`), "all frozen cells remain mounted");
            }
        }
        controller.ensureColumn(`c${columnCount - 2}`, "r0", "g0");
        check.equal(rows[0].querySelector(`[data-col-id="c${columnCount - 2}"]`), far, "materialization preserves cell identity");
        far.classList.add("av__cell--select");
        controller.update();
        check.equal(rows[0].querySelectorAll(".av__cell").length, columnCount, "selected row keeps sibling navigation");
        far.classList.remove("av__cell--select");
        controller.setSuspended(true);
        check.equal(block.querySelectorAll(".av__row[data-id] .av__cell").length, rowCount * groups * columnCount);
        rows.forEach(row => check.equal(row.style.minHeight, ""));
        controller.update();
        check.equal(far.isConnected, true, "suspended interactions cannot lose their cell targets");
        controller.setSuspended(false);
        await settle();
        check.equal(far.isConnected, false);
        controller.dispose();
        check.equal(far.isConnected, true);
        rows.forEach(row => check.equal(row.style.minHeight, ""));
        check.ok(measured.length >= rows.length);
    }

    {
        const block = create({rowCount: 3, content: (row, column) => column === 33 ?
            `<span>${"Long content ".repeat(45)}</span>` : ""});
        const row = block.querySelector(".av__row[data-id]");
        const hidden = row.querySelector('[data-col-id="c33"]');
        row.style.setProperty("min-height", "45px", "important");
        const controller = new AVColumnVirtualScroll(block);
        controller.update();
        const tall = row.getBoundingClientRect().height;
        hidden.textContent = "Short";
        await settle();
        close(row.getBoundingClientRect().height, 46, "detached async text shrink invalidates measured height");
        check.ok(tall > 100);
        controller.invalidate();
        check.equal(row.style.minHeight, "45px");
        check.equal(row.style.getPropertyPriority("min-height"), "important");
        hidden.textContent = "Longer content ".repeat(70);
        row.style.fontSize = "20px";
        controller.update();
        check.ok(row.getBoundingClientRect().height > tall, "font and content invalidation can grow natural height");
        controller.dispose();
    }

    for (const content of ["<img src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'>",
        "<video></video>", "<canvas></canvas>", "<input value='draft'>", "<span data-render-template='true'>Custom</span>",
        "<span data-render-template='{{.title}}'>Template value</span>",
        "<span class='av__celltext--template'>Rendered template</span>",
        "<span data-subtype='math'>Equation</span>", "<pre><code>Code</code></pre>"]) {
        const block = create({rowCount: 1, content: (_row, column) => column === 33 ? content : ""});
        const controller = new AVColumnVirtualScroll(block);
        controller.update();
        check.equal(block.querySelectorAll(".av__row[data-id] .av__cell").length, 35,
            "unstable media and custom content retain natural geometry");
        const media = block.querySelector("img, video, canvas");
        if (media) {
            media.style.height = "450px";
            check.ok(block.querySelector(".av__row[data-id]").getBoundingClientRect().height > 450,
                "asynchronous media growth keeps the complete natural row height");
        }
        controller.dispose();
    }

    {
        const block = create({rowCount: 3, pinned: 2, content: (_row, column) => column === 33 ?
            "Scaled content ".repeat(60) : ""});
        block.style.zoom = "1.25";
        const row = block.querySelector(".av__row[data-id]");
        const height = row.getBoundingClientRect().height;
        const widths = block.querySelector(".av__scroll").scrollWidth;
        const controller = new AVColumnVirtualScroll(block, {onRowHeight: (element, measured) =>
            close(measured, element.getBoundingClientRect().height, "row cache receives viewport-space measurements")});
        controller.update();
        close(row.getBoundingClientRect().height, height, "CSS zoom preserves natural height");
        close(block.querySelector(".av__scroll").scrollWidth, widths, "CSS zoom preserves width");
        controller.dispose();
        row.style.columnGap = "3px";
        const fallback = new AVColumnVirtualScroll(block);
        fallback.update();
        check.equal(row.querySelectorAll(".av__cell").length, 35, "unsupported custom column gaps remain mounted");
        fallback.dispose();
    }

    for (const boxSizing of ["content-box", "border-box"]) {
        const block = create({rowCount: 2, content: (_row, column) => column === 33 ? "Wrapped text ".repeat(60) : ""});
        const row = block.querySelector(".av__row[data-id]");
        row.style.boxSizing = boxSizing;
        row.style.paddingTop = "11px";
        row.style.paddingBottom = "13px";
        const originalHeight = row.getBoundingClientRect().height;
        const controller = new AVColumnVirtualScroll(block);
        controller.update();
        check.ok(row.querySelectorAll(".av__cell").length < 35);
        close(row.getBoundingClientRect().height, originalHeight, `${boxSizing} with vertical padding retains height`);
        controller.dispose();
        check.equal(row.style.minHeight, "");
        close(row.getBoundingClientRect().height, originalHeight, `${boxSizing} disposal restores natural height`);
    }

    {
        const block = create({rowCount: 2, pinned: 2});
        const row = block.querySelector(".av__row[data-id]");
        const cell = row.querySelector('[data-col-id="c2"]');
        const range = document.createRange();
        range.selectNodeContents(cell);
        document.getSelection().addRange(range);
        const controller = new AVColumnVirtualScroll(block);
        controller.update();
        check.equal(row.querySelectorAll(".av__cell").length, 35, "native text selections are not detached");
        document.getSelection().removeAllRanges();
        controller.update();
        const parent = row.parentElement;
        const next = row.nextElementSibling;
        row.remove();
        controller.update();
        check.equal(row.querySelectorAll(".av__cell").length, 35, "row-window removal returns a complete reusable row");
        check.equal(row.style.minHeight, "");
        parent.insertBefore(row, next);
        controller.update();
        row.outerHTML = '<div class="av__row" data-id="r0"><div class="av__colsticky"></div><div>Replacement</div></div>';
        await settle();
        check.equal(block.querySelector('[data-id="r0"]').textContent, "Replacement", "rerenders cannot resurrect cached cells");
        controller.dispose();
    }

    {
        const {initAVColumnWindow, prepareAVColumnWindow, ensureAVColumnWindow, updateAVColumnWindow,
            disposeAVColumnWindow, suspendAVColumnWindows} = lifecycle;
        const block = create({rowCount: 5, content: (_row, column) => column === 33 ? "Content ".repeat(80) : ""});
        const scroll = block.querySelector(".av__scroll");
        const row = block.querySelector(".av__row[data-id]");
        const far = row.querySelector('[data-col-id="c33"]');
        const fullCount = 5 * 35;
        const count = () => block.querySelectorAll(".av__row[data-id] .av__cell").length;
        let fontListeners = 0;
        const addFontListener = document.fonts.addEventListener.bind(document.fonts);
        const removeFontListener = document.fonts.removeEventListener.bind(document.fonts);
        document.fonts.addEventListener = (...arguments_) => {
            fontListeners++;
            return addFontListener(...arguments_);
        };
        document.fonts.removeEventListener = (...arguments_) => {
            fontListeners--;
            return removeFontListener(...arguments_);
        };
        try {
            initAVColumnWindow(block, {enabled: false});
            check.equal(count(), fullCount, "caller threshold disables small tables");
            initAVColumnWindow(block, {enabled: true});
            check.ok(count() < fullCount);
            check.equal(fontListeners, 3);
            initAVColumnWindow(block, {enabled: true});
            check.equal(fontListeners, 3, "reinitialization disposes old font listeners");
            scroll.scrollLeft = scroll.scrollWidth;
            scroll.dispatchEvent(new Event("scroll"));
            await settle();
            check.equal(far.isConnected, true, "horizontal scroll events mount newly visible columns");
            scroll.scrollLeft = 0;
            scroll.dispatchEvent(new Event("scroll"));
            await settle();
            check.equal(far.isConnected, false);
            const beforeResize = count();
            scroll.style.width = "360px";
            window.dispatchEvent(new Event("resize"));
            await settle();
            check.ok(count() < beforeResize, "viewport resize updates the mounted column window");
            scroll.style.width = "640px";
            window.dispatchEvent(new Event("resize"));
            await settle();
            prepareAVColumnWindow(block);
            check.equal(count(), fullCount, "legacy DOM queries see the complete row synchronously");
            check.equal(row.style.minHeight, "");
            await settle();
            check.ok(count() < fullCount);
            ensureAVColumnWindow(block, "c33", "r0", "g0");
            check.equal(far.isConnected, true);
            await settle();
            check.equal(far.isConnected, false);

            const releaseOuter = suspendAVColumnWindows(document.body);
            const releaseInner = suspendAVColumnWindows(block);
            check.equal(count(), fullCount);
            initAVColumnWindow(block, {enabled: true});
            check.equal(count(), fullCount, "reinitialized exports inherit active suspension scopes");
            releaseInner();
            releaseInner();
            await settle();
            check.equal(count(), fullCount, "one release cannot end another suspension");
            releaseOuter();
            await settle();
            check.ok(count() < fullCount);

            const oldHeight = row.getBoundingClientRect().height;
            document.body.style.fontSize = "20px";
            await settle();
            check.equal(fontListeners, 3);
            const sheet = document.createElement("style");
            sheet.textContent = ".av__row {line-height:12px}";
            document.head.append(sheet);
            await settle();
            check.ok(row.getBoundingClientRect().height < oldHeight, "head stylesheet changes invalidate cached row heights");
            sheet.textContent = ".av__row {line-height:25px}";
            await settle();
            check.ok(row.getBoundingClientRect().height > oldHeight, "stylesheet text changes remeasure full rows");
            sheet.remove();
            await settle();

            prepareAVColumnWindow(block);
            block.querySelectorAll('[data-col-id="c33"]').forEach(cell => cell.style.width = "240px");
            updateAVColumnWindow(block);
            check.ok(row.getBoundingClientRect().height < oldHeight, "width changes remeasure the offscreen longest column");
            block.remove();
            await settle();
            check.equal(fontListeners, 0, "removing a block releases its global font callbacks");
            document.body.append(block);
            scroll.dispatchEvent(new Event("scroll"));
            await settle();
            check.equal(count(), fullCount, "disposed listeners cannot revive an old window");
            initAVColumnWindow(block, {enabled: true});
            check.equal(fontListeners, 3);
            block.innerHTML = '<div class="av__scroll">Replacement view</div>';
            await settle();
            check.equal(fontListeners, 0, "replacing the scroller releases the previous lifecycle");
            disposeAVColumnWindow(block);
        } finally {
            disposeAVColumnWindow(block);
            document.fonts.addEventListener = addFontListener;
            document.fonts.removeEventListener = removeFontListener;
            document.body.style.removeProperty("font-size");
        }
    }
    return "Database column virtual scrolling passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv.at(-1));
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const ts = require("typescript");
    const transpile = file => ts.transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const sources = {core: transpile("../src/protyle/render/av/columnVirtualScroll.ts"),
        lifecycle: transpile("../src/protyle/render/av/columnWindow.ts")};
    const spacerRule = readFileSync(path.join(__dirname, "../src/assets/scss/business/_av.scss"), "utf8")
        .match(/&__column-spacer\s*\{([^}]+)\}/);
    assert.ok(spacerRule, "Column spacers use the product's static CSS rule");
    sources.spacerStyle = `.av__column-spacer {${spacerRule[1]}}`;
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        assert.equal(await win.webContents.executeJavaScript(`(async () => {
            try { return await (${browserCases.toString()})(${JSON.stringify(sources)}); }
            catch (error) { return error.stack; }
        })()`), "Database column virtual scrolling passed");
        console.log("Database column virtual scrolling passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("column virtualization preserves frozen cells, variable heights, identity and invalidation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-column-virtual-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Database column virtual scrolling passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-column-virtual-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
