import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const cases = async (source: string, styles: string[], themes: string[], notifications: string[]) => {
    const check = require("node:assert/strict");
    let ownsKernel = true;
    let finish: () => void;
    let reject: (error: Error) => void;
    let requests = 0;
    const dependencies = {
        genUUID: () => "test-message", Constants: {SIYUAN_VERSION: "test"}, progressLoading: () => {},
        getHostCapabilities: () => ({remoteKernel: !ownsKernel, ownsKernel}),
        sanitizeKernelHTML: (value: string) => value,
        fetchPost: (url: string, data: {version: string}, callback: () => void) => {
            check.equal(url, "/api/system/downloadUpdate");
            check.deepEqual(data, {version: "99.0.0-alpha.1"});
            requests++;
            return new Promise<void>((resolve, fail) => {
                finish = () => {callback(); resolve();};
                reject = fail;
            });
        },
    };
    const api = new Function(...Object.keys(dependencies), source + "return {initMessage, showMessage, formatMessageActions};")(
        ...Object.values(dependencies));
    window.siyuan = {zIndex: 0, languages: {}} as unknown as typeof window.siyuan;
    const message = document.createElement("div");
    message.id = "message";
    document.body.append(message);
    api.showMessage('Startup <button class="b3-button">Continue</button>', -1, "info", "startup");
    api.showMessage("Startup error <button>Retry</button>", 0, "error", "startup-error");
    check.equal(document.querySelectorAll("#tempMessage .b3-snackbar__body").length, 2);
    api.initMessage();
    check.equal(message.querySelectorAll('[data-id="startup"] .b3-snackbar__body').length, 1,
        "initializing notifications does not nest a second body around the startup message");
    check.equal(message.querySelector('[data-id="startup"] .b3-snackbar__actions > button').textContent, "Continue");
    check.equal(message.querySelectorAll('[data-id="startup-error"] .b3-snackbar__body').length, 1);
    check.equal(message.querySelector('[data-id="startup-error"] .b3-snackbar__body').textContent, "Startup error  vtest",
        "startup errors merge the version into the existing body before the action");
    const notification = 'New release <a href="https://example.com/release">Release</a> ' +
        '<button type="button" data-type="download-update" data-version="99.0.0-alpha.1">Download this version</button>';
    const notify = () => api.showMessage(notification, -1, "info", "update-notify");
    const button = () => message.querySelector<HTMLButtonElement>('[data-type="download-update"]');
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    notify();
    button().click();
    check.equal(button().disabled, true);
    button().click();
    check.equal(requests, 1, "repeated clicks cannot start another request while pending");
    reject(new Error("Download failed"));
    await tick();
    check.equal(button().disabled, false, "network failure permits retrying");
    check.match(message.textContent, /Download failed/);
    button().click();
    finish();
    await tick();
    check.equal(requests, 2);
    const accepted = message.querySelector('[data-id="update-notify"]');
    check.ok(!accepted || accepted.classList.contains("b3-snackbar--hide"),
        "accepted download dismisses the update notification");
    ownsKernel = false;
    notify();
    check.equal(button(), null, "remote frontends do not offer downloading the server's installer");
    check.ok(message.querySelector("a"), "remote frontends retain the release link");
    ownsKernel = true;
    api.showMessage(notification, -1, "info", "unrelated");
    button().click();
    check.equal(requests, 2, "only the update notification can invoke the download action");
    api.showMessage("Select all", -1, "info", "select-all-tip");
    const selectAllTip = message.querySelector('[data-id="select-all-tip"]');
    check.equal(api.showMessage("Loading...", -1, "info", "select-all-tip"), "select-all-tip",
        "replacing an existing notification returns its id so callers can hide it");
    check.equal(message.querySelectorAll('[data-id="select-all-tip"]').length, 1,
        "replacing an existing notification reuses its element");
    check.equal(message.querySelector('[data-id="select-all-tip"]'), selectAllTip);
    check.equal(selectAllTip.textContent, "Loading...");

    const plugin = document.createElement("div");
    plugin.innerHTML = '<section id="plugin-wrapper">Before <a href="https://example.com/help">Help</a> ' +
        '<button id="first" type="button" onclick="this.dataset.clicked = this.parentElement.id">First</button>' +
        ' after <strong>important</strong><button id="second" type="button">Second</button></section>';
    const wrapper = plugin.firstElementChild;
    const first = plugin.querySelector<HTMLButtonElement>("#first");
    const second = plugin.querySelector<HTMLButtonElement>("#second");
    let delegated = 0;
    let direct = 0;
    wrapper.addEventListener("click", () => delegated++);
    first.addEventListener("click", () => direct++);
    api.formatMessageActions(plugin);
    document.body.append(plugin);
    check.equal(first.parentElement, wrapper, "plugin buttons retain their direct parent");
    check.deepEqual(Array.from(wrapper.querySelectorAll(":scope > button")), [first, second]);
    check.equal(wrapper.querySelector("a").closest(".b3-snackbar__body"), wrapper.firstElementChild,
        "ordinary links stay with the message body");
    check.equal(wrapper.firstElementChild.textContent, "Before Help  after important");
    first.click();
    check.equal(first.dataset.clicked, "plugin-wrapper", "inline handlers retain the same parent");
    check.equal(direct, 1);
    check.equal(delegated, 1, "ancestor delegation is preserved");
    const once = plugin.innerHTML;
    api.formatMessageActions(plugin);
    check.equal(plugin.innerHTML, once, "formatting an existing action group is idempotent");
    plugin.remove();

    const nested = document.createElement("div");
    nested.innerHTML = 'Outer<button id="outer-action">Outer action</button>' +
        '<section>Inner<button id="inner-action">Inner action</button></section>';
    const nestedButtons = Array.from(nested.querySelectorAll("button"));
    const originalParents = nestedButtons.map(button => button.parentElement);
    api.formatMessageActions(nested);
    const nestedOnce = nested.innerHTML;
    api.formatMessageActions(nested);
    check.equal(nested.innerHTML, nestedOnce, "nested action groups do not grow new wrappers");
    check.deepEqual(nestedButtons.map(button => button.parentElement), originalParents);

    for (const html of [
        '<form><input name="before"><button type="submit">Save</button><input name="after"></form>',
        '<fieldset disabled><legend><input name="enabled"></legend><button>Disabled</button></fieldset>',
        "<label>Label <button>Action</button></label>",
        "<details><summary>Details</summary><button>Action</button></details>",
        "<table><tbody><tr><td><button>Action</button></td></tr></tbody></table>",
        '<div contenteditable="true">Editable <button>Action</button></div>',
    ]) {
        const semantic = document.createElement("div");
        semantic.innerHTML = html;
        const before = semantic.innerHTML;
        api.formatMessageActions(semantic);
        check.equal(semantic.innerHTML, before, "semantic plugin containers retain their structure and focus order");
    }
    const form = document.createElement("form");
    form.innerHTML = 'Form message <button type="submit">Submit</button><button type="reset">Reset</button>';
    document.body.append(form);
    const submit = form.querySelector<HTMLButtonElement>("button");
    let submissions = 0;
    form.addEventListener("submit", event => { event.preventDefault(); submissions++; });
    api.formatMessageActions(form);
    check.equal(submit.form, form);
    submit.click();
    check.equal(submissions, 1, "formatting does not replace native button behavior");
    form.remove();

    api.showMessage(' <span class="fn__space"></span><button>Only action</button> ', -1, "info", "actions-only");
    check.equal(message.querySelector('[data-id="actions-only"] .b3-snackbar__body'), null);
    api.showMessage("Text <button>Action</button>", -1, "info", "replaced-actions");
    api.showMessage("Changed <button>New action</button>", -1, "info", "replaced-actions");
    check.equal(message.querySelectorAll('[data-id="replaced-actions"] .b3-snackbar__body').length, 1);
    check.equal(message.querySelector('[data-id="replaced-actions"] button').textContent, "New action");
    api.showMessage("Error <button>Retry</button>", 0, "error", "replaced-error");
    api.showMessage("Changed error <button>Retry again</button>", 0, "error", "replaced-error");
    check.equal(message.querySelector('[data-id="replaced-error"]').textContent.match(/vtest/g).length, 1);
    api.showMessage('Plain <a href="https://example.com">link</a>', -1, "info", "plain");
    check.equal(message.querySelector('[data-id="plain"] .b3-snackbar__actions'), null);

    notifications.forEach((html, index) => api.showMessage(html, -1, "info", `fixture-${index}`));
    await tick();
    const actionHTML = notifications.map((_, index) =>
        message.querySelector(`[data-id="fixture-${index}"]`).outerHTML).join("");
    const recovery = "1![image](assets/" + "long-image-path-".repeat(80) + ".png)2\n  Keep indentation\n\nLast line";
    const pre = document.createElement("pre");
    pre.textContent = recovery;
    api.showMessage("Content changed" + pre.outerHTML, 0, "error", "recovery");
    await tick();
    const notificationHTML = message.querySelector('[data-id="recovery"]').outerHTML;
    for (const css of styles) {
        for (const width of [320, 1024]) {
            const frame = document.createElement("iframe");
            frame.style.width = width + "px";
            frame.style.height = "600px";
            document.body.append(frame);
            const doc = frame.contentDocument;
            const style = doc.createElement("style");
            style.textContent = css;
            doc.head.append(style);
            const theme = doc.createElement("style");
            doc.head.append(theme);
            doc.body.innerHTML = '<div class="b3-snackbars b3-snackbars--show">' + notificationHTML + actionHTML + "</div>";
            for (const themeCSS of themes) {
                theme.textContent = themeCSS;
                for (const fontSize of [14, 24]) {
                    doc.body.style.setProperty("--b3-font-size", fontSize + "px");
                    const content = doc.querySelector<HTMLElement>(".b3-snackbar__content");
                    const restored = content.querySelector("pre");
                    const computed = frame.contentWindow.getComputedStyle(restored);
                    check.equal(computed.whiteSpace, "pre-wrap");
                    check.equal(computed.overflowWrap, "anywhere");
                    check.equal(restored.textContent, recovery, "wrapping cannot truncate recovery text or collapse line breaks");
                    const range = doc.createRange();
                    range.selectNodeContents(restored);
                    const selection = frame.contentWindow.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    check.equal(selection.toString(), recovery, "the complete recovery Markdown remains selectable");
                    check.ok(content.scrollWidth <= content.clientWidth + 1,
                        `recovery content must fit its notification at ${width}px and ${fontSize}px font size`);
                    check.ok(content.getBoundingClientRect().left >= 0);
                    check.ok(content.getBoundingClientRect().right <= width);
                    for (const notification of Array.from(doc.querySelectorAll<HTMLElement>('[data-id^="fixture-"]'))) {
                        const notificationContent = notification.querySelector<HTMLElement>(".b3-snackbar__content");
                        const parent = notification.querySelector<HTMLElement>(".b3-snackbar__actions");
                        check.ok(parent, "each builtin and simple plugin fixture gets an action row");
                        const body = parent.querySelector<HTMLElement>(":scope > .b3-snackbar__body");
                        const buttons = Array.from(parent.querySelectorAll<HTMLElement>(":scope > .b3-snackbar__action"))
                            .filter(button => frame.contentWindow.getComputedStyle(button).display !== "none");
                        check.ok(notificationContent.scrollWidth <= notificationContent.clientWidth + 1,
                            `actions fit at ${width}px with ${fontSize}px text: ${notification.dataset.id}`);
                        check.ok(notificationContent.getBoundingClientRect().left >= 0);
                        check.ok(notificationContent.getBoundingClientRect().right <= width,
                            `notification stays in the viewport: ${notification.dataset.id}`);
                        if (body) {
                            buttons.forEach(button => check.ok(button.getBoundingClientRect().top >=
                                body.getBoundingClientRect().bottom + 7, "actions start below the body"));
                        }
                        const right = body ? body.getBoundingClientRect().right : parent.getBoundingClientRect().right;
                        const last = buttons.at(-1);
                        if (last && body) check.ok(Math.abs(last.getBoundingClientRect().right - right) < 1,
                            "the final action is aligned to the right edge");
                        notification.querySelectorAll<HTMLElement>('[hidden]:not([hidden="until-found" i])').forEach(button =>
                            check.equal(frame.contentWindow.getComputedStyle(button).display, "none"));
                        notification.querySelectorAll<HTMLElement>('[hidden="until-found" i]').forEach(element => {
                            const hiddenStyle = frame.contentWindow.getComputedStyle(element);
                            check.notEqual(hiddenStyle.display, "none");
                            check.equal(hiddenStyle.contentVisibility, "hidden");
                        });
                    }
                }
            }
            frame.remove();
        }
    }
    return "update-message-ok";
};

test("notifications preserve actions, retries and recovery text on desktop and mobile", {timeout: 30000}, async () => {
    const source = transpileModule(readFileSync("src/dialog/message.ts", "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const sass = require("sass") as typeof import("sass");
    const styles = ["base", "mobile"].map(name => sass.compile(`src/assets/scss/${name}.scss`, {
        logger: sass.Logger.silent,
    }).css);
    const themes = ["daylight", "midnight"].map(name => readFileSync(`appearance/themes/${name}/theme.css`, "utf8"));
    const lang = JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8"));
    const button = (label: string) => `<button type="button" class="b3-button b3-button--white">${label}</button>`;
    const notifications = [
        `New release <a href="https://example.com/very-long-release-link">Release details</a> ${button(lang._kernel[437])}`,
        lang._kernel[252], lang._kernel[156],
        `${lang.exported} /export/result.pdf<div class="fn__space"></div>${button(lang.showInFolder)}`,
        ...[[lang.recording, lang.endRecord], [lang.uploadError, lang.retry],
            [lang.selectAllTip, lang.doNotRemindAgain], [lang.selectAllIncompleteTip, lang.loadAllAndSelectAll]]
            .map(([text, action]) => `<div class="fn__flex fn__flex-wrap"><span class="fn__flex-center">${text}</span>` +
                `<span class="fn__space"></span>${button(action)}</div>`),
        `${lang.editorFontSize} 24px<span class="fn__space"></span>${button(lang.resetEditorFontSize)}`,
        `<span role="status">${lang.loading} 64/256</span><span class="fn__space"></span>${button(lang.cancel)}`,
        `Plugin text${button("A long translated action label that must wrap inside narrow notifications")}${button("Another action")}`,
        `Hidden action<button hidden class="b3-button">Hidden</button>${button("Visible")}`,
        `<div hidden>Hidden container${button("Hidden action")}</div>Visible${button("Visible action")}`,
        `<div hidden="UNTIL-FOUND">Searchable container${button("Searchable action")}</div>Visible${button("Visible action")}`,
        'Plugin text <a class="b3-button" href="https://example.com/action">Action link</a>',
    ];
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-update-message-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        "const __name = value => value; (" + cases.toString() + ")(" + JSON.stringify(source) + ", " + JSON.stringify(styles) +
        ", " + JSON.stringify(themes) + ", " + JSON.stringify(notifications) + ")")}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /update-message-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        rmSync(directory, {recursive: true, force: true});
    }
});
