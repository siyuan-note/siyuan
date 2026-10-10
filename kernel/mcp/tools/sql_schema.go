package tools

// SQL 索引说明按需返回，不向每轮智能体系统提示词注入完整表结构。
const sqlSchemaGuide = `# SiYuan read-only SQL and search guide

Choose keyword search.fulltext for words; method=1 for query syntax, method=3 for regex, and search.semantic for meaning. Prefer SQL for block types, inline formatting, combined predicates, ancestry and aggregates. Use sql.query to inspect arbitrary columns or statistics; search.fulltext(method=2) delegates to it, ignoring page/pageSize, path/type/subtype/orderBy/groupBy filters. Express filters, ordering and LIMIT/OFFSET in SQL. The default limit is 100; explicit LIMIT and OFFSET paginate ordinary SQL. Encrypted notebook queries require the notebook parameter and an unlocked notebook, are isolated, and remain capped at 100 rows. Never use SQL to mutate indexes.

To show blocks in the frontend, call native/frontend/open_search with method=2 and a query returning complete block rows (SELECT b.* FROM blocks b). Projections and aggregates belong in sql.query, not the search window. Newlines terminate -- comments; preserve them. Query results include original rows, columns, rowCount, defaultLimit, possiblyTruncated and verified blocks {id,url}. A possible truncation warning is conservative, not a total count. URLs use siyuan://blocks/ID; retrieve full content with block.get.

## Indexed tables
- blocks(id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated): id is a block ID; parent_id is the immediate container block; root_id is its document ID (document id=root_id). box is the notebook ID. path is an internal ID-based document path; hpath is the title path. content is searchable plain text, markdown is formatted Markdown, fcontent is the first child content used for containers. Containers can aggregate descendant content: select leaf types to avoid duplicate matches. ial is serialized block attributes; created/updated are YYYYMMDDHHMMSS strings, sort is sibling ordering. Headings are leaf siblings, not parents of following sections.
- spans(id, block_id, root_id, box, path, content, markdown, type, ial): indexed inline elements. id is an index record ID, NOT an addressable block; join block_id=blocks.id. Images use type='img'; formatted text uses space-separated tokens beginning with 'textmark', e.g. 'textmark code', 'textmark strong code', 'textmark tag', 'textmark a', 'textmark block-ref'. Match tokens with (' ' || type || ' ') LIKE '% code %', not equality, when combined formats should match. Ordinary plain text is not a code span. content is the inline plain text; markdown preserves formatting.
- attributes(id, name, value, type, block_id, root_id, box, path): indexed named attributes; type='b' for blocks, 's' for spans. Join block_id for ownership; not every IAL attribute is indexed.
- assets(id, block_id, root_id, box, docpath, path, name, title, hash): asset references; path is the asset path and docpath is the internal document path.

## Stored block type codes
d document; p paragraph; h heading; l list; i list item; c code block; m math block; t table; b blockquote; s super block; html HTML; query_embed block query embed; av attribute view; iframe iframe; widget widget; tb thematic break; video video; audio audio; custom custom block; callout callout; tabs tabs; tab tab item; mindmap mind map; mindmap_item mind map item. subtype: headings h1..h6; lists/items and mind maps/items u unordered, o ordered, t task; other types usually empty. SQL codes differ from AST names such as NodeParagraph.

## Examples
Statistics: SELECT type, count(*) AS total FROM blocks GROUP BY type ORDER BY total DESC
Type and pagination: SELECT b.* FROM blocks b WHERE b.type='h' AND b.subtype='h2' ORDER BY b.updated DESC, b.id LIMIT 100 OFFSET 0
Direct children: SELECT b.* FROM blocks b WHERE b.parent_id='PARENT_BLOCK_ID' ORDER BY b.sort, b.id LIMIT 100
Inline code within any list ancestor (strict format check, one result per paragraph):

WITH RECURSIVE in_list(id) AS (
  SELECT id FROM blocks WHERE type='l'
  UNION
  SELECT b.id FROM blocks b JOIN in_list i ON b.parent_id=i.id
)
SELECT b.* FROM blocks b
WHERE b.type='p' AND b.id IN (SELECT id FROM in_list)
  AND EXISTS (SELECT 1 FROM spans s WHERE s.block_id=b.id
    AND (' ' || s.type || ' ') LIKE '% code %' AND s.content='fullscreen=1')
ORDER BY b.id LIMIT 100 OFFSET 0

Use EXISTS rather than a plain JOIN when multiple matching spans should produce only one block. Quote SQL string literals with single quotes and double any embedded single quote. Use UNION in recursive ancestry queries to deduplicate and bound revisits. Filter notebook/paths directly in SQL, for example b.box='NOTEBOOK_ID' or b.hpath LIKE '/Diary/%'.
`
