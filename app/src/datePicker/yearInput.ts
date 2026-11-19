export const createYearInputController = (input: HTMLInputElement, getCurrentYear: () => number) => {
    input.type = "text";
    input.inputMode = "numeric";
    let composing = false;
    let accepted = {value: "", start: 0, end: 0, direction: "none" as "forward" | "backward" | "none"};
    const digitsOnly = (value: string) => /^[0-9]*$/.test(value);
    const remember = () => {
        if (composing || !digitsOnly(input.value)) { return; }
        accepted = {value: input.value, start: input.selectionStart ?? 0, end: input.selectionEnd ?? input.value.length,
            direction: input.selectionDirection ?? "none"};
    };
    const restore = () => {
        input.value = accepted.value;
        input.setSelectionRange(accepted.start, accepted.end, accepted.direction);
    };
    const setValue = (year: number) => {
        if (composing) { return; }
        input.value = String(year);
        remember();
    };
    const keydown = (event: KeyboardEvent) => {
        if (composing || event.isComposing || event.keyCode === 229) { return; }
        remember();
        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !digitsOnly(event.key)) {
            event.preventDefault();
        }
    };
    const beforeinput = (event: InputEvent) => {
        if (composing || event.isComposing) { return; }
        remember();
        const value = event.data ?? event.dataTransfer?.getData("text/plain");
        if (value != null && !digitsOnly(value)) { event.preventDefault(); }
    };
    const validateDraft = () => {
        if (digitsOnly(input.value)) { remember(); } else { restore(); }
    };
    const onInput = (event: InputEvent) => {
        if (!composing && !event.isComposing) { validateDraft(); }
    };
    const paste = (event: ClipboardEvent) => {
        if (composing) { return; }
        remember();
        const value = event.clipboardData?.getData("text/plain");
        if (value != null && !digitsOnly(value)) { event.preventDefault(); }
    };
    const drop = (event: DragEvent) => {
        if (composing) { return; }
        remember();
        const value = event.dataTransfer?.getData("text/plain");
        if (value != null && !digitsOnly(value)) { event.preventDefault(); }
    };
    const compositionstart = () => {
        remember();
        composing = true;
    };
    const compositionend = () => {
        composing = false;
        // 合成期间保留输入法草稿，结束后整体拒绝非 ASCII 数字，避免把混合文本截成另一个年份。
        validateDraft();
    };
    input.addEventListener("keydown", keydown);
    input.addEventListener("beforeinput", beforeinput);
    input.addEventListener("input", onInput);
    input.addEventListener("paste", paste);
    input.addEventListener("drop", drop);
    input.addEventListener("compositionstart", compositionstart);
    input.addEventListener("compositionend", compositionend);
    input.addEventListener("select", remember);
    input.addEventListener("keyup", remember);
    input.addEventListener("pointerup", remember);
    input.addEventListener("focus", remember);
    setValue(getCurrentYear());
    return {
        setValue,
        isComposing: () => composing,
        commit: (): number | undefined => {
            if (composing) { return undefined; }
            const year = Number(input.value);
            if (!/^[0-9]+$/.test(input.value) || !Number.isInteger(year) || year < 1 || year > 275760) {
                setValue(getCurrentYear());
                return undefined;
            }
            setValue(year);
            return year;
        },
        destroy: () => {
            input.removeEventListener("keydown", keydown);
            input.removeEventListener("beforeinput", beforeinput);
            input.removeEventListener("input", onInput);
            input.removeEventListener("paste", paste);
            input.removeEventListener("drop", drop);
            input.removeEventListener("compositionstart", compositionstart);
            input.removeEventListener("compositionend", compositionend);
            input.removeEventListener("select", remember);
            input.removeEventListener("keyup", remember);
            input.removeEventListener("pointerup", remember);
            input.removeEventListener("focus", remember);
        },
    };
};
