const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = async () => {
    const assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const lute = window.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const container = document.createElement("div");
    container.className = "protyle rtl";
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    container.append(root);
    document.body.append(container);
    root.innerHTML = lute.Md2BlockDOM("# عنوان English\n\nسلام world\n\nEnglish سلام\n\n- שלום world\n\n```\nسلام\n```\n");
    const original = root.innerHTML;
    const markdown = lute.BlockDOM2StdMd(original);
    const {destroyAutoDirection, setAutoDirection} = window.direction;
    const text = element => element.querySelector("[contenteditable]");
    const heading = text(root.querySelector('[data-type="NodeHeading"]'));
    const paragraphs = root.querySelectorAll('[data-type="NodeParagraph"]');
    const persian = text(paragraphs[0]);
    const english = text(paragraphs[1]);
    const hebrew = text(paragraphs[2]);
    const direction = element => getComputedStyle(element).direction;
    const {setTitleAutoDirection} = window.direction;
    const title = document.createElement("div");
    title.className = "protyle-title__input";
    title.contentEditable = "true";
    container.prepend(title);
    setTitleAutoDirection(undefined, true);
    for (const globalRTL of [false, true]) {
        container.classList.toggle("rtl", globalRTL);
        title.textContent = "English";
        setTitleAutoDirection(title, false);
        assert.equal(direction(title), globalRTL ? "rtl" : "ltr");
        setTitleAutoDirection(title, true);
        assert.equal(direction(title), "ltr");
        const titleText = title.firstChild;
        title.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        titleText.data = "123 😀 عنوان English";
        assert.equal(direction(title), "rtl");
        titleText.data = "English عنوان";
        assert.equal(direction(title), "ltr");
        title.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        title.textContent = "";
        title.textContent = "שלום";
        assert.equal(direction(title), "rtl");
        setTitleAutoDirection(title, false);
        assert.equal(title.hasAttribute("dir"), false);
        assert.equal(direction(title), globalRTL ? "rtl" : "ltr");
        assert.equal(title.textContent, "שלום");
    }
    title.dir = "ltr";
    setTitleAutoDirection(title, true);
    assert.equal(direction(title), "ltr");
    setTitleAutoDirection(title, false);
    assert.equal(title.dir, "ltr");
    const mobileTitle = document.createElement("input");
    mobileTitle.id = "toolbarName";
    document.body.append(mobileTitle);
    setTitleAutoDirection(mobileTitle, true);
    mobileTitle.value = "عنوان";
    assert.equal(direction(mobileTitle), "rtl");
    mobileTitle.value = "English عنوان";
    assert.equal(direction(mobileTitle), "ltr");
    setTitleAutoDirection(mobileTitle, false);
    assert.equal(mobileTitle.hasAttribute("dir"), false);
    assert.equal(mobileTitle.value, "English عنوان");
    setAutoDirection(root, false);
    assert.equal(root.innerHTML, original);
    assert.equal(direction(english), "rtl");
    setAutoDirection(root, true);
    assert.equal(direction(heading), "rtl");
    assert.equal(direction(persian), "rtl");
    assert.equal(direction(english), "ltr");
    assert.equal(direction(hebrew), "rtl");
    assert.equal(root.querySelector('[data-type="NodeCodeBlock"] [dir]'), null);
    assert.equal(root.querySelector(".protyle-attr[dir]"), null);
    assert.equal(root.querySelector('[data-type="NodeListItem"]').dir, "rtl");
    assert.equal(lute.BlockDOM2StdMd(root.innerHTML), markdown, "automatic direction must not change stored content");
    assert.doesNotMatch(lute.SpinBlockDOM(root.innerHTML), /data-auto-direction|dir="auto"/);

    const range = document.createRange();
    range.setStart(persian.firstChild, 2);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    persian.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    persian.firstChild.data = "English سلام";
    assert.equal(direction(persian), "ltr");
    assert.equal(getSelection().anchorNode, persian.firstChild);
    persian.firstChild.data = "123 😀 (سلام world)";
    assert.equal(direction(persian), "rtl");
    persian.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    persian.textContent = "https://example.com سلام";
    assert.equal(direction(persian), "ltr");
    persian.textContent = "";
    assert.equal(persian.dir, "auto");
    persian.innerHTML = '<span data-type="text" style="direction: rtl; unicode-bidi: isolate">שלום</span>English';
    assert.equal(direction(persian.querySelector("span")), "rtl");

    english.parentElement.style.direction = "rtl";
    await settle();
    assert.equal(english.dir, "rtl");
    assert.equal(direction(english), "rtl");
    assert.doesNotMatch(lute.SpinBlockDOM(root.innerHTML), /data-auto-direction|dir="rtl"/);
    english.parentElement.style.direction = "ltr";
    await settle();
    assert.equal(direction(english), "ltr");
    english.parentElement.style.direction = "";
    await settle();
    assert.equal(english.dir, "auto");
    const list = hebrew.closest('[data-type="NodeList"]');
    list.style.direction = "ltr";
    await settle();
    assert.equal(hebrew.dir, "ltr");
    assert.equal(direction(hebrew), "ltr");
    list.style.direction = "";
    await settle();
    assert.equal(direction(hebrew), "rtl");

    root.innerHTML = original;
    await settle();
    assert.equal(direction(text(root.querySelectorAll('[data-type="NodeParagraph"]')[1])), "ltr");
    const appended = document.createElement("div");
    appended.innerHTML = lute.Md2BlockDOM("مرحبا English\n");
    root.append(appended);
    await settle();
    assert.equal(direction(text(appended)), "rtl");
    const cached = appended.innerHTML;
    appended.remove();
    await settle();
    assert.equal(appended.querySelector("[data-auto-direction]"), null);
    setAutoDirection(root, false);
    assert.equal(root.querySelector("[dir=auto]"), null);
    root.insertAdjacentHTML("beforeend", cached);
    await settle();
    assert.equal(root.querySelector("[data-auto-direction]"), null);
    root.append(appended);
    appended.innerHTML = lute.Md2BlockDOM("English\n");
    await settle();
    assert.equal(appended.querySelector("[dir]"), null);

    // 预览及标准 HTML 导出与编辑器共用规则，显式对齐和方向保持不变。
    root.innerHTML = '<h2>שלום</h2><p>سلام English</p><p style="text-align:center">English سلام</p>' +
        '<blockquote style="direction:ltr"><p>سلام</p></blockquote>' +
        "<pre><code>سلام</code></pre><table><tbody><tr><td><p>שלום</p></td><td>English</td></tr></tbody></table>";
    setAutoDirection(root, true);
    assert.equal(direction(root.querySelector("h2")), "rtl");
    assert.equal(direction(root.querySelector("p")), "rtl");
    assert.equal(getComputedStyle(root.querySelector('[style="text-align:center"]')).textAlign, "center");
    assert.equal(direction(root.querySelector("blockquote p")), "ltr");
    assert.equal(root.querySelector("pre [dir]"), null);
    assert.equal(root.querySelector("table").hasAttribute("dir"), false);
    assert.equal(direction(root.querySelector("td p")), "rtl");
    destroyAutoDirection(root);
    assert.equal(root.querySelector("[data-auto-direction]"), null);
};

const runListCases = async () => {
    const assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const {setAutoDirection, destroyAutoDirection, getAutoListDirection} = window.direction;
    const lute = window.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    document.body.innerHTML = '<div class="protyle"><div class="protyle-wysiwyg"></div></div>';
    const container = document.querySelector(".protyle");
    const root = container.firstElementChild;
    const markdown = "- [ ] سلام task\n  - [ ] English child\n  - [ ] שלום child\n- [ ] English task\n\n" +
        "1. عنوان numbered\n2. English numbered\n\n- שלום bullet\n- English bullet\n";
    const original = lute.Md2BlockDOM(markdown);
    const expectedMarkdown = lute.BlockDOM2StdMd(original);
    const items = () => [...root.querySelectorAll('[data-type="NodeListItem"]')];
    const content = item => item.querySelector(':scope > [data-type="NodeParagraph"]');
    const editable = item => content(item).querySelector("[contenteditable]");
    const check = (item, direction) => {
        assert.equal(getComputedStyle(item).direction, direction, editable(item).textContent);
        const action = item.querySelector(":scope > .protyle-action");
        const itemRect = item.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        assert.ok(Math.abs(direction === "rtl" ? actionRect.right - itemRect.right :
            actionRect.left - itemRect.left) < 1, `marker ${direction}: ${editable(item).textContent}`);
        const style = getComputedStyle(content(item));
        assert.equal(style.marginLeft, direction === "rtl" ? "0px" : "34px");
        assert.equal(style.marginRight, direction === "rtl" ? "34px" : "0px");
        assert.equal(getAutoListDirection(action), direction);
    };
    for (const rtl of [false, true]) {
        container.classList.toggle("rtl", rtl);
        root.innerHTML = original;
        setAutoDirection(root, true);
        for (const [width, fontSize] of [[640, 16], [260, 28]]) {
            root.style.width = `${width}px`;
            root.style.fontSize = `${fontSize}px`;
            items().forEach((item, index) => check(item, ["rtl", "ltr", "rtl", "ltr", "rtl", "ltr", "rtl", "ltr"][index]));
        }
        assert.equal(lute.BlockDOM2StdMd(root.innerHTML), expectedMarkdown);
        assert.doesNotMatch(lute.SpinBlockDOM(root.innerHTML), /data-auto-(?:list-)?direction|dir="(?:auto|ltr|rtl)"/);

        const [parent, child, sibling] = items();
        editable(parent).firstChild.data = "English parent";
        await settle();
        check(parent, "ltr");
        check(child, "ltr");
        check(sibling, "rtl");
        editable(child).textContent = "123 😀 مرحبا";
        await settle();
        check(child, "rtl");
        check(parent, "ltr");
        editable(parent).textContent = "سلام parent";
        editable(child).textContent = "English child";
        await settle();
        const drag = window.listDrag.createListDragTarget();
        let rect = child.getBoundingClientRect();
        const childTarget = drag(child, {clientX: rect.left + 60, clientY: rect.bottom - 1});
        assert.equal(childTarget.isChild, true);
        childTarget.apply();
        assert.ok(parseFloat(child.style.getPropertyValue("--drag-guides")) > 0,
            "LTR child keeps its RTL parent's guide on the right");
        assert.equal(getComputedStyle(child, "::after").left, "34px");
        window.listDrag.cleanupDragIndicators(root);
        editable(child).firstChild.data = "שלום child";
        await settle();
        rect = child.getBoundingClientRect();
        const rtlChildTarget = drag(child, {clientX: rect.right - 60, clientY: rect.bottom - 1});
        assert.equal(rtlChildTarget.isChild, true);
        rtlChildTarget.apply();
        assert.equal(getComputedStyle(child, "::after").right, "34px");
        window.listDrag.cleanupDragIndicators(root);
        assert.equal(drag(child, {clientX: rect.right - 5, clientY: rect.bottom - 1}).isChild, false);

        parent.style.direction = "ltr";
        await settle();
        check(parent, "ltr");
        check(child, "ltr");
        sibling.style.direction = "rtl";
        await settle();
        check(sibling, "rtl");
        parent.style.direction = "";
        sibling.style.direction = "";
        await settle();
        check(parent, "rtl");
        const list = parent.parentElement;
        list.style.direction = "rtl";
        child.style.direction = "ltr";
        await settle();
        check(child, "ltr");
        check(items()[3], "rtl");
        list.style.direction = "";
        child.style.direction = "";
        content(parent).style.direction = "ltr";
        await settle();
        check(parent, "ltr");
        content(parent).style.direction = "";

        root.innerHTML = original;
        await settle();
        check(items()[0], "rtl");
        check(items()[1], "ltr");
        root.insertAdjacentHTML("beforeend", lute.Md2BlockDOM("- [ ] مرحبا new\n"));
        await settle();
        check(items().at(-1), "rtl");
        setAutoDirection(root, false);
        assert.equal(root.querySelector("[data-auto-direction]"), null);
        assert.equal(root.querySelector("[data-auto-list-direction]"), null);
        assert.equal(root.querySelector("[dir]"), null);
        const first = items()[0];
        const box = first.getBoundingClientRect();
        const marker = first.querySelector(".protyle-action").getBoundingClientRect();
        assert.ok(Math.abs(rtl ? marker.right - box.right : marker.left - box.left) < 1);
        first.style.direction = "rtl";
        const manualMarker = first.querySelector(".protyle-action").getBoundingClientRect();
        assert.ok(Math.abs(manualMarker.right - box.right) < 1);
        setAutoDirection(root, true);
        setAutoDirection(root, false);
        assert.equal(first.style.direction, "rtl");
    }
    destroyAutoDirection(root);
    const preview = document.createElement("div");
    preview.className = "b3-typography";
    preview.innerHTML = "<ul><li><p>سلام</p><ul><li>English child</li></ul></li><li>English</li></ul>";
    document.body.append(preview);
    setAutoDirection(preview, true);
    const nativeItems = preview.querySelectorAll("li");
    assert.equal(getComputedStyle(nativeItems[0]).direction, "rtl");
    assert.equal(getComputedStyle(nativeItems[1]).direction, "ltr");
    assert.equal(getComputedStyle(nativeItems[2]).direction, "ltr");
    assert.equal(getComputedStyle(nativeItems[0]).marginLeft, "0px");
    assert.equal(getComputedStyle(nativeItems[2]).marginRight, "0px");
    setAutoDirection(preview, false);
    assert.equal(preview.querySelector("[data-auto-direction]"), null);
    destroyAutoDirection(preview);
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const source = readFileSync(path.join(__dirname, "../src/protyle/render/autoDirection.ts"), "utf8");
        const compiled = ts.transpileModule(source, {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("sass").compile(
            path.join(__dirname, "../src/assets/scss/protyle/_content.scss")).css);
        await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8"));
        await win.webContents.executeJavaScript(`(() => {
            const exports = {};
            ${compiled}
            window.direction = exports;
        })()`);
        await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        for (const file of ["protyle/_wysiwyg.scss", "component/_typography.scss"]) {
            await win.webContents.insertCSS(require("sass").compile(path.join(__dirname, "../src/assets/scss", file)).css);
        }
        const dragSource = ts.transpileModule(readFileSync(path.join(__dirname, "../src/protyle/util/listDragTarget.ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText;
        await win.webContents.executeJavaScript(`(() => {const exports = {}; ${dragSource}; window.listDrag = exports;})()`);
        await win.webContents.executeJavaScript(`(${runListCases.toString()})()`);
        console.log("Automatic direction cases passed");
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
    require("node:test").it("detects text direction while preserving manual settings, content and structural layout", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-auto-direction-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Automatic direction cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-auto-direction-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
