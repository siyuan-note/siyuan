/* Copyright 2012 Mozilla Foundation
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

import {
  animationStarted,
  apiPageLayoutToViewerModes,
  apiPageModeToSidebarView,
  AutoPrintRegExp,
  DEFAULT_SCALE_VALUE,
  getActiveOrFocusedElement,
  isValidRotation,
  isValidScrollMode,
  isValidSpreadMode,
  noContextMenuHandler,
  normalizeWheelEventDirection,
  parseQueryString,
  ProgressBar,
  RendererType,
  RenderingStates,
  ScrollMode,
  SidebarView,
  SpreadMode,
  TextLayerMode,
} from './ui_utils.js'
import {
  AnnotationEditorType,
  build,
  createPromiseCapability,
  getDocument,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  GlobalWorkerOptions,
  InvalidPDFException,
  isPdfFile,
  loadScript,
  MissingPDFException,
  OPS,
  PDFWorker,
  shadow,
  UnexpectedResponseException,
  UNSUPPORTED_FEATURES,
  version,
} from './pdfjs'
import { AppOptions, OptionKind } from './app_options.js'
import { AutomationEventBus, EventBus } from './event_utils.js'
import { CursorTool, PDFCursorTools } from './pdf_cursor_tools.js'
import { LinkTarget, PDFLinkService } from './pdf_link_service.js'
import { AnnotationEditorParams } from './annotation_editor_params.js'
import { OverlayManager } from './overlay_manager.js'
import { PasswordPrompt } from './password_prompt.js'
import { PDFAttachmentViewer } from './pdf_attachment_viewer.js'
import { PDFDocumentProperties } from './pdf_document_properties.js'
import { PDFFindBar } from './pdf_find_bar.js'
import { PDFFindController } from './pdf_find_controller.js'
import { PDFHistory } from './pdf_history.js'
import { PDFLayerViewer } from './pdf_layer_viewer.js'
import { PDFOutlineViewer } from './pdf_outline_viewer.js'
import { PDFPresentationMode } from './pdf_presentation_mode.js'
import { PDFRenderingQueue } from './pdf_rendering_queue.js'
import { PDFScriptingManager } from './pdf_scripting_manager.js'
import { PDFSidebar } from './pdf_sidebar.js'
import { PDFSidebarResizer } from './pdf_sidebar_resizer.js'
import { PDFThumbnailViewer } from './pdf_thumbnail_viewer.js'
import { PDFViewer } from './pdf_viewer.js'
import { SecondaryToolbar } from './secondary_toolbar.js'
import { Toolbar } from './toolbar.js'
import { ViewHistory } from './view_history.js'
import { Constants } from '../../constants'
import { GenericExternalServices } from './genericcom'
import { getPdfInstance, hlPDFRect } from '../anno'

const DISABLE_AUTO_FETCH_LOADING_BAR_TIMEOUT = 5000 // ms
const FORCE_PAGES_LOADED_TIMEOUT = 10000 // ms
const WHEEL_ZOOM_DISABLED_TIMEOUT = 1000 // ms

const ViewOnLoad = {
  UNKNOWN: -1,
  PREVIOUS: 0, // Default value.
  INITIAL: 1,
}

const ViewerCssTheme = {
  AUTOMATIC: 0, // Default value.
  LIGHT: 1,
  DARK: 2,
}

// Keep these in sync with mozilla-central's Histograms.json.
const KNOWN_VERSIONS = [
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '1.8',
  '1.9',
  '2.0',
  '2.1',
  '2.2',
  '2.3',
]
// Keep these in sync with mozilla-central's Histograms.json.
const KNOWN_GENERATORS = [
  'acrobat distiller',
  'acrobat pdfwriter',
  'adobe livecycle',
  'adobe pdf library',
  'adobe photoshop',
  'ghostscript',
  'tcpdf',
  'cairo',
  'dvipdfm',
  'dvips',
  'pdftex',
  'pdfkit',
  'itext',
  'prince',
  'quarkxpress',
  'mac os x',
  'microsoft',
  'openoffice',
  'oracle',
  'luradocument',
  'pdf-xchange',
  'antenna house',
  'aspose.cells',
  'fpdf',
]

class PDFViewerApplication {
  constructor (pdfId) {
    this.pdfId = pdfId
    this.initialBookmark = document.location.hash.substring(1)
    this._initializedCapability = createPromiseCapability()
    this.appConfig = null
    this.pdfDocument = null
    this.pdfLoadingTask = null
    this.printService = null
    /** @type {PDFViewer} */
    this.pdfViewer = null
    /** @type {PDFThumbnailViewer} */
    this.pdfThumbnailViewer = null
    /** @type {PDFRenderingQueue} */
    this.pdfRenderingQueue = null
    /** @type {PDFPresentationMode} */
    this.pdfPresentationMode = null
    /** @type {PDFDocumentProperties} */
    this.pdfDocumentProperties = null
    /** @type {PDFLinkService} */
    this.pdfLinkService = null
    /** @type {PDFHistory} */
    this.pdfHistory = null
    /** @type {PDFSidebar} */
    this.pdfSidebar = null
    /** @type {PDFSidebarResizer} */
    this.pdfSidebarResizer = null
    /** @type {PDFOutlineViewer} */
    this.pdfOutlineViewer = null
    /** @type {PDFAttachmentViewer} */
    this.pdfAttachmentViewer = null
    /** @type {PDFLayerViewer} */
    this.pdfLayerViewer = null
    /** @type {PDFCursorTools} */
    this.pdfCursorTools = null
    /** @type {PDFScriptingManager} */
    this.pdfScriptingManager = null
    /** @type {ViewHistory} */
    this.store = null
    /** @type {DownloadManager} */
    this.downloadManager = null
    /** @type {OverlayManager} */
    this.overlayManager = null
    /** @type {Preferences} */
    this.preferences = null
    /** @type {Toolbar} */
    this.toolbar = null
    /** @type {SecondaryToolbar} */
    this.secondaryToolbar = null
    /** @type {EventBus} */
    this.eventBus = null
    /** @type {IL10n} */
    this.l10n = null
    /** @type {AnnotationEditorParams} */
    this.annotationEditorParams = null
    this.isInitialViewSet = false
    this.downloadComplete = false
    this.isViewerEmbedded = window.parent !== window
    this.url = ''
    this.baseUrl = ''
    this._downloadUrl = ''
    this.externalServices = GenericExternalServices
    this._boundEvents = Object.create(null)
    this.documentInfo = null
    this.metadata = null
    this._contentDispositionFilename = null
    this._contentLength = null
    this._saveInProgress = false
    this._docStats = null
    this._wheelUnusedTicks = 0
    this._PDFBug = null
    this._hasAnnotationEditors = false
    this._title = document.title
    this._printAnnotationStoragePromise = null
  }

  // Called once when the document is loaded.
  async initialize (appConfig) {
    this.preferences = this.externalServices.createPreferences()
    this.appConfig = appConfig

    await this._readPreferences()
    await this._parseHashParameters()
    this._forceCssTheme()

    if (
      this.isViewerEmbedded &&
      AppOptions.get('externalLinkTarget') === LinkTarget.NONE
    ) {
      // Prevent external links from "replacing" the viewer,
      // when it's embedded in e.g. an <iframe> or an <object>.
      AppOptions.set('externalLinkTarget', LinkTarget.TOP)
    }
    await this._initializeViewerComponents()

    // Bind the various event handlers *after* the viewer has been
    // initialized, to prevent errors if an event arrives too soon.
    this.bindEvents()
    this.bindWindowEvents()

    this.eventBus.dispatch('localized', {source: this})
    this._initializedCapability.resolve()
  }

  /**
   * @private
   */
  async _readPreferences () {
    if (
      typeof PDFJSDev === 'undefined' ||
      PDFJSDev.test('!PRODUCTION || GENERIC')
    ) {
      if (AppOptions.get('disablePreferences')) {
        // Give custom implementations of the default viewer a simpler way to
        // opt-out of having the `Preferences` override existing `AppOptions`.
        return
      }
      if (AppOptions._hasUserOptions()) {
        console.warn(
          '_readPreferences: The Preferences may override manually set AppOptions; ' +
          'please use the "disablePreferences"-option in order to prevent that.',
        )
      }
    }
    try {
      AppOptions.setAll(await this.preferences.getAll())
    } catch (reason) {
      console.error(`_readPreferences: "${reason?.message}".`)
    }
  }

  /**
   * Potentially parse special debugging flags in the hash section of the URL.
   * @private
   */
  async _parseHashParameters () {
    if (!AppOptions.get('pdfBugEnabled')) {
      return
    }
    const hash = document.location.hash.substring(1)
    if (!hash) {
      return
    }
    const {mainContainer, viewerContainer} = this.appConfig,
      params = parseQueryString(hash)

    if (params.get('disableworker') === 'true') {
      try {
        await loadFakeWorker()
      } catch (ex) {
        console.error(`_parseHashParameters: "${ex.message}".`)
      }
    }
    if (params.has('disablerange')) {
      AppOptions.set('disableRange', params.get('disablerange') === 'true')
    }
    if (params.has('disablestream')) {
      AppOptions.set('disableStream', params.get('disablestream') === 'true')
    }
    if (params.has('disableautofetch')) {
      AppOptions.set(
        'disableAutoFetch',
        params.get('disableautofetch') === 'true',
      )
    }
    if (params.has('disablefontface')) {
      AppOptions.set(
        'disableFontFace',
        params.get('disablefontface') === 'true',
      )
    }
    if (params.has('disablehistory')) {
      AppOptions.set('disableHistory', params.get('disablehistory') === 'true')
    }
    if (params.has('verbosity')) {
      AppOptions.set('verbosity', params.get('verbosity') | 0)
    }
    if (params.has('textlayer')) {
      switch (params.get('textlayer')) {
        case 'off':
          AppOptions.set('textLayerMode', TextLayerMode.DISABLE)
          break
        case 'visible':
        case 'shadow':
        case 'hover':
          viewerContainer.classList.add(`textLayer-${params.get('textlayer')}`)
          // NOTE
          // try {
          //   await loadPDFBug(this)
          //   this._PDFBug.loadCSS()
          // } catch (ex) {
          //   console.error(`_parseHashParameters: "${ex.message}".`)
          // }
          break
      }
    }
    if (params.has('pdfbug')) {
      AppOptions.set('pdfBug', true)
      AppOptions.set('fontExtraProperties', true)

      const enabled = params.get('pdfbug').split(',')
      // NOTE
      // try {
      //   await loadPDFBug(this)
      //   this._PDFBug.init({OPS}, mainContainer, enabled)
      // } catch (ex) {
      //   console.error(`_parseHashParameters: "${ex.message}".`)
      // }
    }
    // It is not possible to change locale for the (various) extension builds.
    if (
      (typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || GENERIC')) &&
      params.has('locale')
    ) {
      AppOptions.set('locale', params.get('locale'))
    }
  }

  /**
   * @private
   */
  _forceCssTheme () {
    const cssTheme = AppOptions.get('viewerCssTheme')
    if (
      cssTheme === ViewerCssTheme.AUTOMATIC ||
      !Object.values(ViewerCssTheme).includes(cssTheme)
    ) {
      return
    }
    try {
      const styleSheet = document.styleSheets[0]
      const cssRules = styleSheet?.cssRules || []
      for (let i = 0, ii = cssRules.length; i < ii; i++) {
        const rule = cssRules[i]
        if (
          rule instanceof CSSMediaRule &&
          rule.media?.[0] === '(prefers-color-scheme: dark)'
        ) {
          if (cssTheme === ViewerCssTheme.LIGHT) {
            styleSheet.deleteRule(i)
            return
          }
          // cssTheme === ViewerCssTheme.DARK
          const darkRules =
            /^@media \(prefers-color-scheme: dark\) {\n\s*([\w\s-.,:;/\\{}()]+)\n}$/.exec(
              rule.cssText,
            )
          if (darkRules?.[1]) {
            styleSheet.deleteRule(i)
            styleSheet.insertRule(darkRules[1], i)
          }
          return
        }
      }
    } catch (reason) {
      console.error(`_forceCssTheme: "${reason?.message}".`)
    }
  }

  /**
   * @private
   */
  async _initializeViewerComponents () {
    const {appConfig, externalServices} = this

    const eventBus = externalServices.isInAutomation
      ? new AutomationEventBus()
      : new EventBus()
    this.eventBus = eventBus

    this.overlayManager = new OverlayManager()

    const pdfRenderingQueue = new PDFRenderingQueue()
    pdfRenderingQueue.onIdle = this._cleanup.bind(this)
    this.pdfRenderingQueue = pdfRenderingQueue

    const pdfLinkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: AppOptions.get('externalLinkTarget'),
      externalLinkRel: AppOptions.get('externalLinkRel'),
      ignoreDestinationZoom: AppOptions.get('ignoreDestinationZoom'),
    })
    this.pdfLinkService = pdfLinkService

    const downloadManager = externalServices.createDownloadManager()
    this.downloadManager = downloadManager

    const findController = new PDFFindController({
      linkService: pdfLinkService,
      eventBus,
    })
    this.findController = findController

    const pdfScriptingManager = new PDFScriptingManager({
      eventBus,
      sandboxBundleSrc:
        typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || GENERIC || CHROME')
          ? AppOptions.get('sandboxBundleSrc')
          : null,
      scriptingFactory: externalServices,
      docPropertiesLookup: this._scriptingDocProperties.bind(this),
    })
    this.pdfScriptingManager = pdfScriptingManager

    const container = appConfig.mainContainer,
      viewer = appConfig.viewerContainer
    const annotationEditorMode = AppOptions.get('annotationEditorMode')
    const pageColors =
      AppOptions.get('forcePageColors') ||
      window.matchMedia('(forced-colors: active)').matches
        ? {
          background: AppOptions.get('pageColorsBackground'),
          foreground: AppOptions.get('pageColorsForeground'),
        }
        : null

    this.pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      downloadManager,
      findController,
      scriptingManager:
        AppOptions.get('enableScripting') && pdfScriptingManager,
      renderer:
        typeof PDFJSDev === 'undefined' ||
        PDFJSDev.test('!PRODUCTION || GENERIC')
          ? AppOptions.get('renderer')
          : null,
      l10n: this.l10n,
      textLayerMode: AppOptions.get('textLayerMode'),
      annotationMode: AppOptions.get('annotationMode'),
      annotationEditorMode,
      imageResourcesPath: AppOptions.get('imageResourcesPath'),
      enablePrintAutoRotate: AppOptions.get('enablePrintAutoRotate'),
      useOnlyCssZoom: AppOptions.get('useOnlyCssZoom'),
      maxCanvasPixels: AppOptions.get('maxCanvasPixels'),
      enablePermissions: AppOptions.get('enablePermissions'),
      pageColors,
    })
    pdfRenderingQueue.setViewer(this.pdfViewer)
    pdfLinkService.setViewer(this.pdfViewer)
    pdfScriptingManager.setViewer(this.pdfViewer)

    this.pdfThumbnailViewer = new PDFThumbnailViewer({
      container: appConfig.sidebar.thumbnailView,
      eventBus,
      renderingQueue: pdfRenderingQueue,
      linkService: pdfLinkService,
      l10n: this.l10n,
      pageColors,
    })
    pdfRenderingQueue.setThumbnailViewer(this.pdfThumbnailViewer)

    // The browsing history is only enabled when the viewer is standalone,
    // i.e. not when it is embedded in a web page.
    if (!this.isViewerEmbedded && !AppOptions.get('disableHistory')) {
      this.pdfHistory = new PDFHistory({
        linkService: pdfLinkService,
        eventBus,
      })
      pdfLinkService.setHistory(this.pdfHistory)
    }

    if (!this.supportsIntegratedFind) {
      this.findBar = new PDFFindBar(appConfig.findBar, eventBus, this.l10n)
    }

    if (annotationEditorMode !== AnnotationEditorType.DISABLE) {
      this.annotationEditorParams = new AnnotationEditorParams(
        appConfig.annotationEditorParams,
        eventBus,
      )
    } else {
      for (const element of [
        document.getElementById('editorModeButtons'),
        document.getElementById('editorModeSeparator'),
      ]) {
        element.hidden = true
      }
    }

    this.pdfDocumentProperties = new PDFDocumentProperties(
      appConfig.documentProperties,
      this.overlayManager,
      eventBus,
      this.l10n,
      /* fileNameLookup = */ () => {
        return this._docFilename
      },
    )

    this.pdfCursorTools = new PDFCursorTools({
      container,
      eventBus,
      cursorToolOnLoad: AppOptions.get('cursorToolOnLoad'),
    })

    this.toolbar = new Toolbar(appConfig.toolbar, eventBus, this.l10n)

    this.secondaryToolbar = new SecondaryToolbar(
      appConfig.secondaryToolbar,
      eventBus,
      this.externalServices,
    )

    if (this.supportsFullscreen) {
      this.pdfPresentationMode = new PDFPresentationMode({
        container,
        pdfViewer: this.pdfViewer,
        eventBus,
      })
    }

    this.passwordPrompt = new PasswordPrompt(
      appConfig.passwordOverlay,
      this.overlayManager,
      this.l10n,
      this.isViewerEmbedded,
    )

    this.pdfOutlineViewer = new PDFOutlineViewer({
      container: appConfig.sidebar.outlineView,
      eventBus,
      linkService: pdfLinkService,
    })

    this.pdfAttachmentViewer = new PDFAttachmentViewer({
      container: appConfig.sidebar.attachmentsView,
      eventBus,
      downloadManager,
    })

    this.pdfLayerViewer = new PDFLayerViewer({
      container: appConfig.sidebar.layersView,
      eventBus,
      l10n: this.l10n,
    })

    this.pdfSidebar = new PDFSidebar({
      elements: appConfig.sidebar,
      pdfViewer: this.pdfViewer,
      pdfThumbnailViewer: this.pdfThumbnailViewer,
      eventBus,
      l10n: this.l10n,
    })
    this.pdfSidebar.onToggled = this.forceRendering.bind(this)

    this.pdfSidebarResizer = new PDFSidebarResizer(
      appConfig.sidebarResizer,
      eventBus,
      this.l10n,
    )
  }

  run (config) {
    // NOTE
    this.initialize(config).then(webViewerInitialized(this))
  }

  get initialized () {
    return this._initializedCapability.settled
  }

  get initializedPromise () {
    return this._initializedCapability.promise
  }

  zoomIn (steps) {
    if (this.pdfViewer.isInPresentationMode) {
      return
    }
    this.pdfViewer.increaseScale(steps)
  }

  zoomOut (steps) {
    if (this.pdfViewer.isInPresentationMode) {
      return
    }
    this.pdfViewer.decreaseScale(steps)
  }

  zoomReset () {
    if (this.pdfViewer.isInPresentationMode) {
      return
    }
    this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE
  }

  get pagesCount () {
    return this.pdfDocument ? this.pdfDocument.numPages : 0
  }

  get page () {
    return this.pdfViewer.currentPageNumber
  }

  set page (val) {
    this.pdfViewer.currentPageNumber = val
  }

  get supportsPrinting () {
    return PDFPrintServiceFactory.instance.supportsPrinting
  }

  get supportsFullscreen () {
    return shadow(this, 'supportsFullscreen', document.fullscreenEnabled)
  }

  get supportsIntegratedFind () {
    return this.externalServices.supportsIntegratedFind
  }

  get supportsDocumentFonts () {
    return this.externalServices.supportsDocumentFonts
  }

  get loadingBar () {
    const bar = new ProgressBar('loadingBar')
    return shadow(this, 'loadingBar', bar)
  }

  get supportedMouseWheelZoomModifierKeys () {
    return this.externalServices.supportedMouseWheelZoomModifierKeys
  }

  initPassiveLoading () {
    if (
      typeof PDFJSDev === 'undefined' ||
      !PDFJSDev.test('MOZCENTRAL || CHROME')
    ) {
      throw new Error('Not implemented: initPassiveLoading')
    }
    this.externalServices.initPassiveLoading({
      onOpenWithTransport: (url, length, transport) => {
        this.open(url, {length, range: transport})
      },
      onOpenWithData: (data, contentDispositionFilename) => {
        if (isPdfFile(contentDispositionFilename)) {
          this._contentDispositionFilename = contentDispositionFilename
        }
        this.open(data)
      },
      onOpenWithURL: (url, length, originalUrl) => {
        const file = originalUrl !== undefined ? {url, originalUrl} : url
        const args = length !== undefined ? {length} : null

        this.open(file, args)
      },
      onError: err => {
        this._documentError(window.siyuan.languages.loadingError, err)
      },
      onProgress: (loaded, total) => {
        this.progress(loaded / total)
      },
    })
  }

  setTitleUsingUrl (url = '', downloadUrl = null) {
    this.url = url
    this.baseUrl = url.split('#')[0]
    if (downloadUrl) {
      this._downloadUrl =
        downloadUrl === url ? this.baseUrl : downloadUrl.split('#')[0]
    }
    let title = getPdfFilenameFromUrl(url, '')
    if (!title) {
      try {
        title = decodeURIComponent(getFilenameFromUrl(url)) || url
      } catch (ex) {
        // decodeURIComponent may throw URIError,
        // fall back to using the unprocessed url in that case
        title = url
      }
    }
    this.setTitle(title)
  }

  setTitle (title = this._title) {
    this._title = title

    if (this.isViewerEmbedded) {
      // Embedded PDF viewers should not be changing their parent page's title.
      return
    }
    const editorIndicator =
      this._hasAnnotationEditors && !this.pdfRenderingQueue.printing
    // NOTE document.title = `${editorIndicator ? '* ' : ''}${title}`
  }

  get _docFilename () {
    // Use `this.url` instead of `this.baseUrl` to perform filename detection
    // based on the reference fragment as ultimate fallback if needed.
    return this._contentDispositionFilename || getPdfFilenameFromUrl(this.url)
  }

  /**
   * @private
   */
  _hideViewBookmark () {
    // URL does not reflect proper document location - hiding some buttons.
    this.appConfig.secondaryToolbar.viewBookmarkButton.hidden = true
  }

  /**
   * Closes opened PDF document.
   * @returns {Promise} - Returns the promise, which is resolved when all
   *                      destruction is completed.
   */
  async close () {
    this._unblockDocumentLoadEvent()
    this._hideViewBookmark()

    if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('MOZCENTRAL')) {
      const {container} = this.appConfig.errorWrapper
      container.hidden = true
    }

    if (!this.pdfLoadingTask) {
      return
    }
    if (
      (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) &&
      this.pdfDocument?.annotationStorage.size > 0 &&
      this._annotationStorageModified
    ) {
      try {
        // Trigger saving, to prevent data loss in forms; see issue 12257.
        await this.save()
      } catch (reason) {
        // Ignoring errors, to ensure that document closing won't break.
      }
    }
    const promises = []

    promises.push(this.pdfLoadingTask.destroy())
    this.pdfLoadingTask = null

    if (this.pdfDocument) {
      this.pdfDocument = null

      this.pdfThumbnailViewer.setDocument(null)
      this.pdfViewer.setDocument(null)
      this.pdfLinkService.setDocument(null)
      this.pdfDocumentProperties.setDocument(null)
    }
    this.pdfLinkService.externalLinkEnabled = true
    this.store = null
    this.isInitialViewSet = false
    this.downloadComplete = false
    this.url = ''
    this.baseUrl = ''
    this._downloadUrl = ''
    this.documentInfo = null
    this.metadata = null
    this._contentDispositionFilename = null
    this._contentLength = null
    this._saveInProgress = false
    this._docStats = null
    this._hasAnnotationEditors = false

    promises.push(this.pdfScriptingManager.destroyPromise)

    this.setTitle()
    this.pdfSidebar.reset()
    this.pdfOutlineViewer.reset()
    this.pdfAttachmentViewer.reset()
    this.pdfLayerViewer.reset()

    this.pdfHistory?.reset()
    this.findBar?.reset()
    this.toolbar.reset()
    this.secondaryToolbar.reset()
    this._PDFBug?.cleanup()

    await Promise.all(promises)
  }

  /**
   * Opens PDF document specified by URL or array with additional arguments.
   * @param {string|TypedArray|ArrayBuffer} file - PDF location or binary data.
   * @param {Object} [args] - Additional arguments for the getDocument call,
   *                          e.g. HTTP headers ('httpHeaders') or alternative
   *                          data transport ('range').
   * @returns {Promise} - Returns the promise, which is resolved when document
   *                      is opened.
   */
  async open (file, args) {
    if (this.pdfLoadingTask) {
      // We need to destroy already opened document.
      await this.close()
    }
    // Set the necessary global worker parameters, using the available options.
    const workerParameters = AppOptions.getAll(OptionKind.WORKER)
    for (const key in workerParameters) {
      GlobalWorkerOptions[key] = workerParameters[key]
    }

    const parameters = Object.create(null)
    if (typeof file === 'string') {
      // URL
      this.setTitleUsingUrl(file, /* downloadUrl = */ file)
      parameters.url = file
    } else if (file && 'byteLength' in file) {
      // ArrayBuffer
      parameters.data = file
    } else if (file.url && file.originalUrl) {
      this.setTitleUsingUrl(file.originalUrl, /* downloadUrl = */ file.url)
      parameters.url = file.url
    }
    // Set the necessary API parameters, using the available options.
    const apiParameters = AppOptions.getAll(OptionKind.API)
    for (const key in apiParameters) {
      let value = apiParameters[key]

      if (key === 'docBaseUrl' && !value) {
        if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('PRODUCTION')) {
          value = document.URL.split('#')[0]
        } else if (PDFJSDev.test('MOZCENTRAL || CHROME')) {
          value = this.baseUrl
        }
      }
      parameters[key] = value
    }
    // Finally, update the API parameters with the arguments (if they exist).
    if (args) {
      for (const key in args) {
        parameters[key] = args[key]
      }
    }

    const loadingTask = getDocument(parameters)
    this.pdfLoadingTask = loadingTask

    loadingTask.onPassword = (updateCallback, reason) => {
      this.pdfLinkService.externalLinkEnabled = false
      this.passwordPrompt.setUpdateCallback(updateCallback, reason)
      this.passwordPrompt.open()
    }

    loadingTask.onProgress = ({loaded, total}) => {
      this.progress(loaded / total)
    }

    // Listen for unsupported features to report telemetry.
    loadingTask.onUnsupportedFeature = this.fallback.bind(this)

    return loadingTask.promise.then(
      pdfDocument => {
        this.load(pdfDocument)
      },
      reason => {
        if (loadingTask !== this.pdfLoadingTask) {
          return undefined // Ignore errors for previously opened PDF files.
        }

        // NOTE
        let key = 'loadingError'
        if (reason instanceof InvalidPDFException) {
          key = 'invalidFileError'
        } else if (reason instanceof MissingPDFException) {
          key = 'missingFileError'
        } else if (reason instanceof UnexpectedResponseException) {
          key = 'unexpectedResponseError'
        }
        this._documentError(window.siyuan.languages[key],
          {message: reason?.message})
        throw reason
      },
    )
  }

  /**
   * @private
   */
  _ensureDownloadComplete () {
    if (this.pdfDocument && this.downloadComplete) {
      return
    }
    throw new Error('PDF document not downloaded.')
  }

  async download () {
    const url = this._downloadUrl,
      filename = this._docFilename
    try {
      this._ensureDownloadComplete()

      const data = await this.pdfDocument.getData()
      const blob = new Blob([data], {type: 'application/pdf'})

      await this.downloadManager.download(blob, url, filename)
    } catch (reason) {
      // When the PDF document isn't ready, or the PDF file is still
      // downloading, simply download using the URL.
      await this.downloadManager.downloadUrl(url, filename)
    }
  }

  async save () {
    if (this._saveInProgress) {
      return
    }
    this._saveInProgress = true
    await this.pdfScriptingManager.dispatchWillSave()

    const url = this._downloadUrl,
      filename = this._docFilename
    try {
      this._ensureDownloadComplete()

      const data = await this.pdfDocument.saveDocument()
      const blob = new Blob([data], {type: 'application/pdf'})

      await this.downloadManager.download(blob, url, filename)
    } catch (reason) {
      // When the PDF document isn't ready, or the PDF file is still
      // downloading, simply fallback to a "regular" download.
      console.error(`Error when saving the document: ${reason.message}`)
      await this.download()
    } finally {
      await this.pdfScriptingManager.dispatchDidSave()
      this._saveInProgress = false
    }

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: 'editing',
        data: {type: 'save'},
      })
    }
  }

  downloadOrSave () {
    if (this.pdfDocument?.annotationStorage.size > 0) {
      this.save()
    } else {
      this.download()
    }
  }

  fallback (featureId) {
    this.externalServices.reportTelemetry({
      type: 'unsupportedFeature',
      featureId,
    })
  }

  /**
   * Show the error box; used for errors affecting loading and/or parsing of
   * the entire PDF document.
   */
  _documentError (message, moreInfo = null) {
    this._unblockDocumentLoadEvent()

    this._otherError(message, moreInfo)

    this.eventBus.dispatch('documenterror', {
      source: this,
      message,
      reason: moreInfo?.message ?? null,
    })
  }

  /**
   * Show the error box; used for errors affecting e.g. only a single page.
   *
   * @param {string} message - A message that is human readable.
   * @param {Object} [moreInfo] - Further information about the error that is
   *                              more technical.  Should have a 'message' and
   *                              optionally a 'stack' property.
   */
  _otherError (message, moreInfo = null) {
    // NOTE
    const moreInfoText = [
      `PDF.js v${version || '?'} (build: ${build || '?'})`,
    ]
    if (moreInfo) {
      moreInfoText.push(`Message: ${moreInfo.message}`)
      if (moreInfo.stack) {
        moreInfoText.push(`Stack: ${moreInfo.stack}`)
      } else {
        if (moreInfo.filename) {
          moreInfoText.push(`File: ${moreInfo.filename}`)
        }
        if (moreInfo.lineNumber) {
          moreInfoText.push(`Line: ${moreInfo.lineNumber}`)
        }
      }
    }

    if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('MOZCENTRAL')) {
      const errorWrapperConfig = this.appConfig.errorWrapper
      const errorWrapper = errorWrapperConfig.container
      errorWrapper.hidden = false

      const errorMessage = errorWrapperConfig.errorMessage
      errorMessage.textContent = message

      const closeButton = errorWrapperConfig.closeButton
      closeButton.onclick = function () {
        errorWrapper.hidden = true
      }

      const errorMoreInfo = errorWrapperConfig.errorMoreInfo
      const moreInfoButton = errorWrapperConfig.moreInfoButton
      const lessInfoButton = errorWrapperConfig.lessInfoButton
      moreInfoButton.onclick = function () {
        errorMoreInfo.hidden = false
        moreInfoButton.hidden = true
        lessInfoButton.hidden = false
        errorMoreInfo.style.height = errorMoreInfo.scrollHeight + 'px'
      }
      lessInfoButton.onclick = function () {
        errorMoreInfo.hidden = true
        moreInfoButton.hidden = false
        lessInfoButton.hidden = true
      }
      moreInfoButton.oncontextmenu = noContextMenuHandler
      lessInfoButton.oncontextmenu = noContextMenuHandler
      closeButton.oncontextmenu = noContextMenuHandler
      moreInfoButton.hidden = false
      lessInfoButton.hidden = true
      Promise.all(moreInfoText).then(parts => {
        errorMoreInfo.value = parts.join('\n')
      })
    } else {
      Promise.all(moreInfoText).then(parts => {
        console.error(message + '\n' + parts.join('\n'))
      })
      this.fallback()
    }
  }

  progress (level) {
    if (this.downloadComplete) {
      // Don't accidentally show the loading bar again when the entire file has
      // already been fetched (only an issue when disableAutoFetch is enabled).
      return
    }
    const percent = Math.round(level * 100)
    // When we transition from full request to range requests, it's possible
    // that we discard some of the loaded data. This can cause the loading
    // bar to move backwards. So prevent this by only updating the bar if it
    // increases.
    if (percent <= this.loadingBar.percent) {
      return
    }
    this.loadingBar.percent = percent

    // When disableAutoFetch is enabled, it's not uncommon for the entire file
    // to never be fetched (depends on e.g. the file structure). In this case
    // the loading bar will not be completely filled, nor will it be hidden.
    // To prevent displaying a partially filled loading bar permanently, we
    // hide it when no data has been loaded during a certain amount of time.
    const disableAutoFetch =
      this.pdfDocument?.loadingParams.disableAutoFetch ??
      AppOptions.get('disableAutoFetch')

    if (!disableAutoFetch || isNaN(percent)) {
      return
    }
    if (this.disableAutoFetchLoadingBarTimeout) {
      clearTimeout(this.disableAutoFetchLoadingBarTimeout)
      this.disableAutoFetchLoadingBarTimeout = null
    }
    this.loadingBar.show()

    this.disableAutoFetchLoadingBarTimeout = setTimeout(() => {
      this.loadingBar.hide()
      this.disableAutoFetchLoadingBarTimeout = null
    }, DISABLE_AUTO_FETCH_LOADING_BAR_TIMEOUT)
  }

  load (pdfDocument) {
    this.pdfDocument = pdfDocument

    pdfDocument.getDownloadInfo().then(({length}) => {
      this._contentLength = length // Ensure that the correct length is used.
      this.downloadComplete = true
      this.loadingBar.hide()

      firstPagePromise.then(() => {
        this.eventBus.dispatch('documentloaded', {source: this})
      })
    })

    // Since the `setInitialView` call below depends on this being resolved,
    // fetch it early to avoid delaying initial rendering of the PDF document.
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    })
    const pageModePromise = pdfDocument.getPageMode().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    })
    const openActionPromise = pdfDocument.getOpenAction().catch(function () {
      /* Avoid breaking initial rendering; ignoring errors. */
    })

    this.toolbar.setPagesCount(pdfDocument.numPages, false)
    this.secondaryToolbar.setPagesCount(pdfDocument.numPages)

    let baseDocumentUrl
    if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
      baseDocumentUrl = null
    } else if (PDFJSDev.test('MOZCENTRAL')) {
      baseDocumentUrl = this.baseUrl
    } else if (PDFJSDev.test('CHROME')) {
      baseDocumentUrl = location.href.split('#')[0]
    }
    this.pdfLinkService.setDocument(pdfDocument, baseDocumentUrl)
    this.pdfDocumentProperties.setDocument(pdfDocument)

    const pdfViewer = this.pdfViewer
    pdfViewer.setDocument(pdfDocument)
    const {firstPagePromise, onePageRendered, pagesPromise} = pdfViewer

    const pdfThumbnailViewer = this.pdfThumbnailViewer
    pdfThumbnailViewer.setDocument(pdfDocument)

    const storedPromise = (this.store = new ViewHistory(
      pdfDocument.fingerprints[0],
    )).getMultiple({
      page: null,
      zoom: DEFAULT_SCALE_VALUE,
      scrollLeft: '0',
      scrollTop: '0',
      rotation: null,
      sidebarView: SidebarView.UNKNOWN,
      scrollMode: ScrollMode.UNKNOWN,
      spreadMode: SpreadMode.UNKNOWN,
    }).catch(() => {
      /* Unable to read from storage; ignoring errors. */
      return Object.create(null)
    })

    firstPagePromise.then(pdfPage => {
      this.loadingBar.setWidth(this.appConfig.viewerContainer)
      this._initializeAnnotationStorageCallbacks(pdfDocument)

      Promise.all([
        animationStarted,
        storedPromise,
        pageLayoutPromise,
        pageModePromise,
        openActionPromise,
      ]).then(async ([timeStamp, stored, pageLayout, pageMode, openAction]) => {
        const viewOnLoad = AppOptions.get('viewOnLoad')

        this._initializePdfHistory({
          fingerprint: pdfDocument.fingerprints[0],
          viewOnLoad,
          initialDest: openAction?.dest,
        })
        const initialBookmark = this.initialBookmark

        // Initialize the default values, from user preferences.
        const zoom = AppOptions.get('defaultZoomValue')
        let hash = zoom ? `zoom=${zoom}` : null

        let rotation = null
        let sidebarView = AppOptions.get('sidebarViewOnLoad')
        let scrollMode = AppOptions.get('scrollModeOnLoad')
        let spreadMode = AppOptions.get('spreadModeOnLoad')
        if (stored.page && viewOnLoad !== ViewOnLoad.INITIAL) {
          hash =
            `page=${stored.page}&zoom=${zoom || stored.zoom},` +
            `${stored.scrollLeft},${stored.scrollTop}`

          rotation = parseInt(stored.rotation, 10)
          // Always let user preference take precedence over the view history.
          if (sidebarView === SidebarView.UNKNOWN) {
            sidebarView = stored.sidebarView | 0
          }
          if (scrollMode === ScrollMode.UNKNOWN) {
            scrollMode = stored.scrollMode | 0
          }
          if (spreadMode === SpreadMode.UNKNOWN) {
            spreadMode = stored.spreadMode | 0
          }
        }
        // Always let the user preference/view history take precedence.
        if (pageMode && sidebarView === SidebarView.UNKNOWN) {
          sidebarView = apiPageModeToSidebarView(pageMode)
        }
        if (
          pageLayout &&
          scrollMode === ScrollMode.UNKNOWN &&
          spreadMode === SpreadMode.UNKNOWN
        ) {
          const modes = apiPageLayoutToViewerModes(pageLayout)
          // TODO: Try to improve page-switching when using the mouse-wheel
          // and/or arrow-keys before allowing the document to control this.
          // scrollMode = modes.scrollMode;
          spreadMode = modes.spreadMode
        }

        this.setInitialView(hash, {
          rotation,
          sidebarView,
          scrollMode,
          spreadMode,
        })
        this.eventBus.dispatch('documentinit', {source: this})
        // Make all navigation keys work on document load,
        // unless the viewer is embedded in a web page.
        if (!this.isViewerEmbedded) {
          pdfViewer.focus()
        }

        // For documents with different page sizes, once all pages are
        // resolved, ensure that the correct location becomes visible on load.
        // (To reduce the risk, in very large and/or slow loading documents,
        //  that the location changes *after* the user has started interacting
        //  with the viewer, wait for either `pagesPromise` or a timeout.)
        await Promise.race([
          pagesPromise,
          new Promise(resolve => {
            setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT)
          }),
        ])
        // NOTE 通过引用打开
        if (this.annoId && this.pdfId) {
          webViewerPageNumberChanged(
            {value: this.pdfId, pdfInstance: this, id: this.annoId})
        }
        if (!initialBookmark && !hash) {
          return
        }
        if (pdfViewer.hasEqualPageSizes) {
          return
        }
        this.initialBookmark = initialBookmark

        // eslint-disable-next-line no-self-assign
        pdfViewer.currentScaleValue = pdfViewer.currentScaleValue
        // Re-apply the initial document location.
        this.setInitialView(hash)
      }).catch(() => {
        // Ensure that the document is always completely initialized,
        // even if there are any errors thrown above.
        this.setInitialView()
      }).then(function () {
        // At this point, rendering of the initial page(s) should always have
        // started (and may even have completed).
        // To prevent any future issues, e.g. the document being completely
        // blank on load, always trigger rendering here.
        pdfViewer.update()
      })
    })

    pagesPromise.then(
      () => {
        this._unblockDocumentLoadEvent()

        this._initializeAutoPrint(pdfDocument, openActionPromise)
      },
      reason => {
        this._documentError(window.siyuan.languages.loadingError,
          {message: reason?.message})
      },
    )

    onePageRendered.then(data => {
      this.externalServices.reportTelemetry({
        type: 'pageInfo',
        timestamp: data.timestamp,
      })

      pdfDocument.getOutline().then(outline => {
        if (pdfDocument !== this.pdfDocument) {
          return // The document was closed while the outline resolved.
        }
        this.pdfOutlineViewer.render({outline, pdfDocument})
      })
      pdfDocument.getAttachments().then(attachments => {
        if (pdfDocument !== this.pdfDocument) {
          return // The document was closed while the attachments resolved.
        }
        this.pdfAttachmentViewer.render({attachments})
      })
      // Ensure that the layers accurately reflects the current state in the
      // viewer itself, rather than the default state provided by the API.
      pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
        if (pdfDocument !== this.pdfDocument) {
          return // The document was closed while the layers resolved.
        }
        this.pdfLayerViewer.render({optionalContentConfig, pdfDocument})
      })
    })

    this._initializePageLabels(pdfDocument)
    this._initializeMetadata(pdfDocument)
  }

  /**
   * @private
   */
  async _scriptingDocProperties (pdfDocument) {
    if (!this.documentInfo) {
      // It should be *extremely* rare for metadata to not have been resolved
      // when this code runs, but ensure that we handle that case here.
      await new Promise(resolve => {
        this.eventBus._on('metadataloaded', resolve, {once: true})
      })
      if (pdfDocument !== this.pdfDocument) {
        return null // The document was closed while the metadata resolved.
      }
    }
    if (!this._contentLength) {
      // Always waiting for the entire PDF document to be loaded will, most
      // likely, delay sandbox-creation too much in the general case for all
      // PDF documents which are not provided as binary data to the API.
      // Hence we'll simply have to trust that the `contentLength` (as provided
      // by the server), when it exists, is accurate enough here.
      await new Promise(resolve => {
        this.eventBus._on('documentloaded', resolve, {once: true})
      })
      if (pdfDocument !== this.pdfDocument) {
        return null // The document was closed while the downloadInfo resolved.
      }
    }

    return {
      ...this.documentInfo,
      baseURL: this.baseUrl,
      filesize: this._contentLength,
      filename: this._docFilename,
      metadata: this.metadata?.getRaw(),
      authors: this.metadata?.get('dc:creator'),
      numPages: this.pagesCount,
      URL: this.url,
    }
  }

  /**
   * @private
   */
  async _initializeAutoPrint (pdfDocument, openActionPromise) {
    const [openAction, javaScript] = await Promise.all([
      openActionPromise,
      !this.pdfViewer.enableScripting ? pdfDocument.getJavaScript() : null,
    ])

    if (pdfDocument !== this.pdfDocument) {
      return // The document was closed while the auto print data resolved.
    }
    let triggerAutoPrint = false

    if (openAction?.action === 'Print') {
      triggerAutoPrint = true
    }
    if (javaScript) {
      javaScript.some(js => {
        if (!js) {
          // Don't warn/fallback for empty JavaScript actions.
          return false
        }
        console.warn('Warning: JavaScript support is not enabled')
        this.fallback(UNSUPPORTED_FEATURES.javaScript)
        return true
      })

      if (!triggerAutoPrint) {
        // Hack to support auto printing.
        for (const js of javaScript) {
          if (js && AutoPrintRegExp.test(js)) {
            triggerAutoPrint = true
            break
          }
        }
      }
    }

    if (triggerAutoPrint) {
      this.triggerPrinting()
    }
  }

  /**
   * @private
   */
  async _initializeMetadata (pdfDocument) {
    const {info, metadata, contentDispositionFilename, contentLength} =
      await pdfDocument.getMetadata()

    if (pdfDocument !== this.pdfDocument) {
      return // The document was closed while the metadata resolved.
    }
    this.documentInfo = info
    this.metadata = metadata
    this._contentDispositionFilename ??= contentDispositionFilename
    this._contentLength ??= contentLength // See `getDownloadInfo`-call above.

    // Provides some basic debug information
    // NOTE
    // console.log(
    //   `PDF ${pdfDocument.fingerprints[0]} [${info.PDFFormatVersion} ` +
    //   `${(info.Producer || '-').trim()} / ${(info.Creator || '-').trim()}] ` +
    //   `(PDF.js: ${version || '-'})`,
    // )
    let pdfTitle = info.Title

    const metadataTitle = metadata?.get('dc:title')
    if (metadataTitle) {
      // Ghostscript can produce invalid 'dc:title' Metadata entries:
      //  - The title may be "Untitled" (fixes bug 1031612).
      //  - The title may contain incorrectly encoded characters, which thus
      //    looks broken, hence we ignore the Metadata entry when it contains
      //    characters from the Specials Unicode block (fixes bug 1605526).
      if (
        metadataTitle !== 'Untitled' &&
        !/[\uFFF0-\uFFFF]/g.test(metadataTitle)
      ) {
        pdfTitle = metadataTitle
      }
    }
    if (pdfTitle) {
      this.setTitle(
        `${pdfTitle} - ${this._contentDispositionFilename || this._title}`,
      )
    } else if (this._contentDispositionFilename) {
      this.setTitle(this._contentDispositionFilename)
    }

    if (
      info.IsXFAPresent &&
      !info.IsAcroFormPresent &&
      !pdfDocument.isPureXfa
    ) {
      if (pdfDocument.loadingParams.enableXfa) {
        console.warn('Warning: XFA Foreground documents are not supported')
      } else {
        console.warn('Warning: XFA support is not enabled')
      }
      this.fallback(UNSUPPORTED_FEATURES.forms)
    } else if (
      (info.IsAcroFormPresent || info.IsXFAPresent) &&
      !this.pdfViewer.renderForms
    ) {
      console.warn('Warning: Interactive form support is not enabled')
      this.fallback(UNSUPPORTED_FEATURES.forms)
    }

    if (info.IsSignaturesPresent) {
      console.warn('Warning: Digital signatures validation is not supported')
      this.fallback(UNSUPPORTED_FEATURES.signatures)
    }

    // Telemetry labels must be C++ variable friendly.
    let versionId = 'other'
    if (KNOWN_VERSIONS.includes(info.PDFFormatVersion)) {
      versionId = `v${info.PDFFormatVersion.replace('.', '_')}`
    }
    let generatorId = 'other'
    if (info.Producer) {
      const producer = info.Producer.toLowerCase()
      KNOWN_GENERATORS.some(function (generator) {
        if (!producer.includes(generator)) {
          return false
        }
        generatorId = generator.replace(/[ .-]/g, '_')
        return true
      })
    }
    let formType = null
    if (info.IsXFAPresent) {
      formType = 'xfa'
    } else if (info.IsAcroFormPresent) {
      formType = 'acroform'
    }
    this.externalServices.reportTelemetry({
      type: 'documentInfo',
      version: versionId,
      generator: generatorId,
      formType,
    })

    this.eventBus.dispatch('metadataloaded', {source: this})
  }

  /**
   * @private
   */
  async _initializePageLabels (pdfDocument) {
    const labels = await pdfDocument.getPageLabels()

    if (pdfDocument !== this.pdfDocument) {
      return // The document was closed while the page labels resolved.
    }
    if (!labels || AppOptions.get('disablePageLabels')) {
      return
    }
    const numLabels = labels.length
    // Ignore page labels that correspond to standard page numbering,
    // or page labels that are all empty.
    let standardLabels = 0,
      emptyLabels = 0
    for (let i = 0; i < numLabels; i++) {
      const label = labels[i]
      if (label === (i + 1).toString()) {
        standardLabels++
      } else if (label === '') {
        emptyLabels++
      } else {
        break
      }
    }
    if (standardLabels >= numLabels || emptyLabels >= numLabels) {
      return
    }
    const {pdfViewer, pdfThumbnailViewer, toolbar} = this

    pdfViewer.setPageLabels(labels)
    pdfThumbnailViewer.setPageLabels(labels)

    // Changing toolbar page display to use labels and we need to set
    // the label of the current page.
    toolbar.setPagesCount(numLabels, true)
    toolbar.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel,
    )
  }

  /**
   * @private
   */
  _initializePdfHistory ({fingerprint, viewOnLoad, initialDest = null}) {
    if (!this.pdfHistory) {
      return
    }
    this.pdfHistory.initialize({
      fingerprint,
      resetHistory: viewOnLoad === ViewOnLoad.INITIAL,
      updateUrl: AppOptions.get('historyUpdateUrl'),
    })

    if (this.pdfHistory.initialBookmark) {
      this.initialBookmark = this.pdfHistory.initialBookmark

      this.initialRotation = this.pdfHistory.initialRotation
    }

    // Always let the browser history/document hash take precedence.
    if (
      initialDest &&
      !this.initialBookmark &&
      viewOnLoad === ViewOnLoad.UNKNOWN
    ) {
      this.initialBookmark = JSON.stringify(initialDest)
      // TODO: Re-factor the `PDFHistory` initialization to remove this hack
      // that's currently necessary to prevent weird initial history state.
      this.pdfHistory.push({explicitDest: initialDest, pageNumber: null})
    }
  }

  /**
   * @private
   */
  _initializeAnnotationStorageCallbacks (pdfDocument) {
    if (pdfDocument !== this.pdfDocument) {
      return
    }
    const {annotationStorage} = pdfDocument

    annotationStorage.onSetModified = () => {
      // NOTE window.addEventListener('beforeunload', beforeUnload)

      if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
        this._annotationStorageModified = true
      }
    }
    annotationStorage.onResetModified = () => {
      // NOTE window.removeEventListener('beforeunload', beforeUnload)

      if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
        delete this._annotationStorageModified
      }
    }
    annotationStorage.onAnnotationEditor = typeStr => {
      this._hasAnnotationEditors = !!typeStr
      this.setTitle()

      if (typeStr) {
        this.externalServices.reportTelemetry({
          type: 'editing',
          data: {type: typeStr},
        })
      }
    }
  }

  setInitialView (
    storedHash,
    {rotation, sidebarView, scrollMode, spreadMode} = {},
  ) {
    const setRotation = angle => {
      if (isValidRotation(angle)) {
        this.pdfViewer.pagesRotation = angle
      }
    }
    const setViewerModes = (scroll, spread) => {
      if (isValidScrollMode(scroll)) {
        this.pdfViewer.scrollMode = scroll
      }
      if (isValidSpreadMode(spread)) {
        this.pdfViewer.spreadMode = spread
      }
    }
    this.isInitialViewSet = true
    this.pdfSidebar.setInitialView(sidebarView)

    setViewerModes(scrollMode, spreadMode)

    if (this.initialBookmark) {
      setRotation(this.initialRotation)
      delete this.initialRotation

      this.pdfLinkService.setHash(this.initialBookmark)
      this.initialBookmark = null
    } else if (storedHash) {
      setRotation(rotation)

      this.pdfLinkService.setHash(storedHash)
    }

    // Ensure that the correct page number is displayed in the UI,
    // even if the active page didn't change during document load.
    this.toolbar.setPageNumber(
      this.pdfViewer.currentPageNumber,
      this.pdfViewer.currentPageLabel,
    )
    this.secondaryToolbar.setPageNumber(this.pdfViewer.currentPageNumber)

    if (!this.pdfViewer.currentScaleValue) {
      // Scale was not initialized: invalid bookmark or scale was not specified.
      // Setting the default one.
      this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE
    }
  }

  /**
   * @private
   */
  _cleanup () {
    if (!this.pdfDocument) {
      return // run cleanup when document is loaded
    }
    this.pdfViewer.cleanup()
    this.pdfThumbnailViewer.cleanup()

    if (
      typeof PDFJSDev === 'undefined' ||
      PDFJSDev.test('!PRODUCTION || GENERIC')
    ) {
      // We don't want to remove fonts used by active page SVGs.
      this.pdfDocument.cleanup(
        /* keepLoadedFonts = */ this.pdfViewer.renderer === RendererType.SVG,
      )
    } else {
      this.pdfDocument.cleanup()
    }
  }

  forceRendering () {
    this.pdfRenderingQueue.printing = !!this.printService
    this.pdfRenderingQueue.isThumbnailViewEnabled =
      this.pdfSidebar.visibleView === SidebarView.THUMBS
    this.pdfRenderingQueue.renderHighestPriority()
  }

  beforePrint () {
    this._printAnnotationStoragePromise = this.pdfScriptingManager.dispatchWillPrint().
      catch(() => {
        /* Avoid breaking printing; ignoring errors. */
      }).
      then(() => {
        return this.pdfDocument?.annotationStorage.print
      })

    if (this.printService) {
      // There is no way to suppress beforePrint/afterPrint events,
      // but PDFPrintService may generate double events -- this will ignore
      // the second event that will be coming from native window.print().
      return
    }

    if (!this.supportsPrinting) {
      // NOTE
      this._otherError(window.siyuan.languages.printingNotSupported)
      return
    }

    // The beforePrint is a sync method and we need to know layout before
    // returning from this method. Ensure that we can get sizes of the pages.
    if (!this.pdfViewer.pageViewsReady) {
      // NOTE
      window.alert(window.siyuan.languages.printingNotReady)
      return
    }

    const pagesOverview = this.pdfViewer.getPagesOverview()
    const printContainer = this.appConfig.printContainer
    const printResolution = AppOptions.get('printResolution')
    const optionalContentConfigPromise =
      this.pdfViewer.optionalContentConfigPromise

    const printService = PDFPrintServiceFactory.instance.createPrintService(
      this.pdfDocument,
      pagesOverview,
      printContainer,
      printResolution,
      optionalContentConfigPromise,
      this._printAnnotationStoragePromise,
      this.l10n,
    )
    this.printService = printService
    this.forceRendering()
    // Disable the editor-indicator during printing (fixes bug 1790552).
    this.setTitle()

    printService.layout()

    this.externalServices.reportTelemetry({
      type: 'print',
    })

    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: 'editing',
        data: {type: 'print'},
      })
    }
  }

  afterPrint () {
    if (this._printAnnotationStoragePromise) {
      this._printAnnotationStoragePromise.then(() => {
        this.pdfScriptingManager.dispatchDidPrint()
      })
      this._printAnnotationStoragePromise = null
    }

    if (this.printService) {
      this.printService.destroy()
      this.printService = null

      this.pdfDocument?.annotationStorage.resetModified()
    }
    this.forceRendering()
    // Re-enable the editor-indicator after printing (fixes bug 1790552).
    this.setTitle()
  }

  rotatePages (delta) {
    this.pdfViewer.pagesRotation += delta
    // Note that the thumbnail viewer is updated, and rendering is triggered,
    // in the 'rotationchanging' event handler.
  }

  requestPresentationMode () {
    this.pdfPresentationMode?.request()
  }

  triggerPrinting () {
    if (!this.supportsPrinting) {
      return
    }
    window.print()
  }

  bindEvents () {
    const {eventBus, _boundEvents} = this

    _boundEvents.beforePrint = this.beforePrint.bind(this)
    _boundEvents.afterPrint = this.afterPrint.bind(this)

    eventBus._on('resize', webViewerResize)
    eventBus._on('hashchange', webViewerHashchange)
    eventBus._on('beforeprint', _boundEvents.beforePrint)
    eventBus._on('afterprint', _boundEvents.afterPrint)
    eventBus._on('pagerendered', webViewerPageRendered)
    eventBus._on('updateviewarea', webViewerUpdateViewarea)
    eventBus._on('pagechanging', webViewerPageChanging)
    eventBus._on('scalechanging', webViewerScaleChanging)
    eventBus._on('rotationchanging', webViewerRotationChanging)
    eventBus._on('sidebarviewchanged', webViewerSidebarViewChanged)
    eventBus._on('pagemode', webViewerPageMode)
    eventBus._on('namedaction', webViewerNamedAction)
    eventBus._on('presentationmodechanged', webViewerPresentationModeChanged)
    eventBus._on('presentationmode', webViewerPresentationMode)
    eventBus._on(
      'switchannotationeditormode',
      webViewerSwitchAnnotationEditorMode,
    )
    eventBus._on(
      'switchannotationeditorparams',
      webViewerSwitchAnnotationEditorParams,
    )
    eventBus._on('print', webViewerPrint)
    eventBus._on('download', webViewerDownload)
    eventBus._on('firstpage', webViewerFirstPage)
    eventBus._on('lastpage', webViewerLastPage)
    eventBus._on('nextpage', webViewerNextPage)
    eventBus._on('previouspage', webViewerPreviousPage)
    eventBus._on('zoomin', webViewerZoomIn)
    eventBus._on('zoomout', webViewerZoomOut)
    eventBus._on('zoomreset', webViewerZoomReset)
    eventBus._on('pagenumberchanged', webViewerPageNumberChanged)
    eventBus._on('scalechanged', webViewerScaleChanged)
    eventBus._on('rotatecw', webViewerRotateCw)
    eventBus._on('rotateccw', webViewerRotateCcw)
    eventBus._on('optionalcontentconfig', webViewerOptionalContentConfig)
    eventBus._on('switchscrollmode', webViewerSwitchScrollMode)
    eventBus._on('scrollmodechanged', webViewerScrollModeChanged)
    eventBus._on('switchspreadmode', webViewerSwitchSpreadMode)
    eventBus._on('spreadmodechanged', webViewerSpreadModeChanged)
    eventBus._on('documentproperties', webViewerDocumentProperties)
    eventBus._on('findfromurlhash', webViewerFindFromUrlHash)
    eventBus._on('updatefindmatchescount', webViewerUpdateFindMatchesCount)
    eventBus._on('updatefindcontrolstate', webViewerUpdateFindControlState)

    if (AppOptions.get('pdfBug')) {
      _boundEvents.reportPageStatsPDFBug = reportPageStatsPDFBug

      eventBus._on('pagerendered', _boundEvents.reportPageStatsPDFBug)
      eventBus._on('pagechanging', _boundEvents.reportPageStatsPDFBug)
    }
    if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
      eventBus._on('fileinputchange', webViewerFileInputChange)
      eventBus._on('openfile', webViewerOpenFile)
    }
    if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('MOZCENTRAL')) {
      eventBus._on(
        'annotationeditorstateschanged',
        webViewerAnnotationEditorStatesChanged,
      )
    }
  }

  bindWindowEvents () {
    const {eventBus, _boundEvents} = this

    function addWindowResolutionChange (evt = null) {
      if (evt) {
        webViewerResolutionChange(evt)
      }
      const mediaQueryList = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      )
      mediaQueryList.addEventListener('change', addWindowResolutionChange, {
        once: true,
      })

      if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('MOZCENTRAL')) {
        return
      }
      _boundEvents.removeWindowResolutionChange ||= function () {
        mediaQueryList.removeEventListener('change', addWindowResolutionChange)
        _boundEvents.removeWindowResolutionChange = null
      }
    }

    addWindowResolutionChange()

    _boundEvents.windowResize = () => {
      eventBus.dispatch('resize', {source: window})
    }
    _boundEvents.windowHashChange = () => {
      eventBus.dispatch('hashchange', {
        source: window,
        hash: document.location.hash.substring(1),
      })
    }
    _boundEvents.windowBeforePrint = () => {
      eventBus.dispatch('beforeprint', {source: window})
    }
    _boundEvents.windowAfterPrint = () => {
      eventBus.dispatch('afterprint', {source: window})
    }
    _boundEvents.windowUpdateFromSandbox = event => {
      eventBus.dispatch('updatefromsandbox', {
        source: window,
        detail: event.detail,
      })
    }

    window.addEventListener('visibilitychange', webViewerVisibilityChange)
    window.addEventListener('wheel', webViewerWheel, {passive: false})
    window.addEventListener('touchstart', webViewerTouchStart, {
      passive: false,
    })
    window.addEventListener('click', webViewerClick)
    window.addEventListener('keydown', webViewerKeyDown)
    window.addEventListener('keyup', webViewerKeyUp)
    window.addEventListener('resize', _boundEvents.windowResize)
    window.addEventListener('hashchange', _boundEvents.windowHashChange)
    window.addEventListener('beforeprint', _boundEvents.windowBeforePrint)
    window.addEventListener('afterprint', _boundEvents.windowAfterPrint)
    window.addEventListener(
      'updatefromsandbox',
      _boundEvents.windowUpdateFromSandbox,
    )
  }

  unbindEvents () {
    if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('MOZCENTRAL')) {
      throw new Error('Not implemented: unbindEvents')
    }
    const {eventBus, _boundEvents} = this

    eventBus._off('resize', webViewerResize)
    eventBus._off('hashchange', webViewerHashchange)
    eventBus._off('beforeprint', _boundEvents.beforePrint)
    eventBus._off('afterprint', _boundEvents.afterPrint)
    eventBus._off('pagerendered', webViewerPageRendered)
    eventBus._off('updateviewarea', webViewerUpdateViewarea)
    eventBus._off('pagechanging', webViewerPageChanging)
    eventBus._off('scalechanging', webViewerScaleChanging)
    eventBus._off('rotationchanging', webViewerRotationChanging)
    eventBus._off('sidebarviewchanged', webViewerSidebarViewChanged)
    eventBus._off('pagemode', webViewerPageMode)
    eventBus._off('namedaction', webViewerNamedAction)
    eventBus._off('presentationmodechanged', webViewerPresentationModeChanged)
    eventBus._off('presentationmode', webViewerPresentationMode)
    eventBus._off('print', webViewerPrint)
    eventBus._off('download', webViewerDownload)
    eventBus._off('firstpage', webViewerFirstPage)
    eventBus._off('lastpage', webViewerLastPage)
    eventBus._off('nextpage', webViewerNextPage)
    eventBus._off('previouspage', webViewerPreviousPage)
    eventBus._off('zoomin', webViewerZoomIn)
    eventBus._off('zoomout', webViewerZoomOut)
    eventBus._off('zoomreset', webViewerZoomReset)
    eventBus._off('pagenumberchanged', webViewerPageNumberChanged)
    eventBus._off('scalechanged', webViewerScaleChanged)
    eventBus._off('rotatecw', webViewerRotateCw)
    eventBus._off('rotateccw', webViewerRotateCcw)
    eventBus._off('optionalcontentconfig', webViewerOptionalContentConfig)
    eventBus._off('switchscrollmode', webViewerSwitchScrollMode)
    eventBus._off('scrollmodechanged', webViewerScrollModeChanged)
    eventBus._off('switchspreadmode', webViewerSwitchSpreadMode)
    eventBus._off('spreadmodechanged', webViewerSpreadModeChanged)
    eventBus._off('documentproperties', webViewerDocumentProperties)
    eventBus._off('findfromurlhash', webViewerFindFromUrlHash)
    eventBus._off('updatefindmatchescount', webViewerUpdateFindMatchesCount)
    eventBus._off('updatefindcontrolstate', webViewerUpdateFindControlState)

    if (_boundEvents.reportPageStatsPDFBug) {
      eventBus._off('pagerendered', _boundEvents.reportPageStatsPDFBug)
      eventBus._off('pagechanging', _boundEvents.reportPageStatsPDFBug)

      _boundEvents.reportPageStatsPDFBug = null
    }
    if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
      eventBus._off('fileinputchange', webViewerFileInputChange)
      eventBus._off('openfile', webViewerOpenFile)
    }

    _boundEvents.beforePrint = null
    _boundEvents.afterPrint = null
  }

  unbindWindowEvents () {
    if (typeof PDFJSDev !== 'undefined' && PDFJSDev.test('MOZCENTRAL')) {
      throw new Error('Not implemented: unbindWindowEvents')
    }
    const {_boundEvents} = this

    window.removeEventListener('visibilitychange', webViewerVisibilityChange)
    window.removeEventListener('wheel', webViewerWheel, {passive: false})
    window.removeEventListener('touchstart', webViewerTouchStart, {
      passive: false,
    })
    window.removeEventListener('click', webViewerClick)
    window.removeEventListener('keydown', webViewerKeyDown)
    window.removeEventListener('keyup', webViewerKeyUp)
    window.removeEventListener('resize', _boundEvents.windowResize)
    window.removeEventListener('hashchange', _boundEvents.windowHashChange)
    window.removeEventListener('beforeprint', _boundEvents.windowBeforePrint)
    window.removeEventListener('afterprint', _boundEvents.windowAfterPrint)
    window.removeEventListener(
      'updatefromsandbox',
      _boundEvents.windowUpdateFromSandbox,
    )

    _boundEvents.removeWindowResolutionChange?.()
    _boundEvents.windowResize = null
    _boundEvents.windowHashChange = null
    _boundEvents.windowBeforePrint = null
    _boundEvents.windowAfterPrint = null
    _boundEvents.windowUpdateFromSandbox = null
  }

  accumulateWheelTicks (ticks) {
    // If the scroll direction changed, reset the accumulated wheel ticks.
    if (
      (this._wheelUnusedTicks > 0 && ticks < 0) ||
      (this._wheelUnusedTicks < 0 && ticks > 0)
    ) {
      this._wheelUnusedTicks = 0
    }
    this._wheelUnusedTicks += ticks
    const wholeTicks =
      Math.sign(this._wheelUnusedTicks) *
      Math.floor(Math.abs(this._wheelUnusedTicks))
    this._wheelUnusedTicks -= wholeTicks
    return wholeTicks
  }

  /**
   * Should be called *after* all pages have loaded, or if an error occurred,
   * to unblock the "load" event; see https://bugzilla.mozilla.org/show_bug.cgi?id=1618553
   * @private
   */
  _unblockDocumentLoadEvent () {
    document.blockUnblockOnload?.(false)

    // Ensure that this method is only ever run once.
    this._unblockDocumentLoadEvent = () => {}
  }

  /**
   * @ignore
   */
  _reportDocumentStatsTelemetry () {
    const {stats} = this.pdfDocument
    if (stats !== this._docStats) {
      this._docStats = stats

      this.externalServices.reportTelemetry({
        type: 'documentStats',
        stats,
      })
    }
  }

  /**
   * Used together with the integration-tests, to enable awaiting full
   * initialization of the scripting/sandbox.
   */
  get scriptingReady () {
    return this.pdfScriptingManager.ready
  }
}

if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
  const HOSTED_VIEWER_ORIGINS = [
    'null',
    'http://mozilla.github.io',
    'https://mozilla.github.io',
  ]
  // eslint-disable-next-line no-var
  var validateFileURL = function (file) {
    if (!file) {
      return
    }
    try {
      const viewerOrigin = new URL(window.location.href).origin || 'null'
      if (HOSTED_VIEWER_ORIGINS.includes(viewerOrigin)) {
        // Hosted or local viewer, allow for any file locations
        return
      }
      const fileOrigin = new URL(file, window.location.href).origin
      // Removing of the following line will not guarantee that the viewer will
      // start accepting URLs from foreign origin -- CORS headers on the remote
      // server must be properly configured.
      if (fileOrigin !== viewerOrigin) {
        throw new Error('file origin does not match viewer\'s')
      }
    } catch (ex) {
      // NOTE
      console.log(window.siyuan.languages.loadingError, ex.message)
      throw ex
    }
  }
}

async function loadFakeWorker () {
  GlobalWorkerOptions.workerSrc ||= AppOptions.get('workerSrc')

  if (typeof PDFJSDev === 'undefined' || !PDFJSDev.test('PRODUCTION')) {
    // NOTE
    window.pdfjsWorker = await import(`${Constants.PROTYLE_CDN}/js/pdf/pdf.worker.js?v=3.0.150`)
    return
  }
  await loadScript(PDFWorker.workerSrc)
}

// NOTE
// async function loadPDFBug (self) {
//   const {debuggerScriptPath} = self.appConfig
//   const {PDFBug} =
//     typeof PDFJSDev === 'undefined' || !PDFJSDev.test('PRODUCTION')
//       ? await import(debuggerScriptPath) // eslint-disable-line no-unsanitized/method
//       : await __non_webpack_import__(debuggerScriptPath) // eslint-disable-line no-undef
//
//   self._PDFBug = PDFBug
// }

function reportPageStatsPDFBug ({pageNumber}) {
  if (!globalThis.Stats?.enabled) {
    return
  }
  const pageView = PDFViewerApplication.pdfViewer.getPageView(
    /* index = */ pageNumber - 1,
  )
  globalThis.Stats.add(pageNumber, pageView?.pdfPage?.stats)
}

function webViewerInitialized (pdf) {
  // NOTE
  const {appConfig, eventBus} = pdf
  const file = appConfig.file
  // NOTE
  // if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
  //   const queryString = document.location.search.substring(1)
  //   const params = parseQueryString(queryString)
  //   file = params.get('file') ?? AppOptions.get('defaultUrl')
  //   validateFileURL(appConfig.file)
  // } else if (PDFJSDev.test('MOZCENTRAL')) {
  //   file = window.location.href
  // } else if (PDFJSDev.test('CHROME')) {
  //   file = AppOptions.get('defaultUrl')
  // }

  // NOTE
  // if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
  //   const fileInput = appConfig.openFileInput
  //   fileInput.value = null
  //
  //   fileInput.addEventListener('change', function (evt) {
  //     const {files} = evt.target
  //     if (!files || files.length === 0) {
  //       return
  //     }
  //     eventBus.dispatch('fileinputchange', {
  //       source: this,
  //       fileInput: evt.target,
  //     })
  //   })
  //
  //   // Enable dragging-and-dropping a new PDF file onto the viewerContainer.
  //   appConfig.mainContainer.addEventListener('dragover', function (evt) {
  //     evt.preventDefault()
  //
  //     evt.dataTransfer.dropEffect =
  //       evt.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
  //   })
  //   appConfig.mainContainer.addEventListener('drop', function (evt) {
  //     evt.preventDefault()
  //
  //     const {files} = evt.dataTransfer
  //     if (!files || files.length === 0) {
  //       return
  //     }
  //     eventBus.dispatch('fileinputchange', {
  //       source: this,
  //       fileInput: evt.dataTransfer,
  //     })
  //   })
  // }

  if (!pdf.supportsDocumentFonts) {
    AppOptions.set('disableFontFace', true)
    // NOTE
    console.warn('Web fonts are disabled: unable to use embedded PDF fonts.')
  }

  if (!pdf.supportsPrinting) {
    // NOTE
    appConfig.toolbar.print?.classList.add('fn__hidden')
    appConfig.secondaryToolbar.printButton?.classList.add('fn__hidden')
  }

  if (!pdf.supportsFullscreen) {
    // NOTE
    appConfig.secondaryToolbar.presentationModeButton?.classList.add(
      'fn__hidden')
  }

  if (pdf.supportsIntegratedFind) {
    // NOTE
    appConfig.toolbar.viewFind.classList.add('fn__hidden')
  }

  appConfig.mainContainer.addEventListener(
    'transitionend',
    function (evt) {
      if (evt.target === /* mainContainer */ this && eventBus) {
        eventBus.dispatch('resize', {source: this})
      }
    },
    true,
  )

  try {
    if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
      if (file) {
        pdf.open(file)
      } else {
        pdf._hideViewBookmark()
      }
    } else if (PDFJSDev.test('MOZCENTRAL || CHROME')) {
      pdf.setTitleUsingUrl(file, /* downloadUrl = */ file)
      pdf.initPassiveLoading()
    } else {
      throw new Error('Not implemented: webViewerInitialized')
    }
  } catch (reason) {
    pdf._documentError(window.siyuan.languages.loadingError, reason)
  }
}

// NOTE
function webViewerPageRendered ({pageNumber, error, source}) {
  const pdfInstance = getPdfInstance(source.div)
  if (!pdfInstance) {
    return
  }
  // If the page is still visible when it has finished rendering,
  // ensure that the page number input loading indicator is hidden.
  if (pageNumber === pdfInstance.page) {
    pdfInstance.toolbar.updateLoadingIndicatorState(false)
  }

  // Use the rendered page to set the corresponding thumbnail image.
  if (pdfInstance.pdfSidebar.visibleView === SidebarView.THUMBS) {
    const pageView = pdfInstance.pdfViewer.getPageView(
      /* index = */ pageNumber - 1,
    )
    const thumbnailView = pdfInstance.pdfThumbnailViewer.getThumbnail(
      /* index = */ pageNumber - 1,
    )
    if (pageView && thumbnailView) {
      thumbnailView.setImage(pageView)
    }
  }

  if (error) {
    pdfInstance._otherError(
      'An error occurred while rendering the page.', error)
  }

  // It is a good time to report stream and font types.
  pdfInstance._reportDocumentStatsTelemetry()
}

// NOTE
function webViewerPageMode ({mode, source}) {
  const pdfInstance = getPdfInstance(source.externalLinkTarget)
  if (!pdfInstance) {
    return
  }
  // Handle the 'pagemode' hash parameter, see also `PDFLinkService_setHash`.
  let view
  switch (mode) {
    case 'thumbs':
      view = SidebarView.THUMBS
      break
    case 'bookmarks':
    case 'outline': // non-standard
      view = SidebarView.OUTLINE
      break
    case 'attachments': // non-standard
      view = SidebarView.ATTACHMENTS
      break
    case 'layers': // non-standard
      view = SidebarView.LAYERS
      break
    case 'none':
      view = SidebarView.NONE
      break
    default:
      console.error('Invalid "pagemode" hash parameter: ' + mode)
      return
  }
  pdfInstance.pdfSidebar.switchView(view, /* forceOpen = */ true)
}

// NOTE
function webViewerNamedAction (evt) {
  const pdfInstance = getPdfInstance(evt.source.externalLinkTarget)
  if (!pdfInstance) {
    return
  }
  // Processing a couple of named actions that might be useful, see also
  // `PDFLinkService.executeNamedAction`.
  switch (evt.action) {
    case 'GoToPage':
      pdfInstance.appConfig.toolbar.pageNumber.select()
      break

    case 'Find':
      if (!pdfInstance.supportsIntegratedFind) {
        pdfInstance.findBar.toggle()
      }
      break

    case 'Print':
      pdfInstance.triggerPrinting()
      break

    case 'SaveAs':
      pdfInstance.downloadOrSave()
      break
  }
}

// NOTE
function webViewerPresentationModeChanged (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.presentationModeState = evt.state
}

// NOTE
function webViewerSidebarViewChanged ({view, source}) {
  const pdfInstance = getPdfInstance(source.outerContainer)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfRenderingQueue.isThumbnailViewEnabled =
    view === SidebarView.THUMBS

  if (pdfInstance.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set('sidebarView', view).catch(() => {
      // Unable to write to storage.
    })
  }
}

// NOTE
function webViewerUpdateViewarea ({location, source}) {
  const pdfInstance = getPdfInstance(source.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.isInitialViewSet) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.setMultiple({
      page: location.pageNumber,
      zoom: location.scale,
      scrollLeft: location.left,
      scrollTop: location.top,
      rotation: location.rotation,
    }).catch(() => {
      // Unable to write to storage.
    })
  }
  const href = pdfInstance.pdfLinkService.getAnchorUrl(
    location.pdfOpenParams,
  )
  pdfInstance.appConfig.secondaryToolbar.viewBookmarkButton.href =
    href

  // Show/hide the loading indicator in the page number input element.
  const currentPage = pdfInstance.pdfViewer.getPageView(
    /* index = */ pdfInstance.page - 1,
  )
  const loading = currentPage?.renderingState !== RenderingStates.FINISHED
  pdfInstance.toolbar.updateLoadingIndicatorState(loading)
}

// NOTE
function webViewerScrollModeChanged (evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  if (
    pdfInstance.isInitialViewSet &&
    !pdfInstance.pdfViewer.isInPresentationMode
  ) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set('scrollMode', evt.mode).catch(() => {
      // Unable to write to storage.
    })
  }
}

// NOTE
function webViewerSpreadModeChanged (evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.isInitialViewSet &&
    !pdfInstance.pdfViewer.isInPresentationMode) {
    // Only update the storage when the document has been loaded *and* rendered.
    pdfInstance.store?.set('spreadMode', evt.mode).catch(() => {
      // Unable to write to storage.
    })
  }
}

// NOTE
function webViewerResize () {
  // const {pdfDocument, pdfViewer, pdfRenderingQueue} = PDFViewerApplication
  //
  // if (pdfRenderingQueue.printing && window.matchMedia('print').matches) {
  //   // Work-around issue 15324 by ignoring "resize" events during printing.
  //   return
  // }
  // pdfViewer.updateContainerHeightCss()
  //
  // if (!pdfDocument) {
  //   return
  // }
  // const currentScaleValue = pdfViewer.currentScaleValue
  // if (
  //   currentScaleValue === 'auto' ||
  //   currentScaleValue === 'page-fit' ||
  //   currentScaleValue === 'page-width'
  // ) {
  //   // Note: the scale is constant for 'page-actual'.
  //   pdfViewer.currentScaleValue = currentScaleValue
  // }
  // pdfViewer.update()
}

function webViewerHashchange (evt) {
  const hash = evt.hash
  if (!hash) {
    return
  }
  // NOTE
  const pdfInstance = getPdfInstance(evt.source)
  if (!pdfInstance) {
    return
  }
  if (!pdfInstance.isInitialViewSet) {
    pdfInstance.initialBookmark = hash
  } else if (!pdfInstance.pdfHistory?.popStateInProgress) {
    pdfInstance.pdfLinkService.setHash(hash)
  }
}

if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
  // eslint-disable-next-line no-var
  var webViewerFileInputChange = function (evt) {
    // NOTE
    if (evt.source.pdfViewer?.isInPresentationMode) {
      return // Opening a new PDF file isn't supported in Presentation Mode.
    }
    const file = evt.fileInput.files[0]

    let url = URL.createObjectURL(file)
    if (file.name) {
      url = {url, originalUrl: file.name}
    }
    // NOTE PDFViewerApplication.open(url)
  }

  // eslint-disable-next-line no-var
  var webViewerOpenFile = function (evt) {
    // NOTE
    const fileInput = evt.pdfInstance.appConfig.openFileInput
    fileInput.click()
  }
}

// NOTE
function webViewerPresentationMode ({source}) {
  const pdfInstance = getPdfInstance(source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.requestPresentationMode()
}

// NOTE
function webViewerSwitchAnnotationEditorMode (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.annotationEditorMode = evt.mode
}

// NOTE
function webViewerSwitchAnnotationEditorParams (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.annotationEditorParams = evt
}

// NOTE
function webViewerPrint (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.triggerPrinting()
}

// NOTE
function webViewerDownload (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.downloadOrSave()
}

// NOTE
function webViewerFirstPage (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.pdfDocument) {
    pdfInstance.page = 1
  }
}

// NOTE
function webViewerLastPage (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.pdfDocument) {
    pdfInstance.page = pdfInstance.pagesCount
  }
}

// NOTE
function webViewerNextPage (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.nextPage()
}

// NOTE
function webViewerPreviousPage (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.previousPage()
}

// NOTE
function webViewerZoomIn (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomIn()
}

// NOTE
function webViewerZoomOut (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomOut()
}

// NOTE
function webViewerZoomReset (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.zoomReset()
}

// NOTE
function webViewerPageNumberChanged (evt) {
  let pdfInstance
  if (evt.pdfInstance) {
    pdfInstance = evt.pdfInstance
  } else {
    pdfInstance = getPdfInstance(evt.source.toolbar)
  }
  if (!pdfInstance || typeof evt.value === 'undefined') {
    return
  }
  const pdfViewer = pdfInstance.pdfViewer
  // Note that for `<input type="number">` HTML elements, an empty string will
  // be returned for non-number inputs; hence we simply do nothing in that case.
  if (evt.value !== '') {
    pdfInstance.pdfLinkService.goToPage(evt.value)
  }
  // NOTE
  if (evt.id) {
    hlPDFRect(pdfInstance.pdfViewer.container, evt.id)
  }
  // Ensure that the page number input displays the correct value, even if the
  // value entered by the user was invalid (e.g. a floating point number).
  if (
    evt.value !== pdfViewer.currentPageNumber.toString() &&
    evt.value !== pdfViewer.currentPageLabel
  ) {
    pdfInstance.toolbar.setPageNumber(
      pdfViewer.currentPageNumber,
      pdfViewer.currentPageLabel,
    )
  }
}

// NOTE
function webViewerScaleChanged (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.currentScaleValue = evt.value
}

// NOTE
function webViewerRotateCw (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.rotatePages(90)
}

// NOTE
function webViewerRotateCcw (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.rotatePages(-90)
}

// NOTE
function webViewerOptionalContentConfig (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.optionalContentConfigPromise = evt.promise
}

// NOTE
function webViewerSwitchScrollMode (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.scrollMode = evt.mode
}

// NOTE
function webViewerSwitchSpreadMode (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.spreadMode = evt.mode
}

// NOTE
function webViewerDocumentProperties (evt) {
  const pdfInstance = getPdfInstance(evt.source.toolbar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfDocumentProperties.open()
}

// NOTE
function webViewerFindFromUrlHash (evt) {
  const pdfInstance = getPdfInstance(evt.source.bar)
  if (!pdfInstance) {
    return
  }
  pdfInstance.eventBus.dispatch('find', {
    source: evt.source,
    type: '',
    query: evt.query,
    phraseSearch: evt.phraseSearch,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: true,
  })
}

// NOTE
function webViewerUpdateFindMatchesCount ({matchesCount, source}) {
  const pdfInstance = getPdfInstance(source._linkService.pdfViewer.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.supportsIntegratedFind) {
    pdfInstance.externalServices.updateFindMatchesCount(matchesCount)
  } else {
    pdfInstance.findBar.updateResultsCount(matchesCount)
  }
}

// NOTE
function webViewerUpdateFindControlState ({
                                            state,
                                            previous,
                                            matchesCount,
                                            rawQuery,
                                            source,
                                          }) {
  const pdfInstance = getPdfInstance(source._linkService.pdfViewer.container)
  if (!pdfInstance) {
    return
  }
  if (pdfInstance.supportsIntegratedFind) {
    pdfInstance.externalServices.updateFindControlState({
      result: state,
      findPrevious: previous,
      matchesCount,
      rawQuery,
    })
  } else {
    pdfInstance.findBar.updateUIState(state, previous, matchesCount)
  }
}

// NOTE
function webViewerScaleChanging (evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.toolbar.setPageScale(evt.presetValue, evt.scale)

  pdfInstance.pdfViewer.update()
}

// NOTE
function webViewerRotationChanging (evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfThumbnailViewer.pagesRotation = evt.pagesRotation

  pdfInstance.forceRendering()
  // Ensure that the active page doesn't change during rotation.
  pdfInstance.pdfViewer.currentPageNumber = evt.pageNumber
}

// NOTE
function webViewerPageChanging ({pageNumber, pageLabel, source}) {
  const pdfInstance = getPdfInstance(source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.toolbar.setPageNumber(pageNumber, pageLabel)
  pdfInstance.secondaryToolbar.setPageNumber(pageNumber)

  if (pdfInstance.pdfSidebar.visibleView === SidebarView.THUMBS) {
    pdfInstance.pdfThumbnailViewer.scrollThumbnailIntoView(pageNumber)
  }
}

// NOTE
function webViewerResolutionChange (evt) {
  const pdfInstance = getPdfInstance(evt.source.container)
  if (!pdfInstance) {
    return
  }
  pdfInstance.pdfViewer.refresh()
}

function webViewerVisibilityChange (evt) {
  if (document.visibilityState === 'visible') {
    // Ignore mouse wheel zooming during tab switches (bug 1503412).
    setZoomDisabledTimeout()
  }
}

let zoomDisabledTimeout = null

function setZoomDisabledTimeout () {
  if (zoomDisabledTimeout) {
    clearTimeout(zoomDisabledTimeout)
  }
  zoomDisabledTimeout = setTimeout(function () {
    zoomDisabledTimeout = null
  }, WHEEL_ZOOM_DISABLED_TIMEOUT)
}

// NOTE
function webViewerWheel (evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  const {pdfViewer, supportedMouseWheelZoomModifierKeys} =
    pdfInstance

  if (pdfViewer.isInPresentationMode) {
    return
  }

  if (
    (evt.ctrlKey && supportedMouseWheelZoomModifierKeys.ctrlKey) ||
    (evt.metaKey && supportedMouseWheelZoomModifierKeys.metaKey)
  ) {
    // Only zoom the pages, not the entire viewer.
    evt.preventDefault()
    // NOTE: this check must be placed *after* preventDefault.
    if (zoomDisabledTimeout || document.visibilityState === 'hidden') {
      return
    }

    // It is important that we query deltaMode before delta{X,Y}, so that
    // Firefox doesn't switch to DOM_DELTA_PIXEL mode for compat with other
    // browsers, see https://bugzilla.mozilla.org/show_bug.cgi?id=1392460.
    const deltaMode = evt.deltaMode
    const delta = normalizeWheelEventDirection(evt)
    const previousScale = pdfViewer.currentScale

    let ticks = 0
    if (
      deltaMode === WheelEvent.DOM_DELTA_LINE ||
      deltaMode === WheelEvent.DOM_DELTA_PAGE
    ) {
      // For line-based devices, use one tick per event, because different
      // OSs have different defaults for the number lines. But we generally
      // want one "clicky" roll of the wheel (which produces one event) to
      // adjust the zoom by one step.
      if (Math.abs(delta) >= 1) {
        ticks = Math.sign(delta)
      } else {
        // If we're getting fractional lines (I can't think of a scenario
        // this might actually happen), be safe and use the accumulator.
        ticks = pdfInstance.accumulateWheelTicks(delta)
      }
    } else {
      // pixel-based devices
      const PIXELS_PER_LINE_SCALE = 30
      ticks = pdfInstance.accumulateWheelTicks(
        delta / PIXELS_PER_LINE_SCALE,
      )
    }

    if (ticks < 0) {
      pdfInstance.zoomOut(-ticks)
    } else if (ticks > 0) {
      pdfInstance.zoomIn(ticks)
    }

    const currentScale = pdfViewer.currentScale
    if (previousScale !== currentScale) {
      // After scaling the page via zoomIn/zoomOut, the position of the upper-
      // left corner is restored. When the mouse wheel is used, the position
      // under the cursor should be restored instead.
      const scaleCorrectionFactor = currentScale / previousScale - 1
      const rect = pdfViewer.container.getBoundingClientRect()
      const dx = evt.clientX - rect.left
      const dy = evt.clientY - rect.top
      pdfViewer.container.scrollLeft += dx * scaleCorrectionFactor
      pdfViewer.container.scrollTop += dy * scaleCorrectionFactor
    }
  } else {
    setZoomDisabledTimeout()
  }
}

function webViewerTouchStart (evt) {
  if (evt.touches.length > 1) {
    // Disable touch-based zooming, because the entire UI bits gets zoomed and
    // that doesn't look great. If we do want to have a good touch-based
    // zooming experience, we need to implement smooth zoom capability (probably
    // using a CSS transform for faster visual response, followed by async
    // re-rendering at the final zoom level) and do gesture detection on the
    // touchmove events to drive it. Or if we want to settle for a less good
    // experience we can make the touchmove events drive the existing step-zoom
    // behaviour that the ctrl+mousewheel path takes.
    evt.preventDefault()
  }
}

// NOTE
function webViewerClick (evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance) {
    return
  }
  if (!pdfInstance.secondaryToolbar.isOpen) {
    return
  }
  const appConfig = pdfInstance.appConfig
  if (
    pdfInstance.pdfViewer.containsElement(evt.target) ||
    (appConfig.toolbar.container.contains(evt.target) &&
      !appConfig.secondaryToolbar.toggleButton.contains(evt.target)) // NOTE
  ) {
    pdfInstance.secondaryToolbar.close()
  }
}

// NOTE
function webViewerKeyUp (evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance || pdfInstance.overlayManager.active) {
    return
  }
  if (pdfInstance.overlayManager.active) {
    return
  }
  if (pdfInstance.appConfig.toolbar.rectAnno.classList.contains('toggled')) {
    pdfInstance.appConfig.toolbar.rectAnno.dispatchEvent(
      new MouseEvent('click'))
  }
}

function webViewerKeyDown (evt) {
  const pdfInstance = getPdfInstance(evt.target)
  if (!pdfInstance || pdfInstance.overlayManager.active) {
    return
  }
  if (pdfInstance.overlayManager.active) {
    return
  }
  const {eventBus, pdfViewer} = pdfInstance
  const isViewerInPresentationMode = pdfViewer.isInPresentationMode

  let handled = false,
    ensureViewerFocused = false
  const cmd =
    (evt.ctrlKey ? 1 : 0) |
    (evt.altKey ? 2 : 0) |
    (evt.shiftKey ? 4 : 0) |
    (evt.metaKey ? 8 : 0)

  if ((cmd === 8 || cmd === 1 || cmd === 2) &&
    !pdfInstance.appConfig.toolbar.rectAnno.classList.contains('toggled')) {
    pdfInstance.appConfig.toolbar.rectAnno.dispatchEvent(
      new MouseEvent('click'))
  }

  // First, handle the key bindings that are independent whether an input
  // control is selected or not.
  if (cmd === 1 || cmd === 8 || cmd === 5 || cmd === 12) {
    // either CTRL or META key with optional SHIFT.
    switch (evt.keyCode) {
      case 70: // f
        if (!pdfInstance.supportsIntegratedFind && !evt.shiftKey) {
          pdfInstance.findBar.open()
          handled = true
        }
        break
      case 71: // g
        if (!pdfInstance.supportsIntegratedFind) {
          const {state} = pdfInstance.findController
          if (state) {
            const eventState = Object.assign(Object.create(null), state, {
              source: window,
              type: 'again',
              findPrevious: cmd === 5 || cmd === 12,
            })
            eventBus.dispatch('find', eventState)
          }
          handled = true
        }
        break
      case 61: // FF/Mac '='
      case 107: // FF '+' and '='
      case 187: // Chrome '+'
      case 171: // FF with German keyboard
        if (!isViewerInPresentationMode) {
          pdfInstance.zoomIn()
        }
        handled = true
        break
      case 173: // FF/Mac '-'
      case 109: // FF '-'
      case 189: // Chrome '-'
        if (!isViewerInPresentationMode) {
          pdfInstance.zoomOut()
        }
        handled = true
        break
      case 48: // '0'
      case 96: // '0' on Numpad of Swedish keyboard
        if (!isViewerInPresentationMode) {
          // keeping it unhandled (to restore page zoom to 100%)
          setTimeout(function () {
            // ... and resetting the scale after browser adjusts its scale
            pdfInstance.zoomReset()
          })
          handled = false
        }
        break

      case 38: // up arrow
        if (isViewerInPresentationMode || pdfInstance.page > 1) {
          pdfInstance.page = 1
          handled = true
          ensureViewerFocused = true
        }
        break
      case 40: // down arrow
        if (
          isViewerInPresentationMode ||
          pdfInstance.page < pdfInstance.pagesCount
        ) {
          pdfInstance.page = pdfInstance.pagesCount
          handled = true
          ensureViewerFocused = true
        }
        break
    }
  }

  if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC || CHROME')) {
    // CTRL or META without shift
    if (cmd === 1 || cmd === 8) {
      switch (evt.keyCode) {
        case 83: // s
          eventBus.dispatch('download', {source: window})
          handled = true
          break

        case 79: // o
          if (typeof PDFJSDev === 'undefined' || PDFJSDev.test('GENERIC')) {
            eventBus.dispatch('openfile', {source: window})
            handled = true
          }
          break
      }
    }
  }

  // CTRL+ALT or Option+Command
  if (cmd === 3 || cmd === 10) {
    switch (evt.keyCode) {
      case 80: // p
        pdfInstance.requestPresentationMode()
        handled = true
        pdfInstance.externalServices.reportTelemetry({
          type: 'buttons',
          data: {id: 'presentationModeKeyboard'},
        })
        break
      case 71: // g
        // focuses input#pageNumber field
        pdfInstance.appConfig.toolbar.pageNumber.select()
        handled = true
        break
    }
  }

  if (handled) {
    if (ensureViewerFocused && !isViewerInPresentationMode) {
      pdfViewer.focus()
    }
    evt.preventDefault()
    return
  }

  // Some shortcuts should not get handled if a control/input element
  // is selected.
  const curElement = getActiveOrFocusedElement()
  const curElementTagName = curElement?.tagName.toUpperCase()
  if (
    curElementTagName === 'INPUT' ||
    curElementTagName === 'TEXTAREA' ||
    curElementTagName === 'SELECT' ||
    curElement?.isContentEditable
  ) {
    // Make sure that the secondary toolbar is closed when Escape is pressed.
    if (evt.keyCode !== /* Esc = */ 27) {
      return
    }
  }

  // No control key pressed at all.
  if (cmd === 0) {
    let turnPage = 0,
      turnOnlyIfPageFit = false
    switch (evt.keyCode) {
      case 38: // up arrow
      case 33: // pg up
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true
        }
        turnPage = -1
        break
      case 8: // backspace
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true
        }
        turnPage = -1
        break
      case 37: // left arrow
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true
        }
      /* falls through */
      case 75: // 'k'
      case 80: // 'p'
        turnPage = -1
        break
      case 27: // esc key
        if (pdfInstance.secondaryToolbar.isOpen) {
          pdfInstance.secondaryToolbar.close()
          handled = true
        }
        if (
          !pdfInstance.supportsIntegratedFind &&
          pdfInstance.findBar.opened
        ) {
          pdfInstance.findBar.close()
          handled = true
        }
        break
      case 40: // down arrow
      case 34: // pg down
        // vertical scrolling using arrow/pg keys
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true
        }
        turnPage = 1
        break
      case 13: // enter key
      case 32: // spacebar
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true
        }
        turnPage = 1
        break
      case 39: // right arrow
        // horizontal scrolling using arrow keys
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true
        }
      /* falls through */
      case 74: // 'j'
      case 78: // 'n'
        turnPage = 1
        break

      case 36: // home
        if (isViewerInPresentationMode || pdfInstance.page > 1) {
          pdfInstance.page = 1
          handled = true
          ensureViewerFocused = true
        }
        break
      case 35: // end
        if (
          isViewerInPresentationMode ||
          pdfInstance.page < pdfInstance.pagesCount
        ) {
          pdfInstance.page = pdfInstance.pagesCount
          handled = true
          ensureViewerFocused = true
        }
        break

      case 83: // 's'
        pdfInstance.pdfCursorTools.switchTool(CursorTool.SELECT)
        break
      case 72: // 'h'
        pdfInstance.pdfCursorTools.switchTool(CursorTool.HAND)
        break

      case 82: // 'r'
        pdfInstance.rotatePages(90)
        break

      case 115: // F4
        pdfInstance.pdfSidebar.toggle()
        break
    }

    if (
      turnPage !== 0 &&
      (!turnOnlyIfPageFit || pdfViewer.currentScaleValue === 'page-fit')
    ) {
      if (turnPage > 0) {
        pdfViewer.nextPage()
      } else {
        pdfViewer.previousPage()
      }
      handled = true
    }
  }

  // shift-key
  if (cmd === 4) {
    switch (evt.keyCode) {
      case 13: // enter key
      case 32: // spacebar
        if (
          !isViewerInPresentationMode &&
          pdfViewer.currentScaleValue !== 'page-fit'
        ) {
          break
        }
        pdfViewer.previousPage()

        handled = true
        break

      case 82: // 'r'
        pdfInstance.rotatePages(-90)
        break
    }
  }

  if (!handled && !isViewerInPresentationMode) {
    // 33=Page Up  34=Page Down  35=End    36=Home
    // 37=Left     38=Up         39=Right  40=Down
    // 32=Spacebar
    if (
      (evt.keyCode >= 33 && evt.keyCode <= 40) ||
      (evt.keyCode === 32 && curElementTagName !== 'BUTTON')
    ) {
      ensureViewerFocused = true
    }
  }

  if (ensureViewerFocused && !pdfViewer.containsElement(curElement)) {
    // The page container is not focused, but a page navigation key has been
    // pressed. Change the focus to the viewer container to make sure that
    // navigation by keyboard works as expected.
    pdfViewer.focus()
  }

  if (handled) {
    evt.preventDefault()
  }
}

function beforeUnload (evt) {
  evt.preventDefault()
  evt.returnValue = ''
  return false
}

// NOTE
function webViewerAnnotationEditorStatesChanged (data) {
  const pdfInstance = getPdfInstance(data.target)
  if (!pdfInstance || pdfInstance.overlayManager.active) {
    return
  }
  pdfInstance
  PDFViewerApplication.externalServices.updateEditorStates(data)
}

/* Abstract factory for the print service. */
const PDFPrintServiceFactory = {
  instance: {
    supportsPrinting: false,
    createPrintService () {
      throw new Error('Not implemented: createPrintService')
    },
  },
}

export {
  PDFPrintServiceFactory,
  PDFViewerApplication,
  // NOTE
  webViewerPageNumberChanged,
}
