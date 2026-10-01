import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createLoader = () => {
    const code = transpileModule(readFileSync("src/protyle/util/addScript.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const elements: Array<Record<string, any>> = [];
    let reloads = 0;
    const context = {
        exports: {} as {addScriptSync: (path: string, id: string) => Promise<boolean>},
        document: {
            getElementById: (id: string) => elements.find(element => element.id === id),
            createElement: () => {
                const element: Record<string, any> = {remove: () => elements.splice(elements.indexOf(element), 1)};
                return element;
            },
            head: {appendChild: (element: Record<string, any>) => elements.push(element)},
        },
        window: {location: {reload: () => reloads++}},
        Lute: undefined as unknown,
    };
    runInNewContext(code, context);
    return {loader: context.exports, elements, context, reloads: () => reloads};
};

test("ordered external scripts share pending work and wait for load completion", async () => {
    const {loader, elements} = createLoader();
    const first = loader.addScriptSync("/lute.js", "engine");
    const second = loader.addScriptSync("/lute.js", "engine");
    let completed = false;
    void second.then(() => completed = true);
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(elements.length, 1);
    assert.equal(elements[0].src, "/lute.js");
    assert.equal(elements[0].async, false);
    assert.equal(elements[0].text, undefined);
    elements[0].onload();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(await loader.addScriptSync("/lute.js", "engine"), false);
});

test("failed external scripts release concurrent callers and can be retried", async () => {
    const {loader, elements} = createLoader();
    const first = loader.addScriptSync("/missing.js", "engine");
    const second = loader.addScriptSync("/missing.js", "engine");
    elements[0].onerror();
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(elements.length, 0);
    const retried = loader.addScriptSync("/loaded.js", "engine");
    elements[0].onload();
    assert.equal(await retried, true);
});

test("non-Lute scripts can load before Lute without reloading the page", async () => {
    const {loader, elements, reloads} = createLoader();
    const html = loader.addScriptSync("/protyle-html.js", "protyleWcHtmlScript");
    elements[0].onload();
    await html;
    assert.equal(reloads(), 0);
    const lute = loader.addScriptSync("/lute.js", "protyleLuteScript");
    elements[1].onload();
    await lute;
    assert.equal(reloads(), 1);
});

test("a successfully initialized Lute does not reload the page", async () => {
    const {loader, elements, context, reloads} = createLoader();
    const pending = loader.addScriptSync("/lute.js", "protyleLuteScript");
    context.Lute = {};
    elements[0].onload();
    await pending;
    assert.equal(reloads(), 0);
});
