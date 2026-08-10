// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package conf

import "testing"

func TestCapabilityPolicyNormalizeAndAllows(t *testing.T) {
	ai := NewAI()
	ai.Agent.CapabilityPolicy = &CapabilityPolicy{
		Default: "invalid",
		Overrides: map[string]string{
			"native/backend/read":  "deny",
			"native/backend/write": "allow",
			"native/backend/bad":   "invalid",
			"":                     "deny",
		},
	}
	ai.Normalize()

	policy := ai.Agent.CapabilityPolicy
	if policy.Default != "allow" {
		t.Fatalf("invalid default was not normalized: %s", policy.Default)
	}
	if policy.Allows("native/backend/read") {
		t.Fatal("deny override was ignored")
	}
	if !policy.Allows("native/backend/write") || !policy.Allows("native/backend/other") {
		t.Fatal("allow decisions were ignored")
	}
	if _, exists := policy.Overrides["native/backend/bad"]; exists {
		t.Fatal("invalid override was not removed")
	}
	if _, exists := policy.Overrides[""]; exists {
		t.Fatal("empty capability ID was not removed")
	}
}

func TestApprovalPolicyNormalizeAndAutoApproves(t *testing.T) {
	ai := NewAI()
	ai.Agent.ApprovalPolicy = &ApprovalPolicy{
		Default: "invalid",
		Overrides: map[string]*CapabilityApproval{
			"native/backend/block": {
				Default: "allow",
				Actions: map[string]string{"remove": "confirm", "bad": "invalid"},
			},
			"native/backend/empty": {},
			"":                     {Default: "allow"},
		},
	}
	ai.Normalize()

	policy := ai.Agent.ApprovalPolicy
	if policy.Default != "confirm" {
		t.Fatalf("invalid approval default was not normalized: %s", policy.Default)
	}
	if !policy.AutoApproves("native/backend/block", "get") {
		t.Fatal("capability auto approval was ignored")
	}
	if policy.AutoApproves("native/backend/block", "remove") {
		t.Fatal("action confirmation override was ignored")
	}
	if _, exists := policy.Overrides["native/backend/empty"]; exists {
		t.Fatal("empty approval override was not removed")
	}
	if _, exists := policy.Overrides[""]; exists {
		t.Fatal("empty approval capability ID was not removed")
	}
	if _, exists := policy.Overrides["native/backend/block"].Actions["bad"]; exists {
		t.Fatal("invalid action approval was not removed")
	}
}
