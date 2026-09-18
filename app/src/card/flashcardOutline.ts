import type {App} from "../index";
import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";

interface IOutlineHeading {
    id: string;
    name: string;
    children?: IOutlineHeading[];
}

// 大纲只读取已显示的卡面文字，避免从原文标题中提前暴露答案。
export const createFlashcardOutline = (app: App, surface: HTMLElement) => {
    const panel = surface.querySelector<HTMLElement>("[data-flashcard-outline]");
    const content = surface.querySelector<HTMLElement>(".card__block");
    const toggle = surface.querySelector<HTMLButtonElement>('[data-type="toggle-outline"]');
    let generation = 0;
    let sourceID = "";
    let headings: IOutlineHeading[] = [];
    let loaded = false;
    let revealed = false;
    let disposed = false;
    const visibleHeadings = () => new Map([...content.querySelectorAll<HTMLElement>('[data-type="NodeHeading"][data-node-id]')]
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible")
        .map((element) => [element.dataset.nodeId, element]));
    const visibleHeading = (id: string) => visibleHeadings().get(id);
    const highlight = () => {
        const top = content.getBoundingClientRect().top;
        const visible = visibleHeadings();
        let current = "";
        for (const item of panel.querySelectorAll<HTMLElement>("[data-heading-id]")) {
            const heading = visible.get(item.dataset.headingId);
            if (heading && (heading.getBoundingClientRect().top <= top + 48 || !current)) {
                current = item.dataset.headingId;
            }
        }
        panel.querySelectorAll<HTMLElement>("[data-heading-id]").forEach((item) => {
            item.classList.toggle("b3-list-item--focus", item.dataset.headingId === current);
        });
    };
    const render = () => {
        panel.replaceChildren();
        const visible = visibleHeadings();
        let position = 0;
        const append = (items: IOutlineHeading[], depth: number) => items.forEach((item) => {
            position++;
            const heading = visible.get(item.id);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-list-item";
            button.dataset.headingId = item.id;
            button.style.paddingLeft = `${8 + Math.min(depth, 6) * 12}px`;
            const label = document.createElement("span");
            label.className = "b3-list-item__text";
            // 带挖空、输入或自定义样式的标题在揭示前仅显示序号。
            const safe = heading && !heading.querySelector("[data-type~=mark],input,[style],.card__v2-anki-cloze,.card__v2-occlusion,.fn__none") &&
                !heading.hasAttribute("style") && !heading.closest(".card__v2-occlusion");
            const text = heading?.querySelector("[contenteditable]")?.textContent || heading?.textContent;
            label.textContent = safe || revealed && heading && !heading.querySelector(".card__v2-occlusion,.fn__none") ?
                text?.trim() : `${window.siyuan.languages.outline} ${position}`;
            button.appendChild(label);
            button.addEventListener("click", () => {
                const target = visibleHeading(item.id);
                if (target) {
                    content.scrollTop += target.getBoundingClientRect().top - content.getBoundingClientRect().top;
                    highlight();
                } else {
                    void openFileById({app, id: item.id, action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]});
                }
            });
            panel.appendChild(button);
            append(item.children || [], depth + 1);
        });
        append(headings, 0);
        if (!headings.length) {
            panel.textContent = window.siyuan.languages.emptyContent;
        }
        highlight();
    };
    const load = () => {
        if (loaded || !sourceID || disposed || panel.classList.contains("fn__none")) {
            return;
        }
        loaded = true;
        const request = generation;
        const failed = () => {
            if (!disposed && request === generation) {
                loaded = false;
            }
        };
        void fetchPost("/api/block/getBlockInfo", {id: sourceID}, (response) => {
            const info = response.data;
            if (disposed || request !== generation || !info || typeof info !== "object" || !("rootID" in info)) {
                return;
            }
            void fetchPost("/api/outline/getDocOutline", {id: info.rootID, notebook: info.box}, (result) => {
                if (disposed || request !== generation) {
                    return;
                }
                headings = Array.isArray(result.data) ? result.data : [];
                render();
            }, undefined, failed);
        }, undefined, failed);
    };
    const togglePanel = () => {
        const hidden = panel.classList.toggle("fn__none");
        toggle.setAttribute("aria-expanded", String(!hidden));
        if (!hidden) {
            load();
            render();
        }
    };
    toggle.addEventListener("click", togglePanel);
    content.addEventListener("scroll", highlight, {passive: true});
    return {
        toggle: togglePanel,
        update: (id = "") => {
            generation++;
            sourceID = id;
            loaded = false;
            revealed = false;
            headings = [];
            render();
            load();
        },
        reveal: (complete: boolean) => {
            revealed = complete;
            render();
        },
        destroy: () => {
            disposed = true;
            generation++;
            content.removeEventListener("scroll", highlight);
            toggle.removeEventListener("click", togglePanel);
        },
    };
};
