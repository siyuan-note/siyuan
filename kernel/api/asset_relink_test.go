package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetRelinkContract(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	const box, viewID = "20260914070000-closed0", "20260914070001-missing"
	boxDir := filepath.Join(util.DataDir, box)
	if err := os.MkdirAll(filepath.Join(boxDir, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(boxDir, ".siyuan", "conf.json"), []byte(`{"name":"Closed notebook","closed":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(box, "/20260914070002-orphan0.sy", "/Orphan", "Orphan")
	tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: "20260914070003-orphan1", AttributeViewID: viewID})
	l := util.NewLute()
	if err := os.WriteFile(filepath.Join(boxDir, tree.Path), render.NewJSONRenderer(tree, l.RenderOptions, l.ParseOptions).Render(), 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"contract-relink.png", "contract-relink.webp"} {
		if err := os.WriteFile(filepath.Join(assets, name), []byte("asset"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path    string
		body    string
		handler gin.HandlerFunc
		failure bool
	}{
		{"findAssetReferences", `{"path":"assets/contract-relink.png"}`, findAssetReferences, false},
		{"findAssetReferences", `{}`, findAssetReferences, true},
		{"findAssetReferences", `{"path":null}`, findAssetReferences, true},
		{"findAssetReferences", `{"paths":["assets/contract-relink.png","../outside"]}`, findAssetReferences, false},
		{"findAssetReferences", `{"paths":[]}`, findAssetReferences, true},
		{"findAssetReferences", `{"paths":null}`, findAssetReferences, true},
		{"findAssetReferences", `{"paths":[null]}`, findAssetReferences, true},
		{"findAssetReferences", `{"paths":["assets/contract-relink.png"],"path":"assets/contract-relink.png"}`, findAssetReferences, true},
		{"relinkAsset", `{"mappings":[{"oldPath":"assets/contract-relink.png","newPath":"assets/contract-relink.webp"},{"oldPath":"assets/absent.png","newPath":"assets/absent.webp"}]}`, relinkAsset, false},
		{"relinkAsset", `{"mappings":[{"oldPath":"assets/absent.png","newPath":"assets/absent.webp"}]}`, relinkAsset, true},
		{"relinkAsset", `{"mappings":[]}`, relinkAsset, true},
		{"relinkAsset", `{"mappings":null}`, relinkAsset, true},
		{"relinkAsset", `{"mappings":[null]}`, relinkAsset, true},
		{"relinkAsset", `{"mappings":[{"oldPath":"assets/contract-relink.png"}]}`, relinkAsset, true},
		{"relinkAsset", `{"mappings":[],"oldPath":"assets/contract-relink.png"}`, relinkAsset, true},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"assets/contract-relink.webp","dryRun":true}`, relinkAsset, false},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"assets/contract-relink.webp"}`, relinkAsset, false},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"assets/contract-relink.webp","dryRun":"true"}`, relinkAsset, true},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"assets/contract-relink.webp","dryRun":null}`, relinkAsset, true},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"../outside"}`, relinkAsset, true},
		{"relinkAsset", `{"oldPath":"assets/contract-relink.png","newPath":"assets/not-present.webp"}`, relinkAsset, true},
	} {
		t.Run(test.path+test.body, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest("POST", "/api/asset/"+test.path, strings.NewReader(test.body))
			context.Request.Header.Set("Content-Type", "application/json")
			test.handler(context)
			if err := bundle.ValidateResponse("POST", "/api/asset/"+test.path, recorder.Body.Bytes()); err != nil {
				t.Fatalf("invalid response contract: %v\n%s", err, recorder.Body.String())
			}
			var response struct {
				Code int                              `json:"code"`
				Data *apicontract.AssetReferencesData `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code != 0) != test.failure {
				t.Fatalf("unexpected response: %s %v", recorder.Body.String(), err)
			}
			if !test.failure && (response.Data == nil || response.Data.References == nil || response.Data.SkippedNotebooks == nil) {
				t.Fatal("success arrays must not be null")
			}
			if !test.failure {
				warnings := response.Data.UnavailableAttributeViews
				if len(warnings) != 1 || warnings[0].AvID != viewID || warnings[0].Notebook != box || warnings[0].NotebookName != "Closed notebook" || warnings[0].Path != tree.Path || warnings[0].Reason != "missing_definition" {
					t.Fatalf("missing definition warning contract: %+v", warnings)
				}
			}
			if !test.failure && (strings.Contains(test.body, `"paths"`) || strings.Contains(test.body, `"mappings"`)) {
				if len(response.Data.Items) != 2 || !response.Data.Items[0].OK || response.Data.Items[1].OK || response.Data.Items[1].Reason == "" {
					t.Fatalf("partial batch result: %+v", response.Data)
				}
			}
		})
	}
}

func TestAssetRelinkAuthorization(t *testing.T) {
	setupAssetContractWorkspace(t)
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
		util.ReadOnly = role == model.RoleAdministrator
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		for _, path := range []string{"findAssetReferences", "relinkAsset"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/"+path, strings.NewReader(`invalid JSON`)))
			if role != model.RoleAdministrator {
				if recorder.Code != http.StatusForbidden {
					t.Fatalf("%s admitted %v: %s", path, role, recorder.Body.String())
				}
			} else if !strings.Contains(recorder.Body.String(), `"closeTimeout":5000`) {
				t.Fatalf("read-only workspace reached handler: %s", recorder.Body.String())
			}
		}
	}
}
