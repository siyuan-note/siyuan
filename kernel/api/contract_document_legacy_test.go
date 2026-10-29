// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractLegacyDocumentPaths(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	parent := treenode.NewTree(box, "/20261026000001-parent1.sy", "/A", "A")
	child := treenode.NewTree(box, "/20261026000001-parent1/20261026000002-child01.sy", "/A/B", "B")
	slash := treenode.NewTree(box, "/20261026000003-slash01.sy", "/A/B", "A/B")
	leaf := treenode.NewTree(box, "/20261026000003-slash01/20261026000004-leaf001.sy", "/A/B/C", "C")
	placeholder := treenode.NewTree(box, "/20261026000005-empty01.sy", "/Empty", "Empty")
	placeholder.Root.SetIALAttr(treenode.DocumentTitleEmptyAttr, "true")
	for _, tree := range []*parse.Tree{parent, child, slash, leaf, placeholder} {
		treenode.UpsertBlockTree(tree)
	}
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		hp, reason         string
		clean, unsupported int
	}{
		{"/A", "", 0, 0}, {"/missing", "", 0, 0}, {"/A/B", "pathAmbiguous", 1, 1}, {"/A/B/C", "legacyPathUnsupported", 0, 1}, {"/Empty", "legacyPathUnsupported", 0, 1},
	} {
		response := documentPathAPIRequest(t, "/api/filetree/getIDsByHPath", getIDsByHPath, map[string]string{"notebook": box, "path": test.hp})
		var result struct {
			Code int
			Data json.RawMessage
		}
		if err := json.Unmarshal(response, &result); err != nil {
			t.Fatal(err)
		}
		if test.reason == "" {
			if result.Code != 0 {
				t.Fatal(string(response))
			}
			if test.hp == "/missing" && !bytes.Equal(result.Data, []byte("[]")) {
				t.Fatal(string(response))
			}
		} else {
			var failure struct {
				Reason                   string
				CleanIDs, UnsupportedIDs []string
			}
			if err := json.Unmarshal(result.Data, &failure); err != nil || result.Code != -1 || failure.Reason != test.reason || len(failure.CleanIDs) != test.clean || len(failure.UnsupportedIDs) != test.unsupported {
				t.Fatal(string(response), err)
			}
		}
	}
	for _, hp := range []string{"/A/B/New", "/A/B/C/M/New", "/Empty/New"} {
		response := documentPathAPIRequest(t, "/api/filetree/createDocWithMd", createDocWithMd, map[string]string{"notebook": box, "path": hp, "markdown": "body"})
		if !bytes.Contains(response, []byte("\"reason\":\"pathAmbiguous\"")) {
			t.Fatal(string(response))
		}
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, box))
	if err != nil || len(entries) != 1 || entries[0].Name() != ".siyuan" {
		t.Fatal("rejected creation wrote sources", entries, err)
	}
	if _, err := treenode.BeginDocumentMetadataRecovery(treenode.GetBlockTreeInExactBox(parent.ID, box)); err != nil {
		t.Fatal(err)
	}
	response := documentPathAPIRequest(t, "/api/filetree/getIDsByHPath", getIDsByHPath, map[string]string{"notebook": box, "path": "/missing"})
	if !bytes.Contains(response, []byte("\"reason\":\"indexUnavailable\"")) {
		t.Fatal(string(response))
	}
}

func TestAPIContractLegacyDocumentCandidateVisibility(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	parent := treenode.NewTree(box, "/20261026000001-parent1.sy", "/A", "A")
	child := treenode.NewTree(box, "/20261026000001-parent1/20261026000002-child01.sy", "/A/B", "B")
	slash := treenode.NewTree(box, "/20261026000003-slash01.sy", "/A/B", "A/B")
	for _, tree := range []*parse.Tree{parent, child, slash} {
		treenode.UpsertBlockTree(tree)
	}
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	previous := model.GetPublishAccess()
	t.Cleanup(func() {
		if err := model.SetPublishAccess(previous); err != nil {
			t.Error(err)
		}
	})
	for _, hidden := range []string{slash.ID, parent.ID} {
		if err := model.SetPublishAccess(model.PublishAccess{{ID: hidden, Visible: false}}); err != nil {
			t.Fatal(err)
		}
		response := documentPathAPIRequest(t, "/api/filetree/getIDsByHPath", func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); getIDsByHPath(c) }, map[string]string{"notebook": box, "path": "/A/B"})
		if !bytes.Contains(response, []byte("\"reason\":\"pathAmbiguous\"")) {
			t.Fatal(string(response))
		}
		forbidden := hidden
		if hidden == parent.ID {
			forbidden = child.ID
		}
		if bytes.Contains(response, []byte(forbidden)) {
			t.Fatal("error exposed an unpublished candidate", string(response))
		}
	}
}
