// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationDetailCreatedDocumentCleanupConflicts(t *testing.T) {
	for _, mode := range []string{"unchanged", "edited-leaf", "moved-leaf", "new-child", "new-reference", "new-binding", "captured-body-binding"} {
		t.Run(mode, func(t *testing.T) {
			f, _, _ := setupRelationDetailMutation(t)
			template := &av.NewItemTemplate{ID: ast.NewNodeID(), TargetType: av.NewItemTargetDocument,
				PrimaryKeyTemplate: "Owned leaf", SaveLocation: &av.NewItemSaveLocation{BoxID: f.files.box.ID, PathTemplate: "/Owned parent/"}}
			preview, err := resolveAttributeViewNewItemTemplateWithDocumentContext("", "", template, time.Now(), "", true)
			if err != nil {
				t.Fatal(err)
			}
			recorder := &relationCreatedDocuments{files: map[string]*documentSourceFile{}}
			id, tree, err := createAttributeViewItemDocumentWithMarkdown(preview, template, nil, recorder)
			if err != nil {
				t.Fatal(err)
			}
			if len(recorder.files) != 2 {
				t.Fatalf("expected exact parent and leaf sources: %d", len(recorder.files))
			}
			name := filepath.Join(util.DataDir, tree.Box, tree.Path)
			var extra string
			switch mode {
			case "captured-body-binding":
				tree.Root.FirstChild.SetIALAttr(av.NodeAttrNameAvs, ast.NewNodeID())
				err = recorder.recordOwnWrite(tree, func() error { _, writeErr := filesys.WriteTree(tree); return writeErr })
			case "moved-leaf":
				newPath := "/" + id + ".sy"
				err = os.Rename(name, filepath.Join(util.DataDir, tree.Box, newPath))
				tree.Path = newPath
				name = filepath.Join(util.DataDir, tree.Box, tree.Path)
				treenode.UpsertBlockTree(tree)
				if writeErr := recorder.recordOwnWrite(tree, func() error { t.Fatal("moved document was reclaimed"); return nil }); writeErr == nil {
					t.Fatal("moved document accepted")
				}
			case "edited-leaf":
				tree.Root.SetIALAttr("title", "Concurrent edit")
				_, err = filesys.WriteTree(tree)
			case "new-binding":
				tree.Root.SetIALAttr("custom-avs", ast.NewNodeID())
				_, err = filesys.WriteTree(tree)
			case "new-child":
				parent := filepath.Dir(tree.Path)
				child := treenode.NewTree(tree.Box, filepath.Join(parent, ast.NewNodeID()+".sy"), "/Owned parent/Concurrent child", "Concurrent child")
				_, err = filesys.WriteTree(child)
				extra = filepath.Join(util.DataDir, child.Box, child.Path)
			case "new-reference":
				sql.FlushQueue()
				err = sql.Exec("INSERT INTO refs (root_id, def_block_root_id) VALUES (?, ?)", f.files.sourceID, id)
			}
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			err = recorder.cleanup()
			if mode == "unchanged" {
				if err != nil {
					t.Fatal(err)
				}
				for _, file := range recorder.files {
					filename, _ := file.filename()
					if _, err = os.Stat(filename); !os.IsNotExist(err) {
						t.Fatalf("owned source remains: %s", filename)
					}
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), id) || !strings.Contains(err.Error(), tree.Box+":"+tree.Path) {
				t.Fatalf("conflict must report retained identity and location: %v", err)
			}
			after, err := os.ReadFile(name)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("conflicting leaf was changed: %v", err)
			}
			for retainedID, file := range recorder.files {
				if mode == "moved-leaf" && retainedID == id {
					continue
				}
				filename, _ := file.filename()
				if _, err = os.Stat(filename); err != nil {
					t.Fatalf("conflict removed ancestor or leaf: %v", err)
				}
			}
			if extra != "" {
				if _, err = os.Stat(extra); err != nil {
					t.Fatalf("concurrent child removed: %v", err)
				}
			}
		})
	}
}

func TestRelationDetailCreatedDocumentCleanupAfterNativeMove(t *testing.T) {
	f, _, _ := setupRelationDetailMutation(t)
	template := &av.NewItemTemplate{ID: ast.NewNodeID(), TargetType: av.NewItemTargetDocument,
		PrimaryKeyTemplate: "Owned leaf", SaveLocation: &av.NewItemSaveLocation{BoxID: f.files.box.ID, PathTemplate: "/"}}
	preview, err := resolveAttributeViewNewItemTemplateWithDocumentContext("", "", template, time.Now(), "", true)
	if err != nil {
		t.Fatal(err)
	}
	recorder := &relationCreatedDocuments{files: map[string]*documentSourceFile{}}
	id, tree, err := createAttributeViewItemDocumentWithMarkdown(preview, template, nil, recorder)
	if err != nil {
		t.Fatal(err)
	}
	other, err := CreateBox("Moved destination")
	if err != nil {
		t.Fatal(err)
	}
	destination := &Box{ID: other}
	configuration := destination.GetConf()
	configuration.Closed = false
	if err = destination.SaveConf(configuration); err != nil {
		t.Fatal(err)
	}
	if Conf.Box(other) == nil {
		t.Fatal("destination notebook not open")
	}
	if err = MoveDocs([]string{tree.Path}, other, "/", nil); err != nil {
		t.Fatalf("native move: %v", err)
	}
	sql.FlushQueue()
	moved := treenode.GetBlockTreeInExactBox(id, other)
	if moved == nil {
		t.Fatal("native move did not establish destination identity")
	}
	if moved.Path != recorder.files[id].Path {
		t.Fatal("root move must retain its path while changing notebooks")
	}
	filename := filepath.Join(util.DataDir, other, moved.Path)
	before, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	err = recorder.cleanup()
	after, readErr := os.ReadFile(filename)
	if readErr != nil || !bytes.Equal(before, after) {
		t.Fatalf("moved document was changed: %v", readErr)
	}
	if err == nil || !strings.Contains(err.Error(), "created documents retained for recovery") ||
		!strings.Contains(err.Error(), id) || !strings.Contains(err.Error(), other+":"+moved.Path) {
		t.Fatalf("cleanup must report retained moved identity and location: %v", err)
	}
}

func TestRelationDetailCreatedDocumentCurrentIdentityStaysInStorageScope(t *testing.T) {
	f, _, _ := setupRelationDetailMutation(t)
	id := f.files.sourceID
	ordinary := treenode.GetBlockTreeInExactBox(id, f.files.box.ID)
	if ordinary == nil {
		t.Fatal("missing ordinary document fixture")
	}
	encryptedBox := ast.NewNodeID()
	markRuntimeEncryptedBox(encryptedBox)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(encryptedBox) })
	if current := relationCreatedDocumentCurrentTree(id, &documentSourceFile{Box: encryptedBox, Path: ordinary.Path}); current != nil {
		t.Fatalf("encrypted source fell back to an ordinary twin: %+v", current)
	}
	if current := relationCreatedDocumentCurrentTree(id, &documentSourceFile{Box: f.files.box.ID, Path: ordinary.Path}); current == nil || current.BoxID != f.files.box.ID {
		t.Fatalf("ordinary source lost its current identity: %+v", current)
	}
	markRuntimeEncryptedBox(f.files.box.ID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(f.files.box.ID) })
	if current := relationCreatedDocumentCurrentTree(id, &documentSourceFile{Box: ast.NewNodeID(), Path: ordinary.Path}); current != nil {
		t.Fatalf("ordinary source accepted an encrypted index entry: %+v", current)
	}
}
