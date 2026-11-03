import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (languages: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const api = (window as unknown as {MarkdownApplicationTest: typeof import("./index") & Pick<typeof import("./limits"), "MARKDOWN_RENDER_BYTES"> &
        {createMarkdownTree: typeof import("./tree").createMarkdownTree}}).MarkdownApplicationTest;
    const tick = () => new Promise(resolve => setTimeout(resolve, 180));
    const original = "# Markdown 编辑器\n\n直接编辑外部文档，文件保留在原位置。\n\n## 写作与预览\n\n- 自动保存到当前文件\n- 支持 **即时渲染**、所见即所得和分屏预览\n- 关闭前保留恢复草稿\n\n| 项目 | 状态 |\n| --- | --- |\n| 本地文档 | 已保存 |\n| 相对图片 | 按目录授权访问 |\n\n> 界面沿用思源的颜色、字体与基础控件。\n";
    const format = {bom: false, newline: "\n" as const};
    const capabilities = {persistentPermission: true, conditionalWrite: false, atomicReplace: true, coordinatedAccess: false};
    let target: import("./contracts").MarkdownTarget = {handle: "original", identity: "original", displayName: "README.md", baseline: "original", writable: true, format, capabilities};
    let content = original;
    const writes: Array<{content: string; target: {handle: string}}> = [];
    let onCommand: (command: import("./bridge").MarkdownCommand) => void;
    const responses: boolean[] = [];
    let newDocuments = 0;
    let openedDocuments = 0;
    let closeConfirmations = 0;
    let cancelledCandidates = 0;
    let failWrite = false;
    let delayRead = false;
    let reads = 0;
    let finishRead: (value: import("./contracts").MarkdownReadResult) => void;
    let failRelease = false;
    let storedPreferences: import("./bridge").MarkdownPreferences = {mode: "ir", theme: "system", fontSize: 16};
    const preferenceUpdates: Array<Partial<import("./bridge").MarkdownPreferences>> = [];
    let clears = 0;
    const releases: Array<{sessionId: string; targetGeneration: number}> = [];
    const draftAcknowledgements: string[] = [];
    const bridge: import("./bridge").MarkdownBridge = {
        tree: {
            state: async () => ({kind: "ready", rootId: "root", generation: 1, rootName: "Notes", currentNodeId: "original", currentPath: ["root"], expanded: ["root"], width: 240, visible: true}),
            list: async location => ({kind: "listed", ...location, entries: location.nodeId === "root" ? [
                {id: "note10", name: "Note10.md", kind: "file"}, {id: "folder", name: "Projects", kind: "directory"},
                {id: "original", name: "README.md", kind: "file"}, {id: "note2", name: "Note2.markdown", kind: "file"},
            ] : [{id: "nested", name: "Nested.md", kind: "file"}]}),
            chooseRoot: async () => ({kind: "cancelled"}), saveView: async () => {},
            prepareOpen: async () => ({kind: "current"}), commitOpen: async () => {throw new Error("No prepared candidate");}, cancelOpen: async () => {},
        },
        host: {
            read: async () => {reads++; return delayRead ? new Promise(resolve => {finishRead = resolve;}) : {kind: "read", content, target};},
            write: async request => { writes.push(request); return failWrite ? {kind: "blocked", error: {code: "offline", recoverable: true}} :
                {kind: "committed", baseline: "saved", durability: "provider"}; },
            reconcileWrite: async () => ({kind: "committed", baseline: "saved", durability: "local"}),
            reserveSaveAs: async request => ({kind: "reserved", reservation: {id: "reservation", target: {...request.target, format: request.format}}}),
            prepareSaveAs: async () => {},
            commitSaveAs: async request => ({kind: "committed", target: {...request.operation.target, baseline: request.receipt.baseline}}),
            releaseSaveAs: async () => {}, putDraft: async draft => {draftAcknowledgements.push(draft.content);}, clearDraft: async () => {clears++;},
            releaseSession: async request => {if (failRelease) throw new Error("Recovery store unavailable"); releases.push(request);},
        },
        bootstrap: async () => ({sessionId: "ui-session", content, target, preferences: {...storedPreferences},
            languages, lang: "zh-CN", platform: "win32", dark: false}),
        newDocument: async () => { newDocuments++; }, openDocument: async () => {openedDocuments++;},
        chooseSaveAs: async () => ({kind: "selected", target: {...target, handle: "copy", identity: "copy", displayName: "README-copy.md"}}),
        cancelSaveAs: async () => {cancelledCandidates++;}, authorizeResources: async () => true, resolveResource: async () => undefined,
        insertImage: async () => ({kind: "inserted", reference: "images/example%20photo.png"}),
        openLink: async () => {}, preferences: async patch => {preferenceUpdates.push({...patch}); storedPreferences = {...storedPreferences, ...patch}; return {...storedPreferences};},
        confirm: async () => true, confirmClose: async () => {closeConfirmations++; return "keep";},
        recoveries: async () => [{id: "draft", displayName: "恢复文档.md", updatedAt: 1793520000000}],
        recover: async () => {}, discardRecovery: async () => {}, state: async () => {},
        onCommand: listener => {onCommand = listener; return () => {if (onCommand === listener) onCommand = undefined;};}, respond: async (_id, accepted) => {responses.push(accepted);},
    };
    const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const background = (element: Element): string => {
        const color = getComputedStyle(element).backgroundColor;
        return color === "rgba(0, 0, 0, 0)" && element.parentElement ? background(element.parentElement) : color;
    };
    const checkTheme = async (mode: import("./editor").MarkdownEditorMode, dark: boolean) => {
        const selector = mode === "sv" ? ".vditor-preview .vditor-reset" : `.vditor-${mode} .vditor-reset`;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const contentStyle = document.getElementById("vditorContentTheme") as HTMLLinkElement;
            const codeStyle = document.getElementById("vditorHljsStyle") as HTMLLinkElement;
            if (document.querySelector(`${selector} table td`) && document.querySelector(`${selector} code.hljs`) &&
                contentStyle?.sheet && codeStyle?.sheet && contentStyle.href.endsWith(`/${dark ? "dark" : "light"}.css`) &&
                codeStyle.href.endsWith(`/${dark ? "github-dark" : "github"}.min.css`)) break;
            await tick();
        }
        const surface = document.querySelector(selector);
        check.ok(surface?.querySelector("code.hljs"), `highlighted code rendered in ${mode}`);
        for (const selector of ["h1", "p", "th", "td", "code.hljs"]) {
            const element = surface.querySelector(selector);
            check.ok(element, `${selector} rendered in ${mode}`);
            const foreground = luminance(getComputedStyle(element).color);
            const backdrop = luminance(background(element));
            const contrast = (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
            check.ok(contrast >= 4.5, `${dark ? "dark" : "light"} ${mode} ${selector} contrast: ${contrast}`);
        }
        const tableBackground = luminance(background(surface.querySelector("td")));
        check.ok(dark ? tableBackground < 0.1 : tableBackground > 0.7, `table follows ${dark ? "dark" : "light"} ${mode}`);
        check.ok((document.getElementById("vditorContentTheme") as HTMLLinkElement).href.endsWith(`/${dark ? "dark" : "light"}.css`));
        check.ok((document.getElementById("vditorHljsStyle") as HTMLLinkElement).href.endsWith(`/${dark ? "github-dark" : "github"}.min.css`));
        if (mode !== "sv") {
            for (const heading of surface.querySelectorAll("h1, h2")) {
                check.equal(getComputedStyle(heading, "::before").lineHeight, getComputedStyle(heading).lineHeight,
                    `${mode} heading marker shares the title's first line height`);
            }
        }
    };
    const themeBootstrap = bridge.bootstrap;
    for (const startup of [{theme: "dark", systemDark: false}, {theme: "system", systemDark: true}, {theme: "light", systemDark: true}] as const) {
        const dark = startup.theme !== "light";
        for (const mode of ["ir", "wysiwyg", "sv"] as const) {
            bridge.bootstrap = async () => ({...await themeBootstrap(), content: original + '\nInline `code`\n\n```js\nconst answer = "readable";\n```\n',
                preferences: {...storedPreferences, mode, theme: startup.theme}, dark: startup.systemDark});
            const initial = await api.mountMarkdownApplication(bridge);
            await checkTheme(mode, dark);
            check.equal(document.querySelector(".vditor-toolbar").getBoundingClientRect().height, 0);
            if (mode === "ir") await ipcRenderer.invoke("markdown-screenshot", `initial-${startup.theme}`);
            if (startup.theme === "system") {
                onCommand({id: `light-${mode}`, type: "theme", dark: false});
                await checkTheme(mode, false);
                onCommand({id: `dark-${mode}`, type: "theme", dark: true});
                await checkTheme(mode, true);
            }
            check.equal(initial.session.getState().hasUnsavedChanges, false);
            check.equal(writes.length, 0, "initial theme and mode changes never rewrite the file");
            initial.destroy();
        }
    }
    bridge.bootstrap = themeBootstrap;
    const mounting = api.mountMarkdownApplication(bridge);
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, true, "initial content cannot be edited before initialization finishes");
    const application = await mounting;
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    const more = document.querySelector<HTMLDetailsElement>("#markdownMore");
    const moreButton = document.querySelector<HTMLElement>("#markdownMoreButton");
    const openMore = () => {
        if (!more.open) {moreButton.focus(); moreButton.click();}
        check.equal(more.open, true);
    };
    const menuAction = (id: string) => {
        openMore();
        const button = document.querySelector<HTMLButtonElement>(`#${id}`);
        check.equal(button.checkVisibility(), true, `${id} is reachable in the open menu`);
        check.equal(button.disabled, false, `${id} is enabled`);
        button.click();
        check.equal(more.open, false, "choosing a menu action closes the menu");
    };
    await tick();
    check.equal(document.querySelector("#markdownName").textContent, "README.md");
    check.equal(document.title, "README.md");
    check.equal(document.querySelector(".markdown-tree__heading"), null);
    check.deepEqual(Array.from(document.querySelectorAll<HTMLElement>(".markdown-header button, .markdown-header select, .markdown-header summary"))
        .filter(element => element.checkVisibility()).map(element => element.id), ["markdownTreeToggle", "markdownFiles", "markdownUndo", "markdownRedo", "markdownMoreButton"]);
    const panelToggle = document.querySelector<HTMLButtonElement>("#markdownTreeToggle");
    check.equal(panelToggle.title, languages.markdownFiles);
    check.equal(panelToggle.querySelector("use").getAttribute("href"), "#iconPanelLeft");
    for (const id of ["markdownTreeToggle"]) {
        check.equal(document.getElementById(id).getAttribute("aria-controls"), "markdownTree");
        check.equal(document.getElementById(id).getAttribute("aria-expanded"), "true");
    }
    await ipcRenderer.invoke("markdown-pointer-click", "#markdownTreeToggle"); await tick();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true, "dedicated panel button collapses the tree");
    check.equal(document.querySelector("#markdownFiles").getAttribute("aria-expanded"), null);
    check.equal(document.querySelector("#markdownFiles").getAttribute("aria-label"), null, "desktop filename retains its visible accessible name");
    check.equal(document.querySelector<HTMLButtonElement>("#markdownFiles").disabled, true, "desktop filename is a non-action label");
    (document.querySelector("#markdownFiles") as HTMLElement).click(); await tick();
    check.equal(panelToggle.getAttribute("aria-expanded"), "false", "desktop filename cannot toggle the tree");
    panelToggle.click(); await tick();
    check.equal(document.querySelector<HTMLButtonElement>("#markdownUndo").disabled, true);
    check.equal(document.querySelector<HTMLButtonElement>("#markdownRedo").disabled, true);
    check.equal(document.querySelector(".markdown-footer .markdown-policy"), null);
    check.equal(document.querySelector(".markdown-header").getBoundingClientRect().height, 32, "desktop header stays at the main toolbar height");
    check.equal(document.querySelector(".markdown-footer").getBoundingClientRect().height, 24, "ordinary save status uses a compact footer");
    check.equal(document.querySelector("#markdownSave").checkVisibility(), false, "file actions start collapsed");
    check.equal(application.session.getState().status, "saved");
    check.equal(writes.length, 0);
    check.deepEqual(Array.from(document.querySelectorAll(".markdown-tree [data-node-id]")).map(row => row.getAttribute("data-node-id")), ["folder", "note2", "note10", "original"]);
    check.equal(document.querySelector(".markdown-tree__viewport").getAttribute("aria-label"), `${languages.markdownFiles}: Notes`);
    check.equal(getComputedStyle(document.querySelector(".markdown-tree__viewport")).userSelect, "none");
    check.equal(document.querySelector('[data-node-id="folder"]').getAttribute("aria-level"), "1");
    const resizeHandle = document.querySelector(".markdown-tree__resize");
    check.equal(resizeHandle.getBoundingClientRect().width, 6, "thin resize line retains its pointer hit area");
    check.equal(getComputedStyle(resizeHandle, "::after").width, "2px");
    const firstTreeRows = Array.from(document.querySelectorAll(".markdown-tree [data-node-id]"));
    check.equal(firstTreeRows[1].getBoundingClientRect().top - firstTreeRows[0].getBoundingClientRect().top,
        firstTreeRows[0].getBoundingClientRect().height + 2, "virtual row pitch matches actual rendered row spacing");
    moreButton.focus();
    await ipcRenderer.invoke("markdown-pointer-click", '[data-node-id="folder"]');
    await new Promise(resolve => setTimeout(resolve, 0));
    const openingGroup = document.querySelector<HTMLElement>(".markdown-tree__animation");
    check.ok(openingGroup, "a user expansion animates after its first listing is ready");
    const openingAnimation = openingGroup.getAnimations()[0];
    check.equal(openingAnimation.effect.getTiming().duration, 200);
    openingAnimation.pause(); openingAnimation.currentTime = 60;
    check.ok(openingGroup.getBoundingClientRect().height > 0 && openingGroup.getBoundingClientRect().height < 30,
        "expansion has an intermediate height");
    openingAnimation.finish(); await tick();
    check.ok(document.querySelector('[data-node-id="nested"]'), "folders expand lazily");
    const clickFolder = () => (document.querySelector('[data-node-id="folder"]') as HTMLElement).click();
    clickFolder();
    const closingGroup = document.querySelector<HTMLElement>(".markdown-tree__animation");
    check.equal(closingGroup.inert, true);
    check.equal(closingGroup.getAttribute("aria-hidden"), "true");
    check.equal(closingGroup.querySelector("[id], [data-row], [data-node-id]"), null, "exit snapshots cannot activate stale file nodes");
    closingGroup.getAnimations()[0].pause();
    clickFolder(); await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(closingGroup.isConnected, false, "a rapid reversal cancels the old exit snapshot");
    document.querySelector(".markdown-tree__animation")?.getAnimations()[0].finish(); await tick();
    check.ok(document.querySelector('[data-node-id="nested"]'));
    await ipcRenderer.invoke("markdown-reduced-motion", true);
    clickFolder(); clickFolder(); await tick();
    check.equal(document.querySelector(".markdown-tree__animation"), null, "reduced motion skips folder transitions");
    check.ok(document.querySelector('[data-node-id="nested"]'));
    await ipcRenderer.invoke("markdown-reduced-motion", false);
    clickFolder();
    const listFolder = bridge.tree.list;
    let finishFolder: (value: import("./treeContracts").MarkdownTreeListing) => void;
    bridge.tree.list = location => location.nodeId === "folder" ? new Promise(resolve => {finishFolder = resolve;}) : listFolder(location);
    clickFolder();
    check.equal(document.querySelector('[data-node-id="nested"]'), null, "a loading expansion keeps its children collapsed");
    check.equal(document.querySelector('[data-node-id="folder"]').getAttribute("aria-busy"), "true");
    clickFolder();
    finishFolder({kind: "listed", rootId: "root", generation: 1, nodeId: "folder", entries: [{id: "nested", name: "Nested.md", kind: "file"}]});
    await tick();
    check.equal(document.querySelector('[data-node-id="nested"]'), null, "a late expansion result cannot reopen a folder the user collapsed");
    bridge.tree.list = listFolder;
    clickFolder(); await tick();
    document.querySelector(".markdown-tree__animation")?.getAnimations()[0].finish(); await tick();
    const contentFont = getComputedStyle(document.querySelector(".vditor-ir pre p")).fontFamily;
    check.ok(contentFont.includes("Microsoft Yahei"), contentFont);
    await ipcRenderer.invoke("markdown-screenshot", "light");
    const desktopClasses = document.body.className;
    await ipcRenderer.invoke("markdown-resize", 360, 800);
    for (const platform of ["ios", "android", "harmony"]) {
        document.body.className = `body--${platform}`;
        for (const dark of [false, true]) {
            onCommand({id: `icon-theme-${platform}-${dark}`, type: "theme", dark});
            const deadline = Date.now() + 5000;
            while (document.documentElement.dataset.themeMode !== (dark ? "dark" : "light") && Date.now() < deadline) await tick();
            openMore(); await tick();
            await ipcRenderer.invoke("markdown-pointer-click", "#markdownResourcesInfo"); await tick();
            check.equal(document.querySelector("#markdownResourcesInfo").getAttribute("aria-expanded"), "true");
            for (const id of ["markdownTreeToggle", "markdownMoreButton", "markdownUndo", "markdownRedo", "markdownResourcesInfo", "markdownRecoveryInfo"]) {
                const button = document.getElementById(id);
                const bounds = button.getBoundingClientRect();
                const icon = button.querySelector("svg").getBoundingClientRect();
                const style = getComputedStyle(button);
                check.equal(bounds.width, 44, `${platform} ${id} retains its touch width`);
                check.equal(bounds.height, 44, `${platform} ${id} retains its touch height`);
                check.equal(bounds.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth), 32,
                    `${platform} ${id} has a compact visible background`);
                check.equal(bounds.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth), 32);
                check.equal(style.backgroundClip, "padding-box");
                check.equal(style.getPropertyValue("-webkit-tap-highlight-color"), "rgba(0, 0, 0, 0)", "native tap feedback cannot cover the larger hit area");
                check.ok(Math.abs(icon.x + icon.width / 2 - bounds.x - bounds.width / 2) < 0.5, `${id} is horizontally centered`);
                check.ok(Math.abs(icon.y + icon.height / 2 - bounds.y - bounds.height / 2) < 0.5, `${id} is vertically centered`);
            }
            await ipcRenderer.invoke("markdown-screenshot", `touch-${platform}-${dark ? "dark" : "light"}-icons`);
            (document.querySelector("#markdownResourcesInfo") as HTMLElement).click();
            moreButton.click();
        }
    }
    document.body.className = desktopClasses;
    onCommand({id: "restore-icon-theme", type: "theme", dark: false});
    await ipcRenderer.invoke("markdown-resize", 1100, 850); await tick();
    openMore();
    for (const item of document.querySelectorAll("#markdownActions > .b3-menu__item, #markdownTheme, #markdownFont")) {
        const use = item.querySelector(":scope > svg.b3-menu__icon use");
        check.ok(use?.getAttribute("href")?.startsWith("#icon"), "menu entries have a leading function icon");
        check.ok(document.querySelector(use.getAttribute("href")), "menu icon exists in the bundled sprite");
    }
    check.equal(document.querySelector(".markdown-header select"), null, "choices use checked submenus");
    const modeItem = document.querySelector<HTMLElement>("#markdownMode");
    modeItem.click();
    check.equal(modeItem.getAttribute("aria-expanded"), "true");
    check.equal(modeItem.querySelector('[data-value="ir"]').getAttribute("aria-checked"), "true");
    const modeMenu = modeItem.querySelector<HTMLElement>(".markdown-choice__menu");
    check.ok(modeMenu.scrollHeight <= modeMenu.clientHeight, "a short submenu has no spurious vertical scrollbar");
    check.ok(modeMenu.scrollWidth <= modeMenu.clientWidth, "a short submenu has no horizontal scrollbar");
    const selectedModeBounds = modeItem.querySelector('[data-value="ir"]').getBoundingClientRect();
    const modeMenuBounds = modeMenu.getBoundingClientRect();
    check.ok(selectedModeBounds.left - modeMenuBounds.left >= 6 && modeMenuBounds.right - selectedModeBounds.right >= 6,
        "submenu selection keeps a visible horizontal gutter on both sides");
    await ipcRenderer.invoke("markdown-screenshot", "mode-menu");
    modeItem.click();
    check.equal(document.querySelector("#markdownTheme").checkVisibility(), false, "appearance starts collapsed");
    const appearanceItem = document.querySelector<HTMLElement>("#markdownPreferences");
    check.equal(appearanceItem.tagName, "DIV", "appearance uses a submenu instead of a details accordion");
    check.equal(appearanceItem.getAttribute("aria-haspopup"), "menu");
    check.equal(appearanceItem.querySelector(":scope > .b3-menu__icon--arrow use").getAttribute("href"), "#iconRight");
    appearanceItem.click();
    check.equal(document.querySelector("#markdownTheme").checkVisibility(), true);
    appearanceItem.focus();
    appearanceItem.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
    check.equal(document.activeElement.id, "markdownTheme");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
    check.equal(document.activeElement.getAttribute("data-value"), "system");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal(document.activeElement.id, "markdownTheme");
    check.equal(appearanceItem.getAttribute("aria-expanded"), "true", "Escape closes only the innermost submenu");
    await tick();
    await ipcRenderer.invoke("markdown-screenshot", "more-menu");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal(document.activeElement, appearanceItem);
    check.equal(appearanceItem.getAttribute("aria-expanded"), "false", "Escape from a closed child entry closes its parent submenu");
    check.equal(more.open, true);
    (document.querySelector("#markdownSaveAs") as HTMLElement).focus();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal(more.open, false, "Escape closes the menu"); check.equal(document.activeElement, moreButton);
    openMore();
    document.querySelector("#markdownEditor").dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    check.equal(more.open, false, "outside pointer closes the menu");
    openMore();
    panelToggle.focus();
    await tick();
    check.equal(more.open, false, "moving focus outside closes the menu"); check.equal(document.activeElement, panelToggle);
    for (const id of ["markdownResources", "markdownRecovery"]) {
        openMore();
        const info = document.querySelector<HTMLButtonElement>(`#${id}Info`);
        const explanation = document.querySelector<HTMLElement>(`#${id}Explanation`);
        check.equal(explanation.hidden, true);
        info.focus(); info.click();
        check.equal(explanation.hidden, false, "contextual explanations can be opened without hover");
        check.equal(info.getAttribute("aria-expanded"), "true");
        check.ok(info.title.length > 0);
        check.equal(more.open, true, "reading an explanation does not execute its adjacent action");
        info.click();
        check.equal(explanation.hidden, true);
    }
    for (const [id, value] of [["markdownTheme", "dark"], ["markdownTheme", "light"], ["markdownTheme", "system"], ["markdownFont", "20"], ["markdownFont", "16"]]) {
        openMore(); appearanceItem.focus();
        appearanceItem.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        const item = document.getElementById(id);
        item.focus(); item.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await tick();
        const selector = `#${id} [data-value="${value}"]`;
        check.equal(document.querySelector(selector).checkVisibility(), true, "appearance choices are reachable in the nested submenu");
        await ipcRenderer.invoke("markdown-screenshot", `appearance-${id}-${value}`);
        const rect = document.querySelector(selector).getBoundingClientRect();
        check.equal(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("[data-value]")?.getAttribute("data-value"), value,
            "the selected appearance item is not covered by another submenu");
        await ipcRenderer.invoke("markdown-pointer-click", selector);
        const deadline = Date.now() + 5000;
        while (item.querySelector('[aria-checked="true"]').getAttribute("data-value") !== value && Date.now() < deadline) await tick();
        check.equal(more.open, false, "choosing an appearance value closes the complete menu chain");
        check.equal(item.querySelector('[aria-checked="true"]').getAttribute("data-value"), value, `${id} selection persists ${value}`);
    }
    check.equal(writes.length, 0, "appearance selections never rewrite the document");

    application.editor.setMode("sv");
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    textarea.value += "\nA committed edit\n";
    textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "A committed edit"}));
    check.equal(document.querySelector("#markdownStatus").textContent, languages.markdownUnsaved, "pending serialization is immediately shown as unsaved");
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "s", ctrlKey: true, bubbles: true, cancelable: true}));
    await tick();
    check.ok(writes.at(-1).content.includes("A committed edit"));
    check.equal(application.session.getState().status, "saved");
    check.equal(application.session.getState().durability, "provider");
    for (let attempt = 0; attempt < 5 && document.querySelector("#markdownStatus").textContent !== languages.markdownSaved; attempt++) await tick();
    check.equal(document.querySelector("#markdownStatus").textContent, languages.markdownSaved,
        "a successful provider save uses the normal saved status without a cloud sync warning");
    const undo = document.querySelector<HTMLButtonElement>("#markdownUndo");
    const redo = document.querySelector<HTMLButtonElement>("#markdownRedo");
    for (let attempt = 0; attempt < 5 && undo.disabled; attempt++) await tick();
    check.equal(undo.disabled, false, "header undo becomes available after a source edit");
    const mouseDown = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
    undo.dispatchEvent(mouseDown); check.equal(mouseDown.defaultPrevented, true, "history buttons preserve editor focus");
    undo.click(); await new Promise(resolve => setTimeout(resolve, 750));
    check.equal(application.session.getState().content.includes("A committed edit"), false, "header undo removes the last edit");
    check.equal(writes.at(-1).content.includes("A committed edit"), false, "undo is automatically saved");
    check.equal(redo.disabled, false, "header redo becomes available after undo");
    redo.click(); await new Promise(resolve => setTimeout(resolve, 750));
    check.ok(writes.at(-1).content.includes("A committed edit"), "redo is automatically saved");
    textarea.value += "\nAuto-save after unavailable redo\n";
    textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText"}));
    await new Promise(resolve => setTimeout(resolve, 350));
    textarea.dispatchEvent(new KeyboardEvent("keydown", {key: "y", code: "KeyY", ctrlKey: true, bubbles: true, cancelable: true}));
    await new Promise(resolve => setTimeout(resolve, 750));
    check.ok(writes.at(-1).content.includes("Auto-save after unavailable redo"), "a no-op history shortcut must resume dirty auto-save");
    const originalSavePicker = bridge.chooseSaveAs;
    bridge.chooseSaveAs = async () => ({kind: "cancelled"});
    textarea.value += "\nAuto-save after cancelled Save As\n";
    textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText"}));
    menuAction("markdownSaveAs");
    await new Promise(resolve => setTimeout(resolve, 1000));
    check.ok(writes.at(-1).content.includes("Auto-save after cancelled Save As"));
    bridge.chooseSaveAs = originalSavePicker;
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "n", ctrlKey: true, bubbles: true, cancelable: true}));
    await tick();
    check.equal(newDocuments, 1);
    menuAction("markdownNew"); await tick(); check.equal(newDocuments, 2);
    menuAction("markdownOpen"); await tick(); check.equal(openedDocuments, 1);
    const beforeOversizedPaste = writes.length;
    const clipboard = new DataTransfer(); clipboard.setData("text/plain", "x".repeat(8 * 1024 * 1024 + 1));
    const oversizedPaste = new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: clipboard});
    textarea.dispatchEvent(oversizedPaste);
    check.equal(oversizedPaste.defaultPrevented, true);
    check.equal(document.querySelector("#markdownStatus").textContent, languages.markdownTooLarge);
    await tick(); check.equal(writes.length, beforeOversizedPaste);

    menuAction("markdownSaveAs");
    await tick();
    check.equal(application.session.getState().target.handle, "copy");
    check.equal(writes.at(-1).target.handle, "copy");
    check.equal(cancelledCandidates, 0, "a committed binding must not be cancelled as an unused candidate");
    menuAction("markdownInsertImage");
    await tick();
    check.ok(writes.at(-1).content.includes("images/example%20photo.png"));
    let finishImage: (result: {kind: "inserted"; reference: string}) => void;
    bridge.insertImage = () => new Promise(resolve => {finishImage = resolve;});
    menuAction("markdownInsertImage");
    await tick();
    const beforePrepare = responses.length;
    onCommand({id: "image-prepare", type: "prepare-quit"});
    await tick();
    check.equal(responses.length, beforePrepare);
    finishImage({kind: "inserted", reference: "images/late.png"});
    await tick();
    check.ok(writes.at(-1).content.includes("images/late.png"));
    check.equal(responses.at(-1), true);
    onCommand({id: "image-cancel", type: "cancel-quit"});
    menuAction("markdownInsertImage");
    await tick();
    onCommand({id: "stale-image-prepare", type: "prepare-quit"});
    onCommand({id: "cancel-before-image", type: "cancel-quit"});
    finishImage({kind: "inserted", reference: "images/after-cancel.png"});
    await tick();
    check.equal(responses.at(-1), false);
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    application.editor.setMode("ir");
    onCommand({id: "theme", type: "theme", dark: true});
    await tick();
    check.equal(document.documentElement.dataset.themeMode, "dark");
    await ipcRenderer.invoke("markdown-screenshot", "dark");
    menuAction("markdownRecovery");
    await tick();
    check.equal((document.querySelector("#markdownRecoveryPanel") as HTMLElement).hidden, false);
    check.ok(document.querySelector("#markdownRecoveryList").textContent.includes("恢复文档.md"));
    document.body.classList.add("body--android");
    await ipcRenderer.invoke("markdown-resize", 360, 800);
    await tick();
    check.ok(document.documentElement.scrollWidth <= window.innerWidth + 1);
    check.ok(document.querySelector("#markdownMoreButton").getBoundingClientRect().height >= 44);
    for (const id of ["markdownUndo", "markdownRedo"]) check.ok(document.getElementById(id).getBoundingClientRect().height >= 44);
    check.equal(document.querySelector(".markdown-header").getBoundingClientRect().height, 48, "touch header removes extra padding around touch targets");
    check.equal(document.querySelector(".markdown-footer").getBoundingClientRect().height, 24, "touch save status keeps the compact resting height");
    check.ok(document.querySelector("#markdownFiles").getBoundingClientRect().height >= 44);
    check.equal(document.querySelector<HTMLButtonElement>("#markdownFiles").disabled, false, "drawer filename remains interactive");
    check.ok(document.querySelector("#markdownTreeToggle").getBoundingClientRect().height >= 44);
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true, "narrow tree starts as a collapsed drawer");
    await ipcRenderer.invoke("markdown-screenshot", "narrow-recovery");
    (document.querySelector("#markdownRecoveryClose") as HTMLButtonElement).click();
    await tick();
    await ipcRenderer.invoke("markdown-screenshot", "narrow");
    panelToggle.focus(); panelToggle.click(); await tick();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true);
    check.equal(document.activeElement, panelToggle, "Escape returns focus to the panel button that opened the drawer");
    (document.querySelector("#markdownFiles") as HTMLElement).click(); await tick();
    panelToggle.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true})); panelToggle.click();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true, "switching toggle buttons closes the drawer with one click");
    panelToggle.click(); await tick();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, false);
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, true, "drawer mask also excludes the editor from keyboard focus");
    check.ok(document.querySelector("#markdownTree").getBoundingClientRect().width <= window.innerWidth - 48);
    const editorSurface = document.querySelector<HTMLElement>("#markdownEditor");
    check.equal(getComputedStyle(editorSurface).isolation, "isolate");
    const drawerBounds = document.querySelector("#markdownTree").getBoundingClientRect();
    const popupProbe = document.createElement("div");
    popupProbe.className = "vditor-panel";
    popupProbe.style.cssText = `display:block;position:fixed;left:${drawerBounds.left + 12}px;top:${drawerBounds.top + 12}px;width:80px;height:40px;z-index:1000000;animation:none`;
    editorSurface.append(popupProbe);
    // 暂时解除 inert，确保命中验证的是层叠关系，而非抽屉的交互屏蔽。
    editorSurface.inert = false;
    try {
        const hit = document.elementFromPoint(drawerBounds.left + 20, drawerBounds.top + 20);
        check.ok(document.querySelector("#markdownTree").contains(hit), "editor popovers cannot cover the open drawer even with a high child z-index");
    } finally {
        popupProbe.remove();
        editorSurface.inert = true;
    }
    const themeFeedback = document.createElement("span");
    themeFeedback.style.color = "var(--b3-list-hover)";
    document.body.append(themeFeedback);
    check.equal(getComputedStyle(document.getElementById("markdownMode")).getPropertyValue("-webkit-tap-highlight-color"),
        getComputedStyle(themeFeedback).color, "tap feedback inherits the current theme instead of native blue");
    themeFeedback.remove();
    await ipcRenderer.invoke("markdown-screenshot", "narrow-tree");
    (document.querySelector('[data-node-id="note2"]') as HTMLElement).click(); await tick();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true, "successful file selection closes the drawer");
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    await ipcRenderer.invoke("markdown-resize", 390, 360);
    await tick();
    check.ok(document.documentElement.scrollWidth <= window.innerWidth + 1);
    const editorBounds = document.querySelector(".vditor-content").getBoundingClientRect();
    check.ok(editorBounds.height >= 140, `reduced viewport editor height: ${editorBounds.height}`);
    check.ok(editorBounds.bottom <= window.innerHeight, "the editor remains above the viewport bottom");
    await ipcRenderer.invoke("markdown-screenshot", "keyboard-height");
    openMore();
    const menuBounds = document.querySelector("#markdownActions").getBoundingClientRect();
    check.ok(menuBounds.bottom <= window.innerHeight, "open menu fits the reduced viewport and scrolls internally");
    check.ok(document.querySelector("#markdownSave").getBoundingClientRect().height >= 44);
    await tick();
    await ipcRenderer.invoke("markdown-screenshot", "keyboard-menu");
    moreButton.click();

    application.editor.setMode("sv");
    const racingTextarea = document.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    const beforeRace = application.session.getState();
    const writesBeforeRace = writes.length;
    delayRead = true;
    onCommand({id: "delayed-external", type: "external-change"});
    await new Promise(resolve => setTimeout(resolve, 0));
    check.ok(finishRead, "an external read is in flight before local input");
    const raceReads = reads;
    racingTextarea.value += "\nInput during the external read\n";
    racingTextarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Input during the external read"}));
    check.equal(application.session.getState().revision, beforeRace.revision, "the serializer has not committed the input yet");
    onCommand({id: "external-while-pending", type: "external-change"});
    finishRead({kind: "read", content: "Stale external read\n", target: {...target, baseline: "stale-read"}});
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(reads, raceReads, "unserialized input prevents starting another reload");
    check.ok(racingTextarea.value.includes("Input during the external read"));
    check.equal(application.session.getState().target.baseline, beforeRace.target.baseline);
    check.equal(writes.length, writesBeforeRace, "the stale reload cannot trigger writeback");
    delayRead = false;
    await application.session.flush(application.editor);
    check.ok(writes.at(-1).content.includes("Input during the external read"));
    application.editor.setMode("ir");

    target = {...application.session.getState().target, baseline: "external"};
    content = "External document update\n";
    onCommand({id: "external", type: "external-change"});
    await tick();
    check.equal(application.editor.flush().content, content);
    onCommand({id: "background", type: "background"});
    await tick();
    check.equal(responses.at(-1), true);
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    check.equal(closeConfirmations, 0);
    openMore();
    onCommand({id: "prepare", type: "prepare-quit"});
    await tick();
    check.equal(responses.at(-1), true);
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, true);
    check.equal(more.open, false); check.equal(more.inert, true);
    check.equal(panelToggle.disabled, true);
    check.equal(document.querySelector<HTMLButtonElement>("#markdownFiles").disabled, true);
    onCommand({id: "cancel", type: "cancel-quit"});
    await tick();
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    check.equal(more.inert, false);
    failWrite = true;
    application.session.updateEditor({content: "Unsaved at exit", edited: true, composing: false});
    application.editor.setValue("Unsaved at exit");
    onCommand({id: "prepared-close", type: "prepare-quit"});
    await tick();
    check.equal(responses.at(-1), true);
    check.equal(closeConfirmations, 1);
    onCommand({id: "close", type: "close"});
    await tick();
    check.equal(responses.at(-1), true);
    check.equal(application.session.getState().lifecycle, "closed");
    check.equal(closeConfirmations, 1);
    application.destroy();
    const bootstrap = await bridge.bootstrap();
    await ipcRenderer.invoke("markdown-resize", 1100, 850);
    document.body.classList.remove("body--android");
    failWrite = false;
    let treeBootstrap = {...bootstrap, sessionId: "tree-a", content: "A\n", target: {...target, handle: "a", displayName: "A.md"}};
    bridge.bootstrap = async () => treeBootstrap;
    let candidateKind: "ready" | "blocked" = "blocked";
    let ticket = 0;
    let closeChoice: "cancel" | "keep" = "cancel";
    let commitCalls = 0;
    let loseCommitReply = false;
    let expectedReleased = "tree-a";
    let nextFile = "B";
    const originalTreeState = bridge.tree.state;
    const originalTreeList = bridge.tree.list;
    let switchListings = 0;
    bridge.tree.state = async () => ({...await originalTreeState(), currentNodeId: treeBootstrap.target.handle === "b" ? "note2" : "original"});
    bridge.tree.list = async location => {switchListings++; return originalTreeList(location);};
    const cancelled: string[] = [];
    const oldConfirm = bridge.confirmClose;
    bridge.confirmClose = async () => {closeConfirmations++; return closeChoice;};
    bridge.tree.prepareOpen = async () => candidateKind === "blocked" ? {kind: "blocked", error: {code: "permission", recoverable: true}} :
        {kind: "ready", ticket: `ticket-${++ticket}`, sessionId: `tree-b-${ticket}`};
    bridge.tree.cancelOpen = async ticket => {cancelled.push(ticket);};
    bridge.tree.commitOpen = async () => {
        commitCalls++;
        check.equal(releases.at(-1).sessionId, expectedReleased, "old session is released before the binding changes");
        treeBootstrap = {...treeBootstrap, sessionId: `tree-b-${ticket}`, content: `${nextFile}\n`, target: {...target, handle: nextFile.toLowerCase(), displayName: `${nextFile}.md`}};
        if (loseCommitReply) throw new Error("Reply lost after commit");
        return treeBootstrap;
    };
    const switchingApp = await api.mountMarkdownApplication(bridge); await tick();
    const shellSelectors = [".markdown-header", "#markdownTree", ".markdown-tree__viewport", "#markdownActions", "#markdownMode", "#markdownEditor"];
    const shellNodes = shellSelectors.map(selector => document.querySelector(selector));
    const originalRow = document.querySelector('[data-node-id="original"]');
    const firstEditor = switchingApp.editor;
    const selectFile = (nodeId = "note2") => (document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement).click();
    selectFile(); await tick();
    check.equal(switchingApp.session.getState().sessionId, "tree-a");
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false, "failed candidate read preserves the editable current document");
    const immediatePrepare = bridge.tree.prepareOpen;
    let finishPrepare: (value: import("./treeContracts").MarkdownTreeOpen) => void;
    bridge.tree.prepareOpen = () => {
        check.equal(draftAcknowledgements.at(-1), "A pending cloud selection\n", "the current draft is acknowledged before a provider can block its queue");
        return new Promise(resolve => {finishPrepare = resolve;});
    };
    switchingApp.editor.setValue("A pending cloud selection\n");
    switchingApp.session.updateEditor({content: "A pending cloud selection\n", edited: true, composing: false});
    selectFile(); await tick();
    const backgroundReplies = responses.length;
    onCommand({id: "background-during-candidate", type: "background"}); await tick();
    check.equal(responses.length, backgroundReplies + 1, "background protection does not wait for a slow candidate read");
    check.equal(responses.at(-1), true);
    check.equal(writes.at(-1).content, "A pending cloud selection\n");
    check.equal(writes.at(-1).target.handle, "a");
    finishPrepare({kind: "blocked", error: {code: "unavailable", recoverable: true}}); await tick();
    bridge.tree.prepareOpen = immediatePrepare;
    candidateKind = "ready";
    failWrite = true;
    switchingApp.editor.setValue("Unsaved A\n");
    switchingApp.session.updateEditor({content: "Unsaved A\n", edited: true, composing: false});
    selectFile(); await tick();
    check.deepEqual(cancelled, ["ticket-1"]);
    check.equal(commitCalls, 0);
    check.equal(switchingApp.session.getState().lifecycle, "open");
    check.equal(switchingApp.editor.flush().content, "Unsaved A\n");
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    closeChoice = "keep";
    loseCommitReply = true;
    const listingsBeforeSwitch = switchListings;
    selectFile(); selectFile(); await tick(); await tick();
    check.equal(switchingApp.session.getState().sessionId, "tree-b-2", "lost commit replies reconcile through bootstrap");
    check.equal(switchingApp.editor.flush().content, "B\n");
    check.equal(document.querySelector("#markdownName").textContent, "B.md");
    check.ok(document.getElementById("vditor-icon-bold"), "document replacement retains formatting icons");
    shellSelectors.forEach((selector, index) => check.equal(document.querySelector(selector), shellNodes[index], `${selector} survives the switch`));
    check.equal(document.querySelector('[data-node-id="original"]'), originalRow, "same-root switching retains mounted tree rows");
    check.equal(switchListings, listingsBeforeSwitch, "same-root switching does not enumerate folders again");
    check.notEqual(switchingApp.editor, firstEditor, "undo state belongs to the new document editor");
    check.equal(document.querySelector<HTMLButtonElement>("#markdownUndo").disabled, true);
    check.equal(document.querySelector<HTMLButtonElement>("#markdownRedo").disabled, true);
    check.equal(commitCalls, 2);
    check.deepEqual(cancelled, ["ticket-1"], "a committed candidate is never cancelled after losing its reply");
    check.equal(document.querySelectorAll(".markdown-header").length, 1);
    await ipcRenderer.invoke("markdown-screenshot", "tree-switched");
    expectedReleased = switchingApp.session.getState().sessionId;
    nextFile = "A";
    loseCommitReply = false;
    failWrite = false;
    const secondEditor = switchingApp.editor;
    selectFile("original"); await tick(); await tick();
    check.equal(switchingApp.editor.flush().content, "A\n", "A → B → A changes only the active document");
    shellSelectors.forEach((selector, index) => check.equal(document.querySelector(selector), shellNodes[index]));
    check.notEqual(switchingApp.editor, secondEditor);
    check.equal(switchListings, listingsBeforeSwitch);
    switchingApp.destroy();
    bridge.tree.state = originalTreeState;
    bridge.tree.list = originalTreeList;
    bridge.confirmClose = oldConfirm;

    treeBootstrap = {...treeBootstrap, sessionId: "tree-unknown", content: "Recoverable A\n"};
    bridge.tree.commitOpen = async () => {throw new Error("Native bridge unavailable");};
    const unknownSwitch = await api.mountMarkdownApplication(bridge); await tick();
    selectFile(); await tick();
    check.equal(unknownSwitch.session.getState().lifecycle, "closed");
    onCommand({id: "unknown-close", type: "close"}); await tick();
    check.equal(responses.at(-1), false);
    onCommand({id: "unknown-cancel", type: "cancel-quit"}); await tick();
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, true, "an unconfirmed switch cannot revive an already released editor");
    check.equal((document.querySelector("#markdownRetry") as HTMLElement).hidden, false);
    check.equal((document.querySelector("#markdownProblemActions") as HTMLElement).inert, false, "binding reconciliation remains available");
    bridge.tree.commitOpen = async () => ({...treeBootstrap, sessionId: `tree-b-${ticket}`, content: "Recovered B\n"});
    (document.querySelector("#markdownRetry") as HTMLButtonElement).click(); await tick(); await tick();
    check.equal(unknownSwitch.editor.flush().content, "Recovered B\n");
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, false);
    unknownSwitch.destroy();

    let treeState: import("./treeContracts").MarkdownTreeState = {kind: "ready", rootId: "old-root", generation: 1,
        rootName: "Old folder", currentNodeId: "outside-root", expanded: ["old-root"], width: 240, visible: true};
    let finishList: (value: import("./treeContracts").MarkdownTreeListing) => void;
    let treeLists = 0;
    let tooMany = false;
    let chosen: import("./treeContracts").MarkdownTreeState | {kind: "cancelled"} = {kind: "cancelled"};
    const savedViews: import("./treeContracts").MarkdownTreeView[] = [];
    const testTree = api.createMarkdownTree({
        element: document.querySelector("#markdownTree"), toggles: [document.querySelector("#markdownTreeToggle"), document.querySelector("#markdownFiles")],
        mobile: false, text: key => languages[key] ?? key, onError: () => {throw new Error("Unexpected tree error");}, onOpen: async () => true,
        bridge: {...bridge.tree, state: async () => treeState, chooseRoot: async () => chosen,
            saveView: async view => {savedViews.push(view);}, list: async location => {
                treeLists++;
                if (location.rootId === "old-root") return new Promise(resolve => {finishList = resolve;});
                return {kind: "listed", ...location, entries: Array.from({length: tooMany ? 10001 : 10000}, (_, i) => ({id: `file-${i}`, kind: "file", name: `Note${i}.md`}))};
            }},
    });
    await tick();
    check.equal(treeLists, 1);
    chosen = treeState = {...treeState, rootId: "new-root", generation: 2, rootName: "New folder", expanded: ["new-root"]};
    await testTree.chooseRoot(); await tick();
    finishList({kind: "listed", rootId: "old-root", generation: 1, nodeId: "old-root", entries: [{id: "stale", name: "Stale.md", kind: "file"}]});
    await tick();
    check.equal(document.querySelector('[data-node-id="stale"]'), null, "a late old-root listing cannot populate the new tree");
    check.equal(document.querySelector('[data-node-id="new-root"]'), null, "root is not a redundant collapsible row");
    check.ok(document.querySelectorAll("#markdownTree [data-node-id]").length < 100, "large directories render a bounded visible range");
    const treeViewport = document.querySelector<HTMLElement>(".markdown-tree__viewport");
    check.equal(document.getElementById(treeViewport.getAttribute("aria-activedescendant"))?.dataset.nodeId, "file-0",
        "a current file outside the chosen root gives keyboard focus to the first actual child");
    treeViewport.focus();
    treeViewport.dispatchEvent(new KeyboardEvent("keydown", {key: "End", bubbles: true, cancelable: true}));
    await tick();
    check.ok(document.querySelector('[data-node-id="file-9999"]'), "keyboard navigation reaches virtualized rows");
    const lastRowScroll = treeViewport.scrollTop;
    await testTree.refresh(); await tick();
    check.equal(treeViewport.scrollTop, lastRowScroll, "directory polling preserves the visible range while a replacement listing loads");
    check.ok(document.querySelector('[data-node-id="file-9999"]'));
    check.equal(document.querySelector(".markdown-tree__animation"), null, "polling does not animate restored folders");
    treeViewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Home", bubbles: true, cancelable: true})); await tick();
    treeViewport.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true, cancelable: true}));
    check.ok(document.querySelector('[data-node-id="file-0"]'), "root children cannot all be collapsed by folding a redundant root");
    check.equal(document.querySelector(".markdown-tree__animation"), null);
    tooMany = true;
    treeViewport.scrollTop = 0;
    await testTree.refresh(); await tick();
    check.ok(document.querySelector("#markdownTree").textContent.includes(languages.markdownFolderLimit), "directory limits are visible rather than silently truncating entries");
    treeState = {kind: "permission-required", generation: 3, expanded: [], width: 240, visible: true};
    await testTree.refresh(); await tick();
    check.equal(treeViewport.hidden, true);
    check.ok(document.querySelector("#markdownTree").textContent.includes(languages.markdownFolderPermission));
    const listsBeforeCancel = treeLists;
    chosen = {kind: "cancelled"};
    await testTree.chooseRoot();
    check.equal(treeLists, listsBeforeCancel, "cancelled directory authorization never enumerates a parent");
    document.querySelector<HTMLButtonElement>("#markdownTreeToggle").click();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, true);
    let finishChoose: (value: import("./treeContracts").MarkdownTreeState) => void;
    const choiceBridge = bridge.tree.chooseRoot;
    // 选择目录的宿主通知可能先于选择器的回执，面板展开意图仍应保留。
    const treeBridgeForRace: import("./treeContracts").MarkdownTreeBridge = {state: async () => treeState, list: async location => ({kind: "listed", ...location, entries: []}),
        chooseRoot: () => new Promise<import("./treeContracts").MarkdownTreeState>(resolve => {finishChoose = resolve;}),
        saveView: async () => {}, prepareOpen: bridge.tree.prepareOpen, commitOpen: bridge.tree.commitOpen, cancelOpen: bridge.tree.cancelOpen};
    testTree.destroy();
    check.ok(savedViews.length > 0);
    treeState = {...treeState, visible: false};
    const raceTree = api.createMarkdownTree({element: document.querySelector("#markdownTree"), toggles: [document.querySelector("#markdownTreeToggle"), document.querySelector("#markdownFiles")],
        mobile: false, text: key => languages[key] ?? key, onError: () => {}, onOpen: async () => true, bridge: treeBridgeForRace});
    await tick();
    const choosing = raceTree.chooseRoot();
    treeState = {kind: "ready", rootId: "chosen-root", generation: 4, rootName: "Chosen", expanded: ["chosen-root"], width: 240, visible: false};
    await raceTree.refresh();
    finishChoose(treeState);
    await choosing; await tick();
    check.equal((document.querySelector("#markdownTree") as HTMLElement).hidden, false, "choosing a folder shows the tree even when its change notification arrives first");
    check.equal(document.querySelector(".markdown-tree__viewport").getAttribute("title"), "Chosen");
    check.equal(document.querySelectorAll("#markdownTree [data-row]").length, 0, "an empty root has no redundant collapsible row");
    raceTree.destroy();
    bridge.tree.chooseRoot = choiceBridge;

    for (const scenario of ["blank", "edited-empty", "recovered-empty"]) {
        bridge.bootstrap = async () => ({...bootstrap, sessionId: scenario, content: "", target: undefined,
            recovered: scenario === "recovered-empty" ? {revision: 0, targetGeneration: 0} : undefined});
        const draft = await api.mountMarkdownApplication(bridge);
        const confirmationsBefore: number = closeConfirmations;
        if (scenario === "blank") {
            check.equal(document.querySelector("#markdownStatus").textContent, "", "a new blank page does not claim a persisted draft");
        } else if (scenario === "edited-empty") {
            draft.session.updateEditor({content: "Temporary input", edited: true, composing: false});
            draft.session.updateEditor({content: "", edited: true, composing: false});
        }
        onCommand({id: `${scenario}-close`, type: "close"});
        await tick();
        check.equal(responses.at(-1), true);
        check.equal(closeConfirmations, confirmationsBefore + (scenario === "blank" ? 0 : 1));
        draft.destroy();
    }
    storedPreferences = {...storedPreferences, mode: "ir"};
    const boundaryHeading = "# 阈值文档\n\n";
    const boundaryContent = boundaryHeading + "a".repeat(api.MARKDOWN_RENDER_BYTES - new TextEncoder().encode(boundaryHeading).length);
    bridge.bootstrap = async () => ({...bootstrap, sessionId: "boundary-ui", content: boundaryContent, preferences: {...storedPreferences}});
    const boundaryEditor = await api.mountMarkdownApplication(bridge);
    check.equal(document.querySelector('#markdownMode [aria-checked="true"]').getAttribute("data-value"), "ir", "content at the rendering threshold keeps the preferred rich mode");
    check.ok(document.querySelector(".vditor-ir h1"));
    boundaryEditor.destroy();
    const preferencesBefore = preferenceUpdates.length;
    bridge.bootstrap = async () => ({...bootstrap, sessionId: "large-ui", content: boundaryContent + "a", preferences: {...storedPreferences}, recovered: {revision: 7, targetGeneration: 3}});
    const largeRecovery = await api.mountMarkdownApplication(bridge);
    const modeSelect = document.querySelector<HTMLElement>("#markdownMode");
    check.equal(modeSelect.querySelector('[aria-checked="true"]').getAttribute("data-value"), "sv");
    check.equal(storedPreferences.mode, "ir", "automatic source mode does not replace the preferred rich mode");
    (document.querySelector("#markdownMoreButton") as HTMLElement).click(); modeSelect.click();
    modeSelect.querySelector<HTMLButtonElement>('[data-value="ir"]').click();
    await tick();
    check.equal(modeSelect.querySelector('[aria-checked="true"]').getAttribute("data-value"), "sv", "unsupported rich mode leaves source mode checked");
    check.equal(storedPreferences.mode, "ir", "a rejected rich mode selection cannot persist source mode");
    check.ok(preferenceUpdates.slice(preferencesBefore).every(patch => patch.mode === undefined));
    (document.querySelector("#markdownMoreButton") as HTMLElement).click();
    const largeAppearance = document.querySelector<HTMLElement>("#markdownPreferences");
    largeAppearance.focus(); largeAppearance.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
    const largeFont = document.querySelector<HTMLElement>("#markdownFont");
    largeFont.focus(); largeFont.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
    largeFont.querySelector<HTMLButtonElement>('[data-value="20"]').click(); await tick();
    check.equal(modeSelect.querySelector('[aria-checked="true"]').getAttribute("data-value"), "sv", "changing appearance keeps the actual fallback mode checked");
    check.equal(storedPreferences.mode, "ir");
    largeRecovery.destroy();
    bridge.bootstrap = async () => ({...bootstrap, sessionId: "small-after-large", content: "# Small document\n", preferences: {...storedPreferences}});
    const smallAfterLarge = await api.mountMarkdownApplication(bridge);
    check.equal(document.querySelector('#markdownMode [aria-checked="true"]').getAttribute("data-value"), "ir", "the next small document restores the user's preferred mode");
    smallAfterLarge.destroy();
    bridge.bootstrap = async () => ({...bootstrap, sessionId: "explicit-source", content: boundaryContent + "a", preferences: {...storedPreferences}});
    const explicitSource = await api.mountMarkdownApplication(bridge);
    (document.querySelector("#markdownMoreButton") as HTMLElement).click();
    const explicitMode = document.querySelector<HTMLElement>("#markdownMode");
    explicitMode.focus(); explicitMode.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
    explicitMode.querySelector<HTMLButtonElement>('[data-value="sv"]').click(); await tick();
    check.equal(storedPreferences.mode, "sv", "explicitly selecting the active source mode is remembered");
    explicitSource.destroy();
    bridge.bootstrap = async () => ({...bootstrap, sessionId: "small-explicit-source", content: "# Small source document\n", preferences: {...storedPreferences}});
    const smallExplicitSource = await api.mountMarkdownApplication(bridge);
    check.equal(document.querySelector('#markdownMode [aria-checked="true"]').getAttribute("data-value"), "sv");
    check.ok(document.querySelector(".vditor-preview h1"), "a user's source mode still previews small files");
    smallExplicitSource.destroy();
    const desktopBody = document.body.className;
    for (const platform of ["android", "ios", "harmony"]) {
        document.body.className = "";
        storedPreferences = {...storedPreferences, mode: "wysiwyg"};
        bridge.bootstrap = async () => ({...bootstrap, platform, sessionId: `${platform}-large`, content: boundaryContent + "a", preferences: {...storedPreferences}});
        const mobileLarge = await api.mountMarkdownApplication(bridge);
        check.equal(document.querySelector('#markdownMode [aria-checked="true"]').getAttribute("data-value"), "sv");
        check.equal(storedPreferences.mode, "wysiwyg", `${platform} preserves the preferred mode during automatic fallback`);
        mobileLarge.destroy();
        bridge.bootstrap = async () => ({...bootstrap, platform, sessionId: `${platform}-small`, content: "# Small mobile document\n", preferences: {...storedPreferences}});
        const mobileSmall = await api.mountMarkdownApplication(bridge);
        check.equal(document.querySelector('#markdownMode [aria-checked="true"]').getAttribute("data-value"), "wysiwyg");
        mobileSmall.destroy();
    }
    document.body.className = desktopBody;
    for (const platform of ["win32", "darwin", "linux"]) {
        const controls: string[] = [];
        const overlays: Array<{height: number; symbolColor: string}> = [];
        bridge.window = {state: async () => ({maximized: false, fullscreen: false}),
            control: async action => {controls.push(action);}, overlay: async value => {overlays.push(value); return true;}};
        bridge.bootstrap = async () => ({...bootstrap, sessionId: `chrome-${platform}`, platform});
        const chrome = await api.mountMarkdownApplication(bridge); await tick();
        const root = document.getElementById("markdownApp");
        const header = root.querySelector<HTMLElement>(".markdown-header");
        const placeholder = root.querySelector<HTMLElement>(".markdown-caption-placeholder");
        check.equal(root.dataset.windowControls, platform === "win32" ? "overlay" : platform === "darwin" ? "mac" : "custom");
        check.equal(getComputedStyle(header).getPropertyValue("-webkit-app-region"), "drag");
        check.equal(getComputedStyle(document.getElementById("markdownFiles")).getPropertyValue("-webkit-app-region"), "drag", "desktop filename remains a draggable label");
        check.equal(getComputedStyle(document.getElementById("markdownTreeToggle")).getPropertyValue("-webkit-app-region"), "no-drag");
        check.equal(placeholder === header.firstElementChild, platform === "darwin");
        check.equal(header.getBoundingClientRect().height, 32);
        if (platform === "win32") check.ok(overlays.some(value => value.height === 32 && value.symbolColor.length > 0));
        if (platform === "linux") {
            for (const button of root.querySelectorAll<HTMLButtonElement>(".markdown-caption__button")) button.click();
            await tick(); check.deepEqual(controls, ["minimize", "maximize", "close"]);
            onCommand({id: "chrome-prepare", type: "prepare-quit"}); await tick();
            check.equal(document.getElementById("markdownMore").inert, true);
            check.equal(root.querySelector(".markdown-caption").closest("[inert]"), null, "native controls remain usable during exit protection");
        }
        onCommand({id: "chrome-state", type: "window-state", windowState: {maximized: true, fullscreen: true}}); await tick();
        check.equal(getComputedStyle(placeholder).display, "none");
        if (platform === "linux") {
            const maximize = root.querySelector<HTMLButtonElement>('[data-action="maximize"]');
            check.equal(maximize.title, languages.restore);
            check.equal(maximize.querySelector("use").getAttribute("href"), "#iconRestore");
            onCommand({id: "chrome-cancel", type: "cancel-quit"}); await tick();
        }
        chrome.destroy();
        check.equal(root.querySelector(".markdown-caption-placeholder"), null);
        check.equal(root.dataset.windowControls, undefined);
    }
    delete bridge.window;
    const beforeFailureClear = clears;
    const failureBootstrap = await bridge.bootstrap();
    bridge.bootstrap = async () => ({...failureBootstrap, dark: true, sessionId: "failed-ui", recovered: {revision: 7, targetGeneration: 3}});
    await ipcRenderer.invoke("markdown-fail-theme", true);
    await check.rejects(api.mountMarkdownApplication(bridge), /theme unavailable/);
    check.equal(document.querySelector("#markdownEditor").textContent, languages.markdownLoadError);
    check.equal((document.querySelector("#markdownEditor") as HTMLElement).inert, true);
    onCommand({id: "failed-prepare", type: "prepare-quit"}); await tick(); check.equal(responses.at(-1), true);
    failRelease = true;
    onCommand({id: "failed-close-retry", type: "close"}); await tick(); check.equal(responses.at(-1), false);
    failRelease = false;
    onCommand({id: "failed-close", type: "close"}); await tick(); check.equal(responses.at(-1), true);
    check.deepEqual(releases.at(-1), {sessionId: "failed-ui", targetGeneration: 3});
    check.equal(clears, beforeFailureClear, "initialization failure retains the pre-existing recovery draft");
    await ipcRenderer.invoke("markdown-fail-theme", false);
    const observer = Object.getOwnPropertyDescriptor(window, "MutationObserver");
    Object.defineProperty(window, "MutationObserver", {...observer, value: undefined});
    try {await check.rejects(api.mountMarkdownApplication(bridge), /capabilities are unavailable/);}
    finally {Object.defineProperty(window, "MutationObserver", observer);}
    check.equal(document.querySelector("#markdownEditor").textContent, languages.markdownLoadError);
    onCommand({id: "capability-close", type: "close"}); await tick(); check.equal(responses.at(-1), true);
    check.equal(clears, beforeFailureClear);
    return "Markdown application DOM cases passed";
};

test("Markdown file tree and compact menus preserve edits across switching, stale replies and safe exit", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-ui-test-"));
    const artifacts = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-ui-screenshots-"));
    const compileSource = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")
        .replace('require("vditor")', "globalThis.Vditor"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const source = ["../layout/dock/docTree/DocTreeModel.ts", "../menus/menuPosition.ts", "identity.ts", "limits.ts", "resourcePolicy.ts", "editor.ts", "session.ts", "nativeBridge.ts", "errors.ts", "treeAnimation.ts", "tree.ts", "choiceMenu.ts", "windowChrome.ts", "index.ts"].map(compileSource).join("\n") +
        "\nwindow.MarkdownApplicationTest = {mountMarkdownApplication, createMarkdownTree, MARKDOWN_RENDER_BYTES}; void 0;";
    const style = compile(path.resolve(__dirname, "../assets/scss/markdown.scss")).css;
    const template = readFileSync(path.resolve(__dirname, "../assets/template/markdown/index.tpl"), "utf8")
        .replace("</head>", '<link rel="stylesheet" href="/vditor/dist/index.css"><link rel="stylesheet" href="/ui.css"></head>');
    const languages = JSON.parse(readFileSync(path.resolve(__dirname, "../../appearance/langs/zh-CN.json"), "utf8"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
const fs = require("node:fs"); const path = require("node:path");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    let failTheme = false;
    ipcMain.handle("markdown-fail-theme", (_event,value)=>{failTheme=value;});
    const server = require("node:http").createServer((request, response) => {
        response.setHeader("Cache-Control","no-store");
        const pathname = new URL(request.url,"http://localhost").pathname;
        if (failTheme && pathname.endsWith("theme.css")) {response.writeHead(404);response.end();return;}
        if (pathname === "/") {response.setHeader("Content-Type","text/html; charset=utf-8"); response.end(${JSON.stringify(template)}); return;}
        if (pathname === "/ui.css") {response.setHeader("Content-Type","text/css"); response.end(${JSON.stringify(style)}); return;}
        let file;
        if (pathname === "/vditor/dist/js/lute/lute.min.js") file = ${JSON.stringify(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js"))};
        else if (pathname.startsWith("/vditor/")) file = path.join(${JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor"))}, pathname.slice(8));
        else if (pathname.startsWith("/appearance/")) file = path.join(${JSON.stringify(path.resolve(__dirname, "../../appearance"))}, pathname.slice(12));
        if (!file || pathname.includes("..")) {response.writeHead(404);response.end();return;}
        if (file.endsWith(".css")) response.setHeader("Content-Type","text/css");
        if (file.endsWith(".js")) response.setHeader("Content-Type","application/javascript");
        const stream=fs.createReadStream(file);stream.on("error",()=>{response.statusCode=404;response.end();});stream.pipe(response);
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const origin="http://127.0.0.1:"+server.address().port;
    const win = new BrowserWindow({show:false,width:1100,height:850,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
    ipcMain.handle("markdown-resize", (_event,width,height)=>{win.setSize(width,height);});
    ipcMain.handle("markdown-reduced-motion", (_event, reduce)=>win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:reduce?"reduce":"no-preference"}]}));
    ipcMain.handle("markdown-pointer-click", async (_event, selector) => {
        const point = await win.webContents.executeJavaScript('(()=>{const rect=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()');
        win.webContents.sendInputEvent({type:"mouseDown",...point,button:"left",clickCount:1});
        win.webContents.sendInputEvent({type:"mouseUp",...point,button:"left",clickCount:1});
    });
    ipcMain.handle("markdown-screenshot", async (_event,name)=>{fs.writeFileSync(path.join(${JSON.stringify(artifacts)},name+".png"),(await win.webContents.capturePage()).toPNG());});
    try {
        await win.loadURL(origin+"/");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled:true});
        await win.webContents.executeJavaScript(${JSON.stringify("window.SIYUAN_VERSION='test';globalThis.Vditor=require(" + JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor")) + ");void 0;")});
        await win.webContents.executeJavaScript(${JSON.stringify(source)});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(`const __name = value => value; (${browserCases.toString()})(${JSON.stringify(languages)})`)}));
        win.destroy();server.close();app.exit(0);
    } catch(error) {console.error(error);win.destroy();server.close();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown application DOM cases passed/);
        console.log(`Markdown UI screenshots: ${artifacts}`);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-markdown-ui-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
