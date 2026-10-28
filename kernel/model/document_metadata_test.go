// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentMetadataSourceRecovery(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_DOCUMENT_METADATA") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentMetadataSourceRecovery$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_DOCUMENT_METADATA=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("metadata source subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Metadata", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	tree := newHPathTestDoc(t, box.ID, "/", "Saved", 1)
	if err := treenode.SetDocumentMetadataState(box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	stale, source, err := filesys.LoadTreeSnapshot(box.ID, tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("title", "Current")
	tree.HPath = "/Current"
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, tree.Path))
	stale.Root.SetIALAttr("title", "Rejected")
	treenode.UpsertBlockTreePending(stale)
	if _, err = filesys.WriteTreeIfUnchanged(stale, source); !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("conditional save did not fail", err)
	}
	meta, err := treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.Title.Text != "Current" {
		t.Fatalf("failed source save published a title: %+v, %v", meta, err)
	}
	if err = recoverDocumentMetadata(box.ID); err != nil {
		t.Fatal(err)
	}
	meta, err = treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.Title.Text != "Current" || treenode.DocumentMetadataState(box.ID) != "ready" {
		t.Fatalf("recovery did not use authenticated source: %+v, %v", meta, err)
	}
	after, _ := os.ReadFile(filepath.Join(util.DataDir, box.ID, tree.Path))
	if !bytes.Equal(current, after) {
		t.Fatal("metadata recovery rewrote source content")
	}
	// 源已经落盘、摘要提交前中断，恢复时必须采用新源，而不是旧摘要或待写入意图。
	tree.Root.SetIALAttr("title", "Recovered source")
	luteEngine := util.NewLute()
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	if _, err = treenode.BeginDocumentMetadataWrite(tree); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, box.ID, tree.Path), data, 0644); err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentMetadata(box.ID); err != nil {
		t.Fatal(err)
	}
	meta, err = treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.Title.Text != "Recovered source" {
		t.Fatalf("crash recovery retained old metadata: %+v, %v", meta, err)
	}
	// 从未创建成功的源不能因恢复而变成空文档。
	unwritten := treenode.NewTree(box.ID, "/"+ast.NewNodeID()+".sy", "/Unwritten", "Unwritten")
	treenode.UpsertBlockTreePending(unwritten)
	if _, err = treenode.BeginDocumentMetadataWrite(unwritten); err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentMetadata(box.ID); err != nil {
		t.Fatal(err)
	}
	if treenode.GetBlockTreeInExactBox(unwritten.ID, box.ID) != nil {
		t.Fatal("failed creation retained an addressable document")
	}
	// 原始文件接口也必须发布源标题，失败的移动保留原位置，成功移动及删除更新身份索引。
	tree.Root.SetIALAttr("title", "Raw source")
	data = render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	sourcePath := filepath.Join(util.DataDir, box.ID, tree.Path)
	if err = WriteFileWithDocumentAddressing(sourcePath, data); err != nil {
		t.Fatal(err)
	}
	meta, err = treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.Title.Text != "Raw source" || treenode.DocumentMetadataState(box.ID) != "ready" {
		t.Fatalf("raw write left stale metadata: %+v, %v", meta, err)
	}
	parent := newHPathTestDoc(t, box.ID, "/", "Destination", 1)
	destination := filepath.Join(util.DataDir, box.ID, parent.ID, tree.ID+".sy")
	failedMove := errors.New("injected move failure")
	if err = MutateDocumentAddressingFiles(sourcePath, destination, func() error { return failedMove }); !errors.Is(err, failedMove) {
		t.Fatal(err)
	}
	meta, err = treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.Path != tree.Path || treenode.DocumentMetadataState(box.ID) != "ready" {
		t.Fatalf("failed move lost existing document: %+v, %v", meta, err)
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		t.Fatal(err)
	}
	if err = MutateDocumentAddressingFiles(sourcePath, destination, func() error {
		return filelock.RenameWithoutFatal(sourcePath, destination)
	}); err != nil {
		t.Fatal(err)
	}
	meta, err = treenode.GetDocumentMetadata(box.ID, tree.ID)
	if err != nil || meta.ParentID == nil || *meta.ParentID != parent.ID {
		t.Fatalf("raw move retained old parent: %+v, %v", meta, err)
	}
	if err = MutateDocumentAddressingFiles(destination, "", func() error {
		return filelock.RemoveWithoutFatal(destination)
	}); err != nil {
		t.Fatal(err)
	}
	if treenode.GetBlockTreeInExactBox(tree.ID, box.ID) != nil {
		t.Fatal("raw deletion retained document identity")
	}
	if err = treenode.SetDocumentMetadataState(box.ID, "error"); err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentMetadata(box.ID); !errors.Is(err, treenode.ErrDocumentMetadataUnavailable) {
		t.Fatal("failed full index was silently declared ready", err)
	}
}
