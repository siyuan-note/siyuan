// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestCheckAbsPathAccessableByPublishAccessBindsAssetOwner 校验文档级资源的发布鉴权绑定到解析后文件所属的
// 文档目录，同名资源不能借用其他文档的发布权限。
func TestCheckAbsPathAccessableByPublishAccessBindsAssetOwner(t *testing.T) {
	setupExportPublishTest(t)

	const (
		boxID             = "20261106000000-box0001"
		protectedDir      = "20261106000001-secret1"
		visibleDir        = "20261106000002-public1"
		protectedDocID    = "20261106000003-hidden1"
		visibleDocID      = "20261106000004-public2"
		overlap           = "assets/overlap.txt"
		documentPassword  = "document-password"
		visibleOverlapTxt = "visible-overlap"
	)

	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID), 0755); err != nil {
		t.Fatal(err)
	}
	box := &Box{ID: boxID}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}

	writeAsset := func(dir, name, content string) {
		t.Helper()
		path := filepath.Join(util.DataDir, boxID, dir, "assets", name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeAsset(protectedDir, "overlap.txt", "protected-overlap")
	writeAsset(protectedDir, "protected-only.txt", "protected-only")
	writeAsset(visibleDir, "overlap.txt", visibleOverlapTxt)
	writeAsset(visibleDir, "visible-only.txt", "visible-only")
	// 笔记本级资源（<box>/assets/）保持共享语义
	writeAsset("", "notebook.txt", "notebook-level")

	writeDoc := func(docID, dir, title, markdown string) {
		t.Helper()
		docPath := "/" + dir + "/" + docID + ".sy"
		tree := treenode.NewTree(boxID, docPath, "/"+title, title)
		parsed := parse.Parse("", []byte(markdown), util.NewLute().ParseOptions)
		for child := parsed.Root.FirstChild; nil != child; {
			next := child.Next
			child.Unlink()
			tree.Root.AppendChild(child)
			child = next
		}
		if err := os.MkdirAll(filepath.Dir(filepath.Join(util.DataDir, boxID, docPath)), 0755); err != nil {
			t.Fatal(err)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	writeDoc(protectedDocID, protectedDir, "Protected", "![p](assets/overlap.txt)\n\n![o](assets/protected-only.txt)\n")
	writeDoc(visibleDocID, visibleDir, "Visible",
		"![v](assets/overlap.txt)\n\n![w](assets/visible-only.txt)\n\n![n](assets/notebook.txt)\n")

	resolved, err := GetAssetAbsPath(overlap)
	if err != nil {
		t.Fatal(err)
	}
	protectedOverlap := filepath.Join(util.DataDir, boxID, protectedDir, "assets", "overlap.txt")
	if filepath.Clean(resolved) != filepath.Clean(protectedOverlap) {
		t.Fatalf("fixture resolved %q, want protected file %q", resolved, protectedOverlap)
	}

	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: documentPassword},
		{ID: visibleDocID, Visible: true},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if CheckAbsPathAccessableByPublishAccess(c, resolved, publishAccess) {
		t.Fatal("collision asset was authorized by another document's name reference")
	}
	if !CheckAbsPathAccessableByPublishAccess(c, filepath.Join(util.DataDir, boxID, visibleDir, "assets", "overlap.txt"), publishAccess) {
		t.Error("visible document's own asset should remain accessible")
	}
	if !CheckAbsPathAccessableByPublishAccess(c, filepath.Join(util.DataDir, boxID, "assets", "notebook.txt"), publishAccess) {
		t.Error("notebook-level asset should remain accessible")
	}
	if CheckAbsPathAccessableByPublishAccess(c, filepath.Join(util.DataDir, boxID, protectedDir, "assets", "protected-only.txt"), publishAccess) {
		t.Error("protected-only asset should be denied")
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: PublishAuthCookieValue(protectedDocID, documentPassword),
	})
	if !CheckAbsPathAccessableByPublishAccess(c, resolved, publishAccess) {
		t.Error("protected document asset should be accessible after password authorization")
	}
}
