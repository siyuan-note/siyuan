// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"errors"
	"testing"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestDeferredAssetEffectsPreserveLocalReadsAndDeclareMaterialization(t *testing.T) {
	previousConf, previousAssets := model.Conf, deferredAssetsForEffects
	t.Cleanup(func() { model.Conf, deferredAssetsForEffects = previousConf, previousAssets })
	model.Conf = model.NewAppConf()
	sync := conf.NewSync()
	model.Conf.Sync.Store(sync)
	cases := []struct {
		tool   *Tool
		action string
	}{
		{ExportTool, "html"}, {ExportTool, "docx"}, {ExportTool, "sy"}, {ExportTool, "md-zip"}, {ExportTool, "data"},
		{PDFTool, "list"}, {PDFTool, "preview"}, {PDFTool, "extract"}, {ImageTool, "analyze"}, {AssetTool, "clean"},
	}
	for _, pending := range []bool{false, true} {
		deferredAssetsForEffects = func() ([]*entity.File, error) {
			if pending {
				return []*entity.File{{Path: "/assets/pending.pdf"}}, nil
			}
			return nil, nil
		}
		for _, enabled := range []bool{false, true} {
			sync.Enabled = enabled
			for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
				sync.Provider = provider
				for _, tc := range cases {
					want := tc.tool.ActionEffects[tc.action]
					if pending {
						want.LocalWrite = true
						if enabled && provider != conf.ProviderLocal {
							want.DataEgress, want.ExternalCost = true, true
						}
					}
					got, declared := tc.tool.EffectsFor(tc.action)
					if !declared || got != want {
						t.Errorf("%s.%s pending=%v enabled=%v provider=%d: %+v, want %+v", tc.tool.Name, tc.action, pending, enabled, provider, got, want)
					}
				}
			}
		}
	}
	sync.Enabled, sync.Provider, sync.LAN.Enabled = true, conf.ProviderLocal, true
	if effects, _ := PDFTool.EffectsFor("list"); !effects.LocalWrite || !effects.DataEgress || effects.ExternalCost {
		t.Fatalf("local LAN materialization effects: %+v", effects)
	}
	deferredAssetsForEffects = func() ([]*entity.File, error) { return nil, errors.New("unreadable metadata") }
	sync.Provider = conf.ProviderSiYuan
	if effects, _ := ExportTool.EffectsFor("html"); !effects.LocalWrite || !effects.DataEgress || !effects.ExternalCost {
		t.Fatalf("unreadable deferred metadata must be conservative: %+v", effects)
	}
	model.Conf = nil
	if effects, _ := PDFTool.EffectsFor("list"); !effects.LocalWrite || !effects.DataEgress || !effects.ExternalCost {
		t.Fatalf("missing configuration must be conservative: %+v", effects)
	}
}

func TestSnapshotFileEffectsDoNotDependOnCurrentDeferredList(t *testing.T) {
	previousConf, previousAssets := model.Conf, deferredAssetsForEffects
	t.Cleanup(func() { model.Conf, deferredAssetsForEffects = previousConf, previousAssets })
	model.Conf = model.NewAppConf()
	sync := conf.NewSync()
	model.Conf.Sync.Store(sync)
	deferredAssetsForEffects = func() ([]*entity.File, error) { return nil, nil }
	for _, enabled := range []bool{false, true} {
		sync.Enabled = enabled
		for _, action := range []string{"create", "checkout", "file_get", "file_open", "file_rollback", "file_export"} {
			effects, declared := RepoTool.EffectsFor(action)
			if !declared || !effects.LocalWrite || effects.DataEgress != enabled || effects.ExternalCost != enabled {
				t.Errorf("repo.%s enabled=%v effects=%+v", action, enabled, effects)
			}
		}
	}
}
