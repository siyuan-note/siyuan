import {Menu} from "../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {getFieldsByData} from "./view";
import {bindInlineFilterEvents, genEmptyFilterValue, getFiltersHTML, prepareFilterColumns} from "./filter";
import {AV_MANAGE_CUSTOM_COLORS_TYPE, getAVColorGridHTML, getAVColorOrder, getAVCustomColors} from "./color";
import {getConditionalBackground, moveConditionalColorRule} from "./conditionalColor";
import {openAVCustomColorDialog} from "./colorDialog";
import {openViewSettingMenu} from "./viewSettingMenu";

const cloneRules = (rules: IAVConditionalColorRule[]) => JSON.parse(JSON.stringify(rules || [])) as IAVConditionalColorRule[];

export const openConditionalColorsMenu = async (options: {
    protyle: IProtyle,
    blockElement: HTMLElement,
    data: IAV,
    menuElement: HTMLElement,
    onResize: () => void,
}) => {
    const {protyle, blockElement, data, menuElement, onResize} = options;
    if (protyle.disabled || window.siyuan.isPublish || window.siyuan.config.readonly ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    let rules = cloneRules(data.view.conditionalColors);
    const lang = window.siyuan.languages;
    menuElement.classList.remove("av__filter-panel");
    menuElement.classList.add("av__conditional-panel");
    menuElement.innerHTML = `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" data-type="go-config"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span class="b3-menu__label ft__center">${lang.conditionalColors}</span>
</button>
<button class="b3-menu__separator"></button>
<div class="av__conditional-colors">
<div class="av__conditional-hint ft__on-surface ft__smaller">${lang.conditionalColorsTip}</div>
<div data-rules></div>
<button type="button" class="b3-menu__item" data-action="add" disabled><svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg><span class="b3-menu__label">${lang.new}</span></button>
</div></div>`;
    const panelElement = menuElement.querySelector<HTMLElement>(".av__conditional-colors");
    const root = panelElement.querySelector<HTMLElement>("[data-rules]");
    onResize();
    await prepareFilterColumns(data);
    // 返回上级或关闭菜单后，不再更新已经移除的面板。
    if (!panelElement.isConnected) {
        return;
    }
    const fields = getFieldsByData(data).filter(field => field.type !== "lineNumber");
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
        root.innerHTML = rules.map(rule => `<div class="av__conditional-rule" data-rule-id="${escapeAttr(rule.id)}">
<span class="block__icon block__icon--show fn__grab ariaLabel" draggable="true" data-conditional-drag aria-label="${lang.move}"><svg><use xlink:href="#iconDrag"></use></svg></span>
<div class="av__conditional-condition" data-filter></div>
<svg class="b3-menu__action b3-menu__action--show b3-menu__action--warning ariaLabel" data-action="remove" role="button" tabindex="0" aria-label="${lang.delete}"><use xlink:href="#iconTrashcan"></use></svg>
<div class="av__conditional-controls">
${data.viewType === "table" || rule.target === "property" ? `<select class="b3-select" data-action="target" aria-label="${lang.conditionalColorTarget}">
<option value="item"${rule.target === "item" ? " selected" : ""}>${lang.conditionalColorItem}</option>
<option value="property"${rule.target === "property" ? " selected" : ""}>${lang.conditionalColorProperty}</option></select>` : ""}
<button type="button" class="b3-button b3-button--cancel" data-action="color"><span class="av__conditional-swatch" style="background-color:${getConditionalBackground(rule.color) || "var(--b3-theme-background)"}"></span>${rule.matchOption ? lang.conditionalColorFirstOption : rule.color?.color ? lang.color : lang.default}</button>
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
        panelElement.querySelector<HTMLButtonElement>('[data-action="add"]').disabled = rules.length >= 100 || fields.length === 0;
        onResize();
    };
    // 在整个规则面板捕获点击，收起其他规则或条件区域内打开的选项面板。
    const closeDropdowns = (event: MouseEvent) => {
        if (!panelElement.isConnected) {
            menuElement.removeEventListener("click", closeDropdowns, true);
            return;
        }
        const target = event.target as HTMLElement;
        const dropdownTypes = [
            ["selectDropdown", '[data-type="selectTrigger"]'],
            ["relationFilterDropdown", '[data-type="relationFilterTrigger"]'],
            ["relList", '[data-type-rel="relation"]'],
        ];
        dropdownTypes.forEach(([type, triggerSelector]) => {
            const trigger = target.closest(triggerSelector);
            root.querySelectorAll<HTMLElement>(`[data-type="${type}"]`).forEach(dropdown => {
                if (!dropdown.contains(target) &&
                    (!trigger || trigger.closest("[data-filter]") !== dropdown.closest("[data-filter]"))) {
                    dropdown.style.display = "none";
                }
            });
        });
    };
    menuElement.addEventListener("click", closeDropdowns, true);
    panelElement.addEventListener("change", event => {
        const target = event.target as HTMLSelectElement;
        if (target.dataset.action === "target") {
            update(target.closest<HTMLElement>("[data-rule-id]").dataset.ruleId,
                {target: target.value === "property" ? "property" : "item"});
        }
    });
    root.addEventListener("drop", (event: DragEvent) => {
        const source = window.siyuan.dragElement;
        if (!source?.dataset.ruleId || !root.contains(source)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-rule-id]");
        source.style.opacity = "";
        window.siyuan.dragElement = undefined;
        root.querySelectorAll(".dragover__top, .dragover__bottom").forEach(element => {
            element.classList.remove("dragover__top", "dragover__bottom");
        });
        if (!target || !root.contains(target)) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const next = moveConditionalColorRule(rules, source.dataset.ruleId, target.dataset.ruleId,
            event.clientY <= rect.top + rect.height / 2);
        if (next !== rules) {
            save(next);
        }
    });
    panelElement.addEventListener("keydown", event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action="remove"]');
        if (target && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    panelElement.addEventListener("click", event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!target || (target.tagName !== "BUTTON" && target.dataset.action !== "remove")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const action = target.dataset.action;
        const id = target.closest<HTMLElement>("[data-rule-id]")?.dataset.ruleId;
        const index = rules.findIndex(rule => rule.id === id);
        const rule = rules[index];
        if (action === "remove") {
            save(rules.filter(rule => rule.id !== id));
        } else if (action === "add") {
            const menu = new Menu();
            fields.forEach(field => menu.addItem({label: escapeHtml(field.name), click: () => {
                const {value, operator} = genEmptyFilterValue(field);
                save([...rules, {id: Lute.NewNodeID(), target: "item", color: null,
                    matchOption: ["select", "mSelect"].includes(field.type),
                    filter: {column: field.id, operator: field.type === "checkbox" ? operator : "Is not empty", value}}]);
            }}));
            openViewSettingMenu(menu, target);
        } else if (action === "color" && rule) {
            const menu = new Menu();
            const field = fields.find(field => field.id === rule.filter.column);
            if (["select", "mSelect"].includes(field?.type) && rule.filter.valueSource !== "rendered") {
                menu.addItem({iconHTML: "",
                    label: `<label class="fn__flex fn__pointer"><span>${lang.conditionalColorFirstOption}</span><span class="fn__space fn__flex-1"></span><input type="checkbox" class="b3-switch b3-switch--menu"${rule.matchOption ? " checked" : ""}></label>`,
                    bind(element) {
                        const switchElement = element.querySelector<HTMLInputElement>(".b3-switch");
                        switchElement.addEventListener("change", () => {
                            update(id, {matchOption: switchElement.checked});
                        });
                    },
                });
                menu.addSeparator();
            }
            menu.addItem({label: lang.default, iconHTML: "",
                click: () => update(id, {color: null, matchOption: false})});
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
            openViewSettingMenu(menu, target);
        }
    });
    render();
};
