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

import { AppOptions } from './app_options.js'
import { PDFViewerApplication } from './app.js'
import { initAnno } from '../anno'

/* eslint-disable-next-line no-unused-vars */
const pdfjsVersion =
  typeof PDFJSDev !== 'undefined' ? PDFJSDev.eval('BUNDLE_VERSION') : void 0
/* eslint-disable-next-line no-unused-vars */
const pdfjsBuild =
  typeof PDFJSDev !== 'undefined' ? PDFJSDev.eval('BUNDLE_BUILD') : void 0

window.PDFViewerApplication = PDFViewerApplication
window.PDFViewerApplicationOptions = AppOptions

if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('CHROME')) {
  var defaultUrl; // eslint-disable-line no-var

  (function rewriteUrlClosure () {
    // Run this code outside DOMContentLoaded to make sure that the URL
    // is rewritten as soon as possible.
    const queryString = document.location.search.slice(1)
    const m = /(^|&)file=([^&]*)/.exec(queryString)
    defaultUrl = m ? decodeURIComponent(m[2]) : ''

    // Example: chrome-extension://.../http://example.com/file.pdf
    const humanReadableUrl = '/' + defaultUrl + location.hash
    history.replaceState(history.state, '', humanReadableUrl)
    if (top === window) {
      // eslint-disable-next-line no-undef
      chrome.runtime.sendMessage('showPageAction')
    }
  })()
}

function getViewerConfiguration (element) {
  let errorWrapper = null
  if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('MOZCENTRAL')) {
    errorWrapper = {
      container: element.querySelector('#errorWrapper'),
      errorMessage: element.querySelector('#errorMessage'),
      closeButton: element.querySelector('#errorClose'),
      errorMoreInfo: element.querySelector('#errorMoreInfo'),
      moreInfoButton: element.querySelector('#errorShowMore'),
      lessInfoButton: element.querySelector('#errorShowLess'),
    }
  }

  return {
    appContainer: element,
    mainContainer: element.querySelector('#viewerContainer'),
    viewerContainer: element.querySelector('#viewer'),
    toolbar: {
      rectAnno: element.querySelector('#rectAnno'),
      container: element.querySelector('#toolbarViewer'),
      numPages: element.querySelector('#numPages'),
      pageNumber: element.querySelector('#pageNumber'),
      scaleSelect: element.querySelector('#scaleSelect'),
      customScaleOption: element.querySelector('#customScaleOption'),
      previous: element.querySelector('#previous'),
      next: element.querySelector('#next'),
      zoomIn: element.querySelector('#zoomIn'),
      zoomOut: element.querySelector('#zoomOut'),
      viewFind: element.querySelector('#viewFind'),
      openFile: element.querySelector('#openFile'),
      print: element.querySelector('#print'),
      presentationModeButton: element.querySelector('#presentationMode'),
      download: element.querySelector('#download'),
      viewBookmark: element.querySelector('#viewBookmark'),
    },
    secondaryToolbar: {
      toolbar: element.querySelector('#secondaryToolbar'),
      toggleButton: element.querySelector('#secondaryToolbarToggle'),
      toolbarButtonContainer: element.querySelector(
        '#secondaryToolbarButtonContainer'),
      presentationModeButton: element.querySelector(
        '#secondaryPresentationMode'),
      openFileButton: element.querySelector('#secondaryOpenFile'),
      printButton: element.querySelector('#secondaryPrint'),
      downloadButton: element.querySelector('#secondaryDownload'),
      viewBookmarkButton: element.querySelector('#secondaryViewBookmark'),
      firstPageButton: element.querySelector('#firstPage'),
      lastPageButton: element.querySelector('#lastPage'),
      pageRotateCwButton: element.querySelector('#pageRotateCw'),
      pageRotateCcwButton: element.querySelector('#pageRotateCcw'),
      cursorSelectToolButton: element.querySelector('#cursorSelectTool'),
      cursorHandToolButton: element.querySelector('#cursorHandTool'),
      scrollPageButton: element.querySelector('#scrollPage'),
      scrollVerticalButton: element.querySelector('#scrollVertical'),
      scrollHorizontalButton: element.querySelector('#scrollHorizontal'),
      scrollWrappedButton: element.querySelector('#scrollWrapped'),
      spreadNoneButton: element.querySelector('#spreadNone'),
      spreadOddButton: element.querySelector('#spreadOdd'),
      spreadEvenButton: element.querySelector('#spreadEven'),
      documentPropertiesButton: element.querySelector('#documentProperties'),
    },
    sidebar: {
      // Divs (and sidebar button)
      outerContainer: element.querySelector('#outerContainer'),
      viewerContainer: element.querySelector('#viewerContainer'),
      toggleButton: element.querySelector('#sidebarToggle'),
      // Buttons
      thumbnailButton: element.querySelector('#viewThumbnail'),
      outlineButton: element.querySelector('#viewOutline'),
      attachmentsButton: element.querySelector('#viewAttachments'),
      layersButton: element.querySelector('#viewLayers'),
      // Views
      thumbnailView: element.querySelector('#thumbnailView'),
      outlineView: element.querySelector('#outlineView'),
      attachmentsView: element.querySelector('#attachmentsView'),
      layersView: element.querySelector('#layersView'),
      // View-specific options
      outlineOptionsContainer: element.querySelector(
        '#outlineOptionsContainer'),
      currentOutlineItemButton: element.querySelector('#currentOutlineItem'),
    },
    sidebarResizer: {
      outerContainer: element.querySelector('#outerContainer'),
      resizer: element.querySelector('#sidebarResizer'),
    },
    findBar: {
      bar: element.querySelector('#findbar'),
      toggleButton: element.querySelector('#viewFind'),
      findField: element.querySelector('#findInput'),
      highlightAllCheckbox: element.querySelector('#findHighlightAll'),
      caseSensitiveCheckbox: element.querySelector('#findMatchCase'),
      matchDiacriticsCheckbox: element.querySelector('#findMatchDiacritics'),
      entireWordCheckbox: element.querySelector('#findEntireWord'),
      findMsg: element.querySelector('#findMsg'),
      findResultsCount: element.querySelector('#findResultsCount'),
      findPreviousButton: element.querySelector('#findPrevious'),
      findNextButton: element.querySelector('#findNext'),
    },
    passwordOverlay: {
      overlayName: 'passwordOverlay',
      container: element.querySelector('#passwordOverlay'),
      label: element.querySelector('#passwordText'),
      input: element.querySelector('#password'),
      submitButton: element.querySelector('#passwordSubmit'),
      cancelButton: element.querySelector('#passwordCancel'),
    },
    documentProperties: {
      overlayName: 'documentPropertiesOverlay',
      container: element.querySelector('#documentPropertiesOverlay'),
      closeButton: element.querySelector('#documentPropertiesClose'),
      fields: {
        fileName: element.querySelector('#fileNameField'),
        fileSize: element.querySelector('#fileSizeField'),
        title: element.querySelector('#titleField'),
        author: element.querySelector('#authorField'),
        subject: element.querySelector('#subjectField'),
        keywords: element.querySelector('#keywordsField'),
        creationDate: element.querySelector('#creationDateField'),
        modificationDate: element.querySelector('#modificationDateField'),
        creator: element.querySelector('#creatorField'),
        producer: element.querySelector('#producerField'),
        version: element.querySelector('#versionField'),
        pageCount: element.querySelector('#pageCountField'),
        pageSize: element.querySelector('#pageSizeField'),
        linearized: element.querySelector('#linearizedField'),
      },
    },
    errorWrapper,
    printContainer: element.querySelector('#printContainer'),
    openFileInputName: 'fileInput',
    debuggerScriptPath: './debugger.js',
  }
}

// NOTE
function webViewerLoad (file, element, pdfPage, annoId) {
  const pdf = new PDFViewerApplication(pdfPage)
  pdf.annoId = annoId
  const config = getViewerConfiguration(element)
  if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('PRODUCTION')) {
    config.file = file
  } else {
    if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('CHROME')) {
      AppOptions.set('defaultUrl', defaultUrl)
    }

    if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('GENERIC')) {
      // Give custom implementations of the default viewer a simpler way to
      // set various `AppOptions`, by dispatching an event once all viewer
      // files are loaded but *before* the viewer initialization has run.
      const event = document.createEvent('CustomEvent')
      event.initCustomEvent('webviewerloaded', true, true, {
        source: window,
      })
      try {
        // Attempt to dispatch the event at the embedding `document`,
        // in order to support cases where the viewer is embedded in
        // a *dynamically* created <iframe> element.
        parent.document.dispatchEvent(event)
      } catch (ex) {
        // The viewer could be in e.g. a cross-origin <iframe> element,
        // fallback to dispatching the event at the current `document`.
        console.error(`webviewerloaded: ${ex}`)
        document.dispatchEvent(event)
      }
    }
  }
  pdf.run(config)
  initAnno(file, element, annoId, pdf, config);
  return pdf
}

// Block the "load" event until all pages are loaded, to ensure that printing
// works in Firefox; see https://bugzilla.mozilla.org/show_bug.cgi?id=1618553
if (document.blockUnblockOnload) {
  document.blockUnblockOnload(true)
}

export { PDFViewerApplication, webViewerLoad }
