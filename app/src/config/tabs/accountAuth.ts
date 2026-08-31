export const isAccountLoginDisabled = (agreed: boolean, password: string, submitting = false) => {
    return submitting || !agreed || password.length === 0;
};

export const bindAccountAuthEnter = (input: HTMLInputElement, submit: () => void) => {
    input.addEventListener("keydown", (event) => {
        if (event.isComposing || event.repeat || event.key !== "Enter") {
            return;
        }
        submit();
        event.preventDefault();
    });
};
