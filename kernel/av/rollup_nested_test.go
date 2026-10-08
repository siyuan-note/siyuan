package av

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func TestNestedRollupBuildContentsUsesCalculatedValues(t *testing.T) {
	for _, innerOperator := range []CalcOperator{CalcOperatorNone, CalcOperatorSum} {
		for _, outerOperator := range []CalcOperator{CalcOperatorNone, CalcOperatorSum, CalcOperatorCountAll} {
			t.Run(fmt.Sprintf("%s/%s", innerOperator, outerOperator), func(t *testing.T) {
				numberKey := &Key{ID: "number", Type: KeyTypeNumber}
				leaf := &AttributeView{ID: "leaf", KeyValues: []*KeyValues{{Key: numberKey, Values: []*Value{
					{KeyID: numberKey.ID, BlockID: "first", Type: KeyTypeNumber,
						Number: &ValueNumber{Content: 3, IsNotEmpty: true}},
					{KeyID: numberKey.ID, BlockID: "second", Type: KeyTypeNumber,
						Number: &ValueNumber{Content: 7, IsNotEmpty: true}},
				}}}}
				inner := &ValueRollup{}
				inner.BuildContents(leaf, numberKey,
					&Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"first", "second"}}},
					&RollupCalc{Operator: innerOperator}, nil)
				targetKey := &Key{ID: "rollup", Type: KeyTypeRollup}
				stored := &Value{KeyID: targetKey.ID, BlockID: "target", Type: KeyTypeRollup,
					Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeNumber,
						Number: &ValueNumber{Content: 999, IsNotEmpty: true}}}}}
				target := &AttributeView{ID: "target", KeyValues: []*KeyValues{{Key: targetKey, Values: []*Value{stored}}}}
				rendered := &Value{KeyID: targetKey.ID, BlockID: "target", Type: KeyTypeRollup, Rollup: inner}
				collection := &Table{Rows: []*TableRow{{ID: "target", Cells: []*TableCell{{
					BaseValue: &BaseValue{Value: rendered, ValueType: KeyTypeRollup},
				}}}}}
				before, err := json.Marshal([]*Value{stored, rendered})
				if err != nil {
					t.Fatal(err)
				}
				outer := &ValueRollup{}
				outer.BuildContents(target, targetKey,
					&Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"target"}}},
					&RollupCalc{Operator: outerOperator}, &RollupRenderContext{FurtherCollection: collection})
				want := []float64{3, 7}
				if innerOperator == CalcOperatorSum || outerOperator == CalcOperatorSum {
					want = []float64{10}
				}
				if outerOperator == CalcOperatorCountAll {
					want = []float64{float64(len(inner.Contents))}
				}
				var got []float64
				for _, value := range outer.Contents {
					if value.Type != KeyTypeNumber || value.Number == nil || !value.Number.IsNotEmpty {
						t.Fatalf("nested calculation left a wrapper or invalid scalar: %+v", value)
					}
					got = append(got, value.Number.Content)
					value.Number.Content = -1
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("outer calculation = %v, want %v", got, want)
				}
				after, err := json.Marshal([]*Value{stored, rendered})
				if err != nil {
					t.Fatal(err)
				}
				if string(after) != string(before) {
					t.Fatal("outer calculation or result mutation changed stored or rendered target values")
				}
			})
		}
	}
}

func TestNestedRollupBuildContentsDoesNotFallBackToStaleStoredValues(t *testing.T) {
	key := &Key{ID: "rollup", Type: KeyTypeRollup}
	stored := &Value{KeyID: key.ID, BlockID: "target", Type: KeyTypeRollup,
		Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeText, Text: &ValueText{Content: "stale"}}}}}
	target := &AttributeView{KeyValues: []*KeyValues{{Key: key, Values: []*Value{stored}}}}
	for _, state := range []string{"missing-row", "nil-rollup", "empty-rollup", "nil-content"} {
		t.Run(state, func(t *testing.T) {
			collection := &Table{}
			if state != "missing-row" {
				value := &Value{KeyID: key.ID, BlockID: "target", Type: KeyTypeRollup}
				if state != "nil-rollup" {
					value.Rollup = &ValueRollup{}
					if state == "nil-content" {
						value.Rollup.Contents = []*Value{nil}
					}
				}
				collection.Rows = []*TableRow{{ID: "target", Cells: []*TableCell{{
					BaseValue: &BaseValue{Value: value, ValueType: KeyTypeRollup},
				}}}}
			}
			result := &ValueRollup{Contents: []*Value{{Type: KeyTypeText, Text: &ValueText{Content: "old outer"}}}}
			result.BuildContents(target, key,
				&Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"target"}}},
				&RollupCalc{Operator: CalcOperatorNone}, &RollupRenderContext{FurtherCollection: collection})
			if len(result.Contents) != 0 {
				t.Fatalf("%s reused old results: %+v", state, result.Contents)
			}
			if stored.String(true) != "stale" {
				t.Fatal("empty calculated target changed the stored rollup")
			}
		})
	}
}
