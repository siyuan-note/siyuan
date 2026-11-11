import * as assert from "node:assert/strict";
import test from "node:test";
import {join} from "node:path";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("date picker shares overlay ownership with independently loaded target-window menus", {timeout: 45000, skip: !canRunBrowser}, async () => {
    const files = Object.fromEntries(["model", "field", "runtime", "owners", "binding", "index"].map(name => [name, join(__dirname, name + ".ts")]));
    const sources = browserSources({...files, dialog: join(__dirname, "../dialog/index.ts"),
        pluginMenu: join(__dirname, "../plugin/Menu.ts"), nativeSelect: join(__dirname, "../mobile/util/nativeSelect.ts"),
        overlayOwnership: join(__dirname, "../menus/overlayOwnership.ts")});
    assert.match(await runBrowserCase(async sources => {
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (actual !== expected) { throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); }
        };
        const modules: Record<string, any> = {};
        const load = (name: string) => {
            const exports = modules[name] ||= {};
            new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)] || {});
            return exports;
        };
        ["model", "field", "runtime", "owners", "overlayOwnership"].forEach(name => load(name));
        modules.panel = {registerDatePickerWindow() {}}; modules.index = {}; load("binding"); const api = load("index");
        const iframe = document.createElement("iframe"); document.body.append(iframe);
        const view = iframe.contentWindow as Window & typeof globalThis;
        const doc = view.document;
        let closed = 0; let uuid = 0;
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
        class MenuSurface {
            removeCB?: () => void;
            constructor(public element: HTMLElement) {
                element.addEventListener("click", event => {
                    if ((event as unknown as CustomEvent).detail === "back") { this.remove(); }
                });
            }
            remove() {
                const callback = this.removeCB; this.removeCB = undefined; callback?.();
                this.element.lastElementChild.replaceChildren(); this.element.classList.add("fn__none");
            }
            popup() { this.element.classList.remove("fn__none"); }
            addItem(option: {label: string; disabled?: boolean; click?: () => void}) {
                const button = doc.createElement("button"); button.textContent = option.label; button.disabled = !!option.disabled;
                button.addEventListener("click", () => option.click?.()); this.element.lastElementChild.append(button); return button;
            }
        }
        const common = doc.createElement("div"); common.className = "b3-menu"; common.innerHTML = "<div></div><div></div>"; doc.body.append(common);
        view.siyuan = {dialogs: [], zIndex: 10, config: {}, languages, isReady: true, menus: {menu: new MenuSurface(common)}} as any;
        const targetOverlay: any = {};
        new view.Function("exports", "require", sources.overlayOwnership)(targetOverlay, () => ({}));
        const targetMenu: any = {};
        new view.Function("exports", "require", sources.pluginMenu)(targetMenu, (path: string) =>
            path.includes("overlayOwnership") ? targetOverlay : path === "../menus/Menu" ? {Menu: MenuSurface} : {});
        const targetSelect: any = {};
        new view.Function("exports", "require", sources.nativeSelect)(targetSelect, (path: string) =>
            path.includes("overlayOwnership") ? targetOverlay : path.includes("plugin/Menu") ? targetMenu : {escapeHtml: (value: string) => value});
        targetSelect.initMobileSelect();
        const targetDialog: any = {};
        new view.Function("exports", "require", sources.dialog)(targetDialog, (path: string) => path.includes("overlayOwnership") ? targetOverlay : ({genUUID: () => String(++uuid),
            getZIndex: () => 0, isAbove: () => false, isMobile: () => false, isNotCtrl: () => true, moveResize() {},
            Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0}, destroyDialogBlockPanels() {}, getDialogBlockPanel() {}, getAnchoredInputMask() {}}));
        modules.runtime.registerDatePickerRuntime(doc, (options: unknown) => new targetDialog.Dialog(options), () => languages);
        const trigger = doc.createElement("button"); doc.body.append(trigger);
        const parent = new targetMenu.Menu(undefined, () => closed++, true);
        const owner = doc.createElement("input"); owner.type = "date"; parent.element.lastElementChild.append(owner); parent.open({target: trigger});
        const handle = api.openInternalDatePicker({ownerElement: owner, type: "date", value: "2024-02-28"});
        const root = view.siyuan.dialogs.at(-1).element as HTMLElement;
        const input = root.querySelector<HTMLInputElement>(".date-picker__fields input");
        equal(modules.overlayOwnership.isMenuOverlayTarget(parent.element, input), true, "source sees picker ownership");
        equal(targetOverlay.isMenuOverlayTarget(parent.element, input), true, "target module sees picker ownership");
        input.click(); equal(closed, 0, "field click preserves the target-window parent menu");
        const month = root.querySelector<HTMLSelectElement>("select"); month.click();
        const child = targetSelect.getMobileSelectMenuElement() as HTMLElement;
        equal(child !== common && !!child, true, "target native select creates an independent child menu");
        const march = Array.from(child.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "March");
        march.focus();
        equal(doc.activeElement, march, "nested menu receives focus");
        equal(modules.overlayOwnership.isMenuOverlayTarget(root, doc.activeElement), true, "source sees nested focus containment");
        equal(targetOverlay.isMenuOverlayTarget(parent.element, doc.activeElement), true, "target sees transitive focus containment");
        const choices = Array.from(child.querySelectorAll<HTMLButtonElement>("button"));
        choices.at(-1).focus();
        choices.at(-1).dispatchEvent(new view.KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
        equal(doc.activeElement, choices[0], "cross-window Tab wraps within the owned menu");
        choices[0].dispatchEvent(new view.KeyboardEvent("keydown", {key: "Tab", shiftKey: true, bubbles: true, cancelable: true}));
        equal(doc.activeElement, choices.at(-1), "cross-window Shift+Tab wraps within the owned menu");
        march.click(); equal(month.value, "3", "target native select updates picker month");
        equal(closed, 0, "nested choice preserves parent"); equal(root.isConnected, true, "nested choice preserves picker");
        month.click(); const pendingChild = targetSelect.getMobileSelectMenuElement() as HTMLElement;
        parent.close(); await handle.result;
        await new Promise(resolve => setTimeout(resolve, 30));
        equal(closed, 1, "parent closes exactly once");
        equal(root.isConnected || pendingChild.isConnected, false, "target parent close cleans both descendants");
        equal(modules.overlayOwnership.isMenuOverlayTarget(parent.element, input), false, "source ownership is released");
        equal(targetOverlay.isMenuOverlayTarget(parent.element, input), false, "target ownership is released");
        const overlay = doc.createElement("div"); doc.body.append(overlay);
        let overlayClosed = 0;
        const release = modules.overlayOwnership.registerMenuOverlay(trigger, overlay, () => overlayClosed++);
        equal(targetOverlay.isMenuOverlayTarget(trigger, overlay), true, "registry can be recreated from the source");
        trigger.remove(); await new Promise(resolve => setTimeout(resolve, 0));
        equal(overlayClosed, 1, "shared observer cleans a removed owner once"); release();
        equal(targetOverlay.isMenuOverlayTarget(trigger, overlay), false, "target observes mutation cleanup");
        for (const cleanup of ["close", "mutation"]) {
            const owner = doc.createElement("button"); const nextOwner = doc.createElement("button");
            const first = doc.createElement("div"); const next = doc.createElement("div");
            doc.body.append(owner, nextOwner, first, next);
            let reopened = 0;
            let releaseNext: () => void;
            modules.overlayOwnership.registerMenuOverlay(owner, first, () => {
                targetOverlay.closeMenuOverlays(owner);
                releaseNext = targetOverlay.registerMenuOverlay(nextOwner, next, () => reopened++);
            });
            if (cleanup === "close") { targetOverlay.closeMenuOverlays(owner); }
            else { owner.remove(); await new Promise(resolve => setTimeout(resolve, 0)); }
            equal(modules.overlayOwnership.isMenuOverlayTarget(nextOwner, next), true, `${cleanup} preserves a reentrant registry`);
            modules.overlayOwnership.closeMenuOverlays(nextOwner); releaseNext();
            equal(reopened, 1, `${cleanup} replacement can be cleaned by either module`);
            owner.remove(); nextOwner.remove(); first.remove(); next.remove();
        }

        const plain = new targetDialog.Dialog({content: '<button id="plain-first">First</button><button id="plain-last">Last</button>'});
        const firstButton = plain.element.querySelector("#plain-first") as HTMLButtonElement;
        const lastButton = plain.element.querySelector("#plain-last") as HTMLButtonElement;
        const pressTab = (shiftKey = false) => doc.activeElement.dispatchEvent(new view.KeyboardEvent("keydown", {
            key: "Tab", shiftKey, bubbles: true, cancelable: true,
        }));
        firstButton.focus(); pressTab(true); equal(doc.activeElement, lastButton, "ordinary dialog Shift+Tab still wraps");
        pressTab(); equal(doc.activeElement, firstButton, "ordinary dialog Tab still wraps");
        const unrelated = doc.createElement("div"); unrelated.className = "b3-menu";
        const outsideButton = doc.createElement("button"); unrelated.append(outsideButton); doc.body.append(unrelated);
        outsideButton.focus(); pressTab();
        equal(doc.activeElement, firstButton, "unregistered independent menus cannot escape the dialog trap");
        const releasePlain = targetOverlay.registerMenuOverlay(firstButton, unrelated, () => unrelated.remove());
        const upper = new targetDialog.Dialog({content: '<button id="upper">Upper</button>'});
        outsideButton.focus(); pressTab(true);
        equal(doc.activeElement, upper.element.querySelector("#upper"), "another dialog's registered menu cannot escape the top dialog trap");
        releasePlain(); upper.destroy(); plain.destroy();
        iframe.remove();
        return "Cross-window overlay ownership passed";
    }, sources), /Cross-window overlay ownership passed/);
});
