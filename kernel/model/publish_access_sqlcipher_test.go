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

//go:build sqlcipher || libsqlcipher

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCheckBlockIdAccessableByPublishAccessInBox(t *testing.T) {
	const (
		boxID       = "20260724000000-boxid01"
		otherBoxID  = "20260724000001-boxid02"
		docID       = "20260724000002-docid01"
		docPassword = "password"
	)

	originalTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() {
		treenode.CloseEncryptedBlockTreeDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(otherBoxID)
		util.TempDir = originalTempDir
	})

	dek := make([]byte, 32)
	if err := treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	if err := treenode.OpenEncryptedBlockTreeDB(otherBoxID, dek); err != nil {
		t.Fatal(err)
	}

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Document", "Document")
	treenode.UpsertBlockTree(tree)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if !CheckBlockIdAccessableByPublishAccessInBox(c, PublishAccess{}, docID, boxID) {
		t.Fatal("public document in an encrypted notebook should be accessible")
	}
	if CheckBlockIdAccessableByPublishAccessInBox(c, PublishAccess{}, docID, otherBoxID) {
		t.Fatal("block lookup should not cross the requested notebook boundary")
	}
	if CheckBlockIdAccessableByPublishAccessInBox(c, PublishAccess{{ID: docID, Disable: true}}, docID, boxID) {
		t.Fatal("publish-disabled document in an encrypted notebook should not be accessible")
	}

	protectedAccess := PublishAccess{{ID: docID, Visible: true, Password: docPassword}}
	if CheckBlockIdAccessableByPublishAccessInBox(c, protectedAccess, docID, boxID) {
		t.Fatal("password-protected document in an encrypted notebook should require authorization")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + docID,
		Value: util.SHA256Hash([]byte(docID + docPassword)),
	})
	if !CheckBlockIdAccessableByPublishAccessInBox(c, protectedAccess, docID, boxID) {
		t.Fatal("password-protected document in an encrypted notebook should be accessible after authorization")
	}
}
