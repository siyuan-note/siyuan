// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package agent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type pluginWorkflowPlan struct {
	Version        int      `json:"version"`
	Hash           string   `json:"hash"`
	Proposal       string   `json:"proposal"`
	PackageName    string   `json:"packageName"`
	Frontend       string   `json:"frontend"`
	DataEffects    string   `json:"dataEffects"`
	Deliverables   string   `json:"deliverables"`
	SourcePath     string   `json:"sourcePath,omitempty"`
	SourceRevision string   `json:"sourceRevision,omitempty"`
	Files          []string `json:"files"`
	Display        string   `json:"display"`
}

const maxPluginPlanDisplayBytes = 16000

// pluginWorkflowState 仅保存到服务器 runtime.json，客户端历史不参与授权判断。
type pluginWorkflowState struct {
	TaskID             string              `json:"taskID"`
	Choice             string              `json:"choice"`
	ChoiceQuestionID   string              `json:"choiceQuestionID,omitempty"`
	SkillVersion       string              `json:"skillVersion"`
	SkillDigest        string              `json:"skillDigest"`
	Loaded             bool                `json:"loaded"`
	Approved           bool                `json:"approved"`
	Paused             bool                `json:"paused"`
	Plan               *pluginWorkflowPlan `json:"plan,omitempty"`
	PendingPlan        *pluginWorkflowPlan `json:"pendingPlan,omitempty"`
	PlanSequence       int                 `json:"planSequence,omitempty"`
	PendingWasApproved bool                `json:"pendingWasApproved,omitempty"`
	RecoveryApproved   bool                `json:"recoveryApproved,omitempty"`
	RecoveryPlanHash   string              `json:"recoveryPlanHash,omitempty"`
	RecoveryQuestionID string              `json:"recoveryQuestionID,omitempty"`
	PlanQuestionID     string              `json:"planQuestionID,omitempty"`
	PendingPurpose     string              `json:"pendingPurpose,omitempty"`
	PendingQuestionID  string              `json:"pendingQuestionID,omitempty"`
	PendingTurnID      string              `json:"pendingTurnID,omitempty"`
	PendingEntryID     string              `json:"pendingEntryID,omitempty"`
	UpdatedAt          int64               `json:"updatedAt"`
}

func changePluginWorkflow(sessionID string, update func(*agentRuntime) error) error {
	if !isValidSessionID(sessionID) {
		return errors.New("official plugin development requires a persisted agent session")
	}
	lock := sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	runtime, err := loadRuntimeLocked(sessionID)
	if err != nil {
		return err
	}
	if err = update(runtime); err != nil {
		return err
	}
	if runtime.PluginWorkflow != nil {
		runtime.PluginWorkflow.UpdatedAt = time.Now().UnixMilli()
	}
	return writeRuntimeLocked(sessionID, runtime)
}

func pluginWorkflowGrant(sessionID, operation string) (*util.PluginDevelopmentGrant, error) {
	var grant *util.PluginDevelopmentGrant
	err := changePluginWorkflow(sessionID, func(runtime *agentRuntime) error {
		state := runtime.PluginWorkflow
		if state == nil || state.Choice != "yes" {
			return errors.New("ask the official plugin workflow question and receive Yes before loading the official skill")
		}
		info, err := util.BuiltinPluginSkill(kernelModel.DisabledBuiltinSkills())
		if err != nil {
			return err
		}
		if !info.Enabled {
			return errors.New("the official plugin development skill is disabled")
		}
		if info.Version != state.SkillVersion || info.Digest != state.SkillDigest {
			return errors.New("the official skill changed; choose the workflow again and reconfirm the affected proposal")
		}
		if state.PendingPurpose == "choose" {
			return errors.New("official workflow selection is still pending")
		}
		switch operation {
		case "load":
		case "loaded":
			state.Loaded = true
		case "read":
			if !state.Loaded {
				return errors.New("load the official plugin skill before clarifying or reading its resources")
			}
		case "write":
			if !state.Loaded || !state.Approved || state.Paused || state.Plan == nil || state.PendingQuestionID != "" {
				return errors.New("confirm the current plugin proposal before changing the managed project")
			}
		case "recover", "recovered":
			if !state.Loaded || state.Plan == nil || state.PendingQuestionID != "" ||
				(!(state.Approved && !state.Paused) && !(state.RecoveryApproved && state.RecoveryPlanHash == state.Plan.Hash)) {
				return errors.New("confirm recovery of the last approved plugin proposal before resuming its interrupted operation")
			}
			if operation == "recovered" {
				state.RecoveryApproved = false
			}
		default:
			return errors.New("unsupported plugin workflow operation")
		}
		grant = &util.PluginDevelopmentGrant{
			SessionID: sessionID, TaskID: state.TaskID, SkillVersion: state.SkillVersion, SkillDigest: state.SkillDigest,
			SourceRoot: filepath.Join(util.PluginProjectRoot(state.TaskID), "source"),
		}
		if plan := state.Plan; plan != nil {
			grant.PlanHash, grant.PlanVersion = plan.Hash, plan.Version
			grant.PackageName, grant.Frontend = plan.PackageName, plan.Frontend
			grant.SourcePath, grant.SourceRevision = plan.SourcePath, plan.SourceRevision
			grant.AllowFiles = append([]string(nil), plan.Files...)
		}
		return nil
	})
	return grant, err
}

func pluginWorkflowContext(ctx context.Context, sessionID string) context.Context {
	return util.WithPluginDevelopmentAccess(ctx, func(operation string) (*util.PluginDevelopmentGrant, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return pluginWorkflowGrant(sessionID, operation)
	})
}

// validatePluginWorkflowTool 在工具确认与快照前拒绝缺失流程授权的调用，执行入口仍会再次校验。
func validatePluginWorkflowTool(ctx context.Context, name string, args map[string]any) error {
	action, _ := args["action"].(string)
	operation := ""
	switch name {
	case "skill":
		if source, _ := args["source"].(string); source == "builtin" && (action == "load" || action == "") {
			operation = "load"
			if locator, _ := args["name"].(string); strings.Contains(locator, "/") {
				operation = "read"
			}
		}
	case "bazaar":
		switch action {
		case "project_status":
			operation = "read"
		case "prepare_project", "package_local":
			operation = "write"
		case "restore_project":
			operation = "recover"
		}
	case "file":
		for _, key := range []string{"path", "old", "new", "src", "dst"} {
			if rel, _ := args[key].(string); rel != "" && util.IsPluginProjectPath(filepath.Join(util.WorkspaceDir, rel)) {
				operation = "read"
				switch action {
				case "write", "edit", "delete", "rename", "copy":
					operation = "write"
				}
			}
		}
	}
	if operation == "" {
		return nil
	}
	grant, err := util.RequirePluginDevelopment(ctx, operation)
	if err != nil && name == "bazaar" && action == "prepare_project" {
		grant, err = util.RequirePluginDevelopment(ctx, "recover")
	}
	if err != nil {
		return err
	}
	if taskID, _ := args["taskId"].(string); taskID != "" && taskID != grant.TaskID {
		return errors.New("plugin workflow task does not match this session")
	}
	return nil
}

func pausePluginWorkflow(sessionID string) {
	_ = changePluginWorkflow(sessionID, func(runtime *agentRuntime) error {
		if state := runtime.PluginWorkflow; state != nil {
			state.Approved, state.Paused = false, true
			state.RecoveryApproved = false
			state.PendingQuestionID, state.PendingPurpose = "", ""
			state.PendingPlan = nil
		}
		return nil
	})
}

func workflowString(args map[string]any, key string, maxRunes int, required bool) (string, error) {
	value, ok := args[key].(string)
	value = strings.TrimSpace(value)
	if required && (!ok || value == "") || !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxRunes {
		return "", fmt.Errorf("invalid or oversized plugin proposal field: %s", key)
	}
	return value, nil
}

func freezePluginWorkflowPlan(args map[string]any, version int, language string) (*pluginWorkflowPlan, error) {
	plan := &pluginWorkflowPlan{Version: version}
	var err error
	for _, field := range []struct {
		key      string
		limit    int
		required bool
		target   *string
	}{
		{"proposal", 2000, true, &plan.Proposal}, {"packageName", 128, true, &plan.PackageName},
		{"frontend", 32, true, &plan.Frontend}, {"dataEffects", 1000, true, &plan.DataEffects},
		{"deliverables", 1000, true, &plan.Deliverables}, {"sourcePath", 1024, false, &plan.SourcePath},
		{"sourceRevision", 128, false, &plan.SourceRevision},
	} {
		if *field.target, err = workflowString(args, field.key, field.limit, field.required); err != nil {
			return nil, err
		}
	}
	if !bazaar.IsValidPackageName(plan.PackageName) {
		return nil, errors.New("invalid plugin packageName")
	}
	switch plan.Frontend {
	case "desktop", "desktop-window", "browser-desktop", "mobile", "browser-mobile":
	default:
		return nil, errors.New("invalid plugin target frontend")
	}
	if plan.SourcePath != "" {
		if !fs.ValidPath(plan.SourcePath) || strings.ContainsAny(plan.SourcePath, "\\:") || plan.SourceRevision == "" ||
			strings.ContainsFunc(plan.SourcePath, unicode.IsControl) {
			return nil, errors.New("sourcePath must be workspace-relative and bound to sourceRevision")
		}
		abs := filepath.Join(util.WorkspaceDir, filepath.FromSlash(plan.SourcePath))
		if util.IsForbiddenAbsPath(abs) || util.IsPluginDevelopmentRawPathForbidden(abs, false) ||
			kernelModel.EncryptedRawPathBoxID(abs) != "" {
			return nil, errors.New("the plugin import source is protected")
		}
	} else if plan.SourceRevision != "" {
		return nil, errors.New("sourceRevision requires sourcePath")
	}
	files, ok := args["files"].([]any)
	if !ok || len(files) == 0 || len(files) > 200 {
		return nil, errors.New("plugin proposal files must contain 1 to 200 relative paths")
	}
	seen := map[string]bool{}
	for _, raw := range files {
		file, ok := raw.(string)
		if !ok || !fs.ValidPath(file) || strings.ContainsAny(file, "\\:") || len(file) > 512 ||
			strings.ContainsFunc(file, unicode.IsControl) || file == "." {
			return nil, errors.New("invalid plugin proposal file path")
		}
		key := strings.ToLower(file)
		if seen[key] {
			return nil, errors.New("duplicate or case-colliding plugin proposal files")
		}
		seen[key] = true
		plan.Files = append(plan.Files, file)
	}
	if !seen["plugin.json"] || !seen["index.js"] {
		return nil, errors.New("frontend plugin proposal must include plugin.json and index.js")
	}
	sort.Strings(plan.Files)
	// 方案全文与技术清单一同冻结；一次显示全部文件路径，过长时拒绝而不是隐藏授权范围。
	inventory, _ := json.Marshal(plan.Files)
	inventoryHash := fmt.Sprintf("sha256:%x", sha256.Sum256(inventory))
	source := plan.SourcePath
	if source == "" {
		source = "-"
	}
	revision := plan.SourceRevision
	if revision == "" {
		revision = "-"
	}
	format, err := pluginWorkflowTerm(language, "agentPluginPlanDetails")
	if err != nil {
		return nil, err
	}
	plan.Display = plan.Proposal + "\n\n" + fmt.Sprintf(format, plan.PackageName, plan.Frontend, source,
		plan.DataEffects, plan.Deliverables, len(plan.Files), inventoryHash, revision)
	plan.Display += "\n\n" + strings.Join(plan.Files, "\n")
	if len(plan.Display) > maxPluginPlanDisplayBytes {
		return nil, errors.New("plugin proposal and complete file inventory exceed the confirmation display limit; reduce the scope")
	}
	encoded, _ := json.Marshal(plan)
	plan.Hash = fmt.Sprintf("sha256:%x", sha256.Sum256(encoded))
	return plan, nil
}

func pluginWorkflowTerm(language, key string) (string, error) {
	term := util.I18nTerm(language, key)
	if term == "" && language != "en_US" {
		term = util.I18nTerm("en_US", key)
	}
	if term == "" {
		term = util.I18nTerm("en", key)
	}
	if term == "" {
		return "", fmt.Errorf("plugin workflow localization is unavailable: %s", key)
	}
	return term, nil
}

func pluginWorkflowResult(sessionID string) string {
	runtime, err := loadRuntimeState(sessionID)
	if err != nil || runtime.PluginWorkflow == nil {
		return "Plugin workflow state is unavailable."
	}
	state := runtime.PluginWorkflow
	sourceRoot, _ := filepath.Rel(util.WorkspaceDir, filepath.Join(util.PluginProjectRoot(state.TaskID), "source"))
	result := map[string]any{"taskId": state.TaskID, "choice": state.Choice, "loaded": state.Loaded,
		"approved": state.Approved, "paused": state.Paused, "skillVersion": state.SkillVersion,
		"sourceRoot": filepath.ToSlash(sourceRoot), "recoveryApproved": state.RecoveryApproved}
	if state.Plan != nil {
		result["planVersion"], result["planHash"] = state.Plan.Version, state.Plan.Hash
	}
	data, _ := json.Marshal(result)
	return string(data)
}

func pluginSkillResultForContext(call AgentToolCall) string {
	args := call.Arguments
	if args == nil && call.ArgumentsJSON != "" {
		_ = json.Unmarshal([]byte(call.ArgumentsJSON), &args)
	}
	if call.Name == "skill" && args["source"] == "builtin" {
		info, err := util.BuiltinPluginSkill(kernelModel.DisabledBuiltinSkills())
		if err != nil || !info.Enabled {
			return "The official plugin development skill is disabled. Its previous instructions and resources are not active."
		}
		if strings.Contains(call.Result, `source="builtin"`) && !strings.Contains(call.Result, `digest="`+info.Digest+`"`) {
			return "The official plugin skill content changed. Choose the current workflow version before loading its instructions again."
		}
	}
	return call.Result
}

func checkPluginPlanTransition(ctx context.Context, sessionID, taskID string) error {
	runtime, err := loadRuntimeState(sessionID)
	if err != nil || runtime.PluginWorkflow == nil || runtime.PluginWorkflow.TaskID != taskID || runtime.PluginWorkflow.Plan == nil {
		return err
	}
	if _, err = os.Lstat(util.PluginProjectRoot(taskID)); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	status, err := util.GetPluginProjectStatus(pluginWorkflowContext(ctx, sessionID), taskID)
	if err != nil {
		return fmt.Errorf("inspect or recover the existing plugin project before replacing its proposal: %w", err)
	}
	if status.Pending {
		return errors.New("recover the existing project's interrupted mutation before replacing its approved proposal")
	}
	return nil
}

func handlePluginWorkflowQuestion(ctx context.Context, args map[string]any, sessionID, turnID, entryID,
	roundID, language string, ch chan<- AgentEvent, timeout time.Duration) (string, bool) {
	workflow, ok := args["workflow"].(map[string]any)
	if !ok {
		return "", false
	}
	action, _ := workflow["action"].(string)
	taskID, _ := workflow["taskId"].(string)
	if action == "cancel" {
		err := changePluginWorkflow(sessionID, func(runtime *agentRuntime) error {
			if runtime.PluginWorkflow == nil || taskID != runtime.PluginWorkflow.TaskID {
				return errors.New("plugin workflow task does not match this session")
			}
			runtime.PluginWorkflow.Approved, runtime.PluginWorkflow.Paused = false, true
			runtime.PluginWorkflow.RecoveryApproved = false
			runtime.PluginWorkflow.PendingPurpose, runtime.PluginWorkflow.PendingQuestionID = "", ""
			runtime.PluginWorkflow.PendingPlan = nil
			return nil
		})
		if err != nil {
			return "Plugin workflow error: " + err.Error(), true
		}
		return pluginWorkflowResult(sessionID), true
	}
	if action != "choose" && action != "plan" && action != "recover" {
		return "Plugin workflow error: expected choose, plan, recover or cancel", true
	}
	if action == "plan" {
		if err := checkPluginPlanTransition(ctx, sessionID, taskID); err != nil {
			return "Plugin workflow error: " + err.Error(), true
		}
	}
	questionKey, yesKey, noKey := "agentPluginFlowQuestion", "agentPluginFlowYes", "agentPluginFlowNo"
	if action == "plan" {
		questionKey, yesKey, noKey = "agentPluginPlanQuestion", "confirm", "cancel"
	} else if action == "recover" {
		questionKey, yesKey, noKey = "agentPluginRecoveryQuestion", "confirm", "cancel"
	}
	question, err := pluginWorkflowTerm(language, questionKey)
	if err != nil {
		return "Plugin workflow error: " + err.Error(), true
	}
	yes, err := pluginWorkflowTerm(language, yesKey)
	if err != nil {
		return "Plugin workflow error: " + err.Error(), true
	}
	no, err := pluginWorkflowTerm(language, noKey)
	if err != nil {
		return "Plugin workflow error: " + err.Error(), true
	}
	questionID := ast.NewNodeID()
	reused := false
	err = changePluginWorkflow(sessionID, func(runtime *agentRuntime) error {
		info, err := util.BuiltinPluginSkill(kernelModel.DisabledBuiltinSkills())
		if err != nil {
			return err
		}
		if !info.Enabled {
			return errors.New("the official plugin development skill is disabled")
		}
		state := runtime.PluginWorkflow
		if action == "choose" {
			newTask, _ := workflow["newTask"].(bool)
			reconsider, _ := workflow["reconsider"].(bool)
			if state != nil && !newTask && !reconsider && state.Choice != "" &&
				state.SkillVersion == info.Version && state.SkillDigest == info.Digest {
				reused = true
				return nil
			}
			if state == nil || newTask {
				state = &pluginWorkflowState{TaskID: ast.NewNodeID()}
				runtime.PluginWorkflow = state
			} else if taskID != "" && taskID != state.TaskID {
				return errors.New("plugin workflow task does not match this session")
			}
			state.Choice, state.Loaded, state.Approved, state.Paused = "", false, false, false
			state.RecoveryApproved = false
			state.SkillVersion, state.SkillDigest = info.Version, info.Digest
		} else if action == "recover" {
			if state == nil || state.TaskID != taskID || state.Choice != "yes" || !state.Loaded || state.Plan == nil ||
				state.SkillVersion != info.Version || state.SkillDigest != info.Digest {
				return errors.New("recovery requires the same loaded skill and a previously approved plugin proposal")
			}
			state.Approved, state.Paused, state.RecoveryApproved = false, true, false
			state.RecoveryPlanHash = state.Plan.Hash
			question += "\n\n" + state.Plan.Display + "\n\n" + state.Plan.Hash
		} else {
			if state == nil || state.TaskID != taskID || state.Choice != "yes" || !state.Loaded ||
				state.SkillVersion != info.Version || state.SkillDigest != info.Digest {
				return errors.New("choose the official workflow and load its current skill before proposing a plan")
			}
			version := state.PlanSequence + 1
			if state.Plan != nil {
				version = max(version, state.Plan.Version+1)
			}
			plan, err := freezePluginWorkflowPlan(workflow, version, language)
			if err != nil {
				return err
			}
			state.PendingWasApproved = state.Approved
			state.RecoveryApproved = false
			state.PendingPlan, state.PlanSequence, state.Approved = plan, version, false
			question += "\n\n" + plan.Display + "\n\n" + plan.Hash
		}
		taskID = state.TaskID
		state.PendingPurpose, state.PendingQuestionID = action, questionID
		state.PendingTurnID, state.PendingEntryID = turnID, entryID
		return nil
	})
	if err != nil {
		return "Plugin workflow error: " + err.Error(), true
	}
	if reused {
		return pluginWorkflowResult(sessionID), true
	}
	canonical := map[string]any{"questions": []any{map[string]any{
		"header": "", "question": question, "multiple": false, "custom": false,
		"options": []any{map[string]any{"label": yes, "description": ""}, map[string]any{"label": no, "description": ""}},
	}}}
	answer, status := waitForQuestion(ctx, canonical, questionID, roundID, ch, timeout, func(answers []string) bool {
		return len(answers) == 1 && (answers[0] == yes || answers[0] == no)
	})
	transitionBlocked := false
	if status == "" && action == "plan" {
		if transitionErr := checkPluginPlanTransition(ctx, sessionID, taskID); transitionErr != nil {
			status, transitionBlocked = "Plugin workflow error: "+transitionErr.Error(), true
		}
	}
	err = changePluginWorkflow(sessionID, func(runtime *agentRuntime) error {
		state := runtime.PluginWorkflow
		if state == nil || state.TaskID != taskID || state.PendingQuestionID != questionID ||
			state.PendingPurpose != action || state.PendingTurnID != turnID || state.PendingEntryID != entryID {
			return errors.New("plugin workflow question expired or was replaced")
		}
		state.PendingPurpose, state.PendingQuestionID = "", ""
		if status != "" || ctx.Err() != nil || len(answer.Answers) != 1 {
			state.Approved = transitionBlocked && state.PendingWasApproved && !state.Paused
			state.PendingPlan = nil
			state.RecoveryApproved = false
			return nil
		}
		info, err := util.BuiltinPluginSkill(kernelModel.DisabledBuiltinSkills())
		if err != nil || !info.Enabled || info.Version != state.SkillVersion || info.Digest != state.SkillDigest {
			state.Approved, state.Paused = false, true
			state.PendingPlan = nil
			state.RecoveryApproved = false
			return nil
		}
		accepted := answer.Answers[0] == yes
		if action == "choose" {
			state.Choice, state.ChoiceQuestionID = "no", questionID
			if accepted {
				state.Choice = "yes"
			}
		} else if action == "recover" {
			if state.Plan == nil || state.Plan.Hash != state.RecoveryPlanHash {
				return errors.New("recovery proposal changed while awaiting confirmation")
			}
			state.RecoveryApproved, state.RecoveryQuestionID = accepted, questionID
		} else {
			if state.PendingPlan == nil {
				return errors.New("plugin proposal snapshot is unavailable")
			}
			if accepted {
				state.Plan = state.PendingPlan
			}
			state.PendingPlan = nil
			state.Approved, state.Paused, state.PlanQuestionID = accepted, !accepted, questionID
		}
		return nil
	})
	if err != nil {
		return "Plugin workflow error: " + err.Error(), true
	}
	if status != "" {
		return status, true
	}
	return pluginWorkflowResult(sessionID), true
}
