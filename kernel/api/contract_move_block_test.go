package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testAPIContractMoveBlock(t *testing.T, engine *gin.Engine, boxID string) {
	t.Helper()
	tree := treenode.NewTree(boxID, "/"+ast.NewNodeID()+".sy", "/Move", "Move")
	paragraphID := tree.Root.FirstChild.ID
	list := &ast.Node{Type: ast.NodeList, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0}}
	list.SetIALAttr("id", list.ID)
	for i := 0; i < 3; i++ {
		item := &ast.Node{Type: ast.NodeListItem, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0}}
		item.SetIALAttr("id", item.ID)
		paragraph := treenode.NewParagraph(ast.NewNodeID())
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("item")})
		item.AppendChild(paragraph)
		list.AppendChild(item)
	}
	tree.Root.AppendChild(list)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	path := filepath.Join(util.DataDir, boxID, tree.Path)
	for _, test := range []struct {
		name, id, previousID, parentID string
		code                           int
		unchanged                      bool
	}{
		{"invalid structure", list.FirstChild.ID, list.ID, tree.ID, -1, true},
		{"self move", paragraphID, paragraphID, "", 0, true},
		{"move parent into child", list.ID, list.FirstChild.ID, "", 0, true},
		{"valid move", paragraphID, list.ID, "", 0, false},
	} {
		t.Run("moveBlock/"+test.name, func(t *testing.T) {
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			request := map[string]string{"id": test.id, "previousID": test.previousID}
			if test.parentID != "" {
				request["parentID"] = test.parentID
			}
			body, _ := json.Marshal(request)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/block/moveBlock", bytes.NewReader(body)))
			requireAPIContract(t, "POST", "/api/block/moveBlock", recorder)
			var response struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != test.code ||
				string(response.Data) != "null" {
				t.Fatalf("unexpected move response: %s, %v", recorder.Body.String(), err)
			}
			if test.code != 0 && !strings.Contains(response.Msg, "invalid block structure") {
				t.Fatalf("missing structural failure reason: %s", recorder.Body.String())
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if test.unchanged && !bytes.Equal(before, after) {
				t.Fatal("rejected or skipped move changed the persisted document")
			}
			updated, err := model.LoadTreeByBlockID(tree.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !test.unchanged {
				paragraph := treenode.GetNodeInTree(updated, paragraphID)
				if paragraph == nil || paragraph.Previous == nil || paragraph.Previous.ID != list.ID {
					t.Fatal("paragraph was not moved after the list")
				}
			}
			persistedList := treenode.GetNodeInTree(updated, list.ID)
			if persistedList == nil || persistedList.FirstChild == nil {
				t.Fatal("persisted list is missing")
			}
			item := persistedList.FirstChild
			for expected := list.FirstChild; expected != nil; expected = expected.Next {
				if item == nil || item.ID != expected.ID {
					t.Fatal("persisted list item order changed")
				}
				item = item.Next
			}
			if item != nil {
				t.Fatal("persisted list contains unexpected items")
			}
		})
	}
}
