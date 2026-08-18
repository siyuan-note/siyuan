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

func TestMCPExposurePolicyNormalizeAndAllows(t *testing.T) {
	ai := NewAI()
	ai.MCP.ExposurePolicy = &CapabilityPolicy{
		Default: "invalid",
		Overrides: map[string]string{
			"native/backend/read": "deny",
			"native/backend/bad":  "invalid",
		},
	}
	ai.Normalize()

	policy := ai.MCP.ExposurePolicy
	if policy.Default != "allow" {
		t.Fatalf("invalid MCP exposure default was not normalized: %s", policy.Default)
	}
	if policy.Allows("native/backend/read") {
		t.Fatal("MCP exposure deny override was ignored")
	}
	if !policy.Allows("native/backend/write") {
		t.Fatal("MCP exposure default allow was ignored")
	}
	if _, exists := policy.Overrides["native/backend/bad"]; exists {
		t.Fatal("invalid MCP exposure override was not removed")
	}
}

func TestApprovalPolicyDefaultNormalization(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected string
	}{
		{name: "legacy confirm", value: ApprovalDecisionConfirm, expected: ApprovalDecisionRisk},
		{name: "invalid", value: "invalid", expected: ApprovalDecisionRisk},
		{name: "risk", value: ApprovalDecisionRisk, expected: ApprovalDecisionRisk},
		{name: "allow", value: ApprovalDecisionAllow, expected: ApprovalDecisionAllow},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ai := NewAI()
			ai.Agent.ApprovalPolicy = &ApprovalPolicy{Default: test.value}
			ai.Normalize()
			if actual := ai.Agent.ApprovalPolicy.Default; actual != test.expected {
				t.Fatalf("unexpected normalized approval default: got %s, want %s", actual, test.expected)
			}
		})
	}
}

func TestApprovalPolicyNormalizeAndDecision(t *testing.T) {
	ai := NewAI()
	ai.Agent.ApprovalPolicy = &ApprovalPolicy{
		Default: ApprovalDecisionRisk,
		Overrides: map[string]*CapabilityApproval{
			"native/backend/block": {
				Default: ApprovalDecisionAllow,
				Actions: map[string]string{
					"get":    ApprovalDecisionRisk,
					"remove": ApprovalDecisionConfirm,
					"bad":    "invalid",
				},
			},
			"native/backend/empty":   {},
			"native/backend/invalid": {Default: "invalid"},
			"":                       {Default: ApprovalDecisionAllow},
		},
	}
	ai.Normalize()

	policy := ai.Agent.ApprovalPolicy
	if policy.Default != ApprovalDecisionRisk {
		t.Fatalf("approval default was not preserved: %s", policy.Default)
	}
	if policy.Decision("native/backend/block", "get") != ApprovalDecisionRisk {
		t.Fatal("action risk decision was ignored")
	}
	if policy.Decision("native/backend/block", "remove") != ApprovalDecisionConfirm {
		t.Fatal("action confirmation decision was ignored")
	}
	if policy.Decision("native/backend/block", "update") != ApprovalDecisionAllow {
		t.Fatal("capability approval decision was ignored")
	}
	if policy.Decision("native/backend/other", "get") != ApprovalDecisionRisk {
		t.Fatal("policy risk decision was ignored")
	}
	if _, exists := policy.Overrides["native/backend/empty"]; exists {
		t.Fatal("empty approval override was not removed")
	}
	if _, exists := policy.Overrides["native/backend/invalid"]; exists {
		t.Fatal("invalid approval override was not removed")
	}
	if _, exists := policy.Overrides[""]; exists {
		t.Fatal("empty approval capability ID was not removed")
	}
	if _, exists := policy.Overrides["native/backend/block"].Actions["bad"]; exists {
		t.Fatal("invalid action approval was not removed")
	}
}
