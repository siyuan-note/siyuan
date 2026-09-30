package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 配置更新按内核接受顺序提交，旧接口与字段更新共用互斥，通知只携带配置域和顺序号。
var settingMutationMu sync.Mutex
var settingRevision uint64
var settingTaskID atomic.Uint64
var settingTasksMu sync.Mutex
var settingTasks = map[string]apicontract.SettingTask{}
var settingTaskRevision uint64

func activeSettingTasks() *apicontract.SettingTaskState {
	settingTasksMu.Lock()
	defer settingTasksMu.Unlock()
	tasks := make([]apicontract.SettingTask, 0, len(settingTasks))
	for _, task := range settingTasks {
		tasks = append(tasks, task)
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].ID < tasks[j].ID })
	return &apicontract.SettingTaskState{Revision: settingTaskRevision, Tasks: tasks}
}

// 每个任务独立结束通知，避免一个任务结束时取消另一个任务的遮罩。
func beginSettingTask(messageKey string) func() {
	id := fmt.Sprint(settingTaskID.Add(1))
	message := util.I18nTerm(model.Conf.Lang, messageKey)
	notify := func(active bool) {
		settingTasksMu.Lock()
		settingTaskRevision++
		task := apicontract.SettingTask{ID: id, Active: active, Message: message, Revision: settingTaskRevision}
		if active {
			settingTasks[id] = task
		} else {
			delete(settingTasks, id)
		}
		util.BroadcastByType("main", "settingTask", 0, "", task)
		settingTasksMu.Unlock()
	}
	notify(true)
	return func() { notify(false) }
}

// 单项设置接口沿用原请求和返回值，成功后通知其他前端重新读取配置。
func additionalSettingNamespace(path string) string {
	switch path {
	case "/api/setting/setKeymap":
		return "keymap"
	case "/api/setting/setBazaar":
		return "bazaar"
	case "/api/setting/setPublish":
		return "publish"
	case "/api/system/importConf":
		return "*"
	case "/api/system/setAutoLaunch", "/api/system/setFollowSystemLockScreen",
		"/api/system/setDownloadInstallPkg", "/api/system/setUpdateChannel", "/api/system/setNetworkProxy",
		"/api/system/setAPIToken", "/api/system/setAccessAuthCode", "/api/system/setOIDC":
		return "system"
	}
	if strings.HasPrefix(path, "/api/sync/set") {
		return "sync"
	}
	if strings.HasPrefix(path, "/api/repo/set") {
		return "repo"
	}
	if strings.HasPrefix(path, "/api/sync/importSyncProvider") {
		return "sync"
	}
	return ""
}

func notifySettingChanged(namespace string) {
	settingRevision++
	util.BroadcastByType("main", "settingChanged", 0, "", struct {
		Namespace string `json:"namespace"`
		Revision  uint64 `json:"revision"`
	}{namespace, settingRevision})
}

func serializeSetting[Request, Data any](namespace string,
	apply func(*gin.Context, Request) apicontract.Response[Data]) func(*gin.Context, Request) apicontract.Response[Data] {
	return func(c *gin.Context, request Request) apicontract.Response[Data] {
		settingMutationMu.Lock()
		defer settingMutationMu.Unlock()
		response := apply(c, request)
		if response.Code() == 0 {
			notifySettingChanged(namespace)
		}
		return response
	}
}

func mergeSettingJSON(base, patch []byte) ([]byte, error) {
	var current, changes map[string]json.RawMessage
	if err := json.Unmarshal(base, &current); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(patch, &changes); err != nil {
		return nil, err
	}
	if current == nil {
		current = map[string]json.RawMessage{}
	}
	for key, value := range changes {
		if bytes.HasPrefix(bytes.TrimSpace(value), []byte("{")) && bytes.HasPrefix(bytes.TrimSpace(current[key]), []byte("{")) {
			merged, err := mergeSettingJSON(current[key], value)
			if err != nil {
				return nil, err
			}
			current[key] = merged
		} else {
			current[key] = value
		}
	}
	return json.Marshal(current)
}

func applySettingPatch[Request, Data, Config any](c *gin.Context, patch []byte, config Config,
	endpoint apicontract.Endpoint[Request, Data], apply func(*gin.Context, Request) apicontract.Response[Data]) apicontract.Response[apicontract.Null] {
	base, err := json.Marshal(config)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	merged, err := mergeSettingJSON(base, patch)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	request, err := endpoint.Decode(bytes.NewReader(merged))
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	response := apply(c, request)
	if response.Code() != 0 {
		return apicontract.Failure[apicontract.Null](response.Code(), response.Message())
	}
	return apicontract.Success(apicontract.Null{})
}

var patchSetting = contractHandler(apicontract.PatchSetting, func(c *gin.Context, request apicontract.PatchSettingRequest) apicontract.Response[apicontract.Null] {
	settingMutationMu.Lock()
	defer settingMutationMu.Unlock()
	patch := request.PatchJSON()
	var response apicontract.Response[apicontract.Null]
	switch request.Namespace() {
	case "editor":
		response = applySettingPatch(c, patch, model.Conf.Editor, apicontract.SetEditor, applyEditorSetting)
	case "export":
		response = applySettingPatch(c, patch, model.Conf.Export, apicontract.SetExport, applyExportSetting)
	case "fileTree":
		response = applySettingPatch(c, patch, model.Conf.FileTree, apicontract.SetFiletree, applyFiletreeSetting)
	case "search":
		response = applySettingPatch(c, patch, model.Conf.Search, apicontract.SetSearch, applySearchSetting)
	case "appearance":
		response = applySettingPatch(c, patch, model.Conf.Appearance, apicontract.SetAppearance, applyAppearanceSetting)
	case "flashcard":
		response = applySettingPatch(c, patch, model.Conf.Flashcard, apicontract.SetFlashcard, applyFlashcardSetting)
	case "secrets":
		response = applySettingPatch(c, patch, model.Conf.Secrets, apicontract.SetSecrets, applySecretsSetting)
	case "variables":
		response = applySettingPatch(c, patch, model.Conf.Variables, apicontract.SetVariables, applyVariablesSetting)
	case "keymap":
		response = applySettingPatch(c, append(append([]byte(`{"data":`), patch...), '}'),
			struct {
				Data *conf.Keymap `json:"data"`
			}{model.Conf.Keymap}, apicontract.SetKeymap, applyKeymapSetting)
	case "ai":
		if util.IsDisabledFeature("ai") {
			return apicontract.Failure[apicontract.Null](-1, util.I18nTerm(model.Conf.Lang, "agentCapabilitiesUnavailable"))
		}
		response = applySettingPatch(c, patch, model.Conf.AI, apicontract.SetAI, applyAISetting)
	default:
		return apicontract.Failure[apicontract.Null](-1, fmt.Sprintf("unsupported settings namespace: %s", request.Namespace()))
	}
	if response.Code() == 0 {
		notifySettingChanged(request.Namespace())
	}
	return response
})
