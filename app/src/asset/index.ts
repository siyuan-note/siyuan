import {Model} from "../layout/Model";
import {Tab} from "../layout/Tab";
import {Constants} from "../constants";
import {setPanelFocus} from "../layout/util";
/// #if !MOBILE
// @ts-ignore
import {webViewerLoad} from "./pdf/viewer";
// @ts-ignore
import {webViewerPageNumberChanged} from "./pdf/app";
/// #endif
import {fetchPost} from "../util/fetch";

export class Asset extends Model {
    public path: string;
    public element: HTMLElement;
    private pdfId: number | string;
    private pdfPage: number;
    public pdfObject: any;

    constructor(options: { tab: Tab, path: string, page?: number | string }) {
        super({
            id: options.tab.id,
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "remove":
                            if (data.data.path === this.path) {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                    }
                }
            }
        });
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement;
        this.path = options.path;
        this.pdfId = options.page;
        this.element.addEventListener("click", () => {
            setPanelFocus(this.element.parentElement.parentElement);
        });
        if (typeof this.pdfId === "string") {
            this.getPdfId(() => {
                this.render();
            });
            return;
        } else if (typeof this.pdfId === "number") {
            this.pdfPage = this.pdfId;
        }
        this.render();
    }

    private getPdfId(cb: () => void) {
        fetchPost("/api/asset/getFileAnnotation", {
            path: this.path + ".sya",
        }, (response) => {
            if (response.code !== 1) {
                const config = JSON.parse(response.data.data);
                if (config[this.pdfId]) {
                    this.pdfPage = config[this.pdfId].page ? config[this.pdfId].page + 1 : config[this.pdfId].pages[0].index + 1;
                } else {
                    this.pdfPage = undefined;
                }
            }
            cb();
        });
    }

    public goToPage(pdfId: string | number) {
        if (typeof pdfId === "undefined") {
            return;
        }
        this.pdfId = pdfId;
        /// #if !MOBILE
        if (typeof pdfId === "string") {
            this.getPdfId(() => {
                webViewerPageNumberChanged({value: this.pdfPage, pdfInstance: this.pdfObject, id: this.pdfId});
            });
            return;
        }
        webViewerPageNumberChanged({value: this.pdfId, pdfInstance: this.pdfObject});
        /// #endif
    }

    private render() {
        const type = this.path.substr(this.path.lastIndexOf(".")).toLowerCase();
        if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
            this.element.innerHTML = `<div class="asset"><img src="${this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path}"></div>`;
        } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
            this.element.innerHTML = `<div class="asset"><audio controls="controls" src="${this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path}"></audio></div>`;
        } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
            this.element.innerHTML = `<div class="asset"><video controls="controls" src="${this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path}"></video></div>`;
        } else if (type === ".pdf") {
            /// #if !MOBILE
            this.element.innerHTML = `<div class="pdf__outer" id="outerContainer">
      <div id="sidebarContainer">
        <div id="toolbarSidebar">
          <div id="toolbarSidebarLeft">
              <button id="viewThumbnail" class="toolbarButton toggled b3-tooltips b3-tooltips__ne" tabindex="2" aria-label="${window.siyuan.languages.thumbsTitle}">
                <svg><use xlink:href="#iconImage"></use></svg>
              </button>
              <button id="viewOutline" class="toolbarButton b3-tooltips b3-tooltips__ne" tabindex="3" aria-label="${window.siyuan.languages.outline}">
                 <svg><use xlink:href="#iconAlignCenter"></use></svg>
              </button>
              <button id="viewAttachments" class="toolbarButton fn__none" tabindex="4" data-l10n-id="attachments">
                 <span data-l10n-id="attachments_label">Attachments</span>
              </button>
              <button id="viewLayers" class="toolbarButton fn__none" tabindex="5" data-l10n-id="layers">
                 <span data-l10n-id="layers_label">Layers</span>
              </button>
          </div>
          <div class="fn__flex-1"></div>
          <div id="toolbarSidebarRight">
            <div id="outlineOptionsContainer" class="fn__hidden">
              <button id="currentOutlineItem" class="toolbarButton b3-tooltips b3-tooltips__nw" disabled="disabled" tabindex="6" aria-label="${window.siyuan.languages.focusOutline}">
                <svg><use xlink:href="#iconFocus"></use></svg>
              </button>
            </div>
          </div>
        </div>
        <div id="sidebarContent">
          <div id="thumbnailView">
          </div>
          <div id="outlineView" class="fn__hidden">
          </div>
          <div id="attachmentsView" class="fn__hidden">
          </div>
          <div id="layersView" class="fn__hidden">
          </div>
        </div>
        <div id="sidebarResizer"></div>
      </div>  <!-- sidebarContainer -->
      <div id="mainContainer">
        <div class="findbar b3-menu fn__hidden doorHanger" id="findbar">
            <input id="findInput" class="toolbarField b3-text-field" placeholder="${window.siyuan.languages.search}" tabindex="91">
            <div class="fn__space"></div>
            <button id="findPrevious" class="toolbarButton findPrevious b3-tooltips b3-tooltips__n" tabindex="92" aria-label="${window.siyuan.languages.previous}">
                <svg><use xlink:href="#iconUp"></use></svg>
            </button>
            <button id="findNext" class="toolbarButton findNext b3-tooltips b3-tooltips__n" tabindex="93" aria-label="${window.siyuan.languages.next}">
                <svg><use xlink:href="#iconDown"></use></svg>
            </button>
            <label class="b3-button b3-button--outline b3-button--small">
                <input type="checkbox" id="findHighlightAll" class="toolbarField" tabindex="94">
                ${window.siyuan.languages.findHighlight}
            </label>
            <div class="fn__space"></div>
            <label class="b3-button b3-button--outline b3-button--small">
                <input type="checkbox" id="findMatchCase" class="toolbarField" tabindex="95">
                ${window.siyuan.languages.searchCaseSensitive}
            </label>
            <div class="fn__space"></div>
            <label class="b3-button b3-button--outline b3-button--small">
                <input type="checkbox" id="findMatchDiacritics" class="toolbarField" tabindex="96">
                ${window.siyuan.languages.matchDiacritics}
            </label>
            <div class="fn__space"></div>
            <label class="b3-button b3-button--outline b3-button--small">
                <input type="checkbox" id="findEntireWord" class="toolbarField" tabindex="97">
                ${window.siyuan.languages.findEntireWord}
            </label>
            <div class="fn__space"></div>
            <span id="findResultsCount" class="b3-button b3-button--small b3-button--cancel"></span>
            <span id="findMsg" class="b3-button b3-button--small b3-button--cancel"></span>
        </div>  <!-- findbar -->
        <div id="secondaryToolbar" class="secondaryToolbar fn__hidden doorHangerRight b3-menu">
          <div id="secondaryToolbarButtonContainer">
            <button id="firstPage" class="secondaryToolbarButton b3-menu__item firstPage" tabindex="56">
              <svg class="b3-menu__icon"><use xlink:href="#iconUp"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.firstPage}</span>
            </button>
            <button id="lastPage" class="secondaryToolbarButton b3-menu__item lastPage" tabindex="57">
              <svg class="b3-menu__icon"><use xlink:href="#iconDown"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.lastPage}</span>
            </button>

            <div class="horizontalToolbarSeparator b3-menu__separator"></div>

            <button id="pageRotateCw" class="secondaryToolbarButton b3-menu__item rotateCw" tabindex="58">
               <svg class="b3-menu__icon"><use xlink:href="#iconRedo"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.rotateCw}</span>
            </button>
            <button id="pageRotateCcw" class="secondaryToolbarButton b3-menu__item rotateCcw" tabindex="59">
               <svg class="b3-menu__icon"><use xlink:href="#iconUndo"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.rotateCcw}</span>
            </button>

            <div class="horizontalToolbarSeparator b3-menu__separator"></div>

            <button id="cursorSelectTool" class="secondaryToolbarButton b3-menu__item selectTool toggled" tabindex="60">
               <svg class="b3-menu__icon"><use xlink:href="#iconSelectText"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.cursorText}</span>
            </button>
            <button id="cursorHandTool" class="secondaryToolbarButton b3-menu__item handTool" tabindex="61">
              <svg class="b3-menu__icon"><use xlink:href="#iconHand"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.cursorHand}</span>
            </button>

            <div class="horizontalToolbarSeparator b3-menu__separator"></div>

            <button id="scrollVertical" class="secondaryToolbarButton b3-menu__item scrollModeButtons scrollVertical toggled" tabindex="62">
             <svg class="b3-menu__icon"><use xlink:href="#iconSplitTB"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.scrollVertical}</span>
            </button>
            <button id="scrollHorizontal" class="secondaryToolbarButton b3-menu__item scrollModeButtons scrollHorizontal" tabindex="63">
              <svg class="b3-menu__icon"><use xlink:href="#iconSplitLR"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.scrollHorizontal}</span>
            </button>
            <button id="scrollWrapped" class="secondaryToolbarButton b3-menu__item scrollModeButtons scrollWrapped" tabindex="64">
             <svg class="b3-menu__icon"><use xlink:href="#iconScrollWrapped"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.scrollWrapped}</span>
            </button>

            <div class="horizontalToolbarSeparator b3-menu__separator scrollModeButtons"></div>

            <button id="spreadNone" class="secondaryToolbarButton b3-menu__item spreadModeButtons spreadNone toggled" tabindex="65">
              <svg class="b3-menu__icon"><use xlink:href="#iconFile"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.spreadNone}</span>
            </button>
            <button id="spreadOdd" class="secondaryToolbarButton b3-menu__item spreadModeButtons spreadOdd" tabindex="66">
              <svg class="b3-menu__icon"><use xlink:href="#iconSpreadOdd"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.spreadOdd}</span>
            </button>
            <button id="spreadEven" class="secondaryToolbarButton b3-menu__item spreadModeButtons spreadEven" tabindex="67">
              <svg class="b3-menu__icon"><use xlink:href="#iconSpreadEven"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.spreadEven}</span>
            </button>
            <div class="horizontalToolbarSeparator b3-menu__separator spreadModeButtons"></div>
            <button id="documentProperties" class="secondaryToolbarButton b3-menu__item documentProperties" tabindex="68">
              <svg class="b3-menu__icon"><use xlink:href="#iconInfo"></use></svg> 
              <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
            </button>
          </div>
        </div>  <!-- secondaryToolbar -->

        <div class="pdf__toolbar">
          <div id="toolbarContainer">
            <div id="toolbarViewer">
                <button id="sidebarToggle" class="toolbarButton b3-tooltips b3-tooltips__se" tabindex="11" aria-expanded="false" aria-controls="sidebarContainer" aria-label="${window.siyuan.languages.toggleSidebarNotification2Title}">
                    <svg><use xlink:href="#iconBoth"></use></svg>
                </button>
                <button id="viewFind" class="toolbarButton b3-tooltips b3-tooltips__s" tabindex="12" aria-expanded="false" aria-controls="findbar" aria-label="${window.siyuan.languages.search}">
                  <svg><use xlink:href="#iconSearch"></use></svg>
                </button>
                <button id="rectAnno" class="toolbarButton b3-tooltips b3-tooltips__s" tabindex="12" aria-expanded="false" aria-controls="findbar" aria-label="${window.siyuan.languages.rectAnnotation}">
                  <svg><use xlink:href="#iconTopLeft"></use></svg>
                </button>
                <button class="toolbarButton pageUp b3-tooltips b3-tooltips__s" aria-label="${window.siyuan.languages.previousLabel}" id="previous" tabindex="13">
                  <svg><use xlink:href="#iconUp"></use></svg>
                </button>
                <button class="toolbarButton pageDown b3-tooltips b3-tooltips__s" id="next" tabindex="14" aria-label="${window.siyuan.languages.nextLabel}">
                  <svg><use xlink:href="#iconDown"></use></svg>
                </button>
                <input type="number" id="pageNumber" class="toolbarField pageNumber b3-text-field" value="1" size="4" min="1" tabindex="15" autocomplete="off">
                <span id="numPages"></span>
                <div class="fn__flex-1"></div>
                <button id="zoomOut" class="toolbarButton zoomOut b3-tooltips b3-tooltips__sw" tabindex="21" aria-label="${window.siyuan.languages.zoomOut}">
                  <svg><use xlink:href="#iconLine"></use></svg>
                </button>
                <button id="zoomIn" class="toolbarButton zoomIn b3-tooltips b3-tooltips__sw" tabindex="22" aria-label="${window.siyuan.languages.zoomIn}">
                  <svg><use xlink:href="#iconAdd"></use></svg>
                </button>
                <span id="scaleSelectContainer" class="dropdownToolbarButton">
                  <select id="scaleSelect" tabindex="23" class="b3-select">
                    <option id="pageAutoOption" value="auto" selected="selected">${window.siyuan.languages.pageScaleAuto}</option>
                    <option id="pageActualOption" value="page-actual">${window.siyuan.languages.pageScaleActual}</option>
                    <option id="pageFitOption" value="page-fit">${window.siyuan.languages.pageScaleFit}</option>
                    <option id="pageWidthOption" value="page-width">${window.siyuan.languages.pageScaleWidth}</option>
                    <option id="customScaleOption" value="custom" disabled="disabled" hidden="true"></option>
                    <option value="0.5">50%</option>
                    <option value="0.75">75%</option>
                    <option value="1">100%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                    <option value="2">200%</option>
                    <option value="3">300%</option>
                    <option value="4">400%</option>
                  </select>
                </span>
                <button id="presentationMode" class="toolbarButton presentationMode b3-tooltips b3-tooltips__sw hiddenLargeView" tabindex="31" aria-label="${window.siyuan.languages.presentationMode}">
                  <svg><use xlink:href="#iconPlay"></use></svg>
                </button>
                <span id="scrollPage" class="fn__none"></span>
                <span id="viewBookmark" class="fn__none"></span>
                <span id="secondaryViewBookmark" class="fn__none"></span>
                <button id="secondaryToolbarToggle" class="toolbarButton b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.more}" tabindex="36" aria-expanded="false" aria-controls="secondaryToolbar">
                  <svg><use xlink:href="#iconMore"></use></svg>
                </button>
            </div>
            <div id="loadingBar">
              <div class="progress">
                <div class="glimmer">
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="viewerContainer" tabindex="0">
          <div id="viewer" class="pdfViewer"></div>
          <div class="pdf__resize fn__none"></div>
        </div>
        <div id="errorWrapper" hidden='true'>
          <div id="errorMessageLeft">
            <span id="errorMessage"></span>
            <button id="errorShowMore" data-l10n-id="error_more_info">
              More Information
            </button>
            <button id="errorShowLess" data-l10n-id="error_less_info" hidden='true'>
              Less Information
            </button>
          </div>
          <div id="errorMessageRight">
            <button id="errorClose" data-l10n-id="error_close">
              Close
            </button>
          </div>
          <div class="clearBoth"></div>
          <textarea id="errorMoreInfo" hidden='true' readonly="readonly"></textarea>
        </div>
      </div>
      <div id="overlayContainer" class="fn__hidden">
        <div id="passwordOverlay" class="container fn__hidden">
          <div class="dialog">
            <div class="row">
              <p id="passwordText" data-l10n-id="password_label">Enter the password to open this PDF file:</p>
            </div>
            <div class="row">
              <input type="password" id="password" class="toolbarField">
            </div>
            <div class="buttonRow">
              <button id="passwordCancel" class="overlayButton"><span data-l10n-id="password_cancel">Cancel</span></button>
              <button id="passwordSubmit" class="overlayButton"><span data-l10n-id="password_ok">OK</span></button>
            </div>
          </div>
        </div>
        <div id="documentPropertiesOverlay" class="container fn__hidden">
          <div class="dialog b3-menu">
            <div class="row">
              <span>${window.siyuan.languages.fileName}</span> <p id="fileNameField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.fileSize}</span> <p id="fileSizeField">-</p>
            </div>
            <div class="separator"></div>
            <div class="row">
              <span>${window.siyuan.languages.title1}</span> <p id="titleField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.author}</span> <p id="authorField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.subject}</span> <p id="subjectField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.keywords}</span> <p id="keywordsField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.creationDate}</span> <p id="creationDateField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.modificationDate}</span> <p id="modificationDateField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.creator}</span> <p id="creatorField">-</p>
            </div>
            <div class="separator"></div>
            <div class="row">
              <span>PDF ${window.siyuan.languages.producer}</span> <p id="producerField">-</p>
            </div>
            <div class="row">
              <span>PDF ${window.siyuan.languages.version}</span> <p id="versionField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.pageCount}</span> <p id="pageCountField">-</p>
            </div>
            <div class="row">
              <span>${window.siyuan.languages.pageSize}</span> <p id="pageSizeField">-</p>
            </div>
            <div class="separator"></div>
            <div class="row">
              <span>${window.siyuan.languages.linearized}</span> <p id="linearizedField">-</p>
            </div>
            <div class="buttonRow">
              <button id="documentPropertiesClose" class="b3-button"><span>${window.siyuan.languages.close}</span></button>
            </div>
          </div>
        </div>
        <div id="printServiceOverlay" class="container fn__hidden">
          <div class="dialog">
            <div class="row">
              <span data-l10n-id="print_progress_message">Preparing document for printing…</span>
            </div>
            <div class="row">
              <progress value="0" max="100"></progress>
              <span data-l10n-id="print_progress_percent" data-l10n-args='{ "progress": 0 }' class="relative-progress">0%</span>
            </div>
            <div class="buttonRow">
              <button id="printCancel" class="overlayButton"><span data-l10n-id="print_progress_close">Cancel</span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="pdf__util b3-menu fn__none pdf__util--hide">
        <div class="fn__flex" style="padding: 0 4px">
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background1)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background2)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background3)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background4)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background5)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background6)"></button>
            <button class="b3-color__square" style="background-color:var(--b3-pdf-background7)"></button>
        </div>
        <div class="b3-menu__separator pdf__util__hide" style="margin-top: 8px"></div>
        <button class="b3-menu__item pdf__util__hide" data-type="toggle">
            <svg class="b3-menu__icon"><use xlink:href="#iconFilesRoot"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.showHideBg}</span>
        </button>
        <button class="b3-menu__item pdf__util__hide" data-type="copy">
            <svg class="b3-menu__icon"><use xlink:href="#iconGraph"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.copyAnnotation}</span>
        </button>
        <button class="b3-menu__item pdf__util__hide" data-type="remove">
            <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.remove}</span>
        </button>
      </div>
    </div> <!-- outerContainer -->
    <div id="printContainer"></div>`;
            // 初始化完成后需等待页签是否显示设置完成，才可以判断 pdf 是否能进行渲染
            setTimeout(() => {
                if (this.element.clientWidth === 0) {
                    const observer = new MutationObserver(() => {
                        this.pdfObject = webViewerLoad(this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path,
                            this.element, this.pdfPage, this.pdfId);
                        observer.disconnect();
                    });
                    observer.observe(this.element, {attributeFilter: ["class"]});
                } else {
                    this.pdfObject = webViewerLoad(this.path.startsWith("file") ? this.path : document.getElementById("baseURL").getAttribute("href") + "/" + this.path,
                        this.element, this.pdfPage, this.pdfId);
                }
            });
            /// #endif
        }
    }
}
