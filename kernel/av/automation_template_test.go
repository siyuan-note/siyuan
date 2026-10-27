// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestAutomationTemplateWritableTypes(t *testing.T) {
	zone, _ := time.LoadLocation("Asia/Shanghai")
	for _, test := range []struct {
		typ    KeyType
		output string
	}{
		{KeyTypeBlock, "bound text"}, {KeyTypeText, "text"}, {KeyTypeURL, "https://example.com"},
		{KeyTypeEmail, "a@example.com"}, {KeyTypePhone, "+12345"}, {KeyTypeNumber, "12.5"},
		{KeyTypeCheckbox, "false"}, {KeyTypeDate, "2026-10-16"}, {KeyTypeSelect, "A,B"},
		{KeyTypeMSelect, `["A,B","C"]`}, {KeyTypeRelation, `["20261016000000-abcdefg"]`},
		{KeyTypeMAsset, `[{"type":"file","name":"a","content":"assets/a.pdf"}]`},
		{KeyTypeLocation, `{"name":"zero","latitude":0,"longitude":0}`},
	} {
		t.Run(string(test.typ), func(t *testing.T) {
			key := &Key{Type: test.typ, Options: []*SelectOption{{Name: "A,B", Color: "2"}, {Name: "C", Color: "3"}}}
			value, err := ParseAutomationTemplateValue(key, test.output, zone)
			if err != nil || value == nil || value.Type != test.typ {
				t.Fatalf("conversion failed: %v %+v", err, value)
			}
			if _, err = ParseAutomationTemplateValue(key, "", zone); err != nil {
				t.Fatal("clear failed", err)
			}
		})
	}
	for _, test := range []struct {
		typ    KeyType
		output string
	}{
		{KeyTypeNumber, "nan"}, {KeyTypeNumber, "Inf"}, {KeyTypeNumber, "wrong"}, {KeyTypeCheckbox, "1"},
		{KeyTypeDate, "2026-02-30"}, {KeyTypeDate, `{"content":0,"isNotEmpty":true,"hasEndDate":true}`},
		{KeyTypeSelect, "new"}, {KeyTypeMSelect, "A,B"}, {KeyTypeMSelect, `[null]`},
		{KeyTypeRelation, "id"}, {KeyTypeMAsset, `["asset"]`}, {KeyTypeLocation, `{"latitude":91,"longitude":0}`},
		{KeyTypeLocation, `{"lat":0,"lng":0}`}, {KeyTypeTemplate, "anything"},
	} {
		if _, err := ParseAutomationTemplateValue(&Key{Type: test.typ}, test.output, zone); err == nil {
			t.Fatalf("accepted invalid %s: %s", test.typ, test.output)
		}
	}
}

func TestAutomationTemplateSourceAndTime(t *testing.T) {
	zone, _ := time.LoadLocation("America/New_York")
	start := time.Date(2026, 3, 7, 12, 0, 0, 0, zone)
	dateID := "20261016000000-abcdefg"
	source := &AttributeView{KeyValues: []*KeyValues{{Key: &Key{ID: dateID, Type: KeyTypeDate}, Values: []*Value{{Type: KeyTypeDate, BlockID: "row", Date: &ValueDate{
		Content: start.UnixMilli(), IsNotEmpty: true, HasEndDate: true, Content2: start.Add(time.Hour).UnixMilli(), IsNotEmpty2: true,
	}}}}}}
	context := AutomationTemplateContext{Source: source, ItemID: "row", Time: start, TimeZone: zone.String()}
	key := &Key{Type: KeyTypeDate}
	value, err := EvaluateAutomationTemplate(context, key, `.action{((now).AddDate 0 0 1).Format "2006-01-02T15:04:05Z07:00"}`)
	if err != nil || value.Date.Content-start.UnixMilli() != int64(23*time.Hour/time.Millisecond) {
		t.Fatal("DST offset ignored", value, err)
	}
	value, err = EvaluateAutomationTemplate(context, key, fmt.Sprintf(`.action{toJson (dateAdd 0 0 1 (value %q))}`, dateID))
	if err != nil || value.Date.Content2-value.Date.Content != int64(time.Hour/time.Millisecond) || !value.Date.HasEndDate {
		t.Fatal("range lost", value, err)
	}
	for _, test := range []struct {
		at   time.Time
		days int
		want string
	}{
		{time.Date(2024, 2, 28, 0, 0, 0, 0, zone), 1, "2024-02-29"},
		{time.Date(2026, 12, 31, 0, 0, 0, 0, zone), 1, "2027-01-01"},
		{time.Date(2026, 1, 31, 0, 0, 0, 0, zone), 7, "2026-02-07"},
	} {
		context.Time = test.at
		value, err = EvaluateAutomationTemplate(context, key, fmt.Sprintf(`.action{((now).AddDate 0 0 %d).Format "2006-01-02"}`, test.days))
		if err != nil || !value.Date.IsNotTime || time.UnixMilli(value.Date.Content).In(zone).Format("2006-01-02") != test.want {
			t.Fatal("natural date failed", value, err)
		}
	}
	for _, template := range []string{`.action{field "missing"}`, `.action{.Missing}`, `.action{field "20261016000000-abcdefg"}`} {
		context.ItemID = "empty"
		if _, err = EvaluateAutomationTemplate(context, key, template); err == nil {
			t.Fatal("missing value became empty", template)
		}
	}
	remapped := RemapAutomationTemplate(fmt.Sprintf(`.action{field %q}`, dateID), map[string]string{dateID: "20261016000001-abcdefg"})
	if !strings.Contains(remapped, "20261016000001-abcdefg") {
		t.Fatal("copied field ID was lost")
	}
	literal := `plain field "20261016000000-abcdefg" .action{field "20261016000000-abcdefg"}`
	remapped = RemapAutomationTemplate(literal, map[string]string{dateID: "20261016000001-abcdefg"})
	if !strings.HasPrefix(remapped, `plain field "20261016000000-abcdefg"`) || !strings.HasSuffix(remapped, `"20261016000001-abcdefg"}`) {
		t.Fatal("copy changed literal text or missed a reference", remapped)
	}
}

func TestAutomationTemplateSandbox(t *testing.T) {
	for _, source := range []string{
		`.action{env "HOME"}`, `.action{sql "select 1"}`, `.action{readFile "x"}`, `.action{getHostByName "example.com"}`,
		`.action{range .}x.action{end}`, `.action{define "a"}x.action{end}`, `.action{template "automation" .}`,
		`.action{printf "%1000000000s" "x"}`, `.action{repeat 1000000000 "x"}`, `.action{field .ItemID}`,
		`.action{(now).Local}`, `.action{$t := now}.action{$t.Local}`,
		strings.Repeat("x", 8193), strings.Repeat(".action{now}", 180),
	} {
		if err := ValidateAutomationTemplate(source, "UTC"); err == nil {
			t.Fatal("accepted unsafe template", source[:min(len(source), 80)])
		}
	}
	if err := ValidateAutomationTemplate("ok", "Local"); err == nil {
		t.Fatal("host timezone accepted")
	}
	output := &automationTemplateOutput{}
	if _, err := output.Write(make([]byte, AutomationTemplateLimit+1)); err == nil {
		t.Fatal("output limit ignored")
	}
}
