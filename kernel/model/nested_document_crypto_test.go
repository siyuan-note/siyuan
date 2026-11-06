// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNestedDocumentEncryptedRecovery(t *testing.T) {
	const helper = "SIYUAN_TEST_NESTED_DOCUMENT_CRYPTO"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNestedDocumentEncryptedRecovery$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted nested document subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "nested-document-regression-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	box, err := CreateEncryptedBox("Nested document", password)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { LockBox(box) })
	if _, err = Mount(box); err != nil {
		t.Fatal(err)
	}
	tree, nested, paragraph := nestedDocumentRecoveryFixture(box)
	engine := util.NewLute()
	plain := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
	dek, err := GetDEK(box)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroAndClear(dek)
	raw, err := EncryptFile(box, tree.Path, dek, plain)
	if err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(util.DataDir, box, tree.Path)
	if err = os.WriteFile(abs, raw, 0600); err != nil {
		t.Fatal(err)
	}
	treenode.IndexBlockTree(tree)
	if err = treenode.SetDocumentMetadataState(box, "error"); err != nil {
		t.Fatal(err)
	}
	recoverOpenedDocumentMetadata()
	if treenode.DocumentMetadataState(box) != "ready" {
		t.Fatal("encrypted notebook did not recover")
	}
	loaded, err := filesys.LoadTree(box, tree.Path, engine)
	if err != nil || loaded.Root.FirstChild.Type != ast.NodeSuperBlock || loaded.Root.FirstChild.ID != nested.ID ||
		loaded.Root.FirstChild.FirstChild.Next.Next.ID != paragraph.ID ||
		loaded.Root.FirstChild.IALAttr("custom-test") != "preserved" {
		t.Fatal("encrypted repair changed content or identity", err)
	}
	if sql.GetBlock(nested.ID) != nil {
		t.Fatal("private nested block leaked into the global index")
	}
	repaired, err := os.ReadFile(abs)
	if err != nil || !util.IsCiphertext(repaired) || bytes.Equal(repaired, raw) {
		t.Fatal("repair did not persist as ciphertext", err)
	}
	crypt, err := GetBoxEncryption(box)
	if err != nil {
		t.Fatal(err)
	}
	LockBox(box)
	if _, err = UnlockAndMountBox(box, password, crypt); err != nil {
		t.Fatal(err)
	}
	indexBox(box)
	if _, err = CreateDocByParent(DocumentCreateRequest{Notebook: box, ID: ast.NewNodeID(), TitleFormat: "plain",
		Title: "Created after unlock", Markdown: "Private body"}); err != nil {
		t.Fatal("recovered encrypted notebook cannot create a document", err)
	}
	tampered := bytes.Clone(repaired)
	tampered[len(tampered)-1] ^= 1
	if err = os.WriteFile(abs, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearTreeCache()
	if err = treenode.SetDocumentMetadataState(box, "error"); err != nil {
		t.Fatal(err)
	}
	recoverOpenedDocumentMetadata()
	retained, err := os.ReadFile(abs)
	if err != nil || !bytes.Equal(tampered, retained) || treenode.DocumentMetadataState(box) != "error" {
		t.Fatal("unauthenticated source was modified or declared ready", err)
	}
}
