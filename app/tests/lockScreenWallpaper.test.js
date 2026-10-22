const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");

const sources = ["stage/auth.html", "electron/remote-auth.html"].map(file => ({file,
    source: readFileSync(file, "utf8"),
}));
const loader = source => /const loadLockScreenWallpaper = \(\) => \{[\s\S]*?\n {4}\};/.exec(source)[0];

const fixture = (source, passwordVisible = true) => {
    const classes = new Set();
    const listeners = new Map();
    const windowListeners = new Map();
    const timers = new Map();
    let timerID = 0;
    let focused;
    let now = Date.UTC(2026, 9, 22, 12, 59);
    const input = {type: "password", value: "", selectionStart: 0, selectionEnd: 0,
        getClientRects: () => passwordVisible ? [{}] : [],
        focus: () => { focused = "password"; },
        setRangeText: text => { input.value += text; }, dispatchEvent: () => {},
    };
    const oidc = {getClientRects: () => [{}], focus: () => { focused = "oidc"; }};
    const panel = {inert: false, querySelectorAll: () => [oidc]};
    const cover = {hidden: true, focus: () => { focused = "cover"; },
        addEventListener: (type, callback) => listeners.set("cover:" + type, callback)};
    const wallpaper = {hidden: true};
    const background = {hidden: false};
    const time = {textContent: ""};
    const date = {textContent: ""};
    const elements = {lockScreenWallpaper: wallpaper, lockScreenCover: cover, authPanel: panel,
        authCode: input, authDefaultBackground: background, lockScreenTime: time, lockScreenDate: date};
    const document = {
        hidden: false,
        body: {classList: {add: key => classes.add(key), remove: key => classes.delete(key)}},
        getElementById: id => elements[id],
        addEventListener: (type, callback) => listeners.set(type, callback),
    };
    class Clock extends Date {
        constructor() { super(now); }
    }
    const context = {document, Date: Clock, Event: class {},
        window: {addEventListener: (type, callback) => windowListeners.set(type, callback)},
        clearInterval: id => timers.delete(id),
        setInterval: callback => { timers.set(++timerID, callback); return timerID; },
    };
    runInNewContext(loader(source) + "\nthis.controller = loadLockScreenWallpaper();", context);
    const key = (key, extra = {}) => {
        const event = {key, prevented: false, stopped: false,
            preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra};
        listeners.get("keydown")(event);
        return event;
    };
    return {classes, listeners, windowListeners, timers, document, input, panel, cover, wallpaper, background, time, date,
        controller: context.controller, key, focused: () => focused, advance: () => { now += 60_000; }};
};

test("both authentication pages share the wallpaper interaction and clock implementation", () => {
    assert.equal(loader(sources[0].source), loader(sources[1].source));
});

test("the password Enter handler waits for IME composition to finish", () => {
    const handler = /inputElement.addEventListener\('keydown', \(event\) => \{[\s\S]*?\n {8}\}\)/.exec(sources[0].source);
    assert.ok(handler);
    let keydown;
    let submits = 0;
    runInNewContext(handler[0], {inputElement: {addEventListener: (_type, callback) => { keydown = callback; }},
        submitAuth: () => submits++});
    keydown({key: "Enter", isComposing: true});
    assert.equal(submits, 0);
    keydown({key: "Enter", isComposing: false});
    assert.equal(submits, 1);
});

for (const {file, source} of sources) {
    test(`${file} shows a clock cover and keeps the first typed password character`, () => {
        const f = fixture(source);
        f.controller.focus();
        assert.equal(f.focused(), undefined);
        assert.equal(f.wallpaper.src, "/api/system/getLockScreenWallpaper");
        f.wallpaper.onload();
        assert.equal(f.cover.hidden, false);
        assert.equal(f.panel.inert, true);
        assert.ok(f.classes.has("wallpaper-cover"));
        assert.ok(f.classes.has("has-wallpaper"));
        assert.ok(f.time.textContent && f.date.textContent);
        const event = f.key("A");
        assert.ok(event.prevented && event.stopped);
        assert.equal(f.input.value, "A");
        assert.equal(f.focused(), "password");
        assert.equal(f.cover.hidden, true);
        assert.equal(f.panel.inert, false);
        assert.equal(f.timers.size, 0);
        assert.equal(f.key("b").prevented, false);
        assert.equal(f.input.value, "A", "subsequent input is left to the browser");
    });

    test(`${file} wakes with click, touch, Enter, Space and Tab without submitting`, () => {
        for (const key of ["Enter", " ", "Tab"]) {
            const f = fixture(source);
            f.wallpaper.onload();
            const event = f.key(key);
            assert.ok(event.prevented && event.stopped);
            assert.equal(f.cover.hidden, true);
            assert.equal(f.input.value, "");
        }
        for (const pointerType of ["mouse", "touch"]) {
            const f = fixture(source);
            f.wallpaper.onload();
            let prevented = false;
            f.listeners.get("pointerdown")({pointerType, target: {closest: () => false},
                preventDefault: () => { prevented = true; }});
            assert.equal(prevented, true, "native pointer focus must not override the password focus");
            assert.equal(f.cover.hidden, true);
            assert.equal(f.focused(), "password");
        }
        const f = fixture(source);
        f.wallpaper.onload();
        f.listeners.get("cover:click")();
        assert.equal(f.cover.hidden, true);
    });

    test(`${file} respects window controls, shortcuts, IME and OIDC-only sign-in`, () => {
        const f = fixture(source);
        f.wallpaper.onload();
        f.listeners.get("pointerdown")({target: {closest: () => true}});
        assert.equal(f.cover.hidden, false);
        assert.equal(f.key("w", {ctrlKey: true}).prevented, false);
        assert.equal(f.cover.hidden, false);
        assert.equal(f.key("Process", {isComposing: true}).prevented, false);
        assert.equal(f.cover.hidden, true);
        assert.equal(f.input.value, "");
        const paste = fixture(source);
        paste.wallpaper.onload();
        assert.equal(paste.key("v", {ctrlKey: true}).prevented, false);
        assert.equal(paste.cover.hidden, true);
        assert.equal(paste.focused(), "password");
        assert.equal(paste.input.value, "");
        const oidc = fixture(source, false);
        oidc.wallpaper.onload();
        oidc.key("Enter");
        assert.equal(oidc.focused(), "oidc");
        assert.equal(oidc.input.value, "");
    });

    test(`${file} never covers input that started before the wallpaper arrived`, () => {
        const f = fixture(source);
        assert.equal(f.key("a").prevented, false);
        assert.equal(f.focused(), "password", "typing during image loading already targets the password input");
        f.input.value = "already typing";
        f.wallpaper.onload();
        assert.equal(f.cover.hidden, true);
        assert.equal(f.panel.inert, false);
        assert.equal(f.timers.size, 0);
        const autofill = fixture(source);
        autofill.input.value = "filled by password manager";
        autofill.wallpaper.onload();
        assert.equal(autofill.cover.hidden, true);
    });

    test(`${file} restores login after a missing or corrupt wallpaper`, () => {
        for (const loaded of [false, true]) {
            const f = fixture(source);
            if (loaded) f.wallpaper.onload();
            f.wallpaper.onerror();
            assert.equal(f.cover.hidden, true);
            assert.equal(f.panel.inert, false);
            assert.equal(f.background.hidden, false);
            assert.equal(f.wallpaper.hidden, true);
            assert.equal(f.classes.has("wallpaper-cover"), false);
            assert.equal(f.classes.has("has-wallpaper"), false);
            assert.equal(f.focused(), "password");
            assert.equal(f.timers.size, 0);
        }
    });

    test(`${file} refreshes local time and suspends the clock outside the cover`, () => {
        const f = fixture(source);
        f.wallpaper.onload();
        const before = f.time.textContent;
        f.advance();
        [...f.timers.values()][0]();
        assert.notEqual(f.time.textContent, before);
        f.document.hidden = true;
        f.listeners.get("visibilitychange")();
        assert.equal(f.timers.size, 0);
        f.document.hidden = false;
        f.listeners.get("visibilitychange")();
        assert.equal(f.timers.size, 1);
        f.windowListeners.get("pagehide")();
        assert.equal(f.timers.size, 0);
        f.windowListeners.get("pageshow")();
        assert.equal(f.timers.size, 1);
        f.key("Enter");
        f.listeners.get("visibilitychange")();
        assert.equal(f.timers.size, 0);
    });
}
