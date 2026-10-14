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

//go:build fts5

package model

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterAssetContentByPublishAccess(t *testing.T) {
	for _, uncached := range []bool{false, true} {
		name := "current"
		if uncached {
			name = "uncached"
		}
		t.Run(name, func(t *testing.T) {
			t.Run("body", func(t *testing.T) { testPublishDocAssets(t, false, uncached) })
			t.Run("title image", func(t *testing.T) { testPublishDocAssets(t, true, uncached) })
		})
	}
}

func testPublishDocAssets(t *testing.T, titleImage, uncached bool) {
	const (
		boxID             = "20260804030000-boxid01"
		publicDocID       = "20260804030001-public1"
		protectedDocID    = "20260804030002-protect"
		hiddenDocID       = "20260804030003-hidden1"
		disabledDocID     = "20260804030004-disable"
		publicAsset       = "assets/public.png"
		protectedAsset    = "assets/protected.png"
		hiddenAsset       = "assets/hidden.png"
		disabledAsset     = "assets/disabled.png"
		protectedPassword = "password"
	)

	setupExportPublishTest(t)

	newDocTree := func(docID, asset string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		dom := `<div data-node-id="` + ast.NewNodeID() + `" data-type="htmlblock"><img src="` + asset + `" data-src="` + asset + `" /></div>`
		node := util.NewLute().BlockDOM2Tree(dom).Root.FirstChild
		tree.Root.AppendChild(node)
		if titleImage {
			node.Unlink()
			tree.Root.SetIALAttr("title-img", `background-image: url(&quot;`+asset+`?v=1&amp;size=large&quot;); background-position: center;`)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		if uncached {
			// 历史属性中的换行在冷读时订正，确保覆盖订正后的索引入队路径。
			file := filepath.Join(util.DataDir, boxID, docID+".sy")
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var document map[string]any
			if err = json.Unmarshal(data, &document); err != nil {
				t.Fatal(err)
			}
			document["Properties"].(map[string]any)["custom-test"] = "legacy\nvalue"
			data, err = json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(file, data, 0644); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeDataInBox(docID, boxID)
		}
		treenode.UpsertBlockTree(tree)
	}
	newDocTree(publicDocID, publicAsset)
	newDocTree(protectedDocID, protectedAsset)
	newDocTree(hiddenDocID, hiddenAsset)
	newDocTree(disabledDocID, disabledAsset)

	newAssetContents := func() []*AssetContent {
		return []*AssetContent{
			{ID: publicDocID, Name: "public.png", Path: publicAsset},
			{ID: protectedDocID, Name: "protected.png", Path: protectedAsset},
			{ID: hiddenDocID, Name: "hidden.png", Path: hiddenAsset},
			{ID: disabledDocID, Name: "disabled.png", Path: disabledAsset},
		}
	}
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
		{ID: disabledDocID, Visible: true, Disable: true},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if titleImage {
		assets, err := DocAssets(publicDocID, true)
		if err != nil || len(assets) != 1 || assets[0] != publicAsset+"?v=1&size=large" {
			t.Fatalf("unexpected title image assets with query: %v, %v", assets, err)
		}
	}
	for _, asset := range []string{publicAsset, protectedAsset, disabledAsset, "assets/unreferenced.png"} {
		got := CheckAbsPathAccessableByPublishAccess(c, filepath.Join(util.DataDir, asset), publishAccess)
		if got != (asset == publicAsset) {
			t.Errorf("unexpected unauthenticated access to %s: %v", asset, got)
		}
	}
	filtered := FilterAssetContentByPublishAccess(c, publishAccess, newAssetContents())
	if len(filtered) != 1 || filtered[0].Path != publicAsset {
		t.Fatalf("unexpected unauthenticated asset contents: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = FilterAssetContentByPublishAccess(c, publishAccess, newAssetContents())
	if !CheckAbsPathAccessableByPublishAccess(c, filepath.Join(util.DataDir, protectedAsset), publishAccess) {
		t.Error("password protected asset should be accessible after authorization")
	}
	if len(filtered) != 2 || filtered[0].Path != publicAsset || filtered[1].Path != protectedAsset {
		t.Fatalf("unexpected authenticated asset contents: %+v", filtered)
	}
	if uncached && Conf.DataIndexState != 1 {
		t.Fatal("uncached document did not enqueue its repaired index")
	}
}
