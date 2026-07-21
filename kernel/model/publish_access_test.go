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
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCheckBlockTreeAccessableByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260721000000-boxid01"
		docID             = "20260721000001-docid01"
		protectedPassword = "password"
	)
	bt := &treenode.BlockTree{
		ID:    docID,
		BoxID: boxID,
		Path:  "/" + docID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Disable: true}}, bt) {
		t.Fatal("publish-disabled document should not be accessible")
	}

	protectedAccess := PublishAccess{{ID: docID, Visible: true, Password: protectedPassword}}
	if checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should not be accessible without authorization")
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + docID,
		Value: util.SHA256Hash([]byte(docID + protectedPassword)),
	})
	if !checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should be accessible after authorization")
	}

	if !checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Visible: false}}, bt) {
		t.Fatal("hidden document should remain directly accessible")
	}
}

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

func TestFilterEmbedBlocksByPublishAccessRemovesInternalFields(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	embedBlocks := []*EmbedBlock{{
		Block: &Block{
			Box:      "20260720000000-boxid01",
			Path:     "/20260720000004-public1.sy",
			HPath:    "/private/path",
			ID:       "20260720000005-block01",
			Content:  "<div>visible</div>",
			Markdown: "sensitive markdown",
			IAL:      map[string]string{"custom-secret": "sensitive ial"},
		},
		BlockPaths:          []*BlockPath{{ID: "20260720000004-public1", Name: "Public"}},
		AllowChildOperation: true,
	}}

	filtered := FilterEmbedBlocksByPublishAccess(c, PublishAccess{}, embedBlocks)
	if 1 != len(filtered) {
		t.Fatalf("unexpected filtered embed block count: %d", len(filtered))
	}
	block := filtered[0].Block
	if "20260720000005-block01" != block.ID || "<div>visible</div>" != block.Content {
		t.Fatalf("required embed block fields were not preserved: %+v", block)
	}
	if "" != block.Box || "" != block.Path || "" != block.HPath || "" != block.Markdown || nil != block.IAL {
		t.Fatalf("internal embed block fields were not removed: %+v", block)
	}
	if 1 != len(filtered[0].BlockPaths) || !filtered[0].AllowChildOperation {
		t.Fatalf("embed rendering metadata was not preserved: %+v", filtered[0])
	}
}

func TestFilterEmbedBlocksByPublishAccessDropsInaccessibleResults(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: hiddenDocID, Disable: true},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	embedBlocks := []*EmbedBlock{
		{Block: &Block{ID: "20260720000004-hidden1", Box: boxID, Path: "/" + hiddenDocID + ".sy", Content: "hidden"}},
		{Block: &Block{ID: "20260720000005-protect", Box: boxID, Path: "/" + protectedDocID + ".sy", Content: "protected"}},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks); 0 != len(filtered) {
		t.Fatalf("不可访问的嵌入块结果不应返回：%+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks)
	if 1 != len(filtered) || "20260720000005-protect" != filtered[0].Block.ID {
		t.Fatalf("密码验证后应仅返回已授权结果：%+v", filtered)
	}
}
