// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDatabaseItemWritesRunAutomations(t *testing.T) {
	const child = "SIYUAN_TEST_CLI_DATABASE_AUTOMATION"
	if os.Getenv(child) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDatabaseItemWritesRunAutomations$", "-test.v")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("database automation subprocess: %v\n%s", err, output)
		}
		return
	}
	util.QueueDir = filepath.Join(t.TempDir(), "queue")
	previousLang, previousAVLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "select": "Select", "table": "Table"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = previousLang, previousAVLangs })
	previousData, previousConf, previousDryRun := util.DataDir, model.Conf, dryRun
	util.DataDir, model.Conf, dryRun = t.TempDir(), model.NewAppConf(), false
	model.Conf.Sync.Store(conf.NewSync())
	t.Cleanup(func() { util.DataDir, model.Conf, dryRun = previousData, previousConf, previousDryRun })
	view := av.NewAttributeView(ast.NewNodeID())
	keyID := ast.NewNodeID()
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Result", Type: av.KeyTypeText}})
	for _, trigger := range []string{"added", "changed"} {
		rule := &av.AutomationRule{ID: ast.NewNodeID(), Name: trigger, Enabled: true, Trigger: trigger,
			Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
				keyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: trigger}}},
			}}}}
		if trigger == "changed" {
			rule.KeyID = keyID
		}
		view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{rule}}
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		cmd := databaseItemAddCmd
		flags := map[string]string{"av": view.ID, "detached": "true", "content": "Task"}
		if trigger == "changed" {
			cmd = databaseItemUpdateCmd
			flags = map[string]string{"av": view.ID, "key": keyID, "item": view.GetBlockKeyValues().Values[0].BlockID,
				"value": `{"text":{"content":"manual"}}`}
		}
		for key, value := range flags {
			flag := cmd.Flags().Lookup(key)
			previous := flag.Value.String()
			t.Cleanup(func() { _ = flag.Value.Set(previous) })
			if err := cmd.Flags().Set(key, value); err != nil {
				t.Fatal(err)
			}
		}
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatal(err)
		}
		var err error
		view, err = av.ParseAttributeView(view.ID)
		if err != nil {
			t.Fatal(err)
		}
		rows := view.GetBlockKeyValues().Values
		if len(rows) != 1 || view.GetValue(keyID, rows[0].BlockID).Text.Content != trigger {
			t.Fatalf("%s automation did not run exactly once: %+v", trigger, view)
		}
	}
}
