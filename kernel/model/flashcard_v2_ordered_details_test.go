// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestOrderedDetailsRealDOMsRemainReadOnly(t *testing.T) {
	oldData, oldDB := util.DataDir, util.BlockTreeDBPath
	root := t.TempDir()
	util.DataDir, util.BlockTreeDBPath = filepath.Join(root, "data"), filepath.Join(root, "blocktree.db")
	treenode.InitBlockTree(true)
	defer func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = oldData, oldDB
		if oldDB != "" {
			treenode.InitBlockTree(false)
		}
	}()
	boxID, docID := "20261117000000-details", "20261117000001-details"
	dir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(dir, ".siyuan"), 0700); err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(dir, ".siyuan", "conf.json")
	if err := os.WriteFile(confPath, []byte(`{"closed":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Ordered", "Ordered")
	node := tree.Root.FirstChild
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("recognizable step")})
	treenode.UpsertBlockTree(tree)
	engine := util.NewLute()
	data := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
	path := filepath.Join(dir, docID+".sy")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	snapshot := flashcardv2.OrderedSourceSnapshot{SourceRevision: flashcardv2.EntityRevision{RevisionID: "revision"}, References: []flashcardv2.CardSourceRef{{ID: "ref", EntityType: "block", EntityID: node.ID}}}
	read := func(context.Context, string) (flashcardv2.OrderedSourceSnapshot, error) { return snapshot, nil }
	result, err := readFlashcardV2OrderedDetails(context.Background(), "source", read, readFlashcardV2DraftDOMs)
	if err != nil || result.DOMs[node.ID] == "" || len(result.ContentFingerprint) != 64 {
		t.Fatal("real details failed", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("details changed source", err)
	}
	entries, err := os.ReadDir(util.DataDir)
	if err != nil || len(entries) != 1 {
		t.Fatal("details created storage", err)
	}
	for _, body := range []string{`{"closed":true}`, `{"encrypted":true}`, `invalid`} {
		if err = os.WriteFile(confPath, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = readFlashcardV2OrderedDetails(context.Background(), "source", read, readFlashcardV2DraftDOMs); err == nil {
			t.Fatal("restricted notebook accepted", body)
		}
	}
}

func TestOrderedDetailsRejectMixedSnapshotsAndContentChanges(t *testing.T) {
	snapshot := flashcardv2.OrderedSourceSnapshot{SourceRevision: flashcardv2.EntityRevision{RevisionID: "revision"}, References: []flashcardv2.CardSourceRef{{ID: "ref", EntityType: "block", EntityID: "block"}}}
	read := func(context.Context, string) (flashcardv2.OrderedSourceSnapshot, error) { return snapshot, nil }
	content := "<div>original</div>"
	verified := 0
	doms := func(context.Context, []string) (map[string]string, func() error, error) {
		return map[string]string{"block": content}, func() error { verified++; return nil }, nil
	}
	first, err := readFlashcardV2OrderedDetails(context.Background(), "source", read, doms)
	if err != nil {
		t.Fatal(err)
	}
	second, err := readFlashcardV2OrderedDetails(context.Background(), "source", read, doms)
	if err != nil || !reflect.DeepEqual(first, second) || verified != 2 {
		t.Fatal("unstable snapshot", err)
	}
	content = "<div>changed</div>"
	changed, err := readFlashcardV2OrderedDetails(context.Background(), "source", read, doms)
	if err != nil || changed.ContentFingerprint == first.ContentFingerprint {
		t.Fatal("content fingerprint did not change", err)
	}
	for _, kind := range []string{"source", "reference"} {
		calls := 0
		mixed := func(context.Context, string) (flashcardv2.OrderedSourceSnapshot, error) {
			calls++
			next := snapshot
			if calls == 2 {
				if kind == "source" {
					next.SourceRevision.RevisionID = "other"
				} else {
					next.References = append([]flashcardv2.CardSourceRef(nil), snapshot.References...)
					next.References[0].Role = "changed"
				}
			}
			return next, nil
		}
		if _, err = readFlashcardV2OrderedDetails(context.Background(), "source", mixed, doms); err == nil {
			t.Fatal("mixed snapshot accepted", kind)
		}
	}
	unstable := func(context.Context, []string) (map[string]string, func() error, error) {
		return map[string]string{"block": "content"}, func() error { return errors.New("changed during snapshot") }, nil
	}
	if _, err = readFlashcardV2OrderedDetails(context.Background(), "source", read, unstable); err == nil {
		t.Fatal("failed verification accepted")
	}
}

func TestOrderedReorderFingerprintBeforeWriteAndSuccessfulReplay(t *testing.T) {
	request := FlashcardV2ReorderSourceRequest{ReorderAdvancedSourceRequest: flashcardv2.ReorderAdvancedSourceRequest{ExpectedRevisionID: "revision"}, ContentFingerprint: "expected"}
	found := false
	replay := func(context.Context, flashcardv2.ReorderAdvancedSourceRequest) (flashcardv2.ReorderAdvancedSourceResult, bool, error) {
		return flashcardv2.ReorderAdvancedSourceResult{UpdatedCardIDs: []string{"saved"}}, found, nil
	}
	reads, writes := 0, 0
	fingerprint := "changed"
	read := func(context.Context) (FlashcardV2OrderedSourceDetails, error) {
		reads++
		return FlashcardV2OrderedSourceDetails{SourceRevision: flashcardv2.EntityRevision{RevisionID: "revision"}, ContentFingerprint: fingerprint}, nil
	}
	apply := func(context.Context, flashcardv2.ReorderAdvancedSourceRequest) (flashcardv2.ReorderAdvancedSourceResult, error) {
		writes++
		return flashcardv2.ReorderAdvancedSourceResult{}, nil
	}
	if _, err := applyFlashcardV2ReorderWithFingerprint(context.Background(), request, replay, read, apply); err == nil || writes != 0 {
		t.Fatal("changed content was written")
	}
	fingerprint = "expected"
	if _, err := applyFlashcardV2ReorderWithFingerprint(context.Background(), request, replay, read, apply); err != nil || writes != 1 {
		t.Fatal("matching content not applied", err)
	}
	found = true
	fingerprint = "changed again"
	beforeReads := reads
	result, err := applyFlashcardV2ReorderWithFingerprint(context.Background(), request, replay, read, apply)
	if err != nil || reads != beforeReads || writes != 1 || !reflect.DeepEqual(result.UpdatedCardIDs, []string{"saved"}) {
		t.Fatal("successful replay was checked against later content", err)
	}
}
