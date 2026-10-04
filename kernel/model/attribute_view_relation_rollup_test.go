// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewContextFilterRelationRollup(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	employees := av.NewAttributeView(ast.NewNodeID())
	employees.GetBlockKeyValues().Values = append(employees.GetBlockKeyValues().Values, &av.Value{
		KeyID: employees.GetBlockKey().ID, BlockID: "employee", Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{ID: fixture.tree.Root.ID},
	})
	tasks := av.NewAttributeView(ast.NewNodeID())
	staff := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: employees.ID}}
	tasks.KeyValues = append(tasks.KeyValues, &av.KeyValues{Key: staff})
	projects := fixture.attrView
	relation := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: tasks.ID}}
	rollup := &av.Key{ID: ast.NewNodeID(), Name: "Employees", Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{RelationKeyID: relation.ID, KeyID: staff.ID}}
	projects.KeyValues = append(projects.KeyValues, &av.KeyValues{Key: relation}, &av.KeyValues{Key: rollup})
	for _, database := range []*av.AttributeView{employees, tasks, projects} {
		if err := av.SaveAttributeView(database); nil != err {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		av.SetAVBoxID(employees.ID, "")
		av.SetAVBoxID(tasks.ID, "")
	})
	if _, err := setAttributeViewContextFilterForTest(blockID, projects.ID, rollup.ID); nil != err {
		t.Fatal(err)
	}
	context, err := resolveAttributeViewFilterContext(projects, fixture.tableView, blockID)
	if nil != err || nil == context || len(context.CurrentDocumentItemIDs) != 1 ||
		context.CurrentDocumentItemIDs[0] != "employee" {
		t.Fatalf("context did not resolve the final employee database: %+v, %v", context, err)
	}
	fields := GetAttributeViewContextFilterFields(projects, blockID)
	found := false
	for _, field := range fields {
		if field.ID == rollup.ID {
			found = field.TargetAvID == employees.ID
		}
	}
	if !found {
		t.Fatal("rollup context candidate did not expose the final database")
	}
	values := map[string]*av.Value{}
	applyAttributeViewContextFilterDefaultValue(projects, "new-project", context, values)
	if len(values) != 0 {
		t.Fatal("read-only rollup context must not write defaults or intermediate relations")
	}
	rollup.Rollup.Calc = &av.RollupCalc{Operator: av.CalcOperatorCountAll}
	context, err = resolveAttributeViewFilterContext(projects, fixture.tableView, blockID)
	if nil != err || nil == context || len(context.CurrentDocumentItemIDs) != 0 {
		t.Fatalf("invalidated rollup context must retain configuration and match nothing: %+v, %v", context, err)
	}
}
