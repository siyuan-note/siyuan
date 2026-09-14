// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
