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
        focus: () => { focused = "password"; document.activeElement = input; },
        setRangeText: text => { input.value += text; }, dispatchEvent: () => {},
    };
    const captcha = {type: "text", value: "", selectionStart: 0, selectionEnd: 0,
        getClientRects: () => [{}], focus: () => { focused = "captcha"; document.activeElement = captcha; },
        setRangeText: text => { captcha.value += text; }, dispatchEvent: () => {}};
    const oidc = {getClientRects: () => [{}], focus: () => { focused = "oidc"; document.activeElement = oidc; }};
    const panel = {inert: false, offsetTop: 0, querySelectorAll: () => [oidc],
        contains: item => [input, captcha, oidc].includes(item)};
    const properties = new Map();
    const attributes = new Map();
    const cover = {hidden: true, focus: () => { focused = "cover"; },
        style: {setProperty: (key, value) => properties.set(key, value)},
        setAttribute: (key, value) => attributes.set(key, value),
        addEventListener: (type, callback) => listeners.set("cover:" + type, callback)};
    const clock = {offsetHeight: 100};
    const wallpaper = {hidden: true};
    const background = {hidden: false};
    const time = {textContent: ""};
    const date = {textContent: ""};
    const elements = {lockScreenWallpaper: wallpaper, lockScreenCover: cover, authPanel: panel,
        authCode: input, captcha, authDefaultBackground: background, lockScreenTime: time, lockScreenDate: date,
        lockScreenClock: clock};
    const document = {
        hidden: false,
        activeElement: undefined,
        body: {classList: {add: key => classes.add(key), remove: (...keys) => keys.forEach(key => classes.delete(key))}},
        getElementById: id => elements[id],
        addEventListener: (type, callback) => listeners.set(type, callback),
    };
    class Clock extends Date {
        constructor() { super(now); }
    }
    const context = {document, Date: Clock, Event: class {},
        window: {innerHeight: 800, addEventListener: (type, callback) => windowListeners.set(type, callback)},
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
    return {classes, listeners, windowListeners, timers, document, input, captcha, panel, cover, wallpaper, background, time, date,
        properties, attributes,
        controller: context.controller, key, focused: () => focused, advance: () => { now += 60_000; }};
};

test("both authentication pages share the wallpaper interaction and clock implementation", () => {
    assert.equal(loader(sources[0].source), loader(sources[1].source));
});

test("authentication submits through the form without a separate password key handler", () => {
    const handler = /document.getElementById\('authForm'\).addEventListener\('submit', \(event\) => \{[\s\S]*?\n {4}\}\)/.exec(sources[0].source);
    assert.ok(handler);
    let submit;
    let submits = 0;
    let prevented = 0;
    runInNewContext(handler[0], {document: {getElementById: () => ({addEventListener: (_type, callback) => { submit = callback; }})},
        submitAuth: () => submits++});
    assert.equal(submits, 0);
    submit({preventDefault: () => prevented++});
    assert.equal(submits, 1);
    assert.equal(prevented, 1);
    // Native form submission handles Enter and IME; a second key handler would submit twice.
    assert.ok(!sources[0].source.includes("inputElement.addEventListener('keydown'"));
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
        assert.equal(f.cover.inert, true);
        assert.equal(f.attributes.get("aria-hidden"), "true");
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
            assert.equal(f.cover.inert, true);
            assert.equal(f.input.value, "");
        }
        for (const pointerType of ["mouse", "touch"]) {
            const f = fixture(source);
            f.wallpaper.onload();
            let prevented = false;
            f.listeners.get("pointerdown")({pointerType, target: {closest: () => false},
                preventDefault: () => { prevented = true; }});
            assert.equal(prevented, true, "native pointer focus must not override the password focus");
            assert.equal(f.cover.inert, true);
            assert.equal(f.focused(), "password");
        }
        const f = fixture(source);
        f.wallpaper.onload();
        f.listeners.get("cover:click")();
        assert.equal(f.cover.inert, true);
    });

    test(`${file} respects window controls, shortcuts, IME and OIDC-only sign-in`, () => {
        const f = fixture(source);
        f.wallpaper.onload();
        f.listeners.get("pointerdown")({target: {closest: () => true}});
        assert.equal(f.cover.hidden, false);
        assert.equal(f.key("w", {ctrlKey: true}).prevented, false);
        assert.equal(f.cover.hidden, false);
        assert.equal(f.key("Process", {isComposing: true}).prevented, false);
        assert.equal(f.cover.inert, true);
        assert.equal(f.input.value, "");
        const paste = fixture(source);
        paste.wallpaper.onload();
        assert.equal(paste.key("v", {ctrlKey: true}).prevented, false);
        assert.equal(paste.cover.inert, true);
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
        assert.equal(f.cover.inert, true);
        assert.equal(f.panel.inert, false);
        assert.equal(f.timers.size, 0);
        const autofill = fixture(source);
        autofill.input.value = "filled by password manager";
        autofill.wallpaper.onload();
        assert.equal(autofill.cover.inert, true);
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

    test(`${file} Escape returns to the clock without clearing password, captcha or the active field`, () => {
        const f = fixture(source);
        f.wallpaper.onload();
        f.key("p");
        f.captcha.value = "12";
        f.captcha.selectionStart = f.captcha.selectionEnd = 2;
        f.captcha.focus();
        const event = f.key("Escape");
        assert.ok(event.prevented && event.stopped);
        assert.equal(f.panel.inert, true);
        assert.equal(f.cover.inert, false);
        assert.equal(f.attributes.get("aria-hidden"), "false");
        assert.equal(f.focused(), "cover");
        assert.ok(f.classes.has("wallpaper-transition"));
        assert.ok(f.classes.has("wallpaper-cover"));
        assert.equal(f.input.value, "p");
        assert.equal(f.captcha.value, "12");
        assert.equal(f.captcha.selectionStart, 2);
        assert.equal(f.timers.size, 1);
        assert.equal(f.key("Escape").prevented, false, "Escape on the cover does not reopen the form");
        f.key("3");
        assert.equal(f.focused(), "captcha");
        assert.equal(f.captcha.value, "123");
        assert.equal(f.panel.inert, false);
        for (let i = 0; i < 3; i++) { f.key("Escape"); f.key("Enter"); }
        assert.equal(f.panel.inert, false, "rapid reversals leave the last requested state active");
        assert.equal(f.captcha.value, "123");
    });

    test(`${file} Escape respects IME, modified shortcuts and the default login page`, () => {
        const f = fixture(source);
        assert.equal(f.key("Escape").prevented, false);
        f.wallpaper.onload();
        f.key("Enter");
        for (const extra of [{isComposing: true}, {keyCode: 229}, {ctrlKey: true}, {altKey: true}, {metaKey: true}]) {
            assert.equal(f.key("Escape", extra).prevented, false);
            assert.equal(f.panel.inert, false);
        }
        f.listeners.get("compositionstart")();
        assert.equal(f.key("Escape").prevented, false);
        f.listeners.get("compositionend")();
        assert.equal(f.key("Escape").prevented, true);
        f.wallpaper.onerror();
        assert.equal(f.key("Escape").prevented, false);
        assert.equal(f.cover.hidden, true);
    });

    test(`${file} keeps the raised clock running and adapts it when the login panel has less space`, () => {
        const f = fixture(source);
        f.panel.offsetTop = 300;
        f.wallpaper.onload();
        f.key("Enter");
        assert.equal(f.properties.get("--auth-clock-open-opacity"), "1");
        assert.equal(f.properties.get("--auth-clock-open-y"), "-148.5px");
        assert.equal(f.timers.size, 1);
        f.panel.offsetTop = 40;
        f.windowListeners.get("resize")();
        assert.equal(f.properties.get("--auth-clock-open-opacity"), "0");
        assert.equal(f.timers.size, 0);
        f.key("Escape");
        assert.equal(f.timers.size, 1);
    });
}
