import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {transpileModule, ScriptTarget} from "typescript";
import type {MarkdownAppearanceGroup, MarkdownAppearancePatch, MarkdownIndependentAppearance} from "./bridge";

const setup = (source = "workspace") => {
    const sourceCode = readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const start = sourceCode.indexOf("    let appearanceUpdates = Promise.resolve();");
    const end = sourceCode.indexOf("    if (appearance) {", start);
    const choices = new Map<string, {values: Array<{value: string}>; value: string; onChange(value: string): void}>();
    const patches: MarkdownAppearancePatch[] = [];
    const forms: Array<{group: MarkdownAppearanceGroup; save(value: MarkdownIndependentAppearance): Promise<void>; cancel(): void; destroyed: boolean}> = [];
    const elements = new Map<string, {hidden: boolean; replaceChildren(): void; showModal(): void}>();
    const deps = {
        text: (key: string) => key,
        control(id: string) {
            if (!elements.has(id)) elements.set(id, {hidden: true, replaceChildren() {}, showModal() {}});
            return elements.get(id);
        },
        closeMore() {}, moreButton: {focus() {}}, root: {style: {setProperty() {}}},
        markdownWorkspaceChoice: (workspace: {id: string; name: string}) => ({value: workspace.id, label: workspace.name}),
        fontAppearance: {apply() {}}, applyTheme: async () => {}, runAction: (action: () => Promise<void>) => {void action();},
        createMarkdownChoice(options: any) {
            choices.set(options.label, options);
            return {destroy() {}, menu: {classList: {add() {}}, querySelectorAll: (): HTMLButtonElement[] => []}};
        },
        createMarkdownAppearanceForm(panel: {hidden: boolean}, group: MarkdownAppearanceGroup, _initial: unknown, _text: unknown,
                                     save: (value: MarkdownIndependentAppearance) => Promise<void>, cancel: () => void) {
            const form = {group, save, cancel, destroyed: false};
            forms.push(form);
            return () => {form.destroyed = true; panel.hidden = true;};
        },
        persist: async (patch: MarkdownAppearancePatch) => {patches.push(patch);},
    };
    const body = transpileModule(`
        let disposed = false, frozen = false, themeChoice, fontChoice, fontsChoice, destroyAppearanceForm;
        let appearance = {sources: {theme: ${JSON.stringify(source)}, fontSize: ${JSON.stringify(source)}, fonts: ${JSON.stringify(source)}},
            workspaces: [{id: "workspace", name: "Workspace"}], independent: {}, fontSize: 16};
        const bridge = {appearance: async patch => {
            await persist(patch);
            return {...appearance, sources: {...appearance.sources, ...patch.sources}, independent: {...appearance.independent, ...patch.independent}};
        }};
        ${sourceCode.slice(start, end)}
        workspaceChoices();
        return {drain: () => appearanceUpdates, state: () => appearance, freeze: () => {frozen = true;}, dispose: () => {disposed = true;}};
    `, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const application = new Function("deps", `with (deps) {${body}}`)(deps);
    return {application, choices, forms, patches, elements};
};

test("independent source opens once for every group, cancels without persisting, and saves only that source", async () => {
    for (const [label, group] of [["appearanceMode", "theme"], ["fontSize", "fontSize"], ["fontFamily", "fonts"]] as const) {
        const {application, choices, forms, patches, elements} = setup();
        assert.equal(choices.get(label).values.filter(item => item.value === "independent").length, 1);
        choices.get(label).onChange("independent");
        assert.equal(forms.length, 1);
        assert.equal(forms[0].group, group);
        assert.deepEqual(patches, []);
        forms[0].cancel();
        assert.equal(application.state().sources[group], "workspace");
        assert.deepEqual(patches, []);
        choices.get(label).onChange("independent");
        assert.equal(elements.get("markdownAppearancePanel").hidden, false, "reopening is visible after the previous form is destroyed");
        await forms[1].save({fontSize: 24});
        assert.deepEqual(patches, [{sources: {[group]: "independent"}, independent: {fontSize: 24}}]);
        assert.equal(application.state().sources[group], "independent");
    }
});

test("already selected independent entry reopens, workspace selection stays immediate and frozen input is ignored", async () => {
    const {application, choices, forms, patches} = setup("independent");
    choices.get("appearanceMode").onChange("independent");
    assert.equal(forms.length, 1);
    assert.deepEqual(patches, []);
    choices.get("appearanceMode").onChange("workspace");
    await application.drain();
    assert.deepEqual(patches, [{sources: {theme: "workspace"}}]);
    choices.get("appearanceMode").onChange("unknown");
    application.freeze();
    choices.get("appearanceMode").onChange("independent");
    choices.get("fontSize").onChange("workspace");
    assert.equal(forms.length, 1);
    assert.equal(patches.length, 1);
});

test("modal settings stop document and sidebar shortcuts at the capture handler", () => {
    const source = readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const start = source.indexOf("    const shortcut = (event: KeyboardEvent) => {");
    const end = source.indexOf('    document.addEventListener("keydown", shortcut, true);', start);
    const body = transpileModule(source.slice(start, end), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    let calls = 0;
    const handler = new Function("control", "sidebarShortcuts", `${body}; return shortcut;`)(
        () => ({open: true}), {handle() {calls++; return true;}},
    );
    for (const key of ["n", "o", "s", "b"]) handler({key, ctrlKey: true});
    assert.equal(calls, 0);
});
