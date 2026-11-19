import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {test} from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (source: string, css: string) => {
    const exports = {} as typeof import("./resultSnippet");
    new Function("exports", source)(exports);
    const check = (condition: boolean, message: string) => {
        if (!condition) {
            throw new Error(message);
        }
    };
    const style = document.createElement("style");
    style.textContent = css + "\n.fixture { font: 24px Arial; width: 320px; }";
    document.head.append(style);
    const list = document.createElement("div");
    list.className = "b3-list fixture";
    const longPrefix = "1".repeat(360);
    list.innerHTML = `
        <div class="b3-list-item" data-type="search-item"><span id="long" class="b3-list-item__text">${longPrefix}<mark>哈哈哈</mark>后文<mark>第二处</mark></span></div>
        <div class="b3-list-item" data-type="search-item"><span id="short" class="b3-list-item__text">前文 <mark>哈哈哈</mark>${longPrefix}</span></div>
        <div class="b3-list-item" data-type="search-item"><span id="edge" class="b3-list-item__text">${"1".repeat(12)}<mark>哈哈哈</mark>${longPrefix}</span></div>
        <div class="b3-list-item" data-type="search-item"><span id="combining" class="b3-list-item__text">${"e\u0301".repeat(400)}<mark>哈哈哈</mark></span></div>
        <div class="b3-list-item" data-type="search-item"><span id="multiple" class="b3-list-item__text search__av-content">${longPrefix}<mark>哈哈哈</mark></span></div>
        <div id="group" class="fn__none"><div class="b3-list-item" data-type="search-item"><span class="b3-list-item__text">${longPrefix}<mark>哈哈哈</mark></span></div></div>`;
    document.body.append(list);
    const long = list.querySelector<HTMLElement>("#long");
    const short = list.querySelector<HTMLElement>("#short");
    const edge = list.querySelector<HTMLElement>("#edge");
    const edgeMark = edge.querySelector("mark");
    const combining = list.querySelector<HTMLElement>("#combining");
    const multi = list.querySelector<HTMLElement>("#multiple");
    const group = list.querySelector<HTMLElement>("#group");
    const grouped = group.querySelector(".b3-list-item__text");
    const marks = Array.from(long.querySelectorAll("mark"));
    const firstMatchOnFirstLine = (snippet: Element) => snippet.querySelector("mark").getBoundingClientRect().bottom <= snippet.getBoundingClientRect().bottom;
    const nextLayout = () => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const edgeWidth = edgeMark.getBoundingClientRect().right - edge.getBoundingClientRect().left;
    edge.style.maxWidth = `${Math.ceil(edgeWidth) + 2}px`;
    check(firstMatchOnFirstLine(edge), "the boundary match should wrap only after the mark");
    check(!firstMatchOnFirstLine(long), "the unmodified long result should hide the first match");
    exports.observeSearchResultSnippets(list);
    await nextLayout();
    check(firstMatchOnFirstLine(long) && long.textContent.startsWith("..."), "the narrow list should show the match and a shortened prefix");
    check(short.firstChild.textContent === "前文 ", "the already-visible match should retain its prefix");
    check(firstMatchOnFirstLine(edge) && edge.getBoundingClientRect().right - edgeMark.getBoundingClientRect().right >= 24,
        "the trailing ellipsis should have room beyond the match");
    check(/^\.\.\.(?:e\u0301)+$/.test(combining.firstChild.textContent), "trimming should keep combined characters intact");
    check(multi.firstChild.textContent === longPrefix, "database results should retain their multiline preview");
    check(marks.every((mark, index) => mark === long.querySelectorAll("mark")[index]) && marks[1].textContent === "第二处",
        "opening a result should still be able to read every original match");
    check(grouped.firstChild.textContent === longPrefix, "collapsed groups should wait for a measurable width");
    group.classList.remove("fn__none");
    await nextLayout();
    check(grouped.textContent.startsWith("..."), "expanding a group should reveal the match");
    const groupedNarrowPrefix = grouped.firstChild.textContent;

    list.style.width = "1600px";
    await nextLayout();
    const groupedWidePrefix = grouped.firstChild.textContent;
    check(firstMatchOnFirstLine(grouped) && groupedWidePrefix.startsWith("...") && groupedWidePrefix.length > 100 &&
        groupedWidePrefix.length > groupedNarrowPrefix.length, "a wide row should keep much more prefix while showing the match");
    const rowWithOneMoreCharacter = grouped.parentElement.cloneNode(true) as HTMLElement;
    grouped.parentElement.after(rowWithOneMoreCharacter);
    const longerSnippet = rowWithOneMoreCharacter.firstElementChild;
    longerSnippet.firstChild.textContent = "...1" + groupedWidePrefix.slice(3);
    check(!firstMatchOnFirstLine(longerSnippet), "the chosen prefix should fit as many characters as the actual row allows");
    rowWithOneMoreCharacter.remove();

    list.style.width = "6000px";
    await nextLayout();
    check(firstMatchOnFirstLine(long) && long.firstChild.textContent === longPrefix, "widening the list should restore the full prefix");
    list.style.width = "108px";
    await nextLayout();
    check(firstMatchOnFirstLine(grouped) && grouped.firstChild.textContent === "", "a very narrow row should prioritize the first match over the leading ellipsis");

    long.style.webkitLineClamp = "2";
    await nextLayout();
    check(long.firstChild.textContent === longPrefix, "a multiline theme should retain the full available prefix");
};

test("single-line search results reveal clipped matches and adapt to list width", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(join(__dirname, "resultSnippet.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const css = compile(join(__dirname, "../assets/scss/base.scss"), {logger: {warn() {}}}).css;
    const expression = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`;
    const temporary = mkdtempSync(join(tmpdir(), "siyuan-search-snippet-"));
    try {
        const script = join(temporary, "run.cjs");
        writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.executeJavaScript(${JSON.stringify(expression)});
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        await promisify(execFile)(require("electron"), [script], {env, timeout: 40000, windowsHide: true});
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
