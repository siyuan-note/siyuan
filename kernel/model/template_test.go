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

package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestRenderTemplateMapsDocumentReferenceToTargetRoot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	const (
		templateRootID  = "20260901000000-root001"
		internalBlockID = "20260901000001-block01"
	)
	templatePath := writeTemplateDocTreeTestFile(t, fmt.Sprintf(`((%s "root"))
{: id="20260901000002-ref0001"}

Internal target
{: id="%s"}

((%s "internal"))
{: id="20260901000003-ref0002"}

((%s "external"))
{: id="20260901000004-ref0003"}

{: id="%s" title="Template" type="doc"}`, templateRootID, internalBlockID, internalBlockID, fixture.targetID, templateRootID))

	tree, _, _, err := RenderTemplateWithMode(templatePath, fixture.childID, TemplateRenderModePreview)
	if nil != err {
		t.Fatalf("render template failed: %v", err)
	}
	if fixture.sourceID != tree.Root.ID {
		t.Fatalf("template root was not mapped to target document: got %q, want %q", tree.Root.ID, fixture.sourceID)
	}

	refs := map[string]string{}
	var renderedInternalBlockID string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.IsTextMarkType("block-ref") {
			refs[node.TextMarkTextContent] = node.TextMarkBlockRefID
		} else if ast.NodeBlockRef == node.Type {
			if refID := node.ChildByType(ast.NodeBlockRefID); nil != refID {
				refs[strings.TrimSpace(node.Text())] = refID.TokensStr()
			}
		}
		if node.IsBlock() && "Internal target" == strings.TrimSpace(node.Text()) {
			renderedInternalBlockID = node.ID
		}
		return ast.WalkContinue
	})

	if fixture.sourceID != refs["root"] {
		t.Fatalf("document reference was not mapped to target root: got %q, want %q", refs["root"], fixture.sourceID)
	}
	if "" == renderedInternalBlockID || internalBlockID == renderedInternalBlockID {
		t.Fatalf("internal block ID was not regenerated: %q", renderedInternalBlockID)
	}
	if renderedInternalBlockID != refs["internal"] {
		t.Fatalf("internal reference was not mapped with its target: got %q, want %q", refs["internal"], renderedInternalBlockID)
	}
	if fixture.targetID != refs["external"] {
		t.Fatalf("external reference changed: got %q, want %q", refs["external"], fixture.targetID)
	}
}
