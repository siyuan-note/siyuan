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

test("mobile toolbar saves Unicode titles and preserves full characters at the length limit", () => {
    const listeners = new Map<string, () => void>();
    const attributes = new Map<string, string>();
    const input = {
        value: "",
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    };
    const runtime = {siyuan: {documentAddressingVersion: 2, config: {editor: {autoDirection: false}},
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
        ["Title\nwith/slash", "Title\nwith/slash"],
    ]) {
        input.value = title;
        blur();
        assert.equal(requests.length, 3);
        assert.equal(input.value, expected);
    }
    runtime.siyuan.documentAddressingVersion = 1;
    input.value = "😀".repeat(512);
    blur();
    assert.equal(requests.length, 3);
    assert.equal(input.value, "😀".repeat(256));
});
