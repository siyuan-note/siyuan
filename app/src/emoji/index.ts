import {getRandom, isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
/// #if !MOBILE
import {Files} from "../layout/dock/Files";
import {getDockByType} from "../layout/tabUtil";
/// #endif
import {getAllEditor, getAllModels} from "../layout/getAll";
import {Dialog} from "../dialog";
import {setPosition} from "../util/setPosition";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {getLuteInstance} from "../protyle/render/setLute";
import * as dayjs from "dayjs";
import {
    bindDynamicIconTarget,
    genEmojiImageHTML,
    getIconSearchText,
    getIconValueKind,
    getNetworkIconName,
    normalizeNetworkIconURL,
    normalizeRecentIconValue,
    parseBase64Image,
    updateRecentIconValues,
} from "./iconValue";
import {showMessage} from "../dialog/message";
import {escapeAttr, escapeHtml} from "../util/escape";
import {
    collectEmojiMatches,
    getActiveEmojiCategory,
    getEmojiItemMap,
    getEmojiVirtualChunks,
    getRandomEmojiCategories,
    groupCustomEmojiItems,
    type TRandomEmojiScope,
} from "./panel";

export const getRandomEmoji = (scope: TRandomEmojiScope = "all") => {
    const categories = getRandomEmojiCategories(window.siyuan.emojis, scope);
    if (categories.length === 0) {
        return scope === "all" ? "1f600" : "";
    }
    const category = categories[getRandom(0, categories.length - 1)];
    return category.items[getRandom(0, category.items.length - 1)].unicode;
};

export const unicode2Emoji = (unicode: string, className = "", needSpan = false, lazy = false) => {
    if (!unicode) {
        return "";
    }
    let emoji = "";
    const imageHTML = genEmojiImageHTML(unicode, className, lazy);
    if (imageHTML) {
        emoji = Lute.Sanitize(imageHTML);
    } else {
        try {
            unicode.split("-").forEach(item => {
                if (item.length < 5) {
                    emoji += String.fromCodePoint(parseInt("0" + item, 16));
                } else {
                    emoji += String.fromCodePoint(parseInt(item, 16));
                }
            });
        } catch (e) {
            // 自定义表情搜索报错 https://github.com/siyuan-note/siyuan/issues/5883
            // 这里忽略错误不做处理
        }
        emoji = Lute.Sanitize(emoji);
        if (needSpan) {
            emoji = `<span class="${className}">${emoji}</span>`;
        }
    }
    return emoji;
};

const genEmojiButton = (unicode: string, label: string, lazy = false) => {
    const safeUnicode = escapeAttr(escapeHtml(unicode));
    const safeLabel = escapeAttr(escapeHtml(label));
    return `<button data-unicode="${safeUnicode}" class="emojis__item ariaLabel" aria-label="${safeLabel}">
${unicode2Emoji(unicode, "", false, lazy)}</button>`;
};

const isEmojiMatched = (emoji: IEmojiItem, key: string) => {
    const lowerKey = key.toLowerCase();
    return unicode2Emoji(emoji.unicode) === key ||
        emoji.keywords.toLowerCase().includes(lowerKey) ||
        emoji.description.toLowerCase().includes(lowerKey) ||
        emoji.description_zh_cn.toLowerCase().includes(lowerKey) ||
        emoji.description_ja_jp.toLowerCase().includes(lowerKey);
};

type TEmojiPanelOptions = {
    targetID?: string,
    hideDynamic?: boolean,
    hideCustom?: boolean,
};

const emojiCategoryIcons: Record<string, string> = {
    custom: "1f527",
    people: "1f60d",
    nature: "1f433",
    food: "1f96a",
    activity: "1f3a8",
    travel: "1f3dd-fe0f",
    objects: "1f52e",
    symbols: "267e-fe0f",
    flags: "1f6a9",
};

const emojiItemHTMLCache = new WeakMap<IEmojiItem, string>();

const genEmojiSection = (title: string, content: string, groupName?: string, categoryID?: string) => {
    const groupAttribute = typeof groupName === "string" ? ` data-group="${escapeAttr(escapeHtml(groupName))}"` : "";
    const categoryAttribute = categoryID ? ` data-category="${escapeAttr(categoryID)}"` : "";
    const titleHTML = title ? `<div class="emojis__title">${escapeHtml(title)}</div>` : "";
    return `<div class="emojis__section"${groupAttribute}${categoryAttribute}>${titleHTML}<div class="emojis__content">${content}</div></div>`;
};

const getRecentEmojiButtons = (key: string, options: TEmojiPanelOptions) => {
    const recentEmojiMap = getEmojiItemMap(window.siyuan.emojis, options.hideCustom);
    let html = "";
    const renderedRecentValues = new Set<string>();
    window.siyuan.config.editor.emoji.forEach((value) => {
        const recentValue = normalizeRecentIconValue(value);
        if (!recentValue || renderedRecentValues.has(recentValue)) {
            return;
        }
        renderedRecentValues.add(recentValue);
        const emoji = recentEmojiMap.get(recentValue);
        if (emoji) {
            if (!key || isEmojiMatched(emoji, key)) {
                html += genEmojiButton(emoji.unicode, getEmojiDesc(emoji), true);
            }
            return;
        }

        const kind = getIconValueKind(recentValue);
        if ((kind !== "dynamic" && kind !== "network") || (kind === "dynamic" && options?.hideDynamic)) {
            return;
        }
        if (key && !getIconSearchText(recentValue).toLowerCase().includes(key.toLowerCase())) {
            return;
        }
        const displayValue = bindDynamicIconTarget(recentValue, options?.targetID);
        const label = kind === "dynamic" ? window.siyuan.languages.dynamicIcon : recentValue;
        html += genEmojiButton(displayValue, label, true);
    });
    return html;
};

const genEmojiSearchHTML = (key: string, max: number | undefined, options: TEmojiPanelOptions) => {
    const {customItems, builtInItems} = collectEmojiMatches(
        window.siyuan.emojis,
        (item) => isEmojiMatched(item, key),
        max,
        options.hideCustom,
    );
    customItems.sort((a, b) => {
        const lowerKey = key.toLowerCase();
        const aName = a.keywords.split("/").pop().toLowerCase();
        const bName = b.keywords.split("/").pop().toLowerCase();
        const positionDiff = aName.indexOf(lowerKey) - bName.indexOf(lowerKey);
        return positionDiff || aName.length - bName.length;
    });
    const resultHTML = [...customItems, ...builtInItems]
        .map((item) => genEmojiButton(item.unicode, getEmojiDesc(item), true)).join("");
    const recentHTML = getRecentEmojiButtons(key, options);
    if (!recentHTML && !resultHTML) {
        return `<div class="emojis__section"><div class="emojis__title">${window.siyuan.languages.emptyContent}</div></div>`;
    }
    return (recentHTML ? genEmojiSection(window.siyuan.languages.recentEmoji, recentHTML) : "") +
        (resultHTML ? genEmojiSection(window.siyuan.languages.emoji, resultHTML) : "");
};

export const genEmojiCategoryButtons = (hideCustom = false) => {
    const categories = [{
        id: "recent",
        unicode: "1f552",
        title: window.siyuan.languages.recentEmoji,
    }];
    window.siyuan.emojis.forEach((category, index) => {
        if (hideCustom && category.id === "custom") {
            return;
        }
        categories.push({
            id: category.id,
            unicode: emojiCategoryIcons[category.id] || "2753",
            title: getEmojiTitle(index),
        });
    });
    return categories.map((category) =>
        `<button data-type="${escapeAttr(category.id)}" class="emojis__type ariaLabel" aria-label="${escapeAttr(escapeHtml(category.title))}">${unicode2Emoji(category.unicode)}</button>`
    ).join("");
};

export class EmojiPanelController {
    private categoryID = "";
    private imageObserver?: IntersectionObserver;
    private virtualObserver?: IntersectionObserver;
    private selectionObserver?: IntersectionObserver;
    private resizeObserver: ResizeObserver;
    private active = true;
    private pageMode: "common" | "custom" | "search" | "" = "";
    private searchMode = false;
    private scrollFrame = 0;
    private virtualTimer = 0;
    private virtualKey = 0;
    private columnCount = 10;
    private selectedUnicode = "";
    private categoryOffsets: {id: string, top: number}[] = [];
    private builtInChunkOffsets: {element: HTMLElement, categoryID: string, top: number, bottom: number}[] = [];
    private virtualItems = new Map<string, IEmojiItem[]>();
    private virtualQueue = new Map<HTMLElement, boolean>();
    private visibleChunks = new Set<HTMLElement>();

    constructor(private panelElement: HTMLElement, private typeElement: HTMLElement, private options: TEmojiPanelOptions) {
        this.panelElement.addEventListener("scroll", this.handleScroll, {passive: true});
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.active || this.pageMode === "search" || this.panelElement.clientWidth === 0) {
                return;
            }
            if (this.pageMode === "custom") {
                const columnCount = this.getColumnCount();
                if (columnCount !== this.columnCount) {
                    this.renderCustomPage();
                }
            } else if (this.pageMode === "common") {
                const columnCount = this.getColumnCount();
                if (columnCount !== this.columnCount) {
                    this.renderCommonPage(this.categoryID);
                }
            }
        });
        this.resizeObserver.observe(this.panelElement);
    }

    public setOptions(options: TEmojiPanelOptions) {
        this.options = options;
    }

    public renderInitial() {
        const recentHTML = getRecentEmojiButtons("", this.options);
        const firstBuiltIn = window.siyuan.emojis.find((category) => category.id !== "custom");
        this.renderCommonPage(recentHTML ? "recent" : firstBuiltIn?.id || "recent", recentHTML);
    }

    public renderCategory(categoryID: string) {
        const category = window.siyuan.emojis.find((item) => item.id === categoryID);
        if (categoryID !== "recent" && (!category || (this.options.hideCustom && category.id === "custom"))) {
            this.renderInitial();
            return;
        }

        if (category?.id === "custom") {
            if (!this.searchMode && this.pageMode === "custom") {
                this.panelElement.scrollTop = 0;
                this.ensureCurrentSelection();
                return;
            }
            this.renderCustomPage();
            return;
        }

        if (category?.id !== "custom") {
            const targetElement = this.getCategoryElement(categoryID);
            if (!this.searchMode && this.pageMode === "common" && targetElement) {
                this.categoryID = categoryID;
                this.updateCurrentType();
                this.scrollToCategory(targetElement);
                return;
            }
            this.renderCommonPage(categoryID);
        }
    }

    public renderSearch(key: string, max?: number) {
        if (!key) {
            if (this.categoryID) {
                this.renderCategory(this.categoryID);
            } else {
                this.renderInitial();
            }
            return;
        }
        this.disconnectObservers();
        this.resetVirtualState();
        this.pageMode = "search";
        this.searchMode = true;
        this.panelElement.innerHTML = genEmojiSearchHTML(key, max, this.options);
        this.panelElement.scrollTop = 0;
        this.typeElement.classList.add("fn__none");
        this.observeImages(this.panelElement);
        this.selectFirst();
    }

    public loadMoreEmojis(direction: "previous" | "next" = "next") {
        if (this.searchMode || (this.pageMode !== "common" && this.pageMode !== "custom")) {
            return false;
        }
        const chunks = Array.from(this.panelElement.querySelectorAll<HTMLElement>(".emojis__chunk"));
        const currentChunk = this.panelElement.querySelector(".emojis__item--current")?.closest<HTMLElement>(".emojis__chunk");
        const currentIndex = currentChunk ? chunks.indexOf(currentChunk) : -1;
        const adjacentChunk = direction === "previous" ? chunks[currentIndex - 1] : chunks[currentIndex + 1];
        if (!adjacentChunk || adjacentChunk.childElementCount > 0) {
            return false;
        }
        this.renderVirtualChunk(adjacentChunk);
        return true;
    }

    public moveSelection(key: string) {
        const nextElement = moveEmojiSelection(
            this.panelElement,
            key,
            (direction) => this.loadMoreEmojis(direction),
        );
        if (nextElement) {
            this.selectedUnicode = nextElement.dataset.unicode || "";
        }
        return nextElement;
    }

    public deactivate() {
        this.active = false;
        this.disconnectObservers();
        this.resizeObserver.disconnect();
    }

    public activate() {
        this.active = true;
        this.resizeObserver.observe(this.panelElement);
        if (!this.categoryID || this.panelElement.childElementCount === 0) {
            this.renderInitial();
            return;
        }
        this.observeImages(this.panelElement);
        if (this.pageMode === "common") {
            this.updateCategoryOffsets();
            this.updateBuiltInChunkOffsets();
            this.renderVisibleBuiltInChunks(this.categoryID);
        }
        if (this.pageMode === "custom") {
            this.observeVirtualChunks();
        }
        this.ensureCurrentSelection();
    }

    public destroy() {
        this.deactivate();
        this.resetVirtualState();
        this.panelElement.removeEventListener("scroll", this.handleScroll);
        if (this.scrollFrame) {
            cancelAnimationFrame(this.scrollFrame);
        }
    }

    public getCurrentElement() {
        return this.ensureCurrentSelection();
    }

    private renderCommonPage(categoryID: string, recentHTML = getRecentEmojiButtons("", this.options)) {
        this.disconnectObservers();
        this.resetVirtualState();
        this.pageMode = "common";
        this.searchMode = false;
        this.columnCount = this.getColumnCount();
        const sections: string[] = [];
        if (recentHTML) {
            sections.push(genEmojiSection(window.siyuan.languages.recentEmoji, recentHTML, undefined, "recent"));
        }
        window.siyuan.emojis.forEach((item, index) => {
            if (item.id === "custom") {
                return;
            }
            sections.push(this.genVirtualSection(getEmojiTitle(index), item.items, undefined, item.id));
        });
        this.panelElement.innerHTML = sections.join("") ||
            `<div class="emojis__section"><div class="emojis__title">${window.siyuan.languages.emptyContent}</div></div>`;
        this.panelElement.scrollTop = 0;
        this.updateCategoryOffsets();
        this.updateBuiltInChunkOffsets();
        this.categoryID = this.getCategoryElement(categoryID)?.dataset.category ||
            this.panelElement.querySelector<HTMLElement>(".emojis__section[data-category]")?.dataset.category || "recent";
        this.typeElement.classList.remove("fn__none");
        this.updateCurrentType();
        this.observeImages(this.panelElement);
        const targetElement = this.getCategoryElement(this.categoryID);
        if (targetElement) {
            this.scrollToCategory(targetElement);
        } else {
            this.selectFirst();
        }
        this.renderVisibleBuiltInChunks(this.categoryID);
    }

    private renderCustomPage() {
        this.disconnectObservers();
        this.resetVirtualState();
        this.pageMode = "custom";
        this.searchMode = false;
        this.categoryID = "custom";
        this.columnCount = this.getColumnCount();
        const category = window.siyuan.emojis.find((item) => item.id === "custom");
        if (!category || category.items.length === 0) {
            this.panelElement.innerHTML = `<div class="emojis__section"><div class="emojis__title">${window.siyuan.languages.setEmojiTip}</div></div>`;
        } else {
            this.panelElement.innerHTML = groupCustomEmojiItems(category.items)
                .map((group) => this.genVirtualSection(group.name, group.items, group.name)).join("");
        }
        this.panelElement.scrollTop = 0;
        this.typeElement.classList.remove("fn__none");
        this.updateCurrentType();
        const firstChunk = this.panelElement.querySelector<HTMLElement>(".emojis__chunk");
        if (firstChunk) {
            this.renderVirtualChunk(firstChunk);
            this.selectElement(firstChunk.querySelector(".emojis__item"));
        }
        this.observeVirtualChunks();
    }

    private genVirtualSection(title: string, items: IEmojiItem[], groupName?: string, categoryID?: string) {
        const groupAttribute = typeof groupName === "string" ? ` data-group="${escapeAttr(escapeHtml(groupName))}"` : "";
        const categoryAttribute = categoryID ? ` data-category="${escapeAttr(categoryID)}"` : "";
        const titleHTML = title ? `<div class="emojis__title">${escapeHtml(title)}</div>` : "";
        const chunksHTML = getEmojiVirtualChunks(items, this.columnCount).map((chunk) => {
            const key = (++this.virtualKey).toString();
            this.virtualItems.set(key, chunk);
            const height = Math.ceil(chunk.length / this.columnCount) * 34;
            return `<div class="emojis__content emojis__chunk" data-virtual-key="${key}" style="height:${height}px"></div>`;
        }).join("");
        return `<div class="emojis__section"${groupAttribute}${categoryAttribute}>${titleHTML}<div class="emojis__chunks">${chunksHTML}</div></div>`;
    }

    private getCategoryElement(categoryID: string) {
        return Array.from(this.panelElement.querySelectorAll<HTMLElement>(".emojis__section[data-category]"))
            .find((item) => item.dataset.category === categoryID);
    }

    private scrollToCategory(targetElement: HTMLElement) {
        const firstChunk = targetElement.querySelector<HTMLElement>(".emojis__chunk");
        if (firstChunk) {
            this.renderVirtualChunk(firstChunk);
        }
        this.selectElement(targetElement.querySelector(".emojis__item"));
        const categoryOffset = this.categoryOffsets.find((item) => item.id === targetElement.dataset.category);
        if (categoryOffset) {
            this.panelElement.scrollTop = categoryOffset.top;
        }
    }

    private updateCategoryOffsets() {
        const panelTop = this.panelElement.getBoundingClientRect().top;
        this.categoryOffsets = Array.from(this.panelElement.querySelectorAll<HTMLElement>(".emojis__section[data-category]"))
            .map((item) => ({
                id: item.dataset.category || "",
                top: item.getBoundingClientRect().top - panelTop + this.panelElement.scrollTop,
            }));
    }

    private updateBuiltInChunkOffsets() {
        const panelTop = this.panelElement.getBoundingClientRect().top;
        const scrollTop = this.panelElement.scrollTop;
        this.builtInChunkOffsets = Array.from(this.panelElement.querySelectorAll<HTMLElement>(".emojis__chunk"))
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const top = rect.top - panelTop + scrollTop;
                const categoryID = element.closest<HTMLElement>(".emojis__section")?.dataset.category || "";
                return {element, categoryID, top, bottom: top + rect.height};
            });
    }

    private getColumnCount() {
        if (this.panelElement.clientWidth === 0) {
            return this.columnCount;
        }
        return Math.max(1, Math.floor(Math.max(34, this.panelElement.clientWidth - 12) / 34));
    }

    private observeVirtualChunks() {
        this.virtualObserver?.disconnect();
        this.selectionObserver?.disconnect();
        this.visibleChunks.clear();
        const chunks = this.panelElement.querySelectorAll<HTMLElement>(".emojis__chunk");
        if (chunks.length === 0) {
            this.virtualObserver = undefined;
            this.selectionObserver = undefined;
            return;
        }
        this.virtualObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    this.queueVirtualChunk(entry.target as HTMLElement, false);
                }
            });
        }, {root: this.panelElement, rootMargin: "200% 0px"});
        chunks.forEach((item) => this.virtualObserver.observe(item));
        this.selectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const element = entry.target as HTMLElement;
                if (entry.isIntersecting) {
                    this.visibleChunks.add(element);
                    this.queueVirtualChunk(element, true);
                } else {
                    this.visibleChunks.delete(element);
                }
            });
            this.syncVisibleSelection();
        }, {root: this.panelElement});
        chunks.forEach((item) => this.selectionObserver.observe(item));
    }

    private queueVirtualChunk(element: HTMLElement, priority: boolean) {
        if (element.childElementCount > 0) {
            this.virtualQueue.delete(element);
            return;
        }
        this.virtualQueue.set(element, priority || this.virtualQueue.get(element) === true);
        if (!this.virtualTimer) {
            this.virtualTimer = window.setTimeout(() => this.flushVirtualQueue());
        }
    }

    private flushVirtualQueue() {
        this.virtualTimer = 0;
        const queuedItems = Array.from(this.virtualQueue.entries());
        const nextItem = queuedItems.find((item) => item[1]) || queuedItems[0];
        if (!nextItem) {
            return;
        }
        const [element] = nextItem;
        this.virtualQueue.delete(element);
        if (element.isConnected && this.panelElement.contains(element)) {
            this.renderVirtualChunk(element);
        }
        if (this.virtualQueue.size > 0) {
            this.virtualTimer = window.setTimeout(() => this.flushVirtualQueue());
        }
    }

    private renderVirtualChunk(element: HTMLElement) {
        if (element.childElementCount > 0) {
            return;
        }
        const items = this.virtualItems.get(element.dataset.virtualKey);
        if (!items) {
            return;
        }
        element.innerHTML = items.map((item) => this.getItemHTML(item)).join("");
        this.observeImages(element);
        this.restoreVirtualSelection(element);
    }

    private getItemHTML(item: IEmojiItem) {
        let html = emojiItemHTMLCache.get(item);
        if (!html) {
            html = genEmojiButton(item.unicode, getEmojiDesc(item), true);
            emojiItemHTMLCache.set(item, html);
        }
        return html;
    }

    private restoreVirtualSelection(element: HTMLElement) {
        if (!this.visibleChunks.has(element)) {
            return;
        }
        const currentElement = this.panelElement.querySelector<HTMLElement>(".emojis__item--current");
        const currentChunk = currentElement?.closest<HTMLElement>(".emojis__chunk");
        const currentCategoryID = currentElement?.closest<HTMLElement>(".emojis__section")?.dataset.category;
        if (currentElement && ((currentChunk && this.visibleChunks.has(currentChunk)) ||
            (!currentChunk && this.pageMode === "common" && currentCategoryID === this.categoryID))) {
            return;
        }
        const selectedElement = Array.from(element.querySelectorAll<HTMLElement>(".emojis__item"))
            .find((item) => item.dataset.unicode === this.selectedUnicode);
        if (selectedElement) {
            this.selectElement(selectedElement);
            return;
        }
        this.selectElement(element.querySelector(".emojis__item"));
    }

    private ensureCurrentSelection() {
        const currentElement = this.panelElement.querySelector<HTMLElement>(".emojis__item--current");
        const currentChunk = currentElement?.closest<HTMLElement>(".emojis__chunk");
        const currentCategoryID = currentElement?.closest<HTMLElement>(".emojis__section")?.dataset.category;
        if (currentElement && ((currentChunk && this.visibleChunks.has(currentChunk)) ||
            (!currentChunk && (this.pageMode !== "common" || currentCategoryID === this.categoryID)))) {
            return currentElement;
        }
        const categoryElement = this.pageMode === "common" ? this.getCategoryElement(this.categoryID) : undefined;
        const visibleChunk = this.pageMode === "common" ? this.renderVisibleBuiltInChunks(this.categoryID) :
            Array.from(this.visibleChunks).find((item) => item.childElementCount > 0);
        if (visibleChunk) {
            this.renderVirtualChunk(visibleChunk);
        }
        const firstCategoryChunk = categoryElement?.querySelector<HTMLElement>(".emojis__chunk");
        if (!visibleChunk && firstCategoryChunk) {
            this.renderVirtualChunk(firstCategoryChunk);
        }
        const nextElement = visibleChunk?.querySelector<HTMLElement>(".emojis__item") ||
            firstCategoryChunk?.querySelector<HTMLElement>(".emojis__item") ||
            categoryElement?.querySelector<HTMLElement>(".emojis__item") ||
            this.panelElement.querySelector<HTMLElement>(".emojis__item");
        this.selectElement(nextElement);
        return nextElement;
    }

    private syncVisibleSelection() {
        const currentElement = this.panelElement.querySelector<HTMLElement>(".emojis__item--current");
        const currentChunk = currentElement?.closest<HTMLElement>(".emojis__chunk");
        if (currentChunk && this.visibleChunks.has(currentChunk)) {
            return;
        }
        const visibleChunk = Array.from(this.visibleChunks).find((item) => item.childElementCount > 0);
        if (visibleChunk) {
            this.selectElement(visibleChunk.querySelector(".emojis__item"));
        }
    }

    private renderVisibleBuiltInChunks(categoryID: string) {
        const viewportTop = this.panelElement.scrollTop;
        const viewportBottom = viewportTop + this.panelElement.clientHeight;
        let firstVisibleChunk: HTMLElement | undefined;
        let categoryChunk: HTMLElement | undefined;
        this.builtInChunkOffsets.forEach((item) => {
            if (item.bottom <= viewportTop || item.top >= viewportBottom) {
                return;
            }
            firstVisibleChunk ||= item.element;
            if (item.categoryID === categoryID) {
                categoryChunk ||= item.element;
            }
            this.renderVirtualChunk(item.element);
        });
        return categoryChunk || firstVisibleChunk;
    }

    private selectElement(element?: HTMLElement | null) {
        if (!element) {
            return;
        }
        this.panelElement.querySelector(".emojis__item--current")?.classList.remove("emojis__item--current");
        element.classList.add("emojis__item--current");
        this.selectedUnicode = element.dataset.unicode || "";
    }

    private resetVirtualState() {
        this.categoryOffsets = [];
        this.builtInChunkOffsets = [];
        this.virtualItems.clear();
        this.virtualQueue.clear();
        this.visibleChunks.clear();
        this.virtualKey = 0;
        this.selectedUnicode = "";
    }

    private handleScroll = () => {
        if (this.searchMode || this.categoryID === "custom") {
            return;
        }
        if (this.scrollFrame) {
            return;
        }
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = 0;
            if (this.categoryOffsets.length === 0) {
                return;
            }
            const categoryID = getActiveEmojiCategory(
                this.categoryOffsets,
                this.panelElement.scrollTop,
                this.panelElement.scrollTop + this.panelElement.clientHeight >= this.panelElement.scrollHeight - 1,
            );
            if (categoryID) {
                this.renderVisibleBuiltInChunks(categoryID);
            }
            if (categoryID && categoryID !== this.categoryID) {
                this.categoryID = categoryID;
                this.updateCurrentType();
            }
        });
    };

    private selectFirst() {
        this.selectElement(this.panelElement.querySelector(".emojis__item"));
    }

    private updateCurrentType() {
        this.typeElement.querySelectorAll(".emojis__type").forEach((item: HTMLElement) => {
            item.classList.toggle("emojis__type--current", item.dataset.type === this.categoryID);
        });
    }

    private observeImages(element: Element) {
        if (!this.imageObserver) {
            this.imageObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    const imageElement = entry.target as HTMLImageElement;
                    const src = imageElement.dataset.src;
                    if (src) {
                        imageElement.src = src;
                        imageElement.removeAttribute("data-src");
                    }
                    this.imageObserver?.unobserve(imageElement);
                });
            }, {root: this.panelElement, rootMargin: "64px"});
        }
        element.querySelectorAll("img[data-src]").forEach((item) => this.imageObserver.observe(item));
    }

    private disconnectObservers() {
        this.virtualObserver?.disconnect();
        this.virtualObserver = undefined;
        this.selectionObserver?.disconnect();
        this.selectionObserver = undefined;
        this.imageObserver?.disconnect();
        this.imageObserver = undefined;
        if (this.virtualTimer) {
            clearTimeout(this.virtualTimer);
            this.virtualTimer = 0;
        }
        this.virtualQueue.clear();
        this.visibleChunks.clear();
    }
}

export const moveEmojiSelection = (
    panelElement: HTMLElement,
    key: string,
    loadMore?: (direction: "previous" | "next") => boolean,
) => {
    let items = Array.from(panelElement.querySelectorAll<HTMLElement>(".emojis__item"));
    const currentElement = panelElement.querySelector<HTMLElement>(".emojis__item--current") || items[0];
    if (!currentElement || !key.startsWith("Arrow")) {
        return;
    }
    let currentIndex = items.indexOf(currentElement);
    const columnCount = Math.max(1, Math.floor(currentElement.parentElement.clientWidth / 34));
    const currentContent = currentElement.closest<HTMLElement>(".emojis__content");
    const contentItems = currentContent ? Array.from(currentContent.querySelectorAll<HTMLElement>(".emojis__item")) : items;
    const contentIndex = contentItems.indexOf(currentElement);
    const direction = (key === "ArrowLeft" && contentIndex === 0) ||
        (key === "ArrowUp" && contentIndex < columnCount) ? "previous" :
        (key === "ArrowRight" && contentIndex === contentItems.length - 1) ||
        (key === "ArrowDown" && contentIndex + columnCount >= contentItems.length) ? "next" : undefined;
    if (direction) {
        if (loadMore?.(direction)) {
            items = Array.from(panelElement.querySelectorAll<HTMLElement>(".emojis__item"));
            currentIndex = items.indexOf(currentElement);
        }
    }
    let nextIndex = currentIndex;
    if (key === "ArrowLeft") {
        nextIndex--;
    } else if (key === "ArrowRight") {
        nextIndex++;
    } else if (key === "ArrowUp") {
        nextIndex -= columnCount;
    } else if (key === "ArrowDown") {
        nextIndex += columnCount;
    }
    nextIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
    const nextElement = items[nextIndex];
    if (nextElement === currentElement) {
        return currentElement;
    }
    currentElement.classList.remove("emojis__item--current");
    nextElement.classList.add("emojis__item--current");
    const panelRect = panelElement.getBoundingClientRect();
    const itemRect = nextElement.getBoundingClientRect();
    if (itemRect.top < panelRect.top + 32) {
        panelElement.scrollTop -= panelRect.top + 32 - itemRect.top;
    } else if (itemRect.bottom > panelRect.bottom) {
        panelElement.scrollTop += itemRect.bottom - panelRect.bottom;
    }
    return nextElement;
};

export const addEmoji = (unicode: string) => {
    window.siyuan.config.editor.emoji = updateRecentIconValues(
        window.siyuan.config.editor.emoji,
        unicode,
        Constants.SIZE_UNDO,
    );

    fetchPost("/api/setting/setEmoji", {emoji: window.siyuan.config.editor.emoji});
};

const genWeekdayOptions = (lang: string, weekdayType: string) => {
    const dynamicWeekdayLang = {
        "1": ["Sun", "周日", "週日"],
        "2": ["SUN", "周天", "週天"],
        "3": ["Sunday", "星期日", "星期日"],
        "4": ["SUNDAY", "星期天", "星期天"],
    };
    let currentLang = 0;
    if (lang === "") {
        lang = window.siyuan.config.lang;
    }
    if (lang === "zh-CN") {
        currentLang = 1;
    } else if (lang === "zh-TW") {
        currentLang = 2;
    }
    return `<option value="1" ${weekdayType === "1" ? " selected" : ""}>${dynamicWeekdayLang[1][currentLang]}</option>
<option value="2" ${weekdayType === "2" ? " selected" : ""}>${dynamicWeekdayLang[2][currentLang]}</option>
<option value="3" ${weekdayType === "3" ? " selected" : ""}>${dynamicWeekdayLang[3][currentLang]}</option>
<option value="4" ${weekdayType === "4" ? " selected" : ""}>${dynamicWeekdayLang[4][currentLang]}</option>`;
};

export const openEmojiPanel = (
    id: string,
    type: "doc" | "notebook" | "av",
    position: IPosition,
    callback?: (emoji: string) => void,
    dynamicImgElement?: HTMLElement,
    options?: {
        dynamic?: boolean,
        custom?: boolean,
        ownerElement?: HTMLElement,
        targetID?: string,
    }) => {
    if (type !== "av") {
        window.siyuan.menus.menu.remove();
    } else {
        window.siyuan.menus.menu.removeScrollEvent();
    }

    const popoverElement = options?.ownerElement?.closest<HTMLElement>(".block__popover");
    const targetID = options?.targetID || id;
    const customCategoryIndex = window.siyuan.emojis.findIndex((item) => item.id === "custom");
    const customEmojiLabel = customCategoryIndex > -1 ?
        getEmojiTitle(customCategoryIndex) : window.siyuan.languages.customEmoji;
    const dynamicURL = "api/icon/getDynamicIcon?";
    const dynamicCurrentObj: Record<string, any> = {
        color: "#d23f31",
        lang: "",
        date: dayjs().format("YYYY-MM-DD"),
        weekdayType: "1",
        type: "1",
        content: "SiYuan",
    };
    if (dynamicImgElement && dynamicImgElement.getAttribute("src").startsWith(dynamicURL)) {
        const dynamicCurrentUrl = new URLSearchParams(dynamicImgElement.getAttribute("src").replace(dynamicURL, ""));
        dynamicCurrentObj.color = dynamicCurrentUrl.get("color") || "#d23f31";
        if (!dynamicCurrentObj.color.startsWith("#")) {
            dynamicCurrentObj.color = "#" + dynamicCurrentObj.color;
        }
        const lang = dynamicCurrentUrl.get("lang") || "";
        dynamicCurrentObj.lang = ({zh_CN: "zh-CN", zh_CHT: "zh-TW", en_US: "en"} as IObject)[lang] || lang;
        dynamicCurrentObj.date = dynamicCurrentUrl.get("date") || "";
        dynamicCurrentObj.weekdayType = dynamicCurrentUrl.get("weekdayType") || "1";
        dynamicCurrentObj.type = dynamicCurrentUrl.get("type") || "1";
        dynamicCurrentObj.content = dynamicCurrentUrl.get("content") || "SiYuan";
    }
    const dynamicTextURL = bindDynamicIconTarget(
        `${dynamicURL}type=8&color=${encodeURIComponent(dynamicCurrentObj.color)}&content=${encodeURIComponent(dynamicCurrentObj.content)}`,
        targetID,
    );
    let pastedCustomIconFile: File | undefined;
    let pastedCustomIconObjectURL = "";
    const emojiPanelState: {controller?: EmojiPanelController} = {};
    const clearPastedCustomIcon = () => {
        pastedCustomIconFile = undefined;
        if (pastedCustomIconObjectURL) {
            URL.revokeObjectURL(pastedCustomIconObjectURL);
            pastedCustomIconObjectURL = "";
        }
    };

    const dialog = new Dialog({
        disableAnimation: true,
        transparent: true,
        hideCloseIcon: true,
        width: isMobile() ? "80vw" : "368px",
        height: "50vh",
        destroyCallback: () => {
            clearPastedCustomIcon();
            emojiPanelState.controller?.destroy();
        },
        content: `<div class="emojis">
    <div class="emojis__tabheader">
        <div data-type="tab-emoji" class="ariaLabel block__icon block__icon--show" aria-label="${window.siyuan.languages.emoji}"><svg><use xlink:href="#iconEmoji"></use></svg></div>
        <div class="fn__space"></div>
        <div data-type="tab-custom" class="ariaLabel block__icon block__icon--show${options?.custom ? " fn__none" : ""}" aria-label="${escapeAttr(escapeHtml(customEmojiLabel))}"><svg><use xlink:href="#iconStar"></use></svg></div>
        <div class="fn__space"></div>
        <div data-type="tab-dynamic" class="ariaLabel block__icon block__icon--show${options?.dynamic ? " fn__none" : ""}" aria-label="${window.siyuan.languages.dynamicIcon}"><svg><use xlink:href="#iconCalendar"></use></svg></div>
        <div class="fn__space${type === "av" ? " fn__none" : ""}"></div>
        <div data-type="tab-link" class="ariaLabel block__icon block__icon--show${type === "av" ? " fn__none" : ""}" aria-label="${window.siyuan.languages.upload} ${window.siyuan.languages.image}"><svg><use xlink:href="#iconUpload"></use></svg></div>
        <div class="fn__flex-1"></div>
        <span class="block__icon block__icon--show fn__flex-center ariaLabel" data-action="remove" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
    </div>
    <div class="emojis__tabbody">
        <div class="fn__none" data-type="tab-emoji">
            <div class="fn__hr"></div>
            <div class="fn__flex">
                <span class="fn__space"></span>
                <label class="b3-form__icon fn__flex-1" style="overflow:initial;">
                    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                    <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.searchPlaceholder}">
                </label>
                <span class="fn__space"></span>
                <span class="block__icon block__icon--show fn__flex-center ariaLabel" data-action="random" aria-label="${window.siyuan.languages.random}"><svg><use xlink:href="#iconDices"></use></svg></span>
                <span class="fn__space"></span>
            </div>
            <div class="fn__hr"></div>
            <div class="emojis__panel"></div>
            <div class="emojis__types">${genEmojiCategoryButtons(true)}</div>
        </div>
        <div class="fn__none" data-type="tab-dynamic">
            <div class="fn__flex emoji__dynamic-color">
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#d23f31" ? " color__square--current" : ""}" style="background-color:#d23f31"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#3575f0" ? " color__square--current" : ""}" style="background-color:#3575f0"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#f3a92f" ? " color__square--current" : ""}" style="background-color:#f3a92f"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#65b84d" ? " color__square--current" : ""}" style="background-color:#65b84d"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#e099ff" ? " color__square--current" : ""}" style="background-color:#e099ff"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#ea5d97" ? " color__square--current" : ""}" style="background-color:#ea5d97"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#93627f" ? " color__square--current" : ""}" style="background-color:#93627f"></div>
                <div class="color__square fn__pointer${dynamicCurrentObj.color === "#5f6368" ? " color__square--current" : ""}" style="background-color:#5f6368"></div>
                <div class="fn__space--small"></div>
                <input type="text" class="b3-text-field fn__flex-1 fn__flex-center" value="${dynamicCurrentObj.color}">
            </div>
            <div class="fn__flex">
                <span class="fn__space"></span>
                <span class="fn__flex-center ft__on-surface" style="width: 89px">${window.siyuan.languages.language}</span>
                <span class="fn__space--small"></span>
                <select class="b3-select fn__flex-1">
                    <option value="" ${dynamicCurrentObj.lang === "" ? " selected" : ""}>${window.siyuan.languages.themeOS}</option>
                    <option value="en" ${dynamicCurrentObj.lang === "en" ? " selected" : ""}>English (en)</option>
                    <option value="zh-TW" ${dynamicCurrentObj.lang === "zh-TW" ? " selected" : ""}>繁體中文 (zh-TW)</option>
                    <option value="zh-CN" ${dynamicCurrentObj.lang === "zh-CN" ? " selected" : ""}>简体中文 (zh-CN)</option>
                </select>
                <span class="fn__space"></span>
            </div>
            <div class="fn__hr"></div>
            <div class="fn__flex">
                <span class="fn__space"></span>
                <span class="fn__flex-center ft__on-surface" style="width: 89px">${window.siyuan.languages.date}</span>
                <span class="fn__space--small"></span>
                <input type="date" max="9999-12-31" class="b3-text-field fn__flex-1" value="${dynamicCurrentObj.date}"/>
                <span class="fn__space--small"></span>
                <span data-action="clearDate" class="ariaLabel block__icon block__icon--show" aria-label="${window.siyuan.languages.dynamicIconDateEmptyInfo}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
                <span class="fn__space"></span>
            </div>
            <div class="fn__hr"></div>
            <div class="fn__flex">
                <span class="fn__space"></span>
                <span class="fn__flex-center ft__on-surface" style="width: 89px">${window.siyuan.languages.format}</span>
                <span class="fn__space--small"></span>
                <select class="b3-select fn__flex-1">
                    ${genWeekdayOptions(dynamicCurrentObj.lang, dynamicCurrentObj.weekdayType)}
                </select>
                <span class="fn__space"></span>
            </div>
            <div class="fn__flex fn__flex-wrap">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "1" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=1&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "2" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=2&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "3" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=3&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "4" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=4&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "5" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=5&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "6" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=6&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
                <img class="emoji__dynamic-item${dynamicCurrentObj.type === "7" ? " emoji__dynamic-item--current" : ""}" src="${dynamicURL}type=7&color=${encodeURIComponent(dynamicCurrentObj.color)}&date=${dynamicCurrentObj.date}&weekdayType=${dynamicCurrentObj.weekdayType}&lang=${dynamicCurrentObj.lang}">
            </div>
            <div class="fn__hr"></div>
            <div class="fn__flex">
                <span class="fn__space"></span>
                <span class="fn__flex-center ft__on-surface" style="width: 89px">${window.siyuan.languages.custom}</span>
                <span class="fn__space--small"></span>
                <input type="text" class="b3-text-field fn__flex-1" value="">
                <span class="fn__space"></span>
            </div>
            <div>
                <img data-type="text" class="emoji__dynamic-item${dynamicCurrentObj.type === "8" ? " emoji__dynamic-item--current" : ""}" src="${escapeAttr(escapeHtml(dynamicTextURL))}">
            </div>
        </div>
        <div class="fn__none emojis__link" data-type="tab-link" tabindex="0">
            <input class="fn__none" data-type="custom-icon-file" type="file" accept="image/*">
            <div class="emojis__link-empty">
                <div class="emojis__link-empty-content">
                    <button class="emojis__link-upload" data-action="select-custom-icon">
                        <svg><use xlink:href="#iconImage"></use></svg>
                        <span>${window.siyuan.languages.upload} ${window.siyuan.languages.image}</span>
                    </button>
                    <button class="b3-button b3-button--cancel emojis__link-source" data-action="input-custom-icon">
                        ${window.siyuan.languages.use} URL / Base64
                    </button>
                    ${isMobile() ? "" : `<div class="emojis__link-tip ft__on-surface">${updateHotkeyTip("⌘V")} · ${window.siyuan.languages.image} / URL / Base64</div>`}
                </div>
                <div class="emojis__link-footer">
                    <button class="b3-button b3-button--cancel" data-action="cancel-custom-icon">${window.siyuan.languages.cancel}</button>
                    <button class="b3-button b3-button--text" disabled>${window.siyuan.languages.save}</button>
                </div>
            </div>
            <div class="fn__none emojis__link-input">
                <label class="emojis__link-value">
                    <span class="b3-label__text">URL / Base64</span>
                    <textarea class="b3-text-field fn__block" data-type="network-icon-url"
                              placeholder="https://... / data:image/..."></textarea>
                </label>
                <div class="emojis__link-footer">
                    <button class="b3-button b3-button--cancel" data-action="back-custom-icon">${window.siyuan.languages.returnLabel}</button>
                    <button class="b3-button b3-button--text" data-action="confirm-custom-icon" disabled>${window.siyuan.languages.confirm}</button>
                </div>
            </div>
            <div class="fn__none emojis__link-detail">
                <div class="emojis__link-preview">
                    <div class="emojis__link-samples">
                        <div class="emojis__link-sample emojis__link-sample--light"></div>
                        <div class="emojis__link-sample emojis__link-sample--dark"></div>
                    </div>
                </div>
                <label class="emojis__link-name">
                    <span class="b3-label__text">${window.siyuan.languages.fileName}</span>
                    <input class="b3-text-field fn__block" data-type="custom-icon-name" placeholder="path/to/icon">
                </label>
                <div class="fn__none emojis__link-footer emojis__link-footer--choice">
                    <button class="b3-button b3-button--cancel emojis__link-choice-back" data-action="back-custom-icon">${window.siyuan.languages.returnLabel}</button>
                    <button class="b3-button b3-button--cancel" data-action="use-network-icon">${window.siyuan.languages.use} URL</button>
                    <button class="b3-button b3-button--text" data-action="localize-network-icon">${window.siyuan.languages.netImg2LocalAsset}</button>
                </div>
                <div class="emojis__link-footer emojis__link-footer--save">
                    <button class="b3-button b3-button--cancel" data-action="back-custom-icon">${window.siyuan.languages.returnLabel}</button>
                    <button class="b3-button b3-button--text" data-action="set-network-icon" disabled>${window.siyuan.languages.save}</button>
                </div>
            </div>
        </div>
    </div>
</div>`
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_EMOJIS);
    const popoverOID = popoverElement?.dataset.oid;
    const popoverLevel = popoverElement?.dataset.level;
    if (popoverOID && popoverLevel) {
        dialog.element.dataset.popoverOid = popoverOID;
        dialog.element.dataset.popoverLevel = popoverLevel;
    }
    dialog.element.querySelector(".b3-dialog__container").setAttribute("data-menu", "true");
    const dialogElement = dialog.element.querySelector(".b3-dialog") as HTMLElement;
    dialogElement.style.justifyContent = "inherit";
    dialogElement.style.alignItems = "inherit";
    let currentTab = window.siyuan.storage[Constants.LOCAL_EMOJIS].currentTab;
    const currentTabElement = dialog.element.querySelector(`[data-type="tab-${currentTab}"]`);
    if (!currentTabElement || currentTabElement.classList.contains("fn__none")) {
        currentTab = "emoji";
    }
    let customEmojiPage = currentTab === "custom";
    const currentBodyTab = customEmojiPage ? "emoji" : currentTab;
    dialog.element.querySelector(`.emojis__tabheader [data-type="tab-${currentTab}"]`).classList.add("block__icon--active");
    dialog.element.querySelector(`.emojis__tabbody [data-type="tab-${currentBodyTab}"]`).classList.remove("fn__none");
    setPosition(dialog.element.querySelector(".b3-dialog__container"), position.x, position.y, position.h, position.w);
    const networkIconInputElement = dialog.element.querySelector('[data-type="network-icon-url"]') as HTMLTextAreaElement;
    const customIconFileElement = dialog.element.querySelector('[data-type="custom-icon-file"]') as HTMLInputElement;
    const customIconNameElement = dialog.element.querySelector('[data-type="custom-icon-name"]') as HTMLInputElement;
    const customIconNameLabelElement = customIconNameElement.parentElement;
    const linkIconElement = dialog.element.querySelector('[data-type="tab-link"].emojis__link') as HTMLElement;
    const linkIconEmptyElement = dialog.element.querySelector(".emojis__link-empty");
    const linkIconInputElement = dialog.element.querySelector(".emojis__link-input");
    const linkIconDetailElement = dialog.element.querySelector(".emojis__link-detail");
    const linkIconSampleElements = dialog.element.querySelectorAll(".emojis__link-sample");
    const linkIconConfirmElement = dialog.element.querySelector('[data-action="confirm-custom-icon"]') as HTMLButtonElement;
    const linkIconChoiceFooterElement = dialog.element.querySelector(".emojis__link-footer--choice");
    const linkIconSaveFooterElement = dialog.element.querySelector(".emojis__link-footer--save");
    const linkIconSaveElement = dialog.element.querySelector('[data-action="set-network-icon"]') as HTMLButtonElement;
    let localizeNetworkIcon = false;
    networkIconInputElement.value = normalizeNetworkIconURL(dynamicImgElement?.getAttribute("src") || "") || "";
    const showLinkIconView = (view: "empty" | "input" | "detail") => {
        linkIconEmptyElement.classList.toggle("fn__none", view !== "empty");
        linkIconInputElement.classList.toggle("fn__none", view !== "input");
        linkIconDetailElement.classList.toggle("fn__none", view !== "detail");
    };
    const updateLinkIconInput = () => {
        linkIconConfirmElement.disabled = !normalizeNetworkIconURL(networkIconInputElement.value) &&
            !parseBase64Image(networkIconInputElement.value);
    };
    const renderNetworkIconPreview = () => {
        const networkURL = normalizeNetworkIconURL(networkIconInputElement.value);
        const base64Image = parseBase64Image(networkIconInputElement.value);
        const previewSource = pastedCustomIconObjectURL ||
            (base64Image ? networkIconInputElement.value.trim() : networkURL);
        const hasIcon = !!previewSource;
        const chooseNetworkIcon = !!networkURL && !localizeNetworkIcon;
        const localIcon = hasIcon && !chooseNetworkIcon;
        showLinkIconView(hasIcon ? "detail" : "empty");
        linkIconChoiceFooterElement.classList.toggle("fn__none", !chooseNetworkIcon);
        linkIconSaveFooterElement.classList.toggle("fn__none", chooseNetworkIcon);
        customIconNameLabelElement.classList.toggle("fn__none", !localIcon);
        linkIconSaveElement.disabled = !hasIcon || (localIcon && !customIconNameElement.value.trim());
        linkIconSampleElements.forEach(item => {
            item.innerHTML = "";
            if (!previewSource) {
                return;
            }
            const imageElement = document.createElement("img");
            imageElement.src = previewSource;
            if (networkURL) {
                imageElement.referrerPolicy = "no-referrer";
            }
            item.append(imageElement);
        });
    };
    const resetLinkIcon = () => {
        clearPastedCustomIcon();
        networkIconInputElement.value = "";
        customIconFileElement.value = "";
        customIconNameElement.value = "";
        localizeNetworkIcon = false;
        updateLinkIconInput();
        renderNetworkIconPreview();
        linkIconElement.focus();
    };
    const inputLinkIcon = () => {
        clearPastedCustomIcon();
        networkIconInputElement.value = "";
        customIconFileElement.value = "";
        customIconNameElement.value = "";
        localizeNetworkIcon = false;
        updateLinkIconInput();
        showLinkIconView("input");
        networkIconInputElement.focus();
    };
    const confirmLinkIcon = () => {
        if (linkIconConfirmElement.disabled) {
            showMessage(window.siyuan.languages.invalid);
            return;
        }
        clearPastedCustomIcon();
        customIconNameElement.value = "";
        localizeNetworkIcon = false;
        renderNetworkIconPreview();
        if (!normalizeNetworkIconURL(networkIconInputElement.value)) {
            customIconNameElement.focus();
        }
    };
    const setCustomIconFile = (file: File) => {
        clearPastedCustomIcon();
        pastedCustomIconFile = file;
        pastedCustomIconObjectURL = URL.createObjectURL(file);
        networkIconInputElement.value = "";
        customIconNameElement.value = file.name;
        localizeNetworkIcon = false;
        renderNetworkIconPreview();
        customIconNameElement.focus();
    };
    const applyLinkIcon = (unicode: string) => {
        if (type === "notebook") {
            fetchPost("/api/notebook/setNotebookIcon", {
                notebook: id,
                icon: unicode
            }, () => {
                updateFileTreeEmoji(unicode, id, "iconNewNoteBook");
            });
        } else if (type === "doc") {
            fetchPost("/api/attr/setBlockAttrs", {
                id,
                attrs: {"icon": unicode}
            }, () => {
                updateFileTreeEmoji(unicode, id);
                updateOutlineEmoji(unicode, id);
            });
        }
        if (callback) {
            callback(unicode);
        }
        addEmoji(unicode);
        dialog.destroy();
    };
    const useNetworkIcon = () => {
        const networkURL = normalizeNetworkIconURL(networkIconInputElement.value);
        if (networkURL) {
            applyLinkIcon(networkURL);
        }
    };
    const localizeNetworkIconFile = () => {
        localizeNetworkIcon = true;
        customIconNameElement.value = getNetworkIconName(networkIconInputElement.value);
        renderNetworkIconPreview();
        customIconNameElement.focus();
    };
    const backLinkIcon = () => {
        if (normalizeNetworkIconURL(networkIconInputElement.value) && localizeNetworkIcon) {
            localizeNetworkIcon = false;
            customIconNameElement.value = "";
            renderNetworkIconPreview();
            return;
        }
        resetLinkIcon();
    };
    const setNetworkIcon = () => {
        const networkURL = normalizeNetworkIconURL(networkIconInputElement.value);
        let customIconFile = pastedCustomIconFile;
        if (!networkURL && !customIconFile) {
            const base64Image = parseBase64Image(networkIconInputElement.value);
            if (base64Image) {
                customIconFile = new File(
                    [base64Image.bytes],
                    `icon.${base64Image.extension}`,
                    {type: base64Image.mimeType},
                );
            }
        }
        if (!networkURL && !customIconFile) {
            showMessage(window.siyuan.languages.invalid);
            return;
        }
        if (!customIconNameElement.value.trim()) {
            showMessage(window.siyuan.languages.nameEmpty);
            customIconNameElement.focus();
            return;
        }

        const formData = new FormData();
        formData.append("name", customIconNameElement.value);
        if (networkURL) {
            formData.append("url", networkURL);
        } else {
            formData.append("file", customIconFile);
        }
        fetchPost("/api/system/addCustomEmoji", formData, (response) => {
            if (typeof response?.data?.path !== "string") {
                showMessage(window.siyuan.languages.kernelFault8);
                return;
            }
            reloadEmoji();
            applyLinkIcon(response.data.path);
        });
    };
    customIconFileElement.addEventListener("change", () => {
        const imageFile = Array.from(customIconFileElement.files || []).find(item => item.type.startsWith("image/"));
        if (imageFile) {
            setCustomIconFile(imageFile);
        }
    });
    linkIconElement.addEventListener("paste", (event: ClipboardEvent) => {
        const clipboardItems = Array.from(event.clipboardData?.items || []);
        const imageItem = clipboardItems.find(item => item.kind === "file" && item.type.startsWith("image/"));
        const imageFile = imageItem?.getAsFile() ||
            Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith("image/"));
        if (imageFile) {
            event.preventDefault();
            setCustomIconFile(imageFile);
            return;
        }

        if (event.target === customIconNameElement || event.target === networkIconInputElement) {
            return;
        }
        const text = event.clipboardData?.getData("text/plain").trim() || "";
        if (!normalizeNetworkIconURL(text) && !parseBase64Image(text)) {
            showMessage(window.siyuan.languages.invalid);
            return;
        }

        event.preventDefault();
        clearPastedCustomIcon();
        networkIconInputElement.value = text;
        customIconNameElement.value = "";
        localizeNetworkIcon = false;
        renderNetworkIconPreview();
        if (parseBase64Image(text)) {
            customIconNameElement.focus();
        }
    });
    networkIconInputElement.addEventListener("input", updateLinkIconInput);
    customIconNameElement.addEventListener("input", renderNetworkIconPreview);
    customIconNameElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (!event.isComposing && event.key === "Enter" && !linkIconSaveElement.disabled) {
            setNetworkIcon();
            event.preventDefault();
            event.stopPropagation();
        }
    });
    renderNetworkIconPreview();
    const emojiSearchInputElement = dialog.element.querySelector('[data-type="tab-emoji"] .b3-text-field') as HTMLInputElement;
    const emojisContentElement = dialog.element.querySelector(".emojis__panel") as HTMLElement;
    const emojiPanelController = new EmojiPanelController(
        emojisContentElement,
        emojisContentElement.nextElementSibling as HTMLElement,
        {
            targetID,
            hideDynamic: options?.dynamic,
            hideCustom: options?.custom,
        },
    );
    emojiPanelState.controller = emojiPanelController;
    const renderEmojiSearch = () => emojiPanelController.renderSearch(emojiSearchInputElement.value);
    emojiSearchInputElement.addEventListener("compositionend", renderEmojiSearch);
    emojiSearchInputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        renderEmojiSearch();
    });
    emojiSearchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key.indexOf("Arrow") === -1 && event.key !== "Enter") {
            return;
        }
        const currentElement = emojiPanelController.getCurrentElement();
        if (!currentElement) {
            return;
        }
        if (event.key === "Enter") {
            applyLinkIcon(currentElement.getAttribute("data-unicode"));
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        emojiPanelController.moveSelection(event.key);
        event.preventDefault();
        event.stopPropagation();
    });
    if (customEmojiPage) {
        emojiPanelController.renderCategory("custom");
        emojiPanelController.activate();
    } else if (currentTab === "emoji") {
        emojiPanelController.activate();
    }
    if (!isMobile() && (currentTab === "emoji" || customEmojiPage)) {
        emojiSearchInputElement.focus();
    } else if (!isMobile() && currentTab === "link") {
        linkIconElement.focus();
    }
    // 不能使用 getEventName 否则 https://github.com/siyuan-note/siyuan/issues/5472
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && target !== dialog.element) {
            if (target.classList.contains("emojis__type")) {
                customEmojiPage = false;
                dialogElement.querySelector('[data-type="tab-custom"]')?.classList.remove("block__icon--active");
                dialogElement.querySelector('[data-type="tab-emoji"]')?.classList.add("block__icon--active");
                window.siyuan.storage[Constants.LOCAL_EMOJIS].currentTab = "emoji";
                setStorageVal(Constants.LOCAL_EMOJIS, window.siyuan.storage[Constants.LOCAL_EMOJIS]);
                emojiPanelController.renderCategory(target.dataset.type);
                break;
            } else if (target.getAttribute("data-action") === "select-custom-icon") {
                customIconFileElement.value = "";
                customIconFileElement.click();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "input-custom-icon") {
                inputLinkIcon();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "confirm-custom-icon") {
                confirmLinkIcon();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "use-network-icon") {
                useNetworkIcon();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "localize-network-icon") {
                localizeNetworkIconFile();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "back-custom-icon") {
                backLinkIcon();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "cancel-custom-icon") {
                dialog.destroy();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "set-network-icon") {
                setNetworkIcon();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-action") === "remove") {
                if (type === "notebook") {
                    fetchPost("/api/notebook/setNotebookIcon", {
                        notebook: id,
                        icon: ""
                    }, () => {
                        updateFileTreeEmoji("", id, "iconNewNoteBook");
                    });
                } else if (type === "doc") {
                    fetchPost("/api/attr/setBlockAttrs", {
                        id: id,
                        attrs: {"icon": ""}
                    }, () => {
                        updateFileTreeEmoji("", id);
                        updateOutlineEmoji("", id);
                    });
                }
                if (callback) {
                    callback("");
                }
                dialog.destroy();
                break;
            } else if (target.classList.contains("emojis__item") || target.getAttribute("data-action") === "random" || target.classList.contains("emoji__dynamic-item")) {
                let unicode = "";
                if (target.classList.contains("emojis__item")) {
                    unicode = target.getAttribute("data-unicode");
                    dialog.destroy();
                } else if (target.classList.contains("emoji__dynamic-item")) {
                    unicode = target.getAttribute("src");
                    dialog.destroy();
                } else {
                    // 随机
                    unicode = getRandomEmoji(customEmojiPage ? "custom" : "builtIn");
                    if (!unicode) {
                        break;
                    }
                }
                if (type === "notebook") {
                    fetchPost("/api/notebook/setNotebookIcon", {
                        notebook: id,
                        icon: unicode
                    }, () => {
                        updateFileTreeEmoji(unicode, id, "iconNewNoteBook");
                    });
                } else if (type === "doc") {
                    fetchPost("/api/attr/setBlockAttrs", {
                        id,
                        attrs: {"icon": unicode}
                    }, () => {
                        updateFileTreeEmoji(unicode, id);
                        updateOutlineEmoji(unicode, id);
                    });
                }
                if (callback) {
                    callback(unicode);
                }
                addEmoji(unicode);
                break;
            } else if (target.matches(".emojis__tabheader > [data-type^='tab-']")) {
                dialogElement.querySelectorAll('.emojis__tabheader [data-type|="tab"]').forEach((item: HTMLElement) => {
                    if (item.dataset.type === target.dataset.type) {
                        item.classList.add("block__icon--active");
                    } else {
                        item.classList.remove("block__icon--active");
                    }
                });
                const bodyType = target.dataset.type === "tab-custom" ? "tab-emoji" : target.dataset.type;
                dialogElement.querySelectorAll(".emojis__tabbody > div").forEach((item: HTMLElement) => {
                    if (item.dataset.type === bodyType) {
                        item.classList.remove("fn__none");
                    } else {
                        item.classList.add("fn__none");
                    }
                });
                window.siyuan.storage[Constants.LOCAL_EMOJIS].currentTab = target.dataset.type.replace("tab-", "");
                setStorageVal(Constants.LOCAL_EMOJIS, window.siyuan.storage[Constants.LOCAL_EMOJIS]);
                if (target.dataset.type === "tab-custom") {
                    customEmojiPage = true;
                    emojiSearchInputElement.value = "";
                    emojiPanelController.renderCategory("custom");
                    emojiPanelController.activate();
                    if (!isMobile()) {
                        emojiSearchInputElement.focus();
                    }
                } else if (target.dataset.type === "tab-emoji") {
                    if (customEmojiPage) {
                        customEmojiPage = false;
                        emojiSearchInputElement.value = "";
                        emojiPanelController.renderInitial();
                    }
                    emojiPanelController.activate();
                    if (!isMobile()) {
                        emojiSearchInputElement.focus();
                    }
                } else {
                    emojiPanelController.deactivate();
                }
                if (target.dataset.type === "tab-link" && !isMobile()) {
                    linkIconElement.focus();
                }
                break;
            } else if (target.classList.contains("color__square")) {
                dynamicTextElements[0].value = target.getAttribute("style").replace("background-color:", "");
                dynamicTextElements[0].dispatchEvent(new CustomEvent("input"));
                break;
            } else if ("clearDate" === target.dataset.action) {
                dynamicDateElement.value = "";
                dynamicDateElement.dispatchEvent(new CustomEvent("change"));
                break;
            }
            target = target.parentElement;
        }
    });
    const dynamicLangElements: NodeListOf<HTMLSelectElement> = dialog.element.querySelectorAll('[data-type="tab-dynamic"] .b3-select');
    dynamicLangElements[0].addEventListener("change", () => {
        dialog.element.querySelectorAll(".fn__flex-wrap .emoji__dynamic-item").forEach(item => {
            const url = new URLSearchParams(item.getAttribute("src").replace(dynamicURL, ""));
            if (dynamicLangElements[0].value) {
                url.set("lang", dynamicLangElements[0].value);
            } else {
                url.delete("lang");
            }
            item.setAttribute("src", dynamicURL + url.toString());
            dynamicLangElements[1].innerHTML = genWeekdayOptions(dynamicLangElements[0].value, dynamicLangElements[1].value);
        });
    });
    dynamicLangElements[1].addEventListener("change", () => {
        dialog.element.querySelectorAll(".fn__flex-wrap .emoji__dynamic-item").forEach(item => {
            const url = new URLSearchParams(item.getAttribute("src").replace(dynamicURL, ""));
            url.set("weekdayType", dynamicLangElements[1].value);
            item.setAttribute("src", dynamicURL + url.toString());
        });
    });
    const dynamicDateElement = dialog.element.querySelector('[data-type="tab-dynamic"] [type="date"]') as HTMLInputElement;
    dynamicDateElement.addEventListener("change", () => {
        dialog.element.querySelectorAll(".fn__flex-wrap .emoji__dynamic-item").forEach(item => {
            const url = new URLSearchParams(item.getAttribute("src").replace(dynamicURL, ""));
            url.set("date", dynamicDateElement.value ? dayjs(dynamicDateElement.value).format("YYYY-MM-DD") : "");
            item.setAttribute("src", dynamicURL + url.toString());
        });
    });
    const dynamicTextElements: NodeListOf<HTMLInputElement> = dialog.element.querySelectorAll('[data-type="tab-dynamic"] [type="text"]');
    const dynamicTextImgElement = dialog.element.querySelector('.emoji__dynamic-item[data-type="text"]');
    dynamicTextElements[0].addEventListener("input", () => {
        if (!dynamicTextElements[0].value.startsWith("#")) {
            return;
        }
        dialog.element.querySelectorAll(".emoji__dynamic-item").forEach(item => {
            const url = new URLSearchParams(item.getAttribute("src").replace(dynamicURL, ""));
            url.set("color", dynamicTextElements[0].value);
            item.setAttribute("src", dynamicURL + url.toString());
        });
        dialog.element.querySelectorAll(".color__square").forEach((item: HTMLElement) => {
            if (item.style.backgroundColor === dynamicTextElements[0].value) {
                item.classList.add("color__square--current");
            } else {
                item.classList.remove("color__square--current");
            }
        });
    });
    dynamicTextElements[1].value = dynamicCurrentObj.content;
    dynamicTextElements[1].addEventListener("input", () => {
        const url = new URLSearchParams(dynamicTextImgElement.getAttribute("src").replace(dynamicURL, ""));
        url.set("content", dynamicTextElements[1].value);
        dynamicTextImgElement.setAttribute("src", dynamicURL + url.toString());
    });
};

export const updateOutlineEmoji = (unicode: string, id: string) => {
    /// #if !MOBILE
    getAllModels().outline.forEach(model => {
        if (model.blockId === id) {
            model.headerElement.nextElementSibling.firstElementChild.outerHTML = unicode2Emoji(unicode || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true);
        }
    });
    /// #endif
};

export const updateFileTreeEmoji = (unicode: string, id: string, icon = "iconFile") => {
    const notebook = window.siyuan.notebooks.find((item) => item.id === id);
    const isNotebookIcon = icon !== "iconFile" || !!notebook;
    if (isNotebookIcon) {
        if (notebook?.icon === unicode) {
            return;
        }
        if (notebook) {
            notebook.icon = unicode;
            if (notebook.encrypted && notebook.closed) {
                return;
            }
        }
    }
    let emojiElement;
    /// #if MOBILE
    if (!isNotebookIcon) {
        emojiElement = document.querySelector(
            `#sidebar [data-type="sidebar-file"] [data-node-id="${id}"] .b3-list-item__icon`
        );
    } else {
        emojiElement = document.querySelector(
            `#sidebar [data-type="sidebar-file"] ul[data-url="${id}"] > li[data-type="navigation-root"] .b3-list-item__icon`
        ) || document.querySelector(
            `#sidebar [data-type="sidebar-file"] li[data-url="${id}"] .b3-list-item__icon`
        );
    }
    /// #else
    const dockFile = getDockByType("file");
    if (dockFile) {
        const files = dockFile.data.file as Files;
        if (!isNotebookIcon) {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`);
        } else {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`) || files.element.querySelector(`[data-url="${id}"] .b3-list-item__icon`) || files.closeElement.querySelector(`[data-url="${id}"] .b3-list-item__icon`);
        }
    }
    /// #endif
    if (emojiElement) {
        emojiElement.innerHTML = unicode2Emoji(unicode || (!isNotebookIcon ? (emojiElement.previousElementSibling.classList.contains("fn__hidden") ? window.siyuan.storage[Constants.LOCAL_IMAGES].file : window.siyuan.storage[Constants.LOCAL_IMAGES].folder) : window.siyuan.storage[Constants.LOCAL_IMAGES].note));
    }
};

export const getEmojiDesc = (emoji: IEmojiItem) => {
    if (window.siyuan.config.lang === "zh-CN") {
        return emoji.description_zh_cn;
    }
    if (window.siyuan.config.lang === "ja") {
        return emoji.description_ja_jp;
    }
    return emoji.description;
};

export const getEmojiTitle = (index: number) => {
    if (window.siyuan.config.lang === "zh-CN") {
        return window.siyuan.emojis[index].title_zh_cn;
    }
    if (window.siyuan.config.lang === "ja") {
        return window.siyuan.emojis[index].title_ja_jp;
    }
    return window.siyuan.emojis[index].title;
};

const putEmojis = (protyle: IProtyle) => {
    const lute = getLuteInstance();
    if (lute && window.siyuan.emojis[0].items.length > 0) {
        const emojis: IObject = {};
        window.siyuan.emojis[0].items.forEach(emojiITem => {
            emojis[emojiITem.keywords] = protyle.options.hint.emojiPath + "/" + emojiITem.unicode;
        });
        // Lute 已为所有编辑器共享单例，PutEmojis 只需调用一次
        lute.PutEmojis(emojis);
    }
};

export const reloadEmoji = () => {
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];
        const editors = getAllEditor();
        if (editors.length > 0) {
            putEmojis(editors[0].protyle);
        }
    });
};
