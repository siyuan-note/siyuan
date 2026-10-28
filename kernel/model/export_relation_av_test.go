// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportRelationAVErrors(t *testing.T) {
	for _, depth := range []int{1, 2} {
		for _, failure := range []string{"parse", "read", "write", "missing", "none"} {
			t.Run(strings.Repeat("nested/", depth)+failure, func(t *testing.T) {
				const boxID = "20261027010000-box0001"
				setupExportRelatedTest(t, boxID)
				t.Cleanup(cache.ClearAVCache)
				setupAttributeViewRefI18n(t)
				previousLangs := util.Langs
				util.Langs = map[string]map[int]string{"en": {382: "Cannot export database [%s]"}}
				Conf.Lang = "en"
				t.Cleanup(func() { util.Langs = previousLangs })
				ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
				for i := depth; i >= 0; i-- {
					database := av.NewAttributeView(ids[i])
					if i < depth {
						database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: &av.Key{
							ID: ast.NewNodeID(), Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: ids[i+1]},
						}})
					}
					if err := av.SaveAttributeView(database); err != nil {
						t.Fatal(err)
					}
				}
				target := filepath.Join(util.DataDir, "storage", "av", ids[depth]+".json")
				out := t.TempDir()
				if failure == "parse" {
					// SaveAttributeView has populated the cache; export must still verify the source.
					if err := os.WriteFile(target, []byte("{"), 0644); err != nil {
						t.Fatal(err)
					}
				} else if failure == "read" || failure == "missing" {
					if err := os.Remove(target); err != nil {
						t.Fatal(err)
					}
					if failure == "read" {
						if err := os.Mkdir(target, 0755); err != nil {
							t.Fatal(err)
						}
					}
				} else if failure == "write" {
					if err := os.Mkdir(filepath.Join(out, ids[depth]+".json"), 0755); err != nil {
						t.Fatal(err)
					}
				}
				err := exportAv(ids[0], "", out, out, nil)
				wantError := failure == "parse" || failure == "read" || failure == "write"
				if (err != nil) != wantError || (err != nil && !strings.Contains(err.Error(), ids[depth])) {
					t.Fatalf("unexpected cascade result: %v", err)
				}
				if failure == "write" {
					return
				}
				tree := treenode.NewTree(boxID, "/"+ast.NewNodeID()+".sy", "/Notes", "Notes")
				tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: ids[0]})
				writeExportRelatedTestTree(t, tree)
				uri := exportSYZip(boxID, "/", "Notes", []string{tree.Path}, false)
				if wantError {
					if uri != "" {
						t.Fatalf("incomplete archive published: %q", uri)
					}
					if _, statErr := os.Stat(filepath.Join(util.TempDir, "export", "Notes.sy.zip")); !os.IsNotExist(statErr) {
						t.Fatalf("failed cascade published an archive: %v", statErr)
					}
				} else {
					if uri == "" {
						t.Fatal("valid or dangling cascade failed")
					}
					archive := openExportArchive(t, uri)
					for i := 0; i <= depth; i++ {
						present := findArchiveFile(archive.File, "Notes/storage/av/"+ids[i]+".json") != nil
						if present != !(failure == "missing" && i == depth) {
							t.Fatalf("unexpected archived database %s: %v", ids[i], present)
						}
					}
				}
			})
		}
	}
}
