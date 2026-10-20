import {Menu} from "../../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {toggleMenu} from "../../../menus/menuToggle";

interface RuleSummary {
    id: string;
    name: string;
    enabled: boolean;
    trigger: string;
}

export const openAutomationRules = (target: HTMLElement, rules: RuleSummary[], currentID: string,
                                    select: (id: string) => void, rename: (id: string, name: string) => void,
                                    remove: (id: string) => void) => {
    const lang = window.siyuan.languages;
    let menu: Menu;
    toggleMenu({target, build: () => {
        menu = new Menu();
    menu.addItem({type: "empty", label: `<div class="b3-menu__filter av__automation-menu fn__flex-column">
<input class="b3-text-field" data-search placeholder="${escapeAttr(lang.searchPlaceholder)}" aria-label="${escapeAttr(lang.search)}">
<div class="b3-list b3-list--background av__automation-menu-list fn__flex-1" data-rules></div></div>`, bind: element => {
        const search = element.querySelector<HTMLInputElement>("[data-search]");
        const list = element.querySelector<HTMLElement>("[data-rules]");
        const render = () => {
            const keyword = search.value.trim().toLowerCase();
            list.innerHTML = rules.filter(rule => rule.name.toLowerCase().includes(keyword)).map(rule =>
                `<div class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}${rule.id === currentID ? " b3-list-item--focus" : ""}" data-id="${escapeAttr(rule.id)}" tabindex="0">
<svg class="b3-list-item__hinticon ariaLabel" aria-label="${escapeAttr(rule.enabled ? lang.enable : lang.disable)}"><use xlink:href="#${rule.enabled ? "iconPlay" : "iconPause"}"></use></svg>
<span class="b3-list-item__text ariaLabel" aria-label="${escapeAttr(rule.name)}">${escapeHtml(rule.name)}</span>
<span class="b3-list-item__action ariaLabel" data-rename role="button" tabindex="0" aria-label="${escapeAttr(lang.rename)}"><svg><use xlink:href="#iconEdit"></use></svg></span>
<span class="b3-list-item__action ariaLabel" data-more role="button" tabindex="0" aria-label="${escapeAttr(lang.more)}"><svg><use xlink:href="#iconMore"></use></svg><div class="b3-menu__submenu"><div class="b3-menu__items">${rule.trigger === "block" ? `<div class="ft__on-surface ft__smaller av__automation-rule-warning" data-rule-change-tip>${lang.automationCollectionRuleChangeTip}</div>` : ""}<button class="b3-menu__item b3-menu__item--warning" data-delete><svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg><span class="b3-menu__label">${lang.delete}</span></button></div></div></span>
${rule.id === currentID ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}</div>`).join("") || `<div class="b3-list--empty">${lang.emptyContent}</div>`;
        };
        search.addEventListener("input", render);
        element.addEventListener("click", event => {
            event.stopPropagation();
            const clicked = event.target as Element;
            if (clicked.closest("[data-rule-change-tip]")) { return; }
            const row = clicked.closest<HTMLElement>("[data-id]");
            if (!row || clicked.closest("input")) { return; }
            const id = row.dataset.id;
            if (clicked.closest("[data-delete]")) {
                remove(id);
                menu.close();
            } else if (clicked.closest("[data-more]")) {
                const submenu = row.querySelector<HTMLElement>(".b3-menu__submenu");
                const open = submenu.style.display !== "block";
                list.querySelectorAll<HTMLElement>(".b3-menu__submenu").forEach(item => item.style.display = "none");
                submenu.style.display = open ? "block" : "none";
                menu.showSubMenu(submenu);
            } else if (clicked.closest("[data-rename]")) {
                if (row.querySelector("input")) { return; }
                const rule = rules.find(item => item.id === id);
                const title = row.querySelector<HTMLElement>(".b3-list-item__text");
                const input = document.createElement("input");
                input.className = "b3-text-field b3-text-field--small fn__flex-1";
                input.value = rule.name;
                input.setAttribute("aria-label", lang.rename);
                title.replaceWith(input);
                let finished = false;
                const finish = (cancel = false) => {
                    if (finished) { return; }
                    finished = true;
                    const name = input.value.trim() || rule.name;
                    if (!cancel && name !== rule.name) { rename(id, name); }
                    render();
                };
                input.addEventListener("blur", () => finish(), {once: true});
                input.addEventListener("keydown", event => {
                    event.stopPropagation();
                    if (event.isComposing) { return; }
                    if (event.key === "Escape") { event.preventDefault(); finish(true); }
                    if (event.key === "Enter") { event.preventDefault(); finish(); }
                });
                input.focus();
                input.select();
            } else {
                menu.close();
                select(id);
            }
        });
        element.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.isComposing || (event.target as Element).matches("input")) { return; }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                (event.target as HTMLElement).click();
            }
        });
        render();
    }});
    }, show: () => {
        const rect = target.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height, target});
        if (!isMobile()) { menu.element.querySelector<HTMLInputElement>("[data-search]").focus(); }
    }});
};
