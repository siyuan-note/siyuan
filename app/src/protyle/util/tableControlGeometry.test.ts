import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {createSourceFile, isClassDeclaration, isConstructorDeclaration, isIfStatement, ScriptTarget, transpileModule} from "typescript";

test("mindmap table controls observe their own geometry and ancestor scrolling", () => {
    const file = path.join(__dirname, "tableControl.ts");
    const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
    const declaration = source.statements.find(statement => isClassDeclaration(statement) && statement.name?.text === "TableControl");
    assert.ok(declaration && isClassDeclaration(declaration));
    const constructor = declaration.members.find(isConstructorDeclaration);
    const statement = constructor.body.statements.find(item => isIfStatement(item) &&
        item.expression.getText(source) === 'protyle.element.closest(".mindmap-view")');
    assert.ok(statement);
    const code = transpileModule(statement.getText(source), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    class TestNode {
        constructor(private children: TestNode[] = []) {}
        contains(node: TestNode): boolean {
            return this === node || this.children.some(child => child.contains(node));
        }
    }
    for (const mindmap of [false, true]) {
        const world = new TestNode();
        const node = new TestNode();
        const element = Object.assign(new TestNode(), {closest: (selector: string) => mindmap ?
            selector === ".mindmap-view__world" ? world : selector === ".mindmap-view__node" ? node : new TestNode() : null});
        const observations: Array<{target: TestNode, options: MutationObserverInit}> = [];
        const events: Array<{type: string, callback: (event: {target: unknown}) => void, options: AddEventListenerOptions}> = [];
        const abortController = new AbortController();
        let renders = 0;
        new Function("protyle", "document", "Node", code).call({
            observer: {observe: (target: TestNode, options: MutationObserverInit) => observations.push({target, options})},
            abortController, scheduleRender: () => renders++,
        }, {element}, {addEventListener: (type: string, callback: typeof events[number]["callback"], options: AddEventListenerOptions) =>
            events.push({type, callback, options})}, TestNode);
        assert.deepEqual(observations.map(item => item.target), mindmap ? [world, node] : []);
        observations.forEach(item => assert.deepEqual(item.options, {attributes: true, attributeFilter: ["style"]}));
        assert.equal(events.length, mindmap ? 1 : 0, "ordinary editors do not acquire extra document listeners");
        if (mindmap) {
            assert.equal(events[0].type, "scroll");
            assert.equal(events[0].options.capture, true);
            assert.equal(events[0].options.signal, abortController.signal, "destroy releases the ancestor scroll listener");
            events[0].callback({target: new TestNode([element])});
            assert.equal(renders, 1, "ancestor scroll refreshes screen coordinates");
            events[0].callback({target: new TestNode()});
            events[0].callback({target: {}});
            assert.equal(renders, 1, "unrelated scroll events do not schedule work");
        }
    }
});
