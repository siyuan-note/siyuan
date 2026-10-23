package api

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestStructuredTitlesAPIContracts(t *testing.T) {
	if documentaddressing.DefaultMode() != 2 {
		t.Skip("covered by the structured-title release-gate CI run")
	}
	box := documentPathAPIWorkspace(t)
	if err := filesys.CheckDocumentAddressing(box); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/Plain", "/A/B"} {
		data := documentPathAPIRequest(t, "/api/filetree/getIDsByHPath", getIDsByHPath, map[string]string{"notebook": box, "path": path})
		if !bytes.Contains(data, []byte(`"reason":"legacyPathUnsupported"`)) {
			t.Fatal(string(data))
		}
		data = documentPathAPIRequest(t, "/api/filetree/createDocWithMd", createDocWithMd,
			map[string]string{"notebook": box, "path": path, "markdown": "", "parentID": box})
		if !bytes.Contains(data, []byte(`"reason":"legacyPathUnsupported"`)) {
			t.Fatal(string(data))
		}
	}
	read := func() *apicontract.DocumentCapabilities {
		data := documentPathAPIRequest(t, "/api/notebook/getNotebookConf", func(c *gin.Context) {
			c.Set(model.RoleContextKey, model.RoleAdministrator)
			getNotebookConf(c)
		}, map[string]string{"notebook": box})
		var response struct {
			Code int
			Data apicontract.NotebookConfData
		}
		if err := json.Unmarshal(data, &response); err != nil || response.Code != 0 {
			t.Fatal(string(data), err)
		}
		return response.Data.DocumentCapabilities
	}
	if current := read(); current.AddressingVersion != 2 || current.ModeState != "recovering" || current.LiteralSlash {
		t.Fatal("missing index was advertised as ready", current)
	}
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	if current := read(); current.ModeState != "structured" || !current.LiteralSlash || current.MinimumReaderVersion == nil {
		t.Fatal("automatic mode was not available", current)
	}
}
