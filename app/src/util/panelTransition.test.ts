import {readFileSync} from "node:fs";
import {join} from "node:path";
import {it} from "node:test";
import * as assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

class Transition {
    transitionProperty = "transform";
    playState = "running";
    pending = false;
}

class MouseAction extends Event {
    constructor(type: string, public detail = 1) {
        super(type, {cancelable: true});
    }
}

const fixture = () => {
    const exports: {bindPanelTransitionGuard?: (element: object, enabled: () => boolean) => void} = {};
    const source = transpileModule(readFileSync(join(__dirname, "panelTransition.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {exports, CSSTransition: Transition, MouseEvent: MouseAction});
    const animations: Transition[] = [];
    const element = Object.assign(new EventTarget(), {getAnimations: () => animations});
    let enabled = true;
    let activations = 0;
    exports.bindPanelTransitionGuard(element, () => enabled);
    element.addEventListener("click", () => activations++);
    const send = (type: string, detail = 1) => {
        const event = new MouseAction(type, detail);
        element.dispatchEvent(event);
        return event.defaultPrevented;
    };
    const command = () => element.dispatchEvent(Object.assign(new Event("click", {cancelable: true}), {detail: "file"}));
    return {animations, send, command, disable: () => enabled = false, activations: () => activations};
};

it("blocks item activation while a panel slides in or out", () => {
    for (const type of ["pointerdown", "touchstart", "mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
        const panel = fixture();
        panel.animations.push(new Transition());
        assert.equal(panel.send(type), true, type);
        assert.equal(panel.activations(), 0);
    }
});

it("consumes a press started during movement even when its click arrives after settling", () => {
    for (const type of ["pointerdown", "touchstart", "mousedown"]) {
        const panel = fixture();
        panel.animations.push(new Transition());
        panel.send(type);
        panel.animations.length = 0;
        assert.equal(panel.send("mouseup"), true);
        assert.equal(panel.send("click"), true);
        assert.equal(panel.activations(), 0);
        assert.equal(panel.send("pointerdown"), false);
        assert.equal(panel.send("click"), false);
        assert.equal(panel.activations(), 1);
    }
});

it("allows stable, cancelled, and zero-duration panels without a delay", () => {
    for (const playState of [undefined, "finished", "idle"]) {
        const panel = fixture();
        if (playState) {
            const transition = new Transition();
            transition.playState = playState;
            panel.animations.push(transition);
        }
        assert.equal(panel.send("click"), false);
        assert.equal(panel.activations(), 1);
    }
});

it("preserves stable keyboard activation and ignores opacity-only or disabled guards", () => {
    const panel = fixture();
    const transition = new Transition();
    panel.animations.push(transition);
    panel.send("touchstart");
    panel.animations.length = 0;
    assert.equal(panel.send("click", 0), false);
    assert.equal(panel.activations(), 1);
    transition.transitionProperty = "opacity";
    panel.animations.push(transition);
    panel.send("pointerdown");
    assert.equal(panel.send("click"), false);
    transition.transitionProperty = "transform";
    panel.disable();
    assert.equal(panel.send("click"), false);
    assert.equal(panel.activations(), 3);
});

it("keeps mobile sidebar rendering commands available during movement", () => {
    const panel = fixture();
    panel.animations.push(new Transition());
    panel.send("touchstart");
    assert.equal(panel.command(), true);
    assert.equal(panel.activations(), 1);
});
