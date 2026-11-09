// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBazaarCompatibilityFilterDefaults(t *testing.T) {
	for _, input := range []string{`null`, `{}`, `{"trust":true,"petalDisabled":true}`, `{"compatibilityFilters":null}`, `{"compatibilityFilters":{"plugins":null,"unknown":{}}}`} {
		t.Run(input, func(t *testing.T) {
			var value *Bazaar
			if err := json.Unmarshal([]byte(input), &value); err != nil {
				t.Fatal(err)
			}
			value = NormalizeBazaar(value)
			if len(value.CompatibilityFilters) != 5 {
				t.Fatalf("expected five known package types, got %#v", value.CompatibilityFilters)
			}
			for pkgType := range NewBazaar().CompatibilityFilters {
				filter := value.CompatibilityFilters[pkgType]
				if filter == nil || filter.HideUnsupportedVersion || filter.HideIncompatiblePlatform {
					t.Fatalf("%s did not restore default filters: %#v", pkgType, filter)
				}
			}
			if input == `{"trust":true,"petalDisabled":true}` && (!value.Trust || !value.PetalDisabled) {
				t.Fatal("legacy trust and plugin settings changed")
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			var restored Bazaar
			if err = json.Unmarshal(encoded, &restored); err != nil || !reflect.DeepEqual(value, NormalizeBazaar(&restored)) {
				t.Fatalf("normalization is not stable across reload: %s %v", encoded, err)
			}
		})
	}
}

func TestBazaarCompatibilityFiltersRemainIndependent(t *testing.T) {
	value := NewBazaar()
	value.CompatibilityFilters["plugins"].HideUnsupportedVersion = true
	value.CompatibilityFilters["themes"].HideIncompatiblePlatform = true
	value = NormalizeBazaar(value)
	for pkgType, filter := range value.CompatibilityFilters {
		if filter.HideUnsupportedVersion != (pkgType == "plugins") || filter.HideIncompatiblePlatform != (pkgType == "themes") {
			t.Fatalf("%s inherited another package type's filters: %#v", pkgType, filter)
		}
	}
	for pkgType, filter := range NewBazaar().CompatibilityFilters {
		if filter.HideUnsupportedVersion || filter.HideIncompatiblePlatform {
			t.Fatalf("%s constructor shared mutable defaults", pkgType)
		}
	}
}

func TestBazaarBatchUpdateExclusionsNormalize(t *testing.T) {
	for _, input := range []string{`null`, `{}`, `{"batchUpdateExcluded":null}`, `{"batchUpdateExcluded":{"plugins":null,"unknown":{"a":true}}}`} {
		var value *Bazaar
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatal(err)
		}
		value = NormalizeBazaar(value)
		if !reflect.DeepEqual(value.BatchUpdateExcluded, NewBazaar().BatchUpdateExcluded) {
			t.Fatalf("%s: %#v", input, value.BatchUpdateExcluded)
		}
	}
	value := NewBazaar()
	value.BatchUpdateExcluded["plugins"] = map[string]bool{"sample": true, "": true, " ": true, "other": true, "restored": false}
	value = NormalizeBazaar(value)
	if !reflect.DeepEqual(value.BatchUpdateExcluded["plugins"], map[string]bool{"sample": true, "other": true}) || len(value.BatchUpdateExcluded["themes"]) != 0 || len(NewBazaar().BatchUpdateExcluded["plugins"]) != 0 {
		t.Fatalf("unexpected exclusions: %#v", value.BatchUpdateExcluded)
	}
}
