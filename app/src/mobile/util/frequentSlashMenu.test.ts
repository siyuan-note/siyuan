import * as assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getFrequentSlashButtons, prependFrequentSlashButtons} from "./liteSlashMenu";
import {rankFrequentSlashItems} from "../../protyle/hint/frequentSlash";

class Button {
    public dataset: {slashEntryKey: string};
    public cloned = false;

    constructor(entryKey: string, public variant = false) {
        this.dataset = {slashEntryKey: entryKey};
    }

    public querySelector() {
        return this.variant ? {} : null;
    }

    public cloneNode(deep: boolean) {
        assert.equal(deep, true);
        const copy = new Button(this.dataset.slashEntryKey, this.variant);
        copy.cloned = true;
        return copy;
    }
}

const container = (buttons: Button[]) => ({querySelectorAll: () => buttons}) as unknown as HTMLElement;

test("mobile frequent candidates intersect actual buttons with eligible configured order", () => {
    const buttons = [new Button("hidden"), new Button("plugin:a:insert"), new Button("code"),
        new Button("plugin:b:insert"), new Button("heading1")];
    const eligible = ["heading1", "plugin:b:insert", "missing", "code", "plugin:a:insert", "code"];
    const result = getFrequentSlashButtons(container(buttons), eligible);
    assert.deepEqual(result.map(button => button.dataset.slashEntryKey),
        ["heading1", "plugin:b:insert", "code", "plugin:a:insert"]);
    assert.deepEqual(rankFrequentSlashItems(result, item => item.dataset.slashEntryKey,
        {hidden: 100, missing: 99, heading1: 1, code: 2, "plugin:b:insert": 2})
        .map(button => button.dataset.slashEntryKey), ["plugin:b:insert", "code", "heading1"]);
    assert.equal(buttons.length, 5);
});

test("mobile Android upload variants share one identity and prefer the ordinary upload button", () => {
    const buttons = [new Button("insertAsset", true), new Button("insertAsset", true), new Button("insertAsset")];
    assert.deepEqual(getFrequentSlashButtons(container(buttons), ["insertAsset"]), [buttons[2]]);
    assert.deepEqual(getFrequentSlashButtons(container(buttons.slice(0, 2)), ["insertAsset"]), [buttons[0]]);
});

test("mobile frequent group clones supported buttons and preserves the original menu nodes", () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    class Element {
        public className = "";
        public attributes: Record<string, string> = {};
        public children: unknown[] = [];
        public setAttribute(key: string, value: string) { this.attributes[key] = value; }
        public appendChild(value: unknown) { this.children.push(value); }
        public prepend(...values: unknown[]) { this.children.unshift(...values); }
    }
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: () => new Element()}});
    try {
        const root = new Element();
        const original = new Element();
        root.children.push(original);
        prependFrequentSlashButtons(root as unknown as HTMLElement, []);
        assert.deepEqual(root.children, [original]);
        const code = new Button("code");
        prependFrequentSlashButtons(root as unknown as HTMLElement, [code] as unknown as HTMLButtonElement[]);
        const [group, separator] = root.children as Element[];
        assert.equal(group.className, "keyboard__slash-block");
        assert.equal((group.children[0] as Button).dataset.slashEntryKey, "code");
        assert.equal((group.children[0] as Button).cloned, true);
        assert.notEqual(group.children[0], code);
        assert.equal(separator.className, "b3-menu__separator");
        assert.equal(separator.attributes.role, "separator");
        assert.equal(root.children[2], original);
    } finally {
        if (previousDocument) {
            Object.defineProperty(globalThis, "document", previousDocument);
        } else {
            delete globalThis.document;
        }
    }
});

test("full mobile slash panel keeps original hidden items and only prefixes eligible rendered commands", () => {
    const filename = path.join(__dirname, "keyboardToolbar.ts");
    const file = createSourceFile(filename, readFileSync(filename, "utf8"), ScriptTarget.Latest, true);
    const source = file.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration =>
            ["getSlashItem", "renderSlashMenu"].includes(declaration.name.getText(file))))
        .map(statement => statement.getText(file)).join("\n");
    let mounted = 0;
    let boundUploads = 0;
    let eligibilityCalls = 0;
    let frequentButtons: HTMLButtonElement[] = [];
    const util = {
        innerHTML: "",
        querySelectorAll: () => Array.from(util.innerHTML.matchAll(/<button[^>]+data-slash-entry-key="([^"]+)"[^>]*>/g),
            match => new Button(match[1])),
    };
    const root = {querySelector: () => util};
    const protyle = {
        lite: false,
        app: {plugins: [] as unknown[]},
        hint: {splitChar: "", lastIndex: 0, bindUploadEvent: () => boundUploads++},
        options: {upload: {}},
    };
    const environment = {
        Constants: {ZWSP: "\u200b", CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"},
        Lute: {Caret: "caret"},
        window: {siyuan: {languages: {}}},
        SLASH_MENU_ROOT_PATH: "editor.slash.menu",
        getHostCapabilities: () => ({widgets: false, remoteKernel: true}),
        isDisabledFeature: () => true,
        isInAndroid: () => false,
        isBuiltinInlineStyleVisible: () => false,
        getSuperBlockCommand: (layout: string) => layout,
        escapeHtml: (value: string) => value,
        getFrequentSlashButtons,
        getFrequentSlashItems: (buttons: HTMLButtonElement[], getKey: (button: HTMLButtonElement) => string) =>
            rankFrequentSlashItems(buttons, getKey, {heading1: 100, code: 1, insertHTMLFile: 99}),
        hintSlash: (key: string, editor: unknown, hideConfiguredCreate: boolean, options: {visibilityRoot: string}) => {
            eligibilityCalls++;
            assert.equal(key, "");
            assert.equal(editor, protyle);
            assert.equal(hideConfiguredCreate, false);
            assert.equal(options.visibilityRoot, "editor.slash.menu");
            return [{entryKey: "code", html: "Code"}, {entryKey: "insertHTMLFile", html: "HTML upload"},
                {entryKey: "separator_1", html: "separator"}];
        },
        prependFrequentSlashButtons: (_container: unknown, buttons: HTMLButtonElement[]) => frequentButtons = buttons,
        mountLiteSlashMenu: () => { mounted++; },
    };
    const render = new Function("environment", "const {" + Object.keys(environment).join(",") +
        "} = environment; let unmountLiteSlashMenu; " + transpileModule(source,
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText + "\nreturn renderSlashMenu;")(environment) as
        (editor: unknown, toolbar: unknown) => void;
    render(protyle, root);
    assert.equal(eligibilityCalls, 1);
    assert.deepEqual(frequentButtons.map(button => button.dataset.slashEntryKey), ["code"]);
    assert.equal((util.innerHTML.match(/data-slash-entry-key="heading1"/g) || []).length, 1);
    assert.equal((util.innerHTML.match(/data-slash-entry-key="code"/g) || []).length, 1);
    assert.equal((util.innerHTML.match(/data-slash-entry-key="insertAsset"/g) || []).length, 1);
    assert.equal((util.innerHTML.match(/data-slash-entry-key="insertHTMLFile"/g) || []).length, 0);
    assert.equal(boundUploads, 1);
    assert.equal(protyle.hint.splitChar, "/");
    assert.equal(protyle.hint.lastIndex, -1);
    protyle.lite = true;
    render(protyle, root);
    assert.equal(mounted, 1);
    assert.equal(eligibilityCalls, 1);
    assert.equal(boundUploads, 1);
});

const chromium = process.env.CHROMIUM_PATH;

test("mobile lite renderer preserves stable keys, separate uploads, original order and frequent divider", {
    skip: !chromium,
}, () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "liteSlashMenu.ts"), "utf8")
        .replace(/^import type .*;\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-frequent-mobile-"));
    try {
        const html = path.join(directory, "index.html");
        writeFileSync(html, `<body><script>${source}
            const item = (entryKey, html, value = "shared-upload") => ({entryKey, html, value});
            const code = item("code", '<span class="b3-list-item__text">Code</span>', "code");
            const asset = item("insertAsset", '<span class="b3-list-item__text">File</span><input type="file">');
            const embed = item("insertHTMLFile", '<span class="b3-list-item__text">HTML</span><input type="file" data-upload-mode="html-iframe">');
            const untracked = {id: "custom", value: "custom", html: "Custom"};
            const original = [code, asset, embed, untracked];
            const result = document.createElement("div");
            result.innerHTML = getLiteSlashMenuHTML([asset, item("__frequent_separator__", "separator"), ...original]);
            document.body.append(result);
            const keys = Array.from(result.querySelectorAll("button"), button => button.dataset.slashEntryKey || "");
            const checks = [
                keys.join(",") === "insertAsset,code,insertAsset,insertHTMLFile,",
                result.firstElementChild.className === "keyboard__slash-block",
                result.querySelectorAll('.b3-menu__separator[role="separator"]').length === 1,
                result.querySelectorAll('.keyboard__slash-title').length === 1,
                result.querySelectorAll('input[type="file"]').length === 3,
                result.querySelectorAll('input[data-upload-mode="html-iframe"]').length === 1,
                !result.querySelector('[data-id="custom"]').hasAttribute("data-slash-entry-key"),
            ];
            const saved = result.innerHTML;
            result.innerHTML = getLiteSlashMenuHTML(original);
            checks.push(!result.querySelector('.b3-menu__separator'));
            checks.push(Array.from(result.querySelectorAll("button"), button => button.dataset.slashEntryKey || "").join(",") === "code,insertAsset,insertHTMLFile,");
            document.body.setAttribute("data-results", checks.join(","));
            result.innerHTML = saved;
        </script></body>`, "utf8");
        const result = spawnSync(chromium, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
            "--dump-dom", `--user-data-dir=${path.join(directory, "profile")}`, `file://${html}`],
        {encoding: "utf8", timeout: 30000, env: {...process.env, HOME: directory, XDG_CONFIG_HOME: directory}});
        assert.equal(result.status, 0, result.error?.message || result.stderr);
        assert.match(result.stdout, /data-results="true,true,true,true,true,true,true,true,true"/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
