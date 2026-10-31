// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"crypto/sha1"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/Xuanwo/go-locale"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/heif"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/text/language"
)

var Conf *AppConf

// AppConf 维护应用元数据，保存在 ~/.siyuan/conf.json。
type AppConf struct {
	LogLevel       string                       `json:"logLevel"`       // 日志级别：off, trace, debug, info, warn, error, fatal
	Appearance     ConfSection[conf.Appearance] `json:"appearance"`     // 外观
	Langs          []*conf.Lang                 `json:"langs"`          // 界面语言列表
	Lang           string                       `json:"lang"`           // 选择的界面语言，同 Appearance.Lang
	FileTree       ConfSection[conf.FileTree]   `json:"fileTree"`       // 文档面板
	Tag            ConfSection[conf.Tag]        `json:"tag"`            // 标签面板
	Editor         ConfSection[conf.Editor]     `json:"editor"`         // 编辑器配置
	Export         ConfSection[conf.Export]     `json:"export"`         // 导出配置
	Graph          ConfSection[conf.Graph]      `json:"graph"`          // 关系图配置
	UILayout       ConfSection[conf.UILayout]   `json:"uiLayout"`       // 界面布局，通过 SetUILayout 更新
	UserData       string                       `json:"userData"`       // 社区用户信息，对 User 加密存储
	User           *conf.User                   `json:"-"`              // 社区用户内存结构，不持久化。不要直接使用，使用 GetUser() 和 SetUser() 方法
	ReadOnly       bool                         `json:"readonly"`       // 是否是以只读模式运行
	ServerAddrs    []string                     `json:"serverAddrs"`    // 本地服务器地址列表
	AccessAuthCode string                       `json:"accessAuthCode"` // 锁屏密码
	OIDC           *conf.OIDC                   `json:"oidc"`           // OpenID Connect 登录
	System         ConfSection[conf.System]     `json:"system"`         // 系统配置
	Keymap         ConfSection[conf.Keymap]     `json:"keymap"`         // 快捷键配置
	Sync           ConfSection[conf.Sync]       `json:"sync"`           // 同步配置
	Search         ConfSection[conf.Search]     `json:"search"`         // 搜索配置
	Flashcard      ConfSection[conf.Flashcard]  `json:"flashcard"`      // 闪卡配置
	AI             ConfSection[conf.AI]         `json:"ai"`             // 人工智能配置
	OCR            ConfSection[conf.OCR]        `json:"ocr"`            // 本地图片文字识别
	Secrets        ConfSection[conf.Secrets]    `json:"secrets"`        // 全局密钥库
	Variables      ConfSection[conf.Variables]  `json:"variables"`      // 全局变量库
	Bazaar         ConfSection[conf.Bazaar]     `json:"bazaar"`         // 集市配置
	Stat           ConfSection[conf.Stat]       `json:"stat"`           // 统计
	Api            ConfSection[conf.API]        `json:"api"`            // API
	Repo           ConfSection[conf.Repo]       `json:"repo"`           // 数据仓库
	NotebookCrypto *conf.NotebookCrypto         `json:"notebookCrypto"` // 加密笔记本密钥管理
	Publish        ConfSection[conf.Publish]    `json:"publish"`        // 发布服务
	Onboarding     ConfSection[conf.Onboarding] `json:"onboarding"`     // 首次使用引导
	ShowChangelog  bool                         `json:"showChangelog"`  // 是否显示版本更新日志
	CloudRegion    int                          `json:"cloudRegion"`    // 云端区域，0：中国大陆，1：北美
	Snippet        ConfSection[conf.Snpt]       `json:"snippet"`        // 代码片段
	DataIndexState int                          `json:"dataIndexState"` // 数据索引状态，0：已索引，1：未索引
	CookieKey      string                       `json:"cookieKey"`      // 用于加密 Cookie 的密钥
	ConfVersion    int                          `json:"confVersion"`    // 配置格式版本，用于判定需要执行的迁移

	MCPOAuth string `json:"mcpOAuth"` // MCP OAuth 凭据密文

	m        *sync.RWMutex // 配置数据锁
	userLock *sync.RWMutex // 用户数据独立锁，避免与配置保存操作竞争
}

func NewAppConf() *AppConf {
	return &AppConf{
		LogLevel:   "debug",
		Appearance: NewConfSection[conf.Appearance](nil),
		FileTree:   NewConfSection[conf.FileTree](nil),
		Tag:        NewConfSection[conf.Tag](nil),
		Editor:     NewConfSection[conf.Editor](nil),
		Export:     NewConfSection[conf.Export](nil),
		Graph:      NewConfSection[conf.Graph](nil),
		UILayout:   NewConfSection[conf.UILayout](nil),
		System:     NewConfSection[conf.System](nil),
		Keymap:     NewConfSection[conf.Keymap](nil),
		Sync:       NewConfSection[conf.Sync](nil),
		Search:     NewConfSection[conf.Search](nil),
		Flashcard:  NewConfSection[conf.Flashcard](nil),
		AI:         NewConfSection[conf.AI](nil),
		OCR:        NewConfSection[conf.OCR](nil),
		Secrets:    NewConfSection[conf.Secrets](nil),
		Variables:  NewConfSection[conf.Variables](nil),
		Bazaar:     NewConfSection[conf.Bazaar](nil),
		Stat:       NewConfSection[conf.Stat](nil),
		Api:        NewConfSection[conf.API](nil),
		Repo:       NewConfSection[conf.Repo](nil),
		Publish:    NewConfSection[conf.Publish](nil),
		Onboarding: NewConfSection[conf.Onboarding](nil),
		Snippet:    NewConfSection[conf.Snpt](nil),
		OIDC:       conf.NewOIDC(),
		m:          &sync.RWMutex{},
		userLock:   &sync.RWMutex{},
	}
}

func applyOIDCEnvironment(config *conf.OIDC) {
	if config == nil {
		return
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_ENABLED"); ok {
		config.Enabled, _ = strconv.ParseBool(value)
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_PROVIDER"); ok {
		config.Provider = value
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_ISSUER_URL"); ok {
		config.IssuerURL = value
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_CLIENT_ID"); ok {
		config.ClientID = value
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_CLIENT_SECRET"); ok {
		config.ClientSecret = value
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_SCOPES"); ok {
		config.Scopes = strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' })
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_REDIRECT_URL"); ok {
		config.RedirectURL = value
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_ALLOW_ALL"); ok {
		config.AllowAll, _ = strconv.ParseBool(value)
	}
	if value, ok := os.LookupEnv("SIYUAN_OIDC_CLAIM_RULES"); ok {
		rules := []*conf.OIDCClaimRule{}
		if err := gulu.JSON.UnmarshalJSON([]byte(value), &rules); err != nil {
			config.ClaimRules = nil
			logging.LogErrorf("parse SIYUAN_OIDC_CLAIM_RULES failed: %s", err)
		} else {
			config.ClaimRules = rules
		}
	}
}

func (conf *AppConf) GetMCPOAuth() string {
	conf.m.RLock()
	defer conf.m.RUnlock()
	return conf.MCPOAuth
}

func (conf *AppConf) SetMCPOAuth(value string) {
	conf.m.Lock()
	conf.MCPOAuth = value
	conf.m.Unlock()
	conf.Save()
}

func (appConf *AppConf) GetOIDC() *conf.OIDC {
	appConf.m.RLock()
	defer appConf.m.RUnlock()
	if appConf.OIDC == nil {
		return conf.NewOIDC()
	}
	ret := *appConf.OIDC
	ret.Scopes = append([]string{}, appConf.OIDC.Scopes...)
	ret.ClaimRules = make([]*conf.OIDCClaimRule, 0, len(appConf.OIDC.ClaimRules))
	for _, rule := range appConf.OIDC.ClaimRules {
		if rule == nil {
			ret.ClaimRules = append(ret.ClaimRules, nil)
			continue
		}
		clonedRule := *rule
		clonedRule.Values = append([]string{}, rule.Values...)
		ret.ClaimRules = append(ret.ClaimRules, &clonedRule)
	}
	return &ret
}

func (appConf *AppConf) SetOIDC(config *conf.OIDC) {
	appConf.m.Lock()
	appConf.OIDC = config
	appConf.m.Unlock()
	appConf.Save()
}

// CompareAndSetOIDC 仅在当前配置版本仍与预期一致时写入 OIDC 配置。
func (appConf *AppConf) CompareAndSetOIDC(expectedVersion string, config *conf.OIDC) (changed, swapped bool) {
	appConf.m.Lock()
	current := appConf.OIDC
	if current == nil {
		current = conf.NewOIDC()
	}
	if oidcConfigurationVersionWithKey(appConf.CookieKey, current) != expectedVersion {
		appConf.m.Unlock()
		return false, false
	}
	changed = !reflect.DeepEqual(current, config)
	if changed {
		appConf.OIDC = config
	}
	appConf.m.Unlock()
	if changed {
		appConf.Save()
	}
	return changed, true
}

func (conf *AppConf) SetAI(ctx context.Context, ai *conf.AI) error {
	conf.m.Lock()
	defer conf.m.Unlock()
	bindings := chatGPTAccountBindingIDs(ai)
	if reflect.DeepEqual(bindings, chatGPTAccountBindingIDs(conf.AI.Load())) || util.ReadOnly {
		conf.AI.Store(ai)
		if !util.ReadOnly {
			conf.saveLocked()
		}
		return nil
	}
	next := conf.cloneSettings()
	next.AI.Store(ai)
	data, err := next.marshalForSave()
	if err != nil {
		return err
	}
	if err = util.ChatGPTService().UpdateBindings(ctx, util.WorkspaceDir, bindings, func(path string, bindingsData []byte) error {
		return writeChatGPTBindingConfiguration(path, bindingsData, data, writeChatGPTBindingFile)
	}); err != nil {
		return err
	}
	conf.AI.Store(ai)
	applyConfRuntime(conf)
	recordPersistedConf(data)
	return nil
}

func (conf *AppConf) SetUILayout(uiLayout *conf.UILayout) {
	conf.m.Lock()
	defer conf.m.Unlock()
	conf.UILayout.Store(uiLayout)
}

func (conf *AppConf) GetUser() *conf.User {
	conf.userLock.RLock()
	defer conf.userLock.RUnlock()
	return conf.User
}

func (conf *AppConf) SetUser(user *conf.User) {
	conf.userLock.Lock()
	defer conf.userLock.Unlock()
	conf.User = user
}

func InitConf() {
	if err := recoverEncryptedAssetCleanupOperations(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover encrypted asset cleanup failed: %s", err)
	}
	initLang()
	if err := recoverSettingsReset(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover settings reset failed: %s", err)
		return
	}
	if err := recoverChatGPTAccountBindings(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover ChatGPT account bindings failed: %s", err)
		return
	}

	Conf = NewAppConf()
	if err := recoverDataImports(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover Data.zip import failed: %s", err)
		return
	}
	// 先回滚未提交的目录移动，即使配置文件丢失也必须在挂载和同步之前恢复。
	if err := recoverNotebookArchiveOperations(); err != nil {
		logging.LogErrorf("recover notebook archive operations failed: %s", err)
	}
	if err := recoverSortConfAppends(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover incremental sort conf failed: %s", err)
		return
	}
	if err := recoverDocumentSources(); err != nil {
		logging.LogFatalf(logging.ExitCodeFileSysErr, "recover document sources failed: %s", err)
		return
	}
	clearEncryptedExportTempOnBoot()
	clearOldInstallPackages("")
	if err := CleanupRetiredInstallResources(); err != nil {
		logging.LogWarnf("clean up retired install resources failed: %s", err)
	}
	if err := cleanupRetiredDocumentAddressing(); err != nil {
		logging.LogWarnf("clean up retired document addressing records failed: %s", err)
	}
	confPath := filepath.Join(util.ConfDir, "conf.json")
	confFileExists := gulu.File.IsExist(confPath)
	var confData []byte
	if confFileExists {
		if data, err := os.ReadFile(confPath); err != nil {
			logging.LogErrorf("load conf [%s] failed: %s", confPath, err)
		} else {
			recordPersistedConf(data)
			// 解析失败时保留已成功写入的字段；未导出字段（m、userLock）与未触及的导出字段保持 NewAppConf() 初值。
			if err = gulu.JSON.UnmarshalJSON(data, Conf); err != nil {
				logging.LogWarnf("parse conf failed, parsed fields retained: %s", err)
			} else {
				logging.LogInfof("loaded conf [%s]", confPath)
			}

			// 启动时检测并完成中断的改密迁移
			recoverMasterPasswordMigration()
			confData = data
		}
	}

	if "" != util.Lang {
		initialized := false
		if util.IsMobileContainer() {
			// 移动端以上次设置的外观语言为准
			if "" != Conf.Lang && util.Lang != Conf.Lang {
				util.Lang = Conf.Lang
				logging.LogInfof("use the last specified language [%s]", util.Lang)
				initialized = true
			}
		}

		if !initialized {
			Conf.Lang = util.Lang
			logging.LogInfof("initialized the specified language [%s]", util.Lang)
		}
	} else if "" == Conf.Lang {
		// 未指定外观语言时使用系统语言
		// DetectAll 返回按优先级排序的系统语言 Tag 列表（如 en-US、en）
		deviceLangTags, detectErr := locale.DetectAll()
		if detectErr != nil {
			logging.LogDebugf("check device locale failed [%s], using default language [en]", detectErr)
			util.Lang = "en"
		} else if len(deviceLangTags) == 0 {
			logging.LogDebugf("device locale list is empty, using default language [en]")
			util.Lang = "en"
		} else {
			// siYuanLangNames 与 bcp47Tags 按相同顺序排列，Match 返回的 matchIndex 即对应 siYuanLangNames 中的语言名
			siYuanLangNames := make([]string, 0, len(util.Langs))
			bcp47Tags := make([]language.Tag, 0, len(util.Langs))
			for langName := range util.Langs {
				bcp47Tag, err := language.Parse(langName)
				if err != nil {
					logging.LogErrorf("load language [%s] failed: %s", langName, err)
					continue
				}
				siYuanLangNames = append(siYuanLangNames, langName)
				bcp47Tags = append(bcp47Tags, bcp47Tag)
			}
			util.Lang = "en"
			if len(bcp47Tags) > 0 {
				matcher := language.NewMatcher(bcp47Tags)
				_, matchIndex, confidence := matcher.Match(deviceLangTags...)
				// 系统语言与 SiYuan 支持列表不存在有效匹配时 confidence 为 No，保持默认 en
				if confidence != language.No {
					util.Lang = siYuanLangNames[matchIndex]
				}
			}
			logging.LogInfof("initialized language [%s] based on device locale", util.Lang)
		}
		Conf.Lang = util.Lang
	} else {
		// conf.json 已保存外观语言
		util.Lang = Conf.Lang
	}

	// 历史下划线语言代码迁移为 BCP 47 新值（zh_CN → zh-CN 等）
	if migrated := util.LangToBCP47(Conf.Lang); migrated != Conf.Lang {
		logging.LogInfof("migrate legacy lang [%s] → [%s]", Conf.Lang, migrated)
		Conf.Lang = migrated
		util.Lang = migrated
	}

	Conf.Langs = loadLangs()
	if confFileExists {
		applyConfMigrations(Conf, confData)
	} else {
		// 新工作空间直接使用当前格式，无需迁移
		Conf.ConfVersion = CurrentConfVersion
	}
	// 已有工作空间缺失的配置段按升级前的行为补全，其余规则由 normalizeAppConf 统一处理。
	Conf.FileTree.Store(normalizeFileTreeDefaultIcon(Conf.FileTree.Load(), confFileExists))
	Conf.OCR.Store(normalizeOCRConfig(Conf.OCR.Load(), confFileExists))
	isNewWorkspace := nil == Conf.System.Load()
	if Conf.Api.Load() == nil {
		api := conf.NewAPI()
		api.Token = gulu.Rand.String(16)
		Conf.Api.Store(api)
	}
	if Conf.AI.Load() == nil {
		ai := conf.NewAI()
		conf.ApplyAIEnvironment(ai)
		Conf.AI.Store(ai)
	}
	if nil != Conf.AI.Load() {
		Conf.AI.Load().DecryptAPIKeys()
	}
	if nil == Conf.OIDC {
		Conf.OIDC = conf.NewOIDC()
	} else {
		Conf.OIDC.DecryptClientSecret()
	}
	applyOIDCEnvironment(Conf.OIDC)
	if nil != Conf.Secrets.Load() {
		Conf.Secrets.Load().Decrypt()
	}
	if timingEnv := os.Getenv("SIYUAN_SYNC_INDEX_TIMING"); "" != timingEnv {
		if val, err := strconv.Atoi(timingEnv); err == nil {
			if nil == Conf.Repo.Load() {
				Conf.Repo.Store(conf.NewRepo())
			}
			Conf.Repo.Load().SyncIndexTiming = int64(val)
		}
	}

	flashcardWarning := normalizeAppConf(Conf)
	if err := LoadChatGPTAccountBindings(Conf.AI.Load()); err != nil {
		logging.LogErrorf("load local ChatGPT account bindings failed: %s", err)
	}
	if flashcardWarning != "" {
		logging.LogWarnf("%s, reset to default weights [%s]", flashcardWarning, Conf.Flashcard.Load().Weights)
		go func() {
			util.WaitForUILoaded()
			task.AppendAsyncTaskWithDelay(task.PushMsg, 2*time.Second, util.PushErrMsg, flashcardWarning, 15000)
		}()
	}

	var langOK bool
	for _, l := range Conf.Langs {
		if Conf.Lang == l.Name {
			langOK = true
			break
		}
	}
	if !langOK {
		Conf.Lang = "en"
		util.Lang = Conf.Lang
	}
	Conf.Appearance.Load().Lang = Conf.Lang

	util.CurrentCloudRegion = Conf.CloudRegion

	if !isNewWorkspace {
		cmp := semver.Compare("v"+util.Ver, "v"+Conf.System.Load().KernelVersion)
		if 0 < cmp {
			logging.LogInfof("upgraded from version [%s] to [%s]", Conf.System.Load().KernelVersion, util.Ver)
			Conf.ShowChangelog = true
		} else if 0 > cmp {
			logging.LogInfof("downgraded from version [%s] to [%s]", Conf.System.Load().KernelVersion, util.Ver)
		}
		Conf.System.Load().KernelVersion = util.Ver
	}
	projectSystemEnvironment(Conf.System.Load())

	if "" != Conf.UserData {
		Conf.SetUser(loadUserFromConf())
	}

	if util.ContainerDocker == util.Container {
		Conf.Sync.Load().Perception = false
	}
	if boxes, listErr := ListNotebooks(); listErr == nil {
		prepareOnboardingForEmptyWorkspace(Conf.Onboarding.Load(), util.ReadOnly, len(boxes))
	}

	if 0 < len(Conf.Repo.Load().Key) {
		logging.LogInfof("repo key [%x]", sha1.Sum(Conf.Repo.Load().Key))
	}

	// 注意：此处不在启动时为已启用但备份缺失的情形回填密钥备份。无 KEK 生成的备份 KEKMAC 必为空，
	// 而 deriveKEK/恢复路径强制要求 KEKMAC 有效，回填会导致该机永远无法解锁（自相矛盾）。
	// 当前格式备份必须由主密码验证后生成（见 EnableEncryptedNotebook / tryRestoreNotebookCryptoFromBackupLocked）。
	// Enabled=true 但备份缺失/无效属配置不完整，解锁时由 deriveKEK 返回恢复提示（Language 315），
	// 引导用户导入匹配的备份文件后重新验证主密码。

	applyConfRuntime()

	for _, p := range Conf.AI.Load().Providers {
		if p == nil || !p.Enabled {
			continue
		}
		for _, m := range p.Models {
			if m == nil || m.Name == "" || !m.Enabled {
				continue
			}
			logging.LogInfof("AI provider enabled\n"+
				"    baseURL=%s\n"+
				"    timeout=%ds\n"+
				"    model=%s\n"+
				"    maxCompletionTokens=%d\n"+
				"    temperature=%.1f\n"+
				"    maxHistoryMessages=%d",
				p.BaseURL,
				p.RequestTimeout,
				m.Name,
				Conf.AI.Load().Editing.MaxCompletionTokens,
				Conf.AI.Load().Editing.Temperature,
				Conf.AI.Load().Editing.MaxHistoryMessages)
		}
	}

	if Conf.AI.Load().Embedding != nil && len(Conf.AI.Load().Embedding.APIKey) > 0 {
		logging.LogInfof("embedding API enabled\n"+
			"    baseURL=%s\n"+
			"    model=%s",
			Conf.AI.Load().Embedding.BaseURL,
			Conf.AI.Load().Embedding.Name)
	}

	Conf.ReadOnly = util.ReadOnly

	if "" != util.AccessAuthCode {
		Conf.AccessAuthCode = util.AccessAuthCode
	}
	Conf.AccessAuthCode = util.RemoveInvalid(Conf.AccessAuthCode)
	Conf.AccessAuthCode = strings.TrimSpace(Conf.AccessAuthCode)

	if 1 == Conf.DataIndexState {
		// 上次未正常完成数据索引，后续会由 recoverIndexQueue() 恢复
		logging.LogInfof("data index state is [%d], will recover through index queue", Conf.DataIndexState)
	}

	Conf.DataIndexState = 0

	Conf.CookieKey = loadCookieKey(Conf.CookieKey)
	initSharedInstallPackages()

	if util.ContainerDocker == util.Container && Conf.AccessAuthCode == "" && !util.SiYuanAccessAuthCodeBypass {
		if err := ValidateOIDCConfigurationChange(context.Background(), Conf.OIDC, true, false, false); err != nil {
			fmt.Println("the access authorization code or a valid OIDC configuration must be set when deploying via Docker")
			fmt.Println("set SIYUAN_ACCESS_AUTH_CODE, configure OIDC, or explicitly set SIYUAN_ACCESS_AUTH_CODE_BYPASS=true")
			logging.LogErrorf("Docker access authentication configuration is invalid: %s", err)
			os.Exit(logging.ExitCodeSecurityRisk)
		}
	}

	Conf.Save()

	// 安全模式：渲染进程崩溃恢复后由桌面端主进程通过 --safe-mode 注入。
	// safeMode 是纯运行时状态，不随 conf.json 持久化（Save 时会被排除），故每次启动都按 util.SafeMode 重新赋值。
	Conf.System.Load().SafeMode = util.SafeMode
	if util.SafeMode {
		// 直接覆盖外观、集市、代码片段相关配置并持久化，禁用代码片段、插件、自定义主题与图标，以排除扩展导致再次崩溃的可能。
		// 注意：这是破坏性操作，会覆盖用户原有配置，后续不会自动恢复。
		Conf.Appearance.Load().ThemeLight = "daylight"
		Conf.Appearance.Load().ThemeDark = "midnight"
		Conf.Appearance.Load().Icon = "litheness"
		Conf.Appearance.Load().ThemeJS = false
		Conf.Bazaar.Load().PetalDisabled = true
		Conf.Snippet.Load().EnabledCSS = false
		Conf.Snippet.Load().EnabledJS = false
		Conf.Save()
		logging.LogInfof("booted in safe mode")
	}

	// CLI 子命令通过 --log-level 显式指定日志级别时（util.CLILogLevel 非空），优先使用命令行级别，
	// 使命令行参数在初始化早期即生效。
	if "" == util.CLILogLevel {
		logging.SetLogLevel(Conf.LogLevel)
	}

	util.SetNetworkProxy(Conf.System.Load().NetworkProxy.String(), Conf.System.Load().NetworkProxy.IsSystem())

	go util.InitPandoc(Conf.Export.Load().PandocBin)
	go util.InitTesseract()
	InitOCR()
}

func normalizeFileTreeDefaultIcon(fileTree *conf.FileTree, confFileExists bool) *conf.FileTree {
	if nil == fileTree {
		fileTree = conf.NewFileTree()
		if confFileExists {
			fileTree.UseSVGDefaultIcon = false
		}
	}
	return fileTree
}

func initLang() {
	p := filepath.Join(util.WorkingDir, "appearance", "langs")
	dir, err := os.Open(p)
	if err != nil {
		logging.LogErrorf("open language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}
	defer dir.Close()

	langNames, err := dir.Readdirnames(-1)
	if err != nil {
		logging.LogErrorf("list language configuration folder [%s] failed: %s", p, err)
		util.ReportFileSysFatalError(err)
		return
	}

	for _, langName := range langNames {
		jsonPath := filepath.Join(p, langName)
		data, err := os.ReadFile(jsonPath)
		if err != nil {
			logging.LogErrorf("read language configuration [%s] failed: %s", jsonPath, err)
			continue
		}
		data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
		langMap := map[string]any{}
		if err := gulu.JSON.UnmarshalJSON(data, &langMap); err != nil {
			logging.LogErrorf("parse language configuration failed [%s] failed: %s", jsonPath, err)
			continue
		}

		kernelMap := map[int]string{}
		label := langMap["_label"].(string)
		kernelLangs := langMap["_kernel"].(map[string]any)
		for k, v := range kernelLangs {
			num, convErr := strconv.Atoi(k)
			if nil != convErr {
				logging.LogErrorf("parse language configuration [%s] item [%d] failed: %s", p, num, convErr)
				continue
			}
			kernelMap[num] = v.(string)
		}
		kernelMap[-1] = label
		name := langName[:strings.LastIndex(langName, ".")]
		util.Langs[name] = kernelMap

		util.TimeLangs[name] = langMap["_time"].(map[string]any)
		util.TaskActionLangs[name] = langMap["_taskAction"].(map[string]any)
		util.TrayMenuLangs[name] = langMap["_trayMenu"].(map[string]any)
		util.AttrViewLangs[name] = langMap["_attrView"].(map[string]any)
	}
}

func loadLangs() (ret []*conf.Lang) {
	for name, langMap := range util.Langs {
		lang := &conf.Lang{Label: langMap[-1], Name: name}
		ret = append(ret, lang)
	}
	sort.Slice(ret, func(i, j int) bool {
		return ret[i].Name < ret[j].Name
	})
	return
}

var exitLock = sync.Mutex{}
var exitFinished bool                             // 由 exitLock 保护，防止排队的重试请求再次关闭数据库。
var exitServersStarted bool                       // 由 exitLock 保护，服务退出只启动一次。
var pendingWorkspaceExit *util.WorkspaceExitState // 由 exitLock 保护，绑定可接管的退出批次。

// Close 完成退出清理，调用方处理退出结果后通过 ExitKernel 结束服务及进程。
//
// force：是否不执行同步过程而直接退出
//
// setCurrentWorkspace：是否将当前工作空间放到工作空间列表的最后一个
//
// execInstallPkg：是否返回新版本安装包
//
//	0：默认按照设置项 System.DownloadInstallPkg 检查并推送提示
//	1：不返回新版本安装包
//	2：返回新版本安装包路径并退出，由桌面宿主执行安装
//
// 返回值 exitCode：
//
//	0：正常退出
//	1：同步执行失败
//	2：提示新安装包
//
// 当 force 为 true（强制退出）并且 execInstallPkg 为 0（默认检查更新）并且新版本安装包已经准备就绪时，将安装包路径返回给桌面宿主
// https://github.com/siyuan-note/siyuan/issues/10288
func Close(force, setCurrentWorkspace bool, execInstallPkg int) (exitCode int, installPkgPath string) {
	return CloseWithContext(context.Background(), force, setCurrentWorkspace, execInstallPkg)
}

// CloseWithContext 允许请求取消退出同步，数据清理仍等待仓库操作收尾后完整执行。
func CloseWithContext(ctx context.Context, force, setCurrentWorkspace bool, execInstallPkg int) (int, string) {
	return closeKernel(ctx, force, setCurrentWorkspace, execInstallPkg, nil)
}

// RecoverWorkspaceExit 仅接管指定批次且没有活动会话的桌面退出，允许用户确认后跳过同步，不触发安装更新。
func RecoverWorkspaceExit(pid int, startedAt int64, force bool) (int, string) {
	return closeKernel(context.Background(), force, false, 1, &util.WorkspaceExitState{PID: pid, StartedAt: startedAt})
}

func workspaceExitRecoveryCode(expected *util.WorkspaceExitState) int {
	if util.Container != util.ContainerStd || !util.AttachUI || expected.PID != os.Getpid() ||
		pendingWorkspaceExit == nil || expected.StartedAt != pendingWorkspaceExit.StartedAt {
		return -1
	}
	if !exitFinished && util.CountSessions() > 0 {
		return 3
	}
	return 0
}

func markPendingWorkspaceExit() {
	if pendingWorkspaceExit == nil {
		pendingWorkspaceExit = util.MarkWorkspaceExiting()
	} else {
		pendingWorkspaceExit.SetPhase("exiting")
	}
}

func closeKernel(ctx context.Context, force, setCurrentWorkspace bool, execInstallPkg int, recovery *util.WorkspaceExitState) (exitCode int, installPkgPath string) {
	diagnostic := util.WatchOperation("exit kernel", "wait for exit lock")
	defer diagnostic.Finish()
	exitLock.Lock()
	defer exitLock.Unlock()
	if recovery != nil {
		if code := workspaceExitRecoveryCode(recovery); code != 0 {
			return code, ""
		}
	}
	if exitFinished {
		return
	}
	confSyncSnapshot := Conf.LoadSync()
	markPendingWorkspaceExit()
	defer func() {
		if exitCode == 1 || exitCode == 2 || exitCode == 3 {
			pendingWorkspaceExit.SetPhase("waiting")
		}
	}()

	logging.LogInfof("exiting kernel [force=%v, setCurrentWorkspace=%v, execInstallPkg=%d]", force, setCurrentWorkspace, execInstallPkg)
	pluginsStopped, shutdownStarted := false, false
	defer func() {
		if shutdownStarted {
			diagnostic.Stage("stop LAN sync manager")
			stopLANSyncManager()
		} else if pluginsStopped && OnKernelPluginsStart != nil {
			diagnostic.Stage("resume kernel plugins after abandoned exit")
			OnKernelPluginsStart()
		}
	}()

	diagnostic.Stage("flush editing transactions")
	util.PushMsg(Conf.Language(95), 10000*60)
	FlushTxQueue()

	diagnostic.Stage("cancel purge")
	cancelPurge()

	if !force {
		if OnKernelPluginsStop != nil {
			diagnostic.Stage("stop kernel plugins")
			OnKernelPluginsStop()
			pluginsStopped = true
		}
	}

	diagnostic.Stage("wait for sync operations")
	if err := lockSyncForExit(ctx, force); err != nil {
		exitCode = 1
		return
	}
	defer unlockSync()
	if !force {
		if confSyncSnapshot.Enabled && 3 != confSyncSnapshot.Mode &&
			((IsSubscriber() && conf.ProviderSiYuan == confSyncSnapshot.Provider) || conf.ProviderSiYuan != confSyncSnapshot.Provider) {
			diagnostic.Stage("exit sync")
			if checkSync(false, true, false) {
				if err := syncDataLockedContext(ctx, true, false); err != nil {
					exitCode = 1
					if 1 != execInstallPkg && !skipNewVerInstallPkg() {
						installPkgPath = getNewVerInstallPkgPath(false)
					}
					return
				}
			}
		}
	}

	// 同步期间可能重新连接界面；在关闭数据前再次确认，交还给仍可操作的窗口。
	if recovery != nil && util.CountSessions() > 0 {
		return 3, ""
	}

	// 等待同步期间可能有其他窗口提交编辑，关闭数据前再次排空事务。
	diagnostic.Stage("flush editing transactions after sync")
	FlushTxQueue()

	// Close the user guide when exiting https://github.com/siyuan-note/siyuan/issues/10322
	diagnostic.Stage("close user guide")
	closeUserGuide()

	// Improve indexing completeness when exiting https://github.com/siyuan-note/siyuan/issues/12039
	diagnostic.Stage("flush database index")
	sql.FlushQueue()

	// 等待正在执行的路径批次退出，未完成任务保留在配置目录供下次启动恢复。
	diagnostic.Stage("wait for path refresh")
	hpathRefresh.Lock()
	pendingPathRefresh := len(hpathRefresh.tasks)
	hpathRefresh.Unlock()
	if 0 < pendingPathRefresh {
		logging.LogInfof("pending path refresh tasks: %d", pendingPathRefresh)
	}
	diagnostic.Stage("check install package")
	newVerInstallPkgPath := getNewVerInstallPkgPath(2 == execInstallPkg || (force && 0 == execInstallPkg))
	if !skipNewVerInstallPkg() && "" != newVerInstallPkgPath {
		if 2 == execInstallPkg || (force && 0 == execInstallPkg) { // 将新版本安装包交给桌面宿主执行
			installPkgPath = newVerInstallPkgPath
			logging.LogInfof("the new version install pkg is ready for the desktop host [%s]", newVerInstallPkgPath)
		} else if 0 == execInstallPkg { // 新版本安装包已经准备就绪
			installPkgPath = newVerInstallPkgPath
			exitCode = 2
			logging.LogInfof("the new version install pkg is ready [%s], waiting for the user's next instruction", newVerInstallPkgPath)
			return
		}
	}

	shutdownStarted = true
	util.IsExiting.Store(true)
	diagnostic.Stage("save configuration")
	Conf.Close()
	// 退出前关闭已打开的加密笔记本并推送 closeBox，让前端关闭对应的明文文档标签页，避免重启后泄密。
	// 走 Unmount：落盘 Closed=true + 生成历史 + 锁定清 DEK + 广播 closeBox。
	// 排除用户指南：Unmount 对用户指南会触发 RemoveBox（mount.go:208-214）。
	// 在退出确认之前推送，随后的等待留给前端处理笔记本关闭事件。
	for _, box := range Conf.GetOpenedBoxes() {
		if IsEncryptedBox(box.ID) && !IsUserGuide(box.ID) {
			diagnostic.Stage("unmount encrypted notebook " + box.ID)
			Unmount(box.ID)
		}
	}
	diagnostic.Stage("close databases")
	sql.CloseDatabase()
	diagnostic.Stage("close push queue")
	closePushQueue()
	diagnostic.Stage("save asset texts")
	util.SaveAssetsTexts()
	diagnostic.Stage("clear workspace temp")
	clearWorkspaceTemp(installPkgPath)
	diagnostic.Stage("clear corrupted notebooks")
	clearCorruptedNotebooks()
	diagnostic.Stage("clear port file")
	clearPortJSON()

	if setCurrentWorkspace {
		diagnostic.Stage("save workspace paths")
		// 将当前工作空间放到工作空间列表的最后一个
		// Open the last workspace by default https://github.com/siyuan-note/siyuan/issues/10570
		workspacePaths, err := util.ReadWorkspacePaths()
		if err != nil {
			logging.LogErrorf("read workspace paths failed: %s", err)
		} else {
			workspacePaths = util.RemoveWorkspacePath(workspacePaths, util.WorkspaceDir)
			workspacePaths = append(workspacePaths, util.WorkspaceDir)
			util.WriteWorkspacePaths(workspacePaths)
		}
	}

	diagnostic.Stage("unlock workspace")
	util.ClearWorkspaceExitMarker()
	util.UnlockWorkspace()

	diagnostic.Stage("wait for frontend events")
	time.Sleep(500 * time.Millisecond)
	diagnostic.Stage("close sync websocket")
	closeSyncWebSocket()
	exitFinished = true
	return
}

// ExitKernel 在退出清理完成后结束服务，移动端保留确认通道直到原生宿主退出。
func ExitKernel() {
	exitLock.Lock()
	if !exitFinished || exitServersStarted {
		exitLock.Unlock()
		return
	}
	exitServersStarted = true
	exitLock.Unlock()

	if util.IsMobileContainer() {
		logging.LogInfof("exited kernel, waiting for mobile host to quit")
		return
	}

	go func() {
		diagnostic := util.WatchOperation("exit kernel servers", "wait for frontend exit event")
		time.Sleep(500 * time.Millisecond)
		diagnostic.Stage("close HTTP servers")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		util.ShutdownHTTPServers(ctx, util.HttpServer, util.HttpsServer)
		cancel()
		if nil != util.WebSocketServer {
			diagnostic.Stage("close frontend websockets")
			util.WebSocketServer.Close()
		}
		util.HttpServing = false
		diagnostic.Finish()
		logging.LogInfof("exited kernel")
		os.Exit(logging.ExitCodeOk)
	}()
}

var customEmojis = sync.Map{}

func AddCustomEmoji(emojiName, imgSrc string) {
	customEmojis.Store(emojiName, imgSrc)
}

func ClearCustomEmojis() {
	customEmojis.Clear()
}

func NewLute() (ret *lute.Lute) {
	confEditorSnapshot := Conf.LoadEditor()

	ret = util.NewLute()
	ret.SetCodeSyntaxHighlightLineNum(confEditorSnapshot.CodeSyntaxHighlightLineNum)
	ret.SetChineseParagraphBeginningSpace(Conf.Export.Load().ParagraphBeginningSpace)
	ret.SetProtyleMarkNetImg(confEditorSnapshot.DisplayNetImgMark)
	ret.SetSpellcheck(confEditorSnapshot.Spellcheck)

	customEmojiMap := map[string]string{}
	customEmojis.Range(func(key, value any) bool {
		customEmojiMap[key.(string)] = value.(string)
		return true
	})
	ret.PutEmojis(customEmojiMap)
	return
}

func enableLuteInlineSyntax(luteEngine *lute.Lute) {
	luteEngine.SetInlineAsterisk(true)
	luteEngine.SetInlineUnderscore(true)
	luteEngine.SetSup(true)
	luteEngine.SetSub(true)
	luteEngine.SetTag(true)
	luteEngine.SetInlineMath(true)
	luteEngine.SetGFMStrikethrough(true)
}

func (conf *AppConf) Save() {
	if util.ReadOnly {
		return
	}

	conf.m.Lock()
	defer conf.m.Unlock()

	conf.saveLocked()
}

// SaveGraphQueryConf 仅在查询携带的图配置变化时更新并保存，比较、赋值和序列化共用配置锁。
func (appConf *AppConf) SaveGraphQueryConf(global *conf.GlobalGraph, local *conf.LocalGraph) {
	mutate := func(graph *conf.Graph) bool {
		changed := false
		if global != nil && !reflect.DeepEqual(graph.Global, global) {
			graph.Global = cloneConfSection(global)
			changed = true
		}
		if local != nil && !reflect.DeepEqual(graph.Local, local) {
			graph.Local = cloneConfSection(local)
			changed = true
		}
		return changed
	}
	if appConf == Conf {
		UpdateGraphConf(mutate)
		return
	}
	spec := newSectionSpecFor(appConf, "graph", &appConf.Graph, conf.NormalizeGraph)
	spec.WriteLock.Lock()
	defer spec.WriteLock.Unlock()
	next := cloneConfSection(spec.Load())
	if mutate(next) {
		_, _ = applySectionLocked(spec, next)
	}
}

func (conf *AppConf) saveLocked() {
	applyConfRuntime(conf)
	newData, err := conf.marshalForSave()
	if err != nil {
		logging.LogErrorf("marshal conf failed: %s", err)
		return
	}
	recordPersistedConf(newData)
	confPath := filepath.Join(util.ConfDir, "conf.json")
	oldData, err := filelock.ReadFile(confPath)
	if err == nil && bytes.Equal(newData, oldData) {
		recordPersistedConf(oldData)
		return
	}
	conf.save0(newData)
}

// marshalForSave 生成持久化副本，调用方持有配置锁，凭据仅在副本中加密。
func (conf *AppConf) marshalForSave() ([]byte, error) {
	plainData, err := gulu.JSON.MarshalJSON(conf)
	if err != nil {
		return nil, err
	}
	snapshot := NewAppConf()
	if err = gulu.JSON.UnmarshalJSON(plainData, snapshot); err != nil {
		return nil, err
	}
	if snapshot.AI.Load() != nil {
		snapshot.AI.Load().ClearChatGPTAccountIDs()
		snapshot.AI.Load().EncryptAPIKeys()
	}
	if snapshot.OIDC != nil {
		snapshot.OIDC.EncryptClientSecret()
	}
	if snapshot.Secrets.Load() != nil {
		snapshot.Secrets.Load().Encrypt()
	}
	// safeMode 是纯运行时状态（由 --safe-mode 注入），不随 conf.json 持久化，避免跨启动残留。
	if snapshot.System.Load() != nil {
		snapshot.System.Load().SafeMode = false
		// 更新通道由用户目录下的全局配置持久化，不写入工作空间配置。
		snapshot.System.Load().UpdateChannel = ""
	}

	return gulu.JSON.MarshalIndentJSON(snapshot, "", "  ")
}

func (conf *AppConf) save0(data []byte) {
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if err := filelock.WriteFile(confPath, data); err != nil {
		logging.LogErrorf("write conf [%s] failed: %s", confPath, err)
		util.ReportFileSysFatalError(err)
		return
	}
	recordPersistedConf(data)
}

func (conf *AppConf) Close() {
	conf.Save()
}

func (conf *AppConf) Box(boxID string) *Box {
	for _, box := range conf.GetOpenedBoxes() {
		if box.ID == boxID {
			return box
		}
	}
	return nil
}

func (conf *AppConf) GetBox(boxID string) *Box {
	for _, box := range conf.GetBoxes() {
		if box.ID == boxID {
			return box
		}
	}
	return nil
}

func (conf *AppConf) BoxNames(boxIDs []string) (ret map[string]string) {
	ret = map[string]string{}

	boxes := conf.GetOpenedBoxes()
	for _, boxID := range boxIDs {
		for _, box := range boxes {
			if box.ID == boxID {
				ret[boxID] = box.Name
				break
			}
		}
	}
	return
}

func (conf *AppConf) GetBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		id := notebook.ID
		name := notebook.Name
		closed := notebook.Closed
		encrypted := IsEncryptedBox(id) // 使用 IsEncryptedBox 统一判定（含 backup fallback）
		box := &Box{ID: id, Name: name, Closed: closed, Encrypted: encrypted}
		ret = append(ret, box)
	}
	return
}

func (conf *AppConf) GetOpenedBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		if !notebook.Closed {
			ret = append(ret, notebook)
		}
	}
	return
}

func (conf *AppConf) GetClosedBoxes() (ret []*Box) {
	ret = []*Box{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	for _, notebook := range notebooks {
		if notebook.Closed {
			ret = append(ret, notebook)
		}
	}
	return
}

func (conf *AppConf) Language(num int) (ret string) {
	ret = conf.language(num)
	ret = strings.ReplaceAll(ret, "${accountServer}", util.GetCloudAccountServer())
	return
}

func (conf *AppConf) language(num int) (ret string) {
	ret = util.Langs[conf.Lang][num]
	if "" != ret {
		return
	}
	ret = util.Langs["en"][num]
	return
}

func InitBoxes() {
	cleanupInterruptedCheckout()
	blockCount := treenode.CountBlocks()
	initialized := 0 < blockCount
	for _, box := range Conf.GetOpenedBoxes() {
		if _, err := EnsureBoxDoc(box.ID); nil != err {
			logging.LogErrorf("ensure box document [%s] failed: %s", box.ID, err)
		}
		box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间

		if !initialized || hasDocumentSourceRecovery(box.ID) {
			indexBox(box.ID)
		}
	}

	recoverOpenedDocumentMetadata()
	recoverDocHPaths()
	logging.LogInfof("tree/block count [%d/%d]", treenode.CountTrees(), blockCount)
}

func IsSubscriber() bool {
	u := Conf.GetUser()
	return nil != u && (-1 == u.UserSiYuanProExpireTime || 0 < u.UserSiYuanProExpireTime) && 0 == u.UserSiYuanSubscriptionStatus
}

func IsPaidUser() bool {
	if IsSubscriber() {
		return true
	}

	u := Conf.GetUser()
	if nil == u {
		return false
	}
	return 1 == u.UserSiYuanOneTimePayStatus
}

const (
	MaskedUserData       = ""
	MaskedAccessAuthCode = "*******"
)

// GetMaskedConf 获取脱敏后的 Conf
func GetMaskedConf() (ret *AppConf, err error) {
	// 序列化时持锁，避免与 loadThemes/LoadIcons 等写操作并发导致 slice 在编码过程中被改写而 panic https://github.com/siyuan-note/siyuan/issues/16978
	Conf.m.Lock()
	data, err := gulu.JSON.MarshalJSON(Conf)
	Conf.m.Unlock()
	if err != nil {
		logging.LogErrorf("marshal conf failed: %s", err)
		return
	}
	ret = &AppConf{}
	if err = gulu.JSON.UnmarshalJSON(data, ret); err != nil {
		logging.LogErrorf("unmarshal conf failed: %s", err)
		return
	}

	ret.UserData = MaskedUserData
	ret.MCPOAuth = ""
	ret.CookieKey = ""
	if "" != ret.AccessAuthCode {
		ret.AccessAuthCode = MaskedAccessAuthCode
	}
	return
}

// UpdateServerAddrs 更新当前可用的本地服务器地址，返回地址是否发生变化。
func UpdateServerAddrs(serverAddrs []string) bool {
	if nil == Conf {
		return false
	}
	Conf.m.Lock()
	defer Conf.m.Unlock()
	if reflect.DeepEqual(Conf.ServerAddrs, serverAddrs) {
		return false
	}
	Conf.ServerAddrs = append([]string(nil), serverAddrs...)
	return true
}

// HideConfSecret 隐藏设置中的秘密信息
// REF: https://github.com/siyuan-note/siyuan/issues/11364
func HideConfSecret(c *AppConf) {
	c.AI.Store(&conf.AI{})
	c.OIDC = &conf.OIDC{}
	c.MCPOAuth = ""
	c.CookieKey = ""
	c.Api.Store(&conf.API{})
	if nil != c.Export.Load() {
		c.Export.Load().PandocBin = ""
	}
	c.Flashcard.Store(&conf.Flashcard{})
	c.ServerAddrs = []string{}
	c.Publish.Store(&conf.Publish{})
	c.Repo.Store(&conf.Repo{})
	c.Sync.Store(&conf.Sync{})
	c.Secrets.Store(&conf.Secrets{})
	c.Variables.Store(&conf.Variables{})
	if nil != c.NotebookCrypto {
		enabled := c.NotebookCrypto.Enabled && notebookCryptoConfigurationComplete(c.NotebookCrypto)
		c.NotebookCrypto = &conf.NotebookCrypto{
			Enabled:         enabled,
			AutoLockMinutes: c.NotebookCrypto.AutoLockMinutes,
		}
	}
	c.System.Load().AppDir = ""
	c.System.Load().ConfDir = ""
	c.System.Load().DataDir = ""
	c.System.Load().HomeDir = ""
	c.System.Load().WorkspaceDir = ""
	c.System.Load().Name = ""
	c.System.Load().NetworkProxy = &conf.NetworkProxy{}
}

// HideBoxConfSecret 隐藏笔记本配置中的密钥材料。
func HideBoxConfSecret(c *conf.BoxConf) {
	if nil != c {
		c.BoxCrypt = nil
		c.DocCreateTarget, c.RefCreateTarget, c.DailyNoteTarget = nil, nil, nil
	}
}

func clearPortJSON() {
	pid := fmt.Sprintf("%d", os.Getpid())
	portJSON := filepath.Join(util.HomeDir, ".config", "siyuan", "port.json")
	pidPorts := map[string]string{}
	var data []byte
	var err error

	if gulu.File.IsExist(portJSON) {
		data, err = os.ReadFile(portJSON)
		if err != nil {
			logging.LogWarnf("read port.json failed: %s", err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, &pidPorts); err != nil {
				logging.LogWarnf("unmarshal port.json failed: %s", err)
			}
		}
	}

	delete(pidPorts, pid)
	if data, err = gulu.JSON.MarshalIndentJSON(pidPorts, "", "  "); err != nil {
		logging.LogWarnf("marshal port.json failed: %s", err)
	} else {
		if err = os.WriteFile(portJSON, data, 0644); err != nil {
			logging.LogWarnf("write port.json failed: %s", err)
		}
	}
}

func clearCorruptedNotebooks() {
	// 数据同步时展开文档树操作可能导致数据丢失 https://github.com/siyuan-note/siyuan/issues/7129

	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return
	}
	for _, dir := range dirs {
		if util.IsReservedFilename(dir.Name()) {
			continue
		}

		if !dir.IsDir() {
			continue
		}

		if !ast.IsNodeIDPattern(dir.Name()) {
			continue
		}

		boxDirPath := filepath.Join(util.DataDir, dir.Name())
		boxConfPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
		if !filelock.IsExist(boxConfPath) {
			logging.LogWarnf("found a corrupted box [%s]", boxDirPath)
			continue
		}
	}
}

func clearWorkspaceTemp(preserveInstallPkgPath string) {
	heif.ClearMemoryCache("")
	LivePhotoPreviews.Clear("")
	os.RemoveAll(filepath.Join(util.TempDir, "assets-cache"))
	os.RemoveAll(filepath.Join(util.TempDir, "bazaar"))
	os.RemoveAll(filepath.Join(util.TempDir, "export"))
	os.RemoveAll(filepath.Join(util.TempDir, "import"))
	os.RemoveAll(filepath.Join(util.TempDir, "convert"))
	os.RemoveAll(filepath.Join(util.TempDir, "pandoc"))
	os.RemoveAll(filepath.Join(util.TempDir, "repo"))
	ClearRichClipboard()
	os.RemoveAll(filepath.Join(util.TempDir, "os"))
	os.RemoveAll(filepath.Join(util.TempDir, "base64"))
	os.RemoveAll(filepath.Join(util.TempDir, "ai"))

	clearOldInstallPackages(preserveInstallPkgPath)

	tmps, err := filepath.Glob(filepath.Join(util.TempDir, "*.tmp"))
	if err != nil {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); err != nil {
			logging.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			logging.LogInfof("removed temp file [%s]", tmp)
		}
	}

	tmps, err = filepath.Glob(filepath.Join(util.DataDir, ".siyuan", "*.tmp"))
	if err != nil {
		logging.LogErrorf("glob temp files failed: %s", err)
	}
	for _, tmp := range tmps {
		if err = os.RemoveAll(tmp); err != nil {
			logging.LogErrorf("remove temp file [%s] failed: %s", tmp, err)
		} else {
			logging.LogInfof("removed temp file [%s]", tmp)
		}
	}

	// 老版本遗留文件清理
	os.RemoveAll(filepath.Join(util.DataDir, "assets", ".siyuan", "assets.json"))
	os.RemoveAll(filepath.Join(util.DataDir, ".siyuan", "history"))
	os.RemoveAll(filepath.Join(util.WorkspaceDir, "backup"))
	os.RemoveAll(filepath.Join(util.WorkspaceDir, "sync"))
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree.msgpack")) // v2.7.2 前旧版的块树数据
	os.RemoveAll(filepath.Join(util.DataDir, "%"))                 // v3.0.6 生成的错误历史文件夹
	os.RemoveAll(filepath.Join(util.TempDir, "blocktree"))         // v3.1.0 前旧版的块树数据

	// v3.7.0-dev 开发版遗留文件清理
	os.RemoveAll(filepath.Join(util.TempDir, "queue.wal"))
	os.RemoveAll(filepath.Join(util.TempDir, "queue.wal.lock"))
	os.RemoveAll(filepath.Join(util.DataDir, "storage", "ai", "agent", "todos"))
	os.RemoveAll(filepath.Join(util.DataDir, "storage", "ai", "agent", "operations", "image"))

	logging.LogInfof("cleared workspace temp")
}

func closeUserGuide() {
	defer logging.Recover()

	dirs, err := os.ReadDir(util.DataDir)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
		return
	}

	for _, dir := range dirs {
		if !IsUserGuide(dir.Name()) {
			continue
		}

		boxID := dir.Name()
		boxDirPath := filepath.Join(util.DataDir, boxID)
		boxConf := conf.NewBoxConf()
		boxConfPath := filepath.Join(boxDirPath, ".siyuan", "conf.json")
		if !filelock.IsExist(boxConfPath) {
			logging.LogWarnf("found a corrupted user guide box [%s]", boxDirPath)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}

		data, readErr := filelock.ReadFile(boxConfPath)
		if nil != readErr {
			logging.LogErrorf("read box conf [%s] failed: %s", boxConfPath, readErr)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}
		if readErr = gulu.JSON.UnmarshalJSON(data, boxConf); nil != readErr {
			logging.LogErrorf("parse box conf [%s] failed: %s", boxConfPath, readErr)
			if removeErr := filelock.Remove(boxDirPath); nil != removeErr {
				logging.LogErrorf("remove corrupted user guide box [%s] failed: %s", boxDirPath, removeErr)
			} else {
				logging.LogInfof("removed corrupted user guide box [%s]", boxDirPath)
			}
			continue
		}

		if boxConf.Closed {
			continue
		}

		msgId := util.PushMsg(Conf.language(233), 30000)

		unindex(boxID)

		sql.FlushQueue()

		if removeErr := RemoveBox(boxID); nil == removeErr {
			evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{
				"box": boxID,
			}
			util.PushEvent(evt)
		} else {
			logging.LogErrorf("close user guide box [%s] failed: %s", boxID, removeErr)
			util.PushClearMsg(msgId)
			continue
		}

		util.PushClearMsg(msgId)
		logging.LogInfof("closed user guide box [%s]", boxID)
	}
}

// NotebookCryptoEnabled 返回加密笔记本功能是否处于可用的启用状态（线程安全）。
func NotebookCryptoEnabled() bool {
	Conf.m.RLock()
	defer Conf.m.RUnlock()
	if nil == Conf.NotebookCrypto {
		return false
	}
	notebookCrypto := *Conf.NotebookCrypto
	return notebookCrypto.Enabled && notebookCryptoConfigurationComplete(&notebookCrypto)
}
