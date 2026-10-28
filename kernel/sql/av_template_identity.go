package sql

import (
	"maps"
	"sort"
	"strconv"
	"strings"
	"text/template"
	"text/template/parse"
)

// RemapTemplateFieldIDs 仅替换可静态识别的字段身份查找，不替换普通文字或变量声明。
// 使用独立解析树的字节位置编辑原文；无效模板及动态构造的字段身份保持原样。
func RemapTemplateFieldIDs(source string, ids map[string]string) string {
	if len(ids) == 0 || source == "" {
		return source
	}
	tpl, err := compileTemplateField(source)
	if err != nil || tpl == nil || tpl.Tree == nil {
		return source
	}
	contexts := templateIdentityNamedContexts(tpl)
	walker := &templateIdentityWalker{source: source, ids: ids, edits: map[int]templateIdentityEdit{}}
	for name, context := range contexts {
		if context != templateIdentityNamedRow {
			continue
		}
		if named := tpl.Lookup(name); named != nil && named.Tree != nil {
			row := templateIdentityValue{kind: templateIdentityRoot}
			walker.list(named.Tree.Root, newTemplateIdentityScope(row), row)
		}
	}
	edits := make([]templateIdentityEdit, 0, len(walker.edits))
	for _, edit := range walker.edits {
		edits = append(edits, edit)
	}
	sort.Slice(edits, func(i, j int) bool { return edits[i].start < edits[j].start })
	var result strings.Builder
	previous := 0
	for _, edit := range edits {
		if edit.start < previous || edit.end > len(source) {
			return source
		}
		result.WriteString(source[previous:edit.start])
		result.WriteString(edit.text)
		previous = edit.end
	}
	result.WriteString(source[previous:])
	return result.String()
}

const (
	templateIdentityUnknown = iota
	templateIdentityRoot
	templateIdentityFields
	templateIdentityString
)

type templateIdentityValue struct {
	kind int
	text string
}

// 名称只负责解析当前可见绑定；不同词法作用域中的同名声明拥有不同身份。
// 绑定值独立保存，因此先赋值外层变量、再声明同名局部变量也不会丢失外层赋值。
type templateIdentityScope struct {
	names  map[string]int
	values map[int]templateIdentityValue
}

func newTemplateIdentityScope(root templateIdentityValue) *templateIdentityScope {
	return &templateIdentityScope{names: map[string]int{"$": 0}, values: map[int]templateIdentityValue{0: root}}
}

func (scope *templateIdentityScope) clone() *templateIdentityScope {
	return &templateIdentityScope{names: maps.Clone(scope.names), values: maps.Clone(scope.values)}
}

func (scope *templateIdentityScope) get(name string) templateIdentityValue {
	if binding, exists := scope.names[name]; exists {
		return scope.values[binding]
	}
	return templateIdentityValue{}
}

type templateIdentityEdit struct {
	start, end int
	text       string
}

type templateIdentityWalker struct {
	source         string
	ids            map[string]string
	edits          map[int]templateIdentityEdit
	onTemplate     func(string, templateIdentityValue)
	onAssign       func(int)
	nextBinding    int
	assignmentScan bool
}

const (
	templateIdentityNamedRow = 1 << iota
	templateIdentityNamedUnknown
)

// 先收集所有可达调用的上下文，再编辑定义，避免同一模板混合接收条目与其他数据时误改。
// 上下文只从已知条目降为混合/未知；队列同时处理嵌套调用与递归，且不会执行模板。
func templateIdentityNamedContexts(tpl *template.Template) map[string]int {
	// 入口也可能通过 template "" 接收其他数据，不能绕过混合上下文检查。
	contexts := map[string]int{tpl.Name(): templateIdentityNamedRow}
	queue := []string{tpl.Name()}
	walker := &templateIdentityWalker{onTemplate: func(name string, value templateIdentityValue) {
		context := templateIdentityNamedUnknown
		if value.kind == templateIdentityRoot {
			context = templateIdentityNamedRow
		}
		if contexts[name]&context == 0 {
			contexts[name] |= context
			queue = append(queue, name)
		}
	}}
	row := templateIdentityValue{kind: templateIdentityRoot}
	for len(queue) > 0 {
		name := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		named := tpl.Lookup(name)
		if named == nil || named.Tree == nil {
			continue
		}
		context := templateIdentityValue{}
		if contexts[name] == templateIdentityNamedRow {
			context = row
		}
		walker.list(named.Tree.Root, newTemplateIdentityScope(context), context)
	}
	return contexts
}

func (walker *templateIdentityWalker) list(list *parse.ListNode, variables *templateIdentityScope, dot templateIdentityValue) {
	if list == nil {
		return
	}
	for _, node := range list.Nodes {
		switch current := node.(type) {
		case *parse.ActionNode:
			walker.pipe(current.Pipe, variables, dot)
		case *parse.IfNode:
			walker.branch(&current.BranchNode, variables, dot, false, false)
		case *parse.WithNode:
			walker.branch(&current.BranchNode, variables, dot, true, false)
		case *parse.RangeNode:
			walker.branch(&current.BranchNode, variables, dot, true, true)
		case *parse.TemplateNode:
			value := walker.pipe(current.Pipe, variables, dot)
			if walker.onTemplate != nil {
				walker.onTemplate(current.Name, value)
			}
		}
	}
}

func (walker *templateIdentityWalker) branch(branch *parse.BranchNode, variables *templateIdentityScope, dot templateIdentityValue, changesDot, repeated bool) {
	entry := variables.clone()
	value := walker.pipe(branch.Pipe, entry, dot)
	left, right := entry.clone(), entry.clone()
	leftDot := dot
	if changesDot {
		leftDot = value
	}
	assigned := map[int]bool{}
	if repeated {
		leftDot = templateIdentityValue{}
		for _, declaration := range branch.Pipe.Decl {
			binding := left.names[declaration.Ident[0]]
			left.values[binding] = templateIdentityValue{}
			right.values[binding] = templateIdentityValue{}
		}
		if !walker.assignmentScan {
			// 先按真实词法绑定收集循环内外层赋值；局部同名声明不影响外层。
			scanner := &templateIdentityWalker{nextBinding: walker.nextBinding, assignmentScan: true, onAssign: func(binding int) {
				if _, outer := entry.values[binding]; outer {
					assigned[binding] = true
				}
			}}
			scanner.list(branch.List, left.clone(), leftDot)
			for binding := range assigned {
				left.values[binding] = templateIdentityValue{}
			}
		}
	}
	walker.list(branch.List, left, leftDot)
	walker.list(branch.ElseList, right, dot)
	for binding := range variables.values {
		if assigned[binding] || left.values[binding] != right.values[binding] {
			variables.values[binding] = templateIdentityValue{}
		} else {
			variables.values[binding] = left.values[binding]
		}
	}
}

func (walker *templateIdentityWalker) pipe(pipe *parse.PipeNode, variables *templateIdentityScope, dot templateIdentityValue) templateIdentityValue {
	if pipe == nil {
		return templateIdentityValue{}
	}
	value := templateIdentityValue{}
	for i, command := range pipe.Cmds {
		value = walker.command(command, variables, dot)
		if i > 0 {
			// 管道传递的参数无法从当前命令的局部位置安全重写。
			value = templateIdentityValue{}
		}
	}
	for _, declaration := range pipe.Decl {
		name := declaration.Ident[0]
		if pipe.IsAssign {
			if binding, exists := variables.names[name]; exists {
				variables.values[binding] = value
				if walker.onAssign != nil {
					walker.onAssign(binding)
				}
			}
		} else {
			walker.nextBinding++
			variables.names[name] = walker.nextBinding
			variables.values[walker.nextBinding] = value
		}
	}
	return value
}

func (walker *templateIdentityWalker) command(command *parse.CommandNode, variables *templateIdentityScope, dot templateIdentityValue) templateIdentityValue {
	values := make([]templateIdentityValue, len(command.Args))
	for i, argument := range command.Args {
		values[i] = walker.value(argument, variables, dot)
	}
	if len(values) == 1 {
		return values[0]
	}
	if len(values) < 3 || command.Args[0].Type() != parse.NodeIdentifier || command.Args[0].String() != "index" {
		return templateIdentityValue{}
	}
	value := values[1]
	for i := 2; i < len(values); i++ {
		key := values[i]
		if key.kind != templateIdentityString {
			value = templateIdentityValue{}
			continue
		}
		if value.kind == templateIdentityRoot && (key.text == "id_mod" || key.text == "id_mod_raw") {
			value = templateIdentityValue{kind: templateIdentityFields}
		} else {
			if value.kind == templateIdentityFields {
				walker.replace(command.Args[i], key.text)
			}
			value = templateIdentityValue{}
		}
	}
	return value
}

func templateIdentityProperty(value templateIdentityValue, names []string) templateIdentityValue {
	for _, name := range names {
		if value.kind == templateIdentityRoot && (name == "id_mod" || name == "id_mod_raw") {
			value = templateIdentityValue{kind: templateIdentityFields}
		} else {
			return templateIdentityValue{}
		}
	}
	return value
}

func (walker *templateIdentityWalker) value(node parse.Node, variables *templateIdentityScope, dot templateIdentityValue) templateIdentityValue {
	switch current := node.(type) {
	case *parse.StringNode:
		return templateIdentityValue{kind: templateIdentityString, text: current.Text}
	case *parse.DotNode:
		return dot
	case *parse.FieldNode:
		return templateIdentityProperty(dot, current.Ident)
	case *parse.VariableNode:
		return templateIdentityProperty(variables.get(current.Ident[0]), current.Ident[1:])
	case *parse.ChainNode:
		return templateIdentityProperty(walker.value(current.Node, variables, dot), current.Field)
	case *parse.PipeNode:
		return walker.pipe(current, variables, dot)
	}
	return templateIdentityValue{}
}

func (walker *templateIdentityWalker) replace(node parse.Node, old string) {
	replacement, found := walker.ids[old]
	if !found || replacement == old {
		return
	}
	if pipe, ok := node.(*parse.PipeNode); ok {
		if len(pipe.Cmds) == 1 && len(pipe.Cmds[0].Args) == 1 {
			walker.replace(pipe.Cmds[0].Args[0], old)
		}
		return
	}
	var original string
	text := strconv.Quote(replacement)
	switch current := node.(type) {
	case *parse.StringNode:
		original = current.Quoted
		if strings.HasPrefix(original, "`") && !strings.ContainsAny(replacement, "`\r") {
			text = "`" + replacement + "`"
		}
	case *parse.VariableNode:
		original = current.String()
	default:
		return
	}
	start := int(node.Position())
	end := start + len(original)
	if start < 0 || end > len(walker.source) || walker.source[start:end] != original {
		return
	}
	walker.edits[start] = templateIdentityEdit{start: start, end: end, text: text}
}
