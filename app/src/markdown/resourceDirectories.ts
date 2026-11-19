export interface MarkdownResourceDirectory {
    id: string;
    path: string;
}

export const showMarkdownResourceDirectories = (element: HTMLDialogElement, directories: MarkdownResourceDirectory[],
                                                text: (key: string) => string, confirm: (ids: string[]) => Promise<boolean>,
                                                finished: (authorized: boolean) => void): (() => void) => {
    let closed = false;
    let saving = false;
    const finish = (authorized = false) => {
        if (closed) return;
        closed = true;
        element.removeEventListener("cancel", cancelDialog);
        element.close(); element.hidden = true; element.replaceChildren();
        finished(authorized);
    };
    const cancelDialog = (event: Event) => {event.preventDefault(); if (!saving) finish();};
    element.replaceChildren();
    const scrim = document.createElement("div");
    scrim.className = "b3-dialog__scrim";
    scrim.onclick = cancelDialog;
    const form = document.createElement("form");
    form.className = "b3-dialog__container markdown-appearance-dialog__container";
    const heading = document.createElement("strong");
    heading.id = "markdownResourcesTitle";
    heading.className = "b3-dialog__header";
    heading.textContent = text("markdownResources");
    const content = document.createElement("div");
    content.className = "b3-dialog__content markdown-resource-directories";
    const description = document.createElement("p");
    description.textContent = text(directories.length ? "markdownResourceDirectoriesTip" : "markdownResourceDirectoriesEmpty");
    const list = document.createElement("div");
    list.className = "markdown-resource-directories__list";
    const choices = directories.map(directory => {
        const label = document.createElement("label");
        label.className = "markdown-resource-directories__item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox"; checkbox.className = "b3-switch"; checkbox.checked = true;
        const name = document.createElement("span");
        name.textContent = directory.path;
        label.append(checkbox, name); list.append(label);
        return {checkbox, id: directory.id};
    });
    const error = document.createElement("p");
    error.hidden = true; error.setAttribute("role", "alert"); error.textContent = text("markdownResourceDirectoriesChanged");
    content.append(description, list, error);
    const actions = document.createElement("div");
    actions.className = "b3-dialog__action markdown-appearance-dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "b3-button b3-button--cancel";
    cancel.textContent = text("cancel"); cancel.onclick = () => {if (!saving) finish();};
    const submit = document.createElement("button");
    submit.type = "submit"; submit.className = "b3-button"; submit.textContent = text("confirm");
    submit.disabled = !directories.length;
    const update = () => {submit.disabled = !choices.some(choice => choice.checkbox.checked);};
    choices.forEach(choice => {choice.checkbox.onchange = update;});
    actions.append(cancel, submit); form.append(heading, content, actions); element.append(scrim, form);
    form.onsubmit = event => {
        event.preventDefault();
        if (closed || saving || submit.disabled) return;
        saving = true; submit.disabled = true; cancel.disabled = true;
        choices.forEach(choice => {choice.checkbox.disabled = true;});
        void confirm(choices.filter(choice => choice.checkbox.checked).map(choice => choice.id)).then(authorized => {
            if (closed) return;
            if (authorized) finish(true);
            else {error.hidden = false; saving = false; cancel.disabled = false;}
        }).catch(() => {
            if (closed) return;
            error.hidden = false; saving = false; cancel.disabled = false;
        });
    };
    form.onkeydown = event => {
        if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); if (!saving) finish();}
    };
    element.addEventListener("cancel", cancelDialog);
    element.hidden = false; element.showModal();
    (choices[0]?.checkbox ?? cancel).focus();
    return () => finish();
};
