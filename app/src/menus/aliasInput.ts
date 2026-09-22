export const parseAliases = (value: string): string[] => Array.from(new Set(value.split(",")
    .map(item => item.trim()).filter(Boolean)));

export const updateAliases = (aliases: string[], value: string, index = -1): string[] => {
    const result = [...aliases];
    result.splice(index < 0 ? result.length : index, index < 0 ? 0 : 1, ...parseAliases(value));
    return Array.from(new Set(result));
};

export const bindAliasInput = (element: HTMLElement, initialValue: string, options: {
    addLabel: string,
    removeLabel: string,
    placeholder: string,
    spellcheck: boolean,
    save: (value: string) => Promise<boolean>,
}) => {
    let aliases = parseAliases(initialValue);
    let editing = -1;
    let pending: Promise<boolean>;
    let actions = Promise.resolve();
    element.innerHTML = `<div class="b3-chips b3-chips__doctag custom-attr__aliases"></div>
<button type="button" class="b3-button b3-button--cancel"><svg><use xlink:href="#iconAdd"></use></svg><span></span></button>
<input class="b3-text-field fn__block fn__none">`;
    const list = element.querySelector<HTMLElement>(".b3-chips");
    const add = element.querySelector("button");
    const input = element.querySelector("input");
    add.querySelector("span").textContent = options.addLabel;
    input.placeholder = options.placeholder;
    input.setAttribute("aria-label", options.placeholder);
    input.spellcheck = options.spellcheck;
    list.addEventListener("pointerdown", event => {
        // 点击标签时由点击处理器先提交草稿，避免失焦重绘移除正在点击的元素。
        if (document.activeElement === input) {
            event.preventDefault();
        }
    });
    const finish = () => {
        editing = -1;
        input.value = "";
        input.classList.add("fn__none");
        add.classList.remove("fn__none");
    };
    const render = () => {
        list.replaceChildren();
        aliases.forEach(alias => {
            const chip = document.createElement("div");
            chip.className = "b3-chip b3-chip--middle";
            chip.innerHTML = "<span class=\"b3-chip--pointer\" role=\"button\" tabindex=\"0\"></span><svg class=\"b3-chip__close\" role=\"button\" tabindex=\"0\"><use xlink:href=\"#iconClose\"></use></svg>";
            const text = chip.querySelector("span");
            const remove = chip.querySelector("svg");
            text.textContent = alias;
            remove.setAttribute("aria-label", options.removeLabel + " " + alias);
            text.addEventListener("click", () => activate(async () => {
                editing = aliases.indexOf(alias);
                if (editing < 0) {
                    return;
                }
                input.value = alias;
                open();
            }));
            remove.addEventListener("click", () => activate(async () => {
                const currentIndex = aliases.indexOf(alias);
                if (currentIndex >= 0) {
                    await persist(aliases.filter((_, i) => i !== currentIndex), true);
                }
            }));
            chip.addEventListener("keydown", (event) => {
                if (!event.isComposing && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    event.stopPropagation();
                    (event.target as HTMLElement).dispatchEvent(new MouseEvent("click", {bubbles: true}));
                }
            });
            list.append(chip);
        });
    };
    const persist = (next: string[], restoreFocus: boolean) => {
        input.readOnly = true;
        add.disabled = true;
        list.setAttribute("aria-busy", "true");
        pending = options.save(next.join(",")).then(success => {
            if (success) {
                const focusInside = element.contains(document.activeElement);
                const focusChip = list.contains(document.activeElement);
                aliases = next;
                finish();
                render();
                add.disabled = false;
                if ((restoreFocus || focusChip) && focusInside && element.isConnected) {
                    add.focus();
                }
            }
            return success;
        }).finally(() => {
            pending = undefined;
            input.readOnly = false;
            add.disabled = false;
            list.removeAttribute("aria-busy");
        });
        return pending;
    };
    const commit = (restoreFocus = false): Promise<boolean> => {
        if (pending) {
            return pending;
        }
        if (input.classList.contains("fn__none")) {
            return Promise.resolve(true);
        }
        const next = updateAliases(aliases, input.value, editing);
        if (next.join(",") === aliases.join(",")) {
            finish();
            if (restoreFocus) {
                add.focus();
            }
            return Promise.resolve(true);
        }
        return persist(next, restoreFocus);
    };
    const open = () => {
        add.classList.add("fn__none");
        input.classList.remove("fn__none");
        input.focus();
        input.select();
    };
    const activate = (action: () => Promise<void>) => {
        // 标签操作依次提交，避免失焦保存和连续删除互相覆盖。
        actions = actions.then(async () => {
            if (await commit()) {
                await action();
            }
        });
    };
    add.addEventListener("click", open);
    input.addEventListener("blur", () => {
        void commit();
    });
    input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.isComposing || pending) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            void commit(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish();
            add.focus();
        }
    });
    render();
    return {
        commit: async () => {
            await actions;
            return commit();
        },
        focus: open,
    };
};
