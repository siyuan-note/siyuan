import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {ScriptTarget, transpileModule} from "typescript";
import {isExternalMarkdownLink, isMarkdownDisplayResource, isRelativeMarkdownResource} from "./resourcePolicy";

test("Markdown resource policy accepts only relative inputs and same-session display resources", () => {
    for (const reference of ["assets/image.png", "../images/a b.png", "image.png?version=2"]) assert.ok(isRelativeMarkdownResource(reference));
    for (const reference of ["https://example.com/a.png", "//example.com/a", "file:///tmp/a", "/absolute/a", "C:\\a", "a\n.png", "data:image/png,a"]) {
        assert.equal(isRelativeMarkdownResource(reference), false);
    }
    const page = "siyuan-markdown://session-a/index.html";
    assert.ok(isMarkdownDisplayResource("siyuan-markdown://session-a/resource/token", page));
    assert.equal(isMarkdownDisplayResource("siyuan-markdown://session-b/resource/token", page), false);
    assert.equal(isMarkdownDisplayResource("siyuan-markdown://session-a/other/token", page), false);
    assert.equal(isMarkdownDisplayResource("https://session-a/resource/token", page), false);
    assert.equal(isExternalMarkdownLink("javascript:alert(1)"), false);
    assert.ok(isExternalMarkdownLink("https://example.com"));
});

const browserCases = async (cdn: string, lutePath: string, imagesOrigin: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = (window as unknown as {MarkdownEditorTest: typeof import("./editor") & typeof import("./resourcePolicy")}).MarkdownEditorTest;
    check.equal(matchMedia("(prefers-reduced-motion: reduce)").matches, false,
        "animation cases explicitly use normal motion regardless of the host preference");
    const primaryModifier = /Mac/i.test(navigator.platform) ? {metaKey: true} : {ctrlKey: true};
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const waitFor = async (predicate: () => boolean, message: string) => {
        for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        check.ok(predicate(), message);
    };
    const outlineStyle = document.createElement("link");
    outlineStyle.rel = "stylesheet";
    outlineStyle.href = `${cdn}/dist/index.css`;
    await new Promise<void>((resolve, reject) => {
        outlineStyle.onload = () => resolve();
        outlineStyle.onerror = () => reject(new Error("Could not load Vditor outline test styles"));
        document.head.append(outlineStyle);
    });
    const policy = api.createMarkdownResourcePolicy(document);
    for (const [destination, visible] of [["https://example.com/path?q=a&b=c#part", true], ["http://example.com/", true],
        ["mailto:test@example.com", true], ["javascript:alert(1)", false], ["data:text/html,test", false],
        ["file:///private.md", false], ["https://example.com/a\nb", false]] as const) {
        const original = document.createElement("a");
        original.setAttribute("href", destination);
        original.setAttribute("ping", "https://invalid.example/track");
        original.setAttribute("onclick", "window.markdownExecuted = true");
        original.textContent = "Link";
        const template = document.createElement("template");
        template.innerHTML = policy.sanitize(original.outerHTML);
        const anchor = template.content.querySelector("a");
        check.equal(anchor.getAttribute("href"), visible ? destination : null);
        check.equal(anchor.getAttribute("ping"), null, "link tracking stays blocked");
        check.equal(anchor.getAttribute("onclick"), null, "link scripts stay blocked");
        template.innerHTML = policy.restore(template.innerHTML);
        check.equal(template.content.querySelector("a").getAttribute("href"), destination, "blocked destinations remain recoverable");
    }
    const resource = document.createElement("template");
    resource.innerHTML = policy.sanitize('<link href="https://invalid.example/style.css" rel="stylesheet">');
    check.equal(resource.content.querySelector("link"), null, "the href exception applies only to anchors");
    policy.destroy();
    for (const mobile of [false, true]) {
        const element = document.createElement("div");
        element.style.height = "360px";
        document.body.append(element);
        const destination = "https://developer.mozilla.org/zh-CN/docs/Web/API/Document/currentScript?q=a&b=c#value";
        const source = `[Document.currentScript](${destination} "Title")\n\nOutside\n`;
        const editor = await api.createMarkdownEditor({element, initialValue: source, mode: "ir", cdn, lutePath, mobile,
            onEdit: () => {}});
        editor.setMode("wysiwyg");
        const surface = element.querySelector<HTMLElement>(".vditor-wysiwyg .vditor-reset");
        const anchor = surface.querySelector("a");
        check.equal(anchor.getAttribute("href"), destination, "WYSIWYG retains the link destination after switching from IR");
        for (const theme of ["light", "dark"] as const) {
            editor.setTheme(theme);
            await waitFor(() => getComputedStyle(anchor).color !== getComputedStyle(surface.querySelector("p:last-child")).color,
                `links retain their theme styling in ${theme}`);
        }
        const range = document.createRange();
        range.selectNodeContents(anchor);
        range.collapse(false);
        surface.focus();
        getSelection().removeAllRanges(); getSelection().addRange(range);
        surface.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowLeft", bubbles: true}));
        await waitFor(() => element.querySelectorAll(".vditor-panel input").length === 3, "link editing fields are available");
        const fields = element.querySelectorAll<HTMLInputElement>(".vditor-panel input");
        check.equal(fields[1].value, destination, "link editing displays the original destination");
        fields[0].value = "Edited link";
        fields[0].dispatchEvent(new Event("input", {bubbles: true}));
        check.ok(editor.flush().content.includes(`[Edited link](${destination} "Title")`),
            "editing link text retains its destination and title");
        const nextDestination = "https://example.com/updated?q=1&b=2#part";
        fields[1].value = nextDestination;
        fields[1].dispatchEvent(new Event("input", {bubbles: true}));
        check.ok(editor.flush().content.includes(`[Edited link](${nextDestination} "Title")`), "destination edits are serialized");
        for (const mode of ["sv", "ir", "wysiwyg"] as const) {
            editor.setMode(mode);
            check.ok(editor.flush().content.includes(`[Edited link](${nextDestination} "Title")`), `link edits survive ${mode}`);
        }
        editor.destroy(); element.remove();
    }
    for (const mode of ["ir", "wysiwyg", "sv"] as const) {
        const element = document.createElement("div");
        element.style.height = "360px";
        document.body.append(element);
        const editor = await api.createMarkdownEditor({element, initialValue: "start", mode, cdn, lutePath,
            onEdit: () => {}});
        editor.focus();
        const surface = element.querySelector<HTMLElement>(mode === "sv" ? "textarea" : `.vditor-${mode} .vditor-reset`);
        if (surface instanceof HTMLTextAreaElement) surface.setSelectionRange(surface.value.length, surface.value.length);
        else {
            const range = document.createRange();
            range.selectNodeContents(surface.lastElementChild);
            range.collapse(false);
            getSelection().removeAllRanges(); getSelection().addRange(range);
        }
        for (const character of "abc") {
            await require("electron").ipcRenderer.invoke("markdown-undo-input", character);
        }
        await tick();
        for (const expected of ["startab", "starta", "start"]) {
            editor.undo();
            await tick();
            check.equal(editor.flush().content.trimEnd(), expected, `rapid input undo in ${mode}`);
        }
        for (const expected of ["starta", "startab", "startabc"]) {
            editor.redo();
            await tick();
            check.equal(editor.flush().content.trimEnd(), expected, `rapid input redo in ${mode}`);
        }
        editor.destroy(); element.remove();
    }
    for (const mode of ["ir", "wysiwyg"] as const) {
        const element = document.createElement("div");
        element.style.height = "360px";
        document.body.append(element);
        const source = "```js\nconst answer = 1;\n```\n\noutside\n";
        const editor = await api.createMarkdownEditor({element, initialValue: source, mode, cdn, lutePath,
            onEdit: () => {}});
        const surface = element.querySelector<HTMLElement>(`.vditor-${mode} .vditor-reset`);
        const code = () => surface.querySelector<HTMLElement>('[data-type="code-block"] > pre > code');
        await waitFor(() => !!code()?.querySelector(".hljs-keyword"), `initial editable code highlighting in ${mode}`);
        check.equal(editor.flush().content, source, `highlight spans do not change Markdown in ${mode}`);
        surface.querySelector<HTMLElement>(`.vditor-${mode}__preview`).click();
        editor.focus();
        const walker = document.createTreeWalker(code(), NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let offset = 6;
        while (node && offset > node.textContent.length) {
            offset -= node.textContent.length;
            node = walker.nextNode();
        }
        const range = document.createRange();
        range.setStart(node, offset); range.collapse(true);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        for (const character of "new") {
            await require("electron").ipcRenderer.invoke("markdown-undo-input", character);
        }
        check.equal(editor.flush().content, source.replace("answer", "newanswer"), `native typing within highlighted ${mode} code`);
        for (const name of ["neanswer", "nanswer", "answer"]) {
            editor.undo(); await tick();
            check.equal(editor.flush().content, source.replace("answer", name), `highlighted code undo in ${mode}`);
        }
        await waitFor(() => !!code()?.querySelector(".hljs-keyword"), `highlighting after undo in ${mode}`);
        editor.setMode("sv");
        check.equal(editor.flush().content, source, `source switching preserves highlighted ${mode} code`);
        editor.setMode(mode);
        await waitFor(() => !!code()?.querySelector(".hljs-keyword"), `highlighting after mode switching in ${mode}`);
        surface.querySelector<HTMLElement>(`.vditor-${mode}__preview`).click();
        editor.focus();
        if (mode === "ir") {
            range.selectNodeContents(surface.querySelector('[data-type="code-block-info"]'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
            document.execCommand("insertText", false, "jav");
        } else {
            await waitFor(() => !!element.querySelector<HTMLInputElement>(".vditor-panel .vditor-input"), "language field is available");
            const field = element.querySelector<HTMLInputElement>(".vditor-panel .vditor-input");
            field.focus(); field.value = "jav";
            field.dispatchEvent(new Event("input", {bubbles: true}));
            field.dispatchEvent(new KeyboardEvent("keyup", {key: "v", bubbles: true}));
        }
        const hint = Array.from(element.querySelectorAll<HTMLElement>(".vditor-hint")).find(item => item.style.display === "block");
        check.ok(hint, `language candidates appear in ${mode}`);
        const outside = surface.querySelector("p");
        outside.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        outside.click();
        check.equal(hint.style.display, "none", `outside pointer dismisses language candidates in ${mode}`);
        editor.destroy(); element.remove();
    }
    for (const mode of ["ir", "wysiwyg"] as const) {
        const wrapper = document.createElement("div");
        wrapper.style.height = "360px";
        const element = document.createElement("div");
        wrapper.append(element);
        document.body.append(wrapper);
        const source = "# Heading\n\n## Child\n\n### Leaf\n\n" + "Paragraph\n\n".repeat(35) + "# Last\n";
        const states: Array<import("./editor").MarkdownOutlineState> = [];
        const editor = await api.createMarkdownEditor({element, initialValue: source, mode, cdn, lutePath,
            onEdit: () => {}, onOutlineChange: state => states.push(state)});
        const panel = element.querySelector<HTMLElement>(".vditor-outline");
        const finishOutline = async () => {
            panel.getAnimations().forEach(animation => animation.finish());
            await new Promise(resolve => setTimeout(resolve, 30));
        };
        check.deepEqual(states.at(-1), {enabled: false, visible: false, available: true});
        editor.setOutline(true);
        await finishOutline();
        check.deepEqual(states.at(-1), {enabled: true, visible: true, available: true});
        check.ok(panel.querySelector("ul ul ul"), "outline retains nested heading levels");
        const fold = panel.querySelector<HTMLElement>(".vditor-outline__action");
        fold.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal((fold.parentElement.nextElementSibling as HTMLElement).style.display, "none");
        editor.setOutline(false);
        const reversingClose = panel.getAnimations()[0];
        check.ok(reversingClose, `outline closing animates before reversal in ${mode}`);
        reversingClose.pause(); reversingClose.currentTime = 60;
        await new Promise(resolve => requestAnimationFrame(resolve));
        editor.setOutline(true);
        check.equal(panel.querySelector(".vditor-outline__action"), fold, "rapid reversal reuses native outline nodes");
        check.equal((fold.parentElement.nextElementSibling as HTMLElement).style.display, "none",
            "rapid reversal preserves folded headings");
        await finishOutline();
        check.equal(panel.querySelector(".vditor-outline__action"), fold, "animation completion does not rebuild headings");
        fold.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal((fold.parentElement.nextElementSibling as HTMLElement).style.display, "block");
        const last = Array.from(panel.querySelectorAll<HTMLElement>("[data-target-id]")).find(item => item.textContent === "Last");
        last.click();
        const scrollSurface = element.querySelector<HTMLElement>(`.vditor-${mode} .vditor-reset`);
        check.ok(scrollSurface.clientHeight > 0 && scrollSurface.scrollHeight > scrollSurface.clientHeight,
            "outline navigation fixture has a constrained scrollable editor");
        check.ok(scrollSurface.scrollTop > 0, "outline navigation scrolls to the selected heading");
        check.deepEqual(editor.flush(), {content: source, edited: false, composing: false});
        wrapper.style.width = "460px";
        panel.style.maxWidth = "40%";
        window.dispatchEvent(new Event("resize"));
        check.ok(panel.getBoundingClientRect().width < 200, "responsive outline fixture starts constrained");
        editor.setOutline(false); await finishOutline();
        editor.setOutline(true);
        const growingParent = panel.getAnimations()[0];
        check.ok(growingParent, `outline opening animates before parent resizing in ${mode}`);
        growingParent.pause(); growingParent.currentTime = 60;
        wrapper.style.width = "700px";
        growingParent.currentTime = 199.99;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const beforeGrowingFinish = panel.getBoundingClientRect().width;
        await finishOutline();
        check.ok(Math.abs(panel.getBoundingClientRect().width - beforeGrowingFinish) < 1,
            "a growing editor does not add width when the outline animation ends");
        check.ok(panel.getBoundingClientRect().width > 240);
        wrapper.style.width = "";
        panel.style.maxWidth = "";
        window.dispatchEvent(new Event("resize"));
        editor.setMode("sv");
        check.deepEqual(states.at(-1), {enabled: true, visible: false, available: false});
        editor.setMode(mode);
        check.deepEqual(states.at(-1), {enabled: true, visible: true, available: true});
        const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
        try {
            for (const viewportWidth of [360, 519, 520]) {
                Object.defineProperty(window, "innerWidth", {configurable: true, value: viewportWidth});
                wrapper.style.width = `${viewportWidth}px`;
                window.dispatchEvent(new Event("resize"));
                check.deepEqual(states.at(-1), {enabled: true, visible: true, available: true});
                editor.setOutline(false); await finishOutline();
                editor.setOutline(true); await finishOutline();
                check.ok(panel.checkVisibility(), `${mode} outline can reopen at ${viewportWidth}px`);
                check.equal(panel.inert, false);
                const folded = panel.querySelector<SVGElement>(".vditor-outline__action");
                folded.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                check.equal((folded.parentElement.nextElementSibling as HTMLElement).style.display, "none");
                folded.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                const surface = element.querySelector<HTMLElement>(`.vditor-${mode} .vditor-reset`);
                surface.scrollTop = 0;
                Array.from(panel.querySelectorAll<HTMLElement>("[data-target-id]")).find(item => item.textContent === "Last").click();
                check.ok(surface.scrollTop > 0, `${mode} outline navigates at ${viewportWidth}px`);
                editor.setMode("sv");
                check.deepEqual(states.at(-1), {enabled: true, visible: false, available: false});
                editor.setMode(mode);
                check.deepEqual(states.at(-1), {enabled: true, visible: true, available: true});
                check.ok(panel.checkVisibility(), `${mode} outline returns after switching modes at ${viewportWidth}px`);
                check.deepEqual(editor.flush(), {content: source, edited: false, composing: false});
            }
        } finally {
            Object.defineProperty(window, "innerWidth", width);
            wrapper.style.width = "";
            window.dispatchEvent(new Event("resize"));
        }
        const surface = element.querySelector<HTMLElement>(`.vditor-${mode} .vditor-reset`);
        const heading = surface.querySelector("h1");
        const headingText = heading.lastChild;
        editor.setOutline(false);
        const editingClose = panel.getAnimations()[0];
        check.ok(editingClose, `outline closing animates before heading input in ${mode}`);
        editingClose.pause(); editingClose.currentTime = 60;
        await new Promise(resolve => requestAnimationFrame(resolve));
        surface.focus();
        const range = document.createRange();
        range.selectNodeContents(headingText);
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        surface.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText", data: "Typed heading"}));
        headingText.textContent = "Typed heading";
        range.selectNodeContents(headingText);
        range.collapse(false);
        surface.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Typed heading"}));
        editor.setOutline(true);
        check.ok(panel.textContent.includes("Typed heading"), "reversal after native input refreshes changed headings immediately");
        await new Promise(resolve => setTimeout(resolve, 400));
        check.ok(panel.textContent.includes("Typed heading"), "native heading input refreshes the outline");
        check.ok(editor.flush().content.includes("# Typed heading"));
        check.equal(editor.flush().edited, true);
        surface.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "deleteContentBackward"}));
        surface.querySelector("h1").remove();
        range.selectNodeContents(surface.querySelector("h2"));
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        surface.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "deleteContentBackward"}));
        await new Promise(resolve => setTimeout(resolve, 400));
        check.equal(panel.textContent.includes("Typed heading"), false, "deleted headings disappear after native input");
        editor.setOutline(false);
        editor.setValue("# Renamed\n\n## Updated child\n");
        editor.setOutline(true);
        check.ok(panel.textContent.includes("Renamed"));
        check.ok(panel.textContent.includes("Updated child"));
        check.equal(panel.textContent.includes("Last"), false);
        editor.setValue("No headings\n");
        check.equal(panel.querySelector(".vditor-outline__content").textContent, "");
        editor.setOutline(false);
        check.deepEqual(states.at(-1), {enabled: false, visible: false, available: true});
        const stateCount = states.length;
        editor.destroy();
        window.dispatchEvent(new Event("resize"));
        check.equal(states.length, stateCount, "destroy removes the outline resize listener");
        wrapper.remove();
    }
    await require("electron").ipcRenderer.invoke("markdown-reduced-motion", true);
    try {
        check.equal(matchMedia("(prefers-reduced-motion: reduce)").matches, true);
        for (const mode of ["ir", "wysiwyg"] as const) {
            const element = document.createElement("div");
            element.style.height = "360px";
            document.body.append(element);
            const source = "# Heading\n\n## Child\n";
            const states: Array<import("./editor").MarkdownOutlineState> = [];
            const editor = await api.createMarkdownEditor({element, initialValue: source, mode, cdn, lutePath,
                onEdit: () => { throw new Error("Reduced-motion outline changes must not edit the document"); },
                onOutlineChange: state => states.push(state)});
            const panel = element.querySelector<HTMLElement>(".vditor-outline");
            try {
                check.deepEqual(states.at(-1), {enabled: false, visible: false, available: true});
                for (const enabled of [true, false, true, false]) {
                    editor.setOutline(enabled);
                    check.deepEqual(states.at(-1), {enabled, visible: enabled, available: true});
                    check.equal(panel.getAnimations().length, 0, `reduced-motion outline transitions do not animate in ${mode}`);
                    check.equal(panel.getBoundingClientRect().width > 0, enabled,
                        `reduced-motion outline visibility settles immediately in ${mode}`);
                    if (enabled) check.ok(panel.querySelector("ul ul"), "reduced motion retains nested headings");
                    check.deepEqual(editor.flush(), {content: source, edited: false, composing: false});
                }
            } finally {
                editor.destroy();
                element.remove();
            }
        }
    } finally {
        await require("electron").ipcRenderer.invoke("markdown-reduced-motion", false);
    }
    outlineStyle.remove();
    for (const mobile of [false, true]) {
        const element = document.createElement("div");
        document.body.append(element);
        const content = "Language<Alt+Enter>\n";
        const editor = await api.createMarkdownEditor({element, initialValue: content, mode: "wysiwyg", cdn, lutePath,
            mobile, onEdit: () => { throw new Error("Popover label updates must not edit the document"); }});
        const panel = element.querySelector<HTMLElement>(".vditor-wysiwyg > .vditor-panel");
        const wrapper = document.createElement("span");
        wrapper.setAttribute("aria-label", "语言<Alt+Enter>");
        const input = document.createElement("input");
        input.placeholder = "语言<Alt+Enter>";
        input.value = "text<Alt+Enter>";
        wrapper.append(input);
        panel.append(wrapper);
        const documentLabel = element.querySelector<HTMLElement>(".vditor-wysiwyg pre");
        documentLabel.setAttribute("aria-label", "Document<Alt+Enter>");
        await tick();
        check.equal(input.placeholder, mobile ? "语言" : "语言<Alt+Enter>");
        check.equal(wrapper.getAttribute("aria-label"), mobile ? "语言" : "语言<Alt+Enter>");
        check.equal(input.value, "text<Alt+Enter>");
        check.equal(documentLabel.getAttribute("aria-label"), "Document<Alt+Enter>");
        check.equal(editor.flush().content, content);
        input.placeholder = "ID<⌥Enter>";
        await tick();
        check.equal(input.placeholder, mobile ? "ID" : "ID<⌥Enter>", "dynamic attribute updates are normalized");
        let hotkeyReceived = false;
        input.addEventListener("keydown", event => { hotkeyReceived = event.altKey && event.key === "Enter"; });
        const hotkey = new KeyboardEvent("keydown", {key: "Enter", altKey: true, bubbles: true, cancelable: true});
        input.dispatchEvent(hotkey);
        check.equal(hotkeyReceived, true);
        check.equal(hotkey.defaultPrevented, false, "hint suppression does not disable external keyboards");
        editor.destroy();
        input.placeholder = "Language<Alt+Enter>";
        await tick();
        check.equal(input.placeholder, "Language<Alt+Enter>", "destroy disconnects the observer");
        element.remove();
    }
    const source = '[Text][ref]\n\n[ref]: https://example.com "Title"\n\n![Local](assets/photo.png)\n\n' +
        `![Remote badge](${imagesOrigin}/badge.svg)\n\n![Redirected image](${imagesOrigin}/redirect)\n\n![HTTPS](https://invalid.example/track.png)\n\n` +
        '<iframe src="https://invalid.example/preserved"></iframe>\n\n<script>window.markdownExecuted = true</script>\n\n' +
        '```echarts\n{"title":{"text":"static diagram"}}\n```\n\n:doge: 🐶 👨‍👩‍👧‍👦\n\nEnd\n';
    const imageURL = URL.createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], {type: "image/png"}));
    const links: string[] = [];
    for (const mode of ["ir", "wysiwyg", "sv"] as const) {
        const element = document.createElement("div");
        element.style.height = "600px";
        document.body.append(element);
        const edits: Array<{content: string; edited: boolean; composing: boolean}> = [];
        const pending: boolean[] = [];
        const modes: string[] = [];
        const history: Array<{canUndo: boolean; canRedo: boolean}> = [];
        const editor = await api.createMarkdownEditor({element, initialValue: source, mode, cdn, lutePath, lang: "en-US",
            resolveResource: reference => reference === "assets/photo.png" ? imageURL : undefined,
            onEdit: snapshot => edits.push(snapshot), onEditPending: value => pending.push(value),
            onModeChange: value => modes.push(value), onLink: url => links.push(url), onHistoryChange: state => history.push(state)});
        check.equal(element.querySelector<HTMLElement>(".vditor-toolbar").hidden, true);
        if (mode === "sv") check.ok(element.querySelector(".vditor-preview .vditor-reset").textContent.includes("End"), "initial source preview is ready before revealing the editor");
        check.deepEqual(editor.flush(), {content: source, edited: false, composing: false});
        check.equal(edits.length, 0);
        await tick();
        const localImages = Array.from(element.querySelectorAll("img")).filter(image => image.src === imageURL);
        if (mode !== "sv") check.ok(localImages.length > 0, `relative image in ${mode}`);
        check.ok(element.querySelector('img[src="https://invalid.example/track.png"]'), "HTTPS image addresses are hydrated");
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !Array.from(element.querySelectorAll<HTMLImageElement>(`img[src^="${imagesOrigin}"]`)).every(image => image.complete && image.naturalWidth > 0)) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const remoteImages = Array.from(element.querySelectorAll<HTMLImageElement>(`img[src^="${imagesOrigin}"]`));
        check.ok(remoteImages.length >= 2, `remote image elements exist in ${mode}`);
        check.ok(remoteImages.every(image => image.complete && image.naturalWidth > 0), `HTTP SVG badges and redirected PNG images display in ${mode}`);
        check.equal((window as unknown as {imageScriptExecuted?: boolean}).imageScriptExecuted, undefined, "SVG image scripts do not execute");
        check.deepEqual(editor.flush(), {content: source, edited: false, composing: false}, "loading remote images never edits or rewrites the document");
        editor.focus();
        const surface = mode === "sv" ? element.querySelector<HTMLTextAreaElement>("textarea.vditor-sv") :
            element.querySelector<HTMLElement>(`.vditor-${mode} pre[contenteditable="true"]`);
        check.ok(surface, mode);
        if (mode === "sv") {
            const textarea = surface as HTMLTextAreaElement;
            textarea.value += "\nEdited now\n";
            textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Edited now"}));
        } else {
            const range = document.createRange();
            range.selectNodeContents(surface);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            document.execCommand("insertText", false, "Edited now");
        }
        check.equal(pending.at(-1), true, `input is pending before delayed serialization in ${mode}`);
        const immediate = editor.flush();
        check.equal(immediate.edited, true, `immediate input ${mode}`);
        check.ok(immediate.content.includes("Edited now"));
        check.ok(immediate.content.includes('https://example.com "Title"'), mode);
        check.ok(immediate.content.includes("assets/photo.png"), mode);
        check.ok(immediate.content.includes("https://invalid.example/track.png"), mode);
        check.ok(immediate.content.includes(`${imagesOrigin}/redirect`), "saving preserves the original URL rather than its redirect destination");
        check.ok(immediate.content.includes('<iframe src="https://invalid.example/preserved"></iframe>'), mode);
        check.ok(immediate.content.includes("<script>window.markdownExecuted = true</script>"), mode);
        check.ok(immediate.content.includes("```echarts"), mode);
        check.ok(immediate.content.includes(":doge:"), `existing image emoji shortcode survives edits in ${mode}`);
        check.ok(immediate.content.includes("🐶 👨‍👩‍👧‍👦"), `Unicode emoji survive edits in ${mode}`);
        check.equal((window as unknown as {markdownExecuted?: boolean}).markdownExecuted, undefined);
        check.equal(immediate.content.includes("blob:"), false);
        await new Promise(resolve => setTimeout(resolve, 350));
        check.equal(history.at(-1).canUndo, true, `history becomes available in ${mode}`);
        editor.undo(); await tick();
        check.equal(editor.flush().content.includes("Edited now"), false, `undo in ${mode}`);
        check.equal(history.at(-1).canRedo, true);
        editor.redo(); await tick();
        check.ok(editor.flush().content.includes("Edited now"), `redo in ${mode}`);
        await new Promise(resolve => setTimeout(resolve, 350));
        check.ok(edits.length > 0);
        check.equal(pending.at(-1), false);
        const count = edits.length;
        for (const next of ["sv", "wysiwyg", "ir"] as const) editor.setMode(next);
        await tick();
        check.equal(edits.length, count, `mode changes ${mode}`);
        check.equal(editor.flush().content, immediate.content);
        check.ok(modes.length > 0);

        editor.setMode(mode);
        editor.setValue("Image insertion\n");
        editor.focus();
        check.equal(editor.insertImage("https://invalid.example/image.png"), false);
        check.equal(editor.insertImage("assets/inserted%20image.png"), true);
        check.ok(editor.flush().content.includes("assets/inserted%20image.png"), `image insertion ${mode}`);
        check.equal(editor.flush().edited, true);
        editor.setValue(immediate.content);

        editor.setMode("sv");
        const textarea = element.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
        textarea.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true, data: ""}));
        textarea.value += "composition";
        textarea.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true, inputType: "insertCompositionText"}));
        check.equal(editor.flush().composing, true);
        check.equal(editor.flush().content, immediate.content);
        const composingValue = textarea.value;
        editor.undo(); editor.redo();
        check.equal(textarea.value, composingValue, "history controls cannot interrupt composition");
        textarea.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "composition"}));
        await tick();
        check.equal(editor.flush().composing, false);
        check.ok(editor.flush().content.includes("composition"));
        editor.setValue("Reloaded\n");
        const afterReload = edits.length;
        await new Promise(resolve => setTimeout(resolve, 850));
        check.deepEqual(editor.flush(), {content: "Reloaded\n", edited: false, composing: false});
        check.equal(edits.length, afterReload);
        if (mode !== "sv") {
            editor.setMode(mode);
            const keyboardSource = "- first\n- second\n";
            editor.setValue(keyboardSource);
            await new Promise(resolve => setTimeout(resolve, 350));
            const richSurface = element.querySelector<HTMLElement>(`.vditor-${mode} pre[contenteditable="true"]`);
            const placeCaret = (target: Element) => {
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(true);
                richSurface.focus();
                getSelection().removeAllRanges();
                getSelection().addRange(range);
            };
            editor.setValue("[Example](https://example.com/path?q=1#part)\n\nOutside\n");
            await new Promise(resolve => setTimeout(resolve, 350));
            placeCaret(richSurface.lastElementChild);
            const renderedLink = richSurface.querySelector<HTMLElement>(mode === "ir" ? '[data-type="a"]' : "a");
            check.ok(renderedLink, `rendered link in ${mode}`);
            const linksBefore = links.length;
            renderedLink.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
            check.equal(links.length, linksBefore + 1, `one external open request in ${mode}`);
            check.equal(links.at(-1), "https://example.com/path?q=1#part");
            check.equal(editor.flush().edited, false, `opening a link does not edit ${mode}`);
            editor.setValue(keyboardSource);
            await new Promise(resolve => setTimeout(resolve, 350));
            let nativeInputs = 0;
            const countInput = () => nativeInputs++;
            richSurface.addEventListener("input", countInput);
            placeCaret(richSurface.querySelector("li"));
            const backspace = new KeyboardEvent("keydown", {key: "Backspace", bubbles: true, cancelable: true});
            richSurface.dispatchEvent(backspace);
            check.equal(backspace.defaultPrevented, true, `Vditor handles list Backspace in ${mode}`);
            check.equal(nativeInputs, 0, "a handled key does not produce a native input event");
            const keyboardEdit = editor.flush();
            check.equal(keyboardEdit.edited, true, `keyboard command flush in ${mode}`);
            check.match(keyboardEdit.content, /^first\n+[-*+] second\n$/);
            await new Promise(resolve => setTimeout(resolve, 350));
            check.equal(edits.at(-1).content, keyboardEdit.content, `delayed keyboard snapshot in ${mode}`);
            editor.undo(); await tick();
            check.equal(editor.flush().content, keyboardSource, `keyboard undo in ${mode}`);
            editor.redo(); await tick();
            check.equal(editor.flush().content, keyboardEdit.content, `keyboard redo in ${mode}`);

            editor.setValue(keyboardSource);
            await new Promise(resolve => setTimeout(resolve, 350));
            placeCaret(richSurface.querySelectorAll("li")[1]);
            const indent = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
            richSurface.dispatchEvent(indent);
            check.equal(indent.defaultPrevented, true);
            check.equal(richSurface.querySelectorAll("li li").length, 1);
            const indented = editor.flush();
            check.equal(indented.edited, true);
            check.notEqual(indented.content, keyboardSource);
            editor.setMode("sv");
            check.equal(editor.flush().content, indented.content, "mode switching preserves a command before its callback");

            editor.setMode(mode);
            editor.setValue("- [ ] first\n");
            await new Promise(resolve => setTimeout(resolve, 350));
            placeCaret(richSurface.querySelector("li"));
            richSurface.dispatchEvent(new KeyboardEvent("keydown", {key: "J", code: "KeyJ", ...primaryModifier,
                shiftKey: true, bubbles: true, cancelable: true}));
            check.ok(richSurface.querySelector<HTMLInputElement>("input").checked, `task keyboard command in ${mode}`);
            check.match(editor.flush().content, /\[[xX]\]/);
            editor.setValue(keyboardSource);
            await new Promise(resolve => setTimeout(resolve, 350));
            const emptyParagraph = document.createElement("p");
            emptyParagraph.setAttribute("data-block", "0");
            emptyParagraph.append(document.createElement("br"));
            richSurface.prepend(emptyParagraph);
            const originalList = richSurface.querySelector("ul");
            placeCaret(emptyParagraph);
            const deleteKey = new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true});
            richSurface.dispatchEvent(deleteKey);
            check.equal(deleteKey.defaultPrevented, true, `empty paragraph Delete handled in ${mode}`);
            check.equal(richSurface.firstElementChild, originalList, "the existing list is retained");
            check.equal(originalList.querySelectorAll("li").length, 2, "Delete keeps both list items");
            check.equal(editor.flush().content, keyboardSource);
            richSurface.removeEventListener("input", countInput);

            editor.setMode(mode);
            editor.setValue("");
            editor.focus();
            document.execCommand("insertText", false, ":do");
            await new Promise(resolve => setTimeout(resolve, 350));
            const hint = Array.from(element.querySelectorAll<HTMLElement>(".vditor-hint")).find(candidate => candidate.checkVisibility());
            check.ok(hint && hint.style.display !== "none", `emoji completion is visible in ${mode}`);
            check.ok(hint.textContent.includes("dog"), `Unicode dog remains suggested in ${mode}`);
            check.equal(hint.querySelector("img"), null, `image emoji are not suggested in ${mode}`);
            check.equal(hint.textContent.includes("doge"), false, `nonportable shortcode is not suggested in ${mode}`);
        }
        editor.destroy();
        element.remove();
    }

    const element = document.createElement("div");
    document.body.append(element);
    const hostile = '<iframe src="https://invalid.example/frame"></iframe>\n\n<script>window.markdownExecuted = true</script>\n\n' +
        "```echarts\n(()=>{window.markdownExecuted=true})()\n```\n\n```plantuml\nAlice -> Bob\n```\n";
    const editor = await api.createMarkdownEditor({element, initialValue: hostile, mode: "sv", cdn, lutePath,
        onEdit: () => { throw new Error("programmatic preview became an edit"); }});
    await new Promise(resolve => setTimeout(resolve, 300));
    check.equal(element.querySelector("iframe,script,object,embed"), null);
    check.equal((window as unknown as {markdownExecuted?: boolean}).markdownExecuted, undefined);
    check.equal(element.querySelector(".language-echarts,.language-plantuml"), null);
    check.equal(editor.flush().content, hostile);
    editor.destroy();
    element.remove();

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = query => query === "(pointer: coarse)" ?
        Object.create(originalMatchMedia.call(window, query), {matches: {value: true}}) : originalMatchMedia.call(window, query);
    Object.defineProperty(window, "localStorage", {value: null, configurable: true});
    const touchElement = document.createElement("div");
    document.body.append(touchElement);
    let oversizedPastes = 0;
    const touchEditor = await api.createMarkdownEditor({element: touchElement, initialValue: source, mode: "ir", cdn, lutePath,
        onContentTooLarge: () => oversizedPastes++,
        onEdit: () => { throw new Error("touch mode switching became an edit"); }});
    check.equal(window.localStorage, undefined);
    check.equal(touchElement.querySelector<HTMLElement>(".vditor-toolbar").hidden, true);
    for (const mode of ["sv", "wysiwyg", "ir"] as const) {
        touchEditor.setMode(mode);
        check.equal(touchEditor.flush().content, source, `touch ${mode}`);
    }
    touchEditor.setMode("sv");
    const touchSource = touchElement.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    touchSource.focus();
    touchSource.setSelectionRange(touchSource.value.length, touchSource.value.length);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "x".repeat(8 * 1024 * 1024));
    const paste = new ClipboardEvent("paste", {clipboardData: clipboard, bubbles: true, cancelable: true});
    touchSource.dispatchEvent(paste);
    check.equal(paste.defaultPrevented, true);
    check.equal(oversizedPastes, 1);
    check.equal(touchEditor.flush().content, source);
    touchEditor.destroy();
    touchElement.remove();
    window.matchMedia = originalMatchMedia;

    const recoveryElement = document.createElement("div");
    document.body.append(recoveryElement);
    const oversizedDraft = ("# Large source\n\n| A | B |\n| - | - |\n| a | b |\n\n").repeat(22000);
    let recoveryMode = "";
    let modeOrigin = "";
    const recoveryEditor = await api.createMarkdownEditor({element: recoveryElement, initialValue: oversizedDraft, mode: "ir", cdn, lutePath,
        onEdit: () => {}, onModeChange: (value, origin) => { recoveryMode = value; modeOrigin = origin; }});
    check.equal(recoveryMode, "sv");
    check.equal(modeOrigin, "automatic", "opening large content reports a local fallback");
    check.equal(recoveryEditor.flush().content, oversizedDraft);
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none",
        "large source opens without rendering its table-heavy preview");
    recoveryEditor.setValue("# Reloaded\n" + oversizedDraft);
    check.equal(recoveryEditor.flush().content, "# Reloaded\n" + oversizedDraft);
    recoveryEditor.setValue("# Small preview pending\n");
    recoveryEditor.setValue(oversizedDraft);
    await new Promise(resolve => setTimeout(resolve, 220));
    check.ok(recoveryElement.querySelector(".vditor-preview").textContent.length < 1000,
        "an old small-document preview timer cannot parse the large replacement");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "sv", "oversized recovery must not enter a rich rendering mode");
    const recoverySource = recoveryElement.querySelector<HTMLTextAreaElement>("textarea.vditor-sv");
    recoverySource.value += "\nLarge edit\n";
    recoverySource.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Large edit"}));
    check.ok(recoveryEditor.flush().content.endsWith("Large edit\n"));
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none");
    for (const key of ["7", "8"]) {
        const shortcut = new KeyboardEvent("keydown", {key, code: `Digit${key}`, ctrlKey: true, altKey: true,
            bubbles: true, cancelable: true});
        recoverySource.dispatchEvent(shortcut);
        check.equal(shortcut.defaultPrevented, true, "mode shortcuts must preserve source-only recovery");
        check.equal(recoveryMode, "sv");
    }
    const nativeModeButton = recoveryElement.querySelector<HTMLButtonElement>('button[data-mode="ir"]');
    const modeClick = new MouseEvent("click", {bubbles: true, cancelable: true});
    nativeModeButton.dispatchEvent(modeClick);
    check.equal(modeClick.defaultPrevented, true);
    check.equal(recoveryMode, "sv");
    recoverySource.value = "# Reduced draft\n";
    recoverySource.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "deleteContentBackward"}));
    check.equal(recoveryEditor.flush().content, "# Reduced draft\n");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "ir");
    check.equal(modeOrigin, "user", "an accepted explicit selection can update preferences");
    const bigPaste = new DataTransfer();
    bigPaste.setData("text/plain", oversizedDraft);
    const pasteRich = new ClipboardEvent("paste", {clipboardData: bigPaste, bubbles: true, cancelable: true});
    recoveryElement.querySelector(".vditor-ir pre").dispatchEvent(pasteRich);
    check.equal(pasteRich.defaultPrevented, true, "large rich paste is handled through the source insertion path");
    check.equal(recoveryMode, "sv");
    check.equal(modeOrigin, "automatic", "a large paste cannot overwrite the preferred mode");
    const pasted = recoveryEditor.flush().content;
    check.ok(pasted.includes(oversizedDraft.trimEnd()), JSON.stringify({length: pasted.length, expected: oversizedDraft.length, start: pasted.slice(0, 100), end: pasted.slice(-100)}));
    check.ok(recoveryEditor.flush().content.includes("Reduced draft"));
    check.equal(recoveryElement.querySelector<HTMLElement>(".vditor-preview").style.display, "none");
    recoveryEditor.setMode("ir");
    check.equal(recoveryMode, "sv");
    recoveryEditor.destroy();
    recoveryElement.remove();
    URL.revokeObjectURL(imageURL);
    return "Markdown editor DOM cases passed";
};

test("Vditor 4.0.2-alpha.8 adapter preserves content and isolates programmatic, input, composition and preview events", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-editor-test-"));
    const compile = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "")
        .replace('require("vditor")', "globalThis.Vditor"), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const bundle = compile("identity.ts") + "\n" + compile("limits.ts") + "\n" + compile("resourcePolicy.ts") + "\n" + compile("link.ts") + "\n" + compile("panelAnimation.ts") + "\n" + compile("editor.ts") +
        "\nwindow.MarkdownEditorTest = {createMarkdownEditor, createMarkdownResourcePolicy};";
    const html = path.join(temporary, "index.html");
    writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
        'content="default-src \'none\'; script-src file:; style-src file: \'unsafe-inline\'; img-src blob: http: https:; font-src file:; ' +
        'connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'"></head><body></body></html>', "utf8");
    const script = path.join(temporary, "run.cjs");
    const cdn = pathToFileURL(path.resolve(__dirname, "../../node_modules/vditor")).href;
    const lutePath = pathToFileURL(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js")).href;
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const imageRequests = [];
    const server = require("node:http").createServer((request,response) => {
        imageRequests.push(request.url);
        if (request.url === "/redirect") {response.writeHead(302,{Location:"/photo.png"});response.end();return;}
        if (request.url === "/badge.svg") {
            response.setHeader("Content-Type","image/svg+xml");
            response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="green"/><script>parent.imageScriptExecuted=true</script></svg>');return;
        }
        response.setHeader("Content-Type","image/png");
        response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64"));
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const imagesOrigin = "http://127.0.0.1:"+server.address().port;
    const win = new BrowserWindow({show:false, width:1000, height:720, webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true}});
    ipcMain.handle("markdown-undo-input", (_event, text) => win.webContents.debugger.sendCommand("Input.insertText", {text}));
    ipcMain.handle("markdown-reduced-motion", (_event, reduced) => win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
        {features:[{name:"prefers-reduced-motion",value:reduced ? "reduce" : "no-preference"}]}));
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]}, (details, callback) => {
        if (details.resourceType !== "image") external.push(details.url);
        callback({cancel: !details.url.startsWith(imagesOrigin+"/")});
    });
    try {
        await win.loadFile(${JSON.stringify(html)});
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {enabled: true});
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",
            {features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
        await win.webContents.executeJavaScript(${JSON.stringify("globalThis.Vditor = require(" + JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor")) + "); void 0;")});
        await win.webContents.executeJavaScript(${JSON.stringify(bundle + "\nvoid 0;")});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(cdn)},${JSON.stringify(lutePath)},`)} + JSON.stringify(imagesOrigin) + ")"));
        if (external.length) throw new Error("Unexpected external requests: " + external.join(","));
        if (!imageRequests.includes("/badge.svg") || !imageRequests.includes("/photo.png")) throw new Error("Remote image endpoints were not reached");
        win.destroy(); server.close(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); server.close(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown editor DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-markdown-editor-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
