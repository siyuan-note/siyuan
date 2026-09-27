import {Dialog} from "../../../dialog";
import {Menu} from "../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {transaction} from "../../wysiwyg/transaction";
import {getFieldsByData} from "./view";
import {bindInlineFilterEvents, genEmptyFilterValue, getFiltersHTML, prepareFilterColumns} from "./filter";
import {AV_MANAGE_CUSTOM_COLORS_TYPE, getAVColorGridHTML, getAVColorOrder, getAVCustomColors} from "./color";
import {getConditionalBackground} from "./conditionalColor";
import {openAVCustomColorDialog} from "./colorDialog";

const cloneRules = (rules: IAVConditionalColorRule[]) => JSON.parse(JSON.stringify(rules || [])) as IAVConditionalColorRule[];

export const openConditionalColors = async (protyle: IProtyle, blockElement: HTMLElement, data: IAV) => {
    if (protyle.disabled || window.siyuan.isPublish || window.siyuan.config.readonly ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    await prepareFilterColumns(data);
    const fields = getFieldsByData(data).filter(field => field.type !== "lineNumber");
    let rules = cloneRules(data.view.conditionalColors);
    const lang = window.siyuan.languages;
    const dialog = new Dialog({
        title: lang.conditionalColors,
        width: isMobile() ? "92vw" : "760px",
        content: `<div class="b3-dialog__content av__conditional-colors">
<div class="ft__on-surface">${lang.conditionalColorsTip}</div>
<div class="fn__hr"></div><div data-rules></div>
<button type="button" class="b3-button b3-button--outline" data-action="add"><svg><use xlink:href="#iconAdd"></use></svg>${lang.new}</button>
</div>`,
    });
    const root = dialog.element.querySelector<HTMLElement>("[data-rules]");
    const icon = (action: string, name: string, label: string, disabled = false) =>
        `<button type="button" class="block__icon block__icon--show ariaLabel" data-action="${action}" aria-label="${escapeAttr(label)}"${disabled ? " disabled" : ""}><svg><use xlink:href="#${name}"></use></svg></button>`;
    const save = (next: IAVConditionalColorRule[], redraw = true) => {
        const previous = cloneRules(rules);
        rules = cloneRules(next);
        data.view.conditionalColors = cloneRules(rules);
        const operation = {action: "setAttrViewConditionalColors" as const, avID: data.id,
            viewID: data.viewID, blockID: blockElement.dataset.nodeId};
        transaction(protyle, [{...operation, data: cloneRules(rules)}], [{...operation, data: previous}]);
        if (redraw) {
            render();
        }
    };
    const update = (id: string, patch: Partial<IAVConditionalColorRule>, redraw = true) => {
        save(rules.map(rule => rule.id === id ? {...rule, ...patch} : rule), redraw);
    };
    const render = () => {
        root.innerHTML = rules.map((rule, index) => `<div class="av__conditional-rule" data-rule-id="${escapeAttr(rule.id)}">
<div class="fn__flex"><span class="fn__flex-1">${index + 1}</span>
${icon("up", "iconUp", lang.moveToUp, index === 0)}${icon("down", "iconDown", lang.moveToDown, index === rules.length - 1)}
${icon("remove", "iconTrashcan", lang.delete)}</div>
<div data-filter></div>
<div class="av__conditional-controls">
<select class="b3-select" data-action="target" aria-label="${lang.conditionalColorTarget}">
<option value="item"${rule.target === "item" ? " selected" : ""}>${lang.conditionalColorItem}</option>
${data.viewType === "table" || rule.target === "property" ? `<option value="property"${rule.target === "property" ? " selected" : ""}>${lang.conditionalColorProperty}</option>` : ""}</select>
<button type="button" class="b3-button b3-button--outline" data-action="color"><span class="av__conditional-swatch" style="background-color:${getConditionalBackground(rule.color) || "var(--b3-theme-background)"}"></span>${rule.matchOption ? lang.conditionalColorFirstOption : rule.color?.color ? lang.color : lang.default}</button>
</div></div>`).join("");
        root.querySelectorAll<HTMLElement>("[data-rule-id]").forEach(element => {
            const rule = rules.find(rule => rule.id === element.dataset.ruleId);
            const filterRoot = element.querySelector<HTMLElement>("[data-filter]");
            const filterData: IAV = {...data, view: {...data.view, filters: [JSON.parse(JSON.stringify(rule.filter))]}};
            const renderFilter = () => fields.some(field => field.id === rule.filter.column) ?
                getFiltersHTML(filterData, true) : `<span class="ft__on-surface">${lang.invalid}: ${escapeHtml(rule.filter.column)}</span>`;
            filterRoot.innerHTML = renderFilter();
            bindInlineFilterEvents(filterRoot, filterData, protyle, blockElement.dataset.nodeId, data.id, {
                root: filterRoot,
                render: renderFilter,
                save: filters => {
                    const field = fields.find(field => field.id === filters[0]?.column);
                    const current = rules.find(item => item.id === rule.id);
                    const matchOption = current.matchOption && ["select", "mSelect"].includes(field?.type) &&
                        filters[0]?.valueSource !== "rendered";
                    update(rule.id, {filter: filters[0], matchOption}, false);
                    if (current.matchOption !== matchOption) {
                        element.querySelector('[data-action="color"]').lastChild.textContent = current.color?.color ? lang.color : lang.default;
                    }
                },
            });
        });
        dialog.element.querySelector<HTMLButtonElement>('[data-action="add"]').disabled = rules.length >= 100 || fields.length === 0;
    };
    dialog.element.addEventListener("change", event => {
        const target = event.target as HTMLSelectElement;
        if (target.dataset.action === "target") {
            update(target.closest<HTMLElement>("[data-rule-id]").dataset.ruleId,
                {target: target.value === "property" ? "property" : "item"});
        }
    });
    dialog.element.addEventListener("click", event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!target || target.tagName !== "BUTTON") {
            return;
        }
        const action = target.dataset.action;
        const id = target.closest<HTMLElement>("[data-rule-id]")?.dataset.ruleId;
        const index = rules.findIndex(rule => rule.id === id);
        const rule = rules[index];
        if (action === "remove") {
            save(rules.filter(rule => rule.id !== id));
        } else if (action === "up" || action === "down") {
            const next = cloneRules(rules);
            const to = index + (action === "up" ? -1 : 1);
            if (index >= 0 && to >= 0 && to < next.length) {
                next.splice(to, 0, next.splice(index, 1)[0]);
                save(next);
            }
        } else if (action === "add") {
            const menu = new Menu();
            fields.forEach(field => menu.addItem({label: escapeHtml(field.name), click: () => {
                const {value, operator} = genEmptyFilterValue(field);
                save([...rules, {id: Lute.NewNodeID(), target: "item", color: null,
                    matchOption: ["select", "mSelect"].includes(field.type),
                    filter: {column: field.id, operator: field.type === "checkbox" ? operator : "Is not empty", value}}]);
            }}));
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        } else if (action === "color" && rule) {
            const menu = new Menu();
            menu.addItem({label: lang.default, checked: !rule.matchOption && !rule.color?.color,
                click: () => update(id, {color: null, matchOption: false})});
            const field = fields.find(field => field.id === rule.filter.column);
            if (["select", "mSelect"].includes(field?.type) && rule.filter.valueSource !== "rendered") {
                menu.addItem({label: lang.conditionalColorFirstOption, checked: rule.matchOption,
                    click: () => update(id, {matchOption: true})});
            }
            menu.addItem({type: "empty", iconHTML: "",
                label: `<div class="fn__flex fn__flex-wrap av__option-colors">${getAVColorGridHTML(getAVCustomColors(), rule.color?.color || "", lang.manageColors, getAVColorOrder())}</div>`,
                bind(element) {
                    element.classList.add("b3-menu__custom", "av__option-custom");
                    element.addEventListener("click", event => {
                        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
                        if (button?.dataset.type === AV_MANAGE_CUSTOM_COLORS_TYPE) {
                            menu.close();
                            openAVCustomColorDialog({protyle, data, blockElement});
                        } else if (button?.dataset.color) {
                            update(id, {color: {content: "", color: button.dataset.color}, matchOption: false});
                            menu.close();
                        }
                    });
                },
            });
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        }
    });
    render();
};
