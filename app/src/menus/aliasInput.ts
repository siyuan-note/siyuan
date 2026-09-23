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
    dragThreshold?: number,
    save: (value: string) => Promise<boolean>,
}) => {
    let aliases = parseAliases(initialValue);
    let editing = -1;
    let pending: Promise<boolean>;
    let actions = Promise.resolve();
    let activeActions = 0;
    let cancelDrag: () => void;
    let suppressClick = false;
    element.innerHTML = `<div class="b3-chips custom-attr__aliases"></div>
<button type="button" class="b3-button b3-button--cancel"><svg><use xlink:href="#iconAdd"></use></svg><span></span></button>
<input class="b3-text-field fn__block fn__none">`;
    const list = element.querySelector<HTMLElement>(".b3-chips");
    const add = element.querySelector("button");
    const input = element.querySelector("input");
    add.querySelector("span").textContent = options.addLabel;
    input.placeholder = options.placeholder;
    input.setAttribute("aria-label", options.placeholder);
    input.spellcheck = options.spellcheck;
    list.addEventListener("click", event => {
        if (suppressClick && event.detail !== 0) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    list.addEventListener("touchstart", event => {
        // 别名上的触摸由排序处理，避免同时触发移动端面板的下拉关闭。
        if ((event.target as Element).closest(".b3-chip")) {
            event.stopPropagation();
        }
    }, {passive: true});
    list.addEventListener("pointerdown", event => {
        suppressClick = false;
        // 点击标签时由点击处理器先提交草稿，避免失焦重绘移除正在点击的元素。
        if (document.activeElement === input) {
            event.preventDefault();
        }
        const chip = (event.target as Element).closest<HTMLElement>(".b3-chip");
        if (!chip || event.button !== 0 || !event.isPrimary || pending || activeActions || cancelDrag ||
            !input.classList.contains("fn__none") || (event.target as Element).closest(".b3-chip__close")) {
            return;
        }
        const rect = chip.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        let clone: HTMLElement;
        const cleanup = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", drop);
            document.removeEventListener("pointercancel", cancel);
            document.removeEventListener("keydown", escape, true);
            window.removeEventListener("blur", cancel);
            list.removeEventListener("lostpointercapture", lostCapture);
            if (list.hasPointerCapture(event.pointerId)) {
                list.releasePointerCapture(event.pointerId);
            }
            clone?.remove();
            chip.classList.remove("b3-chip--dragging");
            cancelDrag = undefined;
        };
        const cancel = () => {
            cleanup();
            if (clone) {
                render();
            }
        };
        const lostCapture = (captureEvent: PointerEvent) => {
            if (captureEvent.target === list && captureEvent.pointerId === event.pointerId) {
                cancel();
            }
        };
        const escape = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === "Escape") {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                cancel();
            }
        };
        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }
            if (!clone) {
                if (Math.abs(moveEvent.clientX - event.clientX) < (options.dragThreshold ?? 5) &&
                    Math.abs(moveEvent.clientY - event.clientY) < (options.dragThreshold ?? 5)) {
                    return;
                }
                suppressClick = true;
                clone = chip.cloneNode(true) as HTMLElement;
                clone.classList.add("b3-chip--dragclone");
                clone.setAttribute("aria-hidden", "true");
                clone.querySelectorAll("[tabindex]").forEach(item => item.removeAttribute("tabindex"));
                Object.assign(clone.style, {
                    position: "fixed", width: `${rect.width}px`, height: `${rect.height}px`,
                    margin: "0", zIndex: "9999", pointerEvents: "none", transition: "none",
                });
                document.body.append(clone);
                chip.classList.add("b3-chip--dragging");
                list.setPointerCapture(event.pointerId);
            }
            moveEvent.preventDefault();
            clone.style.left = `${moveEvent.clientX - offsetX}px`;
            clone.style.top = `${moveEvent.clientY - offsetY}px`;
            const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
                ?.closest<HTMLElement>(".b3-chip");
            if (target && target !== chip && target.parentElement === list) {
                const targetRect = target.getBoundingClientRect();
                if (moveEvent.clientX > targetRect.left + targetRect.width / 2) {
                    target.after(chip);
                } else {
                    target.before(chip);
                }
            }
        };
        const drop = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== event.pointerId) {
                return;
            }
            const next = Array.from(list.children).map(item => item.querySelector("span").textContent);
            cleanup();
            if (!clone) {
                return;
            }
            upEvent.preventDefault();
            if (next.some((alias, index) => alias !== aliases[index])) {
                activate(async () => {
                    if (!await persist(next, false)) {
                        render();
                    }
                });
            }
        };
        cancelDrag = cancel;
        document.addEventListener("pointermove", move, {passive: false});
        document.addEventListener("pointerup", drop);
        document.addEventListener("pointercancel", cancel);
        document.addEventListener("keydown", escape, true);
        window.addEventListener("blur", cancel);
        list.addEventListener("lostpointercapture", lostCapture);
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
        activeActions++;
        actions = actions.then(async () => {
            if (await commit()) {
                await action();
            }
        }).finally(() => {
            activeActions--;
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
            cancelDrag?.();
            await actions;
            return commit();
        },
        focus: open,
        destroy: () => cancelDrag?.(),
    };
};
