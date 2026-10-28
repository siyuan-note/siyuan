// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import "testing"

func TestCalloutTitleEncryptedReferenceLifecycle(t *testing.T) {
	if !calloutReferenceTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	const password = "callout-reference-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Callout", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testCalloutTitleReferenceLifecycle(t, boxID)
}
