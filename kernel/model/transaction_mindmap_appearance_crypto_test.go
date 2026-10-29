// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListMindmapAppearanceEncrypted(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_MINDMAP_APPEARANCE") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestListMindmapAppearanceEncrypted$")
		command.Env = append(os.Environ(), "SIYUAN_TEST_MINDMAP_APPEARANCE=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted appearance subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	const password = "mindmap-appearance-test"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Appearance", password)
	if err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	docID := ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Appearance", "Appearance")
	engine := util.NewLute()
	_, source := engine.Md2BlockDOMTree("- Root\n  - Alpha\n  - Beta\n", false)
	list := firstContentBlock(source.Root)
	list.Unlink()
	list.SetIALAttr(listMindmapViewAttr, "1")
	var ids []string
	ast.Walk(list, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeListItem {
			ids = append(ids, node.ID)
		}
		return ast.WalkContinue
	})
	legacy, err := os.ReadFile("testdata/list_mindmap_summary_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	original := strings.NewReplacer(`"root"`, `"`+ids[0]+`"`, `"a"`, `"`+ids[1]+`"`, `"b"`, `"`+ids[2]+`"`).Replace(strings.TrimSpace(string(legacy)))
	list.SetIALAttr(listMindmapMetadataAttr, original)
	tree.Root.AppendChild(list)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	filename := filepath.Join(util.DataDir, boxID, tree.Path)
	before, _ := os.ReadFile(filename)
	if !util.IsCiphertext(before) {
		t.Fatal("legacy document was not encrypted")
	}
	historyDir := filepath.Join(util.HistoryDir, "20261022000000-update")
	generateTreeHistory(tree, historyDir)
	historyFile := filepath.Join(historyDir, boxID, docID+".sy")
	backup, _ := os.ReadFile(historyFile)
	if !bytes.Equal(backup, before) {
		t.Fatal("history did not preserve the legacy ciphertext")
	}
	var data map[string]any
	_ = json.Unmarshal([]byte(original), &data)
	appearance := map[string]any{"version": 1, "palette": []string{"#2563eb", "#15803d"}, "backgroundColor": "#1e1e1e"}
	data["appearance"] = appearance
	legacyStyled, _ := json.Marshal(data)
	appearance["rootColor"] = "#1e293b"
	appearance["nodeStyle"] = "layered"
	data["nodes"].(map[string]any)[ids[1]].(map[string]any)["branchColor"] = 0
	styled, _ := json.Marshal(data)
	appearance["nodeStyle"] = "branch"
	referenceStyled, _ := json.Marshal(data)
	for _, value := range []string{string(legacyStyled), string(styled), string(referenceStyled), string(styled), original, string(referenceStyled)} {
		attrs, _ := json.Marshal(map[string]string{listMindmapMetadataAttr: value})
		tx := &Transaction{DoOperations: []*Operation{{Action: "setAttrs", ID: list.ID, Data: string(attrs)}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		read, readErr := LoadTreeByBlockID(docID)
		if readErr != nil || treenode.GetNodeInTree(read, list.ID).IALAttr(listMindmapMetadataAttr) != value {
			t.Fatalf("appearance update or undo lost metadata: %v", readErr)
		}
		ciphertext, _ := os.ReadFile(filename)
		if !util.IsCiphertext(ciphertext) || bytes.Contains(ciphertext, []byte("palette")) || bytes.Contains(ciphertext, []byte("rootColor")) {
			t.Fatal("appearance update wrote plaintext")
		}
	}
	relative, _ := filepath.Rel(util.WorkspaceDir, historyFile)
	_, _, content, _, err := GetDocHistoryContent(relative, "", false)
	if err != nil || !strings.Contains(content, "Legacy summary") || strings.Contains(content, "#2563eb") || strings.Contains(content, "#1e293b") {
		t.Fatalf("legacy history cannot recover the original content: %v", err)
	}
	archivePath := exportSYZip(boxID, "/", "Appearance", []string{tree.Path}, false)
	if archivePath == "" {
		t.Fatal("encrypted document export failed")
	}
	archive := openExportArchive(t, archivePath)
	entry := findArchiveFile(archive.File, "Appearance/"+docID+".sy")
	if entry == nil {
		t.Fatal("export omitted the styled document")
	}
	reader, err := entry.Open()
	if err != nil {
		t.Fatal(err)
	}
	exported, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil || !json.Valid(exported) || !bytes.Contains(exported, []byte("#2563eb")) ||
		!bytes.Contains(exported, []byte("#1e293b")) || !bytes.Contains(exported, []byte("branch")) ||
		!bytes.Contains(exported, []byte("Legacy summary")) {
		t.Fatalf("export lost the appearance or legacy content: %v", err)
	}
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	recovered, err := LoadTreeByBlockID(docID)
	if err != nil || treenode.GetNodeInTree(recovered, list.ID).IALAttr(listMindmapMetadataAttr) != original {
		t.Fatalf("legacy history recovery lost the original metadata: %v", err)
	}
}
