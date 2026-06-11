import {focusByRange} from "../util/selection";

declare global {
    interface Window {
        protyleSpeechRange: Range;
    }
}
export const speechRender = (element: HTMLElement, lang: string) => {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
        return;
    }
    const playSVG = '<svg><use xlink:href="#iconPlay"></use></svg>';
    const pauseSVG = '<svg><use xlink:href="#iconPause"></use></svg>';
    let speechDom: HTMLDivElement = document.querySelector(".protyle-speech");
    if (!speechDom) {
        speechDom = document.createElement("div");
        speechDom.className = "protyle-speech";
        document.body.insertAdjacentElement("beforeend", speechDom);

        const getVoice = () => {
            const voices = speechSynthesis.getVoices();
            let currentVoice;
            let defaultVoice;
            voices.forEach((item) => {
                if (item.lang === lang.replace("_", "-")) {
                    currentVoice = item;
                }
                if (item.default) {
                    defaultVoice = item;
                }
            });
            if (!currentVoice) {
                currentVoice = defaultVoice;
            }
            return currentVoice;
        };

        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = getVoice;
        }

        const voice = getVoice();
        speechDom.onclick = () => {
            if (speechDom.className === "protyle-speech") {
                const utterThis = new SpeechSynthesisUtterance(speechDom.getAttribute("data-text"));
                utterThis.voice = voice;
                utterThis.onend = () => {
                    speechDom.className = "protyle-speech";
                    speechSynthesis.cancel();
                    speechDom.innerHTML = playSVG;
                };
                speechSynthesis.speak(utterThis);
                speechDom.className = "protyle-speech protyle-speech--current";
                speechDom.innerHTML = pauseSVG;
            } else {
                if (speechSynthesis.speaking) {
                    if (speechSynthesis.paused) {
                        speechSynthesis.resume();
                        speechDom.innerHTML = pauseSVG;
                    } else {
                        speechSynthesis.pause();
                        speechDom.innerHTML = playSVG;
                    }
                }
            }

            focusByRange(window.protyleSpeechRange);
        };

        document.body.addEventListener("click", () => {
            if (getSelection().toString().trim() === "" && speechDom.style.display === "block") {
                speechDom.className = "protyle-speech";
                speechSynthesis.cancel();
                speechDom.style.display = "none";
            }
        });
    }

    element.addEventListener("mouseup", (event: MouseEvent) => {
        const text = getSelection().toString().trim();
        speechSynthesis.cancel();
        if (getSelection().toString().trim() === "") {
            if (speechDom.style.display === "block") {
                speechDom.className = "protyle-speech";
                speechDom.style.display = "none";
            }
            return;
        }
        window.protyleSpeechRange = getSelection().getRangeAt(0).cloneRange();
        const rect = getSelection().getRangeAt(0).getBoundingClientRect();
        speechDom.innerHTML = playSVG;
        speechDom.style.display = "block";
        speechDom.style.top = (rect.top + rect.height + document.querySelector("html").scrollTop - 20) + "px";
        speechDom.style.left = (event.screenX + 2) + "px";
        speechDom.setAttribute("data-text", text);
    });
};
