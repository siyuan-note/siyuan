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

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDocumentCapabilities(t *testing.T) {
	boxID := documentPathAPIWorkspace(t)
	admin := func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		getNotebookConf(c)
	}
	read := func() *apicontract.DocumentCapabilities {
		t.Helper()
		data := documentPathAPIRequest(t, "/api/notebook/getNotebookConf", admin, map[string]string{"notebook": boxID})
		for _, field := range []string{"addressingVersion", "modeState", "minimumReaderVersion"} {
			if bytes.Contains(data, []byte(`"`+field+`"`)) {
				t.Fatalf("capabilities retained retired field %s: %s", field, data)
			}
		}
		var response struct {
			Code int
			Data apicontract.NotebookConfData
		}
		if err := json.Unmarshal(data, &response); err != nil || response.Code != 0 || response.Data.DocumentCapabilities == nil {
			t.Fatalf("capability response failed: %s, %v", data, err)
		}
		return response.Data.DocumentCapabilities
	}
	capabilities := read()
	public := documentPathAPIRequest(t, "/api/notebook/getNotebookConf", func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleEditor)
		getNotebookConf(c)
	}, map[string]string{"notebook": boxID})
	if bytes.Contains(public, []byte(`"documentCapabilities"`)) {
		t.Fatal("configuration permissions were widened by capability discovery")
	}
	if !capabilities.StructuredPaths || capabilities.LiteralSlash || capabilities.IndexState != "missing" ||
		len(capabilities.TitleFormats) != 1 || capabilities.TitleFormats[0] != "plain" || capabilities.Revision == "" {
		t.Fatalf("capabilities claimed an unimplemented or unverified feature: %+v", capabilities)
	}
	if err := treenode.SetDocumentMetadataState(boxID, "ready"); err != nil {
		t.Fatal(err)
	}
	if current := read(); current.IndexState != "ready" || !current.LiteralSlash || current.Revision != capabilities.Revision {
		t.Fatalf("ready metadata did not enable structured titles or changed the configuration revision: %+v", current)
	}
	name := filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath)
	for _, record := range []string{`{"version":1,"notebook":"` + boxID + `","minimumMode":3}`, `{"version":99}`, `{`} {
		if err := os.WriteFile(name, []byte(record), 0600); err != nil {
			t.Fatal(err)
		}
		if current := read(); current.IndexState != "ready" || !current.LiteralSlash || current.Revision != capabilities.Revision {
			t.Fatal("retired record changed fixed capabilities", current)
		}
		if data, err := os.ReadFile(name); err != nil || string(data) != record {
			t.Fatal("capability read changed notebook record", err)
		}
	}
}
