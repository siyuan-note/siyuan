// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBuiltinSkillRejectsForgedContextAndMutations(t *testing.T) {
	root := setSkillToolTestEnvironment(t)
	for _, action := range []string{"load", "save", "remove", "rename", "install"} {
		result, err := skillHandler(map[string]any{
			"action": action, "source": "builtin", "name": util.PluginDevelopmentSkillName,
			"content": "changed", "new_name": "renamed", "_sessionID": "forged", "consent": true,
		})
		if err != nil || !result.IsError {
			t.Fatalf("unauthorized %s accepted: %+v, %v", action, result, err)
		}
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("denied calls wrote workspace skills: %v", err)
	}
	writeSkillToolTestFile(t, filepath.Join(root, util.PluginDevelopmentSkillName, "SKILL.md"), "---\nname: siyuan-plugin-development\n---\nworkspace body")
	result, err := skillHandler(map[string]any{"action": "load", "name": util.PluginDevelopmentSkillName})
	if err != nil || result.IsError || !strings.Contains(result.Content[0].Text, "workspace body") {
		t.Fatalf("unqualified same-name user skill changed: %+v, %v", result, err)
	}
	for _, source := range []any{"unknown", true, 1} {
		result, err = skillHandler(map[string]any{"action": "load", "source": source, "name": util.PluginDevelopmentSkillName})
		if err != nil || !result.IsError {
			t.Fatalf("invalid source accepted: %+v, %v", result, err)
		}
	}
}

func TestBuiltinSkillTrustedActivationAndResourceReads(t *testing.T) {
	setSkillToolTestEnvironment(t)
	model.Conf.Variables = &kernelConf.Variables{Items: []*kernelConf.Variable{{Name: "PLUGIN_NAME", Value: "modified-by-user-variable"}}}
	operations := []string{}
	ctx := util.WithPluginDevelopmentAccess(context.Background(), func(operation string) (*util.PluginDevelopmentGrant, error) {
		operations = append(operations, operation)
		return &util.PluginDevelopmentGrant{SessionID: "session", TaskID: "task"}, nil
	})
	result, err := skillContextHandler(ctx, map[string]any{"action": "load", "source": "builtin", "name": util.PluginDevelopmentSkillName})
	if err != nil || result.IsError || strings.Join(operations, ",") != "load,loaded" {
		t.Fatalf("activation failed: %+v, %v, %v", result, err, operations)
	}
	text := result.Content[0].Text
	for _, expected := range []string{`source="builtin"`, `id="builtin:siyuan-plugin-development"`, `version="1.0.0"`, `digest="sha256:`, "${PLUGIN_NAME}"} {
		if !strings.Contains(text, expected) {
			t.Errorf("missing %q", expected)
		}
	}
	if strings.Contains(text, "modified-by-user-variable") || strings.Contains(text, "<skill_location") || len(text) >= util.MaxToolOutputChars {
		t.Fatalf("builtin content was expanded, exposed a path or exceeded output bounds")
	}
	operations = nil
	result, err = skillContextHandler(ctx, map[string]any{"source": "builtin", "name": util.PluginDevelopmentSkillName + "/references/development.md"})
	if err != nil || result.IsError || strings.Join(operations, ",") != "read" || !strings.Contains(result.Content[0].Text, "<skill_resource") {
		t.Fatalf("resource read activated skill: %+v, %v, %v", result, err, operations)
	}
	operations = nil
	model.Conf.AI.Agent.Skills.BuiltinDisabled = []string{util.BuiltinPluginSkillID}
	result, err = skillContextHandler(ctx, map[string]any{"source": "builtin", "name": util.PluginDevelopmentSkillName})
	if err != nil || !result.IsError || strings.Join(operations, ",") != "load" {
		t.Fatalf("disabled load activated skill: %+v, %v, %v", result, err, operations)
	}
	model.Conf.AI.Agent.Skills.BuiltinDisabled = nil
	ctx = util.WithPluginDevelopmentAccess(context.Background(), func(operation string) (*util.PluginDevelopmentGrant, error) {
		if operation == "loaded" {
			return nil, errors.New("choice revoked")
		}
		return &util.PluginDevelopmentGrant{SessionID: "session", TaskID: "task"}, nil
	})
	result, err = skillContextHandler(ctx, map[string]any{"source": "builtin", "name": util.PluginDevelopmentSkillName})
	if err != nil || !result.IsError || result.Content[0].Text != "choice revoked" {
		t.Fatalf("revoked choice disclosed body: %+v, %v", result, err)
	}
}

func setSkillToolTestEnvironment(t *testing.T) string {
	t.Helper()
	originalWorkspaceDir, originalDataDir := util.WorkspaceDir, util.DataDir
	originalHomeDir, originalConfDir := util.HomeDir, util.ConfDir
	originalConf := model.Conf

	root := t.TempDir()
	util.WorkspaceDir = filepath.Join(root, "workspace")
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.HomeDir = filepath.Join(root, "home")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	model.Conf = model.NewAppConf()
	model.Conf.AI = kernelConf.NewAI()
	model.Conf.Variables = &kernelConf.Variables{Items: []*kernelConf.Variable{{Name: "VALUE", Value: "resolved"}}}
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = originalWorkspaceDir, originalDataDir
		util.HomeDir, util.ConfDir = originalHomeDir, originalConfDir
		model.Conf = originalConf
	})
	return util.SkillsDir()
}

func writeSkillToolTestFile(t *testing.T, file, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestSkillLoadResolvesVariablesOnlyInInstructions(t *testing.T) {
	skillsRoot := setSkillToolTestEnvironment(t)
	skillDir := filepath.Join(skillsRoot, "skill-dir")
	writeSkillToolTestFile(t, filepath.Join(skillDir, "SKILL.md"),
		"---\nname: A&B\ndescription: description\n---\nbody {{vars.VALUE}}")
	writeSkillToolTestFile(t, filepath.Join(skillDir, "references", "spec&notes.md"), "{{vars.VALUE}}\n")

	activation, err := skillLoad(map[string]any{"name": "A&B"})
	if err != nil || activation.IsError {
		t.Fatalf("skillLoad(activation) = %#v, %v", activation, err)
	}
	activationText := activation.Content[0].Text
	for _, expected := range []string{
		`<skill_content name="A&amp;B">`,
		"body resolved",
		"<file>references/spec&amp;notes.md</file>",
		`<skill_location path="data/storage/ai/agent/skills/skill-dir">`,
		"use the `file` tool's read-only actions: `read`, `list`, `grep`, and `find`",
	} {
		if !strings.Contains(activationText, expected) {
			t.Errorf("activation output is missing %q:\n%s", expected, activationText)
		}
	}

	resource, err := skillLoad(map[string]any{"name": "A&B/references/spec&notes.md"})
	if err != nil || resource.IsError {
		t.Fatalf("skillLoad(resource) = %#v, %v", resource, err)
	}
	resourceText := resource.Content[0].Text
	if !strings.Contains(resourceText, `<skill_resource skill="A&amp;B" path="references/spec&amp;notes.md">`) ||
		!strings.Contains(resourceText, "{{vars.VALUE}}") {
		t.Fatalf("unexpected resource output:\n%s", resourceText)
	}
	for _, excluded := range []string{"<skill_resources", "<skill_location", "resolved"} {
		if strings.Contains(resourceText, excluded) {
			t.Errorf("resource output unexpectedly contains %q:\n%s", excluded, resourceText)
		}
	}

	truncated := formatSkillContent(&util.SkillLoadResult{Name: "truncated", ResourcesTruncated: true})
	if !strings.Contains(truncated, `<skill_resources truncated="true">`) {
		t.Fatalf("truncated empty manifest is not reported:\n%s", truncated)
	}
}

func TestSkillContentOmitsLocationForWorkspaceSymlinkEscape(t *testing.T) {
	skillsRoot := setSkillToolTestEnvironment(t)
	externalSkill := filepath.Join(t.TempDir(), "external-skill")
	writeSkillToolTestFile(t, filepath.Join(externalSkill, "SKILL.md"),
		"---\nname: external\ndescription: description\n---\nbody")
	if err := os.MkdirAll(skillsRoot, 0755); err != nil {
		t.Fatal(err)
	}
	linkedSkill := filepath.Join(skillsRoot, "external")
	if err := os.Symlink(externalSkill, linkedSkill); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}

	loaded, err := util.LoadSkill("external", nil)
	if err != nil {
		t.Fatal(err)
	}
	output := formatSkillContent(loaded)
	if strings.Contains(output, "<skill_location") {
		t.Fatalf("symlinked external skill exposed a file location:\n%s", output)
	}
}
