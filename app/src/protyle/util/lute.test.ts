import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createLoader = () => {
    const scripts = new Map<string, any>();
    let reloads = 0;
    let loads = 0;
    const context = {
        exports: {} as Record<string, any>, Lute: undefined as unknown,
        window: {location: {reload: () => reloads++}},
        document: {
            getElementById: (id: string) => scripts.get(id),
            createElement: () => {
                const script = {id: "", remove: () => scripts.delete(script.id)};
                return script;
            },
            head: {appendChild: (script: {id: string}) => { loads++; scripts.set(script.id, script); }},
        },
        require: (() => ({})) as (name: string) => unknown,
    };
    const compile = (name: string) => transpileModule(readFileSync("src/protyle/util/" + name + ".ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(compile("addScript"), context);
    const loader = context.exports;
    context.exports = {};
    context.require = (name: string) => name === "./addScript" ? loader :
        {Constants: {PROTYLE_CDN: "/stage/protyle", SIYUAN_VERSION: "test"}};
    runInNewContext(compile("lute"), context);
    return {ensureLute: context.exports.ensureLute as (options?: {reloadOnFailure?: boolean}) => Promise<void>,
        scripts, context, reloads: () => reloads, loads: () => loads};
};

test("settings Lute failures never reload, remove the failed script, and permit retry", async () => {
    for (const failure of ["load", "error"]) {
        const fixture = createLoader();
        const first = fixture.ensureLute({reloadOnFailure: false});
        const repeated = fixture.ensureLute({reloadOnFailure: false});
        assert.equal(fixture.loads(), 1);
        fixture.scripts.get("protyleLuteScript")[failure === "load" ? "onload" : "onerror"]();
        const results = await Promise.allSettled([first, repeated]);
        assert.ok(results.every(result => result.status === "rejected"));
        assert.equal(fixture.reloads(), 0);
        assert.equal(fixture.scripts.size, 0);
        const retried = fixture.ensureLute({reloadOnFailure: false});
        fixture.context.Lute = {};
        fixture.scripts.get("protyleLuteScript").onload();
        await retried;
        await fixture.ensureLute({reloadOnFailure: false});
        assert.equal(fixture.loads(), 2);
    }
});

test("ordinary Lute loading retains the Harmony recovery behavior", async () => {
    const fixture = createLoader();
    const pending = fixture.ensureLute();
    fixture.scripts.get("protyleLuteScript").onload();
    await assert.rejects(pending, /Could not load Lute/);
    assert.equal(fixture.reloads(), 1);
});

test("a settings caller suppresses reload for an already pending shared Lute request", async () => {
    const fixture = createLoader();
    const first = fixture.ensureLute();
    const settings = fixture.ensureLute({reloadOnFailure: false});
    fixture.scripts.get("protyleLuteScript").onload();
    await Promise.allSettled([first, settings]);
    assert.equal(fixture.loads(), 1);
    assert.equal(fixture.reloads(), 0);
    assert.equal(fixture.scripts.size, 0);
});
