import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

for (const path of ["src/layout/dock/Outline.ts", "src/mobile/dock/MobileOutline.ts"]) {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const method = source.statements.find(isClassDeclaration).members.find(member =>
        member.name?.getText(source) === "saveExpendIds");
    const compiled = transpileModule(`class Harness {
        blockId = ""; isPreview = false; type = "pin";
        ${method.getText(source)}
    }
    globalThis.Harness = Harness;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

    const setup = () => {
        const requests: {url: string, params: any}[] = [];
        const context: any = {
            window: {siyuan: {config: {readonly: false}, isPublish: false}},
            fetchPost: (url: string, params: unknown) => requests.push({url, params}),
        };
        runInNewContext(compiled, context);
        return {context, requests};
    };

    // 沙箱内构造的对象原型与宿主不同，转为宿主对象后再比较
    const hostRequests = (requests: {url: string, params: any}[]) =>
        requests.map(item => ({url: item.url, params: JSON.parse(JSON.stringify(item.params))}));

    test(`${path}: an empty outline panel does not persist heading state`, () => {
        const {context, requests} = setup();
        const outline = new context.Harness();
        outline.tree = {getExpandIds: (): string[] => []};
        outline.saveExpendIds();
        assert.deepEqual(hostRequests(requests), []);
    });

    test(`${path}: an opened document persists the expanded heading ids`, () => {
        const {context, requests} = setup();
        const outline = new context.Harness();
        outline.blockId = "doc";
        outline.tree = {getExpandIds: () => ["h1"]};
        outline.saveExpendIds();
        assert.deepEqual(hostRequests(requests), [{
            url: "/api/storage/setOutlineStorage",
            params: {docID: "doc", val: {expandIds: ["h1"]}},
        }]);
    });
}
