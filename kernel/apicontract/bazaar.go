package apicontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"reflect"
	"strings"
)

type InstallLocalBazaarPackageRequest struct {
	File      *multipart.FileHeader `json:"file" api:"optional"`
	Frontend  string                `json:"frontend" api:"optional"`
	Overwrite string                `json:"overwrite" api:"optional"`
}
type BatchUpdatePackageRequest struct {
	Frontend string `json:"frontend" api:"trim"`
}
type GetUpdatedPackageRequest struct {
	Frontend string `json:"frontend" api:"trim"`
}
type UpdateBazaarPackageRequest struct {
	PackageType string `json:"packageType" api:"trim"`
	PackageName string `json:"packageName" api:"trim"`
	Frontend    string `json:"frontend" api:"trim"`
	Keyword     string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledPackageSizeRequest struct {
	PackageType string `json:"packageType" api:"trim"`
	PackageName string `json:"packageName" api:"trim"`
}
type GetBazaarPackageRequest struct {
	PackageType string `json:"packageType" api:"trim"`
	PackageName string `json:"packageName" api:"trim"`
	Frontend    string `json:"frontend" api:"optional,nullable,trim"`
}
type GetBazaarPackageRatingsRequest struct {
	PackageType  string   `json:"packageType" api:"trim"`
	PackageNames []string `json:"packageNames"`
	NamesError   error    `json:"-"`
}
type GetBazaarPackageUserRatingsRequest struct {
	PackageType  string   `json:"packageType" api:"trim"`
	PackageNames []string `json:"packageNames"`
	NamesError   error    `json:"-"`
}
type GetBazaarPackageRatingRequest struct {
	PackageType string `json:"packageType" api:"trim"`
	PackageName string `json:"packageName" api:"trim"`
}
type SetBazaarPackageRatingRequest struct {
	PackageType string  `json:"packageType" api:"trim"`
	PackageName string  `json:"packageName" api:"trim"`
	Rating      float64 `json:"rating"`
}
type GetBazaarPackageREADMERequest struct {
	RepoURL     string `json:"repoURL" api:"trim"`
	RepoHash    string `json:"repoHash" api:"trim"`
	PackageType string `json:"packageType" api:"trim"`
}
type GetBazaarPluginRequest struct {
	Frontend string `json:"frontend" api:"trim"`
	Keyword  string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledPluginRequest struct {
	Frontend string `json:"frontend" api:"trim"`
	Keyword  string `json:"keyword" api:"optional,nullable"`
}
type InstallBazaarPluginRequest struct {
	Frontend    string `json:"frontend" api:"trim"`
	Keyword     string `json:"keyword" api:"optional,nullable"`
	RepoURL     string `json:"repoURL" api:"trim"`
	RepoHash    string `json:"repoHash" api:"trim"`
	RepoRef     string `json:"repoRef" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type UninstallBazaarPluginRequest struct {
	Frontend    string `json:"frontend" api:"optional,nullable"`
	Keyword     string `json:"keyword" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type GetBazaarWidgetRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledWidgetRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type InstallBazaarWidgetRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	RepoURL     string `json:"repoURL" api:"trim"`
	RepoHash    string `json:"repoHash" api:"trim"`
	RepoRef     string `json:"repoRef" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type UninstallBazaarWidgetRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type GetBazaarIconRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledIconRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type InstallBazaarIconRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	RepoURL     string `json:"repoURL" api:"trim"`
	RepoHash    string `json:"repoHash" api:"trim"`
	RepoRef     string `json:"repoRef" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type UninstallBazaarIconRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type GetBazaarTemplateRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledTemplateRequest struct {
	Keyword string `json:"keyword" api:"optional,nullable"`
}
type InstallBazaarTemplateRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	RepoURL     string `json:"repoURL" api:"trim"`
	RepoHash    string `json:"repoHash" api:"trim"`
	RepoRef     string `json:"repoRef" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type UninstallBazaarTemplateRequest struct {
	Keyword     string `json:"keyword" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}
type GetBazaarThemeRequest struct {
	Frontend string `json:"frontend" api:"optional,nullable"`
	Keyword  string `json:"keyword" api:"optional,nullable"`
}
type GetInstalledThemeRequest struct {
	Frontend string `json:"frontend" api:"optional,nullable"`
	Keyword  string `json:"keyword" api:"optional,nullable"`
}
type InstallBazaarThemeRequest struct {
	Frontend    string   `json:"frontend" api:"optional,nullable"`
	Keyword     string   `json:"keyword" api:"optional,nullable"`
	RepoURL     string   `json:"repoURL" api:"trim"`
	RepoHash    string   `json:"repoHash" api:"trim"`
	RepoRef     string   `json:"repoRef" api:"optional,nullable"`
	PackageName string   `json:"packageName" api:"trim"`
	Mode        *float64 `json:"mode" api:"optional,nonnullable"`
	ModeOS      *bool    `json:"modeOS" api:"optional,nonnullable"`
}
type UninstallBazaarThemeRequest struct {
	Frontend    string `json:"frontend" api:"optional,nullable"`
	Keyword     string `json:"keyword" api:"optional,nullable"`
	PackageName string `json:"packageName" api:"trim"`
}

type BazaarPackagesData struct {
	Packages []*BazaarPackage `json:"packages"`
}
type BazaarAppearancePackagesData struct {
	Packages   []*BazaarPackage  `json:"packages"`
	Appearance *BazaarAppearance `json:"appearance"`
}
type BazaarUpdatedData struct {
	Plugins   []*BazaarPackageDetail `json:"plugins"`
	Widgets   []*BazaarPackageDetail `json:"widgets"`
	Icons     []*BazaarPackageDetail `json:"icons"`
	Themes    []*BazaarPackageDetail `json:"themes"`
	Templates []*BazaarPackageDetail `json:"templates"`
}
type BazaarPackageDetail struct {
	Installed *BazaarPackage `json:"installed"`
	Available *BazaarPackage `json:"available"`
}
type BazaarPackageSizeData struct {
	InstallSize  int64  `json:"installSize"`
	HInstallSize string `json:"hInstallSize"`
}
type BazaarREADMEData struct {
	HTML string `json:"html"`
}
type BazaarRatingsData struct {
	Ratings              map[string]*BazaarPackageRating `json:"ratings"`
	EligiblePackageNames []string                        `json:"eligiblePackageNames"`
}
type BazaarUserRatingsData struct {
	UserRatings          map[string]int `json:"userRatings"`
	EligiblePackageNames []string       `json:"eligiblePackageNames"`
}
type BazaarRatingData struct {
	Rating          *BazaarPackageRating `json:"rating,omitempty"`
	RatingAvailable bool                 `json:"ratingAvailable"`
	UserRating      int                  `json:"userRating"`
}
type BazaarRatingError struct {
	ErrorCode string `json:"errorCode" api:"enum=bazaarRatingRateLimited|bazaarPackagePending"`
}
type BazaarLocalInstallData struct {
	PackageType   string `json:"packageType"`
	PackageName   string `json:"packageName"`
	MinAppVersion string `json:"minAppVersion,omitempty"`
	Updated       bool   `json:"updated"`
}
type BazaarLocalInstallError struct {
	Reason        string `json:"reason" api:"enum=install-failed|package-exists|package-incompatible"`
	PackageType   string `json:"packageType"`
	PackageName   string `json:"packageName"`
	MinAppVersion string `json:"minAppVersion"`
}
type BazaarLocaleStrings map[string]string
type BazaarFunding struct {
	OpenCollective string              `json:"openCollective"`
	Patreon        string              `json:"patreon"`
	GitHub         string              `json:"github"`
	Custom         []string            `json:"custom"`
	Links          []BazaarFundingLink `json:"links,omitempty"`
}
type BazaarFundingLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}
type BazaarPackageRating struct {
	Average      float64  `json:"average"`
	Count        int64    `json:"count"`
	Distribution [5]int64 `json:"distribution"`
}
type BazaarPackage struct {
	Author            string              `json:"author"`
	URL               string              `json:"url"`
	Version           string              `json:"version"`
	MinAppVersion     string              `json:"minAppVersion"`
	DisabledInPublish bool                `json:"disabledInPublish"`
	Kernels           []string            `json:"kernels"`
	Backends          []string            `json:"backends"`
	Frontends         []string            `json:"frontends"`
	BootAppearances   []string            `json:"bootAppearances,omitempty"`
	DisplayName       BazaarLocaleStrings `json:"displayName"`
	Description       BazaarLocaleStrings `json:"description"`
	Readme            BazaarLocaleStrings `json:"readme"`
	Icon              *string             `json:"icon,omitempty"`
	Preview           *string             `json:"preview,omitempty"`
	Funding           *BazaarFunding      `json:"funding"`
	Keywords          []string            `json:"keywords"`
	Deprecated        bool                `json:"deprecated,omitempty"`
	DeprecatedReason  BazaarLocaleStrings `json:"deprecatedReason,omitempty"`
	Alternatives      []string            `json:"alternatives,omitempty"`

	PreferredFunding          string `json:"preferredFunding"`
	PreferredName             string `json:"preferredName"`
	PreferredDesc             string `json:"preferredDesc"`
	PreferredReadme           string `json:"preferredReadme"`
	PreferredDeprecatedReason string `json:"preferredDeprecatedReason,omitempty"`

	Name       string `json:"name"`    // 包名，不一定是仓库名
	RepoURL    string `json:"repoURL"` // 形式为 https://github.com/owner/repo
	RepoHash   string `json:"repoHash"`
	RepoRef    string `json:"repoRef,omitempty"`
	PreviewURL string `json:"previewURL"`
	IconURL    string `json:"iconURL"`

	Installed               bool   `json:"installed"`
	HasStorageData          bool   `json:"hasStorageData,omitempty"`
	Outdated                bool   `json:"outdated"`
	Current                 bool   `json:"current"`
	Updated                 string `json:"updated"`
	Stars                   int    `json:"stars"`
	OpenIssues              int    `json:"openIssues"`
	Size                    int64  `json:"size"`
	HSize                   string `json:"hSize"`
	InstallSize             int64  `json:"installSize"`
	HInstallSize            string `json:"hInstallSize"`
	InstallTime             int64  `json:"installTime"`
	UpdateTime              int64  `json:"updateTime"`
	HInstallDate            string `json:"hInstallDate"`
	HUpdated                string `json:"hUpdated"`
	Downloads               int    `json:"downloads"`
	DisallowInstall         bool   `json:"disallowInstall"`
	DisallowUpdate          bool   `json:"disallowUpdate"`
	UpdateRequiredMinAppVer string `json:"updateRequiredMinAppVer,omitempty"`                                                  // 升级目标要求的最小应用版本
	InvalidReason           string `json:"invalidReason,omitempty" api:"enum=missing-manifest|invalid-manifest|name-mismatch"` // 本地安装包异常原因

	RatingAvailable bool                 `json:"ratingAvailable"`  // 在线集市公开评分是否可用
	Rating          *BazaarPackageRating `json:"rating,omitempty"` // 在线集市公开评分

	// 专用字段，nil 时不序列化
	InstalledIncompatible *bool     `json:"installedIncompatible,omitempty"` // 插件/主题：本地已安装版本是否不兼容
	BazaarIncompatible    *bool     `json:"bazaarIncompatible,omitempty"`    // 插件/主题：在线集市版本是否不兼容
	Enabled               *bool     `json:"enabled,omitempty"`               // 插件：是否启用
	UserDisabledInPublish *bool     `json:"userDisabledInPublish,omitempty"` // 插件：是否由用户在发布服务中禁用
	Modes                 *[]string `json:"modes,omitempty"`                 // 主题：支持的模式列表
}
type BazaarAppearance struct {
	BodyGradient        *BazaarBodyGradient      `json:"bodyGradient"`        // 背景渐变，空值表示自动配色
	GlobalFontFamilies  []*BazaarEditorFont      `json:"globalFontFamilies"`  // 按优先级排列的全局默认字体
	Mode                int                      `json:"mode"`                // 模式：0：明亮，1：暗黑
	ModeOS              bool                     `json:"modeOS"`              // 模式是否跟随系统
	DarkThemes          []*BazaarAppearanceTheme `json:"darkThemes"`          // 暗黑模式外观主题列表
	LightThemes         []*BazaarAppearanceTheme `json:"lightThemes"`         // 明亮模式外观主题列表
	ThemeDark           string                   `json:"themeDark"`           // 选择的暗黑模式外观主题
	ThemeLight          string                   `json:"themeLight"`          // 选择的明亮模式外观主题
	ThemeVer            string                   `json:"themeVer"`            // 选择的主题版本
	Icons               []*BazaarAppearanceIcon  `json:"icons"`               // 图标列表
	Icon                string                   `json:"icon"`                // 选择的图标
	IconVer             string                   `json:"iconVer"`             // 选择的图标版本
	CodeBlockThemeLight string                   `json:"codeBlockThemeLight"` // 明亮模式下代码块主题
	CodeBlockThemeDark  string                   `json:"codeBlockThemeDark"`  // 暗黑模式下代码块主题
	Lang                string                   `json:"lang"`                // 选择的界面语言，同 AppConf.Lang
	ThemeJS             bool                     `json:"themeJS"`             // 是否启用了主题 JavaScript
	CloseButtonBehavior int                      `json:"closeButtonBehavior"` // 关闭按钮行为，0：退出，1：最小化到托盘
	HideToolbar         bool                     `json:"hideToolbar"`         // 是否隐藏顶栏工具栏
	HideStatusBar       bool                     `json:"hideStatusBar"`       // 是否隐藏底部状态栏
	StatusBar           *BazaarStatusBar         `json:"statusBar"`           // 底部状态栏配置
	Notifications       *BazaarNotifications     `json:"notifications"`       // 外观通知开关配置
	EntryVisibility     *BazaarEntryVisibility   `json:"entryVisibility"`     // 桌面端入口可见性配置
}
type BazaarBodyGradient struct {
	Mode  string                  `json:"mode"` // auto：自动，custom：自定义，off：关闭
	Light BazaarBodyGradientColor `json:"light"`
	Dark  BazaarBodyGradientColor `json:"dark"`
}
type BazaarBodyGradientColor struct {
	Color   string  `json:"color"`   // 十六进制 RGB 颜色
	Opacity float64 `json:"opacity"` // 渐变起点的不透明度，范围为 0 至 100
}
type BazaarAppearanceTheme struct {
	Name      string   `json:"name"`                // 主题名称
	Label     string   `json:"label"`               // 显示名称
	Frontends []string `json:"frontends,omitempty"` // 支持的前端
}
type BazaarAppearanceIcon struct {
	Name  string `json:"name"`  // 图标名称
	Label string `json:"label"` // 显示名称
}
type BazaarEntryVisibility struct {
	Version  int                             `json:"version"`
	Active   string                          `json:"active"`
	Profiles []*BazaarEntryVisibilityProfile `json:"profiles"`
}
type BazaarEntryVisibilityProfile struct {
	ID      string              `json:"id"`
	Name    string              `json:"name"`
	Entries map[string]bool     `json:"entries"`
	Orders  map[string][]string `json:"orders"`
}
type BazaarEditorFont struct {
	Family      string `json:"family"`
	Weight      int    `json:"weight"`
	DisplayName string `json:"displayName"`
}
type BazaarStatusBar struct {
	Version                                   int  `json:"version"`
	MsgTaskDatabaseIndexCommitDisabled        bool `json:"msgTaskDatabaseIndexCommitDisabled"`
	MsgTaskHistoryDatabaseIndexCommitDisabled bool `json:"msgTaskHistoryDatabaseIndexCommitDisabled"`
	MsgTaskAssetDatabaseIndexCommitDisabled   bool `json:"msgTaskAssetDatabaseIndexCommitDisabled"`
	MsgTaskHistoryGenerateFileDisabled        bool `json:"msgTaskHistoryGenerateFileDisabled"`
	MsgDataSyncDisabled                       bool `json:"msgDataSyncDisabled"`
}
type BazaarNotifications struct {
	DocTreeMaxList         bool  `json:"docTreeMaxList"`                   // 文档面板展开上限提示，默认启用
	TagMaxList             bool  `json:"tagMaxList"`                       // 标签面板展开上限提示，默认启用
	WorkspaceNotSSD        bool  `json:"workspaceNotSSD"`                  // 工作空间未放置在固态硬盘警告，默认启用
	BrowserCompatibility   bool  `json:"browserCompatibility"`             // 浏览器兼容性提示，默认启用
	SelectAllTip           *bool `json:"selectAllTip,omitempty"`           // 编辑器全选提示，nil 时默认启用
	SelectAllIncompleteTip *bool `json:"selectAllIncompleteTip,omitempty"` // 编辑器全选不完整提示，nil 时默认启用
	FormatPainterTip       *bool `json:"formatPainterTip,omitempty"`       // 格式刷启用和退出提示，nil 时默认启用
}
type BazaarRatingResult struct {
	success *BazaarRatingData
	failure *BazaarRatingError
}

func NewBazaarRatingResult(data BazaarRatingData) BazaarRatingResult {
	return BazaarRatingResult{success: &data}
}
func NewBazaarRatingResultError(data BazaarRatingError) BazaarRatingResult {
	return BazaarRatingResult{failure: &data}
}
func (data BazaarRatingResult) MarshalJSON() ([]byte, error) {
	if data.success != nil {
		return json.Marshal(data.success)
	}
	if data.failure != nil {
		return json.Marshal(data.failure)
	}
	return nil, errors.New("bazaar response variant is not set")
}

type BazaarUserRatingsResult struct {
	success *BazaarUserRatingsData
	failure *BazaarRatingError
}

func NewBazaarUserRatingsResult(data BazaarUserRatingsData) BazaarUserRatingsResult {
	return BazaarUserRatingsResult{success: &data}
}
func NewBazaarUserRatingsResultError(data BazaarRatingError) BazaarUserRatingsResult {
	return BazaarUserRatingsResult{failure: &data}
}
func (data BazaarUserRatingsResult) MarshalJSON() ([]byte, error) {
	if data.success != nil {
		return json.Marshal(data.success)
	}
	if data.failure != nil {
		return json.Marshal(data.failure)
	}
	return nil, errors.New("bazaar response variant is not set")
}

type BazaarLocalInstallResult struct {
	success *BazaarLocalInstallData
	failure *BazaarLocalInstallError
}

func NewBazaarLocalInstallResult(data BazaarLocalInstallData) BazaarLocalInstallResult {
	return BazaarLocalInstallResult{success: &data}
}
func NewBazaarLocalInstallResultError(data BazaarLocalInstallError) BazaarLocalInstallResult {
	return BazaarLocalInstallResult{failure: &data}
}
func (data BazaarLocalInstallResult) MarshalJSON() ([]byte, error) {
	if data.success != nil {
		return json.Marshal(data.success)
	}
	if data.failure != nil {
		return json.Marshal(data.failure)
	}
	return nil, errors.New("bazaar response variant is not set")
}

func bazaarPayloadSchema(b *schemaBuilder, t reflect.Type, input bool) (*Schema, error) {
	var members []reflect.Type
	switch t {
	case reflect.TypeFor[BazaarRatingResult]():
		members = []reflect.Type{reflect.TypeFor[BazaarRatingData](), reflect.TypeFor[BazaarRatingError]()}
	case reflect.TypeFor[BazaarUserRatingsResult]():
		members = []reflect.Type{reflect.TypeFor[BazaarUserRatingsData](), reflect.TypeFor[BazaarRatingError]()}
	case reflect.TypeFor[BazaarLocalInstallResult]():
		members = []reflect.Type{reflect.TypeFor[BazaarLocalInstallData](), reflect.TypeFor[BazaarLocalInstallError]()}
	default:
		return nil, nil
	}
	var variants []*Schema
	for _, member := range members {
		s, err := b.schema(member, input)
		if err != nil {
			return nil, err
		}
		variants = append(variants, s)
	}
	b.definitions[t.Name()] = &Schema{AnyOf: variants}
	return &Schema{Ref: "#/$defs/" + t.Name()}, nil
}

func bazaarString(fields map[string]json.RawMessage, key string, required, trim bool) (string, error) {
	value, err := legacyField[string](fields, key, "String", required)
	if err != nil {
		return "", err
	}
	if trim && len(fields[key]) > 0 && string(fields[key]) != "null" {
		value = strings.TrimSpace(value)
		if value == "" {
			return "", fmt.Errorf("Field [%s] must not be empty", key)
		}
	}
	return value, nil
}
func init() {
	InstallLocalBazaarPackage.decodeFailure = func(err error) Response[BazaarLocalInstallResult] {
		return Failure[BazaarLocalInstallResult](1, "Marketplace package file is required")
	}
	BatchUpdatePackage.decodeRequest = func(reader io.Reader) (request BatchUpdatePackageRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/batchUpdatePackage")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetUpdatedPackage.decodeRequest = func(reader io.Reader) (request GetUpdatedPackageRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getUpdatedPackage")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	UpdateBazaarPackage.decodeRequest = func(reader io.Reader) (request UpdateBazaarPackageRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/updateBazaarPackage")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledPackageSize.decodeRequest = func(reader io.Reader) (request GetInstalledPackageSizeRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledPackageSize")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarPackage.decodeRequest = func(reader io.Reader) (request GetBazaarPackageRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPackage")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarPackageRatings.decodeRequest = func(reader io.Reader) (request GetBazaarPackageRatingsRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPackageRatings")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		items, parseErr := legacyField[[]json.RawMessage](fields, "packageNames", "Array", true)
		if parseErr != nil {
			return request, parseErr
		}
		request.PackageNames = make([]string, 0, len(items))
		for _, item := range items {
			var value string
			if string(item) == "null" || json.Unmarshal(item, &value) != nil {
				request.NamesError = errors.New("Field [packageNames]: each element should be of type [String]")
				break
			}
			request.PackageNames = append(request.PackageNames, value)
		}
		return request, nil
	}
	GetBazaarPackageUserRatings.decodeRequest = func(reader io.Reader) (request GetBazaarPackageUserRatingsRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPackageUserRatings")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		items, parseErr := legacyField[[]json.RawMessage](fields, "packageNames", "Array", true)
		if parseErr != nil {
			return request, parseErr
		}
		request.PackageNames = make([]string, 0, len(items))
		for _, item := range items {
			var value string
			if string(item) == "null" || json.Unmarshal(item, &value) != nil {
				request.NamesError = errors.New("Field [packageNames]: each element should be of type [String]")
				break
			}
			request.PackageNames = append(request.PackageNames, value)
		}
		return request, nil
	}
	GetBazaarPackageRating.decodeRequest = func(reader io.Reader) (request GetBazaarPackageRatingRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPackageRating")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	SetBazaarPackageRating.decodeRequest = func(reader io.Reader) (request SetBazaarPackageRatingRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/setBazaarPackageRating")
		if err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		if request.Rating, err = legacyField[float64](fields, "rating", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarPackageREADME.decodeRequest = func(reader io.Reader) (request GetBazaarPackageREADMERequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPackageREADME")
		if err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.PackageType, err = bazaarString(fields, "packageType", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarPlugin.decodeRequest = func(reader io.Reader) (request GetBazaarPluginRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarPlugin")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledPlugin.decodeRequest = func(reader io.Reader) (request GetInstalledPluginRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledPlugin")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InstallBazaarPlugin.decodeRequest = func(reader io.Reader) (request InstallBazaarPluginRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/installBazaarPlugin")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", true, true); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.RepoRef, err = bazaarString(fields, "repoRef", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	UninstallBazaarPlugin.decodeRequest = func(reader io.Reader) (request UninstallBazaarPluginRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/uninstallBazaarPlugin")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, false); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarWidget.decodeRequest = func(reader io.Reader) (request GetBazaarWidgetRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarWidget")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledWidget.decodeRequest = func(reader io.Reader) (request GetInstalledWidgetRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledWidget")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InstallBazaarWidget.decodeRequest = func(reader io.Reader) (request InstallBazaarWidgetRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/installBazaarWidget")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.RepoRef, err = bazaarString(fields, "repoRef", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	UninstallBazaarWidget.decodeRequest = func(reader io.Reader) (request UninstallBazaarWidgetRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/uninstallBazaarWidget")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarIcon.decodeRequest = func(reader io.Reader) (request GetBazaarIconRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarIcon")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledIcon.decodeRequest = func(reader io.Reader) (request GetInstalledIconRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledIcon")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InstallBazaarIcon.decodeRequest = func(reader io.Reader) (request InstallBazaarIconRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/installBazaarIcon")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.RepoRef, err = bazaarString(fields, "repoRef", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	UninstallBazaarIcon.decodeRequest = func(reader io.Reader) (request UninstallBazaarIconRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/uninstallBazaarIcon")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarTemplate.decodeRequest = func(reader io.Reader) (request GetBazaarTemplateRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarTemplate")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledTemplate.decodeRequest = func(reader io.Reader) (request GetInstalledTemplateRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledTemplate")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InstallBazaarTemplate.decodeRequest = func(reader io.Reader) (request InstallBazaarTemplateRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/installBazaarTemplate")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.RepoRef, err = bazaarString(fields, "repoRef", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	UninstallBazaarTemplate.decodeRequest = func(reader io.Reader) (request UninstallBazaarTemplateRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/uninstallBazaarTemplate")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetBazaarTheme.decodeRequest = func(reader io.Reader) (request GetBazaarThemeRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getBazaarTheme")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, false); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetInstalledTheme.decodeRequest = func(reader io.Reader) (request GetInstalledThemeRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/getInstalledTheme")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, false); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InstallBazaarTheme.decodeRequest = func(reader io.Reader) (request InstallBazaarThemeRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/installBazaarTheme")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, false); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.RepoURL, err = bazaarString(fields, "repoURL", true, true); err != nil {
			return request, err
		}
		if request.RepoHash, err = bazaarString(fields, "repoHash", true, true); err != nil {
			return request, err
		}
		if request.RepoRef, err = bazaarString(fields, "repoRef", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		_, hasMode := fields["mode"]
		_, hasModeOS := fields["modeOS"]
		if hasMode != hasModeOS {
			return request, errors.New("Fields [mode] and [modeOS] must be provided together")
		}
		if hasMode {
			mode, parseErr := legacyField[float64](fields, "mode", "Number", true)
			if parseErr != nil {
				return request, parseErr
			}
			modeOS, parseErr := legacyField[bool](fields, "modeOS", "Boolean", true)
			if parseErr != nil {
				return request, parseErr
			}
			if mode != 0 && mode != 1 {
				return request, errors.New("Field [mode] must be 0 or 1")
			}
			request.Mode = &mode
			request.ModeOS = &modeOS
		}
		return request, nil
	}
	UninstallBazaarTheme.decodeRequest = func(reader io.Reader) (request UninstallBazaarThemeRequest, err error) {
		fields, err := bazaarRequestFields(reader, "/api/bazaar/uninstallBazaarTheme")
		if err != nil {
			return request, err
		}
		if request.Frontend, err = bazaarString(fields, "frontend", false, false); err != nil {
			return request, err
		}
		if request.Keyword, err = bazaarString(fields, "keyword", false, false); err != nil {
			return request, err
		}
		if request.PackageName, err = bazaarString(fields, "packageName", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
}

func bazaarRequestFields(reader io.Reader, path string) (map[string]json.RawMessage, error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return nil, errors.New(strings.ReplaceAll(err.Error(), "map[string]json.RawMessage", "map[string]interface {}"))
	}
	return fields, nil
}
