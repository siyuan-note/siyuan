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

package multimodal

import (
	"context"
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

const (
	CapabilityImageInput  = "image-input"
	CapabilityImageOutput = "image-output"
)

type ArtifactRef struct {
	Kind       string `json:"kind"`
	Path       string `json:"path"`
	MIMEType   string `json:"mimeType,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
}

type PreparedImage struct {
	Data       []byte
	MIMEType   string
	Width      int
	Height     int
	SourceSize int
}

type GenerateRequest struct {
	Prompt       string
	Size         string
	Quality      string
	OutputFormat string
}

type GeneratedImage struct {
	Data          []byte
	MIMEType      string
	Extension     string
	RevisedPrompt string
}

type VisionAdapter interface {
	Analyze(ctx context.Context, image PreparedImage, question, detail string) (string, error)
}

type ImageGenerationAdapter interface {
	Generate(ctx context.Context, request GenerateRequest) (GeneratedImage, error)
}

func HasCapability(model *conf.Model, capability string) bool {
	if model == nil || len(model.Capabilities) == 0 {
		// 旧配置没有能力声明，保持兼容；新配置可通过能力标记收紧选择范围。
		return true
	}
	for _, current := range model.Capabilities {
		if current == capability {
			return true
		}
	}
	return false
}

func ValidateModel(provider *conf.Provider, model *conf.Model, capability string) error {
	if provider == nil || model == nil {
		return fmt.Errorf("model for capability %s is not configured", capability)
	}
	if provider.Protocol != "" && provider.Protocol != "openai" {
		return fmt.Errorf("unsupported multimodal provider protocol: %s", provider.Protocol)
	}
	if !HasCapability(model, capability) {
		return fmt.Errorf("model %s does not declare capability %s", model.Name, capability)
	}
	return nil
}
