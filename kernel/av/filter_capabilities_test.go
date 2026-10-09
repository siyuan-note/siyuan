package av

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"sort"
	"testing"
)

func TestFilterCapabilityCompleteness(t *testing.T) {
	var profiles, operators []string
	for profile, capability := range filterCapabilities {
		profiles = append(profiles, string(profile))
		for _, list := range [][]FilterOperator{capability.Accepted, capability.Offered, capability.OfferedRollup} {
			seen := map[FilterOperator]bool{}
			for _, operator := range list {
				if !slices.Contains(filterOperators, operator) || seen[operator] {
					t.Fatalf("invalid or duplicate operator %s in %s", operator, profile)
				}
				seen[operator] = true
			}
		}
	}
	for operator := range calcFilterNumber {
		operators = append(operators, string(operator))
	}
	sort.Strings(profiles)
	sort.Strings(operators)
	if !reflect.DeepEqual(profiles, declaredCapabilityConstants(t, "FilterProfile")) ||
		!reflect.DeepEqual(operators, declaredCapabilityConstants(t, "CalcOperator")) {
		t.Fatal("filter profiles and calculated result types must cover all declarations")
	}
	var mask KeyGroup
	for _, group := range keyGroups {
		if group.flag == 0 || mask&group.flag != 0 {
			t.Fatal("duplicate or empty group flag")
		}
		mask |= group.flag
	}
	for typ, capability := range keyCapabilities {
		if _, found := filterCapabilities[capability.FilterProfile]; !found {
			t.Fatalf("missing filter profile for %s", typ)
		}
		if capability.Groups == 0 || capability.Groups&^mask != 0 ||
			capability.Groups&KeyGroupNone != 0 && capability.Groups != KeyGroupNone {
			t.Fatalf("field %s must explicitly declare valid groups", typ)
		}
	}
}

func TestFilterCapabilityAcceptedBaseline(t *testing.T) {
	data, err := os.ReadFile("testdata/filter-accepted.json")
	if err != nil {
		t.Fatal(err)
	}
	var baseline map[KeyType]map[FilterOperator]bool
	if err = json.Unmarshal(data, &baseline); err != nil {
		t.Fatal(err)
	}
	if len(baseline) != len(KeyTypes())+1 {
		t.Fatal("baseline must cover all supported types and an unknown type")
	}
	for typ, operators := range baseline {
		for operator, expected := range operators {
			if actual := IsFilterOperatorAllowed(typ, operator); actual != expected {
				t.Errorf("%s / %s: got %v want %v", typ, operator, actual, expected)
			}
		}
	}
}

func TestKeyGroupPhaseBehavior(t *testing.T) {
	groups := map[KeyGroup][]KeyType{
		KeyGroupNoFilterDefault:       {KeyTypeTemplate, KeyTypeRollup, KeyTypeCreated, KeyTypeUpdated, KeyTypeLocation},
		KeyGroupRenderDependentFilter: {KeyTypeTemplate, KeyTypeRollup, KeyTypeMAsset, KeyTypeCreated, KeyTypeUpdated},
		KeyGroupSkipRowCopy:           {KeyTypeRollup, KeyTypeCreated, KeyTypeUpdated},
		KeyGroupRenderAutoFill:        {KeyTypeTemplate, KeyTypeCreated, KeyTypeUpdated},
	}
	for _, typ := range append(KeyTypes(), KeyType("unknown")) {
		for group, members := range groups {
			if HasKeyGroup(typ, group) != slices.Contains(members, typ) {
				t.Fatalf("phase behavior changed for %s", typ)
			}
		}
		for _, sameAV := range []bool{false, true} {
			expected := typ == KeyTypeTemplate || !sameAV &&
				(typ == KeyTypeCreated || typ == KeyTypeUpdated || typ == KeyTypeRelation)
			if NeedsRollupTargetRender(typ, sameAV) != expected {
				t.Fatalf("rollup render changed for %s (sameAV=%v)", typ, sameAV)
			}
		}
	}
	if !reflect.DeepEqual(DateKeyTypes(), []KeyType{KeyTypeDate, KeyTypeCreated, KeyTypeUpdated}) {
		t.Fatal("calendar date order changed")
	}
}
