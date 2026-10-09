// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License v3.0.

package tools

// markdownContentSyntax 统一各内容写入工具的 Markdown 语法说明。
const markdownContentSyntax = `SiYuan Markdown syntax:
- Prefer standard Markdown for ordinary blocks and inline formatting: **bold**, *italic*, ~~strikethrough~~, ==mark==, and backticks for inline code.
- Block references must include anchor text. Use ((<blockID> "<static anchor text>")) for fixed text, required whenever the anchor text differs from the referenced block's content. Use ((<blockID> '<dynamic anchor text>')) for text that follows the target block's content, only when the anchor text is the target block's own content. Never use ((<blockID>)) or [[<blockID>]]. These forms are for note content; use normal SiYuan links in chat responses.

Super-block Markdown:
Prefer Markdown for creating super-blocks. Despite the token names, col is horizontal and row is vertical; never infer the visual direction from the English token alone. A horizontal super-block with two paragraphs is:
{{{col

first paragraph

second paragraph

}}}
Use {{{row for a vertical super-block. Separate child blocks with blank lines and put }}} on its own line.

Text marks:
- For color, background, or font size, use a span with a leading data-type="text" attribute. Examples: <span data-type="text" style="color: #ff0000;">red text</span>, <span data-type="text" style="background-color: #ffff00;">highlighted</span>, <span data-type="text" style="font-size: 18px;">larger text</span>, <span data-type="text" style="color: #ff0000; font-size: 18px;">red and large</span>.
- Combine mark types in data-type, not in CSS: <span data-type="text strong" style="color: #ff0000;">bold red</span>, <span data-type="text em" style="background-color: #ffff00;">italic highlighted</span>.
- Prefer semantic data-type marks over equivalent CSS: <span data-type="u">underlined</span>, x<span data-type="sup">2</span>, H<span data-type="sub">2</span>O, <span data-type="kbd">Ctrl</span>, <span data-type="tag">todo</span>. These are native editor marks, convertible to/from Markdown and queryable.
- Never fake marks with CSS such as text-decoration, vertical-align, font-weight, or font-style, or use a bare <kbd>. Never write a bare <span style="..."> without data-type; it renders as escaped literal text. Prefer standard Markdown when no color or size is needed.

Rendered HTML blocks:
Use a NodeHTMLBlock for rendered HTML, such as ruby annotations or styled containers. In Markdown, start the block with a bare <div opening tag on its own line; wrap other roots (p, table, section, ruby, etc.) in <div>...</div> so the parser recognizes an HTML block instead of an escaped paragraph. Example:
<div>
<ruby>你<rt>nǐ</rt></ruby>
</div>
Do not use an html code fence for rendered HTML: it creates a NodeCodeBlock that displays source code instead.`
