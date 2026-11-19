export const bindOneTimeAction = (input: HTMLTextAreaElement, button: HTMLButtonElement,
                                 mobile: boolean, run: (action: string) => void) => {
    let composing = false;
    let submitted = false;
    const update = () => {
        button.disabled = submitted || composing || !input.value.trim();
    };
    const submit = () => {
        if (submitted || composing || !input.value.trim()) {
            return;
        }
        submitted = true;
        update();
        run(input.value.trim());
    };
    input.addEventListener("compositionstart", () => {
        composing = true;
        update();
    });
    input.addEventListener("compositionend", () => {
        composing = false;
        update();
    });
    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => {
        if (composing || event.isComposing || event.keyCode === 229 || mobile || event.key !== "Enter" || event.shiftKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        submit();
    });
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
    });
    update();
};
