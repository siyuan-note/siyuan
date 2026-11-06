import {MenuItem} from "../../../menus/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {fetchSyncPost} from "../../../util/fetch";
import {isMobile} from "../../../util/functions";
import {escapeAriaLabel, escapeHtml} from "../../../util/escape";
import {showMessage} from "../../../dialog/message";
import {transaction} from "../../wysiwyg/transaction";

const isReadonly = (protyle: IProtyle) => protyle?.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
    protyle?.options?.history?.created || protyle?.options?.history?.snapshot;

const pendingConfigs = new WeakMap<HTMLElement, {avID: string; value: IAVColumnRelation["detailView"]}>();

export const getPendingRelatedViewConfig = (element: Element) => {
    const source = element.querySelector<HTMLElement>('[data-type="goSearchAV"]');
    const pending = source && pendingConfigs.get(source);
    return pending?.avID === source?.dataset.avId ? pending?.value : undefined;
};

export const getRelatedViewConfigHTML = (field: IAVColumn, protyle: IProtyle) => {
    const lang = window.siyuan.languages._attrView;
    const enabled = field.relation?.detailView?.spec === 1 && field.relation.detailView.enabled;
    return `<div class="b3-menu__item b3-menu__item--wrap">
    <button type="button" class="block__icon block__icon--show ariaLabel" data-type="relatedViewInfo" data-position="north" aria-label="${escapeAriaLabel(lang.relatedDatabaseViewInfo)}" aria-expanded="false">
        <svg aria-hidden="true"><use xlink:href="#iconInfo"></use></svg>
    </button>
    <span class="fn__space"></span>
    <label class="b3-menu__label fn__flex">
    <span class="b3-menu__label">${lang.showRelatedDatabaseView}</span>
    <input data-type="relatedViewEnabled" type="checkbox" class="b3-switch b3-switch--menu" ${enabled ? "checked" : ""} ${isReadonly(protyle) || !field.relation?.avID ? "disabled" : ""}>
    </label>
</div>
<div class="b3-menu__item b3-menu__item--readonly fn__none" data-related-view-info="true">
    <span class="b3-menu__label ft__on-surface ft__smaller ft__breakword">${escapeHtml(lang.relatedDatabaseViewInfo)}</span>
</div>
<button class="b3-menu__item${enabled ? "" : " fn__none"}" data-type="relatedViewTarget" disabled>
    <svg class="b3-menu__icon"><use xlink:href="#iconTable"></use></svg>
    <span class="b3-menu__label">${lang.relatedDatabaseView}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<div class="b3-menu__item b3-menu__item--readonly${enabled ? "" : " fn__none"}" data-related-view-tip="true">
    <span class="b3-menu__label ft__on-surface ft__smaller fn__flex"><span class="fn__flex-center ft__breakword">${lang.relatedDatabaseViewShared}</span></span>
</div>`;
};

export const getRelatedTableViews = (views: IAVView[] | undefined) => {
    return (views || []).filter(view => view.type === "table" && !!view.id);
};

export const bindRelatedViewConfig = async (protyle: IProtyle, avID: string, field: IAVColumn,
                                          menuElement: HTMLElement, blockID: string) => {
    const switchElement = menuElement.querySelector<HTMLInputElement>('[data-type="relatedViewEnabled"]');
    let targetElement = menuElement.querySelector<HTMLButtonElement>('[data-type="relatedViewTarget"]');
    if (!switchElement || !targetElement) {
        return;
    }
    const lang = window.siyuan.languages._attrView;
    const infoButton = menuElement.querySelector<HTMLButtonElement>('[data-type="relatedViewInfo"]');
    const infoElement = menuElement.querySelector<HTMLElement>("[data-related-view-info]");
    let infoExpanded = false;
    infoButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        infoExpanded = !infoExpanded;
        infoElement?.classList.toggle("fn__none", !infoExpanded);
        infoButton.setAttribute("aria-expanded", String(infoExpanded));
    });
    const tipElement = menuElement.querySelector<HTMLElement>("[data-related-view-tip]");
    const sourceElement = menuElement.querySelector<HTMLElement>('[data-type="goSearchAV"]');
    const selectedTarget = () => sourceElement?.dataset.avId ?? field.relation?.avID ?? "";
    let targetAVID = selectedTarget();
    const detailView = () => targetAVID === (field.relation?.avID || "")
        ? field.relation?.detailView : getPendingRelatedViewConfig(menuElement);
    const currentView = (views: IAVView[]) => views.find(view => view.id === detailView()?.viewID) || views[0];
    const isCurrent = () => switchElement.isConnected && selectedTarget() === targetAVID;
    const canEdit = () => isCurrent() && !isReadonly(protyle) &&
        (!field.relation?.detailView || field.relation.detailView.spec === 1);
    let views: IAVView[] = [];
    let pending = false;
    let unavailable = !targetAVID;
    let requestSequence = 0;
    const save = (value: IAVColumnRelation["detailView"]) => {
        if (!canEdit()) {
            return;
        }
        const previous = detailView() ? {...detailView()} : null;
        if (previous?.enabled === value.enabled && previous?.viewID === value.viewID) {
            return;
        }
        if (targetAVID !== (field.relation?.avID || "")) {
            pendingConfigs.set(sourceElement, {avID: targetAVID, value});
            return;
        }
        transaction(protyle, [{
            action: "setAttrViewRelationDetail", avID, keyID: field.id, blockID, data: value,
        }], [{
            action: "setAttrViewRelationDetail", avID, keyID: field.id, blockID, data: previous,
        }]);
        field.relation.detailView = value;
    };
    const render = () => {
        const enabled = detailView()?.spec === 1 && detailView().enabled;
        switchElement.checked = !!enabled;
        switchElement.disabled = !canEdit() || pending || (!targetAVID && !enabled);
        const current = currentView(views);
        const choicesTarget = targetAVID;
        const choicesSequence = requestSequence;
        const choices: IMenu[] = views.map(view => ({
            icon: "iconTable",
            label: escapeHtml(view.name || window.siyuan.languages._kernel[267]),
            checked: current?.id === view.id,
            disabled: !canEdit(),
            click: () => {
                if (!canEdit() || pending || choicesTarget !== targetAVID || choicesSequence !== requestSequence) {
                    return;
                }
                save({spec: 1, enabled: true, viewID: view.id});
                render();
                if (!isMobile()) {
                    targetElement.focus();
                }
            },
        }));
        const message = pending ? window.siyuan.languages.loading : unavailable
            ? lang.relatedDatabaseViewUnavailable : lang.relatedDatabaseViewNoTable;
        const item = new MenuItem({
            icon: "iconTable",
            label: lang.relatedDatabaseView,
            accelerator: current ? escapeHtml(current.name || window.siyuan.languages._kernel[267]) : undefined,
            disabled: !canEdit() || pending,
            submenu: choices.length ? choices : [{type: "readonly", iconHTML: "", label: message}],
        });
        targetElement.replaceWith(item.element);
        targetElement = item.element as HTMLButtonElement;
        targetElement.dataset.type = "relatedViewTarget";
        targetElement.classList.add("b3-menu__item--wrap");
        const viewName = targetElement.querySelector(".b3-menu__accelerator");
        if (viewName && current) {
            viewName.classList.remove("b3-menu__accelerator--hotkey");
            viewName.textContent = current.name || window.siyuan.languages._kernel[267];
        }
        targetElement.setAttribute("aria-label", current
            ? `${lang.relatedDatabaseView} ${current.name || window.siyuan.languages._kernel[267]}` : lang.relatedDatabaseView);
        targetElement.classList.toggle("fn__none", !enabled);
        tipElement.classList.toggle("fn__none", !enabled);
        tipElement.querySelector(".fn__flex-center").textContent = current || pending
            ? lang.relatedDatabaseViewShared : message;
        const submenu = targetElement.querySelector<HTMLElement>(".b3-menu__submenu");
        const show = () => {
            if (!canEdit() || pending) {
                return;
            }
            targetElement.classList.add("b3-menu__item--show");
            window.siyuan.menus.menu.showSubMenu(submenu);
        };
        if (!isMobile()) {
            targetElement.addEventListener("mouseenter", show);
            targetElement.addEventListener("keydown", event => {
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    event.stopPropagation();
                    show();
                    submenu.querySelector<HTMLButtonElement>(".b3-menu__item:not([disabled])")?.focus();
                } else if (event.key === "ArrowLeft" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    targetElement.classList.remove("b3-menu__item--show");
                    targetElement.focus();
                }
            });
        }
        targetElement.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!canEdit() || pending) {
                return;
            }
            if (isMobile()) {
                toggleMenu({target: targetElement, build: menu => {
                    (choices.length ? choices : [{type: "readonly", label: message} as IMenu]).forEach(choice => {
                        menu.append(new MenuItem(choice, menu).element);
                    });
                }, show: menu => menu.fullscreen("bottom")});
            } else {
                show();
            }
        });
    };
    menuElement.addEventListener("mouseover", event => {
        const hovered = (event.target as Element).closest(".b3-menu__item");
        if (hovered && !targetElement.contains(hovered)) {
            targetElement.classList.remove("b3-menu__item--show");
        }
    });
    const loadViews = async () => {
        targetAVID = selectedTarget();
        const requestedTarget = targetAVID;
        const sequence = ++requestSequence;
        views = [];
        unavailable = !targetAVID;
        pending = !!targetAVID;
        render();
        if (!targetAVID) return;
        try {
            const existingRelation = targetAVID === field.relation?.avID;
            const response = await fetchSyncPost("/api/av/getAttributeView", {
                id: targetAVID, blockID: existingRelation ? blockID : sourceElement?.dataset.blockId,
                ...(existingRelation ? {relationFieldContext: {sourceAvID: avID, relationKeyID: field.id}} : {}),
            });
            if (!switchElement.isConnected || targetAVID !== requestedTarget || sequence !== requestSequence) return;
            if (response.code !== 0) {
                unavailable = true;
            } else {
                unavailable = !response.data?.av;
                views = getRelatedTableViews(response.data?.av?.views);
            }
        } catch {
            if (sequence === requestSequence) unavailable = true;
        } finally {
            if (switchElement.isConnected && sequence === requestSequence) {
                pending = false;
                render();
            }
        }
    };
    if (sourceElement) {
        const observer = new MutationObserver(() => {
            if (!switchElement.isConnected) {
                observer.disconnect();
                return;
            }
            if (selectedTarget() !== targetAVID) {
                pendingConfigs.delete(sourceElement);
                void loadViews();
            } else {
                render();
            }
        });
        observer.observe(sourceElement, {attributes: true, attributeFilter: ["data-av-id"]});
    }
    switchElement.addEventListener("change", () => {
        if (!canEdit() || pending) {
            render();
            return;
        }
        const enabled = switchElement.checked;
        const current = currentView(views);
        if (enabled && !current) {
            showMessage(unavailable ? lang.relatedDatabaseViewUnavailable : lang.relatedDatabaseViewNoTable);
            render();
            return;
        }
        save({spec: 1, enabled, viewID: enabled ? current.id : detailView()?.viewID || ""});
        render();
    });
    await loadViews();
};
