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
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// resetPublishAccessCache 清除进程级发布访问缓存，避免用例之间相互影响。
func resetPublishAccessCache() {
	publishAccessLock.Lock()
	publishAccessLastModified = 0
	publishAccess = nil
	publishAccessLock.Unlock()
}

// TestGetCurrentAttributeViewImagesPublishAccess 验证发布读者只能读取发布可访问数据库中的图片资源路径。
// 逐行过滤会把游离行视为可访问，缺少数据库级门禁时会泄漏未授权数据库游离行的图片路径。
func TestGetCurrentAttributeViewImagesPublishAccess(t *testing.T) {
	const (
		boxID        = "20260726020000-boxghsa"
		carrierDocID = "20260726020001-carrier"
		avID         = "20260726020002-avaaaaa"
		imageKeyID   = "20260726020003-keyimgg"
		secretImage  = "assets/secret-image-20260101000000-abcdefg.png"
		readerPass   = "reader-password"
	)

	oldBlockTreeDBPath := util.BlockTreeDBPath
	setupAttributeViewValidationTest(t)
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	resetPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldBlockTreeDBPath
		resetPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})
	// 本清理注册在 setupAttributeViewValidationTest 之后，因此会在其恢复 util.DataDir 之后执行，
	// 避免残留指向临时目录的加密笔记本发布访问快照影响后续用例。
	t.Cleanup(invalidateEncryptedPublishAccessCache)

	tree := treenode.NewTree(boxID, "/"+carrierDocID+".sy", "/"+carrierDocID, carrierDocID)
	treenode.UpsertBlockTree(tree)
	av.UpsertBlockRel(avID, carrierDocID)

	// 数据库只包含一个游离行，图片字段中带有不应泄漏的资源
	attrView := av.NewAttributeView(avID)
	attrView.Name = avID
	blockKeyID := attrView.GetBlockKey().ID
	detachedRowID := ast.NewNodeID()
	attrView.GetBlockKeyValues().Values = []*av.Value{{
		ID: ast.NewNodeID(), KeyID: blockKeyID, BlockID: detachedRowID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "detached row"},
	}}
	attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{
		Key: av.NewKey(imageKeyID, "Images", "", av.KeyTypeMAsset),
		Values: []*av.Value{{
			ID: ast.NewNodeID(), KeyID: imageKeyID, BlockID: detachedRowID, Type: av.KeyTypeMAsset,
			MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Name: "secret-image.png", Content: secretImage}},
		}},
	})
	view, err := attrView.GetFirstView()
	if nil != err {
		t.Fatal(err)
	}
	// 图片字段必须出现在视图列中才会被渲染进表格
	view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: imageKeyID}})
	if err = av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}

	newReaderContext := func() *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/api/av/getCurrentAttrViewImages", nil)
		c.Set(RoleContextKey, RoleReader)
		return c
	}

	t.Run("禁止发布时拒绝且不泄漏图片路径", func(t *testing.T) {
		if err = SetPublishAccess(PublishAccess{{ID: carrierDocID, Disable: true}}); nil != err {
			t.Fatal(err)
		}
		images, err := GetCurrentAttributeViewImages(newReaderContext(), avID, "", "", "")
		if !errors.Is(err, av.ErrAttributeViewNotFound) {
			t.Fatalf("expected [%v], got [%v]", av.ErrAttributeViewNotFound, err)
		}
		for _, image := range images {
			if image == secretImage {
				t.Fatalf("leaked image asset path [%s]", image)
			}
		}
		if 0 < len(images) {
			t.Fatalf("unexpected images: %v", images)
		}
	})

	t.Run("密码保护时未授权读者被拒绝", func(t *testing.T) {
		if err = SetPublishAccess(PublishAccess{{
			ID: carrierDocID, Visible: true, Password: readerPass,
		}}); nil != err {
			t.Fatal(err)
		}
		if _, err := GetCurrentAttributeViewImages(newReaderContext(), avID, "", "", ""); !errors.Is(err, av.ErrAttributeViewNotFound) {
			t.Fatalf("expected [%v], got [%v]", av.ErrAttributeViewNotFound, err)
		}
	})

	t.Run("密码保护时已授权读者可读取", func(t *testing.T) {
		c := newReaderContext()
		c.Request.AddCookie(&http.Cookie{
			Name:  "publish-auth-" + carrierDocID,
			Value: util.SHA256Hash([]byte(carrierDocID + readerPass)),
		})
		images, err := GetCurrentAttributeViewImages(c, avID, "", "", "")
		if nil != err {
			t.Fatalf("unexpected error: %s", err)
		}
		if 1 != len(images) || secretImage != images[0] {
			t.Fatalf("unexpected images: %v", images)
		}
	})

	t.Run("无发布限制时可读取", func(t *testing.T) {
		if err = SetPublishAccess(PublishAccess{}); nil != err {
			t.Fatal(err)
		}
		images, err := GetCurrentAttributeViewImages(newReaderContext(), avID, "", "", "")
		if nil != err {
			t.Fatalf("unexpected error: %s", err)
		}
		if 1 != len(images) || secretImage != images[0] {
			t.Fatalf("unexpected images: %v", images)
		}
	})

	t.Run("管理员不受发布门禁限制", func(t *testing.T) {
		if err = SetPublishAccess(PublishAccess{{ID: carrierDocID, Disable: true}}); nil != err {
			t.Fatal(err)
		}
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/api/av/getCurrentAttrViewImages", nil)
		c.Set(RoleContextKey, RoleAdministrator)
		images, err := GetCurrentAttributeViewImages(c, avID, "", "", "")
		if nil != err {
			t.Fatalf("unexpected error: %s", err)
		}
		if 1 != len(images) || secretImage != images[0] {
			t.Fatalf("unexpected images: %v", images)
		}
	})
}
