/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {RenderingStates, ScrollMode, SpreadMode, TextLayerMode} from "./ui_utils.js";
import { AppOptions } from "./app_options.js";
import { LinkTarget } from "./pdf_link_service.js";
import { PDFViewerApplication } from "./app.js";
import {Constants} from "../../constants";
import {initAnno} from "../anno";
import {AnnotationEditorType} from "./pdfjs";

/* eslint-disable-next-line no-unused-vars */
const pdfjsVersion =
  typeof PDFJSDev !== "undefined" ? PDFJSDev.eval("BUNDLE_VERSION") : void 0;
/* eslint-disable-next-line no-unused-vars */
const pdfjsBuild =
  typeof PDFJSDev !== "undefined" ? PDFJSDev.eval("BUNDLE_BUILD") : void 0;

const AppConstants =
  typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")
    ? { LinkTarget, RenderingStates, ScrollMode, SpreadMode }
    : null;

// NOTE
// window.PDFViewerApplication = PDFViewerApplication;
// window.PDFViewerApplicationConstants = AppConstants;
// window.PDFViewerApplicationOptions = AppOptions;

function getViewerConfiguration(element) {
  // NOTE
  return {
    appContainer: element,
    principalContainer: element.querySelector("#mainContainer"),
    mainContainer: element.querySelector("#viewerContainer"),
    viewerContainer: element.querySelector("#viewer"),
    toolbar: {
      rectAnno: element.querySelector("#rectAnno"),
      container: element.querySelector("#toolbarContainer"),
      numPages: element.querySelector("#numPages"),
      pageNumber: element.querySelector("#pageNumber"),
      scaleSelect: element.querySelector("#scaleSelect"),
      customScaleOption: element.querySelector("#customScaleOption"),
      previous: element.querySelector("#previous"),
      next: element.querySelector("#next"),
      zoomIn: element.querySelector("#zoomInButton"),
      zoomOut: element.querySelector("#zoomOutButton"),
      print: element.querySelector("#printButton"),
      editorFreeTextButton: element.querySelector("#editorFreeTextButton"),
      editorFreeTextParamsToolbar: element.querySelector(
        "#editorFreeTextParamsToolbar"
      ),
      editorHighlightButton: element.querySelector("#editorHighlightButton"),
      editorHighlightParamsToolbar: element.querySelector(
        "#editorHighlightParamsToolbar"
      ),
      editorHighlightColorPicker: element.querySelector(
        "#editorHighlightColorPicker"
      ),
      editorInkButton: element.querySelector("#editorInkButton"),
      editorInkParamsToolbar: element.querySelector("#editorInkParamsToolbar"),
      editorStampButton: element.querySelector("#editorStampButton"),
      editorStampParamsToolbar: element.querySelector(
        "#editorStampParamsToolbar"
      ),
      download: element.querySelector("#downloadButton"),
    },
    secondaryToolbar: {
      toolbar: element.querySelector("#secondaryToolbar"),
      toggleButton: element.querySelector("#secondaryToolbarToggleButton"),
      presentationModeButton: element.querySelector("#presentationMode"),
      openFileButton:
        typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")
          ? element.querySelector("#secondaryOpenFile")
          : null,
      printButton: element.querySelector("#secondaryPrint"),
      downloadButton: element.querySelector("#secondaryDownload"),
      viewBookmarkButton: element.querySelector("#viewBookmark"),
      firstPageButton: element.querySelector("#firstPage"),
      lastPageButton: element.querySelector("#lastPage"),
      pageRotateCwButton: element.querySelector("#pageRotateCw"),
      pageRotateCcwButton: element.querySelector("#pageRotateCcw"),
      cursorSelectToolButton: element.querySelector("#cursorSelectTool"),
      cursorHandToolButton: element.querySelector("#cursorHandTool"),
      scrollPageButton: element.querySelector("#scrollPage"),
      scrollVerticalButton: element.querySelector("#scrollVertical"),
      scrollHorizontalButton: element.querySelector("#scrollHorizontal"),
      scrollWrappedButton: element.querySelector("#scrollWrapped"),
      spreadNoneButton: element.querySelector("#spreadNone"),
      spreadOddButton: element.querySelector("#spreadOdd"),
      spreadEvenButton: element.querySelector("#spreadEven"),
      imageAltTextSettingsButton: element.querySelector(
        "#imageAltTextSettings"
      ),
      imageAltTextSettingsSeparator: element.querySelector(
        "#imageAltTextSettingsSeparator"
      ),
      documentPropertiesButton: element.querySelector("#documentProperties"),
    },
    sidebar: {
      // Divs (and sidebar button)
      outerContainer: element.querySelector("#outerContainer"),
      sidebarContainer: element.querySelector("#sidebarContainer"),
      toggleButton: element.querySelector("#sidebarToggleButton"),
      resizer: element.querySelector("#sidebarResizer"),
      // Buttons
      thumbnailButton: element.querySelector("#viewThumbnail"),
      outlineButton: element.querySelector("#viewOutline"),
      attachmentsButton: element.querySelector("#viewAttachments"),
      layersButton: element.querySelector("#viewLayers"),
      // Views
      thumbnailView: element.querySelector("#thumbnailView"),
      outlineView: element.querySelector("#outlineView"),
      attachmentsView: element.querySelector("#attachmentsView"),
      layersView: element.querySelector("#layersView"),
      // View-specific options
      currentOutlineItemButton: element.querySelector("#currentOutlineItem"),
    },
    findBar: {
      bar: element.querySelector("#findbar"),
      toggleButton: element.querySelector("#viewFindButton"),
      findField: element.querySelector("#findInput"),
      highlightAllCheckbox: element.querySelector("#findHighlightAll"),
      caseSensitiveCheckbox: element.querySelector("#findMatchCase"),
      matchDiacriticsCheckbox: element.querySelector("#findMatchDiacritics"),
      entireWordCheckbox: element.querySelector("#findEntireWord"),
      findMsg: element.querySelector("#findMsg"),
      findResultsCount: element.querySelector("#findResultsCount"),
      findPreviousButton: element.querySelector("#findPreviousButton"),
      findNextButton: element.querySelector("#findNextButton"),
    },
    passwordOverlay: {
      dialog: element.querySelector("#passwordDialog"),
      label: element.querySelector("#passwordText"),
      input: element.querySelector("#password"),
      submitButton: element.querySelector("#passwordSubmit"),
      cancelButton: element.querySelector("#passwordCancel"),
    },
    documentProperties: {
      dialog: element.querySelector("#documentPropertiesDialog"),
      closeButton: element.querySelector("#documentPropertiesClose"),
      fields: {
        fileName: element.querySelector("#fileNameField"),
        fileSize: element.querySelector("#fileSizeField"),
        title: element.querySelector("#titleField"),
        author: element.querySelector("#authorField"),
        subject: element.querySelector("#subjectField"),
        keywords: element.querySelector("#keywordsField"),
        creationDate: element.querySelector("#creationDateField"),
        modificationDate: element.querySelector("#modificationDateField"),
        creator: element.querySelector("#creatorField"),
        producer: element.querySelector("#producerField"),
        version: element.querySelector("#versionField"),
        pageCount: element.querySelector("#pageCountField"),
        pageSize: element.querySelector("#pageSizeField"),
        linearized: element.querySelector("#linearizedField"),
      },
    },
    altTextDialog: {
      dialog: element.querySelector("#altTextDialog"),
      optionDescription: element.querySelector("#descriptionButton"),
      optionDecorative: element.querySelector("#decorativeButton"),
      textarea: element.querySelector("#descriptionTextarea"),
      cancelButton: element.querySelector("#altTextCancel"),
      saveButton: element.querySelector("#altTextSave"),
    },
    newAltTextDialog: {
      dialog: element.querySelector("#newAltTextDialog"),
      title: element.querySelector("#newAltTextTitle"),
      descriptionContainer: element.querySelector(
        "#newAltTextDescriptionContainer"
      ),
      textarea: element.querySelector("#newAltTextDescriptionTextarea"),
      disclaimer: element.querySelector("#newAltTextDisclaimer"),
      learnMore: element.querySelector("#newAltTextLearnMore"),
      imagePreview: element.querySelector("#newAltTextImagePreview"),
      createAutomatically: element.querySelector(
        "#newAltTextCreateAutomatically"
      ),
      createAutomaticallyButton: element.querySelector(
        "#newAltTextCreateAutomaticallyButton"
      ),
      downloadModel: element.querySelector("#newAltTextDownloadModel"),
      downloadModelDescription: element.querySelector(
        "#newAltTextDownloadModelDescription"
      ),
      error: element.querySelector("#newAltTextError"),
      errorCloseButton: element.querySelector("#newAltTextCloseButton"),
      cancelButton: element.querySelector("#newAltTextCancel"),
      notNowButton: element.querySelector("#newAltTextNotNow"),
      saveButton: element.querySelector("#newAltTextSave"),
    },
    altTextSettingsDialog: {
      dialog: element.querySelector("#altTextSettingsDialog"),
      createModelButton: element.querySelector("#createModelButton"),
      aiModelSettings: element.querySelector("#aiModelSettings"),
      learnMore: element.querySelector("#altTextSettingsLearnMore"),
      deleteModelButton: element.querySelector("#deleteModelButton"),
      downloadModelButton: element.querySelector("#downloadModelButton"),
      showAltTextDialogButton: element.querySelector(
        "#showAltTextDialogButton"
      ),
      altTextSettingsCloseButton: element.querySelector(
        "#altTextSettingsCloseButton"
      ),
      closeButton: element.querySelector("#altTextSettingsCloseButton"),
    },
    annotationEditorParams: {
      editorFreeTextFontSize: element.querySelector("#editorFreeTextFontSize"),
      editorFreeTextColor: element.querySelector("#editorFreeTextColor"),
      editorInkColor: element.querySelector("#editorInkColor"),
      editorInkThickness: element.querySelector("#editorInkThickness"),
      editorInkOpacity: element.querySelector("#editorInkOpacity"),
      editorStampAddImage: element.querySelector("#editorStampAddImage"),
      editorFreeHighlightThickness: element.querySelector(
        "#editorFreeHighlightThickness"
      ),
      editorHighlightShowAll: element.querySelector("#editorHighlightShowAll"),
    },
    printContainer: element.querySelector("#printContainer"),
  };
}

// NOTE
function webViewerLoad(file, element, pdfPage, annoId) {
  AppOptions.set("workerSrc", `${Constants.PROTYLE_CDN}/js/pdf/pdf.worker.min.mjs?v=4.7.85`);
  AppOptions.set("defaultUrl", file);
  AppOptions.set("cMapUrl", 'cmaps/');
  AppOptions.set("standardFontDataUrl", 'standard_fonts/');
  AppOptions.set("annotationEditorMode", AnnotationEditorType.DISABLE);
  const pdf = new PDFViewerApplication(pdfPage)
  pdf.annoId = annoId
  const config = getViewerConfiguration(element);
  config.file = file;
  if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("GENERIC")) {
    // Give custom implementations of the default viewer a simpler way to
    // set various `AppOptions`, by dispatching an event once all viewer
    // files are loaded but *before* the viewer initialization has run.
    const event = new CustomEvent("webviewerloaded", {
      bubbles: true,
      cancelable: true,
      detail: {
        source: window,
      },
    });
    try {
      // Attempt to dispatch the event at the embedding `document`,
      // in order to support cases where the viewer is embedded in
      // a *dynamically* created <iframe> element.
      parent.document.dispatchEvent(event);
    } catch (ex) {
      // The viewer could be in e.g. a cross-origin <iframe> element,
      // fallback to dispatching the event at the current `document`.
      console.error(`webviewerloaded: ${ex}`);
      document.dispatchEvent(event);
    }
  }
  pdf.run(config);
  initAnno(element, pdf);
  return pdf
}

// Block the "load" event until all pages are loaded, to ensure that printing
// works in Firefox; see https://bugzilla.mozilla.org/show_bug.cgi?id=1618553
document.blockUnblockOnload?.(true);

// NOTE
// if (
//   document.readyState === "interactive" ||
//   document.readyState === "complete"
// ) {
//   webViewerLoad();
// } else {
//   document.addEventListener("DOMContentLoaded", webViewerLoad, true);
// }

// NOTE
export {
  // PDFViewerApplication,
  // AppConstants as PDFViewerApplicationConstants,
  // AppOptions as PDFViewerApplicationOptions,
  webViewerLoad
};
