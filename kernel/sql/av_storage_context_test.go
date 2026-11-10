// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
	"testing"
)

func TestRelatedAttributeViewCacheHonorsStorageContext(t *testing.T) {
	oldData := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldData })
	source := &av.AttributeView{ID: ast.NewNodeID()}
	if err := source.SetStorageContext(""); err != nil {
		t.Fatal(err)
	}
	target := &av.AttributeView{ID: ast.NewNodeID(), Spec: av.CurrentSpec, Name: "ordinary target"}
	if err := target.SetStorageContext(""); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	for _, foreignBox := range []string{"", ast.NewNodeID()} {
		stale := &av.AttributeView{ID: target.ID, Name: "must not leak"}
		if foreignBox != "" {
			if err := stale.SetStorageContext(foreignBox); err != nil {
				t.Fatal(err)
			}
		}
		cached := map[string]*av.AttributeView{target.ID: stale}
		av.SetAVBoxID(target.ID, ast.NewNodeID())
		got := loadRelatedAttributeView(source, target.ID, cached)
		av.SetAVBoxID(target.ID, "")
		if got == nil || got.Name != target.Name || got == stale {
			t.Fatal("foreign or unscoped cached target escaped exact storage boundary")
		}
		if cached[target.ID] != got {
			t.Fatal("verified target did not replace foreign cache entry")
		}
	}
	missing := ast.NewNodeID()
	if got := loadRelatedAttributeView(source, missing, map[string]*av.AttributeView{missing: {ID: missing, Name: "foreign"}}); got != nil {
		t.Fatal("missing exact dependency fell back to cached foreign object")
	}
}
