export const isAbnormalItem = (currentHintElement: HTMLElement, className: string) => {
    return currentHintElement && (!currentHintElement.classList.contains(className) || currentHintElement.getBoundingClientRect().height === 0);
};

export const upDownHint = (listElement: Element, event: KeyboardEvent, classActiveName = "b3-list-item--focus", defaultElement?: Element) => {
    let currentHintElement: HTMLElement = listElement.querySelector("." + classActiveName);
    if (!currentHintElement && defaultElement) {
        defaultElement.classList.add(classActiveName);
        defaultElement.scrollIntoView(true);
        return;
    }
    if (!currentHintElement) {
        return;
    }
    const className = classActiveName.split("--")[0];
    if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);

        currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        }

        if (!currentHintElement) {
            currentHintElement = listElement.children[0] as HTMLElement;
            while (isAbnormalItem(currentHintElement, className)) {
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
        while (isAbnormalItem(currentHintElement, className)) {
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
    } else if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        currentHintElement = listElement.children[0] as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView();
        return currentHintElement;
    } else if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        currentHintElement = listElement.children[listElement.children.length - 1] as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView(false);
        return currentHintElement;
    }
};

export const UDLRHint = (listElement: Element, event: KeyboardEvent, classActiveName = "b3-list-item--focus", defaultElement?: Element) => {
    let currentHintElement: HTMLElement = listElement.querySelector("." + classActiveName);
    if (!currentHintElement && defaultElement) {
        defaultElement.classList.add(classActiveName);
        defaultElement.scrollIntoView(true);
        return;
    }
    if (!currentHintElement) {
        return;
    }
    const className = classActiveName.split("--")[0];
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (currentHintElement.parentElement.classList.contains("b3-list")) {
            if (currentHintElement.querySelector(".b3-list-item__arrow--open")) {
                currentHintElement.querySelector(".b3-list-item__arrow--open").classList.remove("b3-list-item__arrow--open");
                currentHintElement.nextElementSibling.classList.add("fn__none");
            } else {
                currentHintElement = listElement.firstElementChild as HTMLElement;
            }
        } else {
            currentHintElement = currentHintElement.parentElement.previousElementSibling as HTMLElement;
        }
        currentHintElement.classList.add(classActiveName);
        const overTop = listElement.scrollTop > currentHintElement.offsetTop - 46 - (currentHintElement.previousElementSibling?.clientHeight || 0);
        if (listElement.scrollTop < currentHintElement.offsetTop - 46 - listElement.clientHeight + currentHintElement.clientHeight || overTop) {
            currentHintElement.scrollIntoView(overTop);
        }
        return currentHintElement;
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (currentHintElement.parentElement.classList.contains("b3-list")) {
            if (currentHintElement.querySelector(".b3-list-item__arrow--open")) {
                currentHintElement = currentHintElement.nextElementSibling.firstElementChild as HTMLElement;
            } else {
                currentHintElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                currentHintElement.nextElementSibling.classList.remove("fn__none");
            }
        } else {
            if (!currentHintElement.nextElementSibling) {
                if (currentHintElement.parentElement.nextElementSibling) {
                    currentHintElement = currentHintElement.parentElement.nextElementSibling as HTMLElement;
                }
            } else {
                currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
            }
        }
        currentHintElement.classList.add(classActiveName);
        if (listElement.scrollTop < currentHintElement.offsetTop - 46 - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop - 46) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop - 46);
        }
        return currentHintElement;
    } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (!currentHintElement.nextElementSibling) {
            currentHintElement = currentHintElement.parentElement.nextElementSibling as HTMLElement || listElement.firstElementChild as HTMLElement;
        } else {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
            if (!currentHintElement.classList.contains(className)) {
                if (currentHintElement.classList.contains("fn__none")) {
                    currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
                    if (!currentHintElement) {
                        currentHintElement = listElement.firstElementChild as HTMLElement;
                    }
                } else {
                    currentHintElement = currentHintElement.firstElementChild as HTMLElement;
                }
            }
        }
        currentHintElement.classList.add(classActiveName);
        if (listElement.scrollTop < currentHintElement.offsetTop - 46 - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop - 46) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop - 46);
        }
        return currentHintElement;
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (!currentHintElement.previousElementSibling) {
            if (currentHintElement.parentElement.classList.contains("b3-list")) {
                if (listElement.lastElementChild.classList.contains("fn__none")) {
                    currentHintElement = listElement.lastElementChild.previousElementSibling as HTMLElement;
                } else {
                    currentHintElement = listElement.lastElementChild.lastElementChild as HTMLElement;
                }
            } else {
                currentHintElement = currentHintElement.parentElement.previousElementSibling as HTMLElement;
            }
        } else {
            currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
            if (!currentHintElement.classList.contains(className)) {
                if (currentHintElement.classList.contains("fn__none")) {
                    currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
                } else {
                    currentHintElement = currentHintElement.lastElementChild as HTMLElement;
                }
            }
        }
        currentHintElement.classList.add(classActiveName);
        const overTop = listElement.scrollTop > currentHintElement.offsetTop - 46 - (currentHintElement.previousElementSibling?.clientHeight || 0);
        if (listElement.scrollTop < currentHintElement.offsetTop - 46 - listElement.clientHeight + currentHintElement.clientHeight || overTop) {
            currentHintElement.scrollIntoView(overTop);
        }
        return currentHintElement;
    } else if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        currentHintElement = listElement.children[0] as HTMLElement;
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView();
        return currentHintElement;
    } else if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        if (listElement.lastElementChild.classList.contains("fn__none")) {
            currentHintElement = listElement.lastElementChild.previousElementSibling as HTMLElement;
        } else {
            currentHintElement = listElement.lastElementChild.lastElementChild as HTMLElement;
        }
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView(false);
        return currentHintElement;
    }
};
