import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

for (const [name, excludeSelected, attributePanel] of [
    ["relation selection preserves pages and position with stable offsets", false, false],
    ["relation selection preserves pages and position with shifting offsets", true, false],
    ["attribute relation search and edits survive panel replacement", false, true],
] as const) {
    test(name, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = browserSources({relation: join(__dirname, "relation.ts"), cell: join(__dirname, "cell.ts"),
            relationPosition: join(__dirname, "relationPosition.ts"), relationKeyboard: join(__dirname, "relationKeyboard.ts")});
        sources.excludeSelected = JSON.stringify(excludeSelected);
        sources.attributePanel = JSON.stringify(attributePanel);
        const result = await runBrowserCase(async source => {
            const equal = (actual: unknown, expected: unknown, message: string) => {
                if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
                }
            };
            const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
            const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
            const columns = [{id: "primary", name: "Title", type: "block"}];
            const rows = Array.from({length: 64}, (_, index) => ({id: `row-${index + 1}`, cells: [{id: `value-${index + 1}`,
                value: {type: "block", keyID: "primary", isDetached: true, block: {id: "", icon: "",
                    content: `${index < 48 ? "Match" : "Other"} ${index + 1}`}}}]}));
            const initialIDs = ["row-64", "row-63"];
            const requests: any[] = [];
            const updates: any[] = [];
            const updateBlocks: HTMLElement[] = [];
            const creations: any[] = [];
            let finishDocumentSelection: () => void;
            const attributePanel = JSON.parse(source.attributePanel);
            const escape = (text: string) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
            Object.assign(window, {siyuan: {languages: {untitled: "Untitled", newRowInRelation: "Create ${y} in ${x}"}},
                Lute: {NewNodeID: () => "pending-item"}});
            const modules: Record<string, any> = {
                "../../../util/fetch": {
                    fetchPost: (_url: string, data: any, callback: (value: any) => void,
                        _headers: unknown, _error: unknown, signal: AbortSignal) => new Promise<void>(resolve => {
                        requests.push({data, signal, finish: (response: any) => { callback(response); resolve(); }});
                    }),
                    fetchSyncPost: async (_url: string, data: unknown) => {
                        creations.push(data);
                        return {code: 0, data: {itemID: "created-item", content: "New relation", isDetached: true}};
                    },
                },
                "../../../util/documentSelectionRequest": {
                    fetchWithDocumentSelection: async (fetch: () => Promise<unknown>, options: {isValid: () => boolean}) => {
                        await new Promise<void>(resolve => { finishDocumentSelection = resolve; });
                        if (options.isValid()) return fetch();
                    },
                },
                "../../../util/escape": {escapeAttr: escape, escapeHtml: escape, escapeHtmlTextAndAttr: escape},
                "../../util/hasClosest": {hasClosestByClassName: (element: HTMLElement, name: string) => element.closest("." + name),
                    hasClosestByAttribute: (element: HTMLElement, name: string, value: string) => element.closest(`[${name}="${value}"]`)},
                "../../../layout/getTopBarHeight": {getTopBarHeight: () => 0},
                "../../../util/setPosition": {setPosition: () => {}},
                "../../../constants": {Constants: {TIMEOUT_LOAD: 5, TIMEOUT_INPUT: 5}},
                "./host": {getAVRelationHost: (): undefined => undefined, getAVHostBlockID: (block: HTMLElement) => block.dataset.nodeId,
                    getAVHostIdentity: (block: HTMLElement) => block.dataset.nodeId, canEditAVHost: () => true},
                "./columnWidth": {getAVColumnTextMeasurer: () => () => 20, getAVTableFitWidths: () => ({primary: "500px"}),
                    getAVRelationColumnWidth: () => "500px"},
                "./cell": {genCellValueByElement: () => ({relation: {blockIDs: initialIDs}}),
                    updateCellsValue: (_protyle: unknown, block: HTMLElement, value: unknown, _cells: HTMLElement[],
                        _columns: unknown, _html: unknown, getOperations: boolean) => {
                        if (getOperations) return {doOperations: [{action: "updateAttrViewCell", rowID: "source-row", data: {relation: value}}]};
                        updateBlocks.push(block);
                        updates.push(value);
                    }},
                "./col": {getColIconByType: () => "iconText", getColId: (element: HTMLElement) => element.dataset.colId},
                "./row": {getFieldIdByCellElement: (element: HTMLElement) => element.dataset.rowId},
                "./cellEditor": {getAVCellEditorOwner: (element: HTMLElement) => element.closest(".custom-attr")},
                "./virtualScroll": {getAVData: (): undefined => undefined},
                "./cellValue": {hasAVRenderTemplateResult: () => false},
                "./blockIcon": {getAVBlockIconHTML: () => ""},
                "./richText": {renderAVRichTextElements: () => {}},
                "./relationLayout": {bindRelationLayout: () => Object.assign(() => {}, {close: () => {}})},
            };
            for (const name of ["relationPosition", "relationKeyboard", "relation"]) {
                const exports = modules["./" + name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) => modules[path] || {});
            }
            const cellModule = {};
            new Function("exports", "require", source.cell)(cellModule, (path: string) => modules[path] || {});
            const {bindRelationEvent, setRelationCell} = modules["./relation"];
            const style = document.createElement("style");
            style.textContent = `.b3-menu{max-height:400px;padding:0;border:0}.b3-menu__items{height:240px;width:300px;overflow:auto;overflow-anchor:none}
.av__relation-table-row,.av__relation-table-header{display:grid;height:30px;width:532px;box-sizing:border-box}.fn__none{display:none!important}svg{width:12px;height:12px}`;
            document.head.append(style);
            const menu = document.createElement("div");
            menu.className = "b3-menu";
            menu.innerHTML = `<div class="av__relation" data-av-id="target" data-source-av-id="source" data-key-id="relation">
<div><div class="b3-form__icona"><input class="b3-text-field"><button data-type="copyRelatedItems"></button></div><span class="popover__block"></span></div>
<div class="b3-menu__items"><div data-relation-type="loader"></div></div></div>`;
            if (JSON.parse(source.excludeSelected)) {
                menu.insertAdjacentHTML("afterbegin", '<div class="toolbar">Mobile handle</div>');
            }
            const block = document.createElement("div");
            block.innerHTML = '<div data-row-id="source-row" data-col-id="relation"></div>';
            block.dataset.nodeId = "carrier";
            const panel = document.createElement("div");
            panel.className = "protyle-db-attr";
            panel.innerHTML = '<div class="custom-attr"></div>';
            const cell = block.firstElementChild as HTMLElement;
            const options = {menuElement: menu, blockElement: block, cellElements: [cell],
                protyle: {block: {rootID: "doc"}, app: {appId: "app"}}};
            if (attributePanel) {
                Object.assign(block.dataset, {avId: "source", attributeId: "doc", avType: "table"});
                cell.classList.add("custom-attr__avvalue");
                cell.dataset.type = "relation";
                cell.dataset.cellValue = encodeURIComponent(JSON.stringify({type: "relation", relation: {blockIDs: initialIDs}}));
                panel.firstElementChild.append(block);
                document.body.append(panel);
                (cellModule as typeof import("./cell")).captureAVCellInput(options.protyle as IProtyle, block, options.cellElements);
            } else {
                document.body.append(block);
            }
            document.body.append(menu);
            const close = bindRelationEvent(options);
            const list = menu.querySelector<HTMLElement>(".b3-menu__items");
            const input = menu.querySelector("input");
            const byID = (id: string) => list.querySelector<HTMLElement>(`.av__relation-table-row[data-row-id="${id}"]`);
            const ids = (type: string) => Array.from(list.querySelectorAll<HTMLElement>(`[data-relation-type="${type}"]`)).map(row => row.dataset.rowId);
            const ordered = (data: any) => {
                let result = rows.filter(row => row.cells[0].value.block.content.includes(data.keyword));
                if (JSON.parse(source.excludeSelected)) result = result.filter(row => !data.selectedBlockIDs.includes(row.id));
                if (data.sort?.order === "DESC") result = [...result].reverse();
                return result;
            };
            const respond = async (request = requests.at(-1), code = 0) => {
                const data = request.data;
                const candidates = ordered(data);
                request.finish({code, data: code === 0 ? {name: "Target", columns, total: candidates.length,
                    newItemPreview: attributePanel ? {primaryKey: data.keyword} : undefined,
                    selectedRows: rows.filter(row => data.selectedBlockIDs.includes(row.id)),
                    rows: candidates.slice((data.page - 1) * data.pageSize, data.page * data.pageSize)} : undefined});
                await tick();
            };
            const loadMore = async () => {
                list.scrollTop = list.scrollHeight;
                list.dispatchEvent(new Event("scroll"));
                await respond();
            };
            menu.addEventListener("click", event => {
                const row = (event.target as HTMLElement).closest<HTMLElement>('[data-type="setRelationCell"]');
                if (row) void setRelationCell(options.protyle, block, row, options.cellElements);
            });
            const click = async (id: string) => { byID(id).click(); await tick(); };
            const key = async (value: string) => { input.dispatchEvent(new KeyboardEvent("keydown", {key: value, bubbles: true})); await tick(); };
            const current = (id: string) => {
                list.querySelectorAll(".b3-menu__item--current").forEach(row => row.classList.remove("b3-menu__item--current"));
                byID(id).classList.add("b3-menu__item--current");
            };
            await respond();
            if (attributePanel) {
                const search = async (keyword: string) => {
                    input.value = keyword;
                    input.dispatchEvent(new Event("input", {bubbles: true}));
                    await new Promise(resolve => setTimeout(resolve, 20));
                };
                const repaint = (host: HTMLElement) => {
                    const replacement = host.cloneNode(true) as HTMLElement;
                    const body = document.createElement("div");
                    body.className = "custom-attr";
                    body.append(replacement);
                    panel.firstElementChild.replaceWith(body);
                    return replacement;
                };
                await search("Match 25");
                await respond();
                await click("row-25");
                const stale = requests.at(-1);
                const refreshed = repaint(block);
                await search("Other 50");
                equal(requests.at(-1).data.keyword, "Other 50", "Search uses the refreshed attribute panel");
                await respond();
                await respond(stale);
                equal(ids("candidate"), ["row-50"], "Only the latest matching candidates appear");
                await click("row-50");
                const latest = repaint(refreshed);
                await click("row-25");
                equal(updates.map(value => value.blockIDs), [
                    [...initialIDs, "row-25"], [...initialIDs, "row-25", "row-50"], [...initialIDs, "row-50"],
                ], "Adding and removing save the expected relation values");
                check(updateBlocks[1] === refreshed && updateBlocks[2] === latest, "Writes use the mounted attribute host");
                await respond();
                const creating = setRelationCell(options.protyle, block, list.querySelector('[data-relation-type="create"]'), options.cellElements);
                await tick();
                repaint(latest);
                finishDocumentSelection();
                await creating;
                equal(creations.map(value => value.cells), [[{itemID: "source-row", relatedItemIDs: [...initialIDs, "row-50"]}]],
                    "Creating a relation can continue when the original host is replaced during document selection");
                const pending = requests.at(-1);
                options.protyle.block.rootID = "another-doc";
                const beforeSwitch = ids("candidate");
                await respond(pending);
                equal(ids("candidate"), beforeSwitch, "Late response cannot change candidates after switching documents");
                await click("row-50");
                await search("Match 40");
                equal(updates.length, 3, "The old popup cannot edit after switching documents");
                check(requests.at(-1) === pending, "The old popup cannot search after switching documents");
                close();
                return "relation pagination passed";
            }
            await loadMore();
            equal(ids("candidate").length, 32, "Two pages loaded");
            input.focus();
            list.scrollTop = byID("row-23").offsetTop - list.offsetTop;
            list.scrollLeft = 80;
            list.scrollTop = list.scrollHeight;
            list.dispatchEvent(new Event("scroll"));
            const pendingAppend = requests.at(-1);
            equal(pendingAppend.data.page, 3, "Third page pending before selection");
            list.scrollTop = byID("row-23").offsetTop - list.offsetTop;
            const top = byID("row-23").getBoundingClientRect().top;
            current("row-25");
            await key("Enter");
            equal(requests.at(-1).data.pageSize, 32, "Selection refreshes both pages");
            equal(pendingAppend.signal.aborted, true, "Selection aborts in-flight append");
            equal(updates.at(-1).blockIDs, [...initialIDs, "row-25"], "Selected order retained");
            await respond();
            check(Math.abs(byID("row-23").getBoundingClientRect().top - top) < 1, "Visible candidate anchor retained");
            equal(list.scrollLeft, 80, "Horizontal position retained");
            check(document.activeElement === input, "Input focus retained");
            equal(list.querySelector<HTMLElement>(".b3-menu__item--current").dataset.rowId, "row-26", "Keyboard continues next to selected row");
            await respond(pendingAppend);
            equal(list.querySelector<HTMLElement>(".b3-menu__item--current").dataset.rowId, "row-26", "Late append cannot reset keyboard target");
            await key("ArrowDown");
            await key("Enter");
            const stale = requests.at(-1);
            await click("row-28");
            equal(stale.signal.aborted, true, "Rapid selection aborts previous refresh");
            list.scrollTop = byID("row-20").offsetTop - list.offsetTop;
            const scrolledTop = byID("row-20").getBoundingClientRect().top;
            await respond();
            check(Math.abs(byID("row-20").getBoundingClientRect().top - scrolledTop) < 1, "Scrolling during refresh is retained");
            const latest = ids("selected");
            await respond(stale);
            equal(ids("selected"), latest, "Late response cannot overwrite selection");
            const deselectTop = byID("row-20").getBoundingClientRect().top;
            await click("row-25");
            await respond();
            check(Math.abs(byID("row-20").getBoundingClientRect().top - deselectTop) < 1, "Deselect retains candidate anchor");
            equal(ids("selected"), [...initialIDs, "row-27", "row-28"], "Click deselection preserves other values and order");
            current("row-27");
            await key("Enter");
            await respond();
            equal(ids("selected"), [...initialIDs, "row-28"], "Keyboard deselection preserves order");
            await click("row-30");
            await respond(undefined, -1);
            list.scrollTop = list.scrollHeight;
            list.dispatchEvent(new Event("scroll"));
            equal([requests.at(-1).data.page, requests.at(-1).data.pageSize], [1, 32], "Failed refresh retries prefix before appending");
            await respond();
            while (list.dataset.hasMore === "true") await loadMore();
            equal(ids("candidate"), ordered(requests.at(-1).data).filter(row => !ids("selected").includes(row.id)).map(row => row.id),
                "All remaining pages have no duplicate or missing candidates");
            equal(new Set(ids("candidate")).size, ids("candidate").length, "Candidate IDs unique");
            await click("row-31");
            const staleSearch = requests.at(-1);
            input.value = "Match";
            input.dispatchEvent(new Event("input", {bubbles: true}));
            const requestCount = requests.length;
            list.dispatchEvent(new Event("scroll"));
            await key("Enter");
            equal(requests.length, requestCount, "Debounced search cannot append or select old candidates");
            await new Promise(resolve => setTimeout(resolve, 10));
            equal([requests.at(-1).data.keyword, requests.at(-1).data.pageSize], ["Match", 16], "Search resets prefix");
            await respond();
            const searchIDs = ids("candidate");
            await respond(staleSearch);
            equal(ids("candidate"), searchIDs, "Search discards earlier selection refresh");
            await loadMore();
            const header = list.querySelector<HTMLElement>('[role="columnheader"]');
            header.focus();
            header.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            equal([requests.at(-1).data.page, requests.at(-1).data.pageSize], [1, 16], "Keyboard sort resets pagination");
            await respond();
            equal(document.activeElement?.getAttribute("role"), "columnheader", "Sort header focus restored");
            list.querySelector<HTMLElement>('[role="columnheader"]').click();
            await respond();
            await loadMore();
            current("row-40");
            input.focus();
            await key("Enter");
            equal(requests.at(-1).data.sort, {column: "primary", order: "DESC"}, "Selection retains sort");
            equal(requests.at(-1).data.keyword, "Match", "Selection retains search");
            equal(requests.at(-1).data.pageSize, 32, "Search selection retains two pages");
            await respond();
            while (list.dataset.hasMore === "true") await loadMore();
            equal(ids("candidate"), ordered(requests.at(-1).data).filter(row => !ids("selected").includes(row.id)).map(row => row.id),
                "Sorted search pages remain complete");
            await click("row-64");
            await respond();
            equal(ids("candidate").includes("row-64"), false, "Deselected item outside search stays outside candidates");
            await click("row-40");
            await respond(undefined, -1);
            list.scrollTop = list.scrollHeight;
            list.dispatchEvent(new Event("scroll"));
            equal(requests.at(-1).data.pageSize, 48, "Last-page failure can retry the full loaded prefix");
            const pending = requests.at(-1);
            close();
            equal(pending.signal.aborted, true, "Close aborts pending refresh");
            const beforeClose = list.innerHTML;
            await respond(pending);
            equal(list.innerHTML, beforeClose, "Closed panel ignores late response");
            return "relation pagination passed";
        }, sources, "", {width: excludeSelected ? 320 : 900});
        assert.match(result, /relation pagination passed/);
    });
}
