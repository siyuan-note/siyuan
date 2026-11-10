// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/task"
)

func TestEncryptedNotebookDocumentRichTitle(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	password := "notebook-title-regression-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted notebook", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testNotebookDocumentRichTitle(t, boxID)
	current, err := GetDocTitle(boxID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: boxID,
		Data: map[string]any{"source": titleWriteTestSource(t, "Private rich title"), "expectedRevision": current.Revision}}}}); err != nil {
		t.Fatal(err)
	}
	current, err = GetDocTitle(boxID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	encryption := Conf.Box(boxID).GetConf().BoxCrypt
	LockBox(boxID)
	if _, err = GetDocTitle(boxID, boxID); err == nil {
		t.Fatal("locked notebook exposed its title source")
	}
	if _, err = UnlockAndMountBox(boxID, password, encryption); err != nil {
		t.Fatal(err)
	}
	for task.ContainIndexTask() {
		task.ExecTaskJob()
	}
	box := Conf.Box(boxID)
	if err = reconcileBoxDoc(box, boxID); err != nil {
		t.Fatal(err)
	}
	reopened, err := GetDocTitle(boxID, boxID)
	if err != nil || reopened.Revision != current.Revision || reopened.Source == nil || box.GetConf().Name != current.Text {
		t.Fatalf("unlocking lost notebook title source or name: %+v, %v", reopened, err)
	}
}
