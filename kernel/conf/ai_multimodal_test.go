// SiYuan - Refactor your thinking
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

package conf

import "testing"

func TestNormalizeMultimodalDefaults(t *testing.T) {
	ai := &AI{Providers: []*Provider{{Enabled: true, Models: []*Model{{Enabled: true, Name: " vision "}}}}}
	ai.Normalize()
	if ai.Vision == nil || ai.Vision.RequestTimeout != 300 || ai.Vision.MaxImageBytes != 20*1024*1024 || ai.Vision.MaxEdge != 2048 {
		t.Fatalf("unexpected vision defaults: %#v", ai.Vision)
	}
	if ai.ImageGeneration == nil || ai.ImageGeneration.RequestTimeout != 300 || ai.ImageGeneration.Size != "1024x1024" || ai.ImageGeneration.OutputFormat != "png" {
		t.Fatalf("unexpected image generation defaults: %#v", ai.ImageGeneration)
	}
	provider := ai.Providers[0]
	if provider.Protocol != "openai" {
		t.Fatalf("unexpected provider protocol: %q", provider.Protocol)
	}
	if provider.Models[0].Name != "vision" {
		t.Fatalf("unexpected normalized model name: %q", provider.Models[0].Name)
	}
}

func TestNormalizeMultimodalTimeouts(t *testing.T) {
	ai := &AI{
		Vision:          &Vision{RequestTimeout: 601},
		ImageGeneration: &ImageGeneration{RequestTimeout: 30},
	}
	ai.Normalize()
	if ai.Vision.RequestTimeout != 600 || ai.ImageGeneration.RequestTimeout != 30 {
		t.Fatalf("unexpected multimodal timeouts: vision=%d generation=%d", ai.Vision.RequestTimeout, ai.ImageGeneration.RequestTimeout)
	}
}
