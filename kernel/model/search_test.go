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
	gosql "database/sql"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFromSQLBlockMapsTimestamps(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() {
		Conf = previousConf
	})

	sqlBlock := &sql.Block{
		ID:      "20260722120000-abcdefg",
		Created: "20260722120000",
		Updated: "20260722123000",
	}

	block := fromSQLBlock(sqlBlock, "", 0)
	if block.Created != sqlBlock.Created {
		t.Fatalf("created = %q, want %q", block.Created, sqlBlock.Created)
	}
	if block.Updated != sqlBlock.Updated {
		t.Fatalf("updated = %q, want %q", block.Updated, sqlBlock.Updated)
	}
}

func TestValidEmbedBlockIDs(t *testing.T) {
	firstID := "20260721120000-block01"
	secondID := "20260721120001-block02"
	thirdID := "20260721120002-block03"
	ids := validEmbedBlockIDs([]string{firstID, "invalid", firstID, secondID, thirdID}, 2)
	if !slices.Equal(ids, []string{firstID, secondID}) {
		t.Fatalf("嵌入块 ID 应保持顺序、去重并限制数量：%v", ids)
	}
}

// TestIsValidSearchBoxPath 覆盖搜索入参的笔记本 ID 与文档路径校验，阻止 SQL 元字符进入语句拼接。
// 回归用例参考 /api/search/fullTextSearchBlock 的 SQL 注入报告（paths[] 投毒）。
func TestIsValidSearchBoxPath(t *testing.T) {
	validBox := "20210808180117-6v0mkxr"

	validCases := []struct {
		name string
		box  string
		path string
	}{
		{"仅笔记本范围", validBox, ""},
		{"仅斜杠", validBox, "/"},
		{"具体文档", validBox, "/20210808180117-6v0mkxr.sy"},
		{"子树目录范围", validBox, "/20210808180117-6v0mkxr"},
		{"子文档完整路径", validBox, "/20210808180117-6v0mkxr/20210808180530-a1b2c3d.sy"},
	}
	for _, tc := range validCases {
		t.Run("valid/"+tc.name, func(t *testing.T) {
			if !IsValidSearchBoxPath(tc.box, tc.path) {
				t.Fatalf("expected valid: box=%q path=%q", tc.box, tc.path)
			}
		})
	}

	invalidCases := []struct {
		name string
		box  string
		path string
	}{
		// 报告中的 UNION 投毒 payload
		{
			"SQL注入UNION投影",
			validBox,
			"/x%') UNION SELECT id,parent_id FROM blocks WHERE path='/hidden.sy' -- ",
		},
		{"单引号断字符串", validBox, "/doc'secret.sy"},
		{"百分号前导", validBox, "/%abc"},
		{"注释标记", validBox, "/doc -- "},
		{"非法box短数字", "123", ""},
		{"非法box大写", "20210808180117-6V0MKXR", ""},
		{"非法box空", "", "/20210808180117-6v0mkxr.sy"},
		{"path缺少前导斜杠", validBox, "20210808180117-6v0mkxr.sy"},
		{"path段非法", validBox, "/notanid.sy"},
		{"path中段非法", validBox, "/20210808180117-6v0mkxr/notanid.sy"},
	}
	for _, tc := range invalidCases {
		t.Run("invalid/"+tc.name, func(t *testing.T) {
			if IsValidSearchBoxPath(tc.box, tc.path) {
				t.Fatalf("expected invalid: box=%q path=%q", tc.box, tc.path)
			}
		})
	}
}

// TestBuildBoxesPathFiltersArgCount 验证参数化过滤器产出的 "?" 数量与 args 长度一致。
func TestBuildBoxesPathFiltersArgCount(t *testing.T) {
	boxes := []string{"20210808180117-6v0mkxr", "20210808180117-a1b2c3d"}
	clause, args := buildBoxesFilter(boxes)
	if countPlaceholder(clause) != len(args) {
		t.Fatalf("box filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 box args, got %d", len(args))
	}

	paths := []string{"/20210808180117-6v0mkxr", "/20210808180117-a1b2c3d/20210808180530-e5f6g7h.sy"}
	clause, args = buildPathsFilter(paths)
	if countPlaceholder(clause) != len(args) {
		t.Fatalf("path filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 path args, got %d", len(args))
	}
	for i, a := range args {
		s, ok := a.(string)
		if !ok || s != paths[i]+"%" {
			t.Fatalf("path arg %d should be %q%%, got %v", i, paths[i], a)
		}
	}
}

func TestBuildRootIDExclusionFilter(t *testing.T) {
	rootIDs := []string{"20260716120000-abcdefg", "20260716120001-hijklmn"}
	clause, args := buildRootIDExclusionFilter(rootIDs, "b.")
	if " AND b.root_id NOT IN (?, ?)" != clause {
		t.Fatalf("unexpected root ID exclusion filter: %q", clause)
	}
	if countPlaceholder(clause) != len(args) || len(rootIDs) != len(args) {
		t.Fatalf("root ID filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	for i, arg := range args {
		if rootIDs[i] != arg {
			t.Fatalf("root ID arg %d should be %q, got %v", i, rootIDs[i], arg)
		}
	}

	clause, args = buildRootIDExclusionFilter(nil)
	if "" != clause || 0 != len(args) {
		t.Fatalf("empty root IDs should not generate a filter: %q, %v", clause, args)
	}
}

func TestNormalizeBoxName(t *testing.T) {
	name := "  notebook/name\x00  "
	if normalized := normalizeBoxName(name); "notebookname" != normalized {
		t.Fatalf("unexpected normalized notebook name: %q", normalized)
	}
}

func countPlaceholder(s string) (n int) {
	for i := 0; i < len(s); i++ {
		if s[i] == '?' {
			n++
		}
	}
	return
}

func TestBuildRefUsedOrderBy(t *testing.T) {
	newestID := "20260714120000-newest1"
	olderID := "20260714110000-older01"
	invalidID := "invalid-id' OR 1=1 --"
	orderBy := buildRefUsedOrderBy(map[string]int64{
		olderID:   100,
		newestID:  200,
		invalidID: 300,
	})

	newestPos := strings.Index(orderBy, newestID)
	olderPos := strings.Index(orderBy, olderID)
	if 0 > newestPos || 0 > olderPos || newestPos >= olderPos {
		t.Fatalf("最近引用块应排在较早引用块之前：%q", orderBy)
	}
	if strings.Contains(orderBy, invalidID) {
		t.Fatalf("排序语句不应包含非法块 ID：%q", orderBy)
	}
	if !strings.HasSuffix(orderBy, "END ASC, ") {
		t.Fatalf("排序语句格式错误：%q", orderBy)
	}
}

func TestBuildRefUsedOrderByEmpty(t *testing.T) {
	if orderBy := buildRefUsedOrderBy(nil); "" != orderBy {
		t.Fatalf("空记录不应生成排序语句：%q", orderBy)
	}
}

func TestSortedRefUsedIDs(t *testing.T) {
	newestID := "20260714120000-newest1"
	higherID := "20260714110000-older01"
	lowerID := "20260714110000-newer01"
	ids := sortedRefUsedIDs(map[string]int64{
		lowerID:      100,
		newestID:     200,
		higherID:     100,
		"invalid-id": 300,
	})

	expected := []string{newestID, higherID, lowerID}
	if !slices.Equal(ids, expected) {
		t.Fatalf("最近引用块 ID 排序错误：%v", ids)
	}
}

func TestBuildOrderByPrioritizesExactDocumentAndHeading(t *testing.T) {
	setSearchCaseSensitive(t, true)

	orderBy := buildOrderBy("数学", 0, 0)
	assertOrderBySequence(t, orderBy,
		"name = '数学'",
		"instr(',' || alias || ',', ',数学,') > 0",
		"content = '数学' AND type = 'd'",
		"content LIKE '%数学%' AND type = 'd'",
		"content = '数学' AND type = 'h'",
		"content LIKE '%数学%' AND type = 'h'",
		"sort ASC",
	)

	orderBy = buildOrderBy("数学", 0, 7)
	assertOrderBySequence(t, orderBy,
		"content = '数学' AND type = 'd'",
		"content = '数学' AND type = 'h'",
		"rank",
	)

	orderBy = buildOrderBy("数学", 0, 6)
	if strings.Contains(orderBy, "content = '数学'") {
		t.Fatalf("按相关度升序不应将完全命中结果置顶：%q", orderBy)
	}
}

func TestBuildOrderByPrioritizesCaseInsensitiveExactMatches(t *testing.T) {
	setSearchCaseSensitive(t, false)

	orderBy := buildOrderBy("seo", 0, 0)
	assertOrderBySequence(t, orderBy,
		"name LIKE 'seo' ESCAPE '\\'",
		"(',' || alias || ',') LIKE '%,seo,%' ESCAPE '\\'",
		"content LIKE 'seo' ESCAPE '\\' AND type = 'd'",
		"content LIKE '%seo%' AND type = 'd'",
		"content LIKE 'seo' ESCAPE '\\' AND type = 'h'",
		"content LIKE '%seo%' AND type = 'h'",
		"sort ASC",
	)

	orderBy = buildOrderBy("seo", 0, 7)
	assertOrderBySequence(t, orderBy,
		"content LIKE 'seo' ESCAPE '\\' AND type = 'd'",
		"content LIKE 'seo' ESCAPE '\\' AND type = 'h'",
		"rank",
	)

	orderBy = buildOrderBy("seo", 0, 6)
	if strings.Contains(orderBy, "content LIKE 'seo'") {
		t.Fatalf("按相关度升序不应将完全命中结果置顶：%q", orderBy)
	}
}

func TestBuildOrderByRanksCaseInsensitiveExactContentFirst(t *testing.T) {
	setSearchCaseSensitive(t, false)
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec("CREATE TABLE blocks (name TEXT, alias TEXT, content TEXT, type TEXT, sort INTEGER, updated TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks VALUES ('', '', 'Learn seo', 'd', 0, ''), ('', '', 'SEO', 'd', 1, '')"); err != nil {
		t.Fatal(err)
	}

	row := testDB.QueryRow("SELECT content FROM blocks " + buildOrderBy("seo", 0, 0) + " LIMIT 1")
	var content string
	if err = row.Scan(&content); err != nil {
		t.Fatal(err)
	}
	if "SEO" != content {
		t.Fatalf("忽略大小写搜索时，完全命中的内容应排在首位：%q", content)
	}
}

func TestBuildOrderByRanksExactAliasSegmentFirst(t *testing.T) {
	setSearchCaseSensitive(t, false)
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec("CREATE TABLE blocks (name TEXT, alias TEXT, content TEXT, type TEXT, sort INTEGER, updated TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks VALUES ('', '', '如何编写技术文档', 'd', 0, ''), ('', '技术文档,技术文档工程师', '技术写作', 'd', 1, '')"); err != nil {
		t.Fatal(err)
	}

	row := testDB.QueryRow("SELECT content FROM blocks " + buildOrderBy("技术文档", 0, 0) + " LIMIT 1")
	var content string
	if err = row.Scan(&content); err != nil {
		t.Fatal(err)
	}
	if "技术写作" != content {
		t.Fatalf("完全命中的多值别名应排在文档标题包含命中之前：%q", content)
	}
}

func TestBuildExactSearchOrderConditionEscapesKeyword(t *testing.T) {
	setSearchCaseSensitive(t, true)
	condition := buildExactSearchOrderCondition("content", "O'Reilly%_\\")
	if expected := "content = 'O''Reilly%_\\'"; expected != condition {
		t.Fatalf("区分大小写的完全命中条件错误：got %q, want %q", condition, expected)
	}

	Conf.Search.CaseSensitive = false
	condition = buildExactSearchOrderCondition("content", "O'Reilly%_\\")
	if expected := "content LIKE 'O''Reilly\\%\\_\\\\' ESCAPE '\\'"; expected != condition {
		t.Fatalf("忽略大小写的完全命中条件错误：got %q, want %q", condition, expected)
	}
}

func TestBuildKeywordSearchQueries(t *testing.T) {
	tests := []struct {
		name          string
		query         string
		expectedFTS   string
		expectedHPath string
	}{
		{name: "单个空格", query: " ", expectedFTS: `" "`},
		{name: "连续空格", query: "  ", expectedFTS: `"  "`},
		{name: "制表符", query: "\t", expectedFTS: "\"\t\""},
		{name: "全角空格", query: "\u3000", expectedFTS: "\"\u3000\""},
		{name: "普通关键词", query: "Parent", expectedFTS: `"Parent"`, expectedHPath: "Parent"},
		{name: "首尾空格", query: " Parent ", expectedFTS: `" Parent "`, expectedHPath: "Parent"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ftsQuery, hPathQuery := buildKeywordSearchQueries(test.query)
			if test.expectedFTS != ftsQuery {
				t.Fatalf("FTS 查询错误：got %q, want %q", ftsQuery, test.expectedFTS)
			}
			if test.expectedHPath != hPathQuery {
				t.Fatalf("层级路径查询错误：got %q, want %q", hPathQuery, test.expectedHPath)
			}
		})
	}
}

func TestBuildExactAliasSearchOrderCondition(t *testing.T) {
	tests := []struct {
		name          string
		caseSensitive bool
		alias         string
		query         string
		matched       bool
	}{
		{name: "single alias", caseSensitive: true, alias: "技术文档", query: "技术文档", matched: true},
		{name: "first alias", caseSensitive: true, alias: "技术文档,技术写作", query: "技术文档", matched: true},
		{name: "middle alias", caseSensitive: true, alias: "写作,技术文档,工程", query: "技术文档", matched: true},
		{name: "last alias", caseSensitive: true, alias: "写作,技术文档", query: "技术文档", matched: true},
		{name: "partial alias", caseSensitive: true, alias: "技术文档工程师", query: "技术文档", matched: false},
		{name: "case sensitive mismatch", caseSensitive: true, alias: "SEO", query: "seo", matched: false},
		{name: "case insensitive match", alias: "AS,SEO", query: "seo", matched: true},
		{name: "escaped wildcard and backslash", alias: `other,100%_\\path,tail`, query: `100%_\\path`, matched: true},
		{name: "escaped quote", alias: "other,O'Reilly,tail", query: "O'Reilly", matched: true},
		{name: "comma query", alias: "foo,bar", query: "foo,bar", matched: false},
		{name: "empty query", alias: "", query: "", matched: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setSearchCaseSensitive(t, test.caseSensitive)
			testDB, err := gosql.Open("sqlite3_extended", ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				testDB.Close()
			})

			condition := buildExactAliasSearchOrderCondition("alias", test.query)
			row := testDB.QueryRow("SELECT CASE WHEN "+condition+" THEN 1 ELSE 0 END FROM (SELECT ? AS alias)", test.alias)
			var matched int
			if err = row.Scan(&matched); err != nil {
				t.Fatal(err)
			}
			if test.matched != (1 == matched) {
				t.Fatalf("别名完全命中状态错误：条件 %q，别名 %q，查询 %q，结果 %d", condition, test.alias, test.query, matched)
			}
		})
	}
}

func TestFTSAndHPathMatchesDeduplicateAndSort(t *testing.T) {
	setSearchCaseSensitive(t, true)
	testDB := newSearchHPathTestDB(t)
	insertSearchHPathTestBlock(t, testDB, "20260729120000-parent1", "20260729120000-parent1", "/Parent", "Parent", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729120001-child01", "20260729120001-child01", "/Parent/Child", "Child", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729120002-block01", "20260729120001-child01", "/Parent/Child", "Parent body", "p")

	cte, args := buildFTSAndHPathMatchesCTE("Parent", "\"Parent\"", "", "", nil, nil, "(type IN ('d', 'p'))", "")
	if countPlaceholder(cte) != len(args) {
		t.Fatalf("候选查询占位符数量错误：%q，参数：%v", cte, args)
	}
	if len(args) != 1 || "Parent" != args[0] {
		t.Fatalf("路径搜索参数错误：%v", args)
	}
	assertOrderBySequence(t, cte,
		"fts_matches AS MATERIALIZED",
		"instr(hpath, ?) > 0",
		"NOT EXISTS (SELECT 1 FROM fts_matches",
	)

	stmt := "WITH matches(block_rowid, fts_rank, match_source, path_level) AS (" +
		"VALUES (1, -10.0, 0, 0), (3, -1.0, 0, 0), (2, NULL, 1, 2)) " +
		"SELECT b.id, matches.match_source FROM matches JOIN blocks b ON b.rowid = matches.block_rowid " +
		buildHPathSearchOrderBy("Parent", 0)
	rows, err := testDB.Query(stmt)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var ids []string
	var sources []int
	for rows.Next() {
		var id string
		var source int
		if err = rows.Scan(&id, &source); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
		sources = append(sources, source)
	}
	expectedIDs := []string{"20260729120000-parent1", "20260729120002-block01", "20260729120001-child01"}
	if !slices.Equal(ids, expectedIDs) {
		t.Fatalf("单关键词路径搜索排序错误：got %v, want %v", ids, expectedIDs)
	}
	if !slices.Equal(sources, []int{0, 0, 1}) {
		t.Fatalf("单关键词路径搜索来源错误：%v", sources)
	}
}

func TestBuildHPathContainsCondition(t *testing.T) {
	setSearchCaseSensitive(t, true)
	condition, arg := buildHPathContainsCondition("Parent%_\\")
	if "instr(hpath, ?) > 0" != condition || "Parent%_\\" != arg {
		t.Fatalf("区分大小写的路径条件错误：%q，%q", condition, arg)
	}

	Conf.Search.CaseSensitive = false
	condition, arg = buildHPathContainsCondition("Parent%_\\")
	if "instr(search_normalize(hpath, 0, 1), ?) > 0" != condition || "parent%_\\" != arg {
		t.Fatalf("忽略大小写的路径条件错误：%q，%q", condition, arg)
	}

	Conf.Search.SetHanSensitive(false)
	condition, arg = buildHPathContainsCondition("詩經")
	if "instr(search_normalize(hpath, 0, 0), ?) > 0" != condition || "诗经" != arg {
		t.Fatalf("忽略繁简的路径条件错误：%q，%q", condition, arg)
	}
}

func TestFromHPathSearchSQLBlockOnlyMarksHPath(t *testing.T) {
	setSearchCaseSensitive(t, true)
	sqlBlock := &sql.Block{
		ID:      "20260730160000-hpath01",
		RootID:  "20260730160000-hpath01",
		HPath:   "/思源笔记/子文档",
		Name:    "引用思源笔记",
		Alias:   "思源笔记",
		Memo:    "思源笔记",
		Tag:     "思源笔记",
		Content: "((20260730160001-ref0001 '思源笔记'))",
		Type:    "d",
	}

	block := fromHPathSearchSQLBlock(sqlBlock, "思源笔记", 36)
	if strings.Contains(block.Content, "<mark>") ||
		strings.Contains(block.Name, "<mark>") ||
		strings.Contains(block.Alias, "<mark>") ||
		strings.Contains(block.Memo, "<mark>") ||
		strings.Contains(block.Tag, "<mark>") {
		t.Fatalf("路径辅助命中不应高亮正文或文档引用：%+v", block)
	}
	if !strings.Contains(block.HPath, "<mark>思源笔记</mark>") {
		t.Fatalf("路径辅助命中应高亮层级路径：%q", block.HPath)
	}

	sqlBlock.Content = search.SearchMarkLeft + "思源笔记" + search.SearchMarkRight
	block = fromHPathSearchSQLBlock(sqlBlock, "思源笔记", 36)
	if !strings.Contains(block.Content, "<mark>思源笔记</mark>") {
		t.Fatalf("FTS 摘要高亮应保留：%q", block.Content)
	}
}

func TestFromMixedHPathSearchSQLBlockMarksDirectContent(t *testing.T) {
	setSearchCaseSensitive(t, true)
	terms := "从这里" + search.TermSep + "会员"
	contentTerms := matchedSearchTerms("会员特权", terms)
	if "会员" != contentTerms {
		t.Fatalf("文档自身直接命中的关键词错误：%q", contentTerms)
	}

	sqlBlock := &sql.Block{
		ID:      "20260731160000-hpath03",
		RootID:  "20260731160000-hpath03",
		HPath:   "/思源笔记用户指南/请/从这里开始/会员特权",
		Name:    "从这里",
		Content: "会员特权",
		Type:    "d",
	}
	block := fromHPathSearchSQLBlockWithContentTerms(sqlBlock, terms, contentTerms, 36)
	if "<mark>会员</mark>特权" != block.Content {
		t.Fatalf("混合命中应高亮文档自身直接命中的关键词：%q", block.Content)
	}
	if strings.Contains(block.Name, "<mark>") {
		t.Fatalf("路径关键词不应扩展高亮到其他文档字段：%q", block.Name)
	}
	if !strings.Contains(block.HPath, "<mark>从这里</mark>") ||
		!strings.Contains(block.HPath, "<mark>会员</mark>") {
		t.Fatalf("混合命中应高亮全部路径关键词：%q", block.HPath)
	}
}

func TestFilterSelfHPathPreservesHighlight(t *testing.T) {
	setSearchCaseSensitive(t, true)
	multipleKeywords := fromHPathSearchSQLBlock(&sql.Block{
		ID:      "20260731120000-hpath01",
		RootID:  "20260731120000-hpath01",
		HPath:   "/思源笔记用户指南/请/从这里开始/会员特权",
		Content: "会员特权",
		Type:    "d",
	}, "从这里"+search.TermSep+"会员", 36)
	singleKeyword := fromHPathSearchSQLBlock(&sql.Block{
		ID:      "20260731120001-hpath02",
		RootID:  "20260731120001-hpath02",
		HPath:   "/会员特权",
		Content: "会员特权",
		Type:    "d",
	}, "会员", 36)
	blocks := []*Block{
		multipleKeywords,
		singleKeyword,
		{
			Type:  "NodeParagraph",
			HPath: "/思源笔记用户指南/<mark>会员</mark>特权",
		},
	}

	filterSelfHPath(blocks)

	if expected := "/思源笔记用户指南/请/<mark>从这里</mark>开始/"; expected != blocks[0].HPath {
		t.Fatalf("多关键字高亮路径移除文档自身后错误：got %q, want %q", blocks[0].HPath, expected)
	}
	if expected := "/"; expected != blocks[1].HPath {
		t.Fatalf("单关键字高亮路径移除文档自身后错误：got %q, want %q", blocks[1].HPath, expected)
	}
	if expected := "/思源笔记用户指南/<mark>会员</mark>特权"; expected != blocks[2].HPath {
		t.Fatalf("非文档块路径不应变化：got %q, want %q", blocks[2].HPath, expected)
	}
}

func TestBuildHPathSearchOrderBy(t *testing.T) {
	setSearchCaseSensitive(t, true)
	assertOrderBySequence(t, buildHPathSearchOrderBy("Parent", 0),
		"matches.match_source ASC",
		"CASE",
		"instr(',' || b.alias || ',', ',Parent,') > 0",
		"matches.path_level",
		"b.sort ASC",
		"b.updated DESC",
		"b.id ASC",
	)
	assertOrderBySequence(t, buildHPathSearchOrderBy("Parent", 2),
		"b.created DESC",
		"matches.match_source ASC",
		"b.id ASC",
	)
	assertOrderBySequence(t, buildHPathSearchOrderBy("Parent", 7),
		"matches.match_source ASC",
		"CASE",
		"matches.fts_rank",
		"matches.path_level",
		"b.id ASC",
	)
}

func TestBuildDocumentSearchOrderBy(t *testing.T) {
	setSearchCaseSensitive(t, true)
	assertOrderBySequence(t, buildDocumentSearchOrderBy("Parent Child", 0),
		"matchSource ASC",
		"docMatchScore DESC",
		"CASE",
		"blockSort DESC",
		"sort ASC",
		"updated DESC",
		"id ASC",
	)
	assertOrderBySequence(t, buildDocumentSearchOrderBy("Parent Child", 6),
		"matchSource ASC",
		"docMatchScore ASC",
		"CASE",
		"blockSort ASC",
		"sort ASC",
		"updated DESC",
		"id ASC",
	)
	assertOrderBySequence(t, buildDocumentSearchOrderBy("Parent Child", 2),
		"created DESC",
		"matchSource ASC",
		"docMatchScore DESC",
		"id ASC",
	)
}

func TestBuildDocumentMatchOrderBy(t *testing.T) {
	assertOrderBySequence(t, buildDocumentMatchOrderBy("docMatchScore", 0),
		"matchSource ASC",
		"docMatchScore DESC",
		"docUpdated DESC",
		"docRootID ASC",
	)
	assertOrderBySequence(t, buildDocumentMatchOrderBy("docMatchScore", 6),
		"matchSource ASC",
		"docMatchScore ASC",
		"docUpdated DESC",
		"docRootID ASC",
	)
	assertOrderBySequence(t, buildDocumentMatchOrderBy("docMatchScore", 2),
		"docCreated DESC",
		"matchSource ASC",
		"docMatchScore DESC",
		"docRootID ASC",
	)
}

func TestDocumentSearchFinalOrderPrioritizesDirectMatches(t *testing.T) {
	setSearchCaseSensitive(t, true)
	testDB := newSearchHPathTestDB(t)
	insertSearchHPathTestBlock(t, testDB, "path-only", "path-only", "/从这里开始/会员特权/资源文件图床", "资源文件图床", "d")
	insertSearchHPathTestBlock(t, testDB, "direct", "direct", "/从这里开始/会员特权", "会员特权", "d")
	if _, err := testDB.Exec("UPDATE blocks SET created = '20260731120002' WHERE id = 'path-only'"); err != nil {
		t.Fatal(err)
	}
	if _, err := testDB.Exec("UPDATE blocks SET created = '20260731120001' WHERE id = 'direct'"); err != nil {
		t.Fatal(err)
	}

	queryResult := func(query string, keywords []string, orderBy, pageSize int) (ids []string, sources, scores []int) {
		stmt := buildDocumentSearchStatement(query, keywords, "type IN ('d')", "", "", "", orderBy, 1, pageSize, true)
		rows, err := testDB.Query("SELECT id, docContent, matchSource, docMatchScore FROM (" + stmt + ")")
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id string
			var docContent string
			var source, score int
			if err = rows.Scan(&id, &docContent, &source, &score); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
			sources = append(sources, source)
			scores = append(scores, score)
		}
		if err = rows.Close(); err != nil {
			t.Fatal(err)
		}
		return
	}

	ids, sources, scores := queryResult("从这里 会员", []string{"从这里", "会员"}, 0, 32)
	if !slices.Equal(ids, []string{"direct", "path-only"}) {
		t.Fatalf("默认排序应优先返回直接命中关键词的文档：%v", ids)
	}
	if !slices.Equal(sources, []int{1, 1}) || !slices.Equal(scores, []int{1, 0}) {
		t.Fatalf("路径辅助文档直接命中分数错误：sources=%v, scores=%v", sources, scores)
	}

	ids, _, _ = queryResult("从这里 会员特权", []string{"从这里", "会员特权"}, 0, 32)
	if !slices.Equal(ids, []string{"direct", "path-only"}) {
		t.Fatalf("完整文档关键词应优先返回直接命中的文档：%v", ids)
	}

	ids, _, _ = queryResult("从这里 会员", []string{"从这里", "会员"}, 0, 1)
	if !slices.Equal(ids, []string{"direct"}) {
		t.Fatalf("分页选择应优先包含直接命中关键词的文档：%v", ids)
	}

	ids, _, _ = queryResult("从这里 会员", []string{"从这里", "会员"}, 2, 32)
	if !slices.Equal(ids, []string{"path-only", "direct"}) {
		t.Fatalf("按创建时间降序时应保持时间优先：%v", ids)
	}
}

func TestDocumentSearchFieldMatchesMultipleHPathLevels(t *testing.T) {
	setSearchCaseSensitive(t, true)
	testDB := newSearchHPathTestDB(t)
	insertSearchHPathTestBlock(t, testDB, "20260729121000-child01", "20260729121000-child01", "/Project/Parent/Child", "Child", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729121001-block01", "20260729121000-child01", "/Project/Parent/Child", "Body keyword", "p")
	insertSearchHPathTestBlock(t, testDB, "20260729121002-content", "20260729121002-content", "/Other", "Project Parent keyword", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729121003-mixed01", "20260729121003-mixed01", "/Project/Parent/keyword", "keyword", "d")

	contentField := columnConcat()
	keywords := []string{"Project", "Parent", "keyword"}
	hPathField := "MAX(CASE WHEN type = 'd' THEN " + normalizedHPathSearchField("hpath") + " ELSE '' END)"
	contentFilter := buildSearchDocumentLikeFilter("GROUP_CONCAT("+contentField+")", keywords)
	filter := buildSearchDocumentLikeFilterWithHPath("GROUP_CONCAT("+contentField+")", hPathField, keywords)
	rows, err := testDB.Query("SELECT root_id FROM blocks WHERE type IN ('d', 'p') AND root_id = '20260729121000-child01' GROUP BY root_id HAVING " + filter)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatal("多关键词应能跨多层路径和正文命中文档")
	}
	var rootID string
	if err = rows.Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if "20260729121000-child01" != rootID {
		t.Fatalf("路径辅助命中的文档错误：%q", rootID)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}

	docContentField := "MAX(CASE WHEN type = 'd' THEN (" + contentField + ") END)"
	matchScore := buildDocumentMatchScore(docContentField, keywords)
	docBlocksStmt := "SELECT root_id, CASE WHEN " + contentFilter + " THEN 0 ELSE 1 END AS matchSource, " +
		docContentField + " AS docContent, " + matchScore + " AS docMatchScore, " +
		"MAX(created) AS docCreated, MAX(updated) AS docUpdated FROM blocks " +
		"WHERE type IN ('d', 'p') GROUP BY root_id HAVING " + filter
	sourceStmt := "WITH docBlocks AS (" + docBlocksStmt + ") " +
		"SELECT root_id AS docRootID, matchSource, docContent, docMatchScore, docCreated, docUpdated FROM docBlocks" +
		buildDocumentMatchOrderBy("docMatchScore", 0)
	rows, err = testDB.Query(sourceStmt)
	if err != nil {
		t.Fatal(err)
	}
	var sources []int
	var scores []int
	var sourceRootIDs []string
	for rows.Next() {
		var source int
		var score int
		var docContent string
		var docCreated, docUpdated string
		if err = rows.Scan(&rootID, &source, &docContent, &score, &docCreated, &docUpdated); err != nil {
			t.Fatal(err)
		}
		sourceRootIDs = append(sourceRootIDs, rootID)
		sources = append(sources, source)
		scores = append(scores, score)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(sources, []int{0, 1, 1}) ||
		!slices.Equal(scores, []int{3, 1, 0}) ||
		!slices.Equal(sourceRootIDs, []string{"20260729121002-content", "20260729121003-mixed01", "20260729121000-child01"}) {
		t.Fatalf("正文与路径辅助文档排序错误：roots=%v, sources=%v, scores=%v", sourceRootIDs, sources, scores)
	}

	contentOnlyFilter := buildSearchDocumentLikeFilter("GROUP_CONCAT("+contentField+")", keywords)
	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM (SELECT root_id FROM blocks WHERE type IN ('d', 'p') GROUP BY root_id HAVING " + contentOnlyFilter + ")").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if 1 != count {
		t.Fatalf("关闭路径搜索后只能命中正文文档：%d", count)
	}

	Conf.Search.SetHanSensitive(false)
	insertSearchHPathTestBlock(t, testDB, "20260729121004-child02", "20260729121004-child02", "/詩經/Child", "Child", "d")
	hPathField = "MAX(CASE WHEN type = 'd' THEN " + normalizedHPathSearchField("hpath") + " ELSE '' END)"
	filter = buildSearchDocumentLikeFilterWithHPath("GROUP_CONCAT("+contentField+")", hPathField, []string{"诗经", "Child"})
	if err = testDB.QueryRow("SELECT COUNT(*) FROM (SELECT root_id FROM blocks WHERE type = 'd' GROUP BY root_id HAVING " + filter + ")").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if 1 != count {
		t.Fatalf("多关键词路径搜索应支持繁简等价匹配：%d", count)
	}
}

func newSearchHPathTestDB(t *testing.T) *gosql.DB {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)"); err != nil {
		t.Fatal(err)
	}
	return testDB
}

func insertSearchHPathTestBlock(t *testing.T, testDB *gosql.DB, id, rootID, hPath, content, blockType string) {
	t.Helper()
	_, err := testDB.Exec("INSERT INTO blocks VALUES (?, '', ?, '', '20260729120000-box000', '/"+rootID+".sy', ?, '', '', '', '', ?, '', '', 0, ?, '', '', 0, '20260729120000', '20260729120000')",
		id, rootID, hPath, content, blockType)
	if err != nil {
		t.Fatal(err)
	}
}

func setSearchCaseSensitive(t *testing.T, caseSensitive bool) {
	t.Helper()
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	Conf.Search.CaseSensitive = caseSensitive
	t.Cleanup(func() {
		Conf = previousConf
	})
}

func TestReplaceTextAcrossBackslashes(t *testing.T) {
	setSearchCaseSensitive(t, true)
	luteEngine := util.NewLute()
	tests := []struct {
		name        string
		nodes       func() []*ast.Node
		method      int
		keyword     string
		replacement string
		expected    string
		changed     bool
		backslashes []string
	}{
		{
			name: "consecutive backslashes",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestText("前 "),
					replaceTextTestBackslash("=", ast.NodeText),
					replaceTextTestBackslash(">", ast.NodeBackslashContent),
					replaceTextTestText(" 后"),
				}
			},
			keyword:     "=>",
			replacement: "to",
			expected:    "前 to 后",
			changed:     true,
		},
		{
			name: "cite marker",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestText("[cite"),
					replaceTextTestBackslash("_", ast.NodeText),
					replaceTextTestText("start]A[cite"),
					replaceTextTestBackslash("_", ast.NodeBackslashContent),
					replaceTextTestText("start]B"),
				}
			},
			method:      3,
			keyword:     `\[cite.*?\]`,
			replacement: "",
			expected:    "AB",
			changed:     true,
		},
		{
			name: "task marker",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestBackslash("[", ast.NodeText),
					replaceTextTestText("v"),
					replaceTextTestBackslash("]", ast.NodeBackslashContent),
					replaceTextTestText(" item"),
				}
			},
			keyword:     "[v]",
			replacement: "",
			expected:    " item",
			changed:     true,
		},
		{
			name: "preserve backslash in replacement",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestText("123"),
					replaceTextTestBackslash(".", ast.NodeBackslashContent),
					replaceTextTestText(" 123"),
				}
			},
			keyword:     "123. 123",
			replacement: `1234\. 123`,
			expected:    "1234. 123",
			changed:     true,
			backslashes: []string{"."},
		},
		{
			name: "preserve unmatched backslash",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestBackslash("*", ast.NodeBackslashContent),
					replaceTextTestText(" keep "),
					replaceTextTestBackslash("=", ast.NodeText),
					replaceTextTestBackslash(">", ast.NodeBackslashContent),
					replaceTextTestText(" end"),
				}
			},
			keyword:     "=>",
			replacement: "to",
			expected:    "* keep to end",
			changed:     true,
			backslashes: []string{"*"},
		},
		{
			name: "regular expression uses full run context",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestText("prefix "),
					replaceTextTestBackslash("=", ast.NodeText),
					replaceTextTestBackslash(">", ast.NodeBackslashContent),
				}
			},
			method:      3,
			keyword:     `^=>`,
			replacement: "to",
			expected:    "prefix =>",
			backslashes: []string{"=", ">"},
		},
		{
			name: "regular expression capture",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestBackslash("=", ast.NodeText),
					replaceTextTestBackslash(">", ast.NodeBackslashContent),
					replaceTextTestText(" rest"),
				}
			},
			method:      3,
			keyword:     `(=>)`,
			replacement: `${1}x`,
			expected:    "=>x rest",
			changed:     true,
		},
		{
			name: "zero width regular expression",
			nodes: func() []*ast.Node {
				return []*ast.Node{
					replaceTextTestBackslash("=", ast.NodeText),
					replaceTextTestBackslash(">", ast.NodeBackslashContent),
				}
			},
			method:      3,
			keyword:     `$`,
			replacement: "x",
			expected:    "=>x",
			changed:     true,
			backslashes: []string{"=", ">"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeParagraph}
			for _, node := range test.nodes() {
				root.AppendChild(node)
			}
			var matcher *regexp.Regexp
			if 3 == test.method {
				matcher = regexp.MustCompile(test.keyword)
			}

			skipNodes, changed := replaceTextAcrossBackslashes(root, test.method, test.keyword, test.replacement, matcher, luteEngine)
			if test.changed != changed {
				t.Fatalf("替换状态错误：期望 %t，实际 %t", test.changed, changed)
			}
			if actual := root.Content(); test.expected != actual {
				t.Fatalf("替换结果错误：期望 %q，实际 %q", test.expected, actual)
			}
			if test.changed && 1 > len(skipNodes) {
				t.Fatal("替换后的节点未加入跳过集合")
			}
			if actual := replaceTextTestBackslashes(root); !slices.Equal(test.backslashes, actual) {
				t.Fatalf("转义节点错误：期望 %q，实际 %q", test.backslashes, actual)
			}
		})
	}
}

func TestReplaceTextAcrossBackslashesCaseInsensitive(t *testing.T) {
	setSearchCaseSensitive(t, false)
	root := &ast.Node{Type: ast.NodeParagraph}
	root.AppendChild(replaceTextTestText("A"))
	root.AppendChild(replaceTextTestBackslash("_", ast.NodeBackslashContent))
	root.AppendChild(replaceTextTestText("B"))

	_, changed := replaceTextAcrossBackslashes(root, 0, "a_b", "x", nil, util.NewLute())
	if !changed {
		t.Fatal("大小写不敏感的跨节点替换未执行")
	}
	if actual := root.Content(); "x" != actual {
		t.Fatalf("大小写不敏感的跨节点替换结果错误：期望 %q，实际 %q", "x", actual)
	}
}

func replaceTextTestText(content string) *ast.Node {
	return &ast.Node{Type: ast.NodeText, Tokens: []byte(content)}
}

func replaceTextTestBackslash(content string, contentType ast.NodeType) *ast.Node {
	ret := &ast.Node{Type: ast.NodeBackslash}
	ret.AppendChild(&ast.Node{Type: contentType, Tokens: []byte(content)})
	return ret
}

func replaceTextTestBackslashes(root *ast.Node) (ret []string) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeBackslash == node.Type {
			ret = append(ret, node.Content())
		}
		return ast.WalkContinue
	})
	return
}

func assertOrderBySequence(t *testing.T, orderBy string, fragments ...string) {
	t.Helper()
	previous := -1
	for _, fragment := range fragments {
		current := strings.Index(orderBy, fragment)
		if 0 > current {
			t.Fatalf("排序语句缺少 %q：%q", fragment, orderBy)
		}
		if current <= previous {
			t.Fatalf("排序优先级顺序错误，%q 未出现在预期位置：%q", fragment, orderBy)
		}
		previous = current
	}
}
