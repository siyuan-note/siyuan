// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type SettingSnpt struct {
	EnabledCSS bool `json:"enabledCSS" api:"optional,nullable"`
	EnabledJS  bool `json:"enabledJS" api:"optional,nullable"`
}

type SettingBazaar struct {
	Trust         bool `json:"trust" api:"optional,nullable"`
	PetalDisabled bool `json:"petalDisabled" api:"optional,nullable"`
}

type SettingAI struct {
	Web             *SettingAIWeb           `json:"web" api:"optional,nullable"`
	MCP             *SettingMCP             `json:"mcp" api:"optional,nullable"`
	Embedding       *SettingEmbedding       `json:"embedding" api:"optional,nullable"`
	Rerank          *SettingRerank          `json:"rerank" api:"optional,nullable"`
	Decision        *SettingDecision        `json:"decision" api:"optional,nullable"`
	Agent           *SettingAgent           `json:"agent" api:"optional,nullable"`
	Editing         *SettingEditing         `json:"editing" api:"optional,nullable"`
	ImageGeneration *SettingImageGeneration `json:"imageGeneration" api:"optional,nullable"`
	Providers       []*SettingProvider      `json:"providers" api:"optional,nullable"`
}

// SettingAIWeb 初始搜索为 exa，抓取为 direct；可分别选择 deepseek，共用独立 API 密钥。
// 超时默认 30 秒，上限 600 秒。
// DeepSeek Search 返回 5 条摘要且不取正文；Fetch 仅获取网页正文，不下载文件。
// Search 发送查询词，Fetch 发送目标 URL；不发送原始问题、浏览器凭证或额外笔记内容。
type SettingAIWeb struct {
	SearchProvider string `json:"searchProvider" api:"optional,nullable"`
	FetchProvider  string `json:"fetchProvider" api:"optional,nullable"`
	APIKey         string `json:"apiKey" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
}

type SettingMCP struct {
	Servers        []SettingMCPServer       `json:"servers" api:"optional,nullable"`
	ExposurePolicy *SettingCapabilityPolicy `json:"exposurePolicy" api:"optional,nullable"`
}

type SettingMCPServer struct {
	ID                   string            `json:"id" api:"optional,nullable"`
	Name                 string            `json:"name" api:"optional,nullable"`
	Enabled              bool              `json:"enabled" api:"optional,nullable"`
	Type                 string            `json:"type" api:"optional,nullable"`
	Command              string            `json:"command" api:"optional,nullable"`
	Args                 []string          `json:"args" api:"optional,nullable"`
	InheritEnv           []string          `json:"inheritEnv" api:"optional,nullable"`
	Env                  map[string]string `json:"env" api:"optional,nullable"`
	URL                  string            `json:"url" api:"optional,nullable"`
	Headers              map[string]string `json:"headers" api:"optional,nullable"`
	Timeout              int               `json:"timeout" api:"optional,nullable"`
	DisableStandaloneSSE bool              `json:"disableStandaloneSSE" api:"optional,nullable"`
	TrustToolAnnotations bool              `json:"trustToolAnnotations" api:"optional,nullable"`
}

type SettingCapabilityPolicy struct {
	Default   string            `json:"default" api:"optional,nullable"`
	Overrides map[string]string `json:"overrides" api:"optional,nullable"`
}

type SettingEmbedding struct {
	ID          string `json:"id" api:"optional,nullable"`
	Enabled     bool   `json:"enabled" api:"optional,nullable"`
	APIKey      string `json:"apiKey" api:"optional,nullable"`
	BaseURL     string `json:"baseURL" api:"optional,nullable"`
	Name        string `json:"name" api:"optional,nullable"`
	Timeout     int    `json:"timeout" api:"optional,nullable"`
	Dimensions  int    `json:"dimensions" api:"optional,nullable"`
	Concurrency int    `json:"concurrency" api:"optional,nullable"`
	BatchSize   int    `json:"batchSize" api:"optional,nullable"`
}

type SettingRerank struct {
	ID             string `json:"id" api:"optional,nullable"`
	Enabled        bool   `json:"enabled" api:"optional,nullable"`
	APIKey         string `json:"apiKey" api:"optional,nullable"`
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	Name           string `json:"name" api:"optional,nullable"`
	RequestFormat  string `json:"requestFormat" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	CandidateCount int    `json:"candidateCount" api:"optional,nullable"`
}

type SettingDecision struct {
	Enabled  bool                               `json:"enabled" api:"optional,nullable"`
	Provider string                             `json:"provider" api:"optional,nullable"`
	Profiles map[string]*SettingDecisionProfile `json:"profiles" api:"optional,nullable"`
	Endpoint string                             `json:"endpoint" api:"optional,nullable"`
	APIKey   string                             `json:"apiKey" api:"optional,nullable"`
	Name     string                             `json:"name" api:"optional,nullable"`
	Timeout  int                                `json:"timeout" api:"optional,nullable"`
}

type SettingDecisionProfile struct {
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
	Name     string `json:"name"`
	Timeout  int    `json:"timeout"`
}

type SettingAgent struct {
	// 默认关闭，保存在 conf.json；升级不读取前端旧键，重置普通设置时随 AI 配置保留。
	StreamingMarkdown   bool                     `json:"streamingMarkdown" api:"optional,nullable"`
	ModelID             string                   `json:"modelId" api:"optional,nullable"`
	SessionTimeout      int                      `json:"sessionTimeout" api:"optional,nullable"`
	StreamIdleTimeout   int                      `json:"streamIdleTimeout" api:"optional,nullable"`
	ConfirmTimeout      int                      `json:"confirmTimeout" api:"optional,nullable"`
	MaxRetries          int                      `json:"maxRetries" api:"optional,nullable"`
	Temperature         float64                  `json:"temperature" api:"optional,nullable"`
	MaxCompletionTokens int                      `json:"maxCompletionTokens" api:"optional,nullable"`
	MaxToolCallRounds   int                      `json:"maxToolCallRounds" api:"optional,nullable"`
	CapabilityPolicy    *SettingCapabilityPolicy `json:"capabilityPolicy" api:"optional,nullable"`
	ApprovalPolicy      *SettingApprovalPolicy   `json:"approvalPolicy" api:"optional,nullable"`
	Skills              *SettingAgentSkills      `json:"skills" api:"optional,nullable"`
}

type SettingApprovalPolicy struct {
	Default   string                                `json:"default" api:"optional,nullable"`
	Overrides map[string]*SettingCapabilityApproval `json:"overrides" api:"optional,nullable"`
}

type SettingCapabilityApproval struct {
	Default string            `json:"default" api:"optional,nullable"`
	Actions map[string]string `json:"actions" api:"optional,nullable"`
}

type SettingAgentSkills struct {
	UserEnabled []string `json:"userEnabled" api:"optional,nullable"`
	// BuiltinDisabled 保存稳定的官方技能 ID；省略时默认启用，未知 ID 在配置规范化时保留。
	BuiltinDisabled []string `json:"builtinDisabled" api:"optional,nullable"`
}

type SettingEditing struct {
	ModelID             string  `json:"modelId" api:"optional,nullable"`
	MaxHistoryMessages  int     `json:"maxHistoryMessages" api:"optional,nullable"`
	Temperature         float64 `json:"temperature" api:"optional,nullable"`
	MaxCompletionTokens int     `json:"maxCompletionTokens" api:"optional,nullable"`
}

type SettingImageGeneration struct {
	ModelID        string `json:"modelId" api:"optional,nullable"`
	RequestTimeout int    `json:"requestTimeout" api:"optional,nullable"`
	Size           string `json:"size" api:"optional,nullable"`
	Quality        string `json:"quality" api:"optional,nullable"`
	OutputFormat   string `json:"outputFormat" api:"optional,nullable"`
}

type SettingProvider struct {
	// 套餐认证固定使用公开 Responses API；账户引用不包含令牌，省略时保留 API Key 认证。
	AuthType string `json:"authType,omitempty" api:"optional,nullable"`
	// AccountID 读写本机按工作空间路径和服务商 ID 保存的绑定，不随 conf.json 或设置导出保存。
	// 清空或省略时解除该服务商的本机绑定；旧配置中的账户引用不迁移，各设备需重新选择。
	AccountID   string            `json:"accountID,omitempty" api:"optional,nullable"`
	Headers     map[string]string `json:"headers,omitempty" api:"optional,nullable"`
	ID          string            `json:"id" api:"optional,nullable"`
	DisplayName string            `json:"displayName,omitempty" api:"optional,nullable"`
	Enabled     bool              `json:"enabled" api:"optional,nullable"`
	APIKey      string            `json:"apiKey" api:"optional,nullable"`
	BaseURL     string            `json:"baseURL" api:"optional,nullable"`
	// Protocol 支持 openai、openai-responses、anthropic-messages 和 gemini-interactions，省略时保持 openai。
	// Gemini Interactions 使用原生 /v1beta 或 /v1 基础地址，空地址默认为 Google 官方 /v1beta。
	Protocol       string          `json:"protocol,omitempty" api:"optional,nullable"`
	RequestTimeout int             `json:"requestTimeout" api:"optional,nullable"`
	Models         []*SettingModel `json:"models" api:"optional,nullable"`
}

type SettingModel struct {
	ID            string `json:"id" api:"optional,nullable"`
	DisplayName   string `json:"displayName,omitempty" api:"optional,nullable"`
	Enabled       bool   `json:"enabled" api:"optional,nullable"`
	Name          string `json:"name" api:"optional,nullable"`
	ContextLength int    `json:"contextLength,omitempty" api:"optional,nullable"`
}

type SettingSecrets struct {
	Items []*SettingSecret `json:"items" api:"optional,nullable"`
}

type SettingSecret struct {
	Name         string   `json:"name" api:"optional,nullable"`
	Value        string   `json:"value" api:"optional,nullable"`
	AllowedHosts []string `json:"allowedHosts" api:"optional,nullable"`
}

type SettingVariables struct {
	Items []*SettingVariable `json:"items" api:"optional,nullable"`
}

type SettingVariable struct {
	Name  string `json:"name" api:"optional,nullable"`
	Value string `json:"value" api:"optional,nullable"`
}

type SettingFlashcard struct {
	NewCardLimit     int     `json:"newCardLimit" api:"optional,nullable"`
	ReviewCardLimit  int     `json:"reviewCardLimit" api:"optional,nullable"`
	Mark             bool    `json:"mark" api:"optional,nullable"`
	List             bool    `json:"list" api:"optional,nullable"`
	Blockquote       bool    `json:"blockquote" api:"optional,nullable"`
	Callout          bool    `json:"callout" api:"optional,nullable"`
	SuperBlock       bool    `json:"superBlock" api:"optional,nullable"`
	Heading          bool    `json:"heading" api:"optional,nullable"`
	Deck             bool    `json:"deck" api:"optional,nullable"`
	ReviewMode       int     `json:"reviewMode" api:"optional,nullable"`
	RequestRetention float64 `json:"requestRetention" api:"optional,nullable"`
	MaximumInterval  int     `json:"maximumInterval" api:"optional,nullable"`
	Weights          string  `json:"weights" api:"optional,nullable"`
}

// SettingEditor 描述编辑器配置。displayImgName、displayImgAlt、blockGutterMode 和 pageScrollButtons 默认关闭，
// null 表示回到默认值，其他非布尔类型拒绝更新。
type SettingEditor struct {
	AllowSVGScript                  bool                 `json:"allowSVGScript" api:"optional,nullable"`
	AllowHTMLBLockScript            bool                 `json:"allowHTMLBLockScript" api:"optional,nullable"`
	CursorSurroundingLines          int                  `json:"cursorSurroundingLines" api:"optional,nullable"`
	FontSize                        int                  `json:"fontSize" api:"optional,nullable"`
	FontSizeScrollZoom              bool                 `json:"fontSizeScrollZoom" api:"optional,nullable"`
	FontFamily                      string               `json:"fontFamily" api:"optional,nullable"`
	FontWeight                      int                  `json:"fontWeight" api:"optional,nullable"`
	FontFamilyDisplay               string               `json:"fontFamilyDisplay" api:"optional,nullable"`
	FontFamilies                    []*SettingEditorFont `json:"fontFamilies" api:"optional,nullable"`
	CodeFontFamilies                []*SettingEditorFont `json:"codeFontFamilies" api:"optional,nullable"`
	CodeSyntaxHighlightLineNum      bool                 `json:"codeSyntaxHighlightLineNum" api:"optional,nullable"`
	CodeTabSpaces                   int                  `json:"codeTabSpaces" api:"optional,nullable"`
	CodeLineWrap                    bool                 `json:"codeLineWrap" api:"optional,nullable"`
	CodeLigatures                   bool                 `json:"codeLigatures" api:"optional,nullable"`
	DisplayBookmarkIcon             bool                 `json:"displayBookmarkIcon" api:"optional,nullable"`
	BlockGutterMode                 bool                 `json:"blockGutterMode" api:"optional,nullable"`
	DisplayNetImgMark               bool                 `json:"displayNetImgMark" api:"optional,nullable"`
	DisplayImgName                  bool                 `json:"displayImgName" api:"optional,nullable"`
	DisplayImgAlt                   bool                 `json:"displayImgAlt" api:"optional,nullable"`
	DatabaseAttrShow                *bool                `json:"databaseAttrShow" api:"optional,nullable"`
	DatabaseAttrClickMode           int                  `json:"databaseAttrClickMode" api:"optional,nullable"`
	DatabaseAttrViewMode            int                  `json:"databaseAttrViewMode" api:"optional,nullable"`
	DatabaseAttrHideEmpty           bool                 `json:"databaseAttrHideEmpty" api:"optional,nullable"`
	DatabaseAttrUseTabs             *bool                `json:"databaseAttrUseTabs" api:"optional,nullable"`
	GenerateHistoryInterval         int                  `json:"generateHistoryInterval" api:"optional,nullable"`
	HistoryRetentionDays            int                  `json:"historyRetentionDays" api:"optional,nullable"`
	Emoji                           []string             `json:"emoji" api:"optional,nullable"`
	VirtualBlockRef                 bool                 `json:"virtualBlockRef" api:"optional,nullable"`
	VirtualBlockRefExclude          string               `json:"virtualBlockRefExclude" api:"optional,nullable"`
	VirtualBlockRefInclude          string               `json:"virtualBlockRefInclude" api:"optional,nullable"`
	CheckBlockRef                   *bool                `json:"checkBlockRef" api:"optional,nullable"`
	BlockRefDynamicAnchorTextMaxLen int                  `json:"blockRefDynamicAnchorTextMaxLen" api:"optional,nullable"`
	AssetOpen                       *SettingAssetOpen    `json:"assetOpen" api:"optional,nullable"`
	PlantUMLServePath               string               `json:"plantUMLServePath" api:"optional,nullable"`
	FullWidth                       bool                 `json:"fullWidth" api:"optional,nullable"`
	KaTexMacros                     string               `json:"katexMacros" api:"optional,nullable"`
	ReadOnly                        bool                 `json:"readOnly" api:"optional,nullable"`
	EmbedBlockBreadcrumb            bool                 `json:"embedBlockBreadcrumb" api:"optional,nullable"`
	// 默认显示文档上层路径；省略保留当前值，null 恢复默认，块级显式设置优先。
	EmbedBlockBreadcrumbParentPath *bool `json:"embedBlockBreadcrumbParentPath" api:"optional,nullable"`
	ListLogicalOutdent             bool  `json:"listLogicalOutdent" api:"optional,nullable"`
	ListItemDotNumberClickFocus    bool  `json:"listItemDotNumberClickFocus" api:"optional,nullable"`
	FloatWindowMode                int   `json:"floatWindowMode" api:"optional,nullable"`
	FloatWindowDelay               *int  `json:"floatWindowDelay" api:"optional,nullable"`
	KeepLoadedContent              bool  `json:"keepLoadedContent" api:"optional,nullable"`
	// PageScrollButtons 控制翻屏按钮，默认关闭，不迁移旧的本地偏好。
	PageScrollButtons bool `json:"pageScrollButtons" api:"optional,nullable"`
	DynamicLoadBlocks int  `json:"dynamicLoadBlocks" api:"optional,nullable"`
	Justify           bool `json:"justify" api:"optional,nullable"`
	RTL               bool `json:"rtl" api:"optional,nullable"`
	// AutoDirection 默认关闭；段落和标题按首个强方向字符排版，列表项独立调整标记和缩进。
	// 手动方向优先，表格列顺序不变。
	AutoDirection       bool     `json:"autoDirection" api:"optional,nullable"`
	Spellcheck          bool     `json:"spellcheck" api:"optional,nullable"`
	SpellcheckLanguages []string `json:"spellcheckLanguages" api:"optional,nullable"`
	HashTagSearch       *bool    `json:"hashTagSearch" api:"optional,nullable"`
	OnlySearchForDoc    bool     `json:"onlySearchForDoc" api:"optional,nullable"`
	// AutoCloseRefBrackets 默认关闭；启用后输入 [[ 自动补全 ]]，输入 ]] 时引用同名文档、日记或新建文档。
	AutoCloseRefBrackets    bool   `json:"autoCloseRefBrackets" api:"optional,nullable"`
	BacklinkExpandCount     int    `json:"backlinkExpandCount" api:"optional,nullable"`
	BackmentionExpandCount  int    `json:"backmentionExpandCount" api:"optional,nullable"`
	BacklinkMentionExclude  string `json:"backlinkMentionExclude" api:"optional,nullable"`
	BacklinkContainChildren bool   `json:"backlinkContainChildren" api:"optional,nullable"`
	BacklinkHideReference   bool   `json:"backlinkHideReference" api:"optional,nullable"`
	BacklinkShowBottom      bool   `json:"backlinkShowBottom" api:"optional,nullable"`
	BacklinkSort            *int   `json:"backlinkSort" api:"optional,nullable"`
	BacklinkGlobalSort      int    `json:"backlinkGlobalSort" api:"optional,nullable"`
	BacklinkBlockSort       int    `json:"backlinkBlockSort" api:"optional,nullable"`
	BackmentionSort         *int   `json:"backmentionSort" api:"optional,nullable"`
	HeadingNumber           bool   `json:"headingNumber" api:"optional,nullable"`
	HeadingNumberFormat     string `json:"headingNumberFormat" api:"optional,nullable"`
	HeadingEmbedMode        int    `json:"headingEmbedMode" api:"optional,nullable"`
	PasteURLAutoConvert     bool   `json:"pasteURLAutoConvert" api:"optional,nullable"`
	// MathDelimiterCompatibility defaults to true, including existing configurations without this field.
	// Only pasted HTML/Markdown and imported Markdown recognize \(...\) and \[...\]; editing and exports retain the existing syntax.
	MathDelimiterCompatibility *bool            `json:"mathDelimiterCompatibility" api:"optional,nullable"`
	DragHTMLFileToIframe       bool             `json:"dragHTMLFileToIframe" api:"optional,nullable"`
	Markdown                   *SettingMarkdown `json:"markdown" api:"optional,nullable"`

	// 文档顶部与独立条目面板的字段布局：0 单栏，1 双栏按行（默认），2 双栏按列；空间不足时使用单栏。
	// 省略保留当前值，null 或越界整数恢复默认，按列时按可见字段数量均分，奇数时左栏多一个。
	DatabaseAttrLayout *int `json:"databaseAttrLayout" api:"optional,nullable"`
}

type SettingEditorFont struct {
	Family      string `json:"family" api:"optional,nullable"`
	Weight      int    `json:"weight" api:"optional,nullable"`
	DisplayName string `json:"displayName" api:"optional,nullable"`
}

type SettingAssetOpen struct {
	Click      string `json:"click" api:"optional,nullable"`
	CtrlClick  string `json:"ctrlClick" api:"optional,nullable"`
	AltClick   string `json:"altClick" api:"optional,nullable"`
	ShiftClick string `json:"shiftClick" api:"optional,nullable"`
}

type SettingMarkdown struct {
	InlineAsterisk               bool  `json:"inlineAsterisk" api:"optional,nullable"`
	InlineUnderscore             bool  `json:"inlineUnderscore" api:"optional,nullable"`
	InlineSup                    bool  `json:"inlineSup" api:"optional,nullable"`
	InlineSub                    bool  `json:"inlineSub" api:"optional,nullable"`
	InlineTag                    bool  `json:"inlineTag" api:"optional,nullable"`
	InlineMath                   bool  `json:"inlineMath" api:"optional,nullable"`
	InlineStrikethrough          bool  `json:"inlineStrikethrough" api:"optional,nullable"`
	InlineFullWidthStrikethrough bool  `json:"inlineFullWidthStrikethrough" api:"optional,nullable"`
	BlockFullWidthTaskList       *bool `json:"blockFullWidthTaskList" api:"optional,nullable"`
	InlineMark                   bool  `json:"inlineMark" api:"optional,nullable"`
	CodeBlockMiddleDot           *bool `json:"codeBlockMiddleDot" api:"optional,nullable"`
}

type SettingExport struct {
	ParagraphBeginningSpace bool   `json:"paragraphBeginningSpace" api:"optional,nullable"`
	AddTitle                bool   `json:"addTitle" api:"optional,nullable"`
	BlockRefMode            int    `json:"blockRefMode" api:"optional,nullable"`
	BlockEmbedMode          int    `json:"blockEmbedMode" api:"optional,nullable"`
	BlockRefTextLeft        string `json:"blockRefTextLeft" api:"optional,nullable"`
	BlockRefTextRight       string `json:"blockRefTextRight" api:"optional,nullable"`
	TagOpenMarker           string `json:"tagOpenMarker" api:"optional,nullable"`
	TagCloseMarker          string `json:"tagCloseMarker" api:"optional,nullable"`
	FileAnnotationRefMode   int    `json:"fileAnnotationRefMode" api:"optional,nullable"`
	PandocBin               string `json:"pandocBin" api:"optional,nullable"`
	PandocParams            string `json:"pandocParams" api:"optional,nullable"`
	RemoveAssetsID          bool   `json:"removeAssetsID" api:"optional,nullable"`
	MarkdownYFM             bool   `json:"markdownYFM" api:"optional,nullable"`
	InlineMemo              bool   `json:"inlineMemo" api:"optional,nullable"`
	IncludeSubDocs          bool   `json:"includeSubDocs" api:"optional,nullable"`
	IncludeRelatedDocs      bool   `json:"includeRelatedDocs" api:"optional,nullable"`
	PDFFooter               string `json:"pdfFooter" api:"optional,nullable"`
	PDFWatermarkStr         string `json:"pdfWatermarkStr" api:"optional,nullable"`
	PDFWatermarkDesc        string `json:"pdfWatermarkDesc" api:"optional,nullable"`
	ImageWatermarkStr       string `json:"imageWatermarkStr" api:"optional,nullable"`
	ImageWatermarkDesc      string `json:"imageWatermarkDesc" api:"optional,nullable"`
}

type SettingFileTree struct {
	// 默认 viewedAt；支持 created、updated、openAt、closedAt，未知值回落 viewedAt。重置文档树设置时恢复默认。
	RecentDocsSort         string `json:"recentDocsSort" api:"optional,nullable"`
	AlwaysSelectOpenedFile bool   `json:"alwaysSelectOpenedFile" api:"optional,nullable"`
	OpenFilesUseCurrentTab bool   `json:"openFilesUseCurrentTab" api:"optional,nullable"`
	CloseTabOnDoubleClick  bool   `json:"closeTabOnDoubleClick" api:"optional,nullable"`
	// 默认 true；关闭或移走独立桌面窗口的最后一个页签后关闭该窗口，不影响主窗口。省略时保留现值，null 恢复默认。
	CloseWindowOnLastTabClosed *bool `json:"closeWindowOnLastTabClosed" api:"optional,nullable"`
	// 单击文档图标或笔记本图标的行为：0 修改图标，1 展开或折叠子文档。无子文档时，1 在有可打开文档时打开文档，否则修改图标。
	// 超出取值范围的输入按 0 处理。已废弃的 docIconClickExpand 不再读取，旧配置升级后回到 0。
	DocIconClickMode int `json:"docIconClickMode" api:"optional,nullable"`
	// 点击父文档标题的行为：0 打开文档，1 展开或折叠子文档，2 单击展开或折叠子文档、双击打开父文档。
	// 没有子文档时各取值均直接打开文档；取 2 时单击需等待约 300 毫秒以判断是否双击。超出取值范围的输入按 0 处理。
	// 已废弃的 parentDocClickExpand 与 parentDocDoubleClickOpen 不再读取，旧配置升级后回到 0。
	ParentDocTitleClickMode  int    `json:"parentDocTitleClickMode" api:"optional,nullable"`
	BoxDocEnabled            *bool  `json:"boxDocEnabled" api:"optional,nullable"`
	UseSVGDefaultIcon        *bool  `json:"useSVGDefaultIcon" api:"optional,nullable"`
	RefCreateSaveBox         string `json:"refCreateSaveBox" api:"optional,nullable"`
	RefCreateSavePath        string `json:"refCreateSavePath" api:"optional,nullable"`
	DocCreateSaveBox         string `json:"docCreateSaveBox" api:"optional,nullable"`
	DocCreateSavePath        string `json:"docCreateSavePath" api:"optional,nullable"`
	DocCreateTemplatePath    string `json:"docCreateTemplatePath" api:"optional,nullable"`
	ShorthandSaveBox         string `json:"shorthandSaveBox" api:"optional,nullable"`
	ShorthandSavePath        string `json:"shorthandSavePath" api:"optional,nullable"`
	MaxListCount             int    `json:"maxListCount" api:"optional,nullable"`
	MaxOpenTabCount          int    `json:"maxOpenTabCount" api:"optional,nullable"`
	AllowCreateDeeper        bool   `json:"allowCreateDeeper" api:"optional,nullable"`
	RemoveDocWithoutConfirm  bool   `json:"removeDocWithoutConfirm" api:"optional,nullable"`
	CloseTabsOnStart         bool   `json:"closeTabsOnStart" api:"optional,nullable"`
	TabStartupMode           *int   `json:"tabStartupMode" api:"optional,nullable"`
	UseSingleLineSave        bool   `json:"useSingleLineSave" api:"optional,nullable"`
	LargeFileWarningSize     int    `json:"largeFileWarningSize" api:"optional,nullable"`
	CreateDocAtTop           *bool  `json:"createDocAtTop" api:"optional,nullable"`
	Sort                     int    `json:"sort" api:"optional,nullable"`
	RecentDocsMaxListCount   int    `json:"recentDocsMaxListCount" api:"optional,nullable"`
	NoSplitScreenWhenOpenTab bool   `json:"noSplitScreenWhenOpenTab" api:"optional,nullable"`
}

type SettingSearch struct {
	// 思维导图默认开启，思维导图项默认关闭；null 表示回到默认值。
	Mindmap                      *bool `json:"mindmap" api:"optional,nullable"`
	MindmapItem                  *bool `json:"mindmapItem" api:"optional,nullable"`
	CustomBlock                  *bool `json:"customBlock" api:"optional,nullable"`
	Document                     bool  `json:"document" api:"optional,nullable"`
	Heading                      bool  `json:"heading" api:"optional,nullable"`
	List                         bool  `json:"list" api:"optional,nullable"`
	ListItem                     bool  `json:"listItem" api:"optional,nullable"`
	CodeBlock                    bool  `json:"codeBlock" api:"optional,nullable"`
	MathBlock                    bool  `json:"mathBlock" api:"optional,nullable"`
	Table                        bool  `json:"table" api:"optional,nullable"`
	Blockquote                   bool  `json:"blockquote" api:"optional,nullable"`
	SuperBlock                   bool  `json:"superBlock" api:"optional,nullable"`
	Paragraph                    bool  `json:"paragraph" api:"optional,nullable"`
	HTMLBlock                    bool  `json:"htmlBlock" api:"optional,nullable"`
	EmbedBlock                   bool  `json:"embedBlock" api:"optional,nullable"`
	DatabaseBlock                bool  `json:"databaseBlock" api:"optional,nullable"`
	AudioBlock                   bool  `json:"audioBlock" api:"optional,nullable"`
	VideoBlock                   bool  `json:"videoBlock" api:"optional,nullable"`
	IFrameBlock                  bool  `json:"iframeBlock" api:"optional,nullable"`
	WidgetBlock                  bool  `json:"widgetBlock" api:"optional,nullable"`
	Callout                      bool  `json:"callout" api:"optional,nullable"`
	Tabs                         bool  `json:"tabs" api:"optional,nullable"`
	TabItem                      bool  `json:"tabItem" api:"optional,nullable"`
	Limit                        int   `json:"limit" api:"optional,nullable"`
	CaseSensitive                bool  `json:"caseSensitive" api:"optional,nullable"`
	HanSensitive                 *bool `json:"hanSensitive" api:"optional,nullable"`
	Name                         bool  `json:"name" api:"optional,nullable"`
	Alias                        bool  `json:"alias" api:"optional,nullable"`
	Memo                         bool  `json:"memo" api:"optional,nullable"`
	IAL                          bool  `json:"ial" api:"optional,nullable"`
	IndexAssetPath               bool  `json:"indexAssetPath" api:"optional,nullable"`
	BacklinkMentionName          bool  `json:"backlinkMentionName" api:"optional,nullable"`
	BacklinkMentionAlias         bool  `json:"backlinkMentionAlias" api:"optional,nullable"`
	BacklinkMentionAnchor        bool  `json:"backlinkMentionAnchor" api:"optional,nullable"`
	BacklinkMentionDoc           bool  `json:"backlinkMentionDoc" api:"optional,nullable"`
	BacklinkMentionKeywordsLimit int   `json:"backlinkMentionKeywordsLimit" api:"optional,nullable"`
	VirtualRefName               bool  `json:"virtualRefName" api:"optional,nullable"`
	VirtualRefAlias              bool  `json:"virtualRefAlias" api:"optional,nullable"`
	VirtualRefAnchor             bool  `json:"virtualRefAnchor" api:"optional,nullable"`
	VirtualRefDoc                bool  `json:"virtualRefDoc" api:"optional,nullable"`
}

type SettingAppearance struct {
	// LockScreenWallpaper 默认关闭；图片单独保存在 conf/lockscreen/wallpaper.jpg，不进入设置导出或笔记同步。
	LockScreenWallpaper bool `json:"lockScreenWallpaper" api:"optional,nullable"`
	// 以下用户偏好保存在 conf.json，支持配置导入导出；不读取或迁移 local.json 旧键。
	// 重置外观设置时恢复默认；紧凑模式与菜单鼠标滚动默认关闭，新建空工作空间的菜单鼠标滚动默认开启。
	CompactMode              bool                      `json:"compactMode" api:"optional,nullable"`
	MenuMouseScroll          bool                      `json:"menuMouseScroll" api:"optional,nullable"`
	PDFTheme                 *SettingPDFTheme          `json:"pdfTheme" api:"optional,nullable"`
	OutlineKeepCurrentExpand bool                      `json:"outlineKeepCurrentExpand" api:"optional,nullable"`
	MobileBars               *SettingMobileBars        `json:"mobileBars" api:"optional,nullable"`
	BodyGradient             *SettingBodyGradient      `json:"bodyGradient" api:"optional,nullable"`
	GlobalFontFamilies       []*SettingEditorFont      `json:"globalFontFamilies" api:"optional,nullable"`
	Mode                     int                       `json:"mode" api:"optional,nullable"`
	ModeOS                   bool                      `json:"modeOS" api:"optional,nullable"`
	DarkThemes               []*SettingAppearanceTheme `json:"darkThemes" api:"optional,nullable"`
	LightThemes              []*SettingAppearanceTheme `json:"lightThemes" api:"optional,nullable"`
	ThemeDark                string                    `json:"themeDark" api:"optional,nullable"`
	ThemeLight               string                    `json:"themeLight" api:"optional,nullable"`
	ThemeVer                 string                    `json:"themeVer" api:"optional,nullable"`
	Icons                    []*SettingAppearanceIcon  `json:"icons" api:"optional,nullable"`
	Icon                     string                    `json:"icon" api:"optional,nullable"`
	IconVer                  string                    `json:"iconVer" api:"optional,nullable"`
	CodeBlockThemeLight      string                    `json:"codeBlockThemeLight" api:"optional,nullable"`
	CodeBlockThemeDark       string                    `json:"codeBlockThemeDark" api:"optional,nullable"`
	Lang                     string                    `json:"lang" api:"optional,nullable"`
	ThemeJS                  bool                      `json:"themeJS" api:"optional,nullable"`
	CloseButtonBehavior      int                       `json:"closeButtonBehavior" api:"optional,nullable"`
	HideToolbar              bool                      `json:"hideToolbar" api:"optional,nullable"`
	HideStatusBar            bool                      `json:"hideStatusBar" api:"optional,nullable"`
	StatusBar                *SettingStatusBar         `json:"statusBar" api:"optional,nullable"`
	Notifications            *SettingNotifications     `json:"notifications" api:"optional,nullable"`
	EntryVisibility          *SettingEntryVisibility   `json:"entryVisibility" api:"optional,nullable"`
}

// SettingPDFTheme 明亮界面默认 light，暗黑界面默认 dark；主题值只接受 light、dark。
// 标注颜色为空时使用 var(--b3-pdf-background1)，允许保存用户选择的 CSS 颜色。
type SettingPDFTheme struct {
	Light     string `json:"light" api:"optional,nullable"`
	Dark      string `json:"dark" api:"optional,nullable"`
	AnnoColor string `json:"annoColor" api:"optional,nullable"`
}

// SettingMobileBars 三项默认开启，侧栏滑动与按钮不能同时关闭。
type SettingMobileBars struct {
	AutoHide       *bool `json:"autoHide" api:"optional,nullable"`
	SidebarSwipe   *bool `json:"sidebarSwipe" api:"optional,nullable"`
	SidebarButtons *bool `json:"sidebarButtons" api:"optional,nullable"`
}

type SettingBodyGradient struct {
	Mode  string                   `json:"mode" api:"optional,nullable"`
	Light SettingBodyGradientColor `json:"light" api:"optional,nullable"`
	Dark  SettingBodyGradientColor `json:"dark" api:"optional,nullable"`
}

type SettingBodyGradientColor struct {
	Color   string  `json:"color" api:"optional,nullable"`
	Opacity float64 `json:"opacity" api:"optional,nullable"`
}

type SettingAppearanceTheme struct {
	Name      string   `json:"name" api:"optional,nullable"`
	Label     string   `json:"label" api:"optional,nullable"`
	Frontends []string `json:"frontends,omitempty" api:"optional,nullable"`
}

type SettingAppearanceIcon struct {
	Name  string `json:"name" api:"optional,nullable"`
	Label string `json:"label" api:"optional,nullable"`
}

type SettingStatusBar struct {
	Version                                   int  `json:"version" api:"optional,nullable"`
	MsgTaskDatabaseIndexCommitDisabled        bool `json:"msgTaskDatabaseIndexCommitDisabled" api:"optional,nullable"`
	MsgTaskHistoryDatabaseIndexCommitDisabled bool `json:"msgTaskHistoryDatabaseIndexCommitDisabled" api:"optional,nullable"`
	MsgTaskAssetDatabaseIndexCommitDisabled   bool `json:"msgTaskAssetDatabaseIndexCommitDisabled" api:"optional,nullable"`
	MsgTaskHistoryGenerateFileDisabled        bool `json:"msgTaskHistoryGenerateFileDisabled" api:"optional,nullable"`
	MsgDataSyncDisabled                       bool `json:"msgDataSyncDisabled" api:"optional,nullable"`
}

type SettingNotifications struct {
	DocTreeMaxList         bool  `json:"docTreeMaxList" api:"optional,nullable"`
	TagMaxList             bool  `json:"tagMaxList" api:"optional,nullable"`
	WorkspaceNotSSD        bool  `json:"workspaceNotSSD" api:"optional,nullable"`
	BrowserCompatibility   bool  `json:"browserCompatibility" api:"optional,nullable"`
	SelectAllTip           *bool `json:"selectAllTip,omitempty" api:"optional,nullable"`
	SelectAllIncompleteTip *bool `json:"selectAllIncompleteTip,omitempty" api:"optional,nullable"`
	FormatPainterTip       *bool `json:"formatPainterTip,omitempty" api:"optional,nullable"`
}

type SettingEntryVisibility struct {
	Version  int                              `json:"version" api:"optional,nullable"`
	Active   string                           `json:"active" api:"optional,nullable"`
	Profiles []*SettingEntryVisibilityProfile `json:"profiles" api:"optional,nullable"`
}

type SettingEntryVisibilityProfile struct {
	ID       string              `json:"id" api:"optional,nullable"`
	Name     string              `json:"name" api:"optional,nullable"`
	Defaults string              `json:"defaults,omitempty" api:"optional,nullable,enum=simple|full"`
	Entries  map[string]bool     `json:"entries" api:"optional,nullable"`
	Orders   map[string][]string `json:"orders" api:"optional,nullable"`
}

type SettingPublish struct {
	Enable bool              `json:"enable" api:"optional,nullable"`
	Port   uint16            `json:"port" api:"optional,nullable"`
	Auth   *SettingBasicAuth `json:"auth" api:"optional,nullable"`
}

type SettingBasicAuth struct {
	Enable   bool                       `json:"enable" api:"optional,nullable"`
	Accounts []*SettingBasicAuthAccount `json:"accounts" api:"optional,nullable"`
}

type SettingBasicAuthAccount struct {
	Username string `json:"username" api:"optional,nullable"`
	Password string `json:"password" api:"optional,nullable"`
	Memo     string `json:"memo" api:"optional,nullable"`
}

type SettingUser struct {
	UserId                          string              `json:"userId" api:"optional,nullable"`
	UserName                        string              `json:"userName" api:"optional,nullable"`
	UserAvatarURL                   string              `json:"userAvatarURL" api:"optional,nullable"`
	UserHomeBImgURL                 string              `json:"userHomeBImgURL" api:"optional,nullable"`
	UserTitles                      []*SettingUserTitle `json:"userTitles" api:"optional,nullable"`
	UserIntro                       string              `json:"userIntro" api:"optional,nullable"`
	UserNickname                    string              `json:"userNickname" api:"optional,nullable"`
	UserCreateTime                  string              `json:"userCreateTime" api:"optional,nullable"`
	UserSiYuanProExpireTime         float64             `json:"userSiYuanProExpireTime" api:"optional,nullable"`
	UserToken                       string              `json:"userToken" api:"optional,nullable"`
	UserTokenExpireTime             string              `json:"userTokenExpireTime" api:"optional,nullable"`
	UserSiYuanRepoSize              float64             `json:"userSiYuanRepoSize" api:"optional,nullable"`
	UserSiYuanPointExchangeRepoSize float64             `json:"userSiYuanPointExchangeRepoSize" api:"optional,nullable"`
	UserSiYuanAssetSize             float64             `json:"userSiYuanAssetSize" api:"optional,nullable"`
	UserTrafficUpload               float64             `json:"userTrafficUpload" api:"optional,nullable"`
	UserTrafficDownload             float64             `json:"userTrafficDownload" api:"optional,nullable"`
	UserTrafficAPIGet               float64             `json:"userTrafficAPIGet" api:"optional,nullable"`
	UserTrafficAPIPut               float64             `json:"userTrafficAPIPut" api:"optional,nullable"`
	UserTrafficTime                 float64             `json:"userTrafficTime" api:"optional,nullable"`
	UserSiYuanSubscriptionPlan      float64             `json:"userSiYuanSubscriptionPlan" api:"optional,nullable"`
	UserSiYuanSubscriptionStatus    float64             `json:"userSiYuanSubscriptionStatus" api:"optional,nullable"`
	UserSiYuanSubscriptionType      float64             `json:"userSiYuanSubscriptionType" api:"optional,nullable"`
	UserSiYuanOneTimePayStatus      float64             `json:"userSiYuanOneTimePayStatus" api:"optional,nullable"`
}

type SettingUserTitle struct {
	Name string `json:"name" api:"optional,nullable"`
	Desc string `json:"desc" api:"optional,nullable"`
	Icon string `json:"icon" api:"optional,nullable"`
}

type SettingBootAppearance struct {
	Enabled         bool                             `json:"enabled" api:"optional,nullable"`
	Provider        string                           `json:"provider,omitempty" api:"optional,nullable"`
	Appearance      string                           `json:"appearance,omitempty" api:"optional,nullable"`
	DisplayName     string                           `json:"displayName,omitempty" api:"optional,nullable"`
	Frontends       []string                         `json:"frontends,omitempty" api:"optional,nullable"`
	BackgroundColor string                           `json:"backgroundColor,omitempty" api:"optional,nullable"`
	Style           string                           `json:"style,omitempty" api:"optional,nullable"`
	Layers          []*SettingBootAppearanceLayer    `json:"layers,omitempty" api:"optional,nullable"`
	OfficialUI      *SettingBootAppearanceOfficialUI `json:"officialUI,omitempty" api:"optional,nullable"`
}

type SettingBootAppearanceLayer struct {
	ID       string `json:"id" api:"optional,nullable"`
	Type     string `json:"type" api:"optional,nullable"`
	Src      string `json:"src" api:"optional,nullable"`
	Poster   string `json:"poster,omitempty" api:"optional,nullable"`
	Fit      string `json:"fit,omitempty" api:"optional,nullable"`
	Position string `json:"position,omitempty" api:"optional,nullable"`
}

type SettingBootAppearanceOfficialUI struct {
	ShowLogo      bool   `json:"showLogo" api:"optional,nullable"`
	ShowDetails   bool   `json:"showDetails" api:"optional,nullable"`
	TextColor     string `json:"textColor,omitempty" api:"optional,nullable"`
	ProgressColor string `json:"progressColor,omitempty" api:"optional,nullable"`
	TrackColor    string `json:"trackColor,omitempty" api:"optional,nullable"`
}

type SettingBootAppearanceSelection struct {
	SchemaVersion int    `json:"schemaVersion" api:"optional,nullable"`
	Provider      string `json:"provider" api:"optional,nullable"`
	Appearance    string `json:"appearance" api:"optional,nullable"`
}
