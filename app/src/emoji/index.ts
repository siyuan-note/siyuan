import {getRandom, isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
/// #if !MOBILE
import {Files} from "../layout/dock/Files";
import {getDockByType} from "../layout/tabUtil";
/// #endif
import {getAllEditor, getAllModels} from "../layout/getAll";
import {setNoteBook} from "../util/pathName";
import {Dialog} from "../dialog";
import {setPosition} from "../util/setPosition";
import {setStorageVal} from "../protyle/util/compatibility";
import {getLuteInstance} from "../protyle/render/setLute";
import * as dayjs from "dayjs";
import {
    bindDynamicIconTarget,
    genEmojiImageHTML,
    getIconSearchText,
    getIconValueKind,
    normalizeNetworkIconURL,
    normalizeRecentIconValue,
    updateRecentIconValues,
} from "./iconValue";
import {showMessage} from "../dialog/message";
import {escapeAttr, escapeHtml} from "../util/escape";

export const getRandomEmoji = () => {
    const emojis = window.siyuan.emojis[getRandom(0, window.siyuan.emojis.length - 1)];
    if (typeof emojis.items[getRandom(0, emojis.items.length - 1)] === "undefined") {
        return "1f600";
    }
    return emojis.items[getRandom(0, emojis.items.length - 1)].unicode;
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
            if (needSpan) {
                emoji = `<span class="${className}">${emoji}</span>`;
            }
        } catch (e) {
            // 自定义表情搜索报错 https://github.com/siyuan-note/siyuan/issues/5883
            // 这里忽略错误不做处理
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

export const lazyLoadEmoji = (element: HTMLElement) => {
    const emojiIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entrie: IntersectionObserverEntry & { target: HTMLImageElement }) => {
            const index = entrie.target.getAttribute("data-index");
            if ((typeof entrie.isIntersecting === "undefined" ? entrie.intersectionRatio !== 0 : entrie.isIntersecting) && index) {
                let html = "";
                window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                    html += genEmojiButton(emoji.unicode, getEmojiDesc(emoji));
                });
                entrie.target.innerHTML = html;
                entrie.target.removeAttribute("data-index");
                entrie.target.style.minHeight = "";
            }
        });
    });
    element.querySelectorAll(".emojis__content").forEach((panelElement) => {
        emojiIntersectionObserver.observe(panelElement);
    });
};

export const lazyLoadEmojiImg = (element: Element) => {
    const emojiIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entrie: IntersectionObserverEntry & { target: HTMLImageElement }) => {
            const src = entrie.target.getAttribute("data-src");
            if ((typeof entrie.isIntersecting === "undefined" ? entrie.intersectionRatio !== 0 : entrie.isIntersecting) && src) {
                entrie.target.src = src;
                entrie.target.removeAttribute("data-src");
            }
        });
    });
    element.querySelectorAll("img").forEach((panelElement) => {
        emojiIntersectionObserver.observe(panelElement);
    });
};

const isEmojiMatched = (emoji: IEmojiItem, key: string) => {
    const lowerKey = key.toLowerCase();
    return unicode2Emoji(emoji.unicode) === key ||
        emoji.keywords.toLowerCase().includes(lowerKey) ||
        emoji.description.toLowerCase().includes(lowerKey) ||
        emoji.description_zh_cn.toLowerCase().includes(lowerKey) ||
        emoji.description_ja_jp.toLowerCase().includes(lowerKey);
};

export const filterEmoji = (key = "", max?: number, hideCustom = false, options?: {
    targetID?: string,
    hideDynamic?: boolean,
}) => {
    let html = "";
    const recentEmojiMap = new Map<string, IEmojiItem>();
    if (key) {
        html = `<div class="emojis__title">${window.siyuan.languages.emoji}</div><div class="emojis__content">`;
    }
    let maxCount = 0;
    let keyHTML = "";
    const customStore: IEmojiItem[] = [];
    window.siyuan.emojis.forEach((category, index) => {
        if (hideCustom && category.id === "custom") {
            return;
        }
        if (!key) {
            html += `<div class="emojis__title" data-type="${index + 1}">${getEmojiTitle(index)}</div><div style="min-height:${index === 0 ? "30px" : "300px"}" class="emojis__content"${index > 1 ? ' data-index="' + index + '"' : ""}>`;
        }
        if (category.items.length === 0 && index === 0 && !key) {
            html += `<div style="margin-left: 4px">${window.siyuan.languages.setEmojiTip}</div>`;
        }

        category.items.forEach(emoji => {
            recentEmojiMap.set(emoji.unicode, emoji);
            if (key) {
                if (max && maxCount > max) {
                    return;
                }
                if (isEmojiMatched(emoji, key)) {
                    if (category.id === "custom") {
                        customStore.push(emoji);
                    } else {
                        keyHTML += genEmojiButton(emoji.unicode, getEmojiDesc(emoji), true);
                    }
                    maxCount++;
                }
            } else if (index < 2) {
                html += genEmojiButton(emoji.unicode, getEmojiDesc(emoji), true);
            }
        });
        if (!key) {
            html += "</div>";
        }
    });
    if (key) {
        customStore.sort((a, b) => {
            const aKeywords = a.keywords.split("/");
            const bKeywords = b.keywords.split("/");
            if (aKeywords[aKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) < bKeywords[bKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase())) {
                return -1;
            }
            return 0;
        }).sort((a, b) => {
            const aKeywords = a.keywords.split("/");
            const bKeywords = b.keywords.split("/");
            if (aKeywords[aKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) === bKeywords[bKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) && aKeywords[aKeywords.length - 1].length < bKeywords[bKeywords.length - 1].length) {
                return -1;
            }
            return 0;
        }).forEach(item => {
            html += genEmojiButton(item.unicode, getEmojiDesc(item), true);
        });
        html = html + keyHTML + "</div>";
    }

    let recentItemsHTML = "";
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
                recentItemsHTML += genEmojiButton(emoji.unicode, getEmojiDesc(emoji), true);
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
        recentItemsHTML += genEmojiButton(displayValue, label, true);
    });
    const recentHTML = recentItemsHTML ?
        `<div class="emojis__title" data-type="0">${window.siyuan.languages.recentEmoji}</div><div class="emojis__content">${recentItemsHTML}</div>` : "";

    if (recentHTML + html === "") {
        return `<div class="emojis__title">${window.siyuan.languages.emptyContent}</div>`;
    }
    return recentHTML + html;
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

const renderEmojiContent = (previousIndex: string, previousContentElement: Element) => {
    if (!previousIndex) {
        return;
    }
    let html = "";
    window.siyuan.emojis[parseInt(previousIndex)].items.forEach(emoji => {
        html += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji)}">${unicode2Emoji(emoji.unicode)}</button>`;
    });
    previousContentElement.innerHTML = html;
    previousContentElement.removeAttribute("data-index");
    previousContentElement.removeAttribute("style");
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

    const dialog = new Dialog({
        disableAnimation: true,
        transparent: true,
        hideCloseIcon: true,
        width: isMobile() ? "80vw" : "368px",
        height: "50vh",
        content: `<div class="emojis">
    <div class="emojis__tabheader">
        <div data-type="tab-emoji" class="ariaLabel block__icon block__icon--show" aria-label="${window.siyuan.languages.emoji}"><svg><use xlink:href="#iconEmoji"></use></svg></div>
        <div class="fn__space"></div>
        <div data-type="tab-dynamic" class="ariaLabel block__icon block__icon--show${options?.dynamic ? " fn__none" : ""}" aria-label="${window.siyuan.languages.dynamicIcon}"><svg><use xlink:href="#iconCalendar"></use></svg></div>
        <div class="fn__space${type === "av" ? " fn__none" : ""}"></div>
        <div data-type="tab-link" class="ariaLabel block__icon block__icon--show${type === "av" ? " fn__none" : ""}" aria-label="${window.siyuan.languages.insertImgURL}"><svg><use xlink:href="#iconLink"></use></svg></div>
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
                    <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
                </label>
                <span class="fn__space"></span>
                <span class="block__icon block__icon--show fn__flex-center ariaLabel" data-action="random" aria-label="${window.siyuan.languages.random}"><svg><use xlink:href="#iconRefresh"></use></svg></span>
                <span class="fn__space"></span>
            </div>
            <div class="emojis__panel">${filterEmoji("", null, options?.custom, {
        targetID,
        hideDynamic: options?.dynamic,
    })}</div>
            <div class="fn__flex">
                ${[
            ["2b50", window.siyuan.languages.recentEmoji],
            ["1f527", getEmojiTitle(0)],
            ["1f60d", getEmojiTitle(1)],
            ["1f433", getEmojiTitle(2)],
            ["1f96a", getEmojiTitle(3)],
            ["1f3a8", getEmojiTitle(4)],
            ["1f3dd-fe0f", getEmojiTitle(5)],
            ["1f52e", getEmojiTitle(6)],
            ["267e-fe0f", getEmojiTitle(7)],
            ["1f6a9", getEmojiTitle(8)],
        ].map(([unicode, title], index) => {
            if (options?.custom && index === 1) {
                return "";
            }
            return `<div data-type="${index}" class="emojis__type ariaLabel" aria-label="${title}">${unicode2Emoji(unicode)}</div>`;
        }).join("")}
            </div>
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
        <div class="fn__none emojis__link" data-type="tab-link">
            <input class="b3-text-field fn__block" data-type="network-icon-url" placeholder="${window.siyuan.languages.insertImgURL}">
            <div class="fn__flex emojis__link-action">
                <div class="fn__flex-1"></div>
                <button class="b3-button b3-button--text" data-action="set-network-icon">${window.siyuan.languages.confirm}</button>
            </div>
            <div class="emojis__link-preview"></div>
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
    dialog.element.querySelector(`.emojis__tabheader [data-type="tab-${currentTab}"]`).classList.add("block__icon--active");
    dialog.element.querySelector(`.emojis__tabbody [data-type="tab-${currentTab}"]`).classList.remove("fn__none");
    setPosition(dialog.element.querySelector(".b3-dialog__container"), position.x, position.y, position.h, position.w);
    dialog.element.querySelector(".emojis__item").classList.add("emojis__item--current");
    const networkIconInputElement = dialog.element.querySelector('[data-type="network-icon-url"]') as HTMLInputElement;
    const networkIconPreviewElement = dialog.element.querySelector(".emojis__link-preview");
    networkIconInputElement.value = normalizeNetworkIconURL(dynamicImgElement?.getAttribute("src") || "") || "";
    const renderNetworkIconPreview = () => {
        const networkURL = normalizeNetworkIconURL(networkIconInputElement.value);
        const imageHTML = networkURL ? genEmojiImageHTML(networkURL) : "";
        networkIconPreviewElement.innerHTML = imageHTML ? Lute.Sanitize(imageHTML) : "";
    };
    const setNetworkIcon = () => {
        const unicode = normalizeNetworkIconURL(networkIconInputElement.value);
        if (!unicode) {
            showMessage(window.siyuan.languages.invalid);
            return;
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
        dialog.destroy();
    };
    networkIconInputElement.addEventListener("input", renderNetworkIconPreview);
    networkIconInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        setNetworkIcon();
        event.preventDefault();
        event.stopPropagation();
    });
    renderNetworkIconPreview();
    const emojiSearchInputElement = dialog.element.querySelector('[data-type="tab-emoji"] .b3-text-field') as HTMLInputElement;
    const emojisContentElement = dialog.element.querySelector(".emojis__panel");
    emojiSearchInputElement.addEventListener("compositionend", () => {
        emojisContentElement.innerHTML = filterEmoji(emojiSearchInputElement.value, null, options?.custom, {
            targetID,
            hideDynamic: options?.dynamic,
        });
        if (emojiSearchInputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        dialog.element.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (emojiSearchInputElement.value === "") {
            lazyLoadEmoji(dialog.element);
        }
        lazyLoadEmojiImg(dialog.element);
    });
    emojiSearchInputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        emojisContentElement.innerHTML = filterEmoji(emojiSearchInputElement.value, null, options?.custom, {
            targetID,
            hideDynamic: options?.dynamic,
        });
        if (emojiSearchInputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        dialog.element.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (emojiSearchInputElement.value === "") {
            lazyLoadEmoji(dialog.element);
        }
        lazyLoadEmojiImg(dialog.element);
    });
    emojiSearchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key.indexOf("Arrow") === -1 && event.key !== "Enter") {
            return;
        }
        const currentElement: HTMLElement = dialog.element.querySelector(".emojis__item--current");
        if (!currentElement) {
            return;
        }
        if (event.key === "Enter") {
            const unicode = currentElement.getAttribute("data-unicode");
            if (type === "notebook") {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: unicode
                }, () => {
                    dialog.destroy();
                    updateFileTreeEmoji(unicode, id, "iconNewNoteBook");
                });
            } else if (type === "doc") {
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"icon": unicode}
                }, () => {
                    dialog.destroy();
                    updateFileTreeEmoji(unicode, id);
                    updateOutlineEmoji(unicode, id);
                });
            }
            if (callback) {
                callback(unicode);
            }
            addEmoji(unicode);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let newCurrentElement: HTMLElement;
        if (event.key === "ArrowLeft") {
            if (currentElement.previousElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.previousElementSibling as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            } else if (currentElement.parentElement.previousElementSibling?.previousElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.parentElement.previousElementSibling.previousElementSibling.lastElementChild as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            }
        } else if (event.key === "ArrowRight") {
            if (currentElement.nextElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.nextElementSibling as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            } else if (currentElement.parentElement.nextElementSibling?.nextElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.parentElement.nextElementSibling.nextElementSibling.firstElementChild as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            }
        } else if (event.key === "ArrowDown") {
            if (!currentElement.nextElementSibling) {
                const nextContentElement = currentElement.parentElement.nextElementSibling?.nextElementSibling;
                if (nextContentElement) {
                    newCurrentElement = nextContentElement.firstElementChild as HTMLElement;
                    currentElement.classList.remove("emojis__item--current");
                }
            } else {
                currentElement.classList.remove("emojis__item--current");
                let counter = Math.floor(currentElement.parentElement.clientWidth / (currentElement.clientWidth + 2));
                newCurrentElement = currentElement;
                while (newCurrentElement.nextElementSibling && counter > 0) {
                    newCurrentElement = newCurrentElement.nextElementSibling as HTMLElement;
                    counter--;
                }
            }
            event.preventDefault();
            event.stopPropagation();
        } else if (event.key === "ArrowUp") {
            if (!currentElement.previousElementSibling) {
                const prevContentElement = currentElement.parentElement.previousElementSibling?.previousElementSibling;
                if (prevContentElement) {
                    newCurrentElement = prevContentElement.lastElementChild as HTMLElement;
                    currentElement.classList.remove("emojis__item--current");
                }
            } else {
                currentElement.classList.remove("emojis__item--current");
                let counter = Math.floor(currentElement.parentElement.clientWidth / (currentElement.clientWidth + 2));
                newCurrentElement = currentElement;
                while (newCurrentElement.previousElementSibling && counter > 0) {
                    newCurrentElement = newCurrentElement.previousElementSibling as HTMLElement;
                    counter--;
                }
            }
            event.preventDefault();
            event.stopPropagation();
        }
        if (newCurrentElement) {
            newCurrentElement.classList.add("emojis__item--current");
            const inputHeight = emojiSearchInputElement.clientHeight + 6;
            if (newCurrentElement.offsetTop - inputHeight < emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight - 6;
            } else if (newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight > emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight;
            }
        }
    });
    if (!isMobile() && currentTab === "emoji") {
        emojiSearchInputElement.focus();
    } else if (!isMobile() && currentTab === "link") {
        networkIconInputElement.focus();
    }
    lazyLoadEmoji(dialog.element);
    lazyLoadEmojiImg(dialog.element);
    // 不能使用 getEventName 否则 https://github.com/siyuan-note/siyuan/issues/5472
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && target !== dialog.element) {
            if (target.classList.contains("emojis__type")) {
                const titleElement = emojisContentElement.querySelector(`[data-type="${target.getAttribute("data-type")}"]`) as HTMLElement;
                if (titleElement) {
                    const index = titleElement.nextElementSibling.getAttribute("data-index");
                    if (index) {
                        renderEmojiContent(titleElement.previousElementSibling?.getAttribute("data-index"), titleElement.previousElementSibling);
                        renderEmojiContent(index, titleElement.nextElementSibling);
                    }
                    emojisContentElement.scrollTo({
                        top: titleElement.offsetTop - 77,
                        // behavior: "smooth"  不能使用，否则无法定位
                    });
                }
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
                    unicode = getRandomEmoji();
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
            } else if (target.getAttribute("data-type")?.startsWith("tab-")) {
                dialogElement.querySelectorAll('.emojis__tabheader [data-type|="tab"]').forEach((item: HTMLElement) => {
                    if (item.dataset.type === target.dataset.type) {
                        item.classList.add("block__icon--active");
                    } else {
                        item.classList.remove("block__icon--active");
                    }
                });
                dialogElement.querySelectorAll(".emojis__tabbody > div").forEach((item: HTMLElement) => {
                    if (item.dataset.type === target.dataset.type) {
                        item.classList.remove("fn__none");
                    } else {
                        item.classList.add("fn__none");
                    }
                });
                window.siyuan.storage[Constants.LOCAL_EMOJIS].currentTab = target.dataset.type.replace("tab-", "");
                setStorageVal(Constants.LOCAL_EMOJIS, window.siyuan.storage[Constants.LOCAL_EMOJIS]);
                if (target.dataset.type === "tab-link" && !isMobile()) {
                    networkIconInputElement.focus();
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
    let emojiElement;
    /// #if MOBILE
    emojiElement = document.querySelector(`#sidebar [data-type="sidebar-file"] [data-node-id="${id}"] .b3-list-item__icon`);
    /// #else
    const dockFile = getDockByType("file");
    if (dockFile) {
        const files = dockFile.data.file as Files;
        if (icon === "iconFile") {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`);
        } else {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`) || files.element.querySelector(`[data-url="${id}"] .b3-list-item__icon`) || files.closeElement.querySelector(`[data-url="${id}"] .b3-list-item__icon`);
        }
    }
    /// #endif
    if (emojiElement) {
        emojiElement.innerHTML = unicode2Emoji(unicode || (icon === "iconFile" ? (emojiElement.previousElementSibling.classList.contains("fn__hidden") ? window.siyuan.storage[Constants.LOCAL_IMAGES].file : window.siyuan.storage[Constants.LOCAL_IMAGES].folder) : window.siyuan.storage[Constants.LOCAL_IMAGES].note));
    }
    if (icon !== "iconFile") {
        setNoteBook();
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
