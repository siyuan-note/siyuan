// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentPathAPIWorkspace(t *testing.T) string {
	t.Helper()
	addressingAPIWorkspace(t)
	previousConf, previousPath := model.Conf, util.BlockTreeDBPath
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		model.Conf, util.BlockTreeDBPath = previousConf, previousPath
		if previousPath != "" {
			treenode.InitBlockTree(false)
		}
	})
	box := &model.Box{ID: addressingAPIBox}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Documents", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	return box.ID
}

func documentPathAPIRequest(t *testing.T, route string, handler gin.HandlerFunc, payload interface{}) []byte {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST(route, boxLeaseMiddleware, handler)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", route, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", route, recorder)
	return recorder.Body.Bytes()
}

func TestAPIContractDocumentPaths(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	parent := treenode.NewTree(box, "/20261023010000-parent1.sy", "/A", "A")
	child := treenode.NewTree(box, "/20261023010000-parent1/20261023010001-child01.sy", "/A/B", "B")
	treenode.UpsertBlockTree(parent)
	treenode.UpsertBlockTree(child)
	const missing = "20261023010002-missing"
	request := apicontract.GetDocPathsRequest{Notebook: box, IDs: []string{child.ID, missing, parent.ID, child.ID, child.Root.FirstChild.ID}}
	response := documentPathAPIRequest(t, "/api/filetree/getDocPaths", getDocPaths, request)
	if !bytes.Contains(response, []byte(`"reason":"indexUnavailable"`)) {
		t.Fatalf("unready index was treated as missing: %s", response)
	}
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	response = documentPathAPIRequest(t, "/api/filetree/getDocPaths", getDocPaths, request)
	if bytes.Contains(response, []byte(`"addressingVersion"`)) {
		t.Fatalf("document path retained retired addressing version: %s", response)
	}
	var result struct {
		Code int
		Data apicontract.DocumentPathsData
	}
	if err := json.Unmarshal(response, &result); err != nil || result.Code != 0 {
		t.Fatalf("read failed: %s, %v", response, err)
	}
	if len(result.Data.Documents) != 2 || result.Data.Documents[0].ID != child.ID || result.Data.Documents[1].ID != parent.ID ||
		len(result.Data.MissingIDs) != 2 || result.Data.MissingIDs[0] != missing || result.Data.Documents[0].Depth != 2 ||
		result.Data.Documents[0].Segments[0].ID != parent.ID {
		t.Fatalf("identity, order or missing results changed: %s", response)
	}
	for _, ids := range [][]string{{}, make([]string, 129), {"invalid"}} {
		request.IDs = ids
		response = documentPathAPIRequest(t, "/api/filetree/getDocPaths", getDocPaths, request)
		if !bytes.Contains(response, []byte(`"code":-1`)) {
			t.Fatalf("invalid IDs accepted: %s", response)
		}
	}
}

func TestAPIContractCreateDocumentRequest(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	const id = "20261023010001-created"
	for _, mutate := range []func(map[string]interface{}){
		func(value map[string]interface{}) { delete(value, "parentID") },
		func(value map[string]interface{}) { delete(value, "markdown") },
		func(value map[string]interface{}) { value["path"] = "/Legacy" },
		func(value map[string]interface{}) { value["hPath"] = "/Legacy" },
		func(value map[string]interface{}) { value["parentID"] = "" },
		func(value map[string]interface{}) { value["expectedParentRevision"] = nil },
		func(value map[string]interface{}) { value["nameConditions"] = nil },
		func(value map[string]interface{}) { value["sorts"] = nil },
		func(value map[string]interface{}) { value["title"] = map[string]interface{}{"format": "plain"} },
		func(value map[string]interface{}) {
			value["title"] = map[string]interface{}{"format": "plain", "text": nil}
		},
		func(value map[string]interface{}) {
			value["nameConditions"] = []map[string]interface{}{{"parentID": nil, "title": "A"}}
		},
	} {
		request := map[string]interface{}{"notebook": box, "parentID": nil, "id": id,
			"title": map[string]string{"format": "plain", "text": "Title"}, "markdown": ""}
		mutate(request)
		response := documentPathAPIRequest(t, "/api/filetree/createDocByParent", createDocByParent, request)
		if !bytes.Contains(response, []byte(`"code":-1`)) {
			t.Fatalf("invalid creation request accepted: %s", response)
		}
		if treenode.GetBlockTreeInExactBox(id, box) != nil {
			t.Fatal("invalid request created an index entry")
		}
	}
}

func TestAPIContractDocumentAddressingAdminAccess(t *testing.T) {
	documentPathAPIWorkspace(t)
	for _, endpoint := range []struct {
		path    string
		handler gin.HandlerFunc
	}{
		{"/api/filetree/getDocPaths", getDocPaths},
		{"/api/filetree/resolveDocPath", resolveDocPath},
		{"/api/filetree/createDocByParent", createDocByParent},
		{"/api/filetree/getDocCreateTarget", getDocCreateTarget},
		{"/api/filetree/planDocCreate", planDocCreate},
	} {
		engine := gin.New()
		engine.POST(endpoint.path, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) },
			model.CheckAdminRole, endpoint.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", endpoint.path, bytes.NewBufferString(`{}`)))
		if recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
			t.Fatalf("reader could access document addressing: HTTP %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestAPIContractDocumentCreateTarget(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	for _, purpose := range []string{"document", "reference", "dailyNote"} {
		response := documentPathAPIRequest(t, "/api/filetree/getDocCreateTarget", getDocCreateTarget,
			apicontract.GetDocCreateTargetRequest{Notebook: box, Purpose: purpose})
		var result struct {
			Code int
			Data struct {
				Target                apicontract.LegacyDocumentTarget
				DocCreateTemplatePath string
				Revision              string
			}
		}
		if err := json.Unmarshal(response, &result); err != nil || result.Code != 0 || result.Data.Target.Version != 1 ||
			result.Data.Target.Notebook != box || result.Data.Revision == "" {
			t.Fatalf("target read failed: %s, %v", response, err)
		}
		if purpose == "dailyNote" && !bytes.Contains([]byte(result.Data.Target.Path), []byte("{{now")) {
			t.Fatal("configuration read rendered a time-sensitive template")
		}
	}
}

func TestAPIContractResolveDocumentPath(t *testing.T) {
	box := documentPathAPIWorkspace(t)
	parent := treenode.NewTree(box, "/20261023010000-parent1.sy", "/A", "A")
	child := treenode.NewTree(box, "/20261023010000-parent1/20261023010001-child01.sy", "/A/B", "B")
	treenode.UpsertBlockTree(parent)
	treenode.UpsertBlockTree(child)
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	resolve := func(segments []string) apicontract.ResolvedDocumentPathData {
		t.Helper()
		response := documentPathAPIRequest(t, "/api/filetree/resolveDocPath", resolveDocPath,
			apicontract.ResolveDocPathRequest{Notebook: box, Start: apicontract.DocumentPathStart{Kind: "root"}, Segments: segments})
		var result struct {
			Code int
			Data apicontract.ResolvedDocumentPathData
		}
		if err := json.Unmarshal(response, &result); err != nil || result.Code != 0 {
			t.Fatalf("resolve failed: %s, %v", response, err)
		}
		return result.Data
	}
	root := resolve([]string{})
	if root.Status != "resolved" || root.Resolved != nil || root.Start.ID != nil || root.Start.Revision == "" {
		t.Fatalf("root is not an explicit location: %+v", root)
	}
	resolved := resolve([]string{"A", "B"})
	if resolved.Status != "resolved" || resolved.NextIndex != 2 || resolved.Resolved.ID != child.ID || len(resolved.NameConditions) != 2 {
		t.Fatalf("wrong resolution: %+v", resolved)
	}
	missingResult := resolve([]string{"A", "Missing"})
	if missingResult.Status != "missing" || missingResult.NextIndex != 1 || missingResult.Resolved.ID != parent.ID ||
		missingResult.NameConditions[1].ExpectedID != nil || *missingResult.NameConditions[1].ParentID != parent.ID {
		t.Fatalf("missing condition was lost: %+v", missingResult)
	}
	if resolve([]string{"a"}).Status != "missing" {
		t.Fatal("name lookup ignored Unicode case")
	}
	for i := 0; i < 130; i++ {
		id := fmt.Sprintf("20261023020000-%07d", i)
		tree := treenode.NewTree(box, "/"+id+".sy", "/Same", "Same")
		treenode.UpsertBlockTree(tree)
	}
	ambiguous := resolve([]string{"Same"})
	if ambiguous.Status != "ambiguous" || !ambiguous.CandidatesTruncated || len(ambiguous.Candidates) != 128 || len(ambiguous.NameConditions) != 0 {
		t.Fatalf("candidate truncation erased ambiguity: %+v", ambiguous)
	}
	if resolve([]string{}).Start.Revision != root.Start.Revision {
		t.Fatal("unrelated children invalidated root revision")
	}
}
