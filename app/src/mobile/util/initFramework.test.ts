import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string, suffix = "") => transpileModule(
    readFileSync(resolve(__dirname, file), "utf8") + suffix,
    {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}},
).outputText;

test("mobile toolbar saves truncated Unicode titles on blur and Enter without duplicate requests", async () => {
    const listeners = new Map<string, (event?: object) => void>();
    const attributes = new Map<string, string>();
    const input = {
        value: "",
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        addEventListener: (name: string, handler: (event?: object) => void) => listeners.set(name, handler),
    };
    const runtime = {siyuan: {config: {editor: {autoDirection: false}},
        languages: {fileNameRule: "Invalid filename", _kernel: {16: "Untitled", 106: "Title too long"}},
        mobile: {editor: {protyle: {notebookId: "box", path: "/root.sy", block: {rootID: "root"}}}}}};
    const constants = {SIZE_TITLE: 512};
    const rename = {};
    runInNewContext(compile("../../editor/rename.ts"), {
        exports: rename,
        window: runtime,
        require: (name: string) => name === "../constants" ? {Constants: constants} : {showMessage: () => {}},
    });
    const requests: Array<{title: string}> = [];
    const entries: Promise<void>[] = [];
    const moduleExports: {initEditorName?: () => void} = {};
    runInNewContext(compile("initFramework.ts", "\nexport {initEditorName};"), {
        exports: moduleExports,
        window: runtime,
        document: {getElementById: () => input},
        require: (name: string) => {
            if (name === "../../editor/rename") return rename;
            if (name === "../../constants") return {Constants: constants};
            if (name === "../../protyle/render/autoDirection") return {setTitleAutoDirection: () => {}};
            if (name === "../../util/processTitle") return {setTitle: () => {}};
            if (name === "../../protyle/header/titleEnter") return {
                enterDocumentFromTitle: (_protyle: unknown, options: {beforeLoad: Promise<unknown>}) => {
                    const entered = options.beforeLoad.then(() => listeners.get("blur")());
                    entries.push(entered);
                    return entered;
                },
            };
            if (name === "../../util/fetch") return {fetchPost: (_url: string, data: {title: string}) => {
                requests.push(data);
                return Promise.resolve();
            }};
            return {};
        },
    });
    moduleExports.initEditorName();
    const blur = () => listeners.get("blur")();
    for (const title of ["😀".repeat(512), "文档/Title", ""]) {
        input.value = title;
        blur();
        assert.equal(requests.at(-1)?.title, title);
        assert.equal(input.value, title);
    }
    for (const [title, expected] of [
        ["😀".repeat(513), "😀".repeat(512)],
        ["A" + "😀".repeat(512), "A" + "😀".repeat(511)],
    ]) {
        input.value = title;
        blur();
        assert.equal(requests.at(-1)?.title, expected);
        assert.equal(input.value, expected);
    }
    assert.equal(requests.length, 5);
    for (const title of ["Title\nwith/slash", "A\n" + "😀".repeat(513)]) {
        input.value = title;
        blur();
        assert.equal(requests.length, 5);
        assert.ok(input.value.includes("\n"));
    }
    input.value = "🚀".repeat(513);
    const keydown = listeners.get("keydown");
    const event = {key: "Enter", preventDefault: () => {}, stopPropagation: () => {}};
    keydown({...event, isComposing: true});
    assert.equal(entries.length, 0);
    assert.equal(requests.length, 5);
    keydown(event);
    await Promise.all(entries);
    assert.equal(entries.length, 1);
    assert.equal(requests.length, 6);
    assert.equal(requests.at(-1)?.title, "🚀".repeat(512));
    assert.equal(input.value, "🚀".repeat(512));

    attributes.set("readonly", "readonly");
    input.value = "Readonly title";
    blur();
    assert.equal(requests.length, 6);
});
