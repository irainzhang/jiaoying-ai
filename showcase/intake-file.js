(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingIntakeFile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Reads values locally. It never evaluates formulas, runs macros, follows
  // external relationships, uploads a workbook, or truncates a rejected file.
  const LIMITS = Object.freeze({fileBytes:5 * 1024 * 1024, expandedBytes:20 * 1024 * 1024,
    cells:20000, rows:5000, columns:256, files:512, textLength:10000, milliseconds:20000});
  const fail = message => { throw new Error(message); };
  const checkTime = deadline => { if (Date.now() > deadline) fail('读取文件超时，请缩小名单后重新上传。'); };
  const utf8 = bytes => { try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
    catch (_) { fail('Excel 文件的 XML 或文件名编码损坏，请重新另存为 .xlsx。'); } };
  function bytesOf(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    fail('无法读取文件内容，请重新选择文件。');
  }
  async function timed(promise, deadline) {
    checkTime(deadline);
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('读取文件超时，请缩小名单后重新上传。')), Math.max(1, deadline - Date.now()));
    })]); } finally { clearTimeout(timer); }
  }

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    for (let j = 0; j < 8; j++) v = (v >>> 1) ^ ((v & 1) ? 0xedb88320 : 0);
    crcTable[i] = v >>> 0;
  }
  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function zipDirectory(bytes, deadline) {
    if (bytes.byteLength > LIMITS.fileBytes) fail('文件超过 5 MB，请拆分名单后上传。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
      if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
    }
    if (end < 0) fail('不是完整的 .xlsx 文件；加密文件请先解密，旧版 .xls 请另存为 .xlsx 或 CSV。');
    const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('不支持分卷 Excel 文件，请重新另存为 .xlsx。');
    if (count === 65535 || size === 0xffffffff || start === 0xffffffff) fail('不支持 ZIP64 文件，请缩小并另存名单。');
    if (!count || count > LIMITS.files || start + size !== end) fail('Excel 压缩目录异常或内容过多，请重新另存文件。');
    const entries = new Map(), intervals = [];
    let offset = start, total = 0;
    for (let i = 0; i < count; i++) {
      checkTime(deadline);
      if (offset + 46 > end || u32(offset) !== 0x02014b50) fail('Excel 压缩目录损坏，请重新上传完整文件。');
      const flags = u16(offset + 8), method = u16(offset + 10), checksum = u32(offset + 16);
      const compressed = u32(offset + 20), expanded = u32(offset + 24), nameLength = u16(offset + 28);
      const extraLength = u16(offset + 30), commentLength = u16(offset + 32), disk = u16(offset + 34), local = u32(offset + 42);
      if (offset + 46 + nameLength + extraLength + commentLength > end) fail('Excel 文件目录被截断。');
      if (flags & (1 | 64)) fail('不支持加密 Excel，请取消密码后另存为 .xlsx。');
      if (method !== 0 && method !== 8) fail('Excel 使用了不支持的压缩方式，请另存为 .xlsx。');
      if (disk || compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff) fail('不支持分卷或 ZIP64 Excel。');
      const name = utf8(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (!name || name.includes('\\') || name.startsWith('/') || /(^|\/)\.\.?($|\/)/.test(name) || /[\u0000-\u001f]/.test(name) || entries.has(name)) fail('Excel 内部文件路径异常或重复，请重新另存文件。');
      if (/vbaproject\.bin$/i.test(name)) fail('此名单含宏，请另存为不含宏的 .xlsx 或 CSV 后上传。');
      total += expanded;
      if (total > LIMITS.expandedBytes) fail('Excel 解压后超过 20 MB，请删除多余工作表或拆分名单。');
      if (local + 30 > start || u32(local) !== 0x04034b50) fail('Excel 内部文件头损坏。');
      const localFlags = u16(local + 6), localMethod = u16(local + 8);
      const localNameLength = u16(local + 26), localExtraLength = u16(local + 28);
      const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
      if (dataStart > start || dataEnd > start || localFlags !== flags || localMethod !== method) fail('Excel 内部文件长度或压缩信息不一致。');
      if (utf8(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) fail('Excel 内部文件名不一致。');
      if (!(flags & 8) && (u32(local + 14) !== checksum || u32(local + 18) !== compressed || u32(local + 22) !== expanded)) fail('Excel 内部校验信息不一致。');
      if (method === 0 && compressed !== expanded) fail('Excel 内部文件长度不一致。');
      intervals.push([local, dataEnd]);
      entries.set(name, {name, method, checksum, compressed, expanded, dataStart, dataEnd});
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== end) fail('Excel 压缩目录长度异常。');
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) if (intervals[i][0] < intervals[i - 1][1]) fail('Excel 内部文件发生重叠，无法完整读取。');
    return entries;
  }

  async function unzip(bytes, entry, deadline, budget) {
    checkTime(deadline);
    let output;
    if (entry.method === 0) output = bytes.subarray(entry.dataStart, entry.dataEnd);
    else {
      let decompressor;
      try { decompressor = new root.DecompressionStream('deflate-raw'); }
      catch (_) { fail('当前浏览器不支持直接读取 Excel，请使用新版 Chrome / Edge，或将文件另存为 CSV。'); }
      const reader = new Blob([bytes.subarray(entry.dataStart, entry.dataEnd)]).stream().pipeThrough(decompressor).getReader();
      const chunks = []; let length = 0;
      try {
        while (true) {
          const {done, value} = await timed(reader.read(), deadline);
          if (done) break;
          length += value.byteLength;
          if (length > entry.expanded || length + budget.used > LIMITS.expandedBytes) fail('Excel 解压长度异常或超过 20 MB，已停止读取。');
          chunks.push(value);
        }
      } catch (error) {
        // Cancellation also prevents a timed-out decompressor from continuing.
        reader.cancel().catch(() => {});
        if (/超时|超过|异常/.test(error.message)) throw error;
        fail('Excel 压缩数据损坏，请重新另存并上传。');
      } finally { reader.releaseLock(); }
      output = new Uint8Array(length); let at = 0;
      for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
    }
    budget.used += output.length;
    if (output.length !== entry.expanded || budget.used > LIMITS.expandedBytes || crc32(output) !== entry.checksum) fail('Excel 文件校验失败，内容可能不完整，请重新上传。');
    checkTime(deadline);
    return output;
  }

  function xmlDocument(bytes, Parser, label) {
    const xml = utf8(bytes);
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) fail('Excel XML 含文档类型或实体声明，无法安全读取，请重新另存文件。');
    if ((xml.match(/</g) || []).length > 250000) fail('Excel XML 内容过于复杂，请删除多余格式或另存为 CSV。');
    if (!Parser) fail('当前浏览器不支持读取 Excel，请另存为 CSV。');
    const document = new Parser().parseFromString(xml, 'application/xml');
    if (!document.documentElement || document.getElementsByTagNameNS('*', 'parsererror').length) fail('Excel 中的 ' + label + ' XML 损坏，请重新另存文件。');
    return document;
  }
  const descendants = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const children = (node, tag) => Array.from(node.children || []).filter(item => item.localName === tag);
  function rootIs(document, tag) {
    if (document.documentElement.localName !== tag) fail('Excel 内部 XML 类型不正确：' + tag + '。');
    return document.documentElement;
  }
  function valueText(node) {
    // Phonetic annotations (rPh) are not part of a cell's displayed text.
    let text = '';
    for (const child of Array.from(node.children || [])) {
      if (child.localName === 't') text += child.textContent;
      else if (child.localName === 'r') for (const t of children(child, 't')) text += t.textContent;
    }
    if (text.length > LIMITS.textLength) fail('单元格文本超过 10000 字，请缩短内容后上传。');
    return text;
  }
  function relationshipPath(target, base) {
    if (!target || /[:\\?#\u0000-\u001f]/.test(target)) fail('Excel 工作表路径异常。');
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) fail('Excel 工作表路径超出文件范围。'); parts.pop(); }
      else parts.push(part);
    }
    return parts.join('/');
  }
  function tableRows(document, strings, deadline) {
    const worksheet = rootIs(document, 'worksheet');
    if (descendants(worksheet, 'f').length) fail('名单中含公式。请复制名单并“粘贴为值”，再另存后上传；本系统不会使用公式缓存结果。');
    const sheetData = children(worksheet, 'sheetData');
    if (sheetData.length > 1) fail('Excel 工作表包含重复数据区。');
    if (!sheetData.length) return [];
    const result = [], rowNumbers = new Set();
    let nextRow = 1, count = 0, allocated = 0, any = false, maxRow = 0;
    for (const row of children(sheetData[0], 'row')) {
      checkTime(deadline);
      const rowAttr = row.getAttribute('r');
      if (rowAttr && !/^[1-9][0-9]*$/.test(rowAttr)) fail('Excel 行号格式无效，请重新另存文件。');
      const rowNumber = rowAttr ? Number(rowAttr) : nextRow;
      if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > LIMITS.rows || rowNumbers.has(rowNumber)) fail('Excel 行号重复、无效或超过 5000 行，请拆分名单。');
      rowNumbers.add(rowNumber); nextRow = rowNumber + 1;
      const output = [], columns = new Set(); let nextColumn = 0;
      for (const cell of children(row, 'c')) {
        if (++count > LIMITS.cells) fail('名单超过 20000 个单元格，请拆分后上传。');
        const address = cell.getAttribute('r'); let column = nextColumn;
        if (address) {
          const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(address);
          if (!match || Number(match[2]) !== rowNumber) fail('Excel 单元格地址与行号不一致。');
          column = 0;
          for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
          column--;
        }
        if (column >= LIMITS.columns || columns.has(column)) fail('Excel 列号重复或超过 256 列，请只保留名单列。');
        columns.add(column); nextColumn = column + 1;
        const type = cell.getAttribute('t') || 'n', values = children(cell, 'v'), inline = children(cell, 'is');
        if (values.length > 1 || inline.length > 1) fail('Excel 单元格含重复值，无法完整读取。');
        const raw = values[0] ? values[0].textContent : ''; let value = raw;
        if (type === 's') {
          if (!/^\d+$/.test(raw) || !strings || Number(raw) >= strings.length) fail('Excel 共享文本索引损坏或缺失。');
          value = strings[Number(raw)];
        } else if (type === 'inlineStr') {
          if (values.length) fail('Excel 文本单元格格式异常。');
          value = inline.length ? valueText(inline[0]) : '';
        } else if (type === 'e') fail('名单含 Excel 错误单元格，请先修正后上传。');
        else if (!['n', 'b', 'str', 'd'].includes(type)) fail('Excel 含不支持的单元格类型，请另存为 CSV。');
        else if (type === 'b' && raw && raw !== '0' && raw !== '1') fail('Excel 布尔单元格值无效，请重新另存文件。');
        else if (type === 'n' && raw && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))) fail('Excel 数字单元格值无效，请修正后上传。');
        if (value.length > LIMITS.textLength) fail('单元格文本超过 10000 字，请缩短后上传。');
        // Empty styled cells carry no facts; preserve gaps before all real data.
        if (value !== '') {
          while (output.length <= column) output.push('');
          output[column] = value; any = true;
        }
      }
      allocated += output.length;
      if (allocated > LIMITS.cells) fail('名单含过多空列间隔，展开后超过 20000 个单元格，请整理表格。');
      if (output.length) { result[rowNumber - 1] = output; maxRow = Math.max(maxRow, rowNumber); }
    }
    if (!any) return [];
    for (let i = 0; i < maxRow; i++) if (!result[i]) result[i] = [];
    return result;
  }

  async function readXlsx(input, options = {}) {
    const deadline = options.deadline || Date.now() + LIMITS.milliseconds;
    const bytes = bytesOf(input), entries = zipDirectory(bytes, deadline), budget = {used:0}, cache = new Map();
    const Parser = options.DOMParser || root.DOMParser;
    async function readXML(name, optional) {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name);
      if (!entry) { if (optional) return null; fail('Excel 缺少必要文件：' + name + '。'); }
      const document = xmlDocument(await unzip(bytes, entry, deadline, budget), Parser, name);
      checkTime(deadline); cache.set(name, document); return document;
    }
    // The workbook relationship is resolved from the package root, not assumed
    // from a user-controlled sheet name. No relationship ever triggers a fetch.
    const packageRels = await readXML('_rels/.rels'); rootIs(packageRels, 'Relationships');
    const office = descendants(packageRels, 'Relationship').filter(r => /\/officeDocument$/.test(r.getAttribute('Type') || ''));
    if (office.length !== 1 || office[0].getAttribute('TargetMode') === 'External') fail('不是受支持的 Excel 工作簿。');
    const workbookPath = relationshipPath(office[0].getAttribute('Target'), '');
    const workbook = await readXML(workbookPath); rootIs(workbook, 'workbook');
    const segments = workbookPath.split('/'), basename = segments.pop();
    const relPath = (segments.length ? segments.join('/') + '/' : '') + '_rels/' + basename + '.rels';
    const relDoc = await readXML(relPath); rootIs(relDoc, 'Relationships');
    const relations = new Map();
    for (const rel of descendants(relDoc, 'Relationship')) {
      const id = rel.getAttribute('Id');
      if (!id || relations.has(id)) fail('Excel 工作表关系编号重复或缺失。');
      relations.set(id, rel);
    }
    const shared = [...relations.values()].filter(r => /\/sharedStrings$/.test(r.getAttribute('Type') || ''));
    if (shared.length > 1) fail('Excel 包含重复共享文本表。');
    let strings = null;
    if (shared.length) {
      if (shared[0].getAttribute('TargetMode') === 'External') fail('不支持外部共享文本，请把名单保存到当前文件。');
      const stringDoc = await readXML(relationshipPath(shared[0].getAttribute('Target'), workbookPath));
      const items = children(rootIs(stringDoc, 'sst'), 'si');
      if (items.length > LIMITS.cells) fail('Excel 共享文本超过 20000 项，请清理工作簿或另存为 CSV。');
      strings = items.map(valueText);
    }
    const sheets = descendants(workbook, 'sheet');
    if (!sheets.length) fail('Excel 中没有工作表。');
    const warnings = []; let empty = 0;
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i], id = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id');
      const rel = relations.get(id), sheetName = sheet.getAttribute('name') || '工作表 ' + (i + 1);
      if (!rel || !/\/worksheet$/.test(rel.getAttribute('Type') || '') || rel.getAttribute('TargetMode') === 'External') fail('工作表“' + sheetName + '”不在当前文件中或类型不支持，请导出普通名单工作表。');
      const sheetPath = relationshipPath(rel.getAttribute('Target'), workbookPath);
      const rows = tableRows(await readXML(sheetPath), strings, deadline);
      if (!rows.length) { empty++; continue; }
      if (sheets.length > 1) warnings.push('本次仅读取首个非空工作表“' + sheetName + '”；其余 ' + (sheets.length - 1) + ' 张表未导入，请分别导出后上传。');
      if (empty) warnings.push('已跳过前面 ' + empty + ' 张空工作表。');
      if (sheet.getAttribute('state') === 'hidden' || sheet.getAttribute('state') === 'veryHidden') warnings.push('所读取的工作表处于隐藏状态，请核对是否为需要发布的名单。');
      if (descendants(cache.get(sheetPath), 'mergeCell').length) warnings.push('名单含合并单元格，仅保留原有值，空白处不会自动补齐，请核对每行地点与人数。');
      if (descendants(cache.get(sheetPath), 'autoFilter').length || descendants(cache.get(sheetPath), 'row').some(row => ['1','true'].includes(row.getAttribute('hidden')))) warnings.push('名单含筛选或隐藏行；本次读取全表的全部人员行，请核对数量。');
      checkTime(deadline);
      return {rows, sheetName, warnings};
    }
    fail('Excel 的工作表均为空，请上传含表头和人员名单的文件。');
  }

  function decodeCSV(bytes) {
    let encoding = 'utf-8', warnings = [], text;
    if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
    else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
    try { text = new TextDecoder(encoding, {fatal:true}).decode(bytes); }
    catch (_) {
      try { text = new TextDecoder('gb18030', {fatal:true}).decode(bytes); warnings.push('文件按 GB18030 中文编码读取，请检查村名和地点是否正确。'); }
      catch (_) { fail('CSV 编码无法识别，请另存为 UTF-8 CSV 后上传。'); }
    }
    if (text.includes('\0')) fail('CSV 含无效字符，可能不是文本名单；请另存为 UTF-8 CSV。');
    return {text:text.replace(/^\uFEFF/, ''), warnings};
  }
  function checkRows(rows) {
    if (!Array.isArray(rows) || rows.length > LIMITS.rows) fail('名单格式无效或超过 5000 行，请拆分后上传。');
    let count = 0;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length > LIMITS.columns) fail('名单格式无效或超过 256 列，请保留必要名单列。');
      count += row.length;
      if (count > LIMITS.cells) fail('名单超过 20000 个单元格，请拆分后上传。');
      if (row.some(value => typeof value !== 'string' || value.length > LIMITS.textLength)) fail('名单单元格内容无效或超过 10000 字。');
    }
    if (!rows.some(row => row.some(value => value.trim()))) fail('文件为空，请上传含表头和人员名单的文件。');
    return rows;
  }
  async function read(file) {
    if (!file || typeof file.arrayBuffer !== 'function') fail('请选择 Excel 或 CSV 人员名单。');
    const filename = String(file.name || ''), extension = filename.toLowerCase().split('.').pop();
    if (extension === 'xls') fail('暂不支持旧版 .xls，请用 Excel 另存为 .xlsx 或 UTF-8 CSV 后上传。');
    if (extension !== 'xlsx' && extension !== 'csv') fail('请选择 .xlsx 或 .csv 人员名单。');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > LIMITS.fileBytes) fail('文件为空或超过 5 MB，请缩小名单后上传。');
    const deadline = Date.now() + LIMITS.milliseconds;
    const input = await timed(file.arrayBuffer(), deadline), bytes = bytesOf(input);
    if (bytes.length !== file.size || bytes.length > LIMITS.fileBytes) fail('文件读取不完整，请重新选择名单。');
    if (extension === 'xlsx') return {...await readXlsx(bytes, {deadline}), filename};
    const {text, warnings} = decodeCSV(bytes), parse = root.JiaoyingCommandIntake && root.JiaoyingCommandIntake.parseCSV;
    if (typeof parse !== 'function') fail('名单整理模块尚未加载，请刷新网页后重试。');
    const parsed = parse(text), rows = checkRows(Array.isArray(parsed) ? parsed : parsed.rows);
    checkTime(deadline);
    return {rows, filename, sheetName:'CSV', warnings};
  }

  return {read, readXlsx, limits:LIMITS};
});
