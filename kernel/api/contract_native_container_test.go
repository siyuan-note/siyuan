package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// testAPIContractNativeContainers 复用隔离工作区，验证原生工具和 HTTP API 的结构化读写。
func testAPIContractNativeContainers(t *testing.T, boxID string) {
	docID := ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Native containers", "Native containers")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	call := func(testT *testing.T, args map[string]any) tools.CallToolResult {
		testT.Helper()
		result, err := tools.BlockTool.Handler(args)
		if err != nil || result.IsError {
			testT.Fatalf("block.%s failed: %+v, %v", args["action"], result, err)
		}
		return result
	}
	writeID := func(testT *testing.T, args map[string]any) string {
		testT.Helper()
		result := call(testT, args)
		var output struct{ ID string }
		if err := json.Unmarshal([]byte(result.Content[0].Text), &output); err != nil || !ast.IsNodeIDPattern(output.ID) {
			testT.Fatalf("invalid write result: %+v, %v", result, err)
		}
		return output.ID
	}
	load := func(testT *testing.T, id string) *ast.Node {
		testT.Helper()
		tree, err := model.LoadTreeByBlockID(id)
		if err != nil {
			testT.Fatal(err)
		}
		node := treenode.GetNodeInTree(tree, id)
		if node == nil {
			testT.Fatalf("persisted block %s missing", id)
		}
		if err = treenode.ValidateBlockSubtree(tree.Root); err != nil {
			testT.Fatal(err)
		}
		return node
	}
	readFile := func(testT *testing.T) []byte {
		testT.Helper()
		data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, docID+".sy"))
		if err != nil {
			testT.Fatal(err)
		}
		return data
	}
	engine := gin.New()
	engine.POST("/api/block/insertBlock", insertBlock)
	engine.POST("/api/block/appendBlock", appendBlock)
	engine.POST("/api/block/prependBlock", prependBlock)

	for _, tc := range []struct {
		name, data, dataType string
		groupType, itemType  ast.NodeType
	}{
		{"tabs", "::: tabs\n@tab First\n\nOne\n\n@tab:active Second\n\nTwo\n\n:::\n", "markdown", ast.NodeTabs, ast.NodeTabItem},
		{"mindmap", `<div data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">One</div></div></div><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">Two</div></div></div></div>`, "dom", ast.NodeMindmap, ast.NodeMindmapItem},
	} {
		t.Run("native-containers/"+tc.name, func(t *testing.T) {
			groupID := writeID(t, map[string]any{"action": "append", "parentID": docID, "data": tc.data, "dataType": tc.dataType})
			group := load(t, groupID)
			if group.Type != tc.groupType || len(group.ChildrenByType(tc.itemType)) != 2 {
				t.Fatal("native container creation lost its types or items")
			}
			items := group.ChildrenByType(tc.itemType)
			firstID, secondID := items[0].ID, items[1].ID
			bodyID := items[0].FirstChild.ID
			attrs := map[string]string{"custom-test": "preserved"}
			if tc.groupType == ast.NodeTabs {
				attrs["tabs-position"], attrs["tabs-active-id"] = "left", secondID
			} else {
				attrs["custom-sy-list-mindmap-data"] = `{"version":2,"rootTitle":"Preserved root","nodes":{},"relations":[],"summaries":[]}`
			}
			if err := model.SetBlockAttrs(groupID, attrs); err != nil {
				t.Fatal(err)
			}
			assertAttrs := func() {
				t.Helper()
				current := load(t, groupID)
				for key, value := range attrs {
					if current.IALAttr(key) != value {
						t.Fatalf("container attribute %s changed: %q", key, current.IALAttr(key))
					}
				}
			}
			fragmentDOM := func() string {
				t.Helper()
				var fragment *ast.Node
				if tc.dataType == "dom" {
					fragment = util.NewLute().BlockDOM2Tree(tc.data).Root.FirstChild
					ast.Walk(fragment, func(node *ast.Node, entering bool) ast.WalkStatus {
						if entering && node.IsBlock() && node.Type != ast.NodeKramdownBlockIAL {
							node.ID = ast.NewNodeID()
							node.SetIALAttr("id", node.ID)
						}
						return ast.WalkContinue
					})
				} else {
					fragment = util.NewLute().BlockDOM2Tree(util.NewLute().Md2BlockDOM(tc.data, false)).Root.FirstChild
				}
				return util.NewLute().RenderNodeBlockDOM(fragment)
			}

			for _, action := range []string{"append", "prepend", "insert"} {
				before := load(t, groupID).ChildrenByType(tc.itemType)
				args := map[string]any{"action": action, "parentID": groupID, "data": fragmentDOM(), "dataType": "dom"}
				if action == "insert" {
					args["previousID"] = firstID
				}
				id := writeID(t, args)
				inserted := load(t, id)
				if inserted.Type != tc.itemType || inserted.Parent.ID != groupID || len(load(t, groupID).ChildrenByType(tc.itemType)) != len(before)+2 {
					t.Fatalf("%s did not insert both direct items", action)
				}
				if action == "insert" && inserted.Previous.ID != firstID {
					t.Fatal("previousID insertion lost its position")
				}
				if action == "prepend" && load(t, groupID).FirstChild.ID != id {
					t.Fatal("prepend did not retain input item order")
				}
				if action == "append" && inserted.Previous.ID != before[len(before)-1].ID {
					t.Fatal("append did not retain input item order")
				}
				assertAttrs()
			}
			nestedID := writeID(t, map[string]any{"action": "append", "parentID": firstID, "data": fragmentDOM(), "dataType": "dom"})
			if nested := load(t, nestedID); nested.Type != tc.groupType || nested.Parent.ID != firstID {
				t.Fatal("nested container was flattened into its item parent")
			}
			itemFragment := util.NewLute().BlockDOM2Tree(fragmentDOM()).Root.FirstChild.ChildrenByType(tc.itemType)[0]
			itemDOM := util.NewLute().RenderNodeBlockDOM(itemFragment)
			newItemID := writeID(t, map[string]any{"action": "append", "parentID": groupID, "data": itemDOM, "dataType": "dom"})
			if item := load(t, newItemID); item.Type != tc.itemType || item.Parent.ID != groupID {
				t.Fatal("standalone item fragment was not inserted into its native container")
			}
			call(t, map[string]any{"action": "move", "id": newItemID, "parentID": nestedID})
			if load(t, newItemID).Parent.ID != nestedID {
				t.Fatal("native item could not move between containers")
			}
			itemDOM = call(t, map[string]any{"action": "dom", "id": newItemID}).Content[0].Text
			call(t, map[string]any{"action": "update", "id": newItemID, "data": itemDOM, "dataType": "dom"})
			if load(t, newItemID).Parent.ID != nestedID {
				t.Fatal("item DOM update changed its parent or ID")
			}
			assertAttrs()
			call(t, map[string]any{"action": "move", "id": firstID, "parentID": groupID, "previousID": secondID})
			if load(t, firstID).Previous.ID != secondID {
				t.Fatal("native item move failed")
			}
			call(t, map[string]any{"action": "update", "id": bodyID, "data": "Edited body", "dataType": "markdown"})
			if load(t, bodyID).Parent.ID != firstID {
				t.Fatal("body update changed its parent or ID")
			}
			assertAttrs()
			dom := call(t, map[string]any{"action": "dom", "id": groupID}).Content[0].Text
			beforeIDs := load(t, groupID).BlockIDs()
			call(t, map[string]any{"action": "update", "id": groupID, "data": dom, "dataType": "dom"})
			if !slices.Equal(beforeIDs, load(t, groupID).BlockIDs()) {
				t.Fatal("DOM update changed existing descendant IDs")
			}
			assertAttrs()
			for _, args := range []map[string]any{
				{"action": "append", "parentID": groupID, "data": "Invalid child", "dataType": "markdown"},
				{"action": "update", "id": groupID, "data": call(t, map[string]any{"action": "get_kramdown", "id": groupID}).Content[0].Text, "dataType": "markdown"},
			} {
				before := readFile(t)
				result, err := tools.BlockTool.Handler(args)
				if err != nil || !result.IsError || !bytes.Equal(before, readFile(t)) {
					t.Fatalf("unsafe write was not rejected without persistence: %+v, %v", result, err)
				}
			}

			for _, endpoint := range []string{"appendBlock", "prependBlock", "insertBlock"} {
				for _, invalid := range []bool{false, true} {
					request := map[string]string{"parentID": groupID, "dataType": "dom", "data": fragmentDOM()}
					if endpoint == "insertBlock" {
						request["nextID"] = firstID
					}
					if invalid {
						request["dataType"], request["data"] = "markdown", "Invalid child"
					}
					body, _ := json.Marshal(request)
					path := "/api/block/" + endpoint
					before := readFile(t)
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, bytes.NewReader(body)))
					requireAPIContract(t, "POST", path, recorder)
					var response struct {
						Code int                             `json:"code"`
						Data []*apicontract.BlockTransaction `json:"data"`
					}
					if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
						t.Fatal(err)
					}
					if invalid {
						if !bytes.Equal(before, readFile(t)) ||
							(endpoint != "prependBlock" && (response.Code != -1 || response.Data != nil)) ||
							(endpoint == "prependBlock" && response.Code != 0) {
							t.Fatalf("invalid API insert changed document: %s", recorder.Body.String())
						}
					} else {
						if response.Code != 0 || len(response.Data) != 1 || len(response.Data[0].DoOperations) != 1 {
							t.Fatalf("native API insert failed: %s", recorder.Body.String())
						}
						operation := response.Data[0].DoOperations[0]
						if inserted := load(t, operation.ID); inserted.Type != tc.itemType || inserted.Parent.ID != groupID {
							t.Fatal("API returned a wrapper ID instead of the inserted item")
						}
					}
					assertAttrs()
				}
			}
			deleteID := load(t, groupID).ChildrenByType(tc.itemType)[0].ID
			call(t, map[string]any{"action": "delete", "id": deleteID})
			if strings.Contains(call(t, map[string]any{"action": "dom", "id": groupID}).Content[0].Text, deleteID) {
				t.Fatal("deleted native item remains in DOM")
			}
			assertAttrs()
			convertedID := writeID(t, map[string]any{"action": "append", "parentID": docID, "data": fragmentDOM(), "dataType": "dom"})
			call(t, map[string]any{"action": "update", "id": convertedID, "data": "Intentional conversion", "dataType": "markdown", "lockType": false})
			if load(t, convertedID).Type != ast.NodeParagraph {
				t.Fatal("explicit type conversion was blocked")
			}
		})
	}
}
