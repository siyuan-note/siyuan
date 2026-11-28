import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

test("card source menu omits quick creation and keeps the question-answer handler", () => {
    const source = readFileSync("src/card/makeCard.ts", "utf8");
    const snippet = source.slice(source.indexOf("export const flashcardSourceMenuItems"),
        source.indexOf("export const quickMakeCard")).replace("export const", "const");
    const code = transpileModule(snippet + "\nflashcardSourceMenuItems(ids);", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    for (const ids of [[], ["a"], ["a", "b"], ["a", "b", "c"]]) {
        const calls: string[][] = [];
        const actions: IMenu[] = runInNewContext(code, {
            ids, window: {siyuan: {languages: {flashcardQA: "Question and answer"}}},
            openFlashcardV2BasicSource: (blockIDs: string[]) => { calls.push(blockIDs); },
        });
        assert.deepEqual(Array.from(actions, item => item.id), ["basic", "advanced"]);
        const basic = actions.find(item => item.id === "basic");
        assert.equal(basic.ignore, ids.length < 2);
        assert.equal(actions.find(item => item.id === "advanced").ignore, ids.length === 0);
        if (!basic.ignore) {
            assert.equal(basic.label, "Question and answer");
            basic.click(null, null);
            assert.equal(calls[0], ids);
        }
    }
});

test("basic source dialog uses the entry title without changing direction defaults or submitted value", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const basic = source.slice(source.indexOf("export const openFlashcardV2BasicSource ="),
        source.indexOf("interface IFlashcardV2AdvancedGenerationConfig"));
    const start = basic.indexOf("title:");
    const title = basic.slice(start, basic.indexOf("width:", start));
    assert.equal(runInNewContext(`({${title}}).title`, {
        window: {siyuan: {languages: {flashcardQA: "Question and answer", riffCard: "Flashcards"}}},
    }), "Question and answer");
    const select = basic.slice(basic.indexOf('<select data-type="direction"'), basic.indexOf("</select>"));
    assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]),
        ["forward", "reverse", "bidirectional", "closed"]);
    assert.doesNotMatch(select, /\sselected/);
    const extraction = basic.slice(basic.indexOf("const direction ="), basic.indexOf("const operation =", basic.indexOf("const direction =")));
    for (const direction of ["forward", "reverse", "bidirectional", "closed"]) {
        const payload = runInNewContext(transpileModule(extraction + "\npayload;", {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, {dialog: {element: {querySelector: () => ({value: direction})}},
            sourceID: "source", blockIDs: ["question", "answer"], reviewSets: {selectedOptions: []}});
        assert.equal(payload.direction, direction);
    }
});

test("source badge previews and manages only cards whose source block owns the badge", async () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const direction = source.slice(source.indexOf("const basicSourceDirection ="), source.indexOf("const openFlashcardV2Direction ="));
    const snippet = source.slice(source.indexOf("export const openFlashcardV2BadgeMenu ="),
        source.indexOf("export const openFlashcardV2SourceMode =")).replace("export const", "const");
    const code = transpileModule(direction + snippet + "\nopenFlashcardV2BadgeMenu(anchor, 'origin', true);", {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const items: IMenu[] = [];
    const opened: string[][] = [];
    const changes: Array<{path: string, options: {direction?: string, sourceID?: string, action?: string, cardIDs?: string[]}}> = [];
    const result = (id: string, variantKey: string, generationStatus = "active", sourceBlockID = "origin") => ({
        card: {id, sourceID: "qa-source", variantKey, generationStatus}, sourceType: "qa", sourceStatus: "active",
        sourceBlockID, reviewState: {suspended: true},
    });
    const lang = {flashcardPreview: "Preview", flashcardDirectionSettings: "Direction", flashcardDirectionForward: "Forward",
        flashcardDirectionReverse: "Reverse", flashcardDirectionBidirectional: "Both", flashcardResumeReview: "Resume"};
    runInNewContext(code, {
        window: {siyuan: {languages: lang}}, anchor: {isConnected: true, getBoundingClientRect: () => ({left: 5, bottom: 8})},
        toggleMenu: ({build}: {build: (menu: unknown, session: unknown) => Promise<void>}) => build(undefined,
            {isCurrent: () => true, show: (show: () => void) => show()}),
        Menu: class {
            element = {querySelector: () => items[0]};
            addItem(item: IMenu) { items.push(item); }
            open() {}
        },
        fetchFlashcardV2Data: async () => ({cards: [result("f", "forward"), result("r", "reverse", "disabledByTemplate"),
            result("unrelated", "forward", "active", "other")]}),
        flashcardV2SourceTypeLabels: () => ({}), advancedSourceTypes: [], isMobile: () => false, genUUID: () => "operation",
        openFlashcardV2Preview: (ids: string[]) => opened.push(ids),
        fetchPost: (path: string, options: typeof changes[number]["options"]) => changes.push({path, options}),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(items.map(item => item.label), ["Preview", "Direction", "Resume"]);
    items[0].click(null, null);
    items[2].click(null, null);
    assert.deepEqual([...opened[0]], ["f"]);
    assert.equal(changes[0].options.action, "resume");
    assert.deepEqual([...changes[0].options.cardIDs], ["f"]);
    assert.deepEqual(Array.from(items[1].submenu, item => [item.label, item.checked]),
        [["Forward", true], ["Reverse", false], ["Both", false]]);
    (items[1].submenu as IMenu[])[2].click(null, null);
    assert.equal(changes[1].options.sourceID, "qa-source");
    assert.equal(changes[1].options.direction, "bidirectional");
});
