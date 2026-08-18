// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

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
	if ai.Agent.Skills == nil || ai.Agent.Skills.UserEnabled == nil {
		t.Fatalf("user skills were not initialized: %#v", ai.Agent.Skills)
	}
}
