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
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
)

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
