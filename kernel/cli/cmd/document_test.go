// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStructuredTitlesCLI(t *testing.T) {
	previousData, previousConf, previousDB, previousModel := util.DataDir, util.ConfDir, util.BlockTreeDBPath, model.Conf
	root := t.TempDir()
	util.DataDir, util.ConfDir, util.BlockTreeDBPath = filepath.Join(root, "data"), filepath.Join(root, "conf"), filepath.Join(root, "tree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.ConfDir, util.BlockTreeDBPath, model.Conf = previousData, previousConf, previousDB, previousModel
		if previousDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	box := &model.Box{ID: "20261023000000-cli0001"}
	bc := conf.NewBoxConf()
	bc.Name = "CLI"
	bc.Closed = false
	if err := box.SaveConf(bc); err != nil {
		t.Fatal(err)
	}
	plain := treenode.NewTree(box.ID, "/20261026000000-plain01.sy", "/Plain", "Plain")
	parent := treenode.NewTree(box.ID, "/20261026000001-parent1.sy", "/A", "A")
	child := treenode.NewTree(box.ID, "/20261026000001-parent1/20261026000002-child01.sy", "/A/B", "B")
	slash := treenode.NewTree(box.ID, "/20261026000003-slash01.sy", "/A/B", "A/B")
	leaf := treenode.NewTree(box.ID, "/20261026000003-slash01/20261026000004-leaf001.sy", "/A/B/C", "C")
	for _, tree := range []*parse.Tree{plain, parent, child, slash, leaf} {
		treenode.UpsertBlockTree(tree)
	}
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	if got, err := resolvePath(box.ID, "", "/Plain"); err != nil || got != plain.Path {
		t.Fatal(got, err)
	}
	if _, err := resolvePath(box.ID, "", "/A/B"); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
		t.Fatal(err)
	}
	if _, err := resolvePath(box.ID, "", "/A/B/C"); !errors.Is(err, documentaddressing.ErrLegacyPathUnsupported) {
		t.Fatal(err)
	}
	if _, err := resolveDocumentMovePath(box.ID, "", "/A/B/New", "New"); !errors.Is(err, documentaddressing.ErrPathAmbiguous) {
		t.Fatal(err)
	}
	if _, err := resolvePath(box.ID, "", "/missing"); err == nil {
		t.Fatal("missing target accepted")
	}
	const idPath = "/20261023000001-documen.sy"
	if got, err := resolvePath(box.ID, idPath, "/ignored"); err != nil || got != idPath {
		t.Fatal(got, err)
	}
	if got, err := resolvePath(box.ID, "", ""); err != nil || got != "/" {
		t.Fatal(got, err)
	}
	if err := treenode.SetDocumentMetadataState(box.ID, "building"); err != nil {
		t.Fatal(err)
	}
	if _, err := resolvePath(box.ID, "", "/Plain"); err == nil {
		t.Fatal("unready index accepted")
	}
}
