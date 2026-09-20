package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func settingSnptPayload(value *conf.Snpt) *apicontract.SettingSnpt {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingSnpt{}
	result.EnabledCSS = value.EnabledCSS
	result.EnabledJS = value.EnabledJS
	return result
}

func settingBazaarPayload(value *conf.Bazaar) *apicontract.SettingBazaar {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBazaar{}
	result.Trust = value.Trust
	result.PetalDisabled = value.PetalDisabled
	return result
}

func settingAIPayload(value *conf.AI) *apicontract.SettingAI {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAI{}
	result.MCP = settingMCPPayload(value.MCP)
	result.Embedding = settingEmbeddingPayload(value.Embedding)
	result.Rerank = settingRerankPayload(value.Rerank)
	result.Decision = settingDecisionPayload(value.Decision)
	result.Agent = settingAgentPayload(value.Agent)
	result.Editing = settingEditingPayload(value.Editing)
	result.ImageGeneration = settingImageGenerationPayload(value.ImageGeneration)
	if value.Providers != nil {
		result.Providers = make([]*apicontract.SettingProvider, len(value.Providers))
		for i, item := range value.Providers {
			result.Providers[i] = settingProviderPayload(item)
		}
	}
	return result
}

func settingMCPPayload(value *conf.MCP) *apicontract.SettingMCP {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingMCP{}
	if value.Servers != nil {
		result.Servers = make([]apicontract.SettingMCPServer, len(value.Servers))
		for i, item := range value.Servers {
			result.Servers[i] = *settingMCPServerPayload(&item)
		}
	}
	result.ExposurePolicy = settingCapabilityPolicyPayload(value.ExposurePolicy)
	return result
}

func settingMCPServerPayload(value *conf.MCPServer) *apicontract.SettingMCPServer {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingMCPServer{}
	result.ID = value.ID
	result.Name = value.Name
	result.Enabled = value.Enabled
	result.Type = value.Type
	result.Command = value.Command
	result.Args = value.Args
	result.InheritEnv = value.InheritEnv
	result.Env = value.Env
	result.URL = value.URL
	result.Headers = value.Headers
	result.Timeout = value.Timeout
	result.DisableStandaloneSSE = value.DisableStandaloneSSE
	result.TrustToolAnnotations = value.TrustToolAnnotations
	return result
}

func settingCapabilityPolicyPayload(value *conf.CapabilityPolicy) *apicontract.SettingCapabilityPolicy {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingCapabilityPolicy{}
	result.Default = value.Default
	result.Overrides = value.Overrides
	return result
}

func settingEmbeddingPayload(value *conf.Embedding) *apicontract.SettingEmbedding {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEmbedding{}
	result.ID = value.ID
	result.Enabled = value.Enabled
	result.APIKey = value.APIKey
	result.BaseURL = value.BaseURL
	result.Name = value.Name
	result.Timeout = value.Timeout
	result.Dimensions = value.Dimensions
	return result
}

func settingRerankPayload(value *conf.Rerank) *apicontract.SettingRerank {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingRerank{}
	result.ID = value.ID
	result.Enabled = value.Enabled
	result.APIKey = value.APIKey
	result.Endpoint = value.Endpoint
	result.Name = value.Name
	result.RequestFormat = string(value.RequestFormat)
	result.Timeout = value.Timeout
	result.CandidateCount = value.CandidateCount
	return result
}

func settingDecisionPayload(value *conf.Decision) *apicontract.SettingDecision {
	if value == nil {
		return nil
	}
	return &apicontract.SettingDecision{Enabled: value.Enabled, Endpoint: value.Endpoint,
		APIKey: value.APIKey, Name: value.Name, Timeout: value.Timeout}
}

func settingAgentPayload(value *conf.Agent) *apicontract.SettingAgent {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAgent{}
	result.ModelID = value.ModelID
	result.SessionTimeout = value.SessionTimeout
	result.StreamIdleTimeout = value.StreamIdleTimeout
	result.ConfirmTimeout = value.ConfirmTimeout
	result.MaxRetries = value.MaxRetries
	result.Temperature = value.Temperature
	result.MaxCompletionTokens = value.MaxCompletionTokens
	result.MaxToolCallRounds = value.MaxToolCallRounds
	result.CapabilityPolicy = settingCapabilityPolicyPayload(value.CapabilityPolicy)
	result.ApprovalPolicy = settingApprovalPolicyPayload(value.ApprovalPolicy)
	result.Skills = settingAgentSkillsPayload(value.Skills)
	return result
}

func settingApprovalPolicyPayload(value *conf.ApprovalPolicy) *apicontract.SettingApprovalPolicy {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingApprovalPolicy{}
	result.Default = value.Default
	if value.Overrides != nil {
		result.Overrides = make(map[string]*apicontract.SettingCapabilityApproval, len(value.Overrides))
		for key, item := range value.Overrides {
			result.Overrides[key] = settingCapabilityApprovalPayload(item)
		}
	}
	return result
}

func settingCapabilityApprovalPayload(value *conf.CapabilityApproval) *apicontract.SettingCapabilityApproval {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingCapabilityApproval{}
	result.Default = value.Default
	result.Actions = value.Actions
	return result
}

func settingAgentSkillsPayload(value *conf.AgentSkills) *apicontract.SettingAgentSkills {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAgentSkills{}
	result.UserEnabled = value.UserEnabled
	return result
}

func settingEditingPayload(value *conf.Editing) *apicontract.SettingEditing {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEditing{}
	result.ModelID = value.ModelID
	result.MaxHistoryMessages = value.MaxHistoryMessages
	result.Temperature = value.Temperature
	result.MaxCompletionTokens = value.MaxCompletionTokens
	return result
}

func settingImageGenerationPayload(value *conf.ImageGeneration) *apicontract.SettingImageGeneration {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingImageGeneration{}
	result.ModelID = value.ModelID
	result.RequestTimeout = value.RequestTimeout
	result.Size = value.Size
	result.Quality = value.Quality
	result.OutputFormat = value.OutputFormat
	return result
}

func settingProviderPayload(value *conf.Provider) *apicontract.SettingProvider {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingProvider{}
	result.Headers = value.Headers
	result.ID = value.ID
	result.DisplayName = value.DisplayName
	result.Enabled = value.Enabled
	result.APIKey = value.APIKey
	result.BaseURL = value.BaseURL
	result.Protocol = value.Protocol
	result.RequestTimeout = value.RequestTimeout
	if value.Models != nil {
		result.Models = make([]*apicontract.SettingModel, len(value.Models))
		for i, item := range value.Models {
			result.Models[i] = settingModelPayload(item)
		}
	}
	return result
}

func settingModelPayload(value *conf.Model) *apicontract.SettingModel {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingModel{}
	result.ID = value.ID
	result.DisplayName = value.DisplayName
	result.Enabled = value.Enabled
	result.Name = value.Name
	result.ContextLength = value.ContextLength
	return result
}

func settingSecretsPayload(value *conf.Secrets) *apicontract.SettingSecrets {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingSecrets{}
	if value.Items != nil {
		result.Items = make([]*apicontract.SettingSecret, len(value.Items))
		for i, item := range value.Items {
			result.Items[i] = settingSecretPayload(item)
		}
	}
	return result
}

func settingSecretPayload(value *conf.Secret) *apicontract.SettingSecret {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingSecret{}
	result.Name = value.Name
	result.Value = value.Value
	result.AllowedHosts = value.AllowedHosts
	return result
}

func settingVariablesPayload(value *conf.Variables) *apicontract.SettingVariables {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingVariables{}
	if value.Items != nil {
		result.Items = make([]*apicontract.SettingVariable, len(value.Items))
		for i, item := range value.Items {
			result.Items[i] = settingVariablePayload(item)
		}
	}
	return result
}

func settingVariablePayload(value *conf.Variable) *apicontract.SettingVariable {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingVariable{}
	result.Name = value.Name
	result.Value = value.Value
	return result
}

func settingFlashcardPayload(value *conf.Flashcard) *apicontract.SettingFlashcard {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingFlashcard{}
	result.NewCardLimit = value.NewCardLimit
	result.ReviewCardLimit = value.ReviewCardLimit
	result.Mark = value.Mark
	result.List = value.List
	result.Blockquote = value.Blockquote
	result.Callout = value.Callout
	result.SuperBlock = value.SuperBlock
	result.Heading = value.Heading
	result.Deck = value.Deck
	result.ReviewMode = value.ReviewMode
	result.RequestRetention = value.RequestRetention
	result.MaximumInterval = value.MaximumInterval
	result.Weights = value.Weights
	return result
}

func settingEditorPayload(value *conf.Editor) *apicontract.SettingEditor {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEditor{}
	result.AllowSVGScript = value.AllowSVGScript
	result.AllowHTMLBLockScript = value.AllowHTMLBLockScript
	result.CursorSurroundingLines = value.CursorSurroundingLines
	result.FontSize = value.FontSize
	result.FontSizeScrollZoom = value.FontSizeScrollZoom
	result.FontFamily = value.FontFamily
	result.FontWeight = value.FontWeight
	result.FontFamilyDisplay = value.FontFamilyDisplay
	if value.FontFamilies != nil {
		result.FontFamilies = make([]*apicontract.SettingEditorFont, len(value.FontFamilies))
		for i, item := range value.FontFamilies {
			result.FontFamilies[i] = settingEditorFontPayload(item)
		}
	}
	if value.CodeFontFamilies != nil {
		result.CodeFontFamilies = make([]*apicontract.SettingEditorFont, len(value.CodeFontFamilies))
		for i, item := range value.CodeFontFamilies {
			result.CodeFontFamilies[i] = settingEditorFontPayload(item)
		}
	}
	result.CodeSyntaxHighlightLineNum = value.CodeSyntaxHighlightLineNum
	result.CodeTabSpaces = value.CodeTabSpaces
	result.CodeLineWrap = value.CodeLineWrap
	result.CodeLigatures = value.CodeLigatures
	result.DisplayBookmarkIcon = value.DisplayBookmarkIcon
	result.DisplayNetImgMark = value.DisplayNetImgMark
	result.DatabaseAttrShow = value.DatabaseAttrShow
	result.DatabaseAttrClickMode = value.DatabaseAttrClickMode
	result.DatabaseAttrViewMode = value.DatabaseAttrViewMode
	result.DatabaseAttrHideEmpty = value.DatabaseAttrHideEmpty
	result.DatabaseAttrUseTabs = value.DatabaseAttrUseTabs
	result.GenerateHistoryInterval = value.GenerateHistoryInterval
	result.HistoryRetentionDays = value.HistoryRetentionDays
	result.Emoji = value.Emoji
	result.VirtualBlockRef = value.VirtualBlockRef
	result.VirtualBlockRefExclude = value.VirtualBlockRefExclude
	result.VirtualBlockRefInclude = value.VirtualBlockRefInclude
	result.CheckBlockRef = value.CheckBlockRef
	result.BlockRefDynamicAnchorTextMaxLen = value.BlockRefDynamicAnchorTextMaxLen
	result.AssetOpen = settingAssetOpenPayload(value.AssetOpen)
	result.PlantUMLServePath = value.PlantUMLServePath
	result.FullWidth = value.FullWidth
	result.KaTexMacros = value.KaTexMacros
	result.ReadOnly = value.ReadOnly
	result.EmbedBlockBreadcrumb = value.EmbedBlockBreadcrumb
	result.ListLogicalOutdent = value.ListLogicalOutdent
	result.ListItemDotNumberClickFocus = value.ListItemDotNumberClickFocus
	result.FloatWindowMode = value.FloatWindowMode
	result.FloatWindowDelay = value.FloatWindowDelay
	result.KeepLoadedContent = value.KeepLoadedContent
	result.DynamicLoadBlocks = value.DynamicLoadBlocks
	result.Justify = value.Justify
	result.RTL = value.RTL
	result.Spellcheck = value.Spellcheck
	result.SpellcheckLanguages = value.SpellcheckLanguages
	result.HashTagSearch = value.HashTagSearch
	result.OnlySearchForDoc = value.OnlySearchForDoc
	result.BacklinkExpandCount = value.BacklinkExpandCount
	result.BackmentionExpandCount = value.BackmentionExpandCount
	result.BacklinkMentionExclude = value.BacklinkMentionExclude
	result.BacklinkContainChildren = value.BacklinkContainChildren
	result.BacklinkHideReference = value.BacklinkHideReference
	result.BacklinkShowBottom = value.BacklinkShowBottom
	result.BacklinkSort = value.BacklinkSort
	result.BacklinkGlobalSort = value.BacklinkGlobalSort
	result.BacklinkBlockSort = value.BacklinkBlockSort
	result.BackmentionSort = value.BackmentionSort
	result.HeadingNumber = value.HeadingNumber
	result.HeadingNumberFormat = value.HeadingNumberFormat
	result.HeadingEmbedMode = value.HeadingEmbedMode
	result.PasteURLAutoConvert = value.PasteURLAutoConvert
	result.DragHTMLFileToIframe = value.DragHTMLFileToIframe
	result.Markdown = settingMarkdownPayload(value.Markdown)
	return result
}

func settingEditorFontPayload(value *conf.EditorFont) *apicontract.SettingEditorFont {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEditorFont{}
	result.Family = value.Family
	result.Weight = value.Weight
	result.DisplayName = value.DisplayName
	return result
}

func settingAssetOpenPayload(value *conf.AssetOpen) *apicontract.SettingAssetOpen {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAssetOpen{}
	result.Click = value.Click
	result.CtrlClick = value.CtrlClick
	result.AltClick = value.AltClick
	result.ShiftClick = value.ShiftClick
	return result
}

func settingMarkdownPayload(value *util.Markdown) *apicontract.SettingMarkdown {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingMarkdown{}
	result.InlineAsterisk = value.InlineAsterisk
	result.InlineUnderscore = value.InlineUnderscore
	result.InlineSup = value.InlineSup
	result.InlineSub = value.InlineSub
	result.InlineTag = value.InlineTag
	result.InlineMath = value.InlineMath
	result.InlineStrikethrough = value.InlineStrikethrough
	result.InlineFullWidthStrikethrough = value.InlineFullWidthStrikethrough
	result.BlockFullWidthTaskList = value.BlockFullWidthTaskList
	result.InlineMark = value.InlineMark
	result.CodeBlockMiddleDot = value.CodeBlockMiddleDot
	return result
}

func settingExportPayload(value *conf.Export) *apicontract.SettingExport {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingExport{}
	result.ParagraphBeginningSpace = value.ParagraphBeginningSpace
	result.AddTitle = value.AddTitle
	result.BlockRefMode = value.BlockRefMode
	result.BlockEmbedMode = value.BlockEmbedMode
	result.BlockRefTextLeft = value.BlockRefTextLeft
	result.BlockRefTextRight = value.BlockRefTextRight
	result.TagOpenMarker = value.TagOpenMarker
	result.TagCloseMarker = value.TagCloseMarker
	result.FileAnnotationRefMode = value.FileAnnotationRefMode
	result.PandocBin = value.PandocBin
	result.PandocParams = value.PandocParams
	result.DocxTemplate = value.DocxTemplate
	result.RemoveAssetsID = value.RemoveAssetsID
	result.MarkdownYFM = value.MarkdownYFM
	result.InlineMemo = value.InlineMemo
	result.IncludeSubDocs = value.IncludeSubDocs
	result.IncludeRelatedDocs = value.IncludeRelatedDocs
	result.PDFFooter = value.PDFFooter
	result.PDFWatermarkStr = value.PDFWatermarkStr
	result.PDFWatermarkDesc = value.PDFWatermarkDesc
	result.ImageWatermarkStr = value.ImageWatermarkStr
	result.ImageWatermarkDesc = value.ImageWatermarkDesc
	return result
}

func settingFileTreePayload(value *conf.FileTree) *apicontract.SettingFileTree {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingFileTree{}
	result.AlwaysSelectOpenedFile = value.AlwaysSelectOpenedFile
	result.OpenFilesUseCurrentTab = value.OpenFilesUseCurrentTab
	result.CloseTabOnDoubleClick = value.CloseTabOnDoubleClick
	result.DocIconClickExpand = value.DocIconClickExpand
	result.ParentDocClickExpand = value.ParentDocClickExpand
	result.BoxDocEnabled = value.BoxDocEnabled
	result.UseSVGDefaultIcon = value.UseSVGDefaultIcon
	result.RefCreateSaveBox = value.RefCreateSaveBox
	result.RefCreateSavePath = value.RefCreateSavePath
	result.DocCreateSaveBox = value.DocCreateSaveBox
	result.DocCreateSavePath = value.DocCreateSavePath
	result.DocCreateTemplatePath = value.DocCreateTemplatePath
	result.ShorthandSaveBox = value.ShorthandSaveBox
	result.ShorthandSavePath = value.ShorthandSavePath
	result.MaxListCount = value.MaxListCount
	result.MaxOpenTabCount = value.MaxOpenTabCount
	result.AllowCreateDeeper = value.AllowCreateDeeper
	result.RemoveDocWithoutConfirm = value.RemoveDocWithoutConfirm
	result.CloseTabsOnStart = value.CloseTabsOnStart
	result.TabStartupMode = value.TabStartupMode
	result.UseSingleLineSave = value.UseSingleLineSave
	result.LargeFileWarningSize = value.LargeFileWarningSize
	result.CreateDocAtTop = value.CreateDocAtTop
	result.Sort = value.Sort
	result.RecentDocsMaxListCount = value.RecentDocsMaxListCount
	result.NoSplitScreenWhenOpenTab = value.NoSplitScreenWhenOpenTab
	return result
}

func settingSearchPayload(value *conf.Search) *apicontract.SettingSearch {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingSearch{}
	result.Document = value.Document
	result.Heading = value.Heading
	result.List = value.List
	result.ListItem = value.ListItem
	result.CodeBlock = value.CodeBlock
	result.MathBlock = value.MathBlock
	result.Table = value.Table
	result.Blockquote = value.Blockquote
	result.SuperBlock = value.SuperBlock
	result.Paragraph = value.Paragraph
	result.HTMLBlock = value.HTMLBlock
	result.EmbedBlock = value.EmbedBlock
	result.DatabaseBlock = value.DatabaseBlock
	result.AudioBlock = value.AudioBlock
	result.VideoBlock = value.VideoBlock
	result.IFrameBlock = value.IFrameBlock
	result.WidgetBlock = value.WidgetBlock
	result.Callout = value.Callout
	result.Tabs = value.Tabs
	result.TabItem = value.TabItem
	result.CustomBlock = value.CustomBlock
	result.Limit = value.Limit
	result.CaseSensitive = value.CaseSensitive
	result.HanSensitive = value.HanSensitive
	result.Name = value.Name
	result.Alias = value.Alias
	result.Memo = value.Memo
	result.IAL = value.IAL
	result.IndexAssetPath = value.IndexAssetPath
	result.BacklinkMentionName = value.BacklinkMentionName
	result.BacklinkMentionAlias = value.BacklinkMentionAlias
	result.BacklinkMentionAnchor = value.BacklinkMentionAnchor
	result.BacklinkMentionDoc = value.BacklinkMentionDoc
	result.BacklinkMentionKeywordsLimit = value.BacklinkMentionKeywordsLimit
	result.VirtualRefName = value.VirtualRefName
	result.VirtualRefAlias = value.VirtualRefAlias
	result.VirtualRefAnchor = value.VirtualRefAnchor
	result.VirtualRefDoc = value.VirtualRefDoc
	return result
}

func settingAppearancePayload(value *conf.Appearance) *apicontract.SettingAppearance {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAppearance{}
	result.BodyGradient = settingBodyGradientPayload(value.BodyGradient)
	if value.GlobalFontFamilies != nil {
		result.GlobalFontFamilies = make([]*apicontract.SettingEditorFont, len(value.GlobalFontFamilies))
		for i, item := range value.GlobalFontFamilies {
			result.GlobalFontFamilies[i] = settingEditorFontPayload(item)
		}
	}
	result.Mode = value.Mode
	result.ModeOS = value.ModeOS
	if value.DarkThemes != nil {
		result.DarkThemes = make([]*apicontract.SettingAppearanceTheme, len(value.DarkThemes))
		for i, item := range value.DarkThemes {
			result.DarkThemes[i] = settingAppearanceThemePayload(item)
		}
	}
	if value.LightThemes != nil {
		result.LightThemes = make([]*apicontract.SettingAppearanceTheme, len(value.LightThemes))
		for i, item := range value.LightThemes {
			result.LightThemes[i] = settingAppearanceThemePayload(item)
		}
	}
	result.ThemeDark = value.ThemeDark
	result.ThemeLight = value.ThemeLight
	result.ThemeVer = value.ThemeVer
	if value.Icons != nil {
		result.Icons = make([]*apicontract.SettingAppearanceIcon, len(value.Icons))
		for i, item := range value.Icons {
			result.Icons[i] = settingAppearanceIconPayload(item)
		}
	}
	result.Icon = value.Icon
	result.IconVer = value.IconVer
	result.CodeBlockThemeLight = value.CodeBlockThemeLight
	result.CodeBlockThemeDark = value.CodeBlockThemeDark
	result.Lang = value.Lang
	result.ThemeJS = value.ThemeJS
	result.CloseButtonBehavior = value.CloseButtonBehavior
	result.HideToolbar = value.HideToolbar
	result.HideStatusBar = value.HideStatusBar
	result.StatusBar = settingStatusBarPayload(value.StatusBar)
	result.Notifications = settingNotificationsPayload(value.Notifications)
	result.EntryVisibility = settingEntryVisibilityPayload(value.EntryVisibility)
	return result
}

func settingBodyGradientPayload(value *conf.BodyGradient) *apicontract.SettingBodyGradient {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBodyGradient{}
	result.Mode = value.Mode
	result.Light = *settingBodyGradientColorPayload(&value.Light)
	result.Dark = *settingBodyGradientColorPayload(&value.Dark)
	return result
}

func settingBodyGradientColorPayload(value *conf.BodyGradientColor) *apicontract.SettingBodyGradientColor {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBodyGradientColor{}
	result.Color = value.Color
	result.Opacity = value.Opacity
	return result
}

func settingAppearanceThemePayload(value *conf.AppearanceTheme) *apicontract.SettingAppearanceTheme {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAppearanceTheme{}
	result.Name = value.Name
	result.Label = value.Label
	result.Frontends = value.Frontends
	return result
}

func settingAppearanceIconPayload(value *conf.AppearanceIcon) *apicontract.SettingAppearanceIcon {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingAppearanceIcon{}
	result.Name = value.Name
	result.Label = value.Label
	return result
}

func settingStatusBarPayload(value *util.StatusBar) *apicontract.SettingStatusBar {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingStatusBar{}
	result.Version = value.Version
	result.MsgTaskDatabaseIndexCommitDisabled = value.MsgTaskDatabaseIndexCommitDisabled
	result.MsgTaskHistoryDatabaseIndexCommitDisabled = value.MsgTaskHistoryDatabaseIndexCommitDisabled
	result.MsgTaskAssetDatabaseIndexCommitDisabled = value.MsgTaskAssetDatabaseIndexCommitDisabled
	result.MsgTaskHistoryGenerateFileDisabled = value.MsgTaskHistoryGenerateFileDisabled
	result.MsgDataSyncDisabled = value.MsgDataSyncDisabled
	return result
}

func settingNotificationsPayload(value *util.Notifications) *apicontract.SettingNotifications {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingNotifications{}
	result.DocTreeMaxList = value.DocTreeMaxList
	result.TagMaxList = value.TagMaxList
	result.WorkspaceNotSSD = value.WorkspaceNotSSD
	result.BrowserCompatibility = value.BrowserCompatibility
	result.SelectAllTip = value.SelectAllTip
	result.SelectAllIncompleteTip = value.SelectAllIncompleteTip
	result.FormatPainterTip = value.FormatPainterTip
	return result
}

func settingEntryVisibilityPayload(value *conf.EntryVisibility) *apicontract.SettingEntryVisibility {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEntryVisibility{}
	result.Version = value.Version
	result.Active = value.Active
	if value.Profiles != nil {
		result.Profiles = make([]*apicontract.SettingEntryVisibilityProfile, len(value.Profiles))
		for i, item := range value.Profiles {
			result.Profiles[i] = settingEntryVisibilityProfilePayload(item)
		}
	}
	return result
}

func settingEntryVisibilityProfilePayload(value *conf.EntryVisibilityProfile) *apicontract.SettingEntryVisibilityProfile {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingEntryVisibilityProfile{}
	result.ID = value.ID
	result.Name = value.Name
	result.Entries = value.Entries
	result.Orders = value.Orders
	return result
}

func settingPublishPayload(value *conf.Publish) *apicontract.SettingPublish {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingPublish{}
	result.Enable = value.Enable
	result.Port = value.Port
	result.Auth = settingBasicAuthPayload(value.Auth)
	return result
}

func settingBasicAuthPayload(value *conf.BasicAuth) *apicontract.SettingBasicAuth {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBasicAuth{}
	result.Enable = value.Enable
	if value.Accounts != nil {
		result.Accounts = make([]*apicontract.SettingBasicAuthAccount, len(value.Accounts))
		for i, item := range value.Accounts {
			result.Accounts[i] = settingBasicAuthAccountPayload(item)
		}
	}
	return result
}

func settingBasicAuthAccountPayload(value *conf.BasicAuthAccount) *apicontract.SettingBasicAuthAccount {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBasicAuthAccount{}
	result.Username = value.Username
	result.Password = value.Password
	result.Memo = value.Memo
	return result
}

func settingUserPayload(value *conf.User) *apicontract.SettingUser {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingUser{}
	result.UserId = value.UserId
	result.UserName = value.UserName
	result.UserAvatarURL = value.UserAvatarURL
	result.UserHomeBImgURL = value.UserHomeBImgURL
	if value.UserTitles != nil {
		result.UserTitles = make([]*apicontract.SettingUserTitle, len(value.UserTitles))
		for i, item := range value.UserTitles {
			result.UserTitles[i] = settingUserTitlePayload(item)
		}
	}
	result.UserIntro = value.UserIntro
	result.UserNickname = value.UserNickname
	result.UserCreateTime = value.UserCreateTime
	result.UserSiYuanProExpireTime = value.UserSiYuanProExpireTime
	result.UserToken = value.UserToken
	result.UserTokenExpireTime = value.UserTokenExpireTime
	result.UserSiYuanRepoSize = value.UserSiYuanRepoSize
	result.UserSiYuanPointExchangeRepoSize = value.UserSiYuanPointExchangeRepoSize
	result.UserSiYuanAssetSize = value.UserSiYuanAssetSize
	result.UserTrafficUpload = value.UserTrafficUpload
	result.UserTrafficDownload = value.UserTrafficDownload
	result.UserTrafficAPIGet = value.UserTrafficAPIGet
	result.UserTrafficAPIPut = value.UserTrafficAPIPut
	result.UserTrafficTime = value.UserTrafficTime
	result.UserSiYuanSubscriptionPlan = value.UserSiYuanSubscriptionPlan
	result.UserSiYuanSubscriptionStatus = value.UserSiYuanSubscriptionStatus
	result.UserSiYuanSubscriptionType = value.UserSiYuanSubscriptionType
	result.UserSiYuanOneTimePayStatus = value.UserSiYuanOneTimePayStatus
	return result
}

func settingUserTitlePayload(value *conf.UserTitle) *apicontract.SettingUserTitle {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingUserTitle{}
	result.Name = value.Name
	result.Desc = value.Desc
	result.Icon = value.Icon
	return result
}

func settingBootAppearancePayload(value *model.BootAppearance) *apicontract.SettingBootAppearance {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBootAppearance{}
	result.Enabled = value.Enabled
	result.Provider = value.Provider
	result.Appearance = value.Appearance
	result.DisplayName = value.DisplayName
	result.Frontends = value.Frontends
	result.BackgroundColor = value.BackgroundColor
	result.Style = value.Style
	if value.Layers != nil {
		result.Layers = make([]*apicontract.SettingBootAppearanceLayer, len(value.Layers))
		for i, item := range value.Layers {
			result.Layers[i] = settingBootAppearanceLayerPayload(item)
		}
	}
	result.OfficialUI = settingBootAppearanceOfficialUIPayload(value.OfficialUI)
	return result
}

func settingBootAppearanceLayerPayload(value *model.BootAppearanceLayer) *apicontract.SettingBootAppearanceLayer {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBootAppearanceLayer{}
	result.ID = value.ID
	result.Type = value.Type
	result.Src = value.Src
	result.Poster = value.Poster
	result.Fit = value.Fit
	result.Position = value.Position
	return result
}

func settingBootAppearanceOfficialUIPayload(value *model.BootAppearanceOfficialUI) *apicontract.SettingBootAppearanceOfficialUI {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBootAppearanceOfficialUI{}
	result.ShowLogo = value.ShowLogo
	result.ShowDetails = value.ShowDetails
	result.TextColor = value.TextColor
	result.ProgressColor = value.ProgressColor
	result.TrackColor = value.TrackColor
	return result
}

func settingBootAppearanceSelectionPayload(value *model.BootAppearanceSelection) *apicontract.SettingBootAppearanceSelection {
	if value == nil {
		return nil
	}
	result := &apicontract.SettingBootAppearanceSelection{}
	result.SchemaVersion = value.SchemaVersion
	result.Provider = value.Provider
	result.Appearance = value.Appearance
	return result
}
