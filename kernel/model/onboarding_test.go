// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestPrepareOnboardingForEmptyWorkspace(t *testing.T) {
	tests := []struct {
		name       string
		onboarding *conf.Onboarding
		readOnly   bool
		notebooks  int
		wantChange bool
		want       *conf.Onboarding
	}{
		{
			name: "empty workspace resets onboarding",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				Dismissed:  true,
				NotebookID: "removed-notebook",
				DocumentID: "removed-document",
			},
			wantChange: true,
			want:       &conf.Onboarding{State: conf.OnboardingPending, NewUser: true},
		},
		{
			name:       "read-only workspace remains unchanged",
			onboarding: &conf.Onboarding{State: conf.OnboardingCompleted, Dismissed: true},
			readOnly:   true,
			want:       &conf.Onboarding{State: conf.OnboardingCompleted, Dismissed: true},
		},
		{
			name:       "workspace with notebook remains unchanged",
			onboarding: &conf.Onboarding{State: conf.OnboardingCompleted, Dismissed: true},
			notebooks:  1,
			want:       &conf.Onboarding{State: conf.OnboardingCompleted, Dismissed: true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := prepareOnboardingForEmptyWorkspace(test.onboarding, test.readOnly, test.notebooks); got != test.wantChange {
				t.Fatalf("prepareOnboardingForEmptyWorkspace() = %v, want %v", got, test.wantChange)
			}
			if *test.onboarding != *test.want {
				t.Fatalf("onboarding = %+v, want %+v", test.onboarding, test.want)
			}
		})
	}
}

func TestReconcileOnboarding(t *testing.T) {
	tests := []struct {
		name           string
		onboarding     *conf.Onboarding
		boxes          []*Box
		documentExists bool
		wantChange     bool
		want           *conf.Onboarding
	}{
		{
			name: "completed onboarding remains unchanged when its data exists",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				NotebookID: "notebook",
				DocumentID: "document",
			},
			boxes:          []*Box{{ID: "notebook"}},
			documentExists: true,
			want: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				NotebookID: "notebook",
				DocumentID: "document",
			},
		},
		{
			name: "missing onboarding document is recreated",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				NotebookID: "notebook",
				DocumentID: "removed-document",
			},
			boxes:      []*Box{{ID: "notebook"}},
			wantChange: true,
			want: &conf.Onboarding{
				State:      conf.OnboardingNotebookCreated,
				NewUser:    true,
				NotebookID: "notebook",
			},
		},
		{
			name: "dismissed onboarding remains unchanged",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				Dismissed:  true,
				NotebookID: "removed-notebook",
				DocumentID: "removed-document",
			},
			want: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				Dismissed:  true,
				NotebookID: "removed-notebook",
				DocumentID: "removed-document",
			},
		},
		{
			name: "missing onboarding notebook does not replace existing data",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				NotebookID: "removed-notebook",
				DocumentID: "removed-document",
			},
			boxes:      []*Box{{ID: "existing-notebook"}},
			wantChange: true,
			want:       &conf.Onboarding{State: conf.OnboardingCompleted},
		},
		{
			name: "missing onboarding notebook resets undismissed empty workspace",
			onboarding: &conf.Onboarding{
				State:      conf.OnboardingCompleted,
				NewUser:    true,
				NotebookID: "removed-notebook",
				DocumentID: "removed-document",
			},
			wantChange: true,
			want:       &conf.Onboarding{State: conf.OnboardingPending, NewUser: true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := reconcileOnboarding(test.onboarding, test.boxes, test.documentExists); got != test.wantChange {
				t.Fatalf("reconcileOnboarding() = %v, want %v", got, test.wantChange)
			}
			if *test.onboarding != *test.want {
				t.Fatalf("onboarding = %+v, want %+v", test.onboarding, test.want)
			}
		})
	}
}
