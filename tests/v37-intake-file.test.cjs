'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {deflateRawSync} = require('node:zlib');
const Reader = require('../dist/intake-file.js');
const Intake = require('../dist/command-intake.js');

// Node does not have DOMParser. This deliberately small adapter supplies only
// DOM traversal for controlled XML fixtures; real browser parsing is also part
// of release QA. It is not shipped in the app or used on user files.
class FixtureElement {
  constructor(name, attrs = {}) { this.qualifiedName = name; this.localName = name.split(':').pop(); this.attrs = attrs; this.children = []; this.parts = []; this.namespaces = {xml:'http://www.w3.org/XML/1998/namespace'}; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  getAttributeNS(_ns, name) { return this.getAttribute('r:' + name); }
  get textContent() { return this.parts.map(part => typeof part === 'string' ? part : part.textContent).join(''); }
  getElementsByTagNameNS(_ns, tag) { return this.children.flatMap(child => [...(child.localName === tag ? [child] : []), ...child.getElementsByTagNameNS(_ns, tag)]); }
}
const entity = value => value.replace(/&(?:amp|lt|gt|quot|apos);/g, token => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[token]);
class FixtureDOMParser {
  parseFromString(xml) {
    const document = new FixtureElement('#document'), stack = [document];
    for (const token of xml.match(/<\?[^>]*\?>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<?') || token.startsWith('<!--')) continue;
      if (token.startsWith('</')) {
        if (stack.length === 1 || stack.at(-1).qualifiedName !== token.slice(2, -1)) return this.bad();
        stack.pop();
      } else if (token.startsWith('<')) {
        const name = /^<([^\s/>]+)/.exec(token)?.[1];
        if (!name) return this.bad();
        const attrs = Object.fromEntries([...token.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], entity(match[2])]));
        const node = new FixtureElement(name, attrs);
        node.namespaces = {...stack.at(-1).namespaces};
        for (const [attr, value] of Object.entries(attrs)) if (attr.startsWith('xmlns:')) node.namespaces[attr.slice(6)] = value;
        for (const qualified of [name, ...Object.keys(attrs)]) {
          if (qualified.includes(':') && !qualified.startsWith('xmlns:') && !node.namespaces[qualified.split(':')[0]]) return this.bad();
        }
        stack.at(-1).children.push(node); stack.at(-1).parts.push(node);
        if (!token.endsWith('/>')) stack.push(node);
      } else stack.at(-1).parts.push(entity(token));
    }
    if (stack.length !== 1 || document.children.length !== 1) return this.bad();
    document.documentElement = document.children[0]; return document;
  }
  bad() { const document = new FixtureElement('#document'); document.documentElement = new FixtureElement('parsererror'); document.children.push(document.documentElement); return document; }
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function archive(files, options = {}) {
  const bodies = [], headers = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name), raw = Buffer.from(content), compressed = options.stored ? raw : deflateRawSync(raw);
    const checksum = crc32(raw), flags = options.flags || 0, method = options.stored ? 0 : 8;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!(flags & 8)) { local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); }
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    let descriptor = Buffer.alloc(0);
    if (flags & 8) { descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(raw.length, 12); }
    bodies.push(local, nameBytes, compressed, descriptor); headers.push(central, nameBytes); offset += local.length + nameBytes.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(headers), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, directory, end]);
}
const relationPrefix = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const sheet = body => '<worksheet xmlns="' + spreadsheetNamespace + '"><sheetData>' + body + '</sheetData></worksheet>';
const inline = (address, value) => '<c r="' + address + '" t="inlineStr"><is><t>' + value + '</t></is></c>';
function workbook(sheets, extra = {}) {
  return {
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + (extra['xl/sharedStrings.xml'] ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : '') + '</Types>',
    '_rels/.rels':'<Relationships xmlns="' + packageRelationships + '"><Relationship Id="main" Type="' + relationPrefix + 'officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="' + spreadsheetNamespace + '" xmlns:r="' + relationPrefix.slice(0, -1) + '"><sheets>' + sheets.map((entry, i) => '<sheet name="' + (entry.name || '名单' + (i + 1)) + '" sheetId="' + (i + 1) + '" r:id="s' + i + '"/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="' + packageRelationships + '">' + sheets.map((_, i) => '<Relationship Id="s' + i + '" Type="' + relationPrefix + 'worksheet" Target="worksheets/sheet' + i + '.xml"/>').join('') +
      (extra['xl/sharedStrings.xml'] ? '<Relationship Id="strings" Type="' + relationPrefix + 'sharedStrings" Target="sharedStrings.xml"/>' : '') + '</Relationships>',
    ...Object.fromEntries(sheets.map((entry, i) => ['xl/worksheets/sheet' + i + '.xml', entry.xml])), ...extra
  };
}
const decode = (files, options) => Reader.readXlsx(archive(files, options), {DOMParser:FixtureDOMParser});
const simple = () => workbook([{xml:sheet('<row r="1">' + inline('A1', '村庄') + inline('B1', '人数') + '</row><row r="2">' + inline('A2', '演示村') + '<c r="B2"><v>12</v></c></row>')}]);

test('reads raw-deflate XLSX, shared rich strings and sparse cells without shifting columns', async () => {
  const files = workbook([{name:'紧急名单', xml:sheet('<row r="1"><c r="A1" t="s"><v>0</v></c>' + inline('C1', '人数') + '</row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><v>12</v></c></row>')}], {
    'xl/sharedStrings.xml':'<sst><si><t>村庄</t></si><si><r><t>演示</t></r><r><t>村&amp;社区</t></r><rPh><t>ignored phonetic</t></rPh></si></sst>'
  });
  const result = await decode(files);
  assert.equal(result.sheetName, '紧急名单');
  assert.deepEqual(result.rows, [['村庄', '', '人数'], [], ['演示村&社区', '', '12']]);
  assert.deepEqual(result.warnings, []);
});
test('supports stored ZIP entries and data descriptor deflate archives', async () => {
  const expected = [['村庄', '人数'], ['演示村', '12']];
  assert.deepEqual((await decode(simple(), {stored:true})).rows, expected);
  assert.deepEqual((await decode(simple(), {flags:8})).rows, expected);
});
test('selects first nonempty sheet and explicitly warns that other sheets were not imported', async () => {
  const files = workbook([{name:'说明空表', xml:sheet('<row r="1"><c r="A1"/></row>')}, {name:'名单', xml:sheet('<row r="1">' + inline('A1', '地点') + '</row>')}, {name:'其他名单', xml:sheet('<row r="1">' + inline('A1', '其他') + '</row>')}]);
  const result = await decode(files);
  assert.deepEqual(result.rows, [['地点']]); assert.equal(result.sheetName, '名单');
  assert.match(result.warnings.join(' '), /其余 2 张表未导入/); assert.match(result.warnings.join(' '), /跳过前面 1 张空工作表/);
});
test('rejects all-empty workbook and does not skip formulas to another sheet', async () => {
  await assert.rejects(decode(workbook([{xml:sheet('')} ])), /均为空/);
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1"><c r="A1"><f>1+2</f><v>3</v></c></row>')}, {xml:sheet('<row r="1">' + inline('A1', 'valid') + '</row>')}])), /公式缓存/);
});
test('rejects missing shared strings, duplicate addresses and invalid row references', async () => {
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row>')}])), /共享文本/);
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1">' + inline('A1', '甲') + inline('A1', '乙') + '</row>')}])), /列号重复/);
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1">' + inline('A2', '甲') + '</row>')}])), /地址与行号/);
});
test('refuses formulas, Excel error cells and merged-cell inference', async () => {
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1"><c r="A1" t="e"><v>#VALUE!</v></c></row>')}])), /错误单元格/);
  const xml = sheet('<row r="1">' + inline('A1', '地点') + '</row>').replace('</worksheet>', '<mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>');
  const result = await decode(workbook([{xml}]));
  assert.deepEqual(result.rows, [['地点']]); assert.match(result.warnings[0], /不会自动补齐/);
});
test('rejects XML entities, invalid XML, external worksheet and path traversal', async () => {
  let files = simple(); files['xl/worksheets/sheet0.xml'] = '<!DOCTYPE worksheet [<!ENTITY x "12">]>' + files['xl/worksheets/sheet0.xml'];
  await assert.rejects(decode(files), /实体声明/);
  files = simple(); files['xl/worksheets/sheet0.xml'] = '<worksheet><sheetData></worksheet>';
  await assert.rejects(decode(files), /XML 损坏/);
  files = simple(); files['xl/workbook.xml'] = files['xl/workbook.xml'].replace(/ xmlns:r="[^"]*"/, '');
  await assert.rejects(decode(files), /workbook.xml XML 损坏/);
  files = simple(); files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('Target="worksheets', 'TargetMode="External" Target="https://example.org/worksheets');
  await assert.rejects(decode(files), /不在当前文件/);
  files = simple(); files['../escape.xml'] = 'bad';
  await assert.rejects(decode(files), /路径异常/);
});
test('rejects encryption, macros, truncated archives and mismatched CRC before yielding rows', async () => {
  await assert.rejects(decode(simple(), {flags:1}), /加密 Excel/);
  await assert.rejects(decode({...simple(), 'xl/vbaProject.bin':'macro bytes'}), /含宏/);
  const file = archive(simple(), {stored:true});
  await assert.rejects(Reader.readXlsx(file.subarray(0, -10), {DOMParser:FixtureDOMParser}), /完整/);
  const broken = Buffer.from(file), needle = broken.indexOf(Buffer.from('officeDocument'));
  broken[needle] = 'X'.charCodeAt(0);
  await assert.rejects(Reader.readXlsx(broken, {DOMParser:FixtureDOMParser}), /校验失败/);
});
test('rejects misleading expanded lengths and declared decompression bomb', async () => {
  const data = archive(simple()), end = data.length - 22, central = data.readUInt32LE(end + 16), local = data.readUInt32LE(central + 42);
  data.writeUInt32LE(Reader.limits.expandedBytes + 1, central + 24); data.writeUInt32LE(Reader.limits.expandedBytes + 1, local + 22);
  await assert.rejects(Reader.readXlsx(data, {DOMParser:FixtureDOMParser}), /解压后超过/);
  const short = archive(simple()); let start = short.readUInt32LE(short.length - 22 + 16);
  while (short.subarray(start + 46, start + 46 + short.readUInt16LE(start + 28)).toString() !== '_rels/.rels') start += 46 + short.readUInt16LE(start + 28) + short.readUInt16LE(start + 30) + short.readUInt16LE(start + 32);
  short.writeUInt32LE(1, start + 24); short.writeUInt32LE(1, short.readUInt32LE(start + 42) + 22);
  await assert.rejects(Reader.readXlsx(short, {DOMParser:FixtureDOMParser}), /解压长度异常/);
});
test('does not partially return oversized or sparse excessive tables', async () => {
  await assert.rejects(decode(workbook([{xml:sheet('<row r="5001">' + inline('A5001', '甲') + '</row>')}])), /5000 行/);
  await assert.rejects(decode(workbook([{xml:sheet('<row r="1">' + inline('IW1', '甲') + '</row>')}])), /256 列/);
  const rows = Array.from({length:80}, (_, index) => '<row r="' + (index + 1) + '">' + inline('IV' + (index + 1), '甲') + '</row>').join('');
  await assert.rejects(decode(workbook([{xml:sheet(rows)}])), /空列间隔/);
});
function file(name, text) { const bytes = Buffer.from(text); return {name, size:bytes.length, arrayBuffer:async () => bytes}; }
test('read routes CSV through the shared parser with BOM and quoted multiline facts', async () => {
  global.JiaoyingCommandIntake = Intake;
  try {
    const result = await Reader.read(file('名单.csv', '\uFEFF村庄,人数,备注\r\n演示村,12,"需要轮椅\n两人"\r\n'));
    assert.equal(result.filename, '名单.csv'); assert.equal(result.sheetName, 'CSV');
    assert.equal(result.rows[1][2], '需要轮椅\n两人'); assert.deepEqual(result.warnings, []);
    await assert.rejects(Reader.read(file('坏表.csv', '村庄,人数\n"缺引号,12')), /引号/);
  } finally { delete global.JiaoyingCommandIntake; }
});
test('read rejects old binary XLS, oversized, empty and misleading file content', async () => {
  await assert.rejects(Reader.read(file('旧名单.xls', 'a')), /旧版 .xls/);
  await assert.rejects(Reader.read(file('名单.txt', 'a')), /\.xlsx 或 .csv/);
  await assert.rejects(Reader.read(file('名单.csv', '')), /为空/);
  await assert.rejects(Reader.read({...file('名单.xlsx', 'a'), size:Reader.limits.fileBytes + 1}), /5 MB/);
  await assert.rejects(Reader.read({...file('名单.csv', 'a'), size:2}), /读取不完整/);
});
test('read applies CSV row/cell guards and does not silently trim excess values', async () => {
  global.JiaoyingCommandIntake = Intake;
  try {
    await assert.rejects(Reader.read(file('过大.csv', Array.from({length:5001}, () => '地点,12').join('\n'))), /5000 行|行数|行/);
    await assert.rejects(Reader.read(file('空表.csv', '\r\n,\r\n')), /为空/);
    await assert.rejects(Reader.read(file('损坏.csv', '地点,人数\n\0,12')), /无效字符/);
  } finally { delete global.JiaoyingCommandIntake; }
});
test('supports UTF-16 CSV and reports legacy Chinese decoding', async () => {
  global.JiaoyingCommandIntake = Intake;
  try {
    const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from('村庄,人数\n演示村,12', 'utf16le')]);
    const result = await Reader.read(file('名单.csv', utf16)); assert.equal(result.rows[1][0], '演示村');
    const gb = Buffer.from([0xb4, 0xe5, 0xd7, 0xaf, 44, 0xc8, 0xcb, 0xca, 0xfd, 10, 0xb4, 0xe5, 44, 49, 50]);
    const legacy = await Reader.read(file('名单.csv', gb)); assert.equal(legacy.rows[0][0], '村庄'); assert.match(legacy.warnings[0], /GB18030/);
  } finally { delete global.JiaoyingCommandIntake; }
});
test('deadline and missing decompression capability fail explicitly', async () => {
  await assert.rejects(Reader.readXlsx(archive(simple()), {DOMParser:FixtureDOMParser, deadline:Date.now() - 1}), /超时/);
  const original = global.DecompressionStream; global.DecompressionStream = undefined;
  try { await assert.rejects(decode(simple()), /新版 Chrome \/ Edge/); }
  finally { global.DecompressionStream = original; }
});
