// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestWriteBlockWriteResult(t *testing.T) {
	originalOutputFormat := outputFormat
	defer func() {
		outputFormat = originalOutputFormat
	}()

	const id = "20260818000000-abcdefg"
	var output bytes.Buffer
	outputFormat = "table"
	if err := writeBlockWriteResult(&output, id); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(output.String()); got != id {
		t.Fatalf("unexpected table output: got %q, want %q", got, id)
	}

	output.Reset()
	outputFormat = "json"
	if err := writeBlockWriteResult(&output, id); err != nil {
		t.Fatal(err)
	}
	result := map[string]string{}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["id"] != id {
		t.Fatalf("unexpected JSON output: got %q, want %q", result["id"], id)
	}
}

func TestWriteBlockWriteResultRejectsEmptyID(t *testing.T) {
	if err := writeBlockWriteResult(&bytes.Buffer{}, ""); err == nil {
		t.Fatal("expected empty block ID to fail")
	}
}

func TestBlockDeleteRejectsMissingBlock(t *testing.T) {
	previous := dryRun
	t.Cleanup(func() { dryRun = previous })
	for _, dry := range []bool{false, true} {
		dryRun = dry
		command := &cobra.Command{}
		command.Flags().String("id", "20260913000000-missing", "")
		if err := blockDeleteCmd.RunE(command, nil); err == nil || !strings.Contains(err.Error(), "block not found") {
			t.Fatalf("missing block accepted (dry-run=%v): %v", dry, err)
		}
	}
}

func TestBlockDeleteRejectsDocumentAndReadFailure(t *testing.T) {
	previousData, previousDB, previousConf, previousDryRun := util.DataDir, util.BlockTreeDBPath, model.Conf, dryRun
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		cache.ClearTreeCache()
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf, dryRun = previousData, previousDB, previousConf, previousDryRun
		if previousDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	boxID, rootID, avID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Document", "Document")
	tree.Root.FirstChild.SetIALAttr(av.NodeAttrNameAvs, avID)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	docPath := filepath.Join(util.DataDir, boxID, tree.Path)
	before, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	command := &cobra.Command{}
	command.Flags().String("id", rootID, "")
	for _, dry := range []bool{false, true} {
		dryRun = dry
		if err := blockDeleteCmd.RunE(command, nil); err == nil || !strings.Contains(err.Error(), "document cannot be deleted") {
			t.Fatalf("document deletion accepted (dry=%v): %v", dry, err)
		}
		if after, err := os.ReadFile(docPath); err != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected deletion changed the document and its bindings")
		}
	}
	// An indexed body block whose source cannot be read must return a failure.
	dryRun = false
	_ = command.Flags().Set("id", tree.Root.FirstChild.ID)
	if err := os.WriteFile(docPath, []byte("invalid document"), 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearTreeCache()
	if err := blockDeleteCmd.RunE(command, nil); err == nil {
		t.Fatal("failed body-block deletion was reported as successful")
	}
}
