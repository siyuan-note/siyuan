import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import * as catalog from "../../../config/entryVisibility/catalog";
import * as profile from "../../../config/entryVisibility/profile";
import {registerBuiltinSlashHint} from "../../../protyle/hint/builtinSlash";
import {loadModule} from "../../../testSupport/loadModule";
import {isSkillHintRequestActive, shouldYieldSkillHint} from "./agentHintState";

const composer = createSourceFile("AgentComposer.ts", readFileSync("src/layout/dock/agent/AgentComposer.ts", "utf8"),
    ScriptTarget.Latest, true);
const selected = new Set(["skillHintRequestIDs", "skillSlashCommands", "prepareAgentHint", "isSkillHintEnabled", "hintSkill"]);
const source = transpileModule(composer.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(composer))))
    .map(statement => statement.getText(composer)).join("\n"), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

test("agent slash skills follow platform defaults and profiles while the mobile plus panel stays available", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const custom = {id: "custom", entries: {} as Record<string, boolean>, orders: {}};
    const config = {active: "custom", profiles: [custom]};
    const runtimeWindow = {siyuan: {mobile: undefined as object | undefined, zIndex: 1,
        config: {appearance: {entryVisibility: config}}, languages: {emptyContent: "Empty"}}};
    Object.defineProperty(globalThis, "window", {configurable: true, value: runtimeWindow});
    try {
        const runtime = loadModule<typeof import("../../../config/entryVisibility/runtime")>(
            "src/config/entryVisibility/runtime.ts", {
                window: runtimeWindow,
                require: () => ({...catalog, ...profile, TOOLBAR_ENTRY_ROOT_PATH: "editor.toolbar"}),
            });
        const requests: Array<(response: {data: Array<{name: string; description: string}>}) => void> = [];
        const skills = {data: [{name: "skill", description: "Skill description"}]};
        const dependencies = {...catalog, registerBuiltinSlashHint, isSkillHintRequestActive, shouldYieldSkillHint,
            getConfiguredEntryVisibility: runtime.getConfiguredEntryVisibility,
            hintSlash: (): IHintData[] => [{id: "bold", value: "strong", html: "Bold"}],
            fetchPost: (_url: string, _data: unknown, callback: typeof requests[number]) => requests.push(callback),
            escapeHtml: (value: string) => value,
        };
        const hintSkill: (key: string, protyle: IProtyle) => IHintData[] = new Function(...Object.keys(dependencies),
            source + "\nreturn hintSkill;")(...Object.values(dependencies));
        let inPlusPanel = false;
        let hidden = true;
        let items: IHintData[] = [];
        const hint = {
            enableExtend: true, enableSlash: true, splitChar: "/",
            element: {style: {}, isConnected: true, closest: () => inPlusPanel ? {} : null,
                classList: {contains: () => hidden}},
            genHTML: (data: IHintData[], _protyle?: IProtyle, hide = false) => {
                items = data;
                if (hide || data.length > 0) {
                    hidden = hide && data.length === 0;
                }
            },
            genLoading: () => { hidden = false; },
        };
        const protyle = {hint, options: {hint: {extend: [{key: "/", hint: hintSkill}, {key: "、", hint: hintSkill}]}}} as unknown as IProtyle;
        const query = (expected: boolean) => {
            assert.deepEqual(hintSkill("", protyle), []);
            assert.equal(requests.length, expected ? 1 : 0);
            if (expected) {
                requests.shift()(skills);
                assert.ok(items.some(item => item.html.includes("Skill description")));
                assert.equal(items.some(item => item.value === "strong"), inPlusPanel);
                assert.equal(hidden, false);
            } else {
                assert.equal(hidden, true);
                assert.equal(items.length, 0);
            }
        };
        for (const mobile of [false, true]) {
            runtimeWindow.siyuan.mobile = mobile ? {} : undefined;
            for (const active of ["simple", "full", "custom"]) {
                config.active = active;
                for (const splitChar of ["/", "、"]) {
                    hint.splitChar = splitChar;
                    inPlusPanel = false;
                    query(!mobile);
                    inPlusPanel = true;
                    query(true);
                }
            }
            config.active = "custom";
            for (const enabled of [false, true]) {
                custom.entries[catalog.SLASH_MENU_ROOT_PATH] = enabled;
                inPlusPanel = false;
                query(enabled);
                inPlusPanel = true;
                query(true);
            }
            custom.entries = {};
        }

        inPlusPanel = false;
        custom.entries[catalog.SLASH_MENU_ROOT_PATH] = true;
        hintSkill("", protyle);
        custom.entries[catalog.SLASH_MENU_ROOT_PATH] = false;
        requests.shift()(skills);
        assert.equal(hidden, true, "a late response hides its loading panel after the switch is disabled");
        assert.equal(items.length, 0);

        custom.entries[catalog.SLASH_MENU_ROOT_PATH] = true;
        hintSkill("", protyle);
        const previous = requests.shift();
        custom.entries[catalog.SLASH_MENU_ROOT_PATH] = false;
        query(false);
        inPlusPanel = true;
        hintSkill("", protyle);
        requests.shift()(skills);
        const plusItems = items;
        previous({data: [{name: "stale", description: "Stale skill"}]});
        assert.equal(items, plusItems, "a previous typed query cannot replace the newly opened plus panel");

        hintSkill("", protyle);
        inPlusPanel = false;
        hidden = true;
        hint.enableExtend = false;
        requests.shift()(skills);
        assert.equal(hidden, true, "a late response cannot reopen a closed plus panel");
        hint.enableExtend = true;
        query(false);
        custom.entries[catalog.SLASH_MENU_ROOT_PATH] = true;
        query(true);
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});
