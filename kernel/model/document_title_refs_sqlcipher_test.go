// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestEncryptedDocumentTitleDynamicConcurrentEdits(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "title-concurrent-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleDynamicConcurrentEdits(t, boxID)
}

func TestEncryptedDocumentTitleDynamicPersistence(t *testing.T) {
	const helper = "SIYUAN_TEST_ENCRYPTED_TITLE_REF_PROPAGATION"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEncryptedDocumentTitleDynamicPersistence$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted title propagation subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	password := "title-propagation-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleDynamicPersistence(t, boxID)
	otherBoxID, err := CreateEncryptedBox("Other encrypted", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(otherBoxID); err != nil {
		t.Fatal(err)
	}
	publicBox := &Box{ID: ast.NewNodeID()}
	publicConf := conf.NewBoxConf()
	publicConf.Closed = false
	if err = publicBox.SaveConf(publicConf); err != nil {
		t.Fatal(err)
	}
	secret := newHPathTestDoc(t, otherBoxID, "/", "private foreign title", 1)
	public := newHPathTestDoc(t, publicBox.ID, "/", "public foreign title", 1)
	sql.FlushQueue()
	for _, pair := range [][2]string{{boxID, secret.ID}, {boxID, public.ID}, {publicBox.ID, secret.ID}} {
		root := testDynamicTitle(t, ast.NewNodeID(), "source ", pair[1])
		tree := &parse.Tree{ID: root.ID, Box: pair[0], Root: root}
		if _, err = refreshDocumentTitleAnchors(root, tree); err != nil {
			t.Fatal(err)
		}
		if got := treenode.ReadDocumentTitle(root).Text; got != "source "+pair[1] {
			t.Fatalf("title anchor crossed notebook boundary: %q", got)
		}
	}
}
