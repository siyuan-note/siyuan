export const normalizeSearchInput = (input: HTMLTextAreaElement, method: number) => {
    if (method === 2 || !/[\r\n]/.test(input.value)) {
        return;
    }
    const normalize = (value: string) => value.replace(/\r\n|[\r\n]/g, " ");
    const start = normalize(input.value.slice(0, input.selectionStart)).length;
    const end = normalize(input.value.slice(0, input.selectionEnd)).length;
    const direction = input.selectionDirection;
    input.value = normalize(input.value);
    input.setSelectionRange(start, end, direction);
};

export const bindSearchInput = (input: HTMLTextAreaElement, getMethod: () => number) => {
    input.addEventListener("beforeinput", (event: InputEvent) => {
        if (["insertLineBreak", "insertParagraph"].includes(event.inputType) && getMethod() !== 2) {
            event.preventDefault();
        }
    });
};
