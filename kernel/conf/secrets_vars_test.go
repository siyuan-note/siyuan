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

// TestSecretsResolveExplicit 验证 {{secrets.NAME}} 显式语法与 $NAME/${NAME} 只在密钥库内查找。
func TestSecretsResolveExplicit(t *testing.T) {
	s := &Secrets{Items: []*Secret{{Name: "KEY", Value: "k1"}}}
	cases := []struct{ in, want string }{
		{"{{secrets.KEY}}", "k1"},
		{"pre {{secrets.KEY}} post", "pre k1 post"},
		{"{{secrets.MISSING}}", "{{secrets.MISSING}}"}, // 找不到保留原文
		{"$KEY", "k1"},           // 无前缀简写，密钥库命中
		{"${KEY}", "k1"},         // 无前缀花括号，密钥库命中
		{"$MISSING", "$MISSING"}, // 密钥库无此名，保留原文
		{"$100", "$100"},         // 数字开头不匹配
		{"", ""},
	}
	for _, c := range cases {
		if got := s.Resolve(c.in); got != c.want {
			t.Errorf("Secrets.Resolve(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestVariablesResolveExplicit 验证 {{vars.NAME}} 显式语法与 $NAME/${NAME} 只在变量库内查找。
func TestVariablesResolveExplicit(t *testing.T) {
	v := &Variables{Items: []*Variable{{Name: "VAR", Value: "v1"}}}
	cases := []struct{ in, want string }{
		{"{{vars.VAR}}", "v1"},
		{"{{vars.MISSING}}", "{{vars.MISSING}}"},
		{"$VAR", "v1"},
		{"${VAR}", "v1"},
		{"$MISSING", "$MISSING"},
	}
	for _, c := range cases {
		if got := v.Resolve(c.in); got != c.want {
			t.Errorf("Variables.Resolve(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestPerStoreDollarIsolation 验证各库的 Resolve 处理 $NAME 时只查各自库，不跨库。
// secrets.Resolve("$ONLY_VAR") 不应拿到变量库的值，反之亦然。
func TestPerStoreDollarIsolation(t *testing.T) {
	secrets := &Secrets{Items: []*Secret{{Name: "ONLY_SECRET", Value: "s"}}}
	vars := &Variables{Items: []*Variable{{Name: "ONLY_VAR", Value: "v"}}}
	// 密钥库的 Resolve 不应解析只在变量库存在的名字
	if got := secrets.Resolve("$ONLY_VAR"); got != "$ONLY_VAR" {
		t.Errorf("secrets.Resolve($ONLY_VAR) = %q, want $ONLY_VAR (密钥库不应跨库查变量)", got)
	}
	// 变量库的 Resolve 不应解析只在密钥库存在的名字
	if got := vars.Resolve("$ONLY_SECRET"); got != "$ONLY_SECRET" {
		t.Errorf("vars.Resolve($ONLY_SECRET) = %q, want $ONLY_SECRET (变量库不应跨库查密钥)", got)
	}
}

// TestResolveSecretsVarsDollarSyntax 验证无前缀 $NAME / ${NAME} 的 shell 风格语法。
// 仅当密钥库或变量库存在对应名字时才替换，否则保留原文。
func TestResolveSecretsVarsDollarSyntax(t *testing.T) {
	secrets := &Secrets{Items: []*Secret{
		{Name: "WEREAD_API_KEY", Value: "wrk-secret"},
		{Name: "KEY", Value: "k1"},
	}}
	vars := &Variables{Items: []*Variable{{Name: "VAR", Value: "v1"}}}

	cases := []struct{ in, want string }{
		// shell 简写与花括号形式
		{"Bearer $WEREAD_API_KEY", "Bearer wrk-secret"},
		{"Bearer ${WEREAD_API_KEY}", "Bearer wrk-secret"},
		// 数字开头、正则组等不相关内容保留
		{"price $100", "price $100"},
		{"regex $1 group", "regex $1 group"},
		// 库里无对应名字时保留原文
		{"$A $B end", "$A $B end"},
		// 显式语法仍正常工作
		{"{{secrets.KEY}}-{{vars.VAR}}", "k1-v1"},
		// $VAR 优先匹配密钥，密钥库无 VAR 则回退变量库
		{"$VAR", "v1"},
		// 混合场景
		{"mix $KEY and ${VAR} and literal", "mix k1 and v1 and literal"},
	}
	for _, c := range cases {
		if got := ResolveSecretsVars(secrets, vars, c.in); got != c.want {
			t.Errorf("ResolveSecretsVars(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestResolveSecretsVarsPriority 验证名字重复时无前缀引用优先密钥，而显式语法各取各的。
func TestResolveSecretsVarsPriority(t *testing.T) {
	secrets := &Secrets{Items: []*Secret{{Name: "dup", Value: "from-secret"}}}
	vars := &Variables{Items: []*Variable{{Name: "dup", Value: "from-var"}}}

	if got := ResolveSecretsVars(secrets, vars, "$dup"); got != "from-secret" {
		t.Errorf("$dup = %q, want from-secret", got)
	}
	if got := ResolveSecretsVars(secrets, vars, "${dup}"); got != "from-secret" {
		t.Errorf("${dup} = %q, want from-secret", got)
	}
	// 显式语法不受名字重复影响
	if g := ResolveSecretsVars(secrets, vars, "{{secrets.dup}}"); g != "from-secret" {
		t.Errorf("{{secrets.dup}} = %q, want from-secret", g)
	}
	if g := ResolveSecretsVars(secrets, vars, "{{vars.dup}}"); g != "from-var" {
		t.Errorf("{{vars.dup}} = %q, want from-var", g)
	}
}

// TestResolveSecretsVarsNilSafe 验证 nil 参数不引发 panic。
func TestResolveSecretsVarsNilSafe(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("ResolveSecretsVars with nil panicked: %v", r)
		}
	}()
	// 任一为 nil 都应安全跳过，找不到名字则保留原文
	if got := ResolveSecretsVars(nil, nil, "$X"); got != "$X" {
		t.Errorf("ResolveSecretsVars(nil,nil) = %q, want $X", got)
	}
	if got := ResolveSecretsVars(nil, nil, "plain text"); got != "plain text" {
		t.Errorf("ResolveSecretsVars(nil,nil,plain) = %q, want plain text", got)
	}
}

// TestSecretsLookup 验证 lookup 返回值与存在性。
func TestSecretsLookup(t *testing.T) {
	s := &Secrets{Items: []*Secret{{Name: "a", Value: "1"}}}
	if v, ok := s.lookup("a"); !ok || v != "1" {
		t.Errorf("lookup(a) = %q,%v, want 1,true", v, ok)
	}
	if _, ok := s.lookup("missing"); ok {
		t.Error("lookup(missing) should be not ok")
	}
}
