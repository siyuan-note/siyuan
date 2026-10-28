// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "testing"

func TestNormalizeImageGenerationDefaults(t *testing.T) {
	ai := &AI{Providers: []*Provider{{Enabled: true, Models: []*Model{{Enabled: true, Name: " image "}}}}}
	ai.Normalize()
	if ai.ImageGeneration == nil || ai.ImageGeneration.RequestTimeout != 300 || ai.ImageGeneration.Size != "1024x1024" || ai.ImageGeneration.OutputFormat != "png" {
		t.Fatalf("unexpected image generation defaults: %#v", ai.ImageGeneration)
	}
	provider := ai.Providers[0]
	if provider.Protocol != "openai" {
		t.Fatalf("unexpected provider protocol: %q", provider.Protocol)
	}
	if provider.Models[0].Name != "image" {
		t.Fatalf("unexpected normalized model name: %q", provider.Models[0].Name)
	}
}

func TestNormalizeImageGenerationTimeout(t *testing.T) {
	ai := &AI{
		ImageGeneration: &ImageGeneration{RequestTimeout: 30},
	}
	ai.Normalize()
	if ai.ImageGeneration.RequestTimeout != 30 {
		t.Fatalf("unexpected image generation timeout: %d", ai.ImageGeneration.RequestTimeout)
	}
}
