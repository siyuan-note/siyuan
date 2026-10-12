package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 配置更新按内核接受顺序提交，旧接口与字段更新共用互斥，通知只携带配置域和顺序号。
var settingMutationMu sync.RWMutex
var settingNamespaceLocks sync.Map
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

// 批量操作独占设置闸门，单段写入只串行化同一命名空间。
func lockSetting(namespace string) func() {
	if namespace == "*" {
		settingMutationMu.Lock()
		return settingMutationMu.Unlock
	}
	settingMutationMu.RLock()
	value, _ := settingNamespaceLocks.LoadOrStore(namespace, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return func() { mu.Unlock(); settingMutationMu.RUnlock() }
}

func serializeSetting[Request, Data any](namespace string,
	apply func(*gin.Context, Request) apicontract.Response[Data]) func(*gin.Context, Request) apicontract.Response[Data] {
	return func(c *gin.Context, request Request) apicontract.Response[Data] {
		release := lockSetting(namespace)
		defer release()
		previous := model.ConfNamespaceRevision(namespace)
		response := apply(c, request)
		if response.Code() == 0 && previous == model.ConfNamespaceRevision(namespace) {
			model.NotifyConfChanged(namespace)
		}
		return response
	}
}

// migrateDecisionSettingPatch 在合并前识别旧客户端的平铺字段，避免被现有 profiles 遮蔽。
func migrateDecisionSettingPatch(patch []byte) ([]byte, error) {
	var ai map[string]json.RawMessage
	if err := json.Unmarshal(patch, &ai); err != nil {
		return nil, err
	}
	var decision map[string]json.RawMessage
	if json.Unmarshal(ai["decision"], &decision) != nil || decision == nil {
		return patch, nil
	}
	if _, modern := decision["profiles"]; modern {
		return patch, nil
	}
	profile := map[string]json.RawMessage{}
	for _, field := range []string{"endpoint", "apiKey", "name", "timeout"} {
		if value, exists := decision[field]; exists {
			// 旧设置字段允许 null，保持清空密钥和恢复默认参数的既有语义。
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				value = json.RawMessage(`""`)
				if field == "timeout" {
					value = json.RawMessage(`0`)
				}
			}
			profile[field] = value
			delete(decision, field)
		}
	}
	if len(profile) == 0 {
		return patch, nil
	}
	profiles, err := json.Marshal(map[string]map[string]json.RawMessage{"typesafe": profile})
	if err != nil {
		return nil, err
	}
	decision["profiles"] = profiles
	ai["decision"], err = json.Marshal(decision)
	if err != nil {
		return nil, err
	}
	return json.Marshal(ai)
}

func applySettingPatch[Request, Data any](c *gin.Context, patch []byte, namespace string,
	endpoint apicontract.Endpoint[Request, Data], apply func(*gin.Context, Request) apicontract.Response[Data]) apicontract.Response[*apicontract.SettingPatchData] {
	merged, err := model.ConfSectionPatchJSON(namespace, patch)
	if err != nil {
		return apicontract.Failure[*apicontract.SettingPatchData](-1, err.Error())
	}
	if namespace == "keymap" {
		merged, err = json.Marshal(struct {
			Data json.RawMessage `json:"data"`
		}{merged})
		if err != nil {
			return apicontract.Failure[*apicontract.SettingPatchData](-1, err.Error())
		}
	}
	request, err := endpoint.Decode(bytes.NewReader(merged))
	if err != nil {
		return apicontract.Failure[*apicontract.SettingPatchData](-1, err.Error())
	}
	response := apply(c, request)
	if response.Code() != 0 {
		return apicontract.PatchSetting.FailureWithData(response.Code(), response.Message(), settingPatchDiagnostics(c))
	}
	return apicontract.Success((*apicontract.SettingPatchData)(nil))
}

var patchSetting = contractHandler(apicontract.PatchSetting, func(c *gin.Context, request apicontract.PatchSettingRequest) apicontract.Response[*apicontract.SettingPatchData] {
	release := lockSetting(request.Namespace())
	defer release()
	previous := model.ConfNamespaceRevision(request.Namespace())
	patch := request.PatchJSON()
	var response apicontract.Response[*apicontract.SettingPatchData]
	switch request.Namespace() {
	case "editor":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetEditor, applyEditorSetting)
	case "export":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetExport, applyExportSetting)
	case "fileTree":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetFiletree, applyFiletreeSetting)
	case "search":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetSearch, applySearchSetting)
	case "appearance":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetAppearance, applyAppearanceSetting)
	case "flashcard":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetFlashcard, applyFlashcardSetting)
	case "secrets":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetSecrets, applySecretsSetting)
	case "variables":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetVariables, applyVariablesSetting)
	case "keymap":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetKeymap, applyKeymapSetting)
	case "ai":
		if util.IsDisabledFeature("ai") {
			return apicontract.Failure[*apicontract.SettingPatchData](-1, util.I18nTerm(model.Conf.Lang, "agentCapabilitiesUnavailable"))
		}
		var err error
		patch, err = migrateDecisionSettingPatch(patch)
		if err != nil {
			return apicontract.Failure[*apicontract.SettingPatchData](-1, err.Error())
		}
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetAI, applyAISetting)
	case "ocr":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetOCRConfig, applyOCRSetting)
	case "bazaar":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetBazaar, applyBazaarSetting)
	case "publish":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetPublish, applyPublishSetting)
	case "snippet":
		response = applySettingPatch(c, patch, request.Namespace(), apicontract.SetConfSnippet, applySnippetSetting)
	case "system", "repo", "sync":
		var err error
		var issues []model.Issue
		if request.Namespace() == "sync" {
			issues, err = model.ApplySyncSettingPatch(patch)
		} else {
			issues, err = model.ApplyConfPatch(request.Namespace(), patch)
		}
		recordSettingIssues(c, issues)
		if err != nil {
			return apicontract.PatchSetting.FailureWithData(-1, err.Error(), settingPatchDiagnostics(c))
		}
		response = apicontract.Success((*apicontract.SettingPatchData)(nil))
	default:
		return apicontract.Failure[*apicontract.SettingPatchData](-1, fmt.Sprintf("unsupported settings namespace: %s", request.Namespace()))
	}
	if response.Code() == 0 && previous == model.ConfNamespaceRevision(request.Namespace()) {
		model.NotifyConfChanged(request.Namespace())
	}
	if response.Code() == 0 {
		return apicontract.Success(settingPatchDiagnostics(c))
	}
	return response
})

func recordSettingIssues(c *gin.Context, issues []model.Issue) {
	if c != nil && len(issues) > 0 {
		c.Set("settingIssues", issues)
	}
}

func settingPatchDiagnostics(c *gin.Context) *apicontract.SettingPatchData {
	if c == nil {
		return nil
	}
	value, ok := c.Get("settingIssues")
	if !ok {
		return nil
	}
	issues, ok := value.([]model.Issue)
	if !ok || len(issues) == 0 {
		return nil
	}
	data := &apicontract.SettingPatchData{Issues: make([]apicontract.SettingIssue, len(issues))}
	for i, issue := range issues {
		data.Issues[i] = apicontract.SettingIssue{Field: issue.Field, Severity: issue.Severity, Message: issue.Message}
	}
	return data
}
