import {fetchPost} from "../util/fetch";

export const query = {
    element: undefined as Element,
    genHTML: () => {
        return `<div class="b3-label">
 ${window.siyuan.languages.searchType}
    <div class="fn__flex config-query">
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.math}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="mathBlock" type="checkbox"${window.siyuan.config.search.mathBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.table}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="table" type="checkbox"${window.siyuan.config.search.table ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.quote}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="blockquote" type="checkbox"${window.siyuan.config.search.blockquote ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.superBlock}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="superBlock" type="checkbox"${window.siyuan.config.search.superBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.paragraph}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="paragraph" type="checkbox"${window.siyuan.config.search.paragraph ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.doc}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="document" type="checkbox"${window.siyuan.config.search.document ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.headings}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="heading" type="checkbox"${window.siyuan.config.search.heading ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.list1}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="list" type="checkbox"${window.siyuan.config.search.list ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.listItem}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="listItem" type="checkbox"${window.siyuan.config.search.listItem ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.code}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="codeBlock" type="checkbox"${window.siyuan.config.search.codeBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                HTML
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="htmlBlock" type="checkbox"${window.siyuan.config.search.htmlBlock ? " checked" : ""}/>
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchAttr}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="name" type="checkbox"${window.siyuan.config.search.name ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="alias" type="checkbox"${window.siyuan.config.search.alias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.memo}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="memo" type="checkbox"${window.siyuan.config.search.memo ? " checked" : ""}/>
        </label>
                <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.custom}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="custom" type="checkbox"${window.siyuan.config.search.custom ? " checked" : ""}/>
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchBackmention}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="backlinkMentionName" type="checkbox"${window.siyuan.config.search.backlinkMentionName ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="backlinkMentionAlias" type="checkbox"${window.siyuan.config.search.backlinkMentionAlias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.anchor}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="backlinkMentionAnchor" type="checkbox"${window.siyuan.config.search.backlinkMentionAnchor ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.docName}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="backlinkMentionDoc" type="checkbox"${window.siyuan.config.search.backlinkMentionDoc ? " checked" : ""}/>
        </label>
    </div>
</div>
<div class="b3-label">
 ${window.siyuan.languages.searchVirtualRef}
    <div class="config-query">
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.name}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="virtualRefName" type="checkbox"${window.siyuan.config.search.virtualRefName ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.alias}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="virtualRefAlias" type="checkbox"${window.siyuan.config.search.virtualRefAlias ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.anchor}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="virtualRefAnchor" type="checkbox"${window.siyuan.config.search.virtualRefAnchor ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.docName}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="virtualRefDoc" type="checkbox"${window.siyuan.config.search.virtualRefDoc ? " checked" : ""}/>
        </label>
    </div>
</div>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.searchLimit}
         <div class="b3-label__text">${window.siyuan.languages.searchLimit1}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="limit" type="number" min="1" max="10240" value="${window.siyuan.config.search.limit}">
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
                    mathBlock: (query.element.querySelector("#mathBlock") as HTMLInputElement).checked,
                    table: (query.element.querySelector("#table") as HTMLInputElement).checked,
                    blockquote: (query.element.querySelector("#blockquote") as HTMLInputElement).checked,
                    superBlock: (query.element.querySelector("#superBlock") as HTMLInputElement).checked,
                    paragraph: (query.element.querySelector("#paragraph") as HTMLInputElement).checked,
                    name: (query.element.querySelector("#name") as HTMLInputElement).checked,
                    alias: (query.element.querySelector("#alias") as HTMLInputElement).checked,
                    memo: (query.element.querySelector("#memo") as HTMLInputElement).checked,
                    custom: (query.element.querySelector("#custom") as HTMLInputElement).checked,
                    limit: parseInt((query.element.querySelector("#limit") as HTMLInputElement).value),
                    caseSensitive: (query.element.querySelector("#caseSensitive") as HTMLInputElement).checked,
                    backlinkMentionName: (query.element.querySelector("#backlinkMentionName") as HTMLInputElement).checked,
                    backlinkMentionAlias: (query.element.querySelector("#backlinkMentionAlias") as HTMLInputElement).checked,
                    backlinkMentionAnchor: (query.element.querySelector("#backlinkMentionAnchor") as HTMLInputElement).checked,
                    backlinkMentionDoc: (query.element.querySelector("#backlinkMentionDoc") as HTMLInputElement).checked,
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
