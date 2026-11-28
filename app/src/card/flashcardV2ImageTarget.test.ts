import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

class ElementStub {
    className = "";
    textContent = "";
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    removed = false;
    parentElement: ElementStub;
    listeners = new Map<string, () => void>();
    classList = {
        add: (value: string) => { this.className += " " + value; },
        remove: (value: string) => { this.className = this.className.split(" ").filter(item => item !== value).join(" "); },
        toggle: (value: string, enabled: boolean) => {
            if (enabled) { this.classList.add(value); } else { this.classList.remove(value); }
        },
    };
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
    removeAttribute(name: string) { delete this.attributes[name]; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    getAttribute(name: string) { return this.attributes[name]; }
    closest(): null { return null; }
    insertBefore(child: ElementStub) { this.appendChild(child); }
    appendChild(child: ElementStub) { child.parentElement = this; this.children.push(child); }
    insertAdjacentElement(_position: string, child: ElementStub) { this.parentElement.appendChild(child); }
    querySelectorAll() { return this.children.filter(child => child.dataset.shapeId); }
    remove() { this.removed = true; }
}

const render = (frontMode: string, stepOrder?: string[]) => {
    const source = readFileSync("src/card/flashcardV2Render.ts", "utf8");
    const code = source.slice(source.lastIndexOf("const normalized =", source.indexOf("const shapeStyle =")),
        source.indexOf("export const prepareFlashcardV2Reveal ="));
    const parent = new ElementStub();
    const image = new ElementStub();
    image.attributes.src = "assets/image.png";
    parent.appendChild(image);
    const model = {source: {generationConfig: {
        assetID: "image.png", frontMode,
        groups: [{id: "current", shapeIDs: ["rect", "ellipse", "polygon"], stepOrder}],
        shapes: [
            {id: "rect", type: "rectangle", x: .1, y: .1, width: .2, height: .2, label: "Region <A>"},
            {id: "ellipse", type: "ellipse", x: .4, y: .1, width: .2, height: .2},
            {id: "polygon", type: "polygon", points: [{x: .1, y: .5}, {x: .2, y: .6}, {x: .3, y: .5}]},
            {id: "other", type: "rectangle", x: .7, y: .1, width: .2, height: .2},
        ],
    }}, card: {variantData: {groupID: "current"}}};
    const controls = new ElementStub();
    const focus: unknown[] = [];
    const controller = runInNewContext(transpileModule(code +
        "\nprepareImageOcclusions(element, model, bindFlashcardV2ImageViewport);", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {
        document: {createElement: () => new ElementStub()},
        window: {siyuan: {languages: {flashcardImageTarget: "Current answer", flashcardImageTargetTip: "Striped answer"}}},
        element: {querySelectorAll: () => [image]}, model,
        unique: (items: string[]) => [...new Set(items)],
        bindFlashcardV2ImageViewport: (_wrapper: unknown, _image: unknown, target: unknown) => {
            focus.push(target);
            return {controls, destroy: () => {}, setTarget: (next: unknown) => focus.push(next)};
        },
    });
    const wrapper = parent.children.find(child => child.className === "card__v2-image-occlusion");
    const hint = parent.children.find(child => child.textContent.startsWith("Striped answer"));
    return {controller, wrapper, hint, controls, focus};
};

test("all-hidden mode marks every current shape accessibly and keeps other groups neutral", () => {
    const {controller, wrapper, hint, controls} = render("hideAllAnswerOne");
    const shapes = wrapper.querySelectorAll();
    assert.equal(shapes.length, 4);
    for (const shape of shapes.slice(0, 3)) {
        assert.match(shape.className, /--target/);
        assert.equal(shape.attributes.role, "img");
        assert.equal(shape.attributes["aria-label"], shape === shapes[0] ? "Region <A>" : "Current answer");
    }
    assert.doesNotMatch(shapes[3].className, /--target/);
    assert.equal(shapes[3].attributes["aria-hidden"], "true");
    assert.ok(hint);
    const label = wrapper.children.find(child => child.className === "card__v2-image-mask-label");
    assert.equal(label.textContent, "Region <A>");
    controller.revealNext();
    assert.equal(label.removed, true);
    assert.ok(shapes.slice(0, 3).every(shape => shape.className.includes("--revealed") && shape.attributes["aria-hidden"] === "true"));
    assert.doesNotMatch(shapes[3].className, /--revealed|fn__none/);
    controls.children[0].listeners.get("click")();
    assert.match(shapes[3].className, /fn__none/);
    controls.children[0].listeners.get("click")();
    assert.doesNotMatch(shapes[3].className, /fn__none/);
    assert.equal(hint.removed, true);
});

test("current-only mode retains its visibility and non-color cue", () => {
    const {wrapper} = render("hideCurrent");
    assert.equal(wrapper.querySelectorAll().length, 3);
    assert.ok(wrapper.querySelectorAll().every(shape => shape.className.includes("--target")));
});

test("an ordered image card advances its focus and completes only after its final mask", () => {
    const {controller, wrapper, hint, focus} = render("hideAllAnswerOne", ["ellipse", "rect", "polygon"]);
    const [rect, ellipse, polygon, other] = wrapper.querySelectorAll();
    assert.match(ellipse.className, /--target/);
    assert.doesNotMatch(rect.className, /--target|--revealed/);
    assert.equal(controller.revealNext(), false);
    assert.match(ellipse.className, /--revealed/);
    assert.match(rect.className, /--target/);
    assert.equal(hint.textContent, "Striped answer 2 / 3");
    assert.equal(controller.revealNext(), false);
    assert.match(polygon.className, /--target/);
    assert.equal(controller.revealNext(), true);
    assert.equal(hint.removed, true);
    assert.doesNotMatch(other.className, /--revealed/);
    assert.deepEqual(focus.map(target => (target as {top: number}).top), [.1, .1, .5]);
});

test("target pattern overlays an opaque base and does not rely on clipped polygon borders", () => {
    const css = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    const shape = css.slice(css.indexOf("&__v2-image-shape"), css.indexOf("&__v2-image-editor"));
    assert.match(shape, /background-color: var\(--b3-theme-surface\)/);
    assert.match(shape, /background-color: var\(--b3-theme-primary\)/);
    assert.match(shape, /repeating-linear-gradient/);
    assert.doesNotMatch(shape, /opacity:/);
});
