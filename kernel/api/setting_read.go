package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// visibleConf 返回按请求角色和宿主环境裁剪后的配置副本。
// 所有读取配置的端点共用这一套可见性规则，避免各端点自行裁剪导致凭据或路径泄露。
func visibleConf(c *gin.Context) (masked *model.AppConf, isPublish bool, err error) {
	masked, err = model.GetMaskedConf()
	if err != nil {
		return nil, false, err
	}
	if !masked.Sync.Load().Enabled || (0 == masked.Sync.Load().Provider && !model.IsSubscriber()) {
		masked.Sync.Load().Stat = model.Conf.Language(53)
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	role := model.GetGinContextRole(c)
	isPublish = model.IsReadOnlyRole(role)
	if isPublish {
		masked.ReadOnly = true
	}
	if !model.IsValidRole(role, []model.Role{model.RoleAdministrator}) {
		model.HideConfSecret(masked)
	}
	if model.IsReadOnlyRoleContext(c) {
		masked.UILayout.Store(&conf.UILayout{})
	}

	// 浏览器环境下不返回工作空间绝对路径，避免泄露用户名等敏感信息
	// 原生客户端（桌面 Electron、移动端）UA 以 "SiYuan/" 开头，照常返回真实路径
	// REF: https://github.com/siyuan-note/siyuan/issues/17410
	if util.IsBrowserRequest(c) {
		masked.System.Load().WorkspaceDir = ""
		masked.System.Load().AppDir = ""
		masked.System.Load().ConfDir = ""
		masked.System.Load().DataDir = ""
		masked.System.Load().HomeDir = ""
	}
	return masked, isPublish, nil
}

// sectionConfPayload 从完整配置的转换结果中取出单个配置段，返回 nil 表示命名空间不可读取。
// 复用 systemConfPayload 保证字段投影与 /api/system/getConf 完全一致。
func sectionConfPayload(value *apicontract.SystemAppConf, namespace string) *apicontract.SystemAppConf {
	section := &apicontract.SystemAppConf{}
	switch namespace {
	case "appearance":
		section.Appearance = value.Appearance
	case "fileTree":
		section.FileTree = value.FileTree
	case "tag":
		section.Tag = value.Tag
	case "editor":
		section.Editor = value.Editor
	case "export":
		section.Export = value.Export
	case "graph":
		section.Graph = value.Graph
	case "uiLayout":
		section.UILayout = value.UILayout
	case "keymap":
		section.Keymap = value.Keymap
	case "sync":
		section.Sync = value.Sync
	case "search":
		section.Search = value.Search
	case "flashcard":
		section.Flashcard = value.Flashcard
	case "ai":
		section.AI = value.AI
	case "ocr":
		section.OCR = value.OCR
	case "secrets":
		section.Secrets = value.Secrets
	case "variables":
		section.Variables = value.Variables
	case "bazaar":
		section.Bazaar = value.Bazaar
	case "stat":
		section.Stat = value.Stat
	case "api":
		section.Api = value.Api
	case "repo":
		section.Repo = value.Repo
	case "publish":
		section.Publish = value.Publish
	case "onboarding":
		section.Onboarding = value.Onboarding
	case "snippet":
		section.Snippet = value.Snippet
	case "system":
		// 访问授权由 system 段落驱动，同时返回对应的顶层字段。
		section.System = value.System
		section.Api = value.Api
		section.OIDC = value.OIDC
		section.AccessAuthCode = value.AccessAuthCode
		section.ReadOnly = value.ReadOnly
	default:
		return nil
	}
	return section
}

var getSettingSection = contractHandler(apicontract.GetSettingSection, func(c *gin.Context, request apicontract.SettingGetSectionRequest) apicontract.Response[apicontract.SettingSectionData] {
	if _, ok := model.SectionSpecByNamespace(request.Namespace); !ok {
		return apicontract.Failure[apicontract.SettingSectionData](-1, "unsupported settings namespace: "+request.Namespace)
	}
	// 记录该段本次读取时的版本号再读取配置：版本号不大于该值的通知都已包含在本次响应中。
	revision := model.ConfNamespaceRevision(request.Namespace)
	masked, _, err := visibleConf(c)
	if err != nil {
		return apicontract.Failure[apicontract.SettingSectionData](-1, "get conf failed: "+err.Error())
	}
	full, err := systemConfPayload(masked)
	if err != nil {
		return apicontract.Failure[apicontract.SettingSectionData](-1, "get conf failed: "+err.Error())
	}
	section := sectionConfPayload(full, request.Namespace)
	if nil == section {
		return apicontract.Failure[apicontract.SettingSectionData](-1, "unsupported settings namespace: "+request.Namespace)
	}
	return apicontract.Success(apicontract.SettingSectionData{
		Namespace:    request.Namespace,
		Conf:         section,
		SettingTasks: activeSettingTasks(),
		Revision:     revision,
	})
})
