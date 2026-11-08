import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
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
    const api = new Function(...Object.keys(dependencies), source + "return {initMessage, showMessage};")(
        ...Object.values(dependencies));
    window.siyuan = {zIndex: 0, languages: {}} as unknown as typeof window.siyuan;
    const message = document.createElement("div");
    message.id = "message";
    document.body.append(message);
    const startup = 'Startup <button class="caller-notice-action b3-button">Continue</button> then finish';
    const startupError = "Startup error <button>Retry</button> or reopen";
    api.showMessage(startup, -1, "info", "startup");
    api.showMessage(startupError, 0, "error", "startup-error");
    api.showMessage(notifications[0], -1, "info", "startup-actions");
    check.equal(document.querySelector('#tempMessage [data-message-id="startup"]').innerHTML, startup);
    check.equal(document.querySelector('#tempMessage [data-message-id="startup-error"]').innerHTML, startupError);
    check.equal(document.querySelectorAll("#tempMessage .b3-snackbar__body").length, 1);
    const startupMarkup = document.getElementById("tempMessage").outerHTML;
    api.initMessage();
    check.equal(message.querySelector('[data-id="startup"] .b3-snackbar__content').innerHTML, startup,
        "initializing notifications preserves inline buttons and the surrounding text");
    check.equal(message.querySelector('[data-id="startup-error"] .b3-snackbar__content').innerHTML, startupError + " vtest");
    check.equal(message.querySelectorAll('[data-id="startup-actions"] .b3-snackbar__body').length, 1,
        "initializing notifications preserves the explicitly supplied action layout");
    const notification = notifications[0];
    const notify = () => api.showMessage(notification, -1, "info", "update-notify");
    const button = () => message.querySelector<HTMLButtonElement>('[data-id="update-notify"] [data-type="download-update"]');
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
    check.ok(message.querySelector('[data-id="update-notify"] a'), "remote frontends retain the release link");
    ownsKernel = true;
    api.showMessage(notification, -1, "info", "unrelated");
    message.querySelector<HTMLButtonElement>('[data-id="unrelated"] [data-type="download-update"]').click();
    check.equal(requests, 2, "only the update notification can invoke the download action");
    api.showMessage("Select all", -1, "info", "select-all-tip");
    const selectAllTip = message.querySelector('[data-id="select-all-tip"]');
    check.equal(api.showMessage("Loading...", -1, "info", "select-all-tip"), "select-all-tip",
        "replacing an existing notification returns its id so callers can hide it");
    check.equal(message.querySelectorAll('[data-id="select-all-tip"]').length, 1,
        "replacing an existing notification reuses its element");
    check.equal(message.querySelector('[data-id="select-all-tip"]'), selectAllTip);
    check.equal(selectAllTip.textContent, "Loading...");

    const showContent = (html: string, id: string) => {
        api.showMessage(html, -1, "info", id);
        const content = message.querySelector(`[data-id="${id}"] .b3-snackbar__content`);
        const expected = document.createElement("div");
        expected.innerHTML = html;
        check.equal(content.innerHTML, expected.innerHTML, "notification HTML retains its structure and node order");
        return content;
    };
    const pluginHTML = '<section id="plugin-wrapper">Before <a href="https://example.com/help">Help</a> ' +
        '<button id="first" type="button" onclick="this.dataset.clicked = this.parentElement.id">First</button>' +
        ' after <strong>important</strong><span class="fn__space"></span><button id="second" type="button">Second</button></section>';
    const plugin = showContent(pluginHTML, "plugin");
    const wrapper = plugin.firstElementChild;
    const first = plugin.querySelector<HTMLButtonElement>("#first");
    const second = plugin.querySelector<HTMLButtonElement>("#second");
    let delegated = 0;
    let direct = 0;
    wrapper.addEventListener("click", () => delegated++);
    first.addEventListener("click", () => direct++);
    check.equal(first.parentElement, wrapper, "plugin buttons retain their direct parent");
    check.deepEqual(Array.from(wrapper.querySelectorAll(":scope > button")), [first, second]);
    check.equal(first.nextSibling.textContent, " after ", "text following an inline button stays after it");
    check.ok(second.previousElementSibling.classList.contains("fn__space"), "plugin spacing remains intact");
    check.equal(wrapper.querySelector("a").parentElement, wrapper, "links retain their parent");
    first.click();
    check.equal(first.dataset.clicked, "plugin-wrapper", "inline handlers retain the same parent");
    check.equal(direct, 1);
    check.equal(delegated, 1, "ancestor delegation is preserved");
    showContent(pluginHTML, "plugin");

    for (const [index, html] of [
        'Outer<button id="outer-action">Outer action</button><section>Inner<button>Inner action</button> after</section>',
        'Before <input type="button" value="Action"> after <input type="submit"><input type="reset">',
        'Before <a class="b3-button" href="https://example.com">Action</a> after <span role="button" tabindex="0">Next</span>',
        '<div class="fn__flex" style="gap: 4px">Plugin <button hidden>Hidden</button><button>Action</button> after</div>',
        '<form><input name="before"><button type="submit">Save</button><input name="after"></form>',
        '<fieldset disabled><legend><input name="enabled"></legend><button>Disabled</button></fieldset>',
        "<label>Label <button>Action</button></label>",
        "<details><summary>Details</summary><button>Action</button></details>",
        "<table><tbody><tr><td><button>Action</button></td></tr></tbody></table>",
        '<div contenteditable="true">Editable <button>Action</button></div>',
    ].entries()) {
        showContent(html, `plugin-structure-${index}`);
        showContent(html, `plugin-structure-${index}`);
    }
    const form = showContent('<form>Form message <button type="submit">Submit</button><button type="reset">Reset</button></form>',
        "plugin-form").querySelector("form");
    const submit = form.querySelector<HTMLButtonElement>("button");
    let submissions = 0;
    form.addEventListener("submit", event => { event.preventDefault(); submissions++; });
    check.equal(submit.form, form);
    submit.click();
    check.equal(submissions, 1, "notifications preserve native form submission");

    showContent(' <span class="fn__space"></span><button>Only action</button> ', "actions-only");
    check.equal(message.querySelector('[data-id="actions-only"] .b3-snackbar__body'), null);
    showContent("Text <button>Action</button> after", "replaced-actions");
    showContent("Changed <button>New action</button> after", "replaced-actions");
    check.equal(message.querySelectorAll('[data-id="replaced-actions"] .b3-snackbar__body').length, 0);
    check.equal(message.querySelector('[data-id="replaced-actions"] button').textContent, "New action");
    api.showMessage("Error <button>Retry</button>", 0, "error", "replaced-error");
    api.showMessage("Changed error <button>Retry again</button>", 0, "error", "replaced-error");
    check.equal(message.querySelector('[data-id="replaced-error"]').textContent.match(/vtest/g).length, 1);
    api.showMessage('Plain <a href="https://example.com">link</a>', -1, "info", "plain");
    check.equal(message.querySelector('[data-id="plain"] .b3-snackbar__actions'), null);

    notifications.forEach((html, index) => api.showMessage(html, -1, "info", `fixture-${index}`));
    const compactIndex = notifications.findIndex(html => html.includes("b3-snackbar__action") && !html.includes("b3-snackbar__actions"));
    await tick();
    const actionHTML = notifications.map((_, index) =>
        message.querySelector(`[data-id="fixture-${index}"]`).outerHTML).join("");
    const recovery = "1![image](assets/" + "long-image-path-".repeat(80) + ".png)2\n  Keep indentation\n\nLast line";
    const pre = document.createElement("pre");
    pre.textContent = recovery;
    api.showMessage("Content changed" + pre.outerHTML, 0, "error", "recovery");
    await tick();
    const notificationHTML = message.querySelector('[data-id="recovery"]').outerHTML;
    const assertInlineButtonOrder = (button: HTMLElement) => {
        const doc = button.ownerDocument;
        const before = doc.createRange();
        const beforeOffset = button.previousSibling.textContent.trimEnd().length - 1;
        before.setStart(button.previousSibling, beforeOffset);
        before.setEnd(button.previousSibling, beforeOffset + 1);
        const after = doc.createRange();
        const afterOffset = button.nextSibling.textContent.search(/\S/);
        after.setStart(button.nextSibling, afterOffset);
        after.setEnd(button.nextSibling, afterOffset + 1);
        const follows = (first: DOMRect, second: DOMRect) => {
            const lineOffset = second.top + second.height / 2 - first.top - first.height / 2;
            return lineOffset > 10 || Math.abs(lineOffset) <= 10 && second.left >= first.right - 1;
        };
        const bounds = button.getBoundingClientRect();
        check.ok(follows(before.getBoundingClientRect(), bounds), "the button visually follows its preceding text");
        check.ok(follows(bounds, after.getBoundingClientRect()), "following text visually follows the button");
        check.equal(doc.defaultView.getComputedStyle(button).cssFloat, "none",
            "buttons directly in message text do not float away from their surrounding text");
    };
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
            doc.body.innerHTML = '<div class="b3-snackbars b3-snackbars--show">' + notificationHTML + actionHTML + "</div>" + startupMarkup;
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
                    const startupContent = doc.querySelector<HTMLElement>('#tempMessage [data-message-id="startup"]');
                    const startupStyle = doc.createElement("style");
                    doc.head.append(startupStyle);
                    for (const float of ["right", "left", "none"]) {
                        startupStyle.textContent = `.caller-notice-action {float: ${float}; padding: 1px 6px; font-size: 12px}`;
                        assertInlineButtonOrder(startupContent.querySelector("button"));
                        check.equal(startupContent.innerHTML, startup, "startup notification HTML remains intact");
                    }
                    startupStyle.remove();
                    for (const notification of Array.from(doc.querySelectorAll<HTMLElement>('[data-id^="fixture-"]'))) {
                        const notificationContent = notification.querySelector<HTMLElement>(".b3-snackbar__content");
                        const parent = notification.querySelector<HTMLElement>(".b3-snackbar__actions");
                        const expected = document.createElement("div");
                        expected.innerHTML = notifications[Number(notification.dataset.id.slice("fixture-".length))];
                        check.equal(notificationContent.innerHTML, expected.innerHTML,
                            "layout does not alter the caller's notification markup");
                        const body = parent?.querySelector<HTMLElement>(":scope > .b3-snackbar__body");
                        const buttons = Array.from(parent?.querySelectorAll<HTMLElement>(":scope > .b3-snackbar__action") || [])
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
                        const last = buttons.at(-1);
                        if (last && body) check.ok(Math.abs(last.getBoundingClientRect().right - body.getBoundingClientRect().right) < 1,
                            "the final action is aligned to the right edge");
                        const compactButton = notificationContent.querySelector<HTMLElement>(":scope > .b3-snackbar__action");
                        if (compactButton && notification.dataset.id === `fixture-${compactIndex}` && width === 1024 && fontSize === 14) {
                            const text = doc.createRange();
                            text.selectNode(notificationContent.firstChild);
                            const bounds = text.getBoundingClientRect();
                            const buttonBounds = compactButton.getBoundingClientRect();
                            check.ok(buttonBounds.top < bounds.bottom && buttonBounds.bottom > bounds.top,
                                "the font size reset stays beside its text when space permits");
                            check.ok(buttonBounds.left >= bounds.right + 7, "compact actions retain their spacing");
                        }
                        const callerButton = notificationContent.querySelector<HTMLElement>(":scope > .caller-notice-action");
                        if (callerButton) {
                            const callerStyle = doc.createElement("style");
                            doc.head.append(callerStyle);
                            for (const float of ["right", "left", "none"]) {
                                callerStyle.textContent = `.caller-notice-action {float: ${float}; padding: 1px 6px; font-size: 12px}`;
                                assertInlineButtonOrder(callerButton);
                                check.equal(notificationContent.innerHTML, expected.innerHTML,
                                    "keeping inline reading order does not change notification HTML");
                            }
                            callerStyle.remove();
                        }
                        const layoutButton = notificationContent.querySelector<HTMLElement>(".caller-layout-action");
                        if (layoutButton) {
                            const layoutStyle = doc.createElement("style");
                            doc.head.append(layoutStyle);
                            for (const float of ["left", "right", "none"]) {
                                layoutStyle.textContent = `.caller-layout-action {float: ${float}}`;
                                check.equal(frame.contentWindow.getComputedStyle(layoutButton).cssFloat, float,
                                    "buttons in custom containers and explicit action groups retain their layout");
                                check.equal(notificationContent.innerHTML, expected.innerHTML);
                            }
                            layoutStyle.remove();
                        }
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

test("notifications preserve inline reading order, custom layouts, actions, retries and recovery text on desktop and mobile", {timeout: 30000}, async () => {
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
    const updateTemplate = readFileSync("../kernel/model/updater.go", "utf8")
        .match(/message = fmt.Sprintf\(`([^`]+b3-snackbar__actions[^`]+)`/)[1];
    const updateMessage = updateTemplate.replace("%s", 'New release <a href="https://example.com/very-long-release-link">Release details</a>')
        .replace("%s", "99.0.0-alpha.1").replace("%s", lang._kernel[437]);
    const fontSizeSource = transpileModule(readFileSync("src/util/editorFontSize.ts", "utf8")
        .match(/^const showEditorFontSizeMessage = [\s\S]+?^};/m)[0], {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const renderFontSizeMessage = (languages: Record<string, unknown>) => {
        let result = "";
        new Function("window", "document", "showMessage", "MESSAGE_ID", fontSizeSource + "showEditorFontSizeMessage(24);")(
            {siyuan: {languages}}, {querySelector: (): null => null}, (html: string) => {result = html;}, "editorFontSize");
        return result;
    };
    let exportMessage = "";
    const exportSource = transpileModule(readFileSync("src/protyle/export/util.ts", "utf8")
        .match(/^export const afterExport = [\s\S]+?^};/m)[0].replace("export ", ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    new Function("window", "document", "showMessage", "escapeHtml", exportSource + "afterExport('/export/result.pdf', 'export');")(
        {siyuan: {languages: lang}}, {querySelector: () => ({addEventListener() {}})},
        (html: string) => {exportMessage = html;}, (text: string) => text);
    const notifications = [
        updateMessage,
        lang._kernel[252], lang._kernel[156],
        exportMessage,
        ...[[lang.recording, lang.endRecord], [lang.uploadError, lang.retry],
            [lang.selectAllTip, lang.doNotRemindAgain], [lang.selectAllIncompleteTip, lang.loadAllAndSelectAll]]
            .map(([text, action]) => `<div class="fn__flex fn__flex-wrap"><span class="fn__flex-center">${text}</span>` +
                `<span class="fn__space"></span>${button(action)}</div>`),
        renderFontSizeMessage(lang),
        `<span role="status">${lang.loading} 64/256</span><span class="fn__space"></span>${button(lang.cancel)}`,
        '<div class="b3-snackbar__actions"><div class="b3-snackbar__body">Explicit actions</div>' +
            '<button class="b3-button b3-button--wrap b3-snackbar__action">A long translated action label that must wrap inside narrow notifications</button>' +
            '<button class="caller-layout-action b3-button b3-snackbar__action">Another action</button></div>',
        `Hidden action<button hidden class="b3-button">Hidden</button>${button("Visible")}`,
        `<div hidden>Hidden container${button("Hidden action")}</div>Visible${button("Visible action")}`,
        `<div hidden="UNTIL-FOUND">Searchable container${button("Searchable action")}</div>Visible${button("Visible action")}`,
        'Plugin text <a class="b3-button" href="https://example.com/action">Action link</a>',
        'Before <button class="caller-notice-action b3-button">Action</button> after',
        '修改 JS 代码片段后需重新加载界面 <button class="caller-notice-action b3-button">不再提示</button> 才能保证生效',
        '<div>Before <button class="caller-layout-action b3-button">Action</button> after</div>',
        ...readdirSync("appearance/langs").filter(name => name.endsWith(".json")).map(name =>
            renderFontSizeMessage(JSON.parse(readFileSync(`appearance/langs/${name}`, "utf8")))),
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
