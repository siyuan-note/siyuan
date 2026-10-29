// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"reflect"
	"testing"
)

func TestAINormalizeUserSkills(t *testing.T) {
	ai := &AI{Agent: &Agent{
		Skills: &AgentSkills{UserEnabled: []string{
			" Review ", "review", "", ".", "..", "nested/skill", `nested\skill`, "Write",
		}},
	}}
	ai.Normalize()

	want := []string{"Review", "Write"}
	if got := ai.Agent.Skills.UserEnabled; !reflect.DeepEqual(got, want) {
		t.Fatalf("user skills = %#v, want %#v", got, want)
	}
}

func TestAINormalizeInitializesUserSkills(t *testing.T) {
	ai := &AI{Agent: &Agent{}}
	ai.Normalize()
	if ai.Agent.Skills == nil || ai.Agent.Skills.UserEnabled == nil || ai.Agent.Skills.BuiltinDisabled == nil {
		t.Fatalf("user skills were not initialized: %#v", ai.Agent.Skills)
	}
}

func TestAINormalizeBuiltinSkills(t *testing.T) {
	ai := &AI{Agent: &Agent{Skills: &AgentSkills{
		UserEnabled:     []string{"siyuan-plugin-development"},
		BuiltinDisabled: []string{" builtin:siyuan-plugin-development ", "builtin:siyuan-plugin-development", "", "builtin:future/version"},
	}}}
	ai.Normalize()
	if !reflect.DeepEqual(ai.Agent.Skills.BuiltinDisabled, []string{"builtin:siyuan-plugin-development", "builtin:future/version"}) {
		t.Fatalf("disabled IDs not preserved: %#v", ai.Agent.Skills.BuiltinDisabled)
	}
	if !reflect.DeepEqual(ai.Agent.Skills.UserEnabled, []string{"siyuan-plugin-development"}) {
		t.Fatalf("builtin normalization changed user selection")
	}
	for _, ai := range []*AI{{}, {Agent: &Agent{}}, {Agent: &Agent{Skills: &AgentSkills{UserEnabled: []string{"existing"}}}}} {
		ai.Normalize()
		if ai.Agent.Skills.BuiltinDisabled == nil || len(ai.Agent.Skills.BuiltinDisabled) != 0 {
			t.Fatalf("old configuration did not enable builtins by default: %#v", ai.Agent.Skills)
		}
	}
}
