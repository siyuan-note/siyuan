import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

class NodeStub {
    id = "";
    textContent = "";
    className = "";
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    children: NodeStub[] = [];
    parent: NodeStub;
    classes = new Set<string>();
    classList = {toggle: (key: string, enabled: boolean) => { if (enabled) { this.classes.add(key); } else { this.classes.delete(key); } }};
    checked = false;
    disabled = false;
    value = "";
    get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1]; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    getAttribute(key: string) { return this.attributes[key] || null; }
    hasAttribute(key: string) { return key === "data-choice-feedback" ? !!this.dataset.choiceFeedback : key in this.attributes; }
    appendChild(node: NodeStub) { node.parent = this; this.children.push(node); }
    insertAdjacentElement(_position: string, node: NodeStub) {
        node.parent = this.parent;
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
    }
    closest() { return this.parent; }
    querySelector() { return this.children.find(node => node.dataset.choiceResult); }
    querySelectorAll() { return this.children.filter(node => node.dataset.choiceOption).flatMap(node => node.children); }
}

const setup = (correctIDs: string[], selectedIDs: string[], order = ["a", "b", "c"], mode = "multiple") => {
    const element = new NodeStub();
    const inputs = new Map<string, NodeStub>();
    order.forEach(id => {
        const option = new NodeStub();
        option.dataset.choiceOption = id;
        const input = new NodeStub();
        input.value = id;
        input.checked = selectedIDs.includes(id);
        input.setAttribute("aria-label", `Original ${id}`);
        input.setAttribute("aria-describedby", `existing-${id}`);
        option.appendChild(input);
        element.appendChild(option);
        inputs.set(id, input);
    });
    const source = readFileSync("src/card/flashcardV2Render.ts", "utf8");
    const snippet = source.slice(source.indexOf("export const prepareFlashcardV2Choice ="),
        source.indexOf("export const renderFlashcardV2MultiLine =")).replace("export const", "const");
    let uuid = 0;
    const context = {
        element, model: {source: {sourceType: "choice", generationConfig: {mode, correctOptionIDs: correctIDs}}},
        document: {createElement: () => new NodeStub()}, genUUID: () => String(++uuid),
        window: {siyuan: {languages: new Proxy({}, {get: (_object, key) => String(key)})}},
    };
    const prepare = () => runInNewContext(transpileModule(snippet +
        "\nprepareFlashcardV2Choice(element, model);", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {...context});
    const controller = prepare();
    return {element, inputs, controller, prepare,
        feedback: (id: string) => inputs.get(id).parent.nextElementSibling,
        summary: () => element.querySelector()};
};

test("single choice reports correct, incorrect and unanswered without changing selection", () => {
    for (const selected of [["a"], ["b"], []]) {
        const h = setup(["a"], selected, undefined, "single");
        const result = h.controller.check();
        assert.equal(result.correct, selected[0] === "a");
        assert.equal(h.summary().textContent, selected[0] === "a" ?
            "flashcardChoiceAnswerCorrect" : "flashcardChoiceAnswerIncorrect");
        assert.equal(h.feedback("a").textContent, selected[0] === "a" ?
            "flashcardChoiceCorrectSelected" : "flashcardChoiceCorrectUnselected");
        if (selected[0] === "b") { assert.equal(h.feedback("b").textContent, "flashcardChoiceIncorrectSelected"); }
        h.inputs.forEach((input, id) => {
            assert.equal(input.checked, selected.includes(id));
            assert.equal(input.disabled, true);
            assert.equal(input.getAttribute("aria-label"), `Original ${id}`);
        });
    }
});

test("multiple choice distinguishes omissions from incorrect selections with one live summary", () => {
    for (const selected of [["a"], ["a", "b", "c"], ["b", "a"]]) {
        const h = setup(["a", "b"], selected, ["c", "b", "a"]);
        const result = h.controller.check();
        assert.equal(result.correct, selected.length === 2);
        assert.equal(h.feedback("b").textContent, selected.includes("b") ?
            "flashcardChoiceCorrectSelected" : "flashcardChoiceCorrectUnselected");
        assert.deepEqual(h.element.children.filter(node => node.dataset.choiceOption).map(node => node.dataset.choiceOption), ["c", "b", "a"]);
        assert.equal(h.summary().getAttribute("role"), "status");
        const feedback = h.element.children.filter(node => node.dataset.choiceFeedback);
        assert.ok(feedback.every(node => !node.getAttribute("role") && !node.getAttribute("aria-live")));
        h.inputs.forEach((input, id) => {
            assert.ok(input.getAttribute("aria-describedby").includes(`existing-${id}`));
            const description = h.feedback(id);
            if (description?.dataset.choiceFeedback) {
                assert.ok(input.getAttribute("aria-describedby").split(" ").includes(description.id));
            }
        });
    }
});

test("repeated checks and preparation reuse descriptions and clear obsolete error feedback", () => {
    const h = setup(["a"], ["b"]);
    h.controller.check();
    const count = h.element.children.length;
    const description = h.inputs.get("b").getAttribute("aria-describedby");
    h.controller.check();
    h.prepare().check();
    assert.equal(h.element.children.length, count);
    assert.equal(h.inputs.get("b").getAttribute("aria-describedby"), description);
    h.inputs.get("b").checked = false;
    h.inputs.get("a").checked = true;
    const result = h.controller.check();
    assert.equal(result.correct, true);
    assert.equal(h.feedback("b").textContent, "");
    assert.ok(h.feedback("b").classes.has("fn__none"));
    assert.equal(h.element.children.filter(node => node.dataset.choiceResult).length, 1);
});
