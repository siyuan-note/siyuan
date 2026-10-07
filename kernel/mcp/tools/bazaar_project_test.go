package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func bazaarProjectGrant(t *testing.T) (context.Context, *util.PluginDevelopmentGrant) {
	t.Helper()
	setupBazaarToolTest(t)
	grant := &util.PluginDevelopmentGrant{SessionID: "session", TaskID: "task123", PlanHash: "plan", PlanVersion: 1, PackageName: "sample", Frontend: "desktop", AllowFiles: []string{"plugin.json", "index.js"}}
	grant.SourceRoot = filepath.Join(util.PluginProjectRoot(grant.TaskID), "source")
	return util.WithPluginDevelopmentAccess(context.Background(), func(string) (*util.PluginDevelopmentGrant, error) { return grant, nil }), grant
}

func TestBazaarProjectOfflineGuardsAndEffects(t *testing.T) {
	ctx, grant := bazaarProjectGrant(t)
	model.Conf.Bazaar.Trust = false
	model.Conf.Bazaar.PetalDisabled = true
	result, err := bazaarHandler(ctx, map[string]any{"action": "prepare_project", "taskId": grant.TaskID})
	if err != nil || result.IsError {
		t.Fatal("offline project incorrectly requires trust, frontend or pkgType", probeText(result), err)
	}
	for _, action := range []string{"project_status", "restore_project", "package_local"} {
		result, err = bazaarHandler(context.Background(), map[string]any{"action": action, "taskId": grant.TaskID})
		if err != nil || !result.IsError || !strings.Contains(probeText(result), "confirmed agent workflow") {
			t.Fatal("untrusted project accepted", action, probeText(result), err)
		}
	}
	util.ReadOnly = true
	result, err = bazaarHandler(ctx, map[string]any{"action": "project_status", "taskId": grant.TaskID})
	if err != nil || result.IsError {
		t.Fatal("read-only status blocked", probeText(result), err)
	}
	for _, action := range []string{"prepare_project", "restore_project", "package_local", "restore_install"} {
		result, err = bazaarHandler(ctx, map[string]any{"action": action, "taskId": grant.TaskID, "frontend": "desktop"})
		if err != nil || !result.IsError || !strings.Contains(probeText(result), "read-only") {
			t.Fatal("read-only write bypass", action, probeText(result), err)
		}
		effects, ok := BazaarTool.EffectsFor(action)
		if !ok || !effects.LocalRead || !effects.LocalWrite || effects.DataEgress || effects.ExternalCost {
			t.Fatal("incorrect effects", action, effects)
		}
	}
}

func TestBazaarProjectCandidateInspectionBeforePlan(t *testing.T) {
	ctx, grant := bazaarProjectGrant(t)
	ctx = util.WithPluginDevelopmentAccess(ctx, func(operation string) (*util.PluginDevelopmentGrant, error) {
		if operation != "read" {
			return nil, errors.New("plan is not approved")
		}
		return grant, nil
	})
	writeProbeFile(t, filepath.Join(util.WorkspaceDir, "source", "index.js"), "candidate")
	model.Conf.Bazaar.Trust = false
	result, err := bazaarHandler(ctx, map[string]any{"action": "project_status", "taskId": grant.TaskID, "sourcePath": "source"})
	if err != nil || result.IsError {
		t.Fatal(probeText(result), err)
	}
	var decoded map[string]any
	if err = json.Unmarshal([]byte(probeText(result)), &decoded); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(util.PluginProjectRoot(grant.TaskID)); !os.IsNotExist(err) {
		t.Fatal("read-only inspection created project", err)
	}
	result, _ = bazaarHandler(ctx, map[string]any{"action": "prepare_project", "taskId": grant.TaskID})
	if !result.IsError || !strings.Contains(probeText(result), "not approved") {
		t.Fatal("unapproved preparation accepted", probeText(result))
	}
	writeProbeFile(t, filepath.Join(util.ConfDir, "conf.json"), `{"token":"secret"}`)
	result, _ = bazaarHandler(ctx, map[string]any{"action": "project_status", "taskId": grant.TaskID, "sourcePath": "conf"})
	if strings.Contains(probeText(result), `"token":"secret"`) || (!result.IsError && !strings.Contains(probeText(result), "excluded")) {
		t.Fatal("inspection exposed private descendant", probeText(result))
	}
	result, _ = bazaarHandler(ctx, map[string]any{"action": "project_status", "taskId": grant.TaskID, "sourcePath": "conf", "sourceFiles": []any{"conf.json"}})
	if !result.IsError {
		t.Fatal("explicit private selection accepted", probeText(result))
	}
}

func TestBazaarProjectManagedArchiveCannotUseLegacyInstall(t *testing.T) {
	ctx, grant := bazaarProjectGrant(t)
	if _, err := util.PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	rel, _ := filepath.Rel(util.WorkspaceDir, filepath.Join(util.PluginProjectRoot(grant.TaskID), "artifacts", "fake.zip"))
	args := map[string]any{"action": "install_local", "path": filepath.ToSlash(rel), "frontend": "desktop", "taskId": grant.TaskID}
	result, err := bazaarHandler(ctx, args)
	if err != nil || !result.IsError || !strings.Contains(probeText(result), "requires expectedPackageHash") {
		t.Fatal("managed artifact accepted as legacy installation", probeText(result), err)
	}
	args["expectedPackageHash"] = strings.Repeat("a", 64)
	args["expectedInstalledRevision"] = "missing"
	result, err = bazaarHandler(context.Background(), args)
	if err != nil || !result.IsError || !strings.Contains(probeText(result), "confirmed agent workflow") {
		t.Fatal("untrusted managed install accepted", probeText(result), err)
	}
	args["frontend"] = "mobile"
	result, err = bazaarHandler(ctx, args)
	if err != nil || !result.IsError || !strings.Contains(probeText(result), "frontend differs") {
		t.Fatal("cross-frontend managed install accepted", probeText(result), err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "plugins", "sample")); !os.IsNotExist(err) {
		t.Fatal("failed install altered target", err)
	}
}

func TestBazaarProjectUnknownErrorsRetainExecutionState(t *testing.T) {
	result, err := bazaarProjectError(errors.New("result_unknown: staged replacement may be partial"), map[string]any{"backupId": "retained"})
	if err != nil || !result.IsError || !result.ExecutionUnknown || !strings.Contains(probeText(result), "retained") {
		t.Fatal(result, err)
	}
	result, err = bazaarProjectError(errors.New("revision_conflict: source changed"), nil)
	if err != nil || !result.IsError || result.ExecutionUnknown {
		t.Fatal("ordinary conflict misclassified", result, err)
	}
}

func TestBazaarProjectSelectedInspectionMatchesPrepare(t *testing.T) {
	ctx, grant := bazaarProjectGrant(t)
	writeProbeFile(t, filepath.Join(util.WorkspaceDir, "source", "index.js"), "module.exports={}")
	writeProbeFile(t, filepath.Join(util.WorkspaceDir, "source", ".git", "config"), "private")
	writeProbeFile(t, filepath.Join(util.WorkspaceDir, "source", "unapproved.txt"), "ignored")
	result, err := bazaarHandler(ctx, map[string]any{"action": "project_status", "taskId": grant.TaskID, "sourcePath": "source", "sourceFiles": []any{"index.js", "plugin.json"}})
	if err != nil || result.IsError {
		t.Fatal(probeText(result), err)
	}
	var payload struct {
		Project util.PluginProjectStatus `json:"project"`
	}
	if err = json.Unmarshal([]byte(probeText(result)), &payload); err != nil {
		t.Fatal(err)
	}
	grant.SourcePath, grant.SourceRevision = "source", payload.Project.SourceRevision
	result, err = bazaarHandler(ctx, map[string]any{"action": "prepare_project", "taskId": grant.TaskID})
	if err != nil || result.IsError {
		t.Fatal(probeText(result), err)
	}
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, "unapproved.txt")); !os.IsNotExist(err) {
		t.Fatal("unapproved import", err)
	}
}

func TestBazaarProjectLinkedCreationCrashReportsUnknown(t *testing.T) {
	ctx, grant := bazaarProjectGrant(t)
	if _, err := util.PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	content := []byte("created before crash")
	tmp := ".text-file-created"
	err := util.WithPluginProjectSource(ctx, true, func(g *util.PluginDevelopmentGrant, root *os.Root) error {
		if err := util.BeginPluginProjectMutation(g, "index.js", util.PluginProjectMissingRevision, util.PluginProjectDigest(content), tmp); err != nil {
			return err
		}
		if err := root.WriteFile(tmp, content, 0600); err != nil {
			return err
		}
		return root.Link(tmp, "index.js")
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"project_status", "restore_project"} {
		result, err := bazaarHandler(ctx, map[string]any{"action": action, "taskId": grant.TaskID, "expectedSourceRevision": util.PluginProjectTreeRevision(map[string]string{"index.js": util.PluginProjectDigest(content)})})
		if err != nil || !result.IsError || !result.ExecutionUnknown || !strings.Contains(probeText(result), "manual inspection") {
			t.Fatal("pending crash was treated as ordinary no-write error", action, probeText(result), err)
		}
	}
	for _, name := range []string{tmp, "index.js"} {
		if data, err := os.ReadFile(filepath.Join(grant.SourceRoot, name)); err != nil || string(data) != string(content) {
			t.Fatal("crash bytes lost", name, err)
		}
	}
}
