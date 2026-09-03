local CONSUMED_STYLE_PROPERTIES = {
  ["background"] = true,
  ["background-color"] = true,
  ["color"] = true,
  ["font-family"] = true
}

local INLINE_CONTAINERS = {
  Cite = true,
  Emph = true,
  Link = true,
  Quoted = true,
  SmallCaps = true,
  Span = true,
  Strikeout = true,
  Strong = true,
  Subscript = true,
  Superscript = true,
  Underline = true
}

local function trim(value)
  return value:gsub("^%s*(.-)%s*$", "%1")
end

local function strip_important(value)
  value = trim(value)
  local start = value:lower():find("%s*!%s*important%s*$")
  if start then
    value = trim(value:sub(1, start - 1))
  end
  return value
end

local function xml_escape(value)
  value = value:gsub("&", "&amp;")
  value = value:gsub("<", "&lt;")
  value = value:gsub(">", "&gt;")
  value = value:gsub('"', "&quot;")
  value = value:gsub("'", "&apos;")
  return value
end

local function split_css(value, separator)
  local parts = {}
  local quote
  local escaped = false
  local parentheses = 0
  local start = 1
  for index = 1, #value do
    local character = value:sub(index, index)
    if escaped then
      escaped = false
    elseif character == "\\" then
      escaped = true
    elseif quote then
      if character == quote then
        quote = nil
      end
    elseif character == '"' or character == "'" then
      quote = character
    elseif character == "(" then
      parentheses = parentheses + 1
    elseif character == ")" then
      parentheses = math.max(0, parentheses - 1)
    elseif character == separator and parentheses == 0 then
      table.insert(parts, value:sub(start, index - 1))
      start = index + 1
    end
  end
  table.insert(parts, value:sub(start))
  return parts
end

local function parse_style(style)
  local properties = {}
  for _, declaration in ipairs(split_css(style, ";")) do
    local key, value = declaration:match("^%s*([%w%-]+)%s*:%s*(.-)%s*$")
    if key and value then
      properties[key:lower()] = value
    end
  end
  return properties
end

local function remaining_style(style)
  if not style then
    return nil
  end
  local declarations = {}
  for _, declaration in ipairs(split_css(style, ";")) do
    local key = declaration:match("^%s*([%w%-]+)%s*:")
    if key and not CONSUMED_STYLE_PROPERTIES[key:lower()] then
      declaration = trim(declaration)
      if declaration ~= "" then
        table.insert(declarations, declaration)
      end
    end
  end
  if #declarations == 0 then
    return nil
  end
  return table.concat(declarations, "; ") .. ";"
end

-- 解析颜色字符串为 6 位大写十六进制（不带 #），支持颜色名、#hex、#rgb、rgb()/rgba()
local function parse_color(value)
  if not value then
    return nil
  end
  local compact = strip_important(value):gsub("%s+", "")
  local lower = compact:lower()
  local named = {
    red = "FF0000", blue = "0000FF", green = "008000",
    yellow = "FFFF00", orange = "FFA500", purple = "800080",
    black = "000000", white = "FFFFFF", gray = "808080", grey = "808080"
  }
  if named[lower] then
    return named[lower]
  end

  local hex6 = lower:match("^#(%x%x%x%x%x%x)$") or lower:match("^(%x%x%x%x%x%x)$")
  if hex6 then
    return hex6:upper()
  end
  local hex3 = lower:match("^#(%x%x%x)$") or lower:match("^(%x%x%x)$")
  if hex3 then
    local red = hex3:sub(1, 1)
    local green = hex3:sub(2, 2)
    local blue = hex3:sub(3, 3)
    return (red .. red .. green .. green .. blue .. blue):upper()
  end

  local red, green, blue = lower:match("^rgb%((%d+),(%d+),(%d+)%)$")
  if red and green and blue then
    local function hex(component)
      local number = math.max(0, math.min(255, tonumber(component) or 0))
      return string.format("%02X", number)
    end
    return hex(red) .. hex(green) .. hex(blue)
  end

  local alpha
  red, green, blue, alpha = lower:match("^rgba%((%d+),(%d+),(%d+),([%d%.]+)%)$")
  if red and green and blue and alpha then
    local opacity = math.max(0, math.min(1, tonumber(alpha) or 1))
    local function composite(component)
      local number = math.floor((opacity * (tonumber(component) or 0) + (1 - opacity) * 255) + 0.5)
      return string.format("%02X", math.max(0, math.min(255, number)))
    end
    return composite(red) .. composite(green) .. composite(blue)
  end
  return nil
end

local function normalize_font_family(value)
  local family = trim(value)
  if #family >= 2 then
    local first = family:sub(1, 1)
    local last = family:sub(-1)
    if (first == '"' and last == '"') or (first == "'" and last == "'") then
      family = family:sub(2, -2)
    end
  end
  return family:gsub("\\(.)", "%1")
end

local function selected_font_family(value)
  if not value then
    return nil
  end
  for _, item in ipairs(split_css(strip_important(value), ",")) do
    local family = normalize_font_family(item)
    local lower = family:lower()
    if lower:match("^var%s*%(%s*%-%-b3%-font%-family%-editor%s*%)$") then
      return nil
    end
    if family ~= "" and lower ~= "emojis additional" and lower ~= "emojis reset" and
      lower ~= "inherit" and lower ~= "initial" and lower ~= "unset" and lower ~= "revert" and
      lower ~= "revert-layer" and not lower:match("^var%s*%(") then
      return family
    end
  end
  return nil
end

local function set_parsed_property(properties, key, raw_value, parser, inherited)
  if raw_value == nil then
    return false
  end
  local value = strip_important(raw_value)
  local lower = value:lower()
  if lower == "inherit" or (inherited and lower == "unset") then
    return true
  end
  properties[key] = parser(value) or false
  return true
end

local function span_properties(style)
  if not style then
    return nil
  end
  local css = parse_style(style)
  local properties = {}
  local consumed = false
  consumed = set_parsed_property(properties, "font_family", css["font-family"], selected_font_family, true) or consumed
  consumed = set_parsed_property(properties, "text_color", css["color"], parse_color, true) or consumed
  local background = css["background-color"]
  if background == nil then
    background = css["background"]
  end
  consumed = set_parsed_property(properties, "background_color", background, parse_color, false) or consumed
  if not consumed then
    return nil
  end
  return properties
end

local function copy_properties(properties)
  local copy = {}
  for key, value in pairs(properties) do
    copy[key] = value
  end
  return copy
end

local function merge_properties(parent, child)
  local merged = copy_properties(parent)
  if child then
    for key, value in pairs(child) do
      merged[key] = value
    end
  end
  return merged
end

local function run_properties_xml(properties)
  local xml = ""
  if properties.code then
    xml = xml .. '<w:rStyle w:val="VerbatimChar"/>'
  elseif properties.hyperlink then
    xml = xml .. '<w:rStyle w:val="Hyperlink"/>'
  end
  if properties.font_family then
    local family = xml_escape(properties.font_family)
    xml = xml .. '<w:rFonts w:ascii="' .. family .. '" w:hAnsi="' .. family ..
      '" w:eastAsia="' .. family .. '" w:cs="' .. family .. '"/>'
  end
  if properties.bold then
    xml = xml .. "<w:b/><w:bCs/>"
  end
  if properties.italic then
    xml = xml .. "<w:i/><w:iCs/>"
  end
  if properties.small_caps then
    xml = xml .. "<w:smallCaps/>"
  end
  if properties.strikeout then
    xml = xml .. "<w:strike/>"
  end
  if properties.text_color then
    xml = xml .. '<w:color w:val="' .. properties.text_color .. '"/>'
  end
  if properties.underline then
    xml = xml .. '<w:u w:val="single"/>'
  end
  if properties.background_color then
    xml = xml .. '<w:shd w:val="clear" w:color="auto" w:fill="' .. properties.background_color .. '"/>'
  end
  if properties.vertical_align then
    xml = xml .. '<w:vertAlign w:val="' .. properties.vertical_align .. '"/>'
  end
  return xml
end

local function text_run(text, properties)
  text = text:gsub("\r\n", "\n"):gsub("\r", "\n")
  local preserve = text:match("^%s") or text:match("%s$") or text:match("  ")
  local space_attribute = preserve and ' xml:space="preserve"' or ""
  local xml = '<w:r><w:rPr>' .. run_properties_xml(properties) .. '</w:rPr><w:t' .. space_attribute .. '>' ..
    xml_escape(text) .. '</w:t></w:r>'
  return pandoc.RawInline("openxml", xml)
end

local function break_run(properties)
  local xml = '<w:r><w:rPr>' .. run_properties_xml(properties) .. '</w:rPr><w:br/></w:r>'
  return pandoc.RawInline("openxml", xml)
end

local function has_attributes(attributes)
  for _ in pairs(attributes) do
    return true
  end
  return false
end

local function preserve_span(element, content)
  element.content = pandoc.Inlines(content)
  element.attributes.style = remaining_style(element.attributes.style)
  if element.identifier == "" and #element.classes == 0 and not has_attributes(element.attributes) then
    return element.content
  end
  return {element}
end

local function has_class(element, name)
  for _, class_name in ipairs(element.classes) do
    if class_name == name then
      return true
    end
  end
  return false
end

local transform_inlines

local function transform_inline(inline, properties)
  local inline_type = inline.t
  if inline_type == "Str" then
    return {text_run(inline.text, properties)}
  elseif inline_type == "Space" or inline_type == "SoftBreak" then
    return {text_run(" ", properties)}
  elseif inline_type == "LineBreak" then
    return {break_run(properties)}
  elseif inline_type == "Code" then
    local code_properties = copy_properties(properties)
    code_properties.code = true
    code_properties.font_family = false
    return {text_run(inline.text, code_properties)}
  elseif inline_type == "Strong" or inline_type == "Emph" or inline_type == "Underline" or
    inline_type == "Strikeout" or inline_type == "Superscript" or inline_type == "Subscript" or
    inline_type == "SmallCaps" then
    local semantic_properties = copy_properties(properties)
    if inline_type == "Strong" then
      semantic_properties.bold = true
    elseif inline_type == "Emph" then
      semantic_properties.italic = true
    elseif inline_type == "Underline" then
      semantic_properties.underline = true
    elseif inline_type == "Strikeout" then
      semantic_properties.strikeout = true
    elseif inline_type == "Superscript" then
      semantic_properties.vertical_align = "superscript"
    elseif inline_type == "Subscript" then
      semantic_properties.vertical_align = "subscript"
    elseif inline_type == "SmallCaps" then
      semantic_properties.small_caps = true
    end
    return transform_inlines(inline.content, semantic_properties)
  elseif inline_type == "Quoted" then
    local quote_type = tostring(inline.quotetype):lower()
    local opening = quote_type:find("single", 1, true) and utf8.char(0x2018) or utf8.char(0x201C)
    local closing = quote_type:find("single", 1, true) and utf8.char(0x2019) or utf8.char(0x201D)
    local quoted = {text_run(opening, properties)}
    for _, item in ipairs(transform_inlines(inline.content, properties)) do
      table.insert(quoted, item)
    end
    table.insert(quoted, text_run(closing, properties))
    return quoted
  elseif inline_type == "Link" then
    local link_properties = copy_properties(properties)
    link_properties.hyperlink = true
    inline.content = pandoc.Inlines(transform_inlines(inline.content, link_properties))
    return {inline}
  elseif inline_type == "Span" then
    local nested_properties = merge_properties(properties, span_properties(inline.attributes.style))
    if properties.suppress_font_family or has_class(inline, "kbd") then
      nested_properties.font_family = false
      nested_properties.suppress_font_family = true
    end
    return preserve_span(inline, transform_inlines(inline.content, nested_properties))
  elseif inline_type == "Cite" then
    inline.content = pandoc.Inlines(transform_inlines(inline.content, properties))
  end
  return {inline}
end

transform_inlines = function(inlines, properties)
  local transformed = {}
  for _, inline in ipairs(inlines) do
    for _, item in ipairs(transform_inline(inline, properties)) do
      table.insert(transformed, item)
    end
  end
  return transformed
end

function Span(element)
  local properties = span_properties(element.attributes.style)
  if not properties then
    return nil
  end
  return preserve_span(element, transform_inlines(element.content, properties))
end

local function insert_after_pattern(value, pattern, insertion)
  local _, finish = value:find(pattern)
  if not finish then
    return nil
  end
  return value:sub(1, finish) .. insertion .. value:sub(finish + 1)
end

local function insert_before_pattern(value, pattern, insertion)
  local start = value:find(pattern)
  if not start then
    return nil
  end
  return value:sub(1, start - 1) .. insertion .. value:sub(start)
end

local function insert_run_property(value, property_xml, position)
  if position == "after-fonts" then
    return insert_after_pattern(value, "<w:rFonts [^>]-/>", property_xml) or
      insert_after_pattern(value, "<w:rStyle [^>]-/>", property_xml) or
      insert_after_pattern(value, "<w:rPr>", property_xml)
  elseif position == "after-bold" then
    return insert_after_pattern(value, "<w:bCs/>", property_xml) or
      insert_after_pattern(value, "<w:b/>", property_xml) or
      insert_run_property(value, property_xml, "after-fonts")
  elseif position == "before-color" then
    return insert_before_pattern(value, "<w:color ", property_xml) or
      insert_before_pattern(value, "<w:u ", property_xml) or
      insert_before_pattern(value, "<w:shd ", property_xml) or
      insert_before_pattern(value, "<w:vertAlign ", property_xml) or
      insert_before_pattern(value, "</w:rPr>", property_xml)
  elseif position == "before-shading" then
    return insert_before_pattern(value, "<w:shd ", property_xml) or
      insert_before_pattern(value, "<w:vertAlign ", property_xml) or
      insert_before_pattern(value, "</w:rPr>", property_xml)
  end
  return insert_before_pattern(value, "</w:rPr>", property_xml)
end

local function augment_raw_runs(inlines, property_xml, marker, position)
  for _, inline in ipairs(inlines) do
    if inline.t == "RawInline" and inline.format == "openxml" and
      inline.text:find("<w:r><w:rPr>", 1, true) and not inline.text:find(marker, 1, true) then
      inline.text = insert_run_property(inline.text, property_xml, position)
    elseif INLINE_CONTAINERS[inline.t] then
      augment_raw_runs(inline.content, property_xml, marker, position)
    end
  end
end

local function preserve_semantic_runs(element, property_xml, marker, position)
  augment_raw_runs(element.content, property_xml, marker, position)
  return element
end

local function preserve_link_runs(element)
  local function apply_hyperlink_style(inlines)
    for _, inline in ipairs(inlines) do
      if inline.t == "RawInline" and inline.format == "openxml" and
        inline.text:find("<w:r><w:rPr>", 1, true) and not inline.text:find("<w:rStyle ", 1, true) then
        inline.text = inline.text:gsub("<w:rPr>", '<w:rPr><w:rStyle w:val="Hyperlink"/>', 1)
      elseif INLINE_CONTAINERS[inline.t] then
        apply_hyperlink_style(inline.content)
      end
    end
  end
  apply_hyperlink_style(element.content)
  return element
end

-- 样式 Span 位于 strong 或链接内部时，Pandoc 不会把外层语义应用到原始 OpenXML，需要再补到各个 run
return {
  {traverse = "topdown", Span = Span},
  {
    Strong = function(element)
      return preserve_semantic_runs(element, "<w:b/><w:bCs/>", "<w:b/>", "after-fonts")
    end,
    Emph = function(element)
      return preserve_semantic_runs(element, "<w:i/><w:iCs/>", "<w:i/>", "after-bold")
    end,
    Underline = function(element)
      return preserve_semantic_runs(element, '<w:u w:val="single"/>', "<w:u ", "before-shading")
    end,
    Strikeout = function(element)
      return preserve_semantic_runs(element, "<w:strike/>", "<w:strike/>", "before-color")
    end,
    Superscript = function(element)
      return preserve_semantic_runs(element, '<w:vertAlign w:val="superscript"/>', "<w:vertAlign ", "end")
    end,
    Subscript = function(element)
      return preserve_semantic_runs(element, '<w:vertAlign w:val="subscript"/>', "<w:vertAlign ", "end")
    end,
    SmallCaps = function(element)
      return preserve_semantic_runs(element, "<w:smallCaps/>", "<w:smallCaps/>", "before-color")
    end,
    Link = preserve_link_runs
  }
}
