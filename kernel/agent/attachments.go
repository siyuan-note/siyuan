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

package agent

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/sashabaranov/go-openai"
	mcptools "github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func agentAttachmentsFromTool(attachments []mcptools.ModelAttachment) []AgentAttachment {
	ret := make([]AgentAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.Type != "image" || len(attachment.Data) == 0 {
			continue
		}
		ret = append(ret, AgentAttachment{
			Type:       attachment.Type,
			Data:       append([]byte(nil), attachment.Data...),
			MIMEType:   attachment.MIMEType,
			Path:       attachment.Path,
			DocumentID: attachment.DocumentID,
			Prompt:     attachment.Prompt,
			Detail:     attachment.Detail,
			Width:      attachment.Width,
			Height:     attachment.Height,
		})
	}
	return ret
}

func buildAttachmentMessage(attachments []AgentAttachment) (openai.ChatCompletionMessage, bool) {
	parts := make([]openai.ChatMessagePart, 0, len(attachments)*2)
	hasImage := false
	for _, attachment := range attachments {
		if attachment.Type != "image" {
			continue
		}
		data, mimeType, width, height, err := resolveAgentAttachment(attachment)
		if err != nil {
			parts = append(parts, openai.ChatMessagePart{
				Type: openai.ChatMessagePartTypeText,
				Text: fmt.Sprintf("The previously attached image [%s] is unavailable: %s", attachment.Path, err),
			})
			continue
		}
		prompt := strings.TrimSpace(attachment.Prompt)
		if prompt == "" {
			prompt = "Analyze this image in the context of the user's current request."
		}
		parts = append(parts, openai.ChatMessagePart{
			Type: openai.ChatMessagePartTypeText,
			Text: fmt.Sprintf(
				"SiYuan attached a local image referenced by document [%s]. Asset path: [%s]. Size: %dx%d. Task: %s",
				attachment.DocumentID, attachment.Path, width, height, prompt,
			),
		})
		detail := openai.ImageURLDetail(attachment.Detail)
		if detail != openai.ImageURLDetailLow && detail != openai.ImageURLDetailHigh {
			detail = openai.ImageURLDetailAuto
		}
		parts = append(parts, openai.ChatMessagePart{
			Type: openai.ChatMessagePartTypeImageURL,
			ImageURL: &openai.ChatMessageImageURL{
				URL:    "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data),
				Detail: detail,
			},
		})
		hasImage = true
	}
	if len(parts) == 0 {
		return openai.ChatCompletionMessage{}, false
	}
	if !hasImage {
		var texts []string
		for _, part := range parts {
			if part.Type == openai.ChatMessagePartTypeText {
				texts = append(texts, part.Text)
			}
		}
		return openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleUser,
			Content: strings.Join(texts, "\n"),
		}, true
	}
	return openai.ChatCompletionMessage{
		Role:         openai.ChatMessageRoleUser,
		MultiContent: parts,
	}, true
}

func resolveAgentAttachment(attachment AgentAttachment) (data []byte, mimeType string, width, height int, err error) {
	if len(attachment.Data) > 0 {
		if attachment.MIMEType == "" {
			err = fmt.Errorf("image MIME type is missing")
			return
		}
		data = attachment.Data
		mimeType = attachment.MIMEType
		width = attachment.Width
		height = attachment.Height
		return
	}
	prepared, prepareErr := kernelModel.PrepareDocumentImage(attachment.DocumentID, attachment.Path)
	if prepareErr != nil {
		err = prepareErr
		return
	}
	data = prepared.Data
	mimeType = prepared.MIMEType
	width = prepared.Prepared.Width
	height = prepared.Prepared.Height
	return
}

func chatMessageText(message openai.ChatCompletionMessage) string {
	if message.Content != "" {
		return message.Content
	}
	var texts []string
	for _, part := range message.MultiContent {
		if part.Type == openai.ChatMessagePartTypeText && part.Text != "" {
			texts = append(texts, part.Text)
		}
	}
	return strings.Join(texts, "\n")
}

func isAttachmentMessage(message openai.ChatCompletionMessage) bool {
	if message.Role != openai.ChatMessageRoleUser {
		return false
	}
	for _, part := range message.MultiContent {
		if part.Type == openai.ChatMessagePartTypeImageURL {
			return true
		}
	}
	return false
}
