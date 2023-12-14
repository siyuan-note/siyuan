// https://cdn.jsdelivr.net/npm/highlightjs-solidity@2.0.5/dist/yul.min.js
hljs.registerLanguage("yul",(()=>{"use strict";function e(){try{return!0
}catch(e){return!1}}
  var a=/-?(\b0[xX]([a-fA-F0-9]_?)*[a-fA-F0-9]|(\b[1-9](_?\d)*(\.((\d_?)*\d)?)?|\.\d(_?\d)*)([eE][-+]?\d(_?\d)*)?|\b0)(?!\w|\$)/
  ;e()&&(a=a.source.replace(/\\b/g,"(?<!\\$)\\b"));var s={className:"number",
    begin:a,relevance:0},t={
    keyword:"assembly let function if switch case default for leave break continue u256 jump jumpi stop return revert selfdestruct invalid",
    built_in:"add sub mul div sdiv mod smod exp not lt gt slt sgt eq iszero and or xor byte shl shr sar addmod mulmod signextend keccak256 pc pop dup1 dup2 dup3 dup4 dup5 dup6 dup7 dup8 dup9 dup10 dup11 dup12 dup13 dup14 dup15 dup16 swap1 swap2 swap3 swap4 swap5 swap6 swap7 swap8 swap9 swap10 swap11 swap12 swap13 swap14 swap15 swap16 mload mstore mstore8 sload sstore msize gas address balance selfbalance caller callvalue calldataload calldatasize calldatacopy codesize codecopy extcodesize extcodecopy returndatasize returndatacopy extcodehash create create2 call callcode delegatecall staticcall log0 log1 log2 log3 log4 chainid origin gasprice basefee blockhash coinbase timestamp number difficulty gaslimit",
    literal:"true false"},i={className:"string",
    begin:/\bhex'(([0-9a-fA-F]{2}_?)*[0-9a-fA-F]{2})?'/},l={className:"string",
    begin:/\bhex"(([0-9a-fA-F]{2}_?)*[0-9a-fA-F]{2})?"/};function d(e){
    return e.inherit(e.APOS_STRING_MODE,{begin:/(\bunicode)?'/})}function r(e){
    return e.inherit(e.QUOTE_STRING_MODE,{begin:/(\bunicode)?"/})}var n={
    SOL_ASSEMBLY_KEYWORDS:t,baseAssembly:e=>{
      var a=d(e),n=r(e),o=/[A-Za-z_$][A-Za-z_$0-9.]*/,c=e.inherit(e.TITLE_MODE,{
        begin:/[A-Za-z$_][0-9A-Za-z$_]*/,lexemes:o,keywords:t}),u={className:"params",
        begin:/\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,lexemes:o,keywords:t,
        contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,a,n,s]},b={
        className:"operator",begin:/:=|->/};return{keywords:t,lexemes:o,
        contains:[a,n,i,l,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,s,b,{
          className:"function",lexemes:o,beginKeywords:"function",end:"{",excludeEnd:!0,
          contains:[c,u,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,b]}]}},
    solAposStringMode:d,solQuoteStringMode:r,HEX_APOS_STRING_MODE:i,
    HEX_QUOTE_STRING_MODE:l,SOL_NUMBER:s,isNegativeLookbehindAvailable:e}
  ;const{SOL_ASSEMBLY_KEYWORDS:o,baseAssembly:c,isNegativeLookbehindAvailable:u}=n
  ;return e=>{var a={keyword:o.keyword+" object code data",
    built_in:o.built_in+" datasize dataoffset datacopy setimmutable loadimmutable linkersymbol memoryguard",
    literal:o.literal},s=/\bverbatim_[1-9]?[0-9]i_[1-9]?[0-9]o\b(?!\$)/
  ;u()&&(s=s.source.replace(/\\b/,"(?<!\\$)\\b"));var t={className:"built_in",
    begin:s},i=c(e);return e.inherit(i,{keywords:a,contains:i.contains.concat([t])})
  }})());

// https://cdn.jsdelivr.net/npm/highlightjs-solidity@2.0.5/dist/solidity.min.js
hljs.registerLanguage("solidity",(()=>{"use strict";function e(){try{return!0
}catch(e){return!1}}
  var a=/-?(\b0[xX]([a-fA-F0-9]_?)*[a-fA-F0-9]|(\b[1-9](_?\d)*(\.((\d_?)*\d)?)?|\.\d(_?\d)*)([eE][-+]?\d(_?\d)*)?|\b0)(?!\w|\$)/
  ;e()&&(a=a.source.replace(/\\b/g,"(?<!\\$)\\b"));var s={className:"number",
    begin:a,relevance:0},n={
    keyword:"assembly let function if switch case default for leave break continue u256 jump jumpi stop return revert selfdestruct invalid",
    built_in:"add sub mul div sdiv mod smod exp not lt gt slt sgt eq iszero and or xor byte shl shr sar addmod mulmod signextend keccak256 pc pop dup1 dup2 dup3 dup4 dup5 dup6 dup7 dup8 dup9 dup10 dup11 dup12 dup13 dup14 dup15 dup16 swap1 swap2 swap3 swap4 swap5 swap6 swap7 swap8 swap9 swap10 swap11 swap12 swap13 swap14 swap15 swap16 mload mstore mstore8 sload sstore msize gas address balance selfbalance caller callvalue calldataload calldatasize calldatacopy codesize codecopy extcodesize extcodecopy returndatasize returndatacopy extcodehash create create2 call callcode delegatecall staticcall log0 log1 log2 log3 log4 chainid origin gasprice basefee blockhash coinbase timestamp number difficulty gaslimit",
    literal:"true false"},i={className:"string",
    begin:/\bhex'(([0-9a-fA-F]{2}_?)*[0-9a-fA-F]{2})?'/},t={className:"string",
    begin:/\bhex"(([0-9a-fA-F]{2}_?)*[0-9a-fA-F]{2})?"/};function r(e){
    return e.inherit(e.APOS_STRING_MODE,{begin:/(\bunicode)?'/})}function l(e){
    return e.inherit(e.QUOTE_STRING_MODE,{begin:/(\bunicode)?"/})}var o={
    SOL_ASSEMBLY_KEYWORDS:n,baseAssembly:e=>{
      var a=r(e),o=l(e),c=/[A-Za-z_$][A-Za-z_$0-9.]*/,d=e.inherit(e.TITLE_MODE,{
        begin:/[A-Za-z$_][0-9A-Za-z$_]*/,lexemes:c,keywords:n}),u={className:"params",
        begin:/\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,lexemes:c,keywords:n,
        contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,a,o,s]},_={
        className:"operator",begin:/:=|->/};return{keywords:n,lexemes:c,
        contains:[a,o,i,t,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,s,_,{
          className:"function",lexemes:c,beginKeywords:"function",end:"{",excludeEnd:!0,
          contains:[d,u,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,_]}]}},
    solAposStringMode:r,solQuoteStringMode:l,HEX_APOS_STRING_MODE:i,
    HEX_QUOTE_STRING_MODE:t,SOL_NUMBER:s,isNegativeLookbehindAvailable:e}
  ;const{baseAssembly:c,solAposStringMode:d,solQuoteStringMode:u,HEX_APOS_STRING_MODE:_,HEX_QUOTE_STRING_MODE:m,SOL_NUMBER:b,isNegativeLookbehindAvailable:g}=o
  ;return e=>{for(var a=d(e),s=u(e),n=[],i=0;i<32;i++)n[i]=i+1
  ;var t=n.map((e=>8*e)),r=[];for(i=0;i<=80;i++)r[i]=i
  ;var l=n.map((e=>"bytes"+e)).join(" ")+" ",o=t.map((e=>"uint"+e)).join(" ")+" ",E=t.map((e=>"int"+e)).join(" ")+" ",M=[].concat.apply([],t.map((e=>r.map((a=>e+"x"+a))))),p={
    keyword:"var bool string int uint "+E+o+"byte bytes "+l+"fixed ufixed "+M.map((e=>"fixed"+e)).join(" ")+" "+M.map((e=>"ufixed"+e)).join(" ")+" enum struct mapping address new delete if else for while continue break return throw emit try catch revert unchecked _ function modifier event constructor fallback receive error virtual override constant immutable anonymous indexed storage memory calldata external public internal payable pure view private returns import from as using global pragma contract interface library is abstract type assembly",
    literal:"true false wei gwei szabo finney ether seconds minutes hours days weeks years",
    built_in:"self this super selfdestruct suicide now msg block tx abi blockhash gasleft assert require Error Panic sha3 sha256 keccak256 ripemd160 ecrecover addmod mulmod log0 log1 log2 log3 log4"
  },O={className:"operator",begin:/[+\-!~*\/%<>&^|=]/
  },C=/[A-Za-z_$][A-Za-z_$0-9]*/,N={className:"params",begin:/\(/,end:/\)/,
    excludeBegin:!0,excludeEnd:!0,lexemes:C,keywords:p,
    contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,a,s,b,"self"]},f={
    begin:/\.\s*/,end:/[^A-Za-z0-9$_\.]/,excludeBegin:!0,excludeEnd:!0,keywords:{
      built_in:"gas value selector address length push pop send transfer call callcode delegatecall staticcall balance code codehash wrap unwrap name creationCode runtimeCode interfaceId min max"
    },relevance:2},y=e.inherit(e.TITLE_MODE,{begin:/[A-Za-z$_][0-9A-Za-z$_]*/,
    lexemes:C,keywords:p}),w={className:"built_in",
    begin:(g()?"(?<!\\$)\\b":"\\b")+"(gas|value|salt)(?=:)"};function x(e,a){return{
    begin:(g()?"(?<!\\$)\\b":"\\b")+e+"\\.\\s*",end:/[^A-Za-z0-9$_\.]/,
    excludeBegin:!1,excludeEnd:!0,lexemes:C,keywords:{built_in:e+" "+a},
    contains:[f],relevance:10}}var h=c(e),v=e.inherit(h,{
    contains:h.contains.concat([{begin:/\./,end:/[^A-Za-z0-9$.]/,excludeBegin:!0,
      excludeEnd:!0,keywords:{built_in:"slot offset length address selector"},
      relevance:2},{begin:/_/,end:/[^A-Za-z0-9$.]/,excludeBegin:!0,excludeEnd:!0,
      keywords:{built_in:"slot offset"},relevance:2}])});return{aliases:["sol"],
    keywords:p,lexemes:C,
    contains:[a,s,_,m,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,b,w,O,{
      className:"function",lexemes:C,
      beginKeywords:"function modifier event constructor fallback receive error",
      end:/[{;]/,excludeEnd:!0,
      contains:[y,N,w,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:/%/
    },x("msg","gas value data sender sig"),x("block","blockhash coinbase difficulty gaslimit basefee number timestamp chainid"),x("tx","gasprice origin"),x("abi","decode encode encodePacked encodeWithSelector encodeWithSignature encodeCall"),x("bytes","concat"),x("string","concat"),f,{
      className:"class",lexemes:C,beginKeywords:"contract interface library",end:"{",
      excludeEnd:!0,illegal:/[:"\[\]]/,contains:[{beginKeywords:"is",lexemes:C
      },y,N,w,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{lexemes:C,
      beginKeywords:"struct enum",end:"{",excludeEnd:!0,illegal:/[:"\[\]]/,
      contains:[y,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{
      beginKeywords:"import",end:";",lexemes:C,keywords:"import from as",
      contains:[y,a,s,_,m,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,O]},{
      beginKeywords:"using",end:";",lexemes:C,keywords:"using for global",
      contains:[y,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,O]},{className:"meta",
      beginKeywords:"pragma",end:";",lexemes:C,keywords:{
        keyword:"pragma solidity experimental abicoder",
        built_in:"ABIEncoderV2 SMTChecker v1 v2"},
      contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,e.inherit(a,{
        className:"meta-string"}),e.inherit(s,{className:"meta-string"})]},{
      beginKeywords:"assembly",end:/\b\B/,
      contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,e.inherit(a,{
        className:"meta-string"}),e.inherit(s,{className:"meta-string"}),e.inherit(v,{
        begin:"{",end:"}",endsParent:!0,contains:v.contains.concat([e.inherit(v,{
          begin:"{",end:"}",contains:v.contains.concat(["self"])})])})]}],illegal:/#/}}
})());

// https://cdn.jsdelivr.net/npm/highlightjs-sap-abap@0.2.0/dist/abap.min.js
hljs.registerLanguage("abap",(()=>{"use strict";return E=>({case_insensitive:!0,
  aliases:["sap-abap","abap"],keywords:{
    keyword:"ABBREVIATED ABS ABSTRACT ABSTRACTFINAL ACCEPT ACCEPTING ACCORDING ACOS ACTUAL ADD|0 ADD-CORRESPONDING ADDITIONS ADJACENT AFTER|0 ALIASES ALL|0 ALLOCATE ANALYZER AND|0 APPEND APPENDING AS|0 ASCENDING DESCENDING ASIN ASSIGN ASSIGNING ATAN ATTRIBUTE AUTHORITY-CHECK AVG|0 BACK|0 BACKGOUND BEFORE BETWEEN BINARY BIT BLANK|0 BLOCK BREAK-POINT BUFFER BY|0 BYPASSING BYTE|0 BYTECHARACTER CALL|0 CASTING CEIL|0 CENTERED CHANGE CHANGING CHARACTER CHECK CHECKBOX CLASS-DATA CLASS-EVENTS CLASS-METHODS CLEANUP CLEAR|0 CLASS ENDCLASS CLIENT CLOCK|0 CLOSE|0 COL_BACKGROUND COL_HEADING COL_NORMAL COL_TOTAL COLLECT|0 COLOR|0 COLUMN COMMENT COMMIT COMMON COMMUNICATION COMPARING COMPONENT COMPONENTS COMPUTE CONCATENATE CONDENSE CONSTANTS CONTEXT CONTEXTS CONTINUE|0 CONTROL CONTROLS CONVERSION CONVERT COS COSH COUNT|0 COUNTRY COUNTY CREATE CURRENCY CURRENT CURSOR CUSTOMER-FUNCTION DATA DATABASE DATASET DATE DEALLOCATE DECIMALS DEFAULT DEFERRED DEFINE DEFINING DEFINITION DELETE DELETING DEMAND DESCENDING DESCRIBE DESTINATION DIALOG DIRECTORY DISTANCE DISTINCT DIVIDE DIVIDE-CORRESPONDING DUPLICATE DUPLICATES DURING DYNAMIC EDIT EDITOR-CALL ELSE ELSEIF ENCODING ENDING ENDON ENTRIES ERRORS EVENT EVENTS EXCEPTION EXCEPTIONS EXCEPTION-TABLE EXCLUDE EXCLUDING EXIT EXIT-COMMAND EXPORT EXPORTING EXTENDED EXTENSION EXTRACT FETCH FIELD FIELD-GROUPS FIELDSNO FIELD-SYMBOLS FILTER FINAL FIND|0 FIRST FLOOR FOR|0 FORMAT FORWARDBACKWARD FOUND FRAC FRAME FREE|0 FRIENDS FROM FUNCTION-POOL GET|0 GIVING GROUP HANDLER HASHED HAVING HEADER HEADING HELP-ID HIDE|0 HIGHLOW HOLD|0 HOTSPOT ICON IGNORING IMMEDIATELY IMPLEMENTATION IMPORT IMPORTING IN INCLUDE|0 INCREMENT INDEX|0 INDEX-LINE INHERITING INIT INITIAL INITIALIZATION INNER INNERLEFT INSERT INSTANCES INTENSIFIED INTERFACES INTERVALS INTO INVERTED-DATE IS|0 ITAB JOIN KEEPING KEY|0 KEYS KIND LANGUAGE LAST|0 LEADING LEAVE LEFT LEFT-JUSTIFIED LEFTRIGHT LEFTRIGHTCIRCULAR LEGACY LENGTH LIKE LINE LINE-COUNT LINES LINE-SELECTION LINE-SIZE LIST LIST-PROCESSING LOAD LOAD-OF-PROGRAM LOCAL LOCALE LOG LOG10 LOWER MARGIN MARK MASK MATCH MAX MAXIMUM MEMORY|0 MESSAGE MESSAGE-ID MESSAGES METHODS MIN MOD MODE MODEIN MODIF MODIFIER MODIFY MOVE MOVE-CORRESPONDING MULTIPLY MULTIPLY-CORRESPONDING NEW|0 NEW-LINE NEW-PAGE NEXT|0 NODES NODETABLE NO-DISPLAY NO-GAP NO-GAPS NO-HEADINGWITH-HEADING NO-SCROLLING NO-SCROLLINGSCROLLING NOT|0 NO-TITLE WITH-TITLE NO-ZERO NP NS NUMBER OBJECT|0 OBLIGATORY OCCURENCE OCCURENCES OCCURS OF|0 OFF|0 OFFSET ON|0 ONLY|0 OPEN OPTION OPTIONAL OR|0 ORDER OTHERS|0 OUTER OUTPUT-LENGTH OVERLAY PACK PACKAGE PAGE PAGELAST PAGEOF PAGEPAGE PAGES PARAMETER PARAMETERS PARAMETER-TABLE PART PERFORM PERFORMING PFN PF-STATUS PLACES POS_HIGH POS_LOW POSITION POSITIONS PRIMARY PRINT PRINT-CONTROL PRIVATE PROCESS PROGRAM PROPERTY PROTECTED PUBLIC PUSHBUTTON PUT QUICKINFO RADIOBUTTON RAISE|0 RAISING RANGE RANGES READ RECEIVE RECEIVING REDEFINITION REF REFERENCE REFRESH REJECT RENAMING REPLACE REPLACEMENT REPORT RESERVE RESET RESOLUTION RESULTS RETURN|0 RETURNING RIGHT RIGHT-JUSTIFIED ROLLBACK ROWS RUN SCAN SCREEN SCREEN-GROUP1 SCREEN-GROUP2 SCREEN-GROUP3 SCREEN-GROUP4 SCREEN-GROUP5 SCREEN-INPUT SCREEN-INTENSIFIED SCROLL SCROLL-BOUNDARY SEARCH SECTION SELECT SELECTION SELECTIONS SELECTION-SCREEN SELECTION-SET SELECTION-TABLE SELECT-OPTIONS SEND|0 SEPARATED SET|0 SHARED SHIFT SIGN SIN SINGLE SINGLEDISTINCT SINH SIZE|0 SKIP SORT|0 SORTABLE SPECIFIED SPLIT SQL|0 SQRT STABLE STAMP STANDARD|0 START|0 STARTING STATICS STEP-LOOP STOP STRLEN STRUCTURE|0 SUBMIT SUBTRACT SUBTRACT-CORRESPONDING SUFFIX SUM SUPPLY SUPPRESS SYMBOLS SYSTEM-EXCEPTIONS TABLE|0 TABLENAME TABLES TABLEVIEW TAN TANH TASK TEXT THEN|0 TIME|0 TIMES TITLE TITLEBAR TO TOPIC TOP-OF-PAGE TRAILING TRANSACTION TRANSFER TRANSLATE TRUNC TYPE TYPELIKE TYPE-POOL TYPE-POOLS TYPES ULINE UNION UNIQUE UNIT UNTIL|0 UP|0 UPDATE|0 UPPER UPPERLOWER USER-COMMAND USING VALUE|0 VALUES VARY VARYING VERSION VIA WAIT WHEN WHERE WINDOW WITH|0 WORK|0 WRITE|0 XSTRLEN ZONECA CN CO CP CS EQ GE GT LE LT NA NESTART-OF-SELECTION START-OF-PAGE END-OF-PAGE END-OF-SELECTION AT ENDAT",
    literal:"abap_true abap_false",
    built_in:"DO FORM IF LOOP MODULE START-OF_FILE DEFINE WHILE BEGIN ENDDO ENDFORM|10 ENDIF ENDLOOP ENDMODULE END-OF_FILE END-OF-DEFINITION ENDWHILE END METHOD ENDMETHOD|10 CHAIN ENDCHAIN CASE ENDCASE FUNCTION ENDFUNCTION ELSEIF ELSE TRY ENDTRY|10 CATCH "
  },contains:[E.APOS_STRING_MODE,E.NUMBER_MODE,{className:"comment",begin:"^[*]",
    relevance:0,end:"\n"},{className:"comment",begin:'\b*"',relevance:0,end:"\n"}]})
})());

// https://github.com/highlightjs/highlightjs-hlsl/blob/master/dist/hlsl.min.js
hljs.registerLanguage("hlsl",(()=>{"use strict";const e={className:"number",
  begin:"(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?([hHfFlL]?)|\\.\\d+)([eE][-+]?\\d+)?([hHfFlL]?))",
  relevance:0};return r=>{
  let t=["","1","2","3","4","1x1","1x2","1x3","1x4","2x1","2x2","2x3","2x4","3x1","3x2","3x3","3x4","4x1","4x2","4x3","4x4"],a=[]
  ;for(let e of"bool double float half int uint min16float min10float min16int min12int min16uint".split(" "))for(let r of t)a.push(e+r)
  ;let s="SV_Coverage SV_Depth SV_DispatchThreadID SV_DomainLocation SV_GroupID SV_GroupIndex SV_GroupThreadID SV_GSInstanceID SV_InnerCoverage SV_InsideTessFactor SV_InstanceID SV_IsFrontFace SV_OutputControlPointID SV_Position SV_PrimitiveID SV_RenderTargetArrayIndex SV_SampleIndex SV_StencilRef SV_TessFactor SV_VertexID SV_ViewportArrayIndex, SV_ShadingRate",o="BINORMAL BLENDINDICES BLENDWEIGHT COLOR NORMAL POSITION PSIZE TANGENT TEXCOORD TESSFACTOR DEPTH SV_ClipDistance SV_CullDistance SV_DepthGreaterEqual SV_DepthLessEqual SV_Target SV_CLIPDISTANCE SV_CULLDISTANCE SV_DEPTHGREATEREQUAL SV_DEPTHLESSEQUAL SV_TARGET",n=o.split(" ")
  ;for(let e of o.split(" "))for(let r of Array(16).keys())n.push(e+r.toString())
  ;return{name:"HLSL",keywords:{
      keyword:"AppendStructuredBuffer asm asm_fragment BlendState break Buffer ByteAddressBuffer case cbuffer centroid class column_major compile compile_fragment CompileShader const continue ComputeShader ConsumeStructuredBuffer default DepthStencilState DepthStencilView discard do DomainShader dword else export extern false for fxgroup GeometryShader groupshared Hullshader if in inline inout InputPatch interface line lineadj linear LineStream matrix namespace nointerpolation noperspective NULL out OutputPatch packoffset pass pixelfragment PixelShader point PointStream precise RasterizerState RenderTargetView return register row_major RWBuffer RWByteAddressBuffer RWStructuredBuffer RWTexture1D RWTexture1DArray RWTexture2D RWTexture2DArray RWTexture3D sample sampler SamplerState SamplerComparisonState shared snorm stateblock stateblock_state static string struct switch StructuredBuffer tbuffer technique technique10 technique11 texture Texture1D Texture1DArray Texture2D Texture2DArray Texture2DMS Texture2DMSArray Texture3D TextureCube TextureCubeArray true typedef triangle triangleadj TriangleStream uint uniform unorm unsigned vector vertexfragment VertexShader void volatile while",
      type:a.join(" ")+" Buffer vector matrix sampler SamplerState PixelShader VertexShader texture Texture1D Texture1DArray Texture2D Texture2DArray Texture2DMS Texture2DMSArray Texture3D TextureCube TextureCubeArray struct typedef",
      built_in:"POSITIONT FOG PSIZE VFACE VPOS "+n.join(" ")+" "+s+" "+s.toUpperCase()+" abort abs acos all AllMemoryBarrier AllMemoryBarrierWithGroupSync any asdouble asfloat asin asint asuint atan atan2 ceil CheckAccessFullyMapped clamp clip cos cosh countbits cross D3DCOLORtoUBYTE4 ddx ddx_coarse ddx_fine ddy ddy_coarse ddy_fine degrees determinant DeviceMemoryBarrier DeviceMemoryBarrierWithGroupSync distance dot dst errorf EvaluateAttributeAtCentroid EvaluateAttributeAtSample EvaluateAttributeSnapped exp exp2 f16tof32 f32tof16 faceforward firstbithigh firstbitlow floor fma fmod frac frexp fwidth GetRenderTargetSampleCount GetRenderTargetSamplePosition GroupMemoryBarrier GroupMemoryBarrierWithGroupSync InterlockedAdd InterlockedAnd InterlockedCompareExchange InterlockedCompareStore InterlockedExchange InterlockedMax InterlockedMin InterlockedOr InterlockedXor isfinite isinf isnan ldexp length lerp lit log log10 log2 mad max min modf msad4 mul noise normalize pow printf Process2DQuadTessFactorsAvg Process2DQuadTessFactorsMax Process2DQuadTessFactorsMin ProcessIsolineTessFactors ProcessQuadTessFactorsAvg ProcessQuadTessFactorsMax ProcessQuadTessFactorsMin ProcessTriTessFactorsAvg ProcessTriTessFactorsMax ProcessTriTessFactorsMin radians rcp reflect refract reversebits round rsqrt saturate sign sin sincos sinh smoothstep sqrt step tan tanh tex1D tex1Dbias tex1Dgrad tex1Dlod tex1Dproj tex2D tex2Dbias tex2Dgrad tex2Dlod tex2Dproj tex3D tex3Dbias tex3Dgrad tex3Dlod tex3Dproj texCUBE texCUBEbias texCUBEgrad texCUBElod texCUBEproj transpose trunc",
      literal:"true false"},illegal:'"',
    contains:[r.C_LINE_COMMENT_MODE,r.C_BLOCK_COMMENT_MODE,e,{className:"meta",
      begin:"#",end:"$"}]}}})());

// https://github.com/highlightjs/highlightjs-gdscript
hljs.registerLanguage("gdscript",function(){"use strict";var e=e||{};function r(e){return{aliases:["godot","gdscript"],keywords:{keyword:"and in not or self void as assert breakpoint class class_name extends is func setget signal tool yield const enum export onready static var break continue if elif else for pass return match while remote sync master puppet remotesync mastersync puppetsync",built_in:"Color8 ColorN abs acos asin atan atan2 bytes2var cartesian2polar ceil char clamp convert cos cosh db2linear decimals dectime deg2rad dict2inst ease exp floor fmod fposmod funcref get_stack hash inst2dict instance_from_id inverse_lerp is_equal_approx is_inf is_instance_valid is_nan is_zero_approx len lerp lerp_angle linear2db load log max min move_toward nearest_po2 ord parse_json polar2cartesian posmod pow preload print_stack push_error push_warning rad2deg rand_range rand_seed randf randi randomize range_lerp round seed sign sin sinh smoothstep sqrt step_decimals stepify str str2var tan tanh to_json type_exists typeof validate_json var2bytes var2str weakref wrapf wrapi bool int float String NodePath Vector2 Rect2 Transform2D Vector3 Rect3 Plane Quat Basis Transform Color RID Object NodePath Dictionary Array PoolByteArray PoolIntArray PoolRealArray PoolStringArray PoolVector2Array PoolVector3Array PoolColorArray",literal:"true false null"},contains:[e.NUMBER_MODE,e.HASH_COMMENT_MODE,{className:"comment",begin:/"""/,end:/"""/},e.QUOTE_STRING_MODE,{variants:[{className:"function",beginKeywords:"func"},{className:"class",beginKeywords:"class"}],end:/:/,contains:[e.UNDERSCORE_TITLE_MODE]}]}}return e.exports=function(e){e.registerLanguage("gdscript",r)},e.exports.definer=r,e.exports.definer||e.exports}());
