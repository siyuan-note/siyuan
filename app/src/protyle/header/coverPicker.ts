import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {isMobile} from "../../util/functions";
import {escapeHtmlTextAndAttr} from "../../util/escape";
import {fetchCoverData, getCategoryLabel} from "./coverData";

export const openCoverPicker = (options: {
    select: (name: string) => void;
    fallback?: (dialog: Dialog) => void;
    destroyCallback?: () => void;
}) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.builtIn,
        content: `<div class="b3-cards" style="padding:16px;justify-content:center;align-items:center;min-height:200px">
    <span class="b3-loading" aria-hidden="true"></span>
</div>`,
        width: isMobile() ? "92vw" : "912px",
        height: isMobile() ? "80vh" : "70vh",
        destroyCallback: options.destroyCallback,
    });
    const active = () => dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true";
    const unavailable = () => {
        if (!active()) {
            return;
        }
        if (options.fallback) {
            options.fallback(dialog);
        } else {
            dialog.destroy();
            showMessage(window.siyuan.languages._kernel[258], 7000, "error");
        }
    };
    void fetchCoverData().then(coverData => {
        if (!active()) {
            return;
        }
        if (!coverData?.allCovers.length) {
            unavailable();
            return;
        }
        const {categories, coversByCategory, allCovers} = coverData;
        const buildCards = (category: string) => {
            const covers = category === "all" ? allCovers : (coversByCategory.get(category) || []);
            return covers.map((cover, index) => `<div class="b3-card b3-cover__card" role="button" tabindex="0" data-name="${escapeHtmlTextAndAttr(cover.file)}" aria-label="${escapeHtmlTextAndAttr(getCategoryLabel(cover.category))} ${index + 1}"><img src="/appearance/covers/${encodeURIComponent(cover.file)}" loading="lazy" alt=""></div>`).join("");
        };
        const buildTab = (category: string, label: string) => {
            const current = category === "all";
            return `<span class="b3-chip b3-chip--hover${current ? " b3-chip--current" : ""}" role="button" tabindex="0" aria-pressed="${current}" data-category="${escapeHtmlTextAndAttr(category)}">${escapeHtmlTextAndAttr(label)}</span>`;
        };
        const body = dialog.element.querySelector<HTMLElement>(".b3-dialog__body");
        body.innerHTML = `<div class="b3-cover">
    <div class="b3-cover__tabs">${buildTab("all", window.siyuan.languages.coverAll)}${categories.map(category => buildTab(category, getCategoryLabel(category))).join("")}</div>
    <div class="b3-cards b3-cover__cards">${buildCards("all")}</div>
</div>`;
        const tabs = body.querySelector<HTMLElement>(".b3-cover__tabs");
        const cards = body.querySelector<HTMLElement>(".b3-cover__cards");
        let selected = false;
        body.addEventListener("click", event => {
            if (!active() || selected) {
                return;
            }
            const target = event.target as HTMLElement;
            const chip = target.closest<HTMLElement>(".b3-chip[data-category]");
            if (chip && tabs.contains(chip)) {
                if (chip.classList.contains("b3-chip--current")) {
                    return;
                }
                const previous = tabs.querySelector(".b3-chip--current");
                previous?.classList.remove("b3-chip--current");
                previous?.setAttribute("aria-pressed", "false");
                chip.classList.add("b3-chip--current");
                chip.setAttribute("aria-pressed", "true");
                cards.innerHTML = buildCards(chip.dataset.category);
                cards.scrollTop = 0;
                return;
            }
            const card = target.closest<HTMLElement>(".b3-cover__card");
            if (card && cards.contains(card) && allCovers.some(cover => cover.file === card.dataset.name)) {
                selected = true;
                options.select(card.dataset.name);
                dialog.destroy();
            }
        });
        body.addEventListener("keydown", event => {
            if (event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
                (event.key !== "Enter" && event.key !== " ")) {
                return;
            }
            const target = (event.target as HTMLElement).closest<HTMLElement>('[role="button"]');
            if (target && body.contains(target)) {
                event.preventDefault();
                target.click();
            }
        });
    }).catch(unavailable);
    return dialog;
};
