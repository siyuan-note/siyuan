import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

const browserCases = async (sources: Record<string, string>, css: string) => {
    const equal = (actual: unknown, expected: unknown, message = "") => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) { throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
    };
    const ok = (actual: unknown, message = "") => { if (!actual) { throw new Error(message || "Expected truthy value"); } };
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    const modules: Record<string, any> = {};
    const load = (name: string, deps: Record<string, unknown> = {}) => {
        const exports = modules[name] ||= {};
        new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)] || deps);
        return exports;
    };
    let uuid = 0;
    let menuRemoved = 0;
    const menu = document.createElement("div"); menu.className = "b3-menu"; document.body.append(menu);
    const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
        calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
    (window as any).siyuan = {dialogs: [], zIndex: 10, languages, config: {}, isReady: true,
        menus: {menu: {element: menu, remove() { menuRemoved++; menu.replaceChildren(); }}}};
    const dialogDeps = {genUUID: () => String(++uuid), getZIndex: () => 0, isAbove: () => false,
        isMobile: () => false, isNotCtrl: () => true, moveResize() {}, Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0},
        destroyDialogBlockPanels() {}, getDialogBlockPanel() {}, getAnchoredInputMask() {}};
    load("overlayOwnership");
    const {Dialog} = load("dialog", dialogDeps);
    ["model", "field", "runtime", "owners", "hasClosest", "menuClick"].forEach(name => load(name));
    modules.panel = {registerDatePickerWindow() {}};
    modules.index = {};
    load("binding");
    const api = load("index");
    modules.runtime.registerDatePickerRuntime(document, (options: unknown) => new Dialog(options), () => languages);
    const plugin = {}; modules.owners.registerDatePickerOwner(plugin);
    const makeInput = (type = "date") => { const input = document.createElement("input"); input.type = type; document.body.append(input); return input; };
    const owner = makeInput();
    const open = (options: Record<string, unknown> = {}) => api.openDatePicker({ownerPlugin: plugin, ownerElement: owner,
        type: "date", value: "2024-02-28", ...options});
    const current = () => (window as any).siyuan.dialogs.filter((dialog: any) => !dialog.element.dataset.dialogClosing).at(-1)?.element as HTMLElement;
    const edit = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event("input", {bubbles: true})); };
    const click = (root: HTMLElement, selector: string) => root.querySelector<HTMLButtonElement>(selector).click();
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));
    const texts = (root: HTMLElement) => root.querySelectorAll<HTMLInputElement>(".date-picker__fields input");
    const confirm = (root: HTMLElement) => click(root, '[data-action="confirm"]');

    const first = open({title: "<img src=x onerror=alert(1)>"});
    const root = current();
    equal(root.querySelector(".b3-dialog__header").textContent, "<img src=x onerror=alert(1)>");
    equal(root.querySelector(".b3-dialog__header img"), null);
    equal(root.querySelectorAll('button[tabindex="0"]').length, 1);
    equal((document.activeElement as HTMLElement).dataset.date, "2024-02-28");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
    equal((document.activeElement as HTMLElement).dataset.date, "2024-02-29");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "PageDown", bubbles: true, cancelable: true}));
    equal((document.activeElement as HTMLElement).dataset.date, "2024-03-29");
    equal(texts(root)[0].value, "2024-02-28", "keyboard navigation does not select");
    edit(texts(root)[0], "2024-02-30");
    ok((root.querySelector('[data-action="confirm"]') as HTMLButtonElement).disabled);
    equal(texts(root)[0].value, "2024-02-30", "invalid draft remains editable");
    for (const invalid of ["275760-09-14", "275760-10-01"]) {
        edit(texts(root)[0], invalid);
        equal(texts(root)[0].value, invalid);
        ok(root.querySelector<HTMLButtonElement>('[data-action="confirm"]').disabled, "out-of-range years remain invalid drafts");
    }
    edit(texts(root)[0], "2024-02-29");
    confirm(root);
    equal(await first.result, {type: "confirm", value: "2024-02-29", changed: true});
    await tick();

    for (const value of ["2024-02-29T09:00:00", "2024-02-29T09:00:00.000", "2024-02-29T09:00:00.120"]) {
        const unchanged = open({type: "datetime-local", value, step: "any"});
        const normalized = document.createElement("input"); normalized.type = "datetime-local"; normalized.value = value;
        confirm(current());
        equal(await unchanged.result, {type: "confirm", value: normalized.value, changed: false});
        await tick();
    }
    const empty = open({value: ""});
    equal(texts(current())[0].value, "");
    confirm(current()); equal(await empty.result, {type: "confirm", value: "", changed: false}); await tick();
    const required = open({value: "", required: true});
    ok((current().querySelector('[data-action="confirm"]') as HTMLButtonElement).disabled);
    ok(Array.from(current().querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Clear").disabled);
    required.destroy(); await required.result; await tick();

    const constrained = open({type: "datetime-local", value: "2024-05-01T10:05", min: "2024-05-01T10:05", max: "2024-05-02T11:00", step: "1800"});
    const constrainedRoot = current();
    equal(constrainedRoot.querySelector<HTMLButtonElement>('[data-date="2024-04-30"]').getAttribute("aria-disabled"), "true");
    click(constrainedRoot, '[data-date="2024-05-02"]');
    equal(texts(constrainedRoot)[0].value, "2024-05-02");
    equal(texts(constrainedRoot)[1].value, "10:05");
    edit(texts(constrainedRoot)[1], "10:06");
    ok(constrainedRoot.querySelector<HTMLButtonElement>('[data-action="confirm"]').disabled);
    constrainedRoot.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    equal(await constrained.result, {type: "cancel", reason: "escape"}); await tick();

    const stepped = open({value: "2024-02-03", min: "2024-02-01", max: "2024-02-10", step: "2"});
    const steppedRoot = current();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
    equal((document.activeElement as HTMLElement).dataset.date, "2024-02-04");
    equal(document.activeElement.getAttribute("aria-disabled"), "true");
    (document.activeElement as HTMLButtonElement).click();
    equal(texts(steppedRoot)[0].value, "2024-02-03", "unavailable day cannot be selected");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
    equal((document.activeElement as HTMLElement).dataset.date, "2024-02-05");
    const year = steppedRoot.querySelector<HTMLInputElement>(".date-picker__navigation input");
    year.value = "2025";
    year.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    ok(current() === steppedRoot, "year navigation must not accept the date");
    ok(steppedRoot.querySelector('[data-date="2025-02-03"]'));
    equal(texts(steppedRoot)[0].value, "2024-02-03");
    stepped.destroy(); await stepped.result; await tick();
    const future = open({type: "datetime-local", value: "", min: "2099-05-01 10:00"});
    equal(current().querySelector<HTMLInputElement>(".date-picker__navigation input").value, "2099");
    click(current(), '[data-date="2099-05-01"]');
    equal(texts(current())[1].value, "10:00"); future.destroy(); await future.result; await tick();

    const time = open({type: "time", value: "23:30", min: "22:00", max: "02:00"});
    equal(current().querySelector("table"), null);
    edit(texts(current())[0], "00:30"); confirm(current());
    equal(await time.result, {type: "confirm", value: "00:30", changed: true}); await tick();
    const composition = open();
    const composingInput = texts(current())[0];
    composingInput.dispatchEvent(new CompositionEvent("compositionstart")); edit(composingInput, "2024-02-29");
    ok(current().querySelector<HTMLButtonElement>('[data-action="confirm"]').disabled);
    composingInput.dispatchEvent(new CompositionEvent("compositionend")); confirm(current());
    equal((await composition.result).value, "2024-02-29"); await tick();

    const original = makeInput(); original.value = "2024-02-28";
    let commits = 0; let closes = 0; const events: string[] = []; let blurWhileOpen = false;
    const focusLog: string[] = [];
    original.addEventListener("focus", () => focusLog.push("focus:" + api.isDatePickerOpen(original)));
    original.addEventListener("input", () => events.push("input"));
    original.addEventListener("change", () => events.push("change"));
    original.addEventListener("blur", () => { blurWhileOpen = api.isDatePickerOpen(original); focusLog.push("blur:" + blurWhileOpen); });
    const binding = api.bindDatePicker(original, {onCommit: () => commits++, onClose: () => closes++});
    equal(api.bindDatePicker(original), binding);
    original.focus();
    ok(document.activeElement === original, `source input focus (rect ${JSON.stringify(original.getBoundingClientRect().toJSON())}; style ${getComputedStyle(original).display}; ${original.outerHTML})`);
    const pointer = new PointerEvent("pointerdown", {bubbles: true, cancelable: true, button: 0});
    original.dispatchEvent(pointer);
    ok(pointer.defaultPrevented, "bound pointer cancels native default");
    ok(blurWhileOpen, `source blur observes opening state (${focusLog.join(",")}; active ${document.activeElement.outerHTML})`);
    ok(api.isDatePickerOpen(original), "binding remains open");
    equal(original.type, "date"); equal(original.value, "2024-02-28");
    click(current(), '[data-date="2024-02-29"]'); await tick();
    equal(original.value, "2024-02-29"); equal(events, ["input", "change"]); equal(commits, 1); equal(closes, 1);
    original.showPicker();
    click(current(), '[data-action="cancel"]'); await tick();
    equal(events, ["input", "change"]); equal(commits, 1); equal(closes, 2);
    original.type = "time"; original.value = "13:00"; original.min = "12:00"; original.max = "14:00"; original.step = "1800";
    original.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", altKey: true, bubbles: true, cancelable: true}));
    equal(current().querySelector("table"), null);
    edit(texts(current())[0], "13:30"); confirm(current()); await tick(); equal(original.value, "13:30");
    original.showPicker(); edit(texts(current())[0], "14:00"); original.max = "13:45"; confirm(current()); await tick();
    equal(original.value, "13:30", "constraints are checked again before writes");
    original.showPicker(); edit(texts(current())[0], "13:00"); original.value = "12:30"; confirm(current()); await tick();
    equal(original.value, "12:30", "external changes are not overwritten");
    binding.destroy(); ok(!original.classList.contains("date-picker-input"));
    ok(!Object.hasOwn(original, "showPicker"));

    modules.menuClick.bindTouchMenuDismiss();
    for (const pointerType of ["touch", "pen"]) {
        const inMenu = makeInput(); inMenu.value = "2024-02-28"; menu.append(inMenu);
        const bound = api.bindDatePicker(inMenu);
        inMenu.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, cancelable: true, pointerType, button: 0}));
        const day = current().querySelector<HTMLButtonElement>('[data-date="2024-02-29"]');
        day.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, cancelable: true, pointerType, button: 0}));
        equal(menuRemoved, 0, "capturing touch dismissal must preserve the owning menu");
        day.click(); await tick(); equal(inMenu.value, "2024-02-29"); bound.destroy(); inMenu.remove();
    }
    const badInput = api.openInternalDatePicker({ownerElement: owner, type: "date", value: "", initialBadInput: true});
    ok(current().querySelector<HTMLButtonElement>('[data-action="confirm"]').disabled);
    Array.from(current().querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Clear").click();
    confirm(current()); equal(await badInput.result, {type: "confirm", value: "", changed: false}); await tick();

    const firstSession = open(); const replacement = open();
    equal(await firstSession.result, {type: "cancel", reason: "replaced"});
    replacement.destroy(); equal(await replacement.result, {type: "cancel", reason: "destroy"}); await tick();
    const detached = makeInput(); const detachedSession = open({ownerElement: detached}); detached.remove();
    equal(await detachedSession.result, {type: "cancel", reason: "owner-destroyed"}); await tick();
    const blurOwner = makeInput(); blurOwner.focus();
    blurOwner.addEventListener("blur", () => blurOwner.remove(), {once: true});
    const interrupted = open({ownerElement: blurOwner});
    equal(await interrupted.result, {type: "cancel", reason: "owner-destroyed"}, "owner removal during dialog construction is immediate");
    await tick(); equal(current(), undefined);

    const iframe = document.createElement("iframe"); document.body.append(iframe);
    const targetView = iframe.contentWindow as Window & typeof globalThis;
    const targetDoc = targetView.document;
    const foreignOwner = targetDoc.createElement("button"); targetDoc.body.append(foreignOwner);
    const targetMenu = targetDoc.createElement("div"); targetDoc.body.append(targetMenu);
    (targetView as any).siyuan = {dialogs: [], zIndex: 10, config: {}, languages,
        menus: {menu: {element: targetMenu, remove() {}}}};
    const targetExports: any = {};
    new targetView.Function("exports", "require", sources.dialog)(targetExports, (path: string) =>
        path === "../menus/overlayOwnership" ? modules.overlayOwnership : dialogDeps);
    modules.runtime.registerDatePickerRuntime(targetDoc, (options: unknown) => new targetExports.Dialog(options), () => languages);
    const mainSession = open(); const mainRoot = current();
    const foreignSession = open({ownerElement: foreignOwner});
    const foreignRoot = (targetView as any).siyuan.dialogs.at(-1).element as HTMLElement;
    equal(foreignRoot.ownerDocument, targetDoc);
    equal(mainRoot.dataset.dialogClosing, undefined, "windows have independent sessions");
    document.body.append(foreignOwner); await tick();
    equal(await foreignSession.result, {type: "cancel", reason: "owner-destroyed"});
    mainSession.destroy(); await mainSession.result; await tick(); iframe.remove();
    const active = open(); modules.owners.cancelPluginDatePickers(plugin);
    equal(await active.result, {type: "cancel", reason: "owner-destroyed"}); await tick();
    let rejected = false; try { open(); } catch { rejected = true; } ok(rejected);

    for (const width of [320, 360, 800]) {
        document.body.style.width = `${width}px`;
        document.documentElement.dataset.frontend = width < 400 ? "browser-mobile" : "browser-desktop";
        const layout = api.openInternalDatePicker({ownerElement: owner, type: "date", value: "2024-02-28", locale: "ar-EG"});
        current().querySelector<HTMLElement>(".date-picker").dir = "rtl";
        const container = current().querySelector<HTMLElement>(".b3-dialog__container");
        container.style.maxWidth = `${width - 32}px`;
        await tick();
        const picker = current().querySelector<HTMLElement>(".date-picker");
        ok(picker.scrollWidth <= picker.clientWidth + 1, `No picker overflow at ${width}`);
        equal(getComputedStyle(picker.querySelector(".date-picker__weekday-short")).display, "none", "long locale weekday labels use narrow forms at any viewport width");
        equal(getComputedStyle(picker.querySelector(".date-picker__weekday-narrow")).display, "inline");
        current().querySelector<HTMLButtonElement>('[data-date="2024-02-28"]').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true, cancelable: true}));
        equal((document.activeElement as HTMLElement).dataset.date, "2024-02-29", "RTL reverses horizontal movement");
        layout.destroy(); await layout.result; await tick();
    }
    const page = api.openInternalDatePicker({ownerElement: owner, type: "date", value: ""});
    window.dispatchEvent(new Event("pagehide"));
    equal(await page.result, {type: "cancel", reason: "owner-destroyed"});
    return "Date picker browser cases passed";
};

for (const scheme of ["daylight", "midnight"]) {
  for (const width of [320, 900]) {
    test(`date picker real DOM: editing, constraints, events, layout and lifecycle in ${scheme}, ${width}px`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const files = Object.fromEntries(["model", "field", "runtime", "owners", "binding", "index"].map(name => [name, join(__dirname, name + ".ts")]));
        const sources = browserSources({...files, dialog: join(__dirname, "../dialog/index.ts"),
            overlayOwnership: join(__dirname, "../menus/overlayOwnership.ts"),
            hasClosest: join(__dirname, "../protyle/util/hasClosest.ts"), menuClick: join(__dirname, "../menus/menuClick.ts")});
        const css = compile(join(__dirname, "../assets/scss/base.scss"), {logger: {warn() {}}}).css;
        const theme = readFileSync(join(__dirname, `../../appearance/themes/${scheme}/theme.css`), "utf8");
        assert.match(await runBrowserCase(browserCases, sources, theme + css, {width}), /Date picker browser cases passed/);
    });
  }
}
