// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"testing"
)

func TestFlashcardDraftPreviewRealSourcesStayReadOnly(t *testing.T) {
	oldData, oldDB := util.DataDir, util.BlockTreeDBPath
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	treenode.InitBlockTree(true)
	defer func() {
		treenode.CloseDatabase()
		util.DataDir = oldData
		util.BlockTreeDBPath = oldDB
		if oldDB != "" {
			treenode.InitBlockTree(false)
		}
	}()
	boxID, docID := "20261116000000-preview", "20261116000001-preview"
	dir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(dir, ".siyuan"), 0700); err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(dir, ".siyuan", "conf.json")
	writeConf := func(value string) {
		t.Helper()
		if err := os.WriteFile(confPath, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeConf(`{"closed":false}`)
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Draft", "Draft")
	node := tree.Root.FirstChild
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("original question")})
	treenode.UpsertBlockTree(tree)
	engine := util.NewLute()
	data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
	sourcePath := filepath.Join(dir, docID+".sy")
	if err := os.WriteFile(sourcePath, data, 0600); err != nil {
		t.Fatal(err)
	}
	request := flashcardv2.AdvancedSourceRequest{SourceID: "draft", Mode: flashcardv2.AdvancedModeCloze, BlockIDs: []string{node.ID}}
	result, err := PreviewFlashcardV2AdvancedSource(context.Background(), request)
	if err != nil || len(result.Models) != 1 || result.DOMs[node.ID] == "" {
		t.Fatalf("real preview: %+v %v", result, err)
	}
	after, err := os.ReadFile(sourcePath)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("source changed", err)
	}
	entries, err := os.ReadDir(util.DataDir)
	if err != nil || len(entries) != 1 {
		t.Fatal("preview created data directories", err)
	}
	_, verify, err := readFlashcardV2DraftDOMs(context.Background(), request.BlockIDs)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(sourcePath, append(append([]byte{}, data...), '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	if verify() == nil {
		t.Fatal("source mutation was not rejected")
	}
	if err = os.WriteFile(sourcePath, data, 0600); err != nil {
		t.Fatal(err)
	}
	_, verify, err = readFlashcardV2DraftDOMs(context.Background(), request.BlockIDs)
	if err != nil {
		t.Fatal(err)
	}
	writeConf(`{"closed":true}`)
	if verify() == nil {
		t.Fatal("notebook closure was not rejected")
	}
	for _, conf := range []string{`{"closed":true}`, `{"encrypted":true}`, `invalid`} {
		writeConf(conf)
		if _, err = PreviewFlashcardV2AdvancedSource(context.Background(), request); err == nil {
			t.Fatalf("accepted notebook state %s", conf)
		}
	}
	request.BlockIDs = []string{"missing"}
	if _, err = PreviewFlashcardV2AdvancedSource(context.Background(), request); err == nil {
		t.Fatal("accepted missing source")
	}
}

func TestFlashcardDraftPreviewSnapshotValidation(t *testing.T) {
	request := flashcardv2.AdvancedSourceRequest{SourceID: "draft", Mode: flashcardv2.AdvancedModeCloze, BlockIDs: []string{"a"}}
	verified := false
	read := func(context.Context, []string) (map[string]string, func() error, error) {
		return map[string]string{"a": "<div>question</div>"}, func() error { verified = true; return nil }, nil
	}
	result, err := previewFlashcardV2AdvancedSource(context.Background(), request, read)
	if err != nil || !verified || len(result.Models) != 1 || result.DOMs["a"] != "<div>question</div>" {
		t.Fatalf("preview result: %+v %v", result, err)
	}
	rejected := func(context.Context, []string) (map[string]string, func() error, error) {
		return nil, nil, errors.New("closed, encrypted or missing")
	}
	if _, err = previewFlashcardV2AdvancedSource(context.Background(), request, rejected); err == nil {
		t.Fatal("ignored source rejection")
	}
	changed := func(context.Context, []string) (map[string]string, func() error, error) {
		return map[string]string{"a": "old"}, func() error { return errors.New("snapshot changed") }, nil
	}
	if _, err = previewFlashcardV2AdvancedSource(context.Background(), request, changed); err == nil {
		t.Fatal("returned stale snapshot")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = previewFlashcardV2AdvancedSource(ctx, request, read); err == nil {
		t.Fatal("ignored cancellation")
	}
	request.InlineOcclusions = []flashcardv2.AdvancedInlineOcclusion{{ID: "new-mark", BlockID: "a"}}
	if _, err = previewFlashcardV2AdvancedSource(context.Background(), request, read); err == nil {
		t.Fatal("accepted unsaved inline mark")
	}
}
