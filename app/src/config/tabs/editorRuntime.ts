import {Constants} from "../../constants";
import {getAllEditor, getAllModels} from "../../layout/getAll";
import {refreshHeadingNumberMeasurements, setInlineStyle} from "../../util/assets";
import {reloadProtyle} from "../../protyle/util/reload";
import {resize} from "../../protyle/util/resize";
import {createConfigNamespaceApi} from "../util/namespaceApi";
import {createSectionRuntime} from "../util/sectionRuntime";
import {shouldResetBottomBacklinkPanel} from "./editorRuntimeState";
import {objEquals} from "../../util/functions";
import {lineNumberRender} from "../../protyle/render/highlightRender";
import {updatePageScrollButtons} from "../../protyle/scroll/pageButtons";
/// #if MOBILE
import {setTitleAutoDirection} from "../../protyle/render/autoDirection";
import {updateMobileBottomBacklinkPanel} from "../../mobile/util/bottomBacklink";
/// #endif

const runtime = createSectionRuntime<Config.IEditor>({
    namespace: "editor",
    get: () => window.siyuan.config.editor,
    set: data => { window.siyuan.config.editor = data; },
    reactions: [{
        name: "page-scroll-buttons",
        changed: (old, next) => old.pageScrollButtons !== next.pageScrollButtons,
        apply: updatePageScrollButtons,
    }, {
        name: "backlink-panel",
        changed: () => true,
        apply: (old, next) => {
            /// #if MOBILE
            return updateMobileBottomBacklinkPanel(undefined, shouldResetBottomBacklinkPanel(old, next));
            /// #else
            getAllModels().editor.forEach(item => item.updateBacklinkPanel(shouldResetBottomBacklinkPanel(old, next)));
            /// #endif
        },
    }, {
        name: "database-row-layout",
        changed: (old, next) => old.fullWidth !== next.fullWidth,
        apply: () => {
            getAllModels().custom.forEach(item => {
                if (item.type === "siyuan-database-row") item.resize?.();
            });
        },
    }, {
        name: "editor-layout",
        changed: () => true,
        apply: (old, next) => {
            /// #if MOBILE
            setTitleAutoDirection(document.getElementById("toolbarName"), next.autoDirection);
            /// #endif
            getAllEditor().forEach(({protyle}) => {
                if (old.blockGutterMode !== next.blockGutterMode) protyle.gutter?.element.classList.add("fn__none");
                if (old.keepLoadedContent !== next.keepLoadedContent) protyle.scroll.keepLoadedContent = next.keepLoadedContent;
                protyle.databaseAttributePanel?.updateDisplayConfig();
                reloadProtyle(protyle, false);
                const fullWidth = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_FULLWIDTH) || String(next.fullWidth);
                if (fullWidth === "true" && protyle.contentElement.getAttribute("data-fullwidth") === "true") return;
                resize(protyle);
                for (const element of [protyle.contentElement, protyle.preview.element]) {
                    if (fullWidth === "true") element.setAttribute("data-fullwidth", "true");
                    else element.removeAttribute("data-fullwidth");
                }
            });
        },
    }, {
        name: "heading-numbers",
        changed: (old, next) => old.headingNumber !== next.headingNumber || old.headingNumberFormat !== next.headingNumberFormat,
        apply: () => {
            /// #if MOBILE
            window.siyuan.mobile.docks.outline?.reload();
            /// #else
            getAllModels().outline.forEach(item => item.refresh());
            /// #endif
        },
    }, {
        name: "editor-styles",
        changed: () => true,
        apply: async (old, next) => {
            await setInlineStyle();
            if (old.fontSize !== next.fontSize || !objEquals(old.fontFamilies, next.fontFamilies)) refreshHeadingNumberMeasurements();
            if (!objEquals(old.codeFontFamilies, next.codeFontFamilies)) {
                getAllEditor().forEach(({protyle}) => {
                    protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber__rows")
                        .forEach((rowsElement: HTMLElement) => lineNumberRender(rowsElement.parentElement));
                });
            }
        },
    }],
});

export const editorConfigApi = createConfigNamespaceApi<Config.IEditor>({
    namespace: "editor",
    getConfig: () => window.siyuan.config.editor,
    setConfig: runtime.apply,

});
