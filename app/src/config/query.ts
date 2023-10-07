import {fetchPost} from "../util/fetch";

export const query = {
    element: undefined as Element,
    genHTML: () => {
        return `<div class="b3-label">
 ${window.siyuan.languages.searchBlockType}
    <div class="fn__flex config-query">
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconMath"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.math}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="mathBlock" type="checkbox"${window.siyuan.config.search.mathBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconTable"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.table}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="table" type="checkbox"${window.siyuan.config.search.table ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconQuote"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.quote}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="blockquote" type="checkbox"${window.siyuan.config.search.blockquote ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconSuper"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.superBlock}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="superBlock" type="checkbox"${window.siyuan.config.search.superBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconParagraph"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.paragraph}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="paragraph" type="checkbox"${window.siyuan.config.search.paragraph ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconFile"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.doc}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="document" type="checkbox"${window.siyuan.config.search.document ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconHeadings"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.headings}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="heading" type="checkbox"${window.siyuan.config.search.heading ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconList"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.list1}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="list" type="checkbox"${window.siyuan.config.search.list ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconListItem"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.listItem}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="listItem" type="checkbox"${window.siyuan.config.search.listItem ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconCode"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.code}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="codeBlock" type="checkbox"${window.siyuan.config.search.codeBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconHTML5"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                HTML
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="htmlBlock" type="checkbox"${window.siyuan.config.search.htmlBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconSQL"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.embedBlock}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="embedBlock" type="checkbox"${window.siyuan.config.search.embedBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconDatabase"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.database}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="databaseBlock" type="checkbox"${window.siyuan.config.search.databaseBlock ? " checked" : ""}/>
        </label>        
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchBlockAttr}
    <div class="config-query">
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconN"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="name" type="checkbox"${window.siyuan.config.search.name ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconA"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="alias" type="checkbox"${window.siyuan.config.search.alias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <svg class="svg"><use xlink:href="#iconM"></use></svg>
            <span class="fn__space"></span>
            <div class="fn__flex-1">
                ${window.siyuan.languages.memo}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="memo" type="checkbox"${window.siyuan.config.search.memo ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.allAttrs}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="ial" type="checkbox"${window.siyuan.config.search.ial ? " checked" : ""}/>
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchBackmention}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="backlinkMentionName" type="checkbox"${window.siyuan.config.search.backlinkMentionName ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="backlinkMentionAlias" type="checkbox"${window.siyuan.config.search.backlinkMentionAlias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.anchor}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="backlinkMentionAnchor" type="checkbox"${window.siyuan.config.search.backlinkMentionAnchor ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.docName}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="backlinkMentionDoc" type="checkbox"${window.siyuan.config.search.backlinkMentionDoc ? " checked" : ""}/>
        </label>
        <label class="fn__flex" style="flex: 2">
            <div class=>
                ${window.siyuan.languages.keywordsLimit}
            </div>
            <span class="fn__space"></span>
            <input class="b3-text-field" id="backlinkMentionKeywordsLimit" type="number" min="1" max="10240" value="${window.siyuan.config.search.backlinkMentionKeywordsLimit}">
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchVirtualRef}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="virtualRefName" type="checkbox"${window.siyuan.config.search.virtualRefName ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="virtualRefAlias" type="checkbox"${window.siyuan.config.search.virtualRefAlias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.anchor}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="virtualRefAnchor" type="checkbox"${window.siyuan.config.search.virtualRefAnchor ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.docName}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="virtualRefDoc" type="checkbox"${window.siyuan.config.search.virtualRefDoc ? " checked" : ""}/>
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchIndex}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1">
                ${window.siyuan.languages.indexAssetPath}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch" id="indexAssetPath" type="checkbox"${window.siyuan.config.search.indexAssetPath ? " checked" : ""}/>
        </label>
    </div>
</div>
<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.searchLimit}
         <div class="b3-label__text">${window.siyuan.languages.searchLimit1}</div>
         <div class="b3-label__text">${window.siyuan.languages.searchLimit2}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="limit" type="number" min="32" max="10240" value="${window.siyuan.config.search.limit}">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.searchCaseSensitive}
         <div class="b3-label__text">${window.siyuan.languages.searchCaseSensitive1}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="caseSensitive" type="checkbox"${window.siyuan.config.search.caseSensitive ? " checked" : ""}/>
</label>`;
    },
    bindEvent: () => {
        query.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setSearch", {
                    document: (query.element.querySelector("#document") as HTMLInputElement).checked,
                    heading: (query.element.querySelector("#heading") as HTMLInputElement).checked,
                    list: (query.element.querySelector("#list") as HTMLInputElement).checked,
                    listItem: (query.element.querySelector("#listItem") as HTMLInputElement).checked,
                    codeBlock: (query.element.querySelector("#codeBlock") as HTMLInputElement).checked,
                    htmlBlock: (query.element.querySelector("#htmlBlock") as HTMLInputElement).checked,
                    embedBlock: (query.element.querySelector("#embedBlock") as HTMLInputElement).checked,
                    databaseBlock: (query.element.querySelector("#databaseBlock") as HTMLInputElement).checked,
                    mathBlock: (query.element.querySelector("#mathBlock") as HTMLInputElement).checked,
                    table: (query.element.querySelector("#table") as HTMLInputElement).checked,
                    blockquote: (query.element.querySelector("#blockquote") as HTMLInputElement).checked,
                    superBlock: (query.element.querySelector("#superBlock") as HTMLInputElement).checked,
                    paragraph: (query.element.querySelector("#paragraph") as HTMLInputElement).checked,
                    name: (query.element.querySelector("#name") as HTMLInputElement).checked,
                    alias: (query.element.querySelector("#alias") as HTMLInputElement).checked,
                    memo: (query.element.querySelector("#memo") as HTMLInputElement).checked,
                    ial: (query.element.querySelector("#ial") as HTMLInputElement).checked,
                    indexAssetPath: (query.element.querySelector("#indexAssetPath") as HTMLInputElement).checked,
                    limit: parseInt((query.element.querySelector("#limit") as HTMLInputElement).value),
                    caseSensitive: (query.element.querySelector("#caseSensitive") as HTMLInputElement).checked,
                    backlinkMentionName: (query.element.querySelector("#backlinkMentionName") as HTMLInputElement).checked,
                    backlinkMentionAlias: (query.element.querySelector("#backlinkMentionAlias") as HTMLInputElement).checked,
                    backlinkMentionAnchor: (query.element.querySelector("#backlinkMentionAnchor") as HTMLInputElement).checked,
                    backlinkMentionDoc: (query.element.querySelector("#backlinkMentionDoc") as HTMLInputElement).checked,
                    backlinkMentionKeywordsLimit: parseInt((query.element.querySelector("#backlinkMentionKeywordsLimit") as HTMLInputElement).value),
                    virtualRefName: (query.element.querySelector("#virtualRefName") as HTMLInputElement).checked,
                    virtualRefAlias: (query.element.querySelector("#virtualRefAlias") as HTMLInputElement).checked,
                    virtualRefAnchor: (query.element.querySelector("#virtualRefAnchor") as HTMLInputElement).checked,
                    virtualRefDoc: (query.element.querySelector("#virtualRefDoc") as HTMLInputElement).checked,
                }, response => {
                    window.siyuan.config.search = response.data;
                });
            });
        });
    },
};
