import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/plantumlImage.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const carrier of ["object", "img"]) {
    for (const mime of ["image/svg+xml", "image/png"]) {
        test(`PlantUML export preserves ${mime} from ${carrier}`, async () => {
            const blob = new Blob(["image"], {type: mime});
            const exports = {} as {getPlantumlImageBlob: (element: unknown) => Promise<Blob>};
            runInNewContext(compiled, {
                exports,
                fetch: async (url: string) => {
                    assert.equal(url, "https://example.com/diagram");
                    return {ok: true, blob: async () => blob};
                },
            });
            const result = await exports.getPlantumlImageBlob({
                querySelector: (selector: string) => selector === carrier ?
                    {getAttribute: () => "https://example.com/diagram"} : null,
            });
            assert.equal(result, blob);
            assert.equal(result.type, mime);
        });
    }
}

test("PlantUML export ignores empty blocks and rejects unsuccessful or non-image responses", async () => {
    let response = {ok: false, status: 503, statusText: "Unavailable", blob: async () => new Blob(["error"], {type: "text/html"})};
    let requests = 0;
    const exports = {} as {getPlantumlImageBlob: (element: unknown) => Promise<Blob>};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {fileTypeError: "Invalid image"}}},
        fetch: async () => { requests++; return response; },
    });
    assert.equal(await exports.getPlantumlImageBlob({querySelector: (): Element => null}), undefined);
    assert.equal(requests, 0);
    const element = {querySelector: () => ({getAttribute: () => "https://example.com/diagram"})};
    await assert.rejects(exports.getPlantumlImageBlob(element), /503 Unavailable/);
    response = {...response, ok: true};
    await assert.rejects(exports.getPlantumlImageBlob(element), /Invalid image/);
    response = {...response, blob: async () => new Blob([], {type: "image/svg+xml"})};
    await assert.rejects(exports.getPlantumlImageBlob(element), /Invalid image/);
});
