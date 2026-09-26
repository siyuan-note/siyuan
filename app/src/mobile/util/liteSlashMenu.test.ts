import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, hintSource: string, keyboardSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {mount, render, paddingElement} = new Function(source + hintSource +
        "\nreturn {mount: mountLiteSlashMenu, render: Hint.prototype.getHTMLByData, paddingElement: getMobileToolbarPaddingElement};")() as {
        mount: typeof import("./liteSlashMenu").mountLiteSlashMenu,
        render: (data: IHintData[]) => string,
        paddingElement: typeof import("../../protyle/lite/mobileToolbar").getMobileToolbarPaddingElement,
    };
    window.siyuan = {languages: {emptyContent: "Empty"}} as unknown as typeof window.siyuan;
    const element = document.createElement("div");
    element.className = "protyle-hint fn__none";
    document.body.appendChild(element);
    const next = document.createElement("div");
    document.body.appendChild(next);
    const panel = document.createElement("div");
    panel.className = "keyboard__util";
    const toolbar = document.createElement("div");
    toolbar.id = "keyboardToolbar";
    toolbar.className = "keyboard";
    toolbar.style.height = "500px";
    toolbar.appendChild(panel);
    document.body.appendChild(toolbar);
    let finishRequest: () => void;
    const hint = {
        element,
        source: "hint",
        enableExtend: false,
        genHTML: (items: IHintData[]) => {
            element.innerHTML = render.call(hint, items);
            element.classList.remove("fn__none");
        },
    };
    const itemHTML = (name: string) => '<div class="b3-list-item__first">' +
        '<svg class="b3-list-item__graphic"><use xlink:href="#iconCode"></use></svg>' +
        `<span class="b3-list-item__text">${name}</span><span class="b3-list-item__meta">Markdown</span>` +
        '<span class="b3-menu__accelerator">Ctrl+K</span></div>';
    const items: IHintData[] = [{value: "```", html: itemHTML("代码块")},
        {value: "$$", html: itemHTML("公式块"), focus: false},
        {value: "", html: "separator"}, {value: "", html: "separator"},
        {value: "upload", html: itemHTML("插入图片或文件") + '<input class="b3-form__upload" type="file" data-upload-mode="html-iframe">'},
        {value: "", html: "separator"}];
    const provider = {key: "/", hint: (): IHintData[] => items};
    const protyle = {hint, options: {hint: {extend: [provider]}}} as unknown as IProtyle;
    let unmount = mount(protyle, panel);
    check.equal(panel.querySelectorAll("button.keyboard__slash-item[data-value]").length, 3);
    check.equal(panel.querySelectorAll(".keyboard__slash-block").length, 2);
    check.equal(panel.querySelector(".b3-list-item, .b3-menu__accelerator, .b3-list-item__meta"), null);
    check.equal(panel.querySelector(".keyboard__slash-icon use").getAttribute("xlink:href"), "#iconCode");
    check.equal(panel.querySelectorAll('input[type="file"][data-upload-mode="html-iframe"]').length, 1);
    check.equal(panel.querySelector('[data-value="%24%24"]').getAttribute("data-focus"), "false");
    for (const width of [320, 390, 768]) {
        toolbar.style.width = `${width}px`;
        const buttons = panel.querySelectorAll<HTMLElement>("button");
        const first = buttons[0].getBoundingClientRect();
        const second = buttons[1].getBoundingClientRect();
        check.equal(first.top, second.top);
        check.ok(second.left > first.right);
        check.ok(first.width < width / 2);
        check.ok(first.height >= 50);
        check.equal(panel.scrollWidth, panel.clientWidth);
    }
    check.equal(hint.enableExtend, true);
    unmount();
    check.equal(element.parentElement, document.body);
    check.equal(element.nextSibling, next);
    check.equal(element.classList.contains("fn__none"), true);
    hint.genHTML(items.slice(0, 2));
    check.equal(element.querySelectorAll(".b3-list-item").length, 2);
    check.equal(element.querySelector(".keyboard__slash-block"), null);
    provider.hint = () => {
        element.classList.remove("fn__none");
        element.textContent = "Loading";
        finishRequest = () => {
            if (hint.enableExtend && !element.classList.contains("fn__none")) {
                hint.genHTML([{value: "skill", html: itemHTML("Skill") +
                    '<div class="b3-list-item__meta b3-list-item__showall">Skill description</div>'}]);
            }
        };
        return [];
    };
    unmount = mount(protyle, panel);
    check.equal(panel.textContent, "Loading");
    await Promise.resolve();
    finishRequest();
    check.equal(panel.querySelector('[data-value="skill"]').className, "keyboard__slash-item");
    check.equal(panel.querySelector(".keyboard__slash-description").textContent, "Skill description");
    check.equal(panel.querySelector(".b3-list-item"), null);
    unmount();
    unmount = mount(protyle, panel);
    unmount();
    finishRequest();
    check.equal(element.classList.contains("fn__none"), true);
    check.equal(panel.children.length, 0);
    provider.hint = () => [];
    unmount = mount(protyle, panel);
    check.equal(panel.textContent, "Empty");
    unmount();
    provider.hint = () => items;
    mount(protyle, panel);
    toolbar.style.width = "390px";

    const tableEditor = document.createElement("div");
    tableEditor.className = "protyle-wysiwyg";
    tableEditor.innerHTML = "<table contenteditable='true'><tbody><tr><td>inline</td></tr></tbody></table>";
    document.body.appendChild(tableEditor);
    const range = document.createRange();
    range.selectNodeContents(tableEditor.querySelector("td"));
    range.collapse(false);
    Object.assign(protyle, {lite: false, wysiwyg: {element: tableEditor}, toolbar: {range}});
    const keyboard = new Function("mountLiteSlashMenu", "focusByRange",
        "let unmountLiteSlashMenu;" + keyboardSource +
        "\nreturn {render: renderSlashMenu, unmount: () => unmountLiteSlashMenu()};")(mount, (saved: Range) => {
        getSelection().removeAllRanges();
        getSelection().addRange(saved);
    });
    provider.hint = () => {
        check.ok(tableEditor.querySelector("td").contains(getSelection().focusNode));
        return items.slice(0, 2);
    };
    getSelection().removeAllRanges();
    keyboard.render(protyle, toolbar);
    check.equal(panel.querySelectorAll("button.keyboard__slash-item[data-value]").length, 2);
    check.equal(panel.querySelector('[data-value="upload"]'), null);
    check.equal(protyle.hint.splitChar, "/");
    check.equal(protyle.hint.lastIndex, -1);
    check.equal(tableEditor.querySelector(".table__cell-editor"), null);
    keyboard.unmount();
    tableEditor.remove();

    const agent = document.createElement("div");
    agent.className = "sy__agentChat sy__agentChat--mobile fn__flex-column";
    agent.style.position = "fixed";
    agent.style.top = "0";
    agent.innerHTML = '<div class="block__icons">Agent</div><div class="agent-chat fn__flex-column fn__flex-1">' +
        '<div class="agent-chat__messages-wrap"><div class="agent-chat__messages fn__flex-1">Messages</div></div>' +
        '<div class="agent-chat__input-area"><div class="agent-chat__composer-host">' +
        '<div class="protyle-content"><div contenteditable="true">Input</div></div></div>' +
        '<div class="agent-chat__buttons"><button class="b3-button">Send</button></div></div></div>';
    document.body.appendChild(agent);
    const contentElement = agent.querySelector<HTMLElement>(".protyle-content");
    const composer = {lite: true, element: contentElement.parentElement, contentElement} as IProtyle;
    for (const width of [320, 390, 768]) {
        agent.style.width = `${width}px`;
        for (const fontSize of [16, 32]) {
            agent.style.fontSize = `${fontSize}px`;
            for (const [height, padding] of [[700, 350], [420, 48], [700, 0]]) {
                agent.style.height = `${height}px`;
                paddingElement(composer).style.paddingBottom = padding ? `${padding}px` : "";
                const input = agent.querySelector(".agent-chat__input-area").getBoundingClientRect();
                check.ok(input.bottom <= height - padding, "composer stays above the keyboard panel");
                check.ok(input.top >= agent.querySelector(".block__icons").getBoundingClientRect().bottom);
                check.equal(contentElement.style.paddingBottom, "");
                check.equal(agent.getBoundingClientRect().height, height, "padding does not enlarge the page");
            }
        }
    }
    agent.remove();
    return "Mobile slash cases passed";
};

test("mobile slash panel retains synchronous and asynchronous candidates and releases its owner", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule((readFileSync(path.join(__dirname, "liteSlashMenu.ts"), "utf8") + "\n" +
        readFileSync(path.join(__dirname, "../../protyle/lite/mobileToolbar.ts"), "utf8"))
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const hintFile = createSourceFile("hint.ts", readFileSync(path.join(__dirname, "../../protyle/hint/index.ts"), "utf8"),
        ScriptTarget.Latest, true);
    const hintClass = hintFile.statements.find(isClassDeclaration);
    const render = hintClass.members.find(member => isMethodDeclaration(member) && member.name.getText(hintFile) === "getHTMLByData");
    const hintSource = transpileModule("class Hint {" + render.getText(hintFile) + "}", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const keyboardFile = createSourceFile("keyboardToolbar.ts", readFileSync(path.join(__dirname, "keyboardToolbar.ts"), "utf8"),
        ScriptTarget.Latest, true);
    const keyboardRender = keyboardFile.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(keyboardFile) === "renderSlashMenu"));
    const keyboardSource = transpileModule(keyboardRender.getText(keyboardFile), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mobile-slash-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 390, height: 500, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require("node:fs").readFileSync(
            ${JSON.stringify(path.resolve(__dirname, "../../../appearance/themes/daylight/theme.css"))}, "utf8"));
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(
            ${JSON.stringify(path.resolve(__dirname, "../../../appearance/icons/litheness/icon.js"))}, "utf8"));
        await win.webContents.insertCSS(require(${JSON.stringify(require.resolve("sass"))}).compile(
            ${JSON.stringify(path.resolve(__dirname, "../../assets/scss/mobile.scss"))}, {logger: {warn() {}}}).css);
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + [source, hintSource, keyboardSource].map(value => JSON.stringify(value)).join(",") + ")")}));
        if (process.env.SIYUAN_MOBILE_SLASH_SCREENSHOT) {
            await new Promise(resolve => setTimeout(resolve, 200));
            require("node:fs").writeFileSync(process.env.SIYUAN_MOBILE_SLASH_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
        }
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
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Mobile slash cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-mobile-slash-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
