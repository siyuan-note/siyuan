// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"testing"

	"github.com/emirpasic/gods/sets/hashset"
)

func TestDocumentTitleEncryptedBacklinksAndConversion(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "document-title-feature-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Title/Features", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleBacklinkSources(t, boxID)
	testHeadingDocumentRichTitleRoundTrip(t, boxID)
	testHeadingDocumentConversionFailuresPreserveSources(t, boxID)
	testFindReplaceRichDocumentTitle(t, boxID)
}

func TestDocumentTitleEncryptedMentionSources(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	const password = "document-title-mention-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Title/Mentions", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	targetID := testDocumentTitleMentionSources(t, boxID)
	Unmount(boxID)
	_, mentions := searchBackmentionInBox([]string{"MentionNeedle"}, "", hashset.New(), targetID, 12, boxID)
	if len(mentions) != 0 {
		t.Fatal("locked encrypted notebook returned document mentions")
	}
}
