export const upDownHint = (listElement: Element, event: KeyboardEvent, classActiveName = "b3-list-item--focus") => {
    let currentHintElement: HTMLElement = listElement.querySelector("." + classActiveName);
    if (!currentHintElement) {
        return
    }
    const className = classActiveName.split("--")[0];
    if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);

        currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        while (currentHintElement &&
        (currentHintElement.classList.contains("fn__none") || !currentHintElement.classList.contains(className))) {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        }

        if (!currentHintElement) {
            currentHintElement = listElement.children[0] as HTMLElement;
            while (currentHintElement &&
            (currentHintElement.classList.contains("fn__none") || !currentHintElement.classList.contains(className))) {
                currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
            }
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop);
        }
        return currentHintElement;
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);

        currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        while (currentHintElement &&
        (currentHintElement.classList.contains("fn__none") || !currentHintElement.classList.contains(className))) {
            currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        }

        if (!currentHintElement) {
            currentHintElement = listElement.children[listElement.children.length - 1] as HTMLElement;
            while (currentHintElement &&
            (currentHintElement.classList.contains("fn__none") || !currentHintElement.classList.contains(className))) {
                currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
            }
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);

        const overTop = listElement.scrollTop > currentHintElement.offsetTop - (currentHintElement.previousElementSibling?.clientHeight || 0);
        if (listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight || overTop) {
            currentHintElement.scrollIntoView(overTop);
        }
        return currentHintElement;
    }
};
