package sql

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestNestedRollupRefreshWithoutRenderingIntermediate(t *testing.T) {
	for _, typ := range []av.KeyType{av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeBlock, av.KeyTypeLocation} {
		for _, stale := range []bool{false, true} {
			for _, levels := range []int{3, 4} {
				t.Run(fmt.Sprintf("%s/stale=%v/levels=%d", typ, stale, levels), func(t *testing.T) {
					leaf, leafKey := newNestedRollupTestLeaf(typ)
					cache := map[string]*av.AttributeView{leaf.ID: leaf}
					outer, outerKey := leaf, leafKey
					var intermediate []*av.AttributeView
					for level := 1; level < levels; level++ {
						outer, outerKey = newNestedRollupTestLevel(fmt.Sprintf("level-%d", level), outer, outerKey, stale)
						cache[outer.ID] = outer
						if level < levels-1 {
							intermediate = append(intermediate, outer)
						}
					}
					before := nestedRollupTestSnapshot(t, intermediate)
					for update := 0; update < 4; update++ {
						for row, value := range nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values {
							switch typ {
							case av.KeyTypeText:
								value.Text.Content = fmt.Sprintf("updated-%d-%d", update, row)
							case av.KeyTypeNumber:
								value.Number.Content = float64(update*10 + row + 1)
							case av.KeyTypeBlock:
								value.Block.Content = fmt.Sprintf("updated-%d-%d", update, row)
							case av.KeyTypeLocation:
								value.Location.Name = fmt.Sprintf("updated-%d-%d", update, row)
							}
						}
						collection := renderNestedRollupTestView(t, outer, cache)
						for row, block := range outer.GetBlockKeyValues().Values {
							got := collection.GetValue(block.BlockID, outerKey.ID)
							want := nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values[row].String(true)
							if got == nil || got.String(true) != want {
								t.Fatalf("update %d row %d: got %v, want %q", update, row, got, want)
							}
							if len(got.Rollup.Contents) != 1 || got.Rollup.Contents[0].Type != typ {
								t.Fatalf("nested result did not preserve scalar type %s: %+v", typ, got.Rollup.Contents)
							}
						}
						if after := nestedRollupTestSnapshot(t, intermediate); after != before {
							t.Fatal("rendering the outer rollup changed stored intermediate values")
						}
					}
				})
			}
		}
	}
}

func TestRenderRollupTargetIgnoresPresentationAndPreservesSource(t *testing.T) {
	leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
	target, key := newNestedRollupTestLevel("target", leaf, leafKey, true)
	view := target.Views[0]
	view.Table.Columns = view.Table.Columns[:1]
	view.Table.Columns[0].Hidden = true
	view.Group = &av.ViewGroup{Field: target.GetBlockKey().ID}
	view.GroupItemIDs = []string{target.GetBlockKeyValues().Values[1].BlockID}
	view.PageSize = 1
	view.Filters = []*av.ViewFilter{{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorIsEqual,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "excluded"}}}}
	key.RenderTemplate = "should not become stored rollup content"
	staleRendered := &av.Table{BaseInstance: av.NewViewBaseInstance(view)}
	target.RenderedViewables[view.ID] = staleRendered
	before := nestedRollupTestSnapshot(t, []*av.AttributeView{leaf, target})
	depth := 2
	context := NewAttributeViewRenderContext()
	collection := renderRollupTarget(target, key, &depth,
		map[string]*av.AttributeView{target.ID: target, leaf.ID: leaf}, context)
	if len(collection.GetItems()) != 2 {
		t.Fatalf("target presentation removed related items: %d", len(collection.GetItems()))
	}
	for row, block := range target.GetBlockKeyValues().Values {
		value := collection.GetValue(block.BlockID, key.ID)
		if value == nil || value.String(true) != nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values[row].String(true) {
			t.Fatalf("target row %d was not freshly calculated: %+v", row, value)
		}
		value.Rollup.Contents[0].Text.Content = "mutated rendered clone"
	}
	if after := nestedRollupTestSnapshot(t, []*av.AttributeView{leaf, target}); after != before {
		t.Fatal("target rendering changed original keys, stored values, or views")
	}
	if target.RenderedViewables[view.ID] != staleRendered || depth != 2 || len(context.renderingRollupTargets) != 0 {
		t.Fatal("target rendering changed the original view cache or leaked recursion state")
	}
}

func TestNestedRollupDiamondDoesNotConsumeSiblingDepth(t *testing.T) {
	leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
	shared, sharedKey := newNestedRollupTestLevel("shared", leaf, leafKey, true)
	cache := map[string]*av.AttributeView{leaf.ID: leaf, shared.ID: shared}
	outer := newNestedRollupTestDatabase("outer")
	var keys []*av.Key
	for branch := 0; branch < 12; branch++ {
		target, targetKey := newNestedRollupTestLevel(fmt.Sprintf("branch-%d", branch), shared, sharedKey, true)
		cache[target.ID] = target
		keys = append(keys, addNestedRollupTestFields(outer, target, targetKey, false))
	}
	cache[outer.ID] = outer
	for repeat := 0; repeat < 2; repeat++ {
		if repeat == 1 {
			for _, key := range keys {
				key.Rollup.Filters = nestedRollupTestFilters(key.Rollup.KeyID, "fresh-0")
			}
		}
		collection := renderNestedRollupTestView(t, outer, cache)
		for _, key := range keys {
			for row, block := range outer.GetBlockKeyValues().Values {
				value := collection.GetValue(block.BlockID, key.ID)
				want := nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values[row].String(true)
				if repeat == 1 && row == 1 {
					want = ""
				}
				if value == nil || value.String(true) != want {
					t.Fatalf("sibling %s row %d lost its dependency: %+v", key.ID, row, value)
				}
			}
		}
	}
}

func TestRenderRollupTargetCyclesAndDepthDoNotUseStoredContents(t *testing.T) {
	for _, self := range []bool{true, false} {
		t.Run(fmt.Sprintf("self=%v", self), func(t *testing.T) {
			first := newNestedRollupTestDatabase("first")
			second := first
			if !self {
				second = newNestedRollupTestDatabase("second")
			}
			firstKey := addNestedRollupTestFields(first, second, second.GetBlockKey(), true)
			secondKey := firstKey
			if !self {
				secondKey = addNestedRollupTestFields(second, first, firstKey, true)
			}
			firstKey.Rollup.KeyID = secondKey.ID
			cache := map[string]*av.AttributeView{first.ID: first, second.ID: second}
			before := nestedRollupTestSnapshot(t, []*av.AttributeView{first, second})
			context := NewAttributeViewRenderContext()
			depth := 2
			for repeat := 0; repeat < 2; repeat++ {
				collection := renderRollupTarget(first, firstKey, &depth, cache, context)
				for _, item := range collection.GetItems() {
					if value := collection.GetValue(item.GetID(), firstKey.ID); value == nil || value.String(true) != "" {
						t.Fatalf("cycle reused stored contents: %+v", value)
					}
				}
				if depth != 2 || len(context.renderingRollupTargets) != 0 {
					t.Fatal("cycle detection leaked its guard or consumed outer depth")
				}
			}
			depth = 8
			if collection := renderRollupTarget(first, firstKey, &depth, cache, context); len(collection.GetItems()) != 0 {
				t.Fatal("depth-limited rendering reused stored contents")
			}
			if nestedRollupTestSnapshot(t, []*av.AttributeView{first, second}) != before {
				t.Fatal("cycle rendering modified original values")
			}
		})
	}
}

func TestRenderRollupTargetAllowsDifferentFieldsInSameDatabase(t *testing.T) {
	leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
	first := addNestedRollupTestFields(leaf, leaf, leafKey, true)
	second := addNestedRollupTestFields(leaf, leaf, first, true)
	outer, outerKey := newNestedRollupTestLevel("outer", leaf, second, true)
	collection := renderNestedRollupTestView(t, outer, map[string]*av.AttributeView{leaf.ID: leaf, outer.ID: outer})
	for row, block := range outer.GetBlockKeyValues().Values {
		value := collection.GetValue(block.BlockID, outerKey.ID)
		if value == nil || value.String(true) != nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values[row].String(true) {
			t.Fatalf("different fields in the same database were treated as a cycle: %+v", value)
		}
	}
}

func TestRenderRollupTargetCyclicFilterDependencyTerminates(t *testing.T) {
	leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
	target, key := newNestedRollupTestLevel("target", leaf, leafKey, true)
	backlink := addNestedRollupTestFields(leaf, target, key, true)
	key.Rollup.Filters = nestedRollupTestFilters(backlink.ID, "fresh-0")
	cache := map[string]*av.AttributeView{leaf.ID: leaf, target.ID: target}
	context := NewAttributeViewRenderContext()
	depth := 2
	for repeat := 0; repeat < 2; repeat++ {
		collection := renderRollupTarget(target, key, &depth, cache, context)
		for _, item := range collection.GetItems() {
			if value := collection.GetValue(item.GetID(), key.ID); value == nil || value.String(true) != "" {
				t.Fatalf("cyclic filter reused stale contents: %+v", value)
			}
		}
		if depth != 2 || len(context.renderingRollupTargets) != 0 {
			t.Fatalf("cyclic filter leaked state: depth=%d, active=%v", depth, context.renderingRollupTargets)
		}
	}
}

func TestRenderRollupTargetMissingDependencyClearsStoredContents(t *testing.T) {
	for _, missing := range []string{"relation-key", "relation-config", "relation-value", "target-key", "rollup-config"} {
		t.Run(missing, func(t *testing.T) {
			leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
			target, key := newNestedRollupTestLevel("target", leaf, leafKey, true)
			switch missing {
			case "relation-key":
				key.Rollup.RelationKeyID = "missing"
			case "relation-config":
				relationKey, _ := target.GetKey(key.Rollup.RelationKeyID)
				relationKey.Relation = nil
			case "relation-value":
				nestedRollupTestKeyValues(t, target, key.Rollup.RelationKeyID).Values = nil
			case "target-key":
				key.Rollup.KeyID = "missing"
			case "rollup-config":
				key.Rollup = nil
			}
			before := nestedRollupTestSnapshot(t, []*av.AttributeView{target})
			depth := 2
			collection := renderRollupTarget(target, key, &depth,
				map[string]*av.AttributeView{leaf.ID: leaf, target.ID: target}, NewAttributeViewRenderContext())
			for _, item := range collection.GetItems() {
				value := collection.GetValue(item.GetID(), key.ID)
				if value != nil && value.String(true) != "" {
					t.Fatalf("missing %s reused stored contents: %+v", missing, value)
				}
			}
			if nestedRollupTestSnapshot(t, []*av.AttributeView{target}) != before {
				t.Fatal("missing dependency handling modified stored values")
			}
		})
	}
}

func TestNestedRollupTargetFiltersAndSortUseFreshValues(t *testing.T) {
	leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
	target, targetKey := newNestedRollupTestLevel("target", leaf, leafKey, true)
	outer, outerKey := newNestedRollupTestLevel("outer", target, targetKey, true)
	cache := map[string]*av.AttributeView{leaf.ID: leaf, target.ID: target, outer.ID: outer}
	for update := 0; update < 2; update++ {
		values := nestedRollupTestKeyValues(t, leaf, leafKey.ID).Values
		values[update].Text.Content = "alpha"
		values[1-update].Text.Content = "zulu"
		outer.Views[0].Sorts = []*av.ViewSort{{Column: outerKey.ID, Order: av.SortOrderAsc}}
		collection := renderNestedRollupTestView(t, outer, cache)
		av.Sort(collection, outer)
		if got := collection.GetItems()[0].GetID(); got != outer.GetBlockKeyValues().Values[update].BlockID {
			t.Fatalf("sort retained stale order after update %d: %s", update, got)
		}
		outer.Views[0].Filters = nestedRollupTestFilters(outerKey.ID, "alpha")
		viewable := renderNestedRollupTestView(t, outer, cache)
		depth := 1
		av.Filter(viewable, outer, getFurtherCollections(outer, cache, &depth, NewAttributeViewRenderContext()), cache)
		if items := viewable.GetItems(); len(items) != 1 || items[0].GetID() != outer.GetBlockKeyValues().Values[update].BlockID {
			t.Fatalf("outer rollup view filter retained stale values after update %d: %+v", update, items)
		}
		outer.Views[0].Filters = nil
		outerKey.Rollup.Filters = nestedRollupTestFilters(targetKey.ID, "alpha")
		context := NewAttributeViewRenderContext()
		depth = 1
		further := getFurtherCollections(outer, cache, &depth, context)
		eligible := further[outerKey.ID].EligibleItemIDs
		if len(eligible) != 1 || !eligible[target.GetBlockKeyValues().Values[update].BlockID] {
			t.Fatalf("rollup target filter retained stale values after update %d: %+v", update, eligible)
		}
		filtered := renderNestedRollupTestView(t, outer, cache)
		for row, block := range outer.GetBlockKeyValues().Values {
			want := ""
			if row == update {
				want = "alpha"
			}
			if value := filtered.GetValue(block.BlockID, outerKey.ID); value == nil || value.String(true) != want {
				t.Fatalf("filtered row %d after update %d: got %v, want %q", row, update, value, want)
			}
		}
		outerKey.Rollup.Filters = nil
	}
}

func TestNestedRollupQuantifiedEmptyFiltersUseFreshValues(t *testing.T) {
	for _, qualifier := range []av.FilterQuantifier{av.FilterQuantifierAny, av.FilterQuantifierAll, av.FilterQuantifierNone} {
		for _, operator := range []av.FilterOperator{av.FilterOperatorIsEmpty, av.FilterOperatorIsNotEmpty} {
			t.Run(fmt.Sprintf("%s/%s", qualifier, operator), func(t *testing.T) {
				leaf, leafKey := newNestedRollupTestLeaf(av.KeyTypeText)
				target, targetKey := newNestedRollupTestLevel("target", leaf, leafKey, true)
				outer, outerKey := newNestedRollupTestLevel("outer", target, targetKey, true)
				cache := map[string]*av.AttributeView{leaf.ID: leaf, target.ID: target, outer.ID: outer}
				outer.Views[0].Filters = []*av.ViewFilter{{Column: outerKey.ID, Qualifier: qualifier, Operator: operator,
					Value: &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{}}}}
				relations := nestedRollupTestKeyValues(t, target, targetKey.Rollup.RelationKeyID).Values
				for emptyRow := 0; emptyRow < 2; emptyRow++ {
					for row, value := range relations {
						value.Relation.BlockIDs = nil
						if row != emptyRow {
							value.Relation.BlockIDs = []string{leaf.GetBlockKeyValues().Values[row].BlockID}
						}
					}
					table := renderNestedRollupTestView(t, outer, cache)
					depth := 1
					av.Filter(table, outer, getFurtherCollections(outer, cache, &depth, NewAttributeViewRenderContext()), cache)
					wantEmpty := operator == av.FilterOperatorIsEmpty
					if qualifier == av.FilterQuantifierNone {
						wantEmpty = !wantEmpty
					}
					wantRow := emptyRow
					if !wantEmpty {
						wantRow = 1 - emptyRow
					}
					wantID := outer.GetBlockKeyValues().Values[wantRow].BlockID
					if len(table.Rows) != 1 || table.Rows[0].ID != wantID {
						t.Fatalf("empty inner row %d: got %+v, want only %s", emptyRow, table.Rows, wantID)
					}
				}
			})
		}
	}
}

func newNestedRollupTestDatabase(id string) *av.AttributeView {
	key := &av.Key{ID: id + "-primary", Name: "Primary", Type: av.KeyTypeBlock}
	values := &av.KeyValues{Key: key}
	for row := 0; row < 2; row++ {
		itemID := fmt.Sprintf("2026100800000%d-%s", row, id)
		values.Values = append(values.Values, &av.Value{
			ID: itemID + "-primary", KeyID: key.ID, BlockID: itemID, Type: key.Type,
			IsDetached: true, Block: &av.ValueBlock{Content: fmt.Sprintf("%s %d", id, row)},
		})
	}
	view := &av.View{ID: id + "-view", LayoutType: av.LayoutTypeTable, Table: av.NewLayoutTable()}
	view.Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: key.ID}}}
	return &av.AttributeView{ID: id, KeyValues: []*av.KeyValues{values}, Views: []*av.View{view},
		RenderedViewables: map[string]av.Viewable{}}
}

func newNestedRollupTestLeaf(typ av.KeyType) (*av.AttributeView, *av.Key) {
	attrView := newNestedRollupTestDatabase("leaf")
	if typ == av.KeyTypeBlock {
		return attrView, attrView.GetBlockKey()
	}
	key := &av.Key{ID: "leaf-value", Name: "Value", Type: typ}
	values := &av.KeyValues{Key: key}
	for row, block := range attrView.GetBlockKeyValues().Values {
		value := &av.Value{ID: block.BlockID + "-value", KeyID: key.ID, BlockID: block.BlockID, Type: typ}
		if typ == av.KeyTypeNumber {
			value.Number = &av.ValueNumber{Content: float64(row + 1), IsNotEmpty: true}
		} else if typ == av.KeyTypeLocation {
			value.Location = &av.ValueLocation{Name: fmt.Sprintf("fresh-%d", row), CoordinateSystem: "unknown", OriginalInput: "source"}
		} else {
			value.Text = &av.ValueText{Content: fmt.Sprintf("fresh-%d", row)}
		}
		values.Values = append(values.Values, value)
	}
	attrView.KeyValues = append(attrView.KeyValues, values)
	attrView.Views[0].Table.Columns = append(attrView.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	return attrView, key
}

func newNestedRollupTestLevel(id string, target *av.AttributeView, targetKey *av.Key,
	stale bool) (*av.AttributeView, *av.Key) {
	attrView := newNestedRollupTestDatabase(id)
	return attrView, addNestedRollupTestFields(attrView, target, targetKey, stale)
}

func addNestedRollupTestFields(attrView, target *av.AttributeView, targetKey *av.Key, stale bool) *av.Key {
	prefix := fmt.Sprintf("%s-%d", attrView.ID, len(attrView.KeyValues))
	relation := &av.Key{ID: prefix + "-relation", Name: prefix + " relation", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: target.ID}}
	rollup := &av.Key{ID: prefix + "-rollup", Name: prefix + " rollup", Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{RelationKeyID: relation.ID, KeyID: targetKey.ID,
			Calc: &av.RollupCalc{Operator: av.CalcOperatorNone}}}
	relations, rollups := &av.KeyValues{Key: relation}, &av.KeyValues{Key: rollup}
	for row, block := range attrView.GetBlockKeyValues().Values {
		relations.Values = append(relations.Values, &av.Value{
			ID: block.BlockID + relation.ID, KeyID: relation.ID, BlockID: block.BlockID, Type: relation.Type,
			Relation: &av.ValueRelation{BlockIDs: []string{target.GetBlockKeyValues().Values[row].BlockID}},
		})
		if stale {
			rollups.Values = append(rollups.Values, &av.Value{
				ID: block.BlockID + rollup.ID, KeyID: rollup.ID, BlockID: block.BlockID, Type: rollup.Type,
				Rollup: &av.ValueRollup{Contents: []*av.Value{{Type: av.KeyTypeText, Text: &av.ValueText{Content: "stale"}}}},
			})
		}
	}
	attrView.KeyValues = append(attrView.KeyValues, relations, rollups)
	for _, key := range []*av.Key{relation, rollup} {
		attrView.Views[0].Table.Columns = append(attrView.Views[0].Table.Columns,
			&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	}
	return rollup
}

func renderNestedRollupTestView(t *testing.T, attrView *av.AttributeView,
	cache map[string]*av.AttributeView) *av.Table {
	t.Helper()
	context := NewAttributeViewRenderContext()
	depth := 1
	viewable := renderView(attrView, attrView.Views[0], "", &depth, cache, false, false, context)
	if viewable == nil {
		t.Fatal("outer view did not render")
	}
	if depth != 2 || len(context.renderingRollupTargets) != 0 {
		t.Fatalf("nested calculation leaked state: depth=%d, active=%v", depth, context.renderingRollupTargets)
	}
	return viewable.(*av.Table)
}

func nestedRollupTestFilters(keyID, text string) []*av.ViewFilter {
	return []*av.ViewFilter{{Column: keyID, Qualifier: av.FilterQuantifierAny, Operator: av.FilterOperatorIsEqual,
		Value: &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{{
			Type: av.KeyTypeText, Text: &av.ValueText{Content: text},
		}}}}}}
}

func nestedRollupTestSnapshot(t *testing.T, attrViews []*av.AttributeView) string {
	t.Helper()
	data, err := json.Marshal(attrViews)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func nestedRollupTestKeyValues(t *testing.T, attrView *av.AttributeView, keyID string) *av.KeyValues {
	t.Helper()
	values, err := attrView.GetKeyValues(keyID)
	if err != nil {
		t.Fatal(err)
	}
	return values
}
