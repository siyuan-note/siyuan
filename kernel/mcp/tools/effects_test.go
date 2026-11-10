// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestNativeToolEffectsCoverEveryAction(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	for _, tool := range GetAllTools() {
		if tool.Source != "native" {
			continue
		}
		actions := tool.InputSchema.Properties["action"].Enum
		if len(actions) == 0 {
			actions = []string{""}
		}
		for _, action := range actions {
			if _, declared := tool.EffectsFor(action); !declared {
				t.Errorf("%s.%s has no effect declaration", tool.Name, action)
			}
		}
	}
}

func TestNativeToolWriteAndNetworkEffects(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	cases := []struct {
		tool    *Tool
		action  string
		effects ToolEffects
	}{
		{AttrTool, "set", ToolEffects{LocalWrite: true}},
		{BlockTool, "append", ToolEffects{LocalWrite: true}},
		{NotebookTool, "open", ToolEffects{LocalWrite: true}},
		{NotebookTool, "close", ToolEffects{LocalWrite: true}},
		{RefTool, "refresh", ToolEffects{LocalWrite: true}},
		{ImportTool, "data", ToolEffects{LocalWrite: true}},
		{HistoryTool, "rollback", ToolEffects{LocalWrite: true}},
		{RepoTool, "create", ToolEffects{LocalWrite: true}},
		{RepoTool, "file_export", ToolEffects{LocalWrite: true}},
		{RepoTool, "file_open", ToolEffects{LocalRead: true, LocalWrite: true}},
		{ExportTool, "html", ToolEffects{LocalRead: true}},
		{ExportTool, "data", ToolEffects{LocalWrite: true}},
		{UnzipTool, "", ToolEffects{LocalRead: true, LocalWrite: true}},
		{HTTPRequestTool, "", ToolEffects{LocalWrite: true, DataEgress: true, ExternalCost: true}},
		{HTTPRequestTool, "get", ToolEffects{LocalWrite: true, DataEgress: true, ExternalCost: true}},
		{HTTPRequestTool, "post", ToolEffects{LocalWrite: true, DataEgress: true, ExternalCost: true}},
		{InboxTool, "list", ToolEffects{DataEgress: true, ExternalCost: true}},
		{InboxTool, "convert", ToolEffects{LocalWrite: true, DataEgress: true, ExternalCost: true}},
		{BazaarTool, "installed", ToolEffects{LocalRead: true}},
		{BazaarTool, "readme", ToolEffects{LocalRead: true, DataEgress: true}},
		{BazaarTool, "updates", ToolEffects{LocalRead: true, DataEgress: true}},
		{BazaarTool, "install", ToolEffects{LocalRead: true, LocalWrite: true, DataEgress: true}},
		{SkillTool, "install", ToolEffects{LocalWrite: true, DataEgress: true}},
		{QuestionTool, "", ToolEffects{}},
		{TodoWriteTool, "", ToolEffects{}},
	}
	for _, tc := range cases {
		t.Run(tc.tool.Name+"/"+tc.action, func(t *testing.T) {
			if actual, declared := tc.tool.EffectsFor(tc.action); !declared || actual != tc.effects {
				t.Fatalf("effects = %+v, declared = %v; want %+v", actual, declared, tc.effects)
			}
		})
	}
}

func TestSyncToolEffectsFollowProvider(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal, -1} {
		model.Conf = model.NewAppConf()
		config := conf.NewSync()
		config.Provider = provider
		model.Conf.Sync.Store(config)
		for _, action := range []string{"perform", "upload", "download"} {
			effects, declared := SyncTool.EffectsFor(action)
			remote := provider != conf.ProviderLocal
			if !declared || !effects.LocalRead || !effects.LocalWrite || effects.DataEgress != remote || effects.ExternalCost != remote {
				t.Errorf("provider %d, %s: %+v, declared=%v", provider, action, effects, declared)
			}
		}
		if effects, declared := SyncTool.EffectsFor("status"); !declared || effects != (ToolEffects{LocalRead: true}) {
			t.Errorf("provider %d status is not a pure local read: %+v", provider, effects)
		}
	}
	model.Conf.Sync.Load().Provider = conf.ProviderLocal
	model.Conf.Sync.Load().LAN.Enabled = true
	if effects, declared := SyncTool.EffectsFor("perform"); !declared || !effects.DataEgress || effects.ExternalCost {
		t.Fatalf("local-directory LAN sync must declare peer traffic without storage charges: %+v", effects)
	}
	for _, config := range []*model.AppConf{nil, model.NewAppConf()} {
		model.Conf = config
		if config != nil {
			config.Sync.Store(nil)
		}
		for _, action := range []string{"perform", "upload", "download"} {
			effects, declared := SyncTool.EffectsFor(action)
			if !declared || !effects.LocalWrite || !effects.DataEgress || !effects.ExternalCost {
				t.Errorf("missing configuration is not conservative: %+v", effects)
			}
		}
	}
	if _, declared := SyncTool.EffectsFor("unknown"); declared {
		t.Fatal("unknown sync action has effects")
	}
}

func TestNativeEffectManifestSerialization(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	for _, provider := range []int{conf.ProviderLocal, conf.ProviderSiYuan} {
		config := conf.NewSync()
		config.Provider = provider
		model.Conf.Sync.Store(config)
		encoded, err := json.Marshal(ListCapabilityManifests())
		if err != nil {
			t.Fatal(err)
		}
		var manifests []CapabilityManifest
		if err = json.Unmarshal(encoded, &manifests); err != nil {
			t.Fatal(err)
		}
		for _, manifest := range manifests {
			tool := GetTool(manifest.Name)
			if tool.Source != "native" {
				continue
			}
			for _, action := range manifest.Actions {
				want, declared := tool.EffectsFor(action.Name)
				if !declared || action.Effects != want {
					t.Errorf("serialized %s.%s effects = %+v; want %+v", tool.Name, action.Name, action.Effects, want)
				}
			}
			if len(manifest.Actions) == 0 {
				want, declared := tool.EffectsFor("")
				if !declared || manifest.Effects != want {
					t.Errorf("serialized %s effects = %+v; want %+v", tool.Name, manifest.Effects, want)
				}
			}
		}
	}
}
