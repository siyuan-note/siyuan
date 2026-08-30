// SiYuan - From thought to insight, with agents
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
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"text/template"
	templateparse "text/template/parse"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func renderTemplateDocTreeNodes(collector *templateDocTreeCollector, rootTemplate *template.Template,
	funcs template.FuncMap) error {
	for _, node := range flattenTemplateDocTreeNodes0(collector.nodes) {
		content, err := renderTemplateDocTreeNodeContent(collector, rootTemplate, funcs, node)
		if nil != err {
			return err
		}
		collector.totalOutput += len(content)
		if maxTemplateDocTreeOutputSize < collector.totalOutput {
			return fmt.Errorf("template document tree output exceeds %d bytes", maxTemplateDocTreeOutputSize)
		}
		tree, err := renderTemplateDocTreeMarkdown(content, collector.boxID)
		if nil != err {
			return err
		}
		collector.buildTree(node, tree)
	}
	return nil
}

func renderTemplateDocTreeNodeContent(collector *templateDocTreeCollector, rootTemplate *template.Template,
	funcs template.FuncMap, node *TemplateDocTreeNode) ([]byte, error) {
	if "" == node.Template && "" == node.Define {
		return nil, nil
	}

	previousAllowCreation := collector.allowCreation
	collector.allowCreation = false
	defer func() {
		collector.allowCreation = previousAllowCreation
	}()

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	dataModel := templateDocTreeDataModel(node)
	if "" != node.Define {
		if nil == rootTemplate.Lookup(node.Define) {
			return nil, fmt.Errorf("child template definition [%s] not found", node.Define)
		}
		if err := validateTemplateCallGraph(rootTemplate, node.Define); nil != err {
			return nil, err
		}
		if err := rootTemplate.ExecuteTemplate(buf, node.Define, dataModel); nil != err {
			return nil, fmt.Errorf(Conf.Language(44), err.Error())
		}
		return buf.Bytes(), nil
	}

	childPath, err := resolveTemplatePackageFile(collector.templatePath, node.Template)
	if nil != err {
		return nil, err
	}
	content, err := os.ReadFile(childPath)
	if nil != err {
		return nil, err
	}
	childTemplate := template.New("").Delims(".action{", "}").Funcs(funcs)
	childTemplate, err = childTemplate.Parse(string(content))
	if nil != err {
		return nil, fmt.Errorf(Conf.Language(44), err.Error())
	}
	if err = validateTemplateCallGraph(childTemplate, childTemplate.Name()); nil != err {
		return nil, err
	}
	if err = childTemplate.Execute(buf, dataModel); nil != err {
		return nil, fmt.Errorf(Conf.Language(44), err.Error())
	}
	return buf.Bytes(), nil
}

func validateTemplateCallGraph(root *template.Template, start string) error {
	visiting := map[string]bool{}
	depths := map[string]int{}
	var visit func(string) (int, error)
	visit = func(name string) (int, error) {
		if visiting[name] {
			return 0, fmt.Errorf("recursive template call [%s] is not supported", name)
		}
		if depth, ok := depths[name]; ok {
			return depth, nil
		}
		tmpl := root.Lookup(name)
		if nil == tmpl || nil == tmpl.Tree || nil == tmpl.Tree.Root {
			return 0, fmt.Errorf("template definition [%s] not found", name)
		}
		visiting[name] = true
		depth := 1
		for _, called := range collectCalledTemplateNames(tmpl.Tree.Root) {
			calledDepth, err := visit(called)
			if nil != err {
				return 0, err
			}
			if depth < calledDepth+1 {
				depth = calledDepth + 1
			}
		}
		delete(visiting, name)
		depths[name] = depth
		return depth, nil
	}
	depth, err := visit(start)
	if nil != err {
		return err
	}
	if maxTemplateCallDepth < depth {
		return fmt.Errorf("template call depth exceeds %d", maxTemplateCallDepth)
	}
	return nil
}

func collectCalledTemplateNames(node templateparse.Node) (ret []string) {
	if nil == node {
		return nil
	}
	switch typed := node.(type) {
	case *templateparse.ListNode:
		if nil == typed {
			return nil
		}
		for _, child := range typed.Nodes {
			ret = append(ret, collectCalledTemplateNames(child)...)
		}
	case *templateparse.TemplateNode:
		if nil == typed {
			return nil
		}
		ret = append(ret, typed.Name)
	case *templateparse.IfNode:
		if nil == typed {
			return nil
		}
		ret = append(ret, collectCalledTemplateNames(typed.List)...)
		ret = append(ret, collectCalledTemplateNames(typed.ElseList)...)
	case *templateparse.RangeNode:
		if nil == typed {
			return nil
		}
		ret = append(ret, collectCalledTemplateNames(typed.List)...)
		ret = append(ret, collectCalledTemplateNames(typed.ElseList)...)
	case *templateparse.WithNode:
		if nil == typed {
			return nil
		}
		ret = append(ret, collectCalledTemplateNames(typed.List)...)
		ret = append(ret, collectCalledTemplateNames(typed.ElseList)...)
	}
	return ret
}

func templateUsesFunction(root *template.Template, name string) bool {
	for _, tmpl := range root.Templates() {
		if nil != tmpl && nil != tmpl.Tree && templateParseNodeUsesFunction(tmpl.Tree.Root, name) {
			return true
		}
	}
	return false
}

func templateParseNodeUsesFunction(node templateparse.Node, name string) bool {
	if nil == node {
		return false
	}
	switch typed := node.(type) {
	case *templateparse.ListNode:
		if nil == typed {
			return false
		}
		for _, child := range typed.Nodes {
			if templateParseNodeUsesFunction(child, name) {
				return true
			}
		}
	case *templateparse.ActionNode:
		return nil != typed && templateParseNodeUsesFunction(typed.Pipe, name)
	case *templateparse.PipeNode:
		if nil == typed {
			return false
		}
		for _, command := range typed.Cmds {
			if templateParseNodeUsesFunction(command, name) {
				return true
			}
		}
	case *templateparse.CommandNode:
		if nil == typed {
			return false
		}
		for _, argument := range typed.Args {
			if templateParseNodeUsesFunction(argument, name) {
				return true
			}
		}
	case *templateparse.IdentifierNode:
		return nil != typed && typed.Ident == name
	case *templateparse.IfNode:
		return nil != typed && (templateParseNodeUsesFunction(typed.Pipe, name) ||
			templateParseNodeUsesFunction(typed.List, name) || templateParseNodeUsesFunction(typed.ElseList, name))
	case *templateparse.RangeNode:
		return nil != typed && (templateParseNodeUsesFunction(typed.Pipe, name) ||
			templateParseNodeUsesFunction(typed.List, name) || templateParseNodeUsesFunction(typed.ElseList, name))
	case *templateparse.WithNode:
		return nil != typed && (templateParseNodeUsesFunction(typed.Pipe, name) ||
			templateParseNodeUsesFunction(typed.List, name) || templateParseNodeUsesFunction(typed.ElseList, name))
	case *templateparse.TemplateNode:
		return nil != typed && templateParseNodeUsesFunction(typed.Pipe, name)
	}
	return false
}

func templateTreeContainsAttributeView(tree *parse.Tree) bool {
	contains := false
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeAttributeView == node.Type {
			contains = true
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return contains
}

func renderTemplateDocTreeMarkdown(markdown []byte, boxID string) (*parse.Tree, error) {
	tree := parseKTree(markdown)
	if nil == tree {
		return nil, errors.New("parse child template tree failed")
	}
	tree.Box = boxID
	if templateTreeContainsAttributeView(tree) {
		return nil, errors.New("database blocks are not supported by createDocTree templates")
	}

	var nodesNeedAppendChild, unlinks []*ast.Node
	blockIDs := map[string]string{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != node.ID {
			oldID := node.ID
			node.ID = ast.NewNodeID()
			blockIDs[oldID] = node.ID
			node.SetIALAttr("id", node.ID)
			node.RemoveIALAttr(av.NodeAttrNameAvs)
			treenode.RefreshUpdated(node)
		}
		if (ast.NodeListItem == node.Type && (nil == node.FirstChild ||
			(3 == node.ListData.Typ && (nil == node.FirstChild.Next || ast.NodeKramdownBlockIAL == node.FirstChild.Next.Type)))) ||
			(ast.NodeBlockquote == node.Type && nil != node.FirstChild && nil != node.FirstChild.Next &&
				ast.NodeKramdownBlockIAL == node.FirstChild.Next.Type) ||
			(ast.NodeCallout == node.Type && nil != node.FirstChild && ast.NodeKramdownBlockIAL == node.FirstChild.Type) {
			nodesNeedAppendChild = append(nodesNeedAppendChild, node)
		}
		if node.IsTextMarkType("inline-math") && node.ParentIs(ast.NodeTableCell) {
			node.TextMarkInlineMathContent = strings.ReplaceAll(node.TextMarkInlineMathContent, "|", "&#124;")
		}
		return ast.WalkContinue
	})

	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.IsTextMarkType("block-ref") {
			defID := node.TextMarkBlockRefID
			if newDefID, internal := blockIDs[defID]; internal {
				node.TextMarkBlockRefID = newDefID
			} else if "" == node.Text() {
				refText := templateExternalRefText(defID, boxID)
				if "" != refText {
					treenode.SetDynamicBlockRefText(node, refText)
				} else {
					unlinks = append(unlinks, node)
				}
			}
		} else if ast.NodeBlockRef == node.Type {
			if refID := node.ChildByType(ast.NodeBlockRefID); nil != refID {
				defID := refID.TokensStr()
				if newDefID, internal := blockIDs[defID]; internal {
					refID.Tokens = []byte(newDefID)
				} else if "" == node.Text() {
					refText := templateExternalRefText(defID, boxID)
					if "" != refText {
						treenode.SetDynamicBlockRefText(node, refText)
					} else {
						unlinks = append(unlinks, node)
					}
				}
			}
		} else if treenode.IsBlockLink(node) {
			defID := strings.TrimPrefix(node.TextMarkAHref, "siyuan://blocks/")
			if newDefID, internal := blockIDs[defID]; internal {
				node.TextMarkAHref = "siyuan://blocks/" + newDefID
			}
		} else if ast.NodeBlockQueryEmbedScript == node.Type {
			for oldID, newID := range blockIDs {
				node.Tokens = bytes.ReplaceAll(node.Tokens, []byte(oldID), []byte(newID))
			}
		}
		return ast.WalkContinue
	})
	for _, node := range nodesNeedAppendChild {
		if ast.NodeBlockquote == node.Type {
			node.FirstChild.InsertAfter(treenode.NewParagraph(""))
		} else {
			node.AppendChild(treenode.NewParagraph(""))
		}
	}
	for _, node := range unlinks {
		node.Unlink()
	}

	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() {
			treenode.ClearLegacyHeadingFold(node)
		}
		return ast.WalkContinue
	})
	if icon := tree.Root.IALAttr("icon"); "" != icon {
		tree.Root.SetIALAttr("icon", util.UnescapeHTML(icon))
	}
	return tree, nil
}

func templateExternalRefText(defID, boxID string) string {
	if IsEncryptedBox(boxID) {
		return strings.TrimSpace(GetBlockRefTextInBox(defID, boxID))
	}
	return strings.TrimSpace(sql.GetRefText(defID))
}
