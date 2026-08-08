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

package util

import (
	"reflect"
	"testing"
)

func TestFilterIconValuePreservesSupportedValues(t *testing.T) {
	for _, icon := range []string{
		"1f600",
		"folder/icon.png",
		"api/icon/getDynamicIcon?type=8&content=A.B",
		"https://example.com/icon?id=1&size=2",
		"http://127.0.0.1:8080/icon",
	} {
		filtered, valid := FilterIconValue(icon)
		if !valid {
			t.Fatalf("supported icon value was rejected [%q]", icon)
		}
		if filtered != icon {
			t.Fatalf("supported icon value was changed [expected=%q, actual=%q]", icon, filtered)
		}
	}
}

func TestFilterIconValueRejectsUnsupportedURLs(t *testing.T) {
	for _, icon := range []string{
		"data:image/png;base64,AAAA",
		"file:///tmp/icon.png",
		"ftp://example.com/icon.png",
		"javascript:alert(1)",
		"//example.com/icon.png",
	} {
		if filtered, valid := FilterIconValue(icon); valid {
			t.Fatalf("unsupported icon URL was accepted [input=%q, actual=%q]", icon, filtered)
		}
	}
}

func TestFilterIconValueSanitizesCustomEmoji(t *testing.T) {
	icon := `" onerror="alert(1).png`
	filtered, valid := FilterIconValue(icon)
	if !valid {
		t.Fatalf("custom emoji was rejected [%q]", icon)
	}
	if filtered == icon {
		t.Fatalf("unsafe custom emoji filename was preserved [%q]", icon)
	}
}

func TestFilterRecentIconValueRemovesDynamicIconID(t *testing.T) {
	icon := "api/icon/getDynamicIcon?type=8&content=%E6%97%A5&id=source&color=%23d23f31"
	filtered, valid := FilterRecentIconValue(icon)
	if !valid {
		t.Fatalf("dynamic icon was rejected [%q]", icon)
	}
	expected := "api/icon/getDynamicIcon?color=%23d23f31&content=%E6%97%A5&type=8"
	if filtered != expected {
		t.Fatalf("dynamic icon was not canonicalized [expected=%q, actual=%q]", expected, filtered)
	}
}

func TestFilterRecentIconValuesReturnsNonNilEmptySlice(t *testing.T) {
	filtered := FilterRecentIconValues(nil)
	if nil == filtered {
		t.Fatal("empty recent icons were returned as nil")
	}
	if 0 != len(filtered) {
		t.Fatalf("empty recent icons were not preserved [actual=%v]", filtered)
	}
}

func TestFilterRecentIconValuesCanonicalizesAndDeduplicates(t *testing.T) {
	filtered := FilterRecentIconValues([]string{
		"1f600",
		"1f600",
		"api/icon/getDynamicIcon?type=8&content=%E6%97%A5&id=source&color=%23d23f31",
		"api/icon/getDynamicIcon?color=%23d23f31&content=%E6%97%A5&type=8",
		"file:///tmp/icon.png",
	})
	expected := []string{
		"1f600",
		"api/icon/getDynamicIcon?color=%23d23f31&content=%E6%97%A5&type=8",
	}
	if !reflect.DeepEqual(expected, filtered) {
		t.Fatalf("recent icons were not filtered [expected=%v, actual=%v]", expected, filtered)
	}
}
