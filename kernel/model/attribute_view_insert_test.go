package model

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestAttributeViewInsertSourceBindingState(t *testing.T) {
	for _, test := range []struct {
		name       string
		field      string
		isDetached bool
	}{
		{name: "omitted"},
		{name: "null", field: `,"isDetached":null`},
		{name: "bound", field: `,"isDetached":false`},
		{name: "detached", field: `,"isDetached":true`, isDetached: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupDatabaseBlockTransactionTest(t, false)
			boxConf := conf.NewBoxConf()
			boxConf.Closed = false
			if err := (&Box{ID: fixture.tree.Box}).SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			itemID := ast.NewNodeID()
			var operation Operation
			data := `{"action":"insertAttrViewBlock","avID":"` + fixture.attrView.ID +
				`","srcs":[{"itemID":"` + itemID + `","id":"` + fixture.tree.Root.ID +
				`","content":"Primary"` + test.field + `}],"ignoreDefaultFill":true}`
			if err := json.Unmarshal([]byte(data), &operation); err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{
				trees: map[string]*parse.Tree{fixture.tree.ID: fixture.tree},
				nodes: map[string]*ast.Node{},
			}
			if txErr := tx.doInsertAttrViewBlock(&operation); txErr != nil {
				t.Fatalf("insert source failed: %v", txErr)
			}
			saved, err := av.ParseAttributeView(fixture.attrView.ID)
			if err != nil {
				t.Fatal(err)
			}
			value := saved.GetBlockValue(itemID)
			if value == nil || value.IsDetached != test.isDetached {
				t.Fatalf("unexpected restored primary value: %+v", value)
			}
			if test.isDetached {
				if value.Block.ID != "" || value.Block.Content != "Primary" {
					t.Fatalf("unexpected detached primary value: %+v", value.Block)
				}
			} else if value.Block.ID != fixture.tree.Root.ID ||
				fixture.tree.Root.IALAttr(av.NodeAttrNameAvs) != fixture.attrView.ID {
				t.Fatalf("bound source did not restore the original block binding: %+v", value.Block)
			}
		})
	}
}

func TestAttributeViewInsertSourceValidationBeforeBinding(t *testing.T) {
	for name, invalid := range map[string]map[string]any{
		"null source":      nil,
		"invalid detached": {"isDetached": "false"},
		"missing block":    {"isDetached": false},
		"invalid block":    {"id": 1},
	} {
		t.Run(name, func(t *testing.T) {
			fixture := setupDatabaseBlockTransactionTest(t, false)
			before, err := json.Marshal(fixture.attrView)
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{
				trees: map[string]*parse.Tree{fixture.tree.ID: fixture.tree},
				nodes: map[string]*ast.Node{},
			}
			// 插入顺序会反转，先读取有效来源，再校验错误来源，整批失败时不能留下绑定。
			operation := &Operation{AvID: fixture.attrView.ID, Srcs: []map[string]any{
				invalid, {"id": fixture.tree.Root.ID, "isDetached": false},
			}}
			if txErr := tx.doInsertAttrViewBlock(operation); txErr == nil {
				t.Fatal("invalid source was accepted")
			}
			if fixture.tree.Root.IALAttr(av.NodeAttrNameAvs) != "" {
				t.Fatal("rejected batch changed document bindings")
			}
			saved, err := av.ParseAttributeView(fixture.attrView.ID)
			if err != nil {
				t.Fatal(err)
			}
			after, err := json.Marshal(saved)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("rejected batch changed the persisted database")
			}
		})
	}
}
