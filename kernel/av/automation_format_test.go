// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"strings"
	"testing"
	"time"
)

func TestAutomationFormattingFunctions(t *testing.T) {
	context := AutomationTemplateContext{TimeZone: "UTC", Time: time.Now()}
	key := &Key{Type: KeyTypeText}
	for source, want := range map[string]string{
		`.action{printf "https://example.com?q=%s&n=%d" (urlquery "A B&x") 2}`:                 "https://example.com?q=A+B%26x&n=2",
		`.action{printf "%06d %.2f %%" 12 1.234}`:                                              "000012 1.23 %",
		`.action{toJson (dict "headers" (dict "Authorization" (printf "Bearer %s" "token")))}`: `{"headers":{"Authorization":"Bearer token"}}`,
		`.action{toString 12.5}`:                     "12.5",
		`.action{(fromJson "{\"value\":12}").value}`: "12",
	} {
		value, err := EvaluateAutomationTemplate(context, key, source)
		if err != nil || value.Text.Content != want {
			t.Fatalf("%s: %+v %v", source, value, err)
		}
	}
	for _, source := range []string{`.action{printf "%1000000000s" "x"}`, `.action{printf "%.*f" 2 1.2}`,
		`.action{printf "%[1]s" "x"}`, `.action{dict "odd"}`, `.action{dict 1 "value"}`,
		`.action{printf "%65536v" (dict "x" "y")}`,
		`.action{printf "%65536s%s" "x" "y"}`} {
		if _, err := EvaluateAutomationTemplate(context, key, source); err == nil {
			t.Fatal("unbounded or malformed formatting accepted", source)
		}
	}
	if _, err := automationToString(strings.Repeat("x", AutomationTemplateLimit+1)); err == nil {
		t.Fatal("input budget bypassed")
	}
	if _, err := automationURLQuery(strings.Repeat("&", AutomationTemplateLimit/2)); err == nil {
		t.Fatal("encoded output budget bypassed")
	}
}

func TestAutomationTemplateFeatureVersions(t *testing.T) {
	for _, trigger := range []string{"manual", "added", "changed"} {
		for _, source := range []string{`.action{printf "%s" "x"}`, `.action{urlquery "a b"}`, `.action{dict "k" "v"}`, `.action{toString 1}`} {
			rule := &AutomationRule{Enabled: true, Trigger: trigger, Actions: []*AutomationAction{{Fields: map[string]*AutomationValue{"field": {Mode: "template", Template: source}}}}}
			if rule.RequiredSpec() != 10 {
				t.Fatal("formatting did not require format 10", trigger, source)
			}
		}
		rule := &AutomationRule{Enabled: true, Trigger: trigger, Actions: []*AutomationAction{{Fields: map[string]*AutomationValue{"field": {Mode: "template", Template: `.action{(httpGet "https://example.com").body}`}}}}}
		want := 10
		if trigger == "manual" {
			want = 9
		}
		if rule.RequiredSpec() != want || !rule.UsesHTTP() {
			t.Fatal("network trigger version", trigger, rule.RequiredSpec())
		}
		rule.Actions[0].Fields["field"].Template = `httpGet printf .action{"dict toString urlquery"}`
		if rule.UsesHTTP() || rule.RequiredSpec() == 10 {
			t.Fatal("literal text changed capabilities")
		}
	}
}
