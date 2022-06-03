import {getRandom, isMobile} from "../util/functions";
import {setPosition} from "../util/setPosition";
import {fetchPost} from "../util/fetch";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Constants} from "../constants";
import {getDockByType} from "../layout/util";
import {Files} from "../layout/dock/Files";
import {getAllModels} from "../layout/getAll";
import {getEventName} from "../protyle/util/compatibility";
import {setNoteBook} from "../util/pathName";

export const getRandomEmoji = () => {
    const emojis = window.siyuan.emojis[getRandom(0, window.siyuan.emojis.length - 1)];
    if (typeof emojis.items[getRandom(0, emojis.items.length - 1)] === "undefined") {
        return "1f600";
    }
    return emojis.items[getRandom(0, emojis.items.length - 1)].unicode;
};

export const unicode2Emoji = (unicode: string, assic = false) => {
    if (!unicode) {
        return "";
    }
    let emoji = "";
    if (unicode.indexOf(".") > -1) {
        emoji = `<img src="/emojis/${unicode}"/>`;
    } else if (isMobile() || window.siyuan.config.appearance.nativeEmoji || assic) {
        unicode.split("-").forEach(item => {
            if (item.length < 5) {
                emoji += String.fromCodePoint(parseInt("0" + item, 16));
            } else {
                emoji += String.fromCodePoint(parseInt(item, 16));
            }
        });
    } else {
        emoji = `<svg class="custom-icon"><use xlink:href="#icon-${unicode}"></use></svg>`;
    }
    return emoji;
};

export const lazyLoadEmoji = (element: HTMLElement, assic = false) => {
    const emojiIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entrie: IntersectionObserverEntry & { target: HTMLImageElement }) => {
            const index = entrie.target.getAttribute("data-index");
            if ((typeof entrie.isIntersecting === "undefined" ? entrie.intersectionRatio !== 0 : entrie.isIntersecting) && index) {
                let html = "";
                window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                    html += `<button data-unicode="${emoji.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode, assic)}</button>`;
                });
                entrie.target.innerHTML = html;
                entrie.target.removeAttribute("data-index");
            }
        });
    });
    element.querySelectorAll(".emojis__content").forEach((panelElement) => {
        emojiIntersectionObserver.observe(panelElement);
    });
};

export const filterEmoji = (key = "", max?: number, assic = false) => {
    let html = "";
    const recentEmojis: {
        unicode: string,
        description: string,
        description_zh_cn: string,
        keywords: string
    }[] = [];
    if (key) {
        html = `<div class="emojis__title">${window.siyuan.languages.emoji}</div><div class="emojis__content">`;
    }
    let maxCount = 0;
    let keyHTML = "";
    const customStore: {
        unicode: string,
        description: string,
        description_zh_cn: string,
        keywords: string
    }[] = [];
    window.siyuan.emojis.forEach((category, index) => {
        if (!key) {
            html += `<div class="emojis__title" data-type="${index + 1}">${window.siyuan.config.lang === "zh_CN" ? category.title_zh_cn : category.title}</div><div style="min-height:${index === 0 ? "28px" : "336px"}" class="emojis__content"${index > 1 ? ' data-index="' + index + '"' : ""}>`;
        }
        if (category.items.length === 0 && index === 0 && !key) {
            html += `<div style="margin-left: 4px">${window.siyuan.languages.setEmojiTip}</div>`;
        }

        category.items.forEach(emoji => {
            if (key) {
                if (window.siyuan.config.editor.emoji.includes(emoji.unicode) &&
                    (unicode2Emoji(emoji.unicode, true) === key || emoji.keywords.toLowerCase().indexOf(key.toLowerCase()) > -1 || emoji.description.toLowerCase().indexOf(key.toLowerCase()) > -1 || emoji.description_zh_cn.toLowerCase().indexOf(key.toLowerCase()) > -1)) {
                    recentEmojis.push(emoji);
                }
                if (max && maxCount > max) {
                    return;
                }
                if (unicode2Emoji(emoji.unicode, true) === key || emoji.keywords.toLowerCase().indexOf(key.toLowerCase()) > -1 || emoji.description.toLowerCase().indexOf(key.toLowerCase()) > -1 || emoji.description_zh_cn.toLowerCase().indexOf(key.toLowerCase()) > -1) {
                    if (category.id === "custom") {
                        customStore.push(emoji);
                    } else {
                        keyHTML += `<button data-unicode="${emoji.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode, assic)}</button>`;
                    }
                    maxCount++;
                }
            } else {
                if (window.siyuan.config.editor.emoji.includes(emoji.unicode)) {
                    recentEmojis.push(emoji);
                }
                if (index < 2) {
                    html += `<button data-unicode="${emoji.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode, assic)}</button>`;
                }
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
            html += `<button data-unicode="${item.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? item.description_zh_cn : item.description}">
${unicode2Emoji(item.unicode, assic)}</button>`;
        });
        html = html + keyHTML + "</div>";
    }
    let recentHTML = "";
    if (recentEmojis.length > 0) {
        recentHTML = `<div class="emojis__title" data-type="0">${window.siyuan.languages.recentEmoji}</div><div class="emojis__content">`;
        window.siyuan.config.editor.emoji.forEach(emojiUnicode => {
            const emoji = recentEmojis.filter((item) => item.unicode === emojiUnicode);
            if (emoji[0]) {
                recentHTML += `<button data-unicode="${emoji[0].unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji[0].description_zh_cn : emoji[0].description}">
${unicode2Emoji(emoji[0].unicode, assic)}
</button>`;
            }
        });
        recentHTML += "</div>";
    }

    if (recentHTML + html === "") {
        return `<div class="emojis__title">${window.siyuan.languages.emptyContent}</div>`;
    }
    return recentHTML + html;
};

export const addEmoji = (unicode: string) => {
    window.siyuan.config.editor.emoji.unshift(unicode);
    if (window.siyuan.config.editor.emoji.length > Constants.SIZE_UNDO) {
        window.siyuan.config.editor.emoji.pop();
    }
    window.siyuan.config.editor.emoji = Array.from(new Set(window.siyuan.config.editor.emoji));

    fetchPost("/api/setting/setEmoji", {emoji: window.siyuan.config.editor.emoji});
};

export const openEmojiPanel = (id: string, target: HTMLElement, isNotebook = false) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.innerHTML = `<div class="emojis" style="width: ${isMobile() ? "80vw" : "360px"}">
<div class="fn__flex">
    <span class="fn__space"></span>
    <label class="b3-form__icon fn__flex-1">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
    </label>
    <span class="fn__space"></span>
    <span class="block__icon fn__flex-center b3-tooltips b3-tooltips__sw" style="opacity: 1" aria-label="${window.siyuan.languages.random}"><svg><use xlink:href="#iconRefresh"></use></svg></span>
    <span class="fn__space"></span>
    <span class="block__icon fn__flex-center b3-tooltips b3-tooltips__sw" style="opacity: 1" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
    <span class="fn__space"></span>
</div>
<div class="emojis__panel">${filterEmoji()}</div>
<div class="fn__flex">
    <div data-type="0" class="emojis__type" aria-label="${window.siyuan.languages.recentEmoji}">${unicode2Emoji("2b50")}</div>
    <div data-type="1" class="emojis__type" aria-label="${window.siyuan.emojis[0][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f527")}</div>
    <div data-type="2" class="emojis__type" aria-label="${window.siyuan.emojis[1][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f60d")}</div>
    <div data-type="3" class="emojis__type" aria-label="${window.siyuan.emojis[2][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f433")}</div>
    <div data-type="4" class="emojis__type" aria-label="${window.siyuan.emojis[3][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f96a")}</div>
    <div data-type="5" class="emojis__type" aria-label="${window.siyuan.emojis[4][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3a8")}</div>
    <div data-type="6" class="emojis__type" aria-label="${window.siyuan.emojis[5][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3dd")}</div>
    <div data-type="7" class="emojis__type" aria-label="${window.siyuan.emojis[6][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f52e")}</div>
    <div data-type="8" class="emojis__type" aria-label="${window.siyuan.emojis[7][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("267e")}</div>
    <div data-type="9" class="emojis__type" aria-label="${window.siyuan.emojis[8][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f6a9")}</div>
</div>
</div>`;
    window.siyuan.menus.menu.element.firstElementChild.querySelector(".emojis__item").classList.add("emojis__item--current");
    window.siyuan.menus.menu.element.classList.remove("fn__none");
    const rect = target.getBoundingClientRect();
    setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + rect.height);

    const inputElement = window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement;
    const emojisContentElement = window.siyuan.menus.menu.element.querySelector(".emojis__panel");
    inputElement.addEventListener("compositionend", () => {
        emojisContentElement.innerHTML = filterEmoji(inputElement.value);
        if (inputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        window.siyuan.menus.menu.element.firstElementChild.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (inputElement.value === "") {
            lazyLoadEmoji(window.siyuan.menus.menu.element);
        }
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        emojisContentElement.innerHTML = filterEmoji(inputElement.value);
        if (inputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        window.siyuan.menus.menu.element.firstElementChild.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (inputElement.value === "") {
            lazyLoadEmoji(window.siyuan.menus.menu.element);
        }
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key.indexOf("Arrow") === -1 && event.key !== "Enter") {
            return;
        }
        const currentElement = window.siyuan.menus.menu.element.firstElementChild.querySelector(".emojis__item--current");
        if (!currentElement) {
            return;
        }
        if (event.key === "Enter") {
            const unicode = currentElement.getAttribute("data-unicode");
            if (isNotebook) {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: unicode
                }, () => {
                    window.siyuan.menus.menu.remove();
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id, "iconFilesRoot");
                });
            } else {
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"icon": unicode}
                }, () => {
                    window.siyuan.menus.menu.remove();
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id);
                    updateFileEmoji(unicode, id);
                    updateOutlineEmoji(unicode);
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let newCurrentElement: HTMLElement;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
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
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
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
        }
        if (newCurrentElement) {
            newCurrentElement.classList.add("emojis__item--current");
            const inputHeight = inputElement.clientHeight + 6;
            if (newCurrentElement.offsetTop - inputHeight < emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight;
            } else if (newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight > emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight;
            }
        }
    });
    if (!isMobile()) {
        inputElement.focus();
    }
    lazyLoadEmoji(window.siyuan.menus.menu.element);
    window.siyuan.menus.menu.element.firstElementChild.addEventListener(getEventName(), (event) => {
        const eventTarget = event.target as HTMLElement;
        const typeElement = hasClosestByClassName(eventTarget, "emojis__type");
        if (typeElement) {
            const titleElement = emojisContentElement.querySelector(`[data-type="${typeElement.getAttribute("data-type")}"]`) as HTMLElement;
            if (titleElement) {
                const index = titleElement.nextElementSibling.getAttribute("data-index");
                if (index) {
                    let html = "";
                    window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                        html += `<button data-unicode="${emoji.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode)}</button>`;
                    });
                    titleElement.nextElementSibling.innerHTML = html;
                    titleElement.nextElementSibling.removeAttribute("data-index");
                }

                emojisContentElement.scrollTo({
                    top: titleElement.offsetTop - 34,
                    // behavior: "smooth"  不能使用，否则无法定位
                });
            }
            return;
        }
        const iconElement = hasClosestByClassName(eventTarget, "block__icon");
        if (iconElement && iconElement.getAttribute("aria-label") === window.siyuan.languages.remove) {
            if (isNotebook) {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: ""
                }, () => {
                    window.siyuan.menus.menu.remove();
                    updateFileTreeEmoji("", id, "iconFilesRoot");
                });
            } else {
                fetchPost("/api/attr/setBlockAttrs", {
                    id: id,
                    attrs: {"icon": ""}
                }, () => {
                    window.siyuan.menus.menu.remove();
                    updateFileTreeEmoji("", id);
                    updateFileEmoji("", id);
                    updateOutlineEmoji("");
                });
            }
            return;
        }
        const emojiElement = hasClosestByClassName(eventTarget, "emojis__item");
        if (emojiElement || iconElement) {
            let unicode = "";
            if (emojiElement) {
                unicode = emojiElement.getAttribute("data-unicode");
                window.siyuan.menus.menu.remove();
            } else {
                unicode = getRandomEmoji();
            }
            if (isNotebook) {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: unicode
                }, () => {
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id, "iconFilesRoot");
                });
            } else {
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"icon": unicode}
                }, () => {
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id);
                    updateFileEmoji(unicode, id);
                    updateOutlineEmoji(unicode);
                });
            }
            return;
        }
    });
};

export const updateOutlineEmoji = (unicode: string) => {
    getAllModels().outline.forEach(model => {
        model.headerElement.nextElementSibling.firstElementChild.innerHTML = unicode2Emoji(unicode || Constants.SIYUAN_IMAGE_FILE);
    });
};

export const updateFileTreeEmoji = (unicode: string, id: string, icon = "iconFile") => {
    let emojiElement;
    if (isMobile()) {
        if (icon === "iconFile") {
            emojiElement = document.querySelector(`#fileTree [data-node-id="${id}"] .b3-list-item__icon`);
        } else {
            emojiElement = document.querySelector(`#fileTree [data-node-id="${id}"] .b3-list-item__icon`) || document.querySelector(`#fileTree [data-url="${id}"] .b3-list-item__icon`);
        }
    } else {
        const files = getDockByType("file").data.file as Files;
        if (icon === "iconFile") {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`);
        } else {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`) || files.element.querySelector(`[data-url="${id}"] .b3-list-item__icon`) || files.closeElement.querySelector(`[data-url="${id}"] .b3-list-item__icon`);
        }
    }
    if (emojiElement) {
        emojiElement.innerHTML = unicode2Emoji(unicode || (icon === "iconFile" ? Constants.SIYUAN_IMAGE_FILE : Constants.SIYUAN_IMAGE_NOTE));
    }
    if (icon !== "iconFile") {
        setNoteBook();
    }
};

const updateFileEmoji = (unicode: string, id: string) => {
    if (isMobile()) {
        if (window.siyuan.mobileEditor.protyle.block.rootID === id) {
            window.siyuan.mobileEditor.protyle.background.ial.icon = unicode;
            window.siyuan.mobileEditor.protyle.background.render(window.siyuan.mobileEditor.protyle.background.ial, id);
        }
    } else {
        getAllModels().editor.find(item => {
            if (item.editor.protyle.block.rootID === id) {
                item.editor.protyle.background.ial.icon = unicode;
                item.editor.protyle.background.render(item.editor.protyle.background.ial, id);
                item.parent.setDocIcon(unicode);
                return true;
            }
        });
    }
};
