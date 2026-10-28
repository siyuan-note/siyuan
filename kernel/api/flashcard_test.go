// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnkiContractImportUploadCleanup(t *testing.T) {
	previousTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = previousTemp })
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("deckID", " deck "); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"first archive", "second archive"} {
		part, err := writer.CreateFormFile("file", "deck.apkg")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flashcard/importAnki", &body)
	context.Request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := context.Request.ParseMultipartForm(1); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = context.Request.MultipartForm.RemoveAll() })
	form, path, cleanup, err := saveAnkiImportUpload(context)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "first archive" || form.Value["deckID"][0] != " deck " {
		t.Fatalf("upload selection or fields changed: %s, %v", data, err)
	}
	cleanup()
	if _, err = os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("upload directory was not removed: %v", err)
	}
	if file, openErr := form.File["file"][0].Open(); openErr == nil {
		_ = file.Close()
		t.Fatal("multipart temporary file was not removed")
	}
}

func TestSaveAnkiImportUploadRejectsOversizedRequest(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/flashcard/importAnki", http.NoBody)
	context.Request.ContentLength = flashcardv2.MaxAnkiPackageArchiveSize + maxAnkiMultipartOverhead + 1
	_, _, cleanup, err := saveAnkiImportUpload(context)
	if cleanup != nil {
		cleanup()
	}
	if err == nil || err.Error() != "Anki package upload exceeds its size limit" {
		t.Fatalf("oversized Anki upload was not rejected: %v", err)
	}
}
