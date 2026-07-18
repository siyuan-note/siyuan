import {Constants} from "../../constants";
import {isBrowser, isMobile} from "../../util/functions";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {editorConfigApi} from "./editorRuntime";
import type {SettingTabBuilder} from "../setting/builder";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

/** 编辑器 Tab：各组注册实现（由 setting/tabs.ts 调用） */
const registerEditorBehaviorGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("behavior", window.siyuan.languages.configGroupBehavior);
    const readOnlyKeymap = window.siyuan.config.keymap.general.editReadonly.custom;
    group.switch("editor.readOnly", {
        title: isMobile()
            ? window.siyuan.languages.editReadonly
            : `${window.siyuan.languages.editReadonly} <code class="fn__code${readOnlyKeymap ? "" : " fn__none"}">${updateHotkeyTip(readOnlyKeymap)}</code>`,
        desc: window.siyuan.languages.editReadonlyTip,
    });
    group.switch("editor.spellcheck", {
        title: window.siyuan.languages.spellcheck,
        desc: isBrowser() ? window.siyuan.languages.spellcheckTip : window.siyuan.languages.spellcheckTip2,
        /// #if !BROWSER
        afterMount: bindSpellcheckLanguagesVisibility,
        /// #endif
    });
    /// #if !BROWSER
    group.slot({
        key: "spellcheckLanguages",
        keywords: [
            window.siyuan.languages.spellcheck,
            window.siyuan.languages.spellcheckTip2,
        ],
        html: () => '<div class="fn__flex b3-label config-item fn__none"><div class="b3-chips" id="editor.spellcheckLanguages"></div></div>',
        afterMount: bindSpellcheckLanguagesChips,
    });
    /// #endif
    group.range("editor.codeTabSpaces", {
        title: window.siyuan.languages.md29,
        desc: window.siyuan.languages.md30,
        min: 0,
        max: 8,
        step: 2,
    });
    group.switch("editor.listLogicalOutdent", {
        title: window.siyuan.languages.outlineOutdent,
        desc: window.siyuan.languages.outlineOutdentTip,
    });
    group.switch("editor.listItemDotNumberClickFocus", {
        title: window.siyuan.languages.listItemDotNumberClickFocus,
        desc: window.siyuan.languages.listItemDotNumberClickFocusTip,
    });
    group.switch("editor.pasteURLAutoConvert", {
        title: window.siyuan.languages.pasteURLAutoConvert,
        desc: window.siyuan.languages.pasteURLAutoConvertTip,
    });
    group.number("editor.dynamicLoadBlocks", {
        title: window.siyuan.languages.dynamicLoadBlocks,
        desc: window.siyuan.languages.dynamicLoadBlocksTip,
        min: 48,
    });
};

/// #if !BROWSER
const bindSpellcheckLanguagesVisibility = async (root: HTMLElement) => {
    const spellcheckSwitch = root.querySelector<HTMLInputElement>(`#${CSS.escape("editor.spellcheck")}`);
    if (!spellcheckSwitch) {
        return;
    }
    const toggleWrap = () => {
        root.querySelector(`#${CSS.escape("editor.spellcheckLanguages")}`)?.closest(".config-item")?.classList.toggle("fn__none", !spellcheckSwitch.checked);
    };
    spellcheckSwitch.addEventListener("change", toggleWrap);
    toggleWrap();
};

const bindSpellcheckLanguagesChips = async (root: HTMLElement) => {
    const el = root.querySelector<HTMLDivElement>(`#${CSS.escape("editor.spellcheckLanguages")}`);
    if (!el) {
        return;
    }
    const languages: string[] = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
        cmd: "availableSpellCheckerLanguages",
    });
    el.innerHTML = languages.map((item) =>
        `<div class="fn__pointer b3-chip b3-chip--middle${window.siyuan.config.editor.spellcheckLanguages.includes(item) ? " b3-chip--current" : ""}">${item}</div>`
    ).join("");
    el.addEventListener("click", (event) => {
        const target = event.target as Element;
        if (target.classList.contains("b3-chip")) {
            target.classList.toggle("b3-chip--current");
            const selected = Array.from(el.querySelectorAll(".b3-chip--current")).map((chip) => chip.textContent || "");
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "setSpellCheckerLanguages",
                languages: selected,
            });
            editorConfigApi.patch("spellcheckLanguages", selected);
        }
    });
};
/// #endif

const registerEditorBlockFeaturesGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("blockFeatures", window.siyuan.languages.configGroupBlockFeatures);
    group.switch("editor.displayNetImgMark", {
        title: window.siyuan.languages.md7,
        desc: window.siyuan.languages.md8,
    });
    group.switch("editor.displayBookmarkIcon", {
        title: window.siyuan.languages.md12,
        desc: window.siyuan.languages.md16,
    });
    group.switch("editor.embedBlockBreadcrumb", {
        title: window.siyuan.languages.embedBlockBreadcrumb,
        desc: window.siyuan.languages.embedBlockBreadcrumbTip,
    });
    group.select("editor.databaseAttrViewMode", {
        title: window.siyuan.languages.databaseAttrViewMode,
        desc: window.siyuan.languages.databaseAttrViewModeTip,
        options: [
            {value: 0, label: window.siyuan.languages.expand},
            {value: 1, label: window.siyuan.languages.collapse},
        ],
    });
    group.select("editor.headingEmbedMode", {
        title: window.siyuan.languages.headingEmbedMode,
        desc: window.siyuan.languages.headingEmbedModeTip,
        options: [
            {value: 0, label: window.siyuan.languages.showHeadingWithBlocks},
            {value: 1, label: window.siyuan.languages.showHeadingOnlyTitle},
            {value: 2, label: window.siyuan.languages.showHeadingOnlyBlocks},
        ],
    });
    group.switch("editor.codeLineWrap", {
        title: window.siyuan.languages.md31,
        desc: window.siyuan.languages.md32,
    });
    group.switch("editor.codeLigatures", {
        title: window.siyuan.languages.md2,
        desc: window.siyuan.languages.md3,
    });
    group.switch("editor.codeSyntaxHighlightLineNum", {
        title: window.siyuan.languages.md27,
        desc: window.siyuan.languages.md28,
    });
};

const registerEditorBidirectionalGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("bidirectional", window.siyuan.languages.configGroupBidirectionalLinks);
    group.switch("editor.onlySearchForDoc", {
        title: window.siyuan.languages.onlySearchForDoc,
        desc: window.siyuan.languages.onlySearchForDocTip,
    });
    group.number("editor.blockRefDynamicAnchorTextMaxLen", {
        title: window.siyuan.languages.md37,
        desc: window.siyuan.languages.md38,
        min: 1,
        max: 5120,
    });
    group.switch("editor.virtualBlockRef", {
        title: window.siyuan.languages.md33,
        desc: window.siyuan.languages.md34,
    });
    group.textBlock("editor.virtualBlockRefInclude", {
        title: window.siyuan.languages.md9,
        desc: window.siyuan.languages.md36,
        mode: "textarea",
    });
    group.textBlock("editor.virtualBlockRefExclude", {
        title: window.siyuan.languages.md35,
        desc: window.siyuan.languages.md41,
        mode: "textarea",
    });
    group.switch("editor.backlinkContainChildren", {
        title: window.siyuan.languages.backlinkContainChildren,
        desc: window.siyuan.languages.backlinkContainChildrenTip,
    });
    group.number("editor.backlinkExpandCount", {
        title: window.siyuan.languages.backlinkExpand,
        desc: window.siyuan.languages.backlinkExpandTip,
        min: 0,
        max: 512,
    });
    group.number("editor.backmentionExpandCount", {
        title: window.siyuan.languages.backmentionExpand,
        desc: window.siyuan.languages.backmentionExpandTip,
        min: -1,
        max: 512,
    });
};

const registerEditorMarkdownInlineGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("markdownInline", window.siyuan.languages.configGroupMarkdownInlineSyntax);
    group.switch("editor.markdown.inlineAsterisk", {
        title: window.siyuan.languages.editorMarkdownInlineAsterisk,
        desc: window.siyuan.languages.editorMarkdownInlineAsteriskTip,
    });
    group.switch("editor.markdown.inlineUnderscore", {
        title: window.siyuan.languages.editorMarkdownInlineUnderscore,
        desc: window.siyuan.languages.editorMarkdownInlineUnderscoreTip,
    });
    group.switch("editor.markdown.inlineSup", {
        title: window.siyuan.languages.editorMarkdownInlineSup,
        desc: window.siyuan.languages.editorMarkdownInlineSupTip,
    });
    group.switch("editor.markdown.inlineSub", {
        title: window.siyuan.languages.editorMarkdownInlineSub,
        desc: window.siyuan.languages.editorMarkdownInlineSubTip,
    });
    group.switch("editor.markdown.inlineTag", {
        title: window.siyuan.languages.editorMarkdownInlineTag,
        desc: window.siyuan.languages.editorMarkdownInlineTagTip,
    });
    group.switch("editor.markdown.inlineMath", {
        title: window.siyuan.languages.editorMarkdownInlineMath,
        desc: window.siyuan.languages.editorMarkdownInlineMathTip,
    });
    group.switch("editor.markdown.inlineStrikethrough", {
        title: window.siyuan.languages.editorMarkdownInlineStrikethrough,
        desc: window.siyuan.languages.editorMarkdownInlineStrikethroughTip,
    });
    group.switch("editor.markdown.inlineMark", {
        title: window.siyuan.languages.editorMarkdownInlineMark,
        desc: window.siyuan.languages.editorMarkdownInlineMarkTip,
    });
};

const registerEditorAdvancedGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("advanced", window.siyuan.languages.configGroupAdvanced);
    group.text("editor.plantUMLServePath", {
        title: window.siyuan.languages.md39,
        desc: window.siyuan.languages.md40,
    });
    group.textBlock("editor.katexMacros", {
        title: window.siyuan.languages.katexMacros,
        desc: window.siyuan.languages.katexMacrosTip,
        mode: "textarea",
    });
    group.switch("editor.allowSVGScript", {
        title: window.siyuan.languages.allowSVGScript,
        desc: window.siyuan.languages.allowSVGScriptTip,
    });
    group.switch("editor.allowHTMLBLockScript", {
        title: window.siyuan.languages.allowHTMLBLockScript,
        desc: window.siyuan.languages.allowHTMLBLockScriptTip,
    });
};

export const registerEditorTab = (tab: SettingTabBuilder) => {
    registerEditorBehaviorGroup(tab);
    registerEditorBlockFeaturesGroup(tab);
    registerEditorBidirectionalGroup(tab);
    registerEditorMarkdownInlineGroup(tab);
    registerEditorAdvancedGroup(tab);
};
