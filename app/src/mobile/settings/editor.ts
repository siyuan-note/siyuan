import {openModel} from "../menu/model";
import {fetchPost} from "../../util/fetch";
import {reloadProtyle} from "../../protyle/util/reload";
import {setInlineStyle} from "../../util/assets";
import {confirmDialog} from "../../dialog/confirmDialog";

const setEditor = (modelMainElement: Element) => {
    let dynamicLoadBlocks = parseInt((modelMainElement.querySelector("#dynamicLoadBlocks") as HTMLInputElement).value);
    if (48 > dynamicLoadBlocks) {
        dynamicLoadBlocks = 48;
        (modelMainElement.querySelector("#dynamicLoadBlocks") as HTMLInputElement).value = "48";
    }
    if (1024 < dynamicLoadBlocks) {
        dynamicLoadBlocks = 1024;
        (modelMainElement.querySelector("#dynamicLoadBlocks") as HTMLInputElement).value = "1024";
    }
    window.siyuan.config.editor.dynamicLoadBlocks = dynamicLoadBlocks;
    window.siyuan.config.editor.justify = (modelMainElement.querySelector("#justify") as HTMLInputElement).checked;
    window.siyuan.config.editor.rtl = (modelMainElement.querySelector("#rtl") as HTMLInputElement).checked;
    window.siyuan.config.editor.displayBookmarkIcon = (modelMainElement.querySelector("#displayBookmarkIcon") as HTMLInputElement).checked;
    window.siyuan.config.editor.displayNetImgMark = (modelMainElement.querySelector("#displayNetImgMark") as HTMLInputElement).checked;
    window.siyuan.config.editor.codeSyntaxHighlightLineNum = (modelMainElement.querySelector("#codeSyntaxHighlightLineNum") as HTMLInputElement).checked;
    window.siyuan.config.editor.embedBlockBreadcrumb = (modelMainElement.querySelector("#embedBlockBreadcrumb") as HTMLInputElement).checked;
    window.siyuan.config.editor.listLogicalOutdent = (modelMainElement.querySelector("#listLogicalOutdent") as HTMLInputElement).checked;
    window.siyuan.config.editor.spellcheck = (modelMainElement.querySelector("#spellcheck") as HTMLInputElement).checked;
    window.siyuan.config.editor.onlySearchForDoc = (modelMainElement.querySelector("#onlySearchForDoc") as HTMLInputElement).checked;
    window.siyuan.config.editor.plantUMLServePath = (modelMainElement.querySelector("#plantUMLServePath") as HTMLInputElement).value;
    window.siyuan.config.editor.katexMacros = (modelMainElement.querySelector("#katexMacros") as HTMLTextAreaElement).value;
    window.siyuan.config.editor.codeLineWrap = (modelMainElement.querySelector("#codeLineWrap") as HTMLInputElement).checked;
    window.siyuan.config.editor.virtualBlockRef = (modelMainElement.querySelector("#virtualBlockRef") as HTMLInputElement).checked;
    window.siyuan.config.editor.virtualBlockRefInclude = (modelMainElement.querySelector("#virtualBlockRefInclude") as HTMLInputElement).value;
    window.siyuan.config.editor.virtualBlockRefExclude = (modelMainElement.querySelector("#virtualBlockRefExclude") as HTMLInputElement).value;
    window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen = parseInt((modelMainElement.querySelector("#blockRefDynamicAnchorTextMaxLen") as HTMLInputElement).value);
    window.siyuan.config.editor.backlinkExpandCount = parseInt((modelMainElement.querySelector("#backlinkExpandCount") as HTMLInputElement).value);
    window.siyuan.config.editor.backmentionExpandCount = parseInt((modelMainElement.querySelector("#backmentionExpandCount") as HTMLInputElement).value);
    window.siyuan.config.editor.codeLigatures = (modelMainElement.querySelector("#codeLigatures") as HTMLInputElement).checked;
    window.siyuan.config.editor.codeTabSpaces = parseInt((modelMainElement.querySelector("#codeTabSpaces") as HTMLInputElement).value);
    window.siyuan.config.editor.fontSize = parseInt((modelMainElement.querySelector("#fontSize") as HTMLInputElement).value);
    window.siyuan.config.editor.generateHistoryInterval = parseInt((modelMainElement.querySelector("#generateHistoryInterval") as HTMLInputElement).value);
    window.siyuan.config.editor.historyRetentionDays = parseInt((modelMainElement.querySelector("#historyRetentionDays") as HTMLInputElement).value);
    fetchPost("/api/setting/setEditor", window.siyuan.config.editor, response => {
        window.siyuan.config.editor = response.data;
        reloadProtyle(window.siyuan.mobile.editor.protyle, false);
        setInlineStyle();
    });
};

export const initEditor = () => {
    openModel({
        title: window.siyuan.languages.editor,
        icon: "iconEdit",
        html: `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.justify}
        <div class="b3-label__text">${window.siyuan.languages.justifyTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="justify" type="checkbox"${window.siyuan.config.editor.justify ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.rtl}
        <div class="b3-label__text">${window.siyuan.languages.rtlTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="rtl" type="checkbox"${window.siyuan.config.editor.rtl ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md12}
        <div class="b3-label__text">${window.siyuan.languages.md16}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="displayBookmarkIcon" type="checkbox"${window.siyuan.config.editor.displayBookmarkIcon ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md7}
        <div class="b3-label__text">${window.siyuan.languages.md8}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="displayNetImgMark" type="checkbox"${window.siyuan.config.editor.displayNetImgMark ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.embedBlockBreadcrumb}
        <div class="b3-label__text">${window.siyuan.languages.embedBlockBreadcrumbTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="embedBlockBreadcrumb" type="checkbox"${window.siyuan.config.editor.embedBlockBreadcrumb ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.outlineOutdent}
        <div class="b3-label__text">${window.siyuan.languages.outlineOutdentTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="listLogicalOutdent" type="checkbox"${window.siyuan.config.editor.listLogicalOutdent ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.spellcheck}
        <div class="b3-label__text">${window.siyuan.languages.spellcheckTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="spellcheck" type="checkbox"${window.siyuan.config.editor.spellcheck ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.onlySearchForDoc}
        <div class="b3-label__text">${window.siyuan.languages.onlySearchForDocTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="onlySearchForDoc" type="checkbox"${window.siyuan.config.editor.spellcheck ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md31}
        <div class="b3-label__text">${window.siyuan.languages.md32}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="codeLineWrap" type="checkbox"${window.siyuan.config.editor.codeLineWrap ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md2}
        <div class="b3-label__text">${window.siyuan.languages.md3}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="codeLigatures" type="checkbox"${window.siyuan.config.editor.codeLigatures ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md27}
        <div class="b3-label__text">${window.siyuan.languages.md28}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="codeSyntaxHighlightLineNum" type="checkbox"${window.siyuan.config.editor.codeSyntaxHighlightLineNum ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.md33}
        <div class="b3-label__text">${window.siyuan.languages.md34}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="virtualBlockRef" type="checkbox"${window.siyuan.config.editor.virtualBlockRef ? " checked" : ""}/>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.md9}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="virtualBlockRefInclude" value="${window.siyuan.config.editor.virtualBlockRefInclude}" />
    <div class="b3-label__text">${window.siyuan.languages.md36}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.md35}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="virtualBlockRefExclude" value="${window.siyuan.config.editor.virtualBlockRefExclude}" />
    <div class="b3-label__text">${window.siyuan.languages.md36}</div>
    <div class="b3-label__text">${window.siyuan.languages.md41}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.md39}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="plantUMLServePath" value="${window.siyuan.config.editor.plantUMLServePath}"/>
    <div class="b3-label__text">${window.siyuan.languages.md40}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.dynamicLoadBlocks}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="dynamicLoadBlocks" type="number" min="48" max="1024" value="${window.siyuan.config.editor.dynamicLoadBlocks}"/>
    <div class="b3-label__text">${window.siyuan.languages.dynamicLoadBlocksTip}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.md37}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="blockRefDynamicAnchorTextMaxLen" type="number" min="1" max="5120" value="${window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen}"/>
    <div class="b3-label__text">${window.siyuan.languages.md38}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.backlinkExpand}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="backlinkExpandCount" type="number" min="0" max="512" value="${window.siyuan.config.editor.backlinkExpandCount}"/>
    <div class="b3-label__text">${window.siyuan.languages.backlinkExpandTip}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.backmentionExpand}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="backmentionExpandCount" type="number" min="0" max="512" value="${window.siyuan.config.editor.backmentionExpandCount}"/>
    <div class="b3-label__text">${window.siyuan.languages.backmentionExpandTip}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.generateHistory}
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="generateHistoryInterval" type="number" min="0" max="120" value="${window.siyuan.config.editor.generateHistoryInterval}"/>
    <div class="b3-label__text">${window.siyuan.languages.generateHistoryInterval}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.historyRetentionDays} 
    <a href="javascript:void(0)" id="clearHistory">${window.siyuan.languages.clearHistory}</a>
    <span class="fn__hr"></span>
    <input class="b3-text-field fn__block" id="historyRetentionDays" type="number" min="0" value="${window.siyuan.config.editor.historyRetentionDays}"/>
    <div class="b3-label__text">${window.siyuan.languages.historyRetentionDaysTip}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.fontSize} 
    <span class="ft__on-surface">${window.siyuan.config.editor.fontSize}</span>
    <div class="fn__hr"></div>
    <input id="fontSize" class="b3-slider fn__block" max="72" min="9" step="1" type="range" value="${window.siyuan.config.editor.fontSize}">
    <div class="b3-label__text">${window.siyuan.languages.fontSizeTip}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.md29} 
    <span class="ft__on-surface">${window.siyuan.config.editor.codeTabSpaces}</span>
    <div class="fn__hr"></div>
    <input class="b3-slider fn__block" id="codeTabSpaces" max="8" min="0" step="2" type="range" value="${window.siyuan.config.editor.codeTabSpaces}">
    <div class="b3-label__text">${window.siyuan.languages.md30}</div>
</label>
<label class="b3-label fn__displayblock">
    ${window.siyuan.languages.katexMacros}
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" id="katexMacros">${window.siyuan.config.editor.katexMacros}</textarea>
    <div class="b3-label__text">${window.siyuan.languages.katexMacrosTip}</div>
</label>`,
        bindEvent(modelMainElement: HTMLElement) {
            modelMainElement.querySelector("#clearHistory").addEventListener("click", () => {
                confirmDialog(window.siyuan.languages.clearHistory, window.siyuan.languages.confirmClearHistory, () => {
                    fetchPost("/api/history/clearWorkspaceHistory", {});
                });
            });

            modelMainElement.querySelectorAll("input.b3-switch, select.b3-select, input.b3-slider").forEach((item) => {
                item.addEventListener("change", () => {
                    setEditor(modelMainElement);
                });
            });
            modelMainElement.querySelectorAll("textarea.b3-text-field, input.b3-text-field, input.b3-slider").forEach((item) => {
                item.addEventListener("blur", () => {
                    setEditor(modelMainElement);
                });
            });
            modelMainElement.querySelectorAll("input.b3-slider").forEach((item) => {
                item.addEventListener("input", (event) => {
                    const target = event.target as HTMLInputElement;
                    target.previousElementSibling.previousElementSibling.textContent = target.value;
                });
            });
        }
    });
};
