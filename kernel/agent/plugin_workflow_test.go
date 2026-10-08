// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupPluginWorkflow(t *testing.T) {
	t.Helper()
	origWorkspace, origData, origConfDir, origWorking, origTemp, origConf := util.WorkspaceDir, util.DataDir, util.ConfDir, util.WorkingDir, util.TempDir, kernelModel.Conf
	origReadOnly := util.ReadOnly
	util.WorkspaceDir = t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "conf")
	util.TempDir = filepath.Join(util.WorkspaceDir, "temp")
	var err error
	util.WorkingDir, err = filepath.Abs("../../app")
	if err != nil {
		t.Fatal(err)
	}
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	kernelModel.Conf.Bazaar = conf.NewBazaar()
	kernelModel.Conf.Bazaar.Trust = false
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.WorkingDir, util.TempDir, kernelModel.Conf = origWorkspace, origData, origConfDir, origWorking, origTemp, origConf
		util.ReadOnly = origReadOnly
		sessionLocks.Delete(testSessionID)
	})
	if _, err := SaveSession(marshalSession(t, map[string]any{"id": testSessionID, "title": "plugin fixture", "entries": []any{}})); err != nil {
		t.Fatal(err)
	}
}

func executePluginFixtureTool(t *testing.T, name string, args map[string]any, succeeds bool) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	result := executeTool(context.Background(), openai.ToolCall{ID: "fixture-call", Function: openai.FunctionCall{Name: name, Arguments: string(encoded)}}, testSessionID)
	if result.IsError == succeeds {
		t.Fatalf("%s expected success=%v: %+v", name, succeeds, result)
	}
	if !succeeds {
		return nil
	}
	var decoded map[string]any
	if err = json.Unmarshal([]byte(result.Text), &decoded); err != nil {
		t.Fatalf("expected structured %s result: %q", name, result.Text)
	}
	return decoded
}

func TestPluginWorkflowNativeProjectReplanAndRecovery(t *testing.T) {
	setupPluginWorkflow(t)
	taskID := choosePluginWorkflow(t, true)
	loadPluginWorkflowSkill(t)
	results, event := startPluginQuestion(t, context.Background(), pluginPlanArgs(taskID))
	answerPluginQuestion(t, results, event, "确定")
	ctx := pluginWorkflowContext(context.Background(), testSessionID)
	grant, err := util.RequirePluginDevelopment(ctx, "write")
	if err != nil {
		t.Fatal(err)
	}
	relRoot, err := filepath.Rel(util.WorkspaceDir, grant.SourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	relRoot = filepath.ToSlash(relRoot)
	unauthorized, _ := tools.FileTool.ContextHandler(context.Background(), map[string]any{"action": "write", "path": relRoot + "/index.js", "data": "forged", "ifAbsent": true, "_sessionID": testSessionID})
	if !unauthorized.IsError {
		t.Fatal("untrusted file tool created managed source")
	}
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "prepare_project", "taskId": taskID}, true)
	util.ReadOnly = true
	executePluginFixtureTool(t, "file", map[string]any{"action": "write", "path": relRoot + "/index.js", "data": "forbidden", "ifAbsent": true}, false)
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, "index.js")); !os.IsNotExist(err) {
		t.Fatal("read-only native mutation created source")
	}
	util.ReadOnly = false
	manifest := `{"name":"fixture-plugin","version":"0.1.0","minAppVersion":"3.0.0","frontends":["desktop"],"displayName":{"default":"Fixture"}}`
	executePluginFixtureTool(t, "file", map[string]any{"action": "write", "path": relRoot + "/plugin.json", "data": manifest, "ifAbsent": true}, true)
	source := "const value = 1;\n" + strings.Repeat("// filler\n", 240) + "module.exports = value;\n"
	executePluginFixtureTool(t, "file", map[string]any{"action": "write", "path": relRoot + "/index.js", "data": source, "ifAbsent": true}, true)
	page := executePluginFixtureTool(t, "file", map[string]any{"action": "read", "path": relRoot + "/index.js", "withMetadata": true, "limit": 200}, true)
	if page["truncated"] != true {
		t.Fatal("partial read claimed complete")
	}
	oldRevision := page["revision"].(string)
	executePluginFixtureTool(t, "file", map[string]any{"action": "edit", "path": relRoot + "/index.js", "expectedRevision": oldRevision, "edits": []any{map[string]any{"oldText": "value = 1", "newText": "value = 2"}}}, true)
	executePluginFixtureTool(t, "file", map[string]any{"action": "edit", "path": relRoot + "/index.js", "expectedRevision": oldRevision, "edits": []any{map[string]any{"oldText": "value = 2", "newText": "value = 3"}}}, false)
	status := executePluginFixtureTool(t, "bazaar", map[string]any{"action": "project_status", "taskId": taskID}, true)["project"].(map[string]any)
	sourceRevision := status["sourceRevision"].(string)
	artifact := executePluginFixtureTool(t, "bazaar", map[string]any{"action": "package_local", "taskId": taskID, "expectedSourceRevision": sourceRevision}, true)["project"].(map[string]any)
	archivePath := filepath.Join(util.WorkspaceDir, filepath.FromSlash(artifact["packagePath"].(string)))
	archiveBefore, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	if util.PluginProjectDigest(archiveBefore) != artifact["packageHash"] {
		t.Fatal("published archive differs from result hash")
	}
	// 取消候选方案保留原方案及开发副本的读取路径，不把旧源码变成孤立目录。
	changed := pluginPlanArgs(taskID)
	changed["proposal"] = "把按钮移到左侧。"
	results, event = startPluginQuestion(t, context.Background(), changed)
	answerPluginQuestion(t, results, event, "取消")
	status = executePluginFixtureTool(t, "bazaar", map[string]any{"action": "project_status", "taskId": taskID}, true)["project"].(map[string]any)
	if status["planMismatch"] == true || status["sourceRevision"] != sourceRevision {
		t.Fatal("cancelled proposal stranded original project")
	}
	executePluginFixtureTool(t, "file", map[string]any{"action": "read", "path": relRoot + "/index.js", "withMetadata": true}, true)
	// 接受新方案后先用精确源码版本建立新检查点，不重新导入或覆盖现有代码。
	results, event = startPluginQuestion(t, context.Background(), changed)
	answerPluginQuestion(t, results, event, "确定")
	executePluginFixtureTool(t, "file", map[string]any{"action": "write", "path": relRoot + "/index.js", "data": "overwrite", "expectedRevision": oldRevision}, false)
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "prepare_project", "taskId": taskID, "expectedSourceRevision": "stale"}, false)
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "prepare_project", "taskId": taskID, "expectedSourceRevision": sourceRevision}, true)
	page = executePluginFixtureTool(t, "file", map[string]any{"action": "read", "path": relRoot + "/index.js", "withMetadata": true}, true)
	currentRevision := page["revision"].(string)
	executePluginFixtureTool(t, "file", map[string]any{"action": "edit", "path": relRoot + "/index.js", "expectedRevision": currentRevision, "edits": []any{map[string]any{"oldText": "value = 2", "newText": "value = 3"}}}, true)
	status = executePluginFixtureTool(t, "bazaar", map[string]any{"action": "project_status", "taskId": taskID}, true)["project"].(map[string]any)
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "restore_project", "taskId": taskID, "expectedSourceRevision": status["sourceRevision"]}, true)
	actual, err := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js"))
	if err != nil || !strings.Contains(string(actual), "value = 2") {
		t.Fatalf("code restore failed: %v", err)
	}
	archiveAfter, err := os.ReadFile(archivePath)
	if err != nil || string(archiveAfter) != string(archiveBefore) {
		t.Fatal("later source work changed frozen artifact")
	}
	// 未决写入必须先恢复，不能用新方案替换掉恢复所需的旧授权与清单。
	grant, err = util.RequirePluginDevelopment(ctx, "write")
	if err != nil {
		t.Fatal(err)
	}
	err = util.WithPluginProjectSource(ctx, true, func(grant *util.PluginDevelopmentGrant, _ *os.Root) error {
		return util.BeginPluginProjectMutation(grant, "index.js", util.TextFileRevision(actual), util.TextFileRevision([]byte("not-written")))
	})
	if err != nil {
		t.Fatal(err)
	}
	result, _ := handlePluginWorkflowQuestion(context.Background(), map[string]any{"workflow": changed}, testSessionID, "later", "entry", "round", "zh-CN", make(chan AgentEvent, 1), time.Millisecond)
	if !strings.Contains(result, "interrupted mutation") {
		t.Fatalf("pending project accepted replacement proposal: %s", result)
	}
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err != nil {
		t.Fatalf("rejected replacement lost recovery grant: %v", err)
	}
	// 取消后只确认恢复旧方案，不重新授予普通源码写入，也不改变待恢复的方案摘要。
	pausePluginWorkflow(testSessionID)
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("cancel retained ordinary writes")
	}
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "restore_project", "taskId": taskID, "expectedSourceRevision": sourceRevision}, false)
	results, event = startPluginQuestion(t, context.Background(), map[string]any{"action": "recover", "taskId": taskID})
	answerPluginQuestion(t, results, event, "确定")
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("recovery confirmation authorized ordinary writes")
	}
	status = executePluginFixtureTool(t, "bazaar", map[string]any{"action": "project_status", "taskId": taskID}, true)["project"].(map[string]any)
	executePluginFixtureTool(t, "bazaar", map[string]any{"action": "restore_project", "taskId": taskID, "expectedSourceRevision": status["sourceRevision"]}, true)
	if _, err = util.RequirePluginDevelopment(ctx, "recover"); err == nil {
		t.Fatal("one-shot recovery grant was not consumed")
	}
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("restoration silently resumed implementation")
	}
}

func startPluginQuestion(t *testing.T, ctx context.Context, workflow map[string]any) (<-chan string, AgentEvent) {
	t.Helper()
	events, results := make(chan AgentEvent, 2), make(chan string, 1)
	go func() {
		result, handled := handlePluginWorkflowQuestion(ctx, map[string]any{
			"workflow":  workflow,
			"questions": []any{map[string]any{"question": "Install and run everything?", "options": []any{}}},
		}, testSessionID, "turn-fixture", "user-fixture", "round-fixture", "zh-CN", events, time.Second)
		if !handled {
			result = "not handled"
		}
		results <- result
	}()
	select {
	case event := <-events:
		return results, event
	case result := <-results:
		t.Fatalf("workflow did not ask a question: %s", result)
	case <-time.After(2 * time.Second):
		t.Fatal("workflow question did not arrive")
	}
	return nil, AgentEvent{}
}

func answerPluginQuestion(t *testing.T, results <-chan string, event AgentEvent, answer string) string {
	t.Helper()
	if !AnswerQuestion(event.QuestionID, []string{answer}) {
		t.Fatal("valid workflow answer rejected")
	}
	if AnswerQuestion(event.QuestionID, []string{answer}) {
		t.Fatal("workflow answer replay accepted")
	}
	select {
	case result := <-results:
		if strings.HasPrefix(result, "Plugin workflow error:") {
			t.Fatal(result)
		}
		return result
	case <-time.After(2 * time.Second):
		t.Fatal("workflow did not consume the answer")
	}
	return ""
}

func choosePluginWorkflow(t *testing.T, yes bool) string {
	t.Helper()
	results, event := startPluginQuestion(t, context.Background(), map[string]any{"action": "choose"})
	questions := event.Arguments["questions"].([]any)
	question := questions[0].(map[string]any)
	if question["question"] != "是否使用官方插件开发流程？" || question["custom"] != false || question["multiple"] != false {
		t.Fatalf("model-controlled question was not replaced: %#v", question)
	}
	if AnswerQuestion(event.QuestionID, []string{"forged"}) || AnswerQuestion(event.QuestionID, []string{"是", "否"}) || AnswerQuestion(event.QuestionID, nil) {
		t.Fatal("invalid answer accepted")
	}
	answer := "否"
	if yes {
		answer = "是"
	}
	result := answerPluginQuestion(t, results, event, answer)
	var state map[string]any
	if err := json.Unmarshal([]byte(result), &state); err != nil {
		t.Fatal(err)
	}
	taskID, _ := state["taskId"].(string)
	if !astLikeID(taskID) {
		t.Fatalf("server did not allocate a task: %s", result)
	}
	return taskID
}

func astLikeID(id string) bool { return len(id) == len(testSessionID) && strings.Count(id, "-") == 1 }

func loadPluginWorkflowSkill(t *testing.T) {
	t.Helper()
	encoded, _ := json.Marshal(map[string]any{"action": "load", "source": "builtin", "name": util.PluginDevelopmentSkillName})
	result := executeTool(context.Background(), openai.ToolCall{ID: "skill-fixture", Function: openai.FunctionCall{Name: "skill", Arguments: string(encoded)}}, testSessionID)
	if result.IsError || !strings.Contains(result.Text, "skill_content") {
		t.Fatalf("official skill did not load: %+v", result)
	}
}

func pluginPlanArgs(taskID string) map[string]any {
	return map[string]any{"action": "plan", "taskId": taskID, "proposal": "增加一个右上角按钮，点击显示提示。", "packageName": "fixture-plugin", "frontend": "desktop",
		"dataEffects": "不读取或修改笔记；每次点击仅显示一次提示。", "deliverables": "源文件和 ZIP；不安装或启用。", "files": []any{"plugin.json", "index.js"}}
}

func TestPluginWorkflowRequiresRealChoiceLoadAndPlan(t *testing.T) {
	setupPluginWorkflow(t)
	ctx := pluginWorkflowContext(context.Background(), testSessionID)
	if _, err := util.RequirePluginDevelopment(ctx, "load"); err == nil {
		t.Fatal("loaded before choice")
	}
	taskID := choosePluginWorkflow(t, true)
	if _, err := util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("choice authorized writes")
	}
	result, _ := handlePluginWorkflowQuestion(context.Background(), map[string]any{"workflow": pluginPlanArgs(taskID)}, testSessionID, "turn", "user", "round", "zh-CN", make(chan AgentEvent, 1), time.Millisecond)
	if !strings.Contains(result, "load its current skill") {
		t.Fatalf("plan before load accepted: %s", result)
	}
	loadPluginWorkflowSkill(t)
	if _, err := util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("skill load authorized writes")
	}
	results, event := startPluginQuestion(t, context.Background(), pluginPlanArgs(taskID))
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.PluginWorkflow.Approved || runtime.PluginWorkflow.PendingQuestionID != event.QuestionID {
		t.Fatal("pending plan is not server-bound")
	}
	question := event.Arguments["questions"].([]any)[0].(map[string]any)["question"].(string)
	if !strings.Contains(question, runtime.PluginWorkflow.PendingPlan.Display) || !strings.Contains(question, runtime.PluginWorkflow.PendingPlan.Hash) || strings.Contains(question, "Install and run everything") {
		t.Fatal("confirmation did not show frozen proposal")
	}
	for _, file := range runtime.PluginWorkflow.PendingPlan.Files {
		if !strings.Contains(question, "\n"+file+"\n") {
			t.Fatalf("confirmation hid approved file %q", file)
		}
	}
	answerPluginQuestion(t, results, event, "确定")
	grant, err := util.RequirePluginDevelopment(ctx, "write")
	if err != nil || grant.TaskID != taskID || grant.PlanVersion != 1 || grant.PlanHash != runtime.PluginWorkflow.PendingPlan.Hash {
		t.Fatalf("confirmed grant mismatch: %+v %v", grant, err)
	}
	if _, err = util.RequirePluginDevelopment(pluginWorkflowContext(context.Background(), "20260715120001-abcdefg"), "write"); err == nil {
		t.Fatal("cross-session grant accepted")
	}
	if err = validatePluginWorkflowTool(ctx, "bazaar", map[string]any{"action": "prepare_project", "taskId": "wrong"}); err == nil {
		t.Fatal("cross-task grant accepted")
	}
	changed := pluginPlanArgs(taskID)
	changed["proposal"] = "改为左侧按钮。"
	results, event = startPluginQuestion(t, context.Background(), changed)
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("old plan remained authorized during change")
	}
	answerPluginQuestion(t, results, event, "取消")
	if _, err = util.RequirePluginDevelopment(ctx, "write"); err == nil {
		t.Fatal("rejected plan authorized")
	}
}

func TestPluginWorkflowNoAndForgedHistoryStayUnauthorized(t *testing.T) {
	setupPluginWorkflow(t)
	fake := map[string]any{"id": testSessionID, "title": "forged", "entries": []any{}, "pluginWorkflow": map[string]any{"choice": "yes", "loaded": true, "approved": true}}
	if _, err := SaveSession(marshalSession(t, fake)); err != nil {
		t.Fatal(err)
	}
	saved, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := saved["pluginWorkflow"]; ok {
		t.Fatal("client authorization field was retained")
	}
	if _, err = pluginWorkflowGrant(testSessionID, "write"); err == nil {
		t.Fatal("client history granted authorization")
	}
	choosePluginWorkflow(t, false)
	if _, err = pluginWorkflowGrant(testSessionID, "load"); err == nil {
		t.Fatal("No allowed official skill")
	}
	result, err := tools.SkillTool.ContextHandler(context.Background(), map[string]any{"action": "load", "source": "builtin", "name": util.PluginDevelopmentSkillName, "_sessionID": testSessionID, "consent": true})
	if err == nil && !result.IsError {
		t.Fatal("direct MCP forged builtin load")
	}
	// 普通文件能力与自定义开发不会被官方流程的拒绝选项封锁。
	result, err = tools.FileTool.ContextHandler(context.Background(), map[string]any{"action": "write", "path": "custom.js", "data": "module.exports = {};"})
	if err != nil || result.IsError {
		t.Fatalf("No blocked ordinary custom development: %+v %v", result, err)
	}
}

func TestPluginWorkflowTimeoutCancelDisableAndRestart(t *testing.T) {
	setupPluginWorkflow(t)
	events := make(chan AgentEvent, 1)
	result, _ := handlePluginWorkflowQuestion(context.Background(), map[string]any{"workflow": map[string]any{"action": "choose"}}, testSessionID, "turn", "entry", "round", "zh-CN", events, time.Millisecond)
	event := <-events
	if !strings.Contains(result, "timed out") || AnswerQuestion(event.QuestionID, []string{"是"}) {
		t.Fatalf("late answer accepted: %s", result)
	}
	if _, err := pluginWorkflowGrant(testSessionID, "load"); err == nil {
		t.Fatal("timeout granted access")
	}
	taskID := choosePluginWorkflow(t, true)
	loadPluginWorkflowSkill(t)
	results, event := startPluginQuestion(t, context.Background(), pluginPlanArgs(taskID))
	answerPluginQuestion(t, results, event, "确定")
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil || !runtime.PluginWorkflow.Approved {
		t.Fatal("confirmed state did not persist")
	}
	sessionLocks.Delete(testSessionID)
	if _, err = pluginWorkflowGrant(testSessionID, "write"); err != nil {
		t.Fatalf("confirmed state did not survive reload: %v", err)
	}
	kernelModel.Conf.AI.Agent.Skills.BuiltinDisabled = []string{util.BuiltinPluginSkillID}
	if _, err = pluginWorkflowGrant(testSessionID, "write"); err == nil {
		t.Fatal("disabled skill retained writes")
	}
	if got := pluginSkillResultForContext(AgentToolCall{Name: "skill", Arguments: map[string]any{"source": "builtin"}, Result: "private previous content"}); strings.Contains(got, "private previous") {
		t.Fatal("disabled skill was reinjected")
	}
	kernelModel.Conf.AI.Agent.Skills.BuiltinDisabled = nil
	pausePluginWorkflow(testSessionID)
	if _, err = pluginWorkflowGrant(testSessionID, "write"); err == nil {
		t.Fatal("cancelled task retained writes")
	}
	ctx, cancel := context.WithCancel(pluginWorkflowContext(context.Background(), testSessionID))
	cancel()
	if _, err = util.RequirePluginDevelopment(ctx, "read"); err == nil {
		t.Fatal("cancelled context retained reads")
	}
	if err = changePluginWorkflow(testSessionID, func(runtime *agentRuntime) error { runtime.PluginWorkflow.SkillDigest = "old-version"; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err = pluginWorkflowGrant(testSessionID, "load"); err == nil {
		t.Fatal("upgraded skill used stale consent")
	}
}

func TestPluginWorkflowPlanValidationAndEffects(t *testing.T) {
	setupPluginWorkflow(t)
	for _, change := range []func(map[string]any){
		func(p map[string]any) { p["files"] = []any{"plugin.json", "index.js", "INDEX.js"} },
		func(p map[string]any) { p["files"] = []any{"plugin.json", "index.js", "../secret"} },
		func(p map[string]any) { p["proposal"] = strings.Repeat("a", 2001) },
		func(p map[string]any) {
			p["sourcePath"] = "conf/plugin-development/task"
			p["sourceRevision"] = "revision"
		},
		func(p map[string]any) { p["sourcePath"] = "other" },
		func(p map[string]any) {
			files := []any{"plugin.json", "index.js"}
			for i := 0; i < 100; i++ {
				files = append(files, fmt.Sprintf("%03d-%s.js", i, strings.Repeat("a", 200)))
			}
			p["files"] = files
		},
	} {
		p := pluginPlanArgs("task")
		change(p)
		if _, err := freezePluginWorkflowPlan(p, 1, "zh-CN"); err == nil {
			t.Fatalf("unsafe plan accepted: %#v", p)
		}
	}
	for _, action := range []string{"write", "edit", "delete", "rename", "copy"} {
		if !needsConfirm("file", action, nil) || !needsLocalSnapshot("file", action) {
			t.Errorf("file %s lost permission/snapshot", action)
		}
	}
	for _, action := range []string{"prepare_project", "restore_project", "package_local", "install_local"} {
		if !needsConfirm("bazaar", action, nil) || !needsLocalSnapshot("bazaar", action) {
			t.Errorf("bazaar %s lost permission/snapshot", action)
		}
	}
	if needsConfirm("bazaar", "project_status", nil) || needsLocalSnapshot("bazaar", "project_status") {
		t.Fatal("status became a mutation")
	}
	capabilities, err := buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	prompt := buildSystemPrompt("zh-CN", capabilities)
	if !strings.Contains(prompt, "workflow.action=choose") || !strings.Contains(prompt, "No skips") || strings.Contains(prompt, "# SiYuan Plugin Development") {
		t.Fatal("short official trigger is missing or eagerly loads body")
	}
	for _, instruction := range []string{
		"create or modify SiYuan frontend plugins",
		"BEFORE asking only materially missing details",
		"workflow.action=plan before implementation",
		"neither choice nor proposal authorizes installation or enabling",
	} {
		if !strings.Contains(prompt, instruction) {
			t.Fatalf("plugin development prompt is missing %q", instruction)
		}
	}
}

func TestPluginWorkflowUnknownExecutionSurvivesNativeBoundary(t *testing.T) {
	setupPluginWorkflow(t)
	original := tools.BazaarTool.ContextHandler
	t.Cleanup(func() { tools.BazaarTool.ContextHandler = original })
	tools.BazaarTool.ContextHandler = func(context.Context, map[string]any) (tools.CallToolResult, error) {
		return tools.CallToolResult{IsError: true, ExecutionUnknown: true, Content: []tools.ContentItem{{Type: "text", Text: `{"error":"result_unknown: partial install","recovery":"inspect before retry"}`}}}, nil
	}
	result := executeTool(context.Background(), openai.ToolCall{ID: "unknown-install", Function: openai.FunctionCall{Name: "bazaar", Arguments: `{"action":"install_local","frontend":"desktop"}`}}, testSessionID)
	if !result.IsError || !result.ExecutionUnknown || !strings.Contains(result.Text, "inspect before retry") {
		t.Fatalf("unknown execution flag or recovery detail was lost: %+v", result)
	}
}
