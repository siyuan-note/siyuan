// SiYuan - Refactor your thinking
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

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterSearchDocsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		hiddenBoxID       = "20260720000001-boxid02"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: hiddenBoxID, Visible: false},
		{ID: hiddenDocID, Visible: false},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	docs := []map[string]string{
		{"box": boxID, "path": "/20260720000004-public1.sy"},
		{"box": hiddenBoxID, "path": "/"},
		{"box": boxID, "path": "/" + hiddenDocID + "/20260720000005-child01.sy"},
		{"box": boxID, "path": "/" + protectedDocID + ".sy"},
		{"box": boxID, "path": ""},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 1 || filtered[0]["path"] != docs[0]["path"] {
		t.Fatalf("unexpected unauthenticated search docs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 2 || filtered[1]["path"] != docs[3]["path"] {
		t.Fatalf("unexpected authenticated search docs: %v", filtered)
	}
}
