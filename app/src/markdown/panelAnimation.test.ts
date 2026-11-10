import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownPanelAnimation} from "./panelAnimation";

class Style {
    values = new Map<string, {value: string; priority: string}>();
    getPropertyValue(property: string) {return this.values.get(property)?.value ?? "";}
    getPropertyPriority(property: string) {return this.values.get(property)?.priority ?? "";}
    setProperty(property: string, value: string, priority = "") {this.values.set(property, {value, priority});}
    removeProperty(property: string) {const value = this.getPropertyValue(property); this.values.delete(property); return value;}
}

class Motion {
    matches = false;
    listeners = new Set<() => void>();
    addEventListener(_type: string, listener: () => void) {this.listeners.add(listener);}
    removeEventListener(_type: string, listener: () => void) {this.listeners.delete(listener);}
    reduce() {this.matches = true; this.listeners.forEach(listener => listener());}
}

class AnimationDouble {
    onfinish: () => void;
    oncancel: () => void;
    cancelled = false;
    frame: Keyframe;
    constructor(readonly frames: Keyframe[], readonly timing: KeyframeAnimationOptions) {this.frame = frames[0];}
    cancel() {this.cancelled = true; this.oncancel?.();}
    finish() {this.onfinish?.();}
}

class ElementDouble {
    readonly style = new Style();
    readonly attributes = new Map<string, string>();
    readonly animations: AnimationDouble[] = [];
    naturalWidth = 251;
    unconstrainedWidth: number;
    failAnimation = false;
    baseline: Record<string, string> = {display: "block", opacity: "1", transform: "none", direction: "ltr",
        "box-sizing": "content-box", "max-width": "none",
        "padding-left": "0px", "padding-right": "0px", "border-left-width": "0px", "border-right-width": "1px"};
    constructor(readonly ownerDocument: {defaultView: unknown}) {}
    get hidden() {return this.attributes.has("hidden");}
    set hidden(value: boolean) {if (value) this.attributes.set("hidden", ""); else this.attributes.delete("hidden");}
    getAttribute(name: string) {return this.attributes.get(name) ?? null;}
    setAttribute(name: string, value: string) {this.attributes.set(name, value);}
    removeAttribute(name: string) {this.attributes.delete(name);}
    computed(property: string): string {
        const key = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
        const animation = [...this.animations].reverse().find(item => !item.cancelled && item.frame[key] !== undefined);
        return animation ? String(animation.frame[key]) : this.style.getPropertyValue(property) || this.baseline[property] || "";
    }
    getBoundingClientRect() {
        return {width: this.hidden || this.computed("display") === "none" ? 0 :
            parseFloat(this.computed("width")) || (this.computed("max-width") === "none" ?
                this.unconstrainedWidth ?? this.naturalWidth : this.naturalWidth)};
    }
    animate(frames: Keyframe[], timing: KeyframeAnimationOptions) {
        if (this.failAnimation) throw new Error("Animation unavailable");
        const animation = new AnimationDouble(frames, timing);
        this.animations.push(animation);
        return animation;
    }
    dom() {return this as unknown as HTMLElement;}
}

const fixture = (hideWithAttribute = false) => {
    const motion = new Motion();
    const view = {matchMedia: () => motion, getComputedStyle: (element: ElementDouble) => ({
        getPropertyValue: (property: string) => element.computed(property),
    })};
    const panel = new ElementDouble({defaultView: view});
    const surface = new ElementDouble({defaultView: view});
    const calls: boolean[] = [];
    const reversals: boolean[] = [];
    const controller = createMarkdownPanelAnimation({element: panel.dom(), applyVisible(visible, {reversing}) {
        calls.push(visible);
        reversals.push(reversing);
        if (hideWithAttribute) panel.hidden = !visible;
        else panel.style.setProperty("display", visible ? "block" : "none");
        surface.style.setProperty("padding-left", visible ? "35px" : "160px");
        surface.style.setProperty("padding-right", visible ? "35px" : "160px");
    }, styleTargets: () => [{element: surface.dom(), properties: ["padding-left", "padding-right"]}]});
    return {panel, surface, calls, reversals, controller, motion};
};

test("panel initialization and repeated targets do not animate or reapply visibility", () => {
    const {controller, panel, calls} = fixture();
    controller.setVisible(false, {animate: true});
    controller.setVisible(false, {animate: true});
    assert.deepEqual(calls, [false]);
    assert.equal(panel.animations.length, 0);
    controller.destroy();
});

test("opening animates the measured border box and specified padding on one lifecycle", () => {
    const {controller, panel, surface, calls} = fixture();
    panel.naturalWidth = 201;
    panel.style.setProperty("max-width", "40%", "important");
    controller.setVisible(false);
    controller.setVisible(true, {animate: true});
    const animation = panel.animations[0];
    assert.equal(animation.frames[0].width, "0px");
    assert.equal(animation.frames[1].width, "201px");
    assert.equal(animation.frames[0].borderRightWidth, "0px");
    assert.equal(animation.frames[1].borderRightWidth, "1px");
    assert.deepEqual(surface.animations[0].frames, [{paddingLeft: "160px", paddingRight: "160px"},
        {paddingLeft: "35px", paddingRight: "35px"}]);
    assert.deepEqual(surface.animations[0].timing, animation.timing);
    assert.equal(panel.style.getPropertyValue("box-sizing"), "border-box");
    assert.equal(panel.style.getPropertyValue("max-width"), "calc(40% + 1px)");
    controller.setVisible(true);
    assert.equal(animation.cancelled, false, "resize observers cannot cancel an unchanged target");
    animation.finish();
    assert.equal(panel.style.getPropertyValue("max-width"), "40%");
    assert.equal(panel.style.getPropertyPriority("max-width"), "important");
    assert.equal(panel.style.getPropertyValue("box-sizing"), "");
    assert.equal(panel.style.getPropertyValue("display"), "block");
    assert.ok(surface.animations[0].cancelled);
    assert.deepEqual(calls, [false, true], "completion never calls native visibility again");
    controller.destroy();
});

test("closing retains painting and restores either native display or hidden at completion", () => {
    for (const attribute of [false, true]) {
        const {controller, panel, calls} = fixture(attribute);
        controller.setVisible(true);
        controller.setVisible(false, {animate: true});
        assert.equal(panel.hidden, false);
        assert.equal(panel.computed("display"), "block");
        assert.equal(panel.animations[0].frames[1].width, "0px");
        assert.equal(panel.animations[0].frames[1].borderRightWidth, "0px");
        panel.animations[0].finish();
        assert.equal(attribute ? panel.hidden : panel.style.getPropertyValue("display") === "none", true);
        assert.deepEqual(calls, [true, false]);
        controller.destroy();
    }
});

test("border-box panels retain their responsive width limit during animation", () => {
    const {controller, panel} = fixture(true);
    panel.baseline["box-sizing"] = "border-box";
    panel.style.setProperty("max-width", "60%");
    controller.setVisible(false);
    controller.setVisible(true, {animate: true});
    assert.equal(panel.style.getPropertyValue("max-width"), "60%");
    panel.animations[0].finish();
    assert.equal(panel.style.getPropertyValue("max-width"), "60%");
    controller.destroy();
});

test("rapid reversals start at rendered values and stale completion cannot hide a newer target", () => {
    const {controller, panel, surface, reversals} = fixture();
    controller.setVisible(true);
    controller.setVisible(false, {animate: true});
    const old = panel.animations[0];
    const staleFinish = old.onfinish;
    const staleCancel = old.oncancel;
    old.frame = {...old.frames[0], width: "92px", opacity: ".4", borderRightWidth: ".4px"};
    surface.animations[0].frame = {paddingLeft: "110px", paddingRight: "110px"};
    controller.setVisible(true, {animate: true});
    const next = panel.animations[1];
    assert.equal(next.frames[0].width, "92px");
    assert.equal(next.frames[0].opacity, ".4");
    assert.equal(next.frames[0].borderRightWidth, ".4px");
    assert.equal(surface.animations[1].frames[0].paddingLeft, "110px");
    assert.deepEqual(reversals, [false, false, true]);
    staleFinish(); staleCancel();
    assert.equal(next.cancelled, false);
    assert.equal(panel.style.getPropertyValue("display"), "block");
    next.finish();
    assert.equal(panel.style.getPropertyValue("display"), "block");
    controller.destroy();
});

test("opening targets natural width while the responsive cap follows a growing parent", () => {
    const {controller, panel, reversals} = fixture();
    panel.naturalWidth = 185;
    panel.unconstrainedWidth = 251;
    panel.style.setProperty("max-width", "40%");
    controller.setVisible(false);
    controller.setVisible(true, {animate: true});
    const opening = panel.animations[0];
    assert.equal(opening.frames[1].width, "251px");
    assert.equal(panel.style.getPropertyValue("max-width"), "calc(40% + 1px)");
    panel.naturalWidth = 251;
    opening.frame = opening.frames[1];
    const before = panel.getBoundingClientRect().width;
    opening.finish();
    assert.equal(panel.getBoundingClientRect().width, before);
    controller.setVisible(false, {animate: true});
    panel.animations[1].finish();
    controller.setVisible(true, {animate: true});
    assert.equal(reversals.at(-1), false, "an ordinary reopen is not a reversal");
    controller.destroy();
});

test("drawer motion uses directional transform without changing layout width", () => {
    for (const direction of ["ltr", "rtl"]) {
        const {controller, panel} = fixture(true);
        panel.baseline.direction = direction;
        controller.setVisible(false);
        controller.setVisible(true, {animate: true, drawer: true});
        const opening = panel.animations[0];
        assert.equal(opening.frames[0].transform, `translateX(${direction === "rtl" ? "" : "-"}251px)`);
        assert.equal(opening.frames[1].transform, "none");
        assert.equal(opening.frames[0].width, undefined);
        assert.equal(panel.style.getPropertyValue("box-sizing"), "");
        opening.frame = {...opening.frames[0], transform: "matrix(1, 0, 0, 1, -80, 0)", opacity: ".6"};
        controller.setVisible(false, {animate: true, drawer: true});
        assert.equal(panel.animations[1].frames[0].transform, "matrix(1, 0, 0, 1, -80, 0)");
        panel.animations[1].finish();
        assert.equal(panel.hidden, true);
        controller.destroy();
    }
});

test("reduced motion, forced synchronization and destruction settle without leftover effects", () => {
    const {controller, panel, surface, motion, calls} = fixture();
    controller.setVisible(true);
    controller.setVisible(false, {animate: true});
    motion.reduce();
    assert.equal(panel.style.getPropertyValue("display"), "none");
    assert.ok(panel.animations[0].cancelled && surface.animations[0].cancelled);
    controller.setVisible(true, {animate: true});
    assert.equal(panel.animations.length, 1);
    motion.matches = false;
    controller.setVisible(false, {animate: true});
    controller.setVisible(false, {force: true});
    assert.equal(panel.style.getPropertyValue("display"), "none");
    assert.ok(panel.animations[1].cancelled);
    controller.setVisible(true, {animate: true});
    const stale = panel.animations[2].onfinish;
    controller.destroy(); controller.destroy(); stale();
    assert.equal(panel.style.getPropertyValue("display"), "block");
    assert.ok(panel.animations[2].cancelled);
    assert.equal(motion.listeners.size, 0);
    const count = calls.length;
    controller.setVisible(false);
    assert.equal(calls.length, count);
});

test("animation failures restore the native target and temporary styles", () => {
    for (const failSurface of [false, true]) {
        const {controller, panel, surface} = fixture();
        controller.setVisible(true);
        if (failSurface) surface.failAnimation = true;
        else panel.failAnimation = true;
        controller.setVisible(false, {animate: true});
        assert.equal(panel.style.getPropertyValue("display"), "none");
        assert.equal(panel.style.getPropertyValue("overflow"), "");
        assert.equal(panel.style.getPropertyValue("box-sizing"), "");
        assert.ok(panel.animations.every(animation => animation.cancelled));
        controller.destroy();
    }
});

test("missing animation support and zero-size panels keep immediate native behavior", () => {
    for (const unavailable of [false, true]) {
        const {controller, panel, calls} = fixture(true);
        if (unavailable) Object.defineProperty(panel, "animate", {value: undefined});
        else panel.naturalWidth = 0;
        controller.setVisible(false);
        controller.setVisible(true, {animate: true});
        assert.equal(panel.hidden, false);
        assert.equal(panel.animations.length, 0);
        assert.equal(panel.style.getPropertyValue("overflow"), "");
        assert.deepEqual(calls, [false, true]);
        controller.destroy();
    }
});

test("native cancellation settles all related effects and force can change the target immediately", () => {
    const {controller, panel, surface} = fixture(true);
    controller.setVisible(false);
    controller.setVisible(true, {animate: true});
    surface.animations[0].cancel();
    assert.equal(panel.hidden, false);
    assert.ok(panel.animations[0].cancelled);
    controller.setVisible(false, {animate: true});
    controller.setVisible(true, {animate: true, force: true});
    assert.equal(panel.hidden, false);
    assert.equal(panel.animations.length, 2);
    assert.ok(panel.animations[1].cancelled);
    assert.equal(panel.style.getPropertyValue("max-width"), "");
    controller.destroy();
});
