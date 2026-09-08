import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {isCustomFileTreeList} from "./fileTreeSort";

for (const sourcePath of ["src/layout/dock/Files.ts", "src/mobile/dock/MobileFiles.ts"]) {
    const source = createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(isClassDeclaration);
    const methods = declaration.members.filter(member =>
        ["onRename", "onFiletreeSortChanged"].includes(member.name?.getText(source))
    ).map(member => member.getText(source)).join("\n");
    const compiled = transpileModule(`class Handler {${methods}} exports.Handler = Handler;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;

    for (const parentPath of ["/", "/parent/child"]) {
        for (const mode of [0, 3, 4, 6]) {
            for (const visible of [true, false]) {
                test(`${sourcePath}: rename refreshes mode ${mode}, parent ${parentPath}, visible ${visible}`, () => {
                    const docPath = posix.join(parentPath, "document.sy");
                    const listPath = parentPath === "/" ? "/" : `${parentPath}.sy`;
                    const list = {tagName: "UL", getAttribute: () => String(mode)};
                    const parent = {nextElementSibling: list};
                    const title = {innerHTML: "old"};
                    let name = "old";
                    const file = {setAttribute: (_key: string, value: string) => name = value, querySelector: () => title};
                    const requests: any[] = [];
                    const rendered: any[] = [];
                    const response = {files: [{id: "document"}], path: listPath};
                    const exports: any = {};
                    runInNewContext(compiled, {
                        exports,
                        pathPosix: () => posix,
                        escapeHtml: (value: string) => value.replace(/</g, "&lt;"),
                        isCustomFileTreeList,
                        Constants: {SIYUAN_APPID: "app"},
                        fetchPost: (_url: string, data: any, callback: (data: any) => void) => {
                            requests.push(data);
                            callback({data: response});
                        },
                    });
                    const handler = new exports.Handler();
                    handler.element = {querySelector: (selector: string) => {
                        if (selector === 'ul[data-url="notebook"]') {
                            return {querySelector: () => parent};
                        }
                        if (selector === `ul[data-url="notebook"] li[data-path="${listPath}"]`) {
                            return parent;
                        }
                        return visible ? file : null;
                    }};
                    handler.onLsHTML = (data: any) => rendered.push(data);
                    handler.onRename({box: "notebook", path: docPath, title: "<new"});
                    assert.equal(requests.length, mode === 6 ? 0 : 1);
                    if (mode !== 6) {
                        assert.equal(requests[0].notebook, "notebook");
                        assert.equal(requests[0].path, listPath);
                        assert.equal(rendered[0], response);
                    }
                    assert.equal(name, visible ? "<new" : "old");
                    assert.equal(title.innerHTML, visible ? "&lt;new" : "old");
                });
            }
        }
    }
}
