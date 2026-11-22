import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

describe("desktop host initialization", () => {
    it("awaits host capabilities before loading extensions in both desktop windows", () => {
        for (const file of ["src/index.ts", "src/window/index.ts"]) {
            const source = readFileSync(resolve(process.cwd(), file), "utf8");
            const connectionIndex = source.indexOf("await loadDesktopHostConnection();");
            assert.ok(connectionIndex > source.indexOf("window.siyuan.config = response.data.conf;"));
            assert.ok(connectionIndex < source.indexOf("await loadPlugins(this);"));
        }
    });

    it("registers main and detached windows before desktop event handling", () => {
        const mainSource = readFileSync(resolve(process.cwd(), "src/boot/onGetConfig.ts"), "utf8");
        const detachedSource = readFileSync(resolve(process.cwd(), "src/window/init.ts"), "utf8");

        assert.match(mainSource, /await initDesktopHost\(\);/);
        assert.match(detachedSource, /await initDesktopHost\(\);/);
        assert.ok(detachedSource.indexOf("await initDesktopHost();") < detachedSource.indexOf("initWindowEvent(app);"));
    });

    it("refreshes named window layouts before rendering, while restoring session layouts directly", async () => {
        const source = readFileSync("src/window/init.ts", "utf8");
        const code = transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        for (const restoreSession of [false, true]) {
            const actions: string[] = [];
            const exports = {} as typeof import("./init");
            const noOp = () => {};
            const stub: Record<PropertyKey, unknown> = {
                Constants: {LOCAL_ZOOM: "zoom", SIZE_ZOOM: [{zoom: 1, position: {x: 0, y: 0}}]},
                ipcRenderer: {send: noOp}, webFrame: {setZoomFactor: noOp},
                fetchPost: (_url: string, _data: unknown, callback: (response: {data: unknown[]}) => Promise<void>) =>
                    callback({data: []}),
                getWindowWorkspaceLayout: () => ({title: "named"}),
                refreshLayoutDocumentIcons: async (layout: {title: string}) => {
                    await Promise.resolve();
                    actions.push(`refresh ${layout.title}`);
                },
                JSONToCenter: (_app: unknown, layout: {title: string}) => actions.push(`render ${layout.title}`),
                getAllWnds: (_layout: unknown, wnds: {children: unknown[]}[]) => wnds.push({children: [{}]}),
                appearanceConfigApi: {apply: noOp},
            };
            runInNewContext(code, {exports, require: () => new Proxy(stub, {get: (target, key) => target[key] ?? noOp}),
                sessionStorage: {getItem: () => restoreSession ? '{"layout":{"title":"session"}}' : null},
                document: {querySelectorAll: (): unknown[] => []},
                window: {addEventListener: noOp, siyuan: {storage: {zoom: 1}, config: {}, layout: {}}}});

            await exports.init({} as Parameters<typeof exports.init>[0]);

            assert.deepEqual(actions, restoreSession ? ["render session"] : ["refresh named", "render named"]);
        }
    });
});
