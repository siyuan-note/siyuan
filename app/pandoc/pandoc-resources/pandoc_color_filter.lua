function Span(el)
  local style = el.attributes.style
  if not style then return nil end

  -- 1. 提取 Hex 颜色 (支持 #FFF 和 #FFFFFF)
  local hex = style:match("color%s*:%s*#(%x+)")
  if not hex then return nil end
  if #hex == 3 then
    hex = hex:sub(1,1):rep(2) .. hex:sub(2,2):rep(2) .. hex:sub(3,3):rep(2)
  end

  -- 2. 提取文本内容并处理 XML 转义
  -- 使用 stringify 快速获取 span 内部所有纯文本（丢弃内部嵌套样式以换取稳定性）
  local txt = pandoc.utils.stringify(el.content)
  txt = txt:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')

  -- 3. 构造完整的 OpenXML 运行块 (Run)
  -- 这种结构 Word 识别率 100%，且不会产生标签嵌套冲突
  local run_xml = string.format(
    '<w:r><w:rPr><w:color w:val="%s"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>',
    hex:upper(), txt
  )

  return pandoc.RawInline('openxml', run_xml)
end