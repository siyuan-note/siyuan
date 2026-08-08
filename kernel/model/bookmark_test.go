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

package model

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterBookmarkLabelsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260729000000-boxid01"
		publicDocID       = "20260729000001-public1"
		protectedDocID    = "20260729000002-protect"
		hiddenDocID       = "20260729000003-hidden1"
		disabledDocID     = "20260729000004-disable"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
		{ID: disabledDocID, Visible: true, Disable: true},
	}
	blocks := []*sql.BookmarkLabelBlock{
		{Label: "shared", Box: boxID, Path: "/" + publicDocID + ".sy"},
		{Label: "shared", Box: boxID, Path: "/" + protectedDocID + ".sy"},
		{Label: "protected", Box: boxID, Path: "/" + protectedDocID + ".sy"},
		{Label: "hidden", Box: boxID, Path: "/" + hiddenDocID + ".sy"},
		{Label: "disabled", Box: boxID, Path: "/" + disabledDocID + ".sy"},
		{Label: "", Box: boxID, Path: "/" + publicDocID + ".sy"},
		nil,
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := filterBookmarkLabelsByPublishAccess(c, publishAccess, blocks)
	if !slices.Equal(filtered, []string{"shared"}) {
		t.Fatalf("unexpected unauthenticated bookmark labels: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = filterBookmarkLabelsByPublishAccess(c, publishAccess, blocks)
	if !slices.Equal(filtered, []string{"protected", "shared"}) {
		t.Fatalf("unexpected authenticated bookmark labels: %v", filtered)
	}
}

func TestFilterBlocksByPublishAccessRejectsDisabledBlocks(t *testing.T) {
	const (
		boxID         = "20260729000100-boxid01"
		publicDocID   = "20260729000101-public1"
		disabledDocID = "20260729000102-disable"
	)
	publishAccess := PublishAccess{
		{ID: disabledDocID, Visible: true, Disable: true},
	}
	blocks := []*Block{
		{ID: publicDocID, Box: boxID, Path: "/" + publicDocID + ".sy"},
		{ID: disabledDocID, Box: boxID, Path: "/" + disabledDocID + ".sy"},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterBlocksByPublishAccess(c, publishAccess, blocks)
	if len(filtered) != 1 || filtered[0].ID != publicDocID {
		t.Fatalf("unexpected filtered blocks: %+v", filtered)
	}
}
