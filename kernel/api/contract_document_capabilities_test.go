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
	if !capabilities.StructuredPaths || capabilities.LiteralSlash || capabilities.AddressingVersion != 2 ||
		capabilities.ModeState != "recovering" || capabilities.IndexState != "missing" || capabilities.MinimumReaderVersion != nil ||
		len(capabilities.TitleFormats) != 1 || capabilities.TitleFormats[0] != "plain" || capabilities.Revision == "" {
		t.Fatalf("capabilities claimed an unimplemented or unverified feature: %+v", capabilities)
	}
	if err := treenode.SetDocumentMetadataState(boxID, "ready"); err != nil {
		t.Fatal(err)
	}
	if current := read(); current.IndexState != "ready" || !current.LiteralSlash || current.ModeState != "structured" || current.Revision != capabilities.Revision {
		t.Fatalf("ready metadata did not enable structured titles or changed the configuration revision: %+v", current)
	}
	name := filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath)
	if err := os.WriteFile(name, []byte(`{"version":1,"notebook":"`+boxID+`","minimumMode":3}`), 0600); err != nil {
		t.Fatal(err)
	}
	if current := read(); current.AddressingVersion != 3 || current.ModeState != "conflict" || current.LiteralSlash || current.Revision == capabilities.Revision {
		t.Fatalf("unsupported mode was reported as writable: %+v", current)
	}
	if err := os.WriteFile(name, []byte(`{"version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	data := documentPathAPIRequest(t, "/api/notebook/getNotebookConf", admin, map[string]string{"notebook": boxID})
	if !bytes.Contains(data, []byte(`"code":-1`)) || bytes.Contains(data, []byte(`"documentCapabilities"`)) {
		t.Fatalf("damaged capability record silently fell back to legacy mode: %s", data)
	}
}
