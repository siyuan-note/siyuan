import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getAgentDefaultModelID, getUsableAgentModels} from "../../layout/dock/agent/agentModel";
import {createNamespacePatchQueue} from "../util/namespacePatchQueue";
import {mergeRecordByDottedPath} from "../util/dotPath";


for (const mobile of [false, true]) {
    test(`namespace patch and its push read confirmed configuration once (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compile = (file: string) => transpileModule(parse(readFileSync(file, "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const requests: string[] = [];
        const config = {editor: {fontSize: 16}};
        let fontSize = 16;
        const refresh = {} as {refreshSettingConfig: (namespace: string) => Promise<void>};
        const fetchSyncPost = async (url: string, data: {editor: {fontSize: number}}) => {
            requests.push(url);
            if (url.endsWith("patch")) {
                fontSize = data.editor.fontSize;
                void refresh.refreshSettingConfig("editor");
                await Promise.resolve();
                return {code: 0};
            }
            return {code: 0, data: {conf: {editor: {fontSize}}}};
        };
        runInNewContext(compile("src/config/setting/sync.ts"), {exports: refresh, window: {siyuan: {config}}, console,
            require: () => ({fetchSyncPost, systemConfig: (value: unknown) => value,
                objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
                editorConfigApi: {apply: (value: typeof config.editor) => { config.editor = value; }},
                syncSettingTasks() {}, getSettingTabDefs: () => [{id: "editor"}], remountOpenSettingTab: async () => {},
            })});
        const api = {} as {createConfigNamespaceApi: (options: {
            namespace: string; getConfig: () => typeof config.editor;
        }) => {patch: (path: string, value: number, applied: (value: typeof config.editor) => void) => Promise<void>}};
        runInNewContext(compile("src/config/util/namespaceApi.ts"), {exports: api, require: () => ({
            ...refresh, fetchSyncPost, createNamespacePatchQueue, mergeRecordByDottedPath,
        })});
        let confirmed: typeof config.editor;
        await api.createConfigNamespaceApi({namespace: "editor", getConfig: () => config.editor})
            .patch("fontSize", 18, value => { confirmed = value; });
        assert.deepEqual(requests, ["/api/setting/patch", "/api/system/getConf"]);
        assert.equal(confirmed.fontSize, 18);
        fontSize = 20;
        await refresh.refreshSettingConfig("editor");
        assert.equal(config.editor.fontSize, 20);
        assert.equal(requests.length, 3);
    });

    for (const result of ["success", "failure", "throw"]) {
        test(`settings saves merge their notification with response refresh and release failures (mobile=${mobile}, ${result})`, async () => {
            const {parse} = require("ifdef-loader/preprocessor");
            const compiled = transpileModule(parse(readFileSync("src/config/setting/sync.ts", "utf8"),
                {MOBILE: mobile, BROWSER: mobile}, false, true), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText;
            let requests = 0;
            let finishSave: () => void;
            const config = {editor: {fontSize: 16}};
            const exports = {} as {
                refreshSettingConfig: (namespace: string) => Promise<void>;
                refreshSettingConfigAfter: (namespace: string, save: () => Promise<boolean>) => Promise<boolean>;
            };
            runInNewContext(compiled, {exports, window: {siyuan: {config}}, console, require: () => ({
                fetchSyncPost: async () => { requests++; return {code: 0, data: {conf: {editor: {fontSize: 18}}}}; },
                systemConfig: (value: unknown) => value,
                objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
                editorConfigApi: {apply: (value: typeof config.editor) => { config.editor = value; }},
                syncSettingTasks() {}, getSettingTabDefs: () => [{id: "editor"}], remountOpenSettingTab: async () => {},
            })});
            const saving = exports.refreshSettingConfigAfter("editor", async () => {
                await new Promise<void>(resolve => { finishSave = resolve; });
                if (result === "throw") throw new Error("save failed");
                return result === "success";
            });
            const rejected = result === "throw" ? assert.rejects(saving, /save failed/) : undefined;
            const notified = exports.refreshSettingConfig("editor");
            await Promise.resolve();
            assert.equal(requests, 0);
            finishSave();
            if (rejected) await rejected;
            else assert.equal(await saving, result === "success");
            await notified;
            assert.equal(requests, 1);
            assert.equal(config.editor.fontSize, 18);
            await exports.refreshSettingConfig("editor");
            assert.equal(requests, 2, "later notifications still refresh configuration");
        });
    }
}

test("settings notifications update runtime configuration and refresh the registered tab", async () => {
    const compiled = transpileModule(readFileSync("src/config/setting/sync.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const remounted: string[] = [];
    const config = {editor: {fontSize: 16}, keymap: {}, appearance: {}};
    const dependencies = {
        fetchSyncPost: async () => ({code: 0, data: {conf: {editor: {fontSize: 18}, keymap: {}, appearance: {}}}}),
        systemConfig: (value: unknown) => value, objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
        editorConfigApi: {apply: (value: {fontSize: number}) => { config.editor = value; }}, appearanceConfigApi: {},
        syncSettingTasks() {}, remountOpenSettingTab: async (tab: string) => { remounted.push(tab); },
        getSettingTabDefs: () => [{id: "editor"}],
    };
    const exports = {} as {refreshSettingConfig: (namespace: string) => Promise<void>};
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {config}}, console});
    await exports.refreshSettingConfig("editor");
    assert.equal(config.editor.fontSize, 18);
    assert.deepEqual(remounted, ["editor"]);
});

for (const mobile of [false, true]) {
    test(`marketplace configuration and reconnection refresh mounted packages (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compiled = transpileModule(parse(readFileSync("src/config/setting/sync.ts", "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const config = {bazaar: {trust: true}, editor: {}, appearance: {}, keymap: {}};
        let refreshed = 0;
        const exports = {} as {refreshSettingConfig: (namespace?: string) => Promise<void>};
        runInNewContext(compiled, {exports, window: {siyuan: {config}}, console, require: () => ({
            fetchSyncPost: async () => ({code: 0, data: {conf: config}}),
            systemConfig: (value: unknown) => value,
            objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
            syncSettingTasks() {}, getSettingTabDefs: (): {id: string}[] => [],
            refreshMountedBazaar: () => { refreshed++; },
        })});
        await exports.refreshSettingConfig("editor");
        assert.equal(refreshed, 0);
        await exports.refreshSettingConfig("bazaar");
        assert.equal(refreshed, 1);
        await exports.refreshSettingConfig();
        assert.equal(refreshed, 2);
    });

    test(`OCR notifications preserve the settings page and unrelated runtime configuration (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compiled = transpileModule(parse(readFileSync("src/config/setting/sync.ts", "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const editor = {fontSize: 16};
        const appearance = {theme: "dark"};
        const config = {ocr: {provider: "paddleocr", model: "tiny", auto: false}, editor, appearance, keymap: {}};
        let next = {...config.ocr, auto: true};
        let notifications = 0;
        const remounted: string[] = [];
        const exports = {} as {refreshSettingConfig: (namespace?: string) => Promise<void>};
        runInNewContext(compiled, {exports, window: {siyuan: {config}}, console, require: () => ({
            fetchSyncPost: async () => ({code: 0, data: {conf: {...config, ocr: next,
                editor: {fontSize: 18}, appearance: {theme: "light"}}}}),
            systemConfig: (value: unknown) => value,
            objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
            editorConfigApi: {apply: () => assert.fail("OCR must not apply editor settings")},
            appearanceConfigApi: {apply: () => assert.fail("OCR must not apply appearance settings")},
            syncSettingTasks() {}, getSettingTabDefs: () => [{id: "assets"}, {id: "ocr"}, {id: "appearance"}, {id: "editor"}],
            notifyOCRChanged: () => { notifications++; },
            remountOpenSettingTab: async (tab: string) => { remounted.push(tab); },
        })});
        await exports.refreshSettingConfig("ocr");
        assert.equal(config.ocr, next);
        assert.equal(config.editor, editor);
        assert.equal(config.appearance, appearance);
        assert.deepEqual(remounted, []);
        next = {...next, auto: false};
        await exports.refreshSettingConfig("ocr");
        assert.equal(config.ocr.auto, false);
        assert.deepEqual(remounted, []);
        assert.equal(notifications, 2);
    });

    test(`AI settings received from another window notify the agent model picker (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compile = (file: string) => transpileModule(parse(readFileSync(file, "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const ai = (model: string) => ({
            providers: [{id: "provider", name: "Provider", enabled: true,
                models: [{id: model, name: model, enabled: true}]}],
        });
        type AIConfig = ReturnType<typeof ai>;
        const config = {ai: ai("old-model"), editor: {}, appearance: {}, keymap: {}};
        let next = ai("new-model");
        let changed = 0;
        let models: string[] = [];
        const agentSource = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
            ScriptTarget.ES2021, true);
        const agentClass = agentSource.statements.find(statement => isClassDeclaration(statement) && statement.name.text === "AgentChat");
        assert.ok(isClassDeclaration(agentClass));
        const checkConfig = agentClass.members.find(member => isMethodDeclaration(member) && member.name.getText(agentSource) === "checkConfigChanged");
        const agentExports = {} as {Observer: {prototype: {checkConfigChanged: () => void}}};
        const agent = {
            modelOptions: getUsableAgentModels(config.ai), defaultModelID: "", entries: [{}],
            checkStreamingMarkdownChanged() {},
            refreshModelOptions() {
                const options = getUsableAgentModels(config.ai);
                this.modelOptions = options;
                this.defaultModelID = getAgentDefaultModelID(config.ai, options);
                models = options.map(item => item.id);
            },
        };
        const windowContext = {siyuan: {config}, dispatchEvent: (event: {type: string}) => {
            assert.equal(event.type, "siyuan-ai-config-changed");
            changed++;
            agentExports.Observer.prototype.checkConfigChanged.call(agent);
        }};
        runInNewContext(transpileModule(`export class Observer {${checkConfig.getText(agentSource)}}`, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports: agentExports, window: windowContext, getUsableAgentModels, getAgentDefaultModelID});
        const aiExports = {} as {aiConfigApi: {apply: (value: AIConfig) => void}};
        runInNewContext(compile("src/config/tabs/ai/aiRuntime.ts"), {
            exports: aiExports, window: windowContext, CustomEvent: class {constructor(public type: string) {}},
            require: () => ({createConfigNamespaceApi: (options: {setConfig: (value: AIConfig) => void}) => ({apply: options.setConfig})}),
        });
        const dependencies = {
            fetchSyncPost: async () => ({code: 0, data: {conf: JSON.parse(JSON.stringify({...config, ai: next}))}}),
            systemConfig: (value: unknown) => value,
            objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
            ...aiExports, syncSettingTasks() {}, refreshMountedBazaar() {}, remountOpenSettingTab: async () => {}, getSettingTabDefs: () => [{id: "ai"}],
        };
        const exports = {} as {refreshSettingConfig: (namespace?: string) => Promise<void>};
        runInNewContext(compile("src/config/setting/sync.ts"), {exports, require: () => dependencies, window: windowContext, console});
        await exports.refreshSettingConfig("ai");
        assert.equal(changed, 1);
        assert.ok(models.some(model => model.includes("new-model")));
        assert.ok(!models.some(model => model.includes("old-model")));
        await exports.refreshSettingConfig("ai");
        assert.equal(changed, 1);
        next = ai("third-model");
        await exports.refreshSettingConfig();
        assert.equal(changed, 2);
        assert.ok(models.some(model => model.includes("third-model")));
        next.providers[0].enabled = false;
        await exports.refreshSettingConfig("ai");
        assert.deepEqual(models, []);
    });
}

for (const mobile of [false, true]) {
    test(`system notifications synchronize access fields and preserve masked values (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compiled = transpileModule(parse(readFileSync("src/config/setting/sync.ts", "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const config = {system: {autoLaunch2: 0}, api: {token: "old-token"}, oidc: {enabled: false, clientSecret: "old"},
            accessAuthCode: "old-mask", editor: {}, appearance: {}, keymap: {}, ai: {}, sync: {enabled: true}};
        let next = {...config, system: {autoLaunch2: 1}, api: {token: "new-token"},
            oidc: {enabled: true, clientSecret: "******"}, accessAuthCode: "******"};
        let failed = false;
        const remounted: string[] = [];
        const exports = {} as {refreshSettingConfig: (namespace?: string) => Promise<void>};
        runInNewContext(compiled, {exports, window: {siyuan: {config}}, console, require: () => ({
            fetchSyncPost: async () => failed ? {code: -1} : {code: 0, data: {conf: JSON.parse(JSON.stringify(next))}},
            systemConfig: (value: unknown) => value,
            objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
            syncSettingTasks() {}, refreshMountedBazaar() {}, processSync() {}, getSettingTabDefs: () => [{id: "app"}, {id: "access"}],
            remountOpenSettingTab: async (tab: string) => { remounted.push(tab); },
        })});
        await exports.refreshSettingConfig("system");
        assert.equal(config.system.autoLaunch2, 1);
        assert.equal(config.api.token, "new-token");
        assert.equal(config.oidc.clientSecret, "******");
        assert.equal(config.oidc.enabled, true);
        assert.equal(config.accessAuthCode, "******");
        assert.deepEqual(remounted, mobile ? [] : ["app", "access"]);
        remounted.length = 0;
        await exports.refreshSettingConfig("system");
        assert.deepEqual(remounted, mobile ? [] : ["app"]);
        remounted.length = 0;
        next = {...next, api: {token: "latest-token"}};
        await exports.refreshSettingConfig();
        assert.equal(config.api.token, "latest-token");
        assert.equal(remounted.filter(tab => tab === "access").length, mobile ? 0 : 1);
        failed = true;
        next = {...next, api: {token: "unconfirmed-token"}};
        await exports.refreshSettingConfig("system");
        assert.equal(config.api.token, "latest-token");
    });

    test(`sync notifications refresh icons without resetting an active synchronization (mobile=${mobile})`, async () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compile = (source: string) => transpileModule(parse(source, {MOBILE: mobile, BROWSER: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const config = {sync: {enabled: true, provider: 0}};
        let next = {enabled: false, provider: 0};
        const classes = new Set<string>();
        const classList = {contains: (value: string) => classes.has(value), add: (value: string) => classes.add(value),
            remove: (value: string) => classes.delete(value)};
        let icon = "#iconCloudSucc";
        const useElement = {setAttribute: (_name: string, value: string) => { icon = value; }, parentElement: {classList}};
        const element = {classList, querySelector: () => useElement, firstElementChild: {classList}};
        const document = {querySelector: () => mobile ? useElement : element};
        const window = {siyuan: {config}};
        const systemSource = createSourceFile("processSystem.ts", parse(readFileSync("src/dialog/processSystem.ts", "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true), ScriptTarget.ES2021, true);
        const processSync = systemSource.statements.find(statement => isVariableStatement(statement) &&
            statement.declarationList.declarations.some(item => item.name.getText(systemSource) === "processSync"));
        const runtime = {} as {processSync: () => void};
        runInNewContext(compile(processSync.getText(systemSource)), {exports: runtime, window, document, needSubscribe: () => false});
        let refreshes = 0;
        const exports = {} as {refreshSettingConfig: (namespace: string) => Promise<void>};
        runInNewContext(compile(readFileSync("src/config/setting/sync.ts", "utf8")), {
            exports, window, console, require: () => ({
                fetchSyncPost: async () => ({code: 0, data: {conf: {sync: {...next}}}}), systemConfig: (value: unknown) => value,
                objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
                syncSettingTasks() {}, processSync: () => { refreshes++; runtime.processSync(); },
                getSettingTabDefs: () => [{id: "sync"}], remountOpenSettingTab: async () => {},
            }),
        });
        await exports.refreshSettingConfig("sync");
        assert.equal(config.sync.enabled, false);
        assert.equal(icon, "#iconCloudOff");
        await exports.refreshSettingConfig("sync");
        assert.equal(refreshes, 1);
        icon = "#iconRefresh";
        classes.add(mobile ? "fn__rotate" : "toolbar__item--active");
        next = {enabled: true, provider: 0};
        await exports.refreshSettingConfig("sync");
        assert.equal(refreshes, 2);
        assert.equal(config.sync.enabled, true);
        assert.equal(icon, "#iconRefresh");
        assert.ok(classes.has(mobile ? "fn__rotate" : "toolbar__item--active"));
    });
}
