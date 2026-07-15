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

func TestNormalizeMultimodalDefaultsAndCapabilities(t *testing.T) {
	ai := &AI{Providers: []*Provider{{Enabled: true, Models: []*Model{{Enabled: true, Name: " vision ", Capabilities: []string{" Image-Input ", "image-input", " image-output "}}}}}}
	ai.Normalize()
	if ai.Vision == nil || ai.Vision.MaxImageBytes != 20*1024*1024 || ai.Vision.MaxEdge != 2048 {
		t.Fatalf("unexpected vision defaults: %#v", ai.Vision)
	}
	if ai.ImageGeneration == nil || ai.ImageGeneration.Size != "1024x1024" || ai.ImageGeneration.OutputFormat != "png" {
		t.Fatalf("unexpected image generation defaults: %#v", ai.ImageGeneration)
	}
	provider := ai.Providers[0]
	if provider.Protocol != "openai" {
		t.Fatalf("unexpected provider protocol: %q", provider.Protocol)
	}
	capabilities := provider.Models[0].Capabilities
	if len(capabilities) != 2 || capabilities[0] != "image-input" || capabilities[1] != "image-output" {
		t.Fatalf("unexpected normalized capabilities: %#v", capabilities)
	}
}
