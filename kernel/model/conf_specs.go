package model

import (
	"reflect"
	"sync/atomic"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 注册工厂只构建所需配置段的规则，始终绑定当前工作空间，并隔离每次提交的诊断状态。
var confSectionSpecFactories = map[string]func() registeredSection{
	"appearance": func() registeredSection { return appearanceSectionSpec(false) },
	"fileTree": func() registeredSection {
		return newSectionSpec("fileTree", &Conf.FileTree, conf.NormalizeFileTree, fileTreeReactions()...)
	},
	"tag":    func() registeredSection { return tagSectionSpec() },
	"editor": func() registeredSection { return editorSectionSpec() },
	"export": func() registeredSection {
		return newSectionSpec("export", &Conf.Export, conf.NormalizeExport, exportReactions()...)
	},
	"graph":    func() registeredSection { return graphSectionSpec() },
	"uiLayout": func() registeredSection { return newSectionSpec("uiLayout", &Conf.UILayout, conf.NormalizeUILayout) },
	"system":   func() registeredSection { return systemSectionSpec() },
	"keymap":   func() registeredSection { return newSectionSpec("keymap", &Conf.Keymap, conf.NormalizeKeymap) },
	"sync":     func() registeredSection { return syncSectionSpec() },
	"search": func() registeredSection {
		return newSectionSpec("search", &Conf.Search, conf.NormalizeSearch, searchReactions()...)
	},
	"flashcard":  func() registeredSection { return flashcardSectionSpec() },
	"ai":         func() registeredSection { return newSectionSpec("ai", &Conf.AI, conf.NormalizeAI) },
	"ocr":        func() registeredSection { return ocrSectionSpec() },
	"secrets":    func() registeredSection { return newSectionSpec("secrets", &Conf.Secrets, conf.NormalizeSecrets) },
	"variables":  func() registeredSection { return newSectionSpec("variables", &Conf.Variables, conf.NormalizeVariables) },
	"bazaar":     func() registeredSection { return bazaarSectionSpec() },
	"stat":       func() registeredSection { return statSectionSpec() },
	"api":        func() registeredSection { return apiSectionSpec() },
	"repo":       func() registeredSection { return repoSectionSpec() },
	"publish":    func() registeredSection { return publishSectionSpec() },
	"onboarding": func() registeredSection { return onboardingSectionSpec() },
	"snippet": func() registeredSection {
		return newSectionSpec("snippet", &Conf.Snippet, conf.NormalizeSnippet, Reaction[*conf.Snpt]{Name: "reload-snippet", Changed: func(old, next *conf.Snpt) bool { return true }, Apply: func(old, next *conf.Snpt) { PushReloadSnippet(next) }})
	},
}

func tagSectionSpec() *SectionSpec[*conf.Tag] {
	return newSectionSpec("tag", &Conf.Tag, conf.NormalizeTag)
}

func editorSectionSpec() *SectionSpec[*conf.Editor] {
	return newSectionSpec("editor", &Conf.Editor, conf.NormalizeEditor, editorReactions()...)
}

func graphSectionSpec() *SectionSpec[*conf.Graph] {
	return newSectionSpec("graph", &Conf.Graph, conf.NormalizeGraph)
}

func systemSectionSpec() *SectionSpec[*conf.System] {
	return newSectionSpec("system", &Conf.System, conf.NormalizeSystem, systemReactions()...)
}

func bazaarSectionSpec() *SectionSpec[*conf.Bazaar] {
	return newSectionSpec("bazaar", &Conf.Bazaar, conf.NormalizeBazaar, bazaarReactions()...)
}

func statSectionSpec() *SectionSpec[*conf.Stat] {
	return newSectionSpec("stat", &Conf.Stat, conf.NormalizeStat)
}

func apiSectionSpec() *SectionSpec[*conf.API] {
	return newSectionSpec("api", &Conf.Api, conf.NormalizeAPI)
}

func repoSectionSpec() *SectionSpec[*conf.Repo] {
	return newSectionSpec("repo", &Conf.Repo, conf.NormalizeRepo)
}

func onboardingSectionSpec() *SectionSpec[*conf.Onboarding] {
	return newSectionSpec("onboarding", &Conf.Onboarding, conf.NormalizeOnboarding)
}

// syncSectionSpec 在连接信息改变或同步关闭时清除当前来源的索引读取提示。
func syncSectionSpec() *SectionSpec[*conf.Sync] {
	return newSectionSpec("sync", &Conf.Sync, conf.NormalizeSync, Reaction[*conf.Sync]{
		Name: "cloud-index-notice", Changed: func(old, next *conf.Sync) bool {
			return !next.Enabled || old.Provider != next.Provider || old.CloudName != next.CloudName ||
				(old.Provider == conf.ProviderS3 && !reflect.DeepEqual(old.S3, next.S3)) ||
				(old.Provider == conf.ProviderWebDAV && !reflect.DeepEqual(old.WebDAV, next.WebDAV)) ||
				(old.Provider == conf.ProviderLocal && !reflect.DeepEqual(old.Local, next.Local))
		}, Apply: func(old, next *conf.Sync) { syncIndexListNotice.reset(util.PushClearMsg) },
	})
}

var BazaarPetalStateRevision atomic.Uint64

func bazaarReactions() []Reaction[*conf.Bazaar] {
	return []Reaction[*conf.Bazaar]{{Name: "petal-state", Changed: func(old, next *conf.Bazaar) bool {
		return petalsEnabled(old) != petalsEnabled(next) || old.PetalDisabled != next.PetalDisabled
	}, Apply: func(old, next *conf.Bazaar) {
		enabled := petalsEnabled(next)
		if petalsEnabled(old) != enabled {
			if enabled && OnKernelPluginsStart != nil {
				OnKernelPluginsStart()
			}
			if !enabled && OnKernelPluginsStop != nil {
				OnKernelPluginsStop()
			}
		}
		PushReloadAllEnabledPlugins(enabled, next.PetalDisabled, BazaarPetalStateRevision.Add(1), true)
	}}}
}

// ApplyAppearanceSetting 在同一段写锁内提交设置并刷新磁盘资源，内部偏好更新仍按资源字段变化触发反应。
func ApplyAppearanceSetting(value *conf.Appearance) ([]Issue, error) {
	return Apply(appearanceSectionSpec(true), value)
}

func appearanceSectionSpec(refreshResources bool) *SectionSpec[*conf.Appearance] {
	spec := newSectionSpec("appearance", &Conf.Appearance, func(value *conf.Appearance) *conf.Appearance {
		return conf.NormalizeAppearance(value, util.IsMobileContainer())
	}, Reaction[*conf.Appearance]{Name: "appearance-resources", Changed: func(old, next *conf.Appearance) bool {
		return refreshResources || old.Lang != next.Lang || old.Icon != next.Icon || old.ThemeLight != next.ThemeLight ||
			old.ThemeDark != next.ThemeDark || old.Mode != next.Mode || old.ModeOS != next.ModeOS
	}, Apply: func(old, next *conf.Appearance) {
		InitAppearance()
		WatchThemes()
	}}, Reaction[*conf.Appearance]{Name: "appearance-notify", Changed: func(old, next *conf.Appearance) bool {
		return true
	}, Apply: func(old, next *conf.Appearance) {
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance.Load())
	}})
	spec.Store = func(value *conf.Appearance) {
		Conf.Appearance.Store(value)
		Conf.Lang = util.LangToBCP47(value.Lang)
		util.Lang = Conf.Lang
	}
	return spec
}

func systemReactions() []Reaction[*conf.System] {
	return []Reaction[*conf.System]{{Name: "network-proxy", Changed: func(old, next *conf.System) bool {
		return old.NetworkProxy == nil || old.NetworkProxy.String() != next.NetworkProxy.String() ||
			old.NetworkProxy.IsSystem() != next.NetworkProxy.IsSystem()
	}, Apply: func(old, next *conf.System) {
		util.SetNetworkProxy(next.NetworkProxy.String(), next.NetworkProxy.IsSystem())
	}}}
}

func flashcardSectionSpec() *SectionSpec[*conf.Flashcard] {
	var warning string
	spec := newSectionSpec("flashcard", &Conf.Flashcard, func(value *conf.Flashcard) *conf.Flashcard {
		value, warning = conf.NormalizeFlashcard(value)
		return value
	})
	spec.Validate = func(value *conf.Flashcard) []Issue {
		if warning != "" {
			return []Issue{{Field: "flashcard.weights", Severity: "warning", Message: warning}}
		}
		return nil
	}
	return spec
}

// publishSectionSpec 在所有写入路径校验启用的认证账户，失败时保留现有凭据。
func publishSectionSpec() *SectionSpec[*conf.Publish] {
	spec := newSectionSpec("publish", &Conf.Publish, conf.NormalizePublish)
	spec.Validate = func(value *conf.Publish) []Issue {
		if !value.Auth.Enable {
			return nil
		}
		usernames := map[string]bool{}
		for _, account := range value.Auth.Accounts {
			key := 0
			if account == nil || account.Username == "" {
				key = 361
			} else if usernames[account.Username] {
				key = 362
			} else if len(account.Password) < 8 {
				key = 363
			}
			if key != 0 {
				return []Issue{{Field: "publish.auth.accounts", Severity: "error", Message: Conf.Language(key)}}
			}
			usernames[account.Username] = true
		}
		return nil
	}
	return spec
}

func editorReactions() []Reaction[*conf.Editor] {
	return []Reaction[*conf.Editor]{
		{Name: "history-interval", Changed: func(old, next *conf.Editor) bool { return old.GenerateHistoryInterval != next.GenerateHistoryInterval }, Apply: func(old, next *conf.Editor) { GenerateFileHistory(); ChangeHistoryTick(next.GenerateHistoryInterval) }},
		{Name: "virtual-block-ref", Changed: func(old, next *conf.Editor) bool {
			return old.VirtualBlockRef != next.VirtualBlockRef || old.VirtualBlockRefInclude != next.VirtualBlockRefInclude || old.VirtualBlockRefExclude != next.VirtualBlockRefExclude
		}, Apply: func(old, next *conf.Editor) { ResetVirtualBlockRefCache() }},
		{Name: "readonly", Changed: func(old, next *conf.Editor) bool { return old.ReadOnly != next.ReadOnly }, Apply: func(old, next *conf.Editor) {
			util.BroadcastByType("protyle", "readonly", 0, "", next.ReadOnly)
			util.BroadcastByType("main", "readonly", 0, "", next.ReadOnly)
		}},
	}
}

func fileTreeReactions() []Reaction[*conf.FileTree] {
	return []Reaction[*conf.FileTree]{
		{Name: "sort", Changed: func(old, next *conf.FileTree) bool { return old.Sort != next.Sort }, Apply: func(old, next *conf.FileTree) { PushDocSortModeChanged("global", "", "", "/", &next.Sort) }},
		{Name: "box-document", Changed: func(old, next *conf.FileTree) bool {
			return old.BoxDocEnabled != next.BoxDocEnabled
		}, Apply: func(old, next *conf.FileTree) { RefreshBoxDocFeature() }},
	}
}

func searchReactions() []Reaction[*conf.Search] {
	return []Reaction[*conf.Search]{
		{Name: "index", Changed: func(old, next *conf.Search) bool {
			return old.CaseSensitive != next.CaseSensitive || old.HanSensitiveVal() != next.HanSensitiveVal() || old.IndexAssetPath != next.IndexAssetPath
		}, Apply: func(old, next *conf.Search) {
			if old.IndexAssetPath == next.IndexAssetPath {
				task.AppendTask(task.DatabaseIndexFTS, ReindexFTS)
			} else {
				FullReindex(false)
			}
		}},
		{Name: "virtual-block-ref", Changed: func(old, next *conf.Search) bool {
			return old.VirtualRefName != next.VirtualRefName || old.VirtualRefAlias != next.VirtualRefAlias || old.VirtualRefAnchor != next.VirtualRefAnchor || old.VirtualRefDoc != next.VirtualRefDoc
		}, Apply: func(old, next *conf.Search) { ResetVirtualBlockRefCache() }},
	}
}

func exportReactions() []Reaction[*conf.Export] {
	return []Reaction[*conf.Export]{
		{Name: "pandoc", Changed: func(old, next *conf.Export) bool { return old.PandocBin != next.PandocBin }, Apply: func(old, next *conf.Export) { util.InitPandoc(next.PandocBin) }},
	}
}
