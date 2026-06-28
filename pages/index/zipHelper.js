// ZIP文件生成辅助函数（移植自WEB版）

// 手动实现UTF-8编码（避免使用TextEncoder，防止SharedArrayBuffer警告）
function stringToUtf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var charCode = str.charCodeAt(i);
    // 处理UTF-16代理对（emoji等4字节字符）
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      // 高代理，需要和低代理组合
      if (i + 1 < str.length) {
        var nextCharCode = str.charCodeAt(i + 1);
        if (nextCharCode >= 0xDC00 && nextCharCode <= 0xDFFF) {
          // 低代理，组合成完整的Unicode码点
          var codePoint = ((charCode - 0xD800) << 10) + (nextCharCode - 0xDC00) + 0x10000;
          bytes.push(0xF0 | (codePoint >> 18));
          bytes.push(0x80 | ((codePoint >> 12) & 0x3F));
          bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
          bytes.push(0x80 | (codePoint & 0x3F));
          i++; // 跳过下一个字符（低代理）
        }
      }
    } else if (charCode < 0x80) {
      // 1字节：0xxxxxxx
      bytes.push(charCode);
    } else if (charCode < 0x800) {
      // 2字节：110xxxxx 10xxxxxx
      bytes.push(0xC0 | (charCode >> 6));
      bytes.push(0x80 | (charCode & 0x3F));
    } else {
      // 3字节：1110xxxx 10xxxxxx 10xxxxxx
      bytes.push(0xE0 | (charCode >> 12));
      bytes.push(0x80 | ((charCode >> 6) & 0x3F));
      bytes.push(0x80 | (charCode & 0x3F));
    }
  }
  return new Uint8Array(bytes);
}

// CRC32 查表算法
var crcTable = null;
function buildCrcTable() {
  if (crcTable) return;
  crcTable = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
}

function crc32(data) {
  buildCrcTable();
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// DOS日期时间
function getDosDateTime(date) {
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  var minute = date.getMinutes();
  var second = Math.floor(date.getSeconds() / 2); // DOS时间只精确到2秒
  
  var dosDate = ((year - 1980) << 9) | (month << 5) | day;
  var dosTime = (hour << 11) | (minute << 5) | second;
  
  return { dosDate: dosDate, dosTime: dosTime };
}

// 辅助函数：写入Uint32
function pushUint32(arr, val) {
  arr.push((val & 0xFF) >>> 0);
  arr.push((val >>> 8) & 0xFF);
  arr.push((val >>> 16) & 0xFF);
  arr.push((val >>> 24) & 0xFF);
}

// 辅助函数：写入Uint16
function pushUint16(arr, val) {
  arr.push((val & 0xFF) >>> 0);
  arr.push((val >>> 8) & 0xFF);
}

// 创建ZIP Blob
function createZipBlob(files) {
  var localParts = [];
  var centralParts = [];
  var entries = [];
  var offset = 0;
  var now = getDosDateTime(new Date());

  files.forEach(function(file) {
    // 使用手动UTF-8编码，避免TextEncoder
    var fileNameBytes = stringToUtf8Bytes(file.name.replace(/\\/g, '/'));
    var contentBytes = stringToUtf8Bytes(file.content);
    var checksum = crc32(contentBytes);
    var local = [];

    pushUint32(local, 0x04034B50);
    pushUint16(local, 20);
    pushUint16(local, 0x0800);
    pushUint16(local, 0);
    pushUint16(local, now.dosTime);
    pushUint16(local, now.dosDate);
    pushUint32(local, checksum);
    pushUint32(local, contentBytes.length);
    pushUint32(local, contentBytes.length);
    pushUint16(local, fileNameBytes.length);
    pushUint16(local, 0);

    var localBytes = new Uint8Array([].concat.apply([], local).concat(Array.from(fileNameBytes)).concat(Array.from(contentBytes)));
    localParts.push(localBytes);
    entries.push({ 
      fileNameBytes: fileNameBytes, 
      contentBytes: contentBytes, 
      checksum: checksum, 
      offset: offset 
    });
    offset += localBytes.length;
  });

  entries.forEach(function(entry) {
    var central = [];
    pushUint32(central, 0x02014B50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0x0800);
    pushUint16(central, 0);
    pushUint16(central, now.dosTime);
    pushUint16(central, now.dosDate);
    pushUint32(central, entry.checksum);
    pushUint32(central, entry.contentBytes.length);
    pushUint32(central, entry.contentBytes.length);
    pushUint16(central, entry.fileNameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, entry.offset);
    centralParts.push(new Uint8Array([].concat.apply([], central).concat(Array.from(entry.fileNameBytes))));
  });

  var centralSize = centralParts.reduce(function(sum, part) { return sum + part.length; }, 0);
  var end = [];
  pushUint32(end, 0x06054B50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, entries.length);
  pushUint16(end, entries.length);
  pushUint32(end, centralSize);
  pushUint32(end, offset);
  pushUint16(end, 0);

  // 合并所有部分
  var totalLength = localParts.reduce(function(sum, part) { return sum + part.length; }, 0) + centralSize + end.length;
  var result = new Uint8Array(totalLength);
  var pos = 0;
  
  localParts.forEach(function(part) {
    result.set(part, pos);
    pos += part.length;
  });
  
  centralParts.forEach(function(part) {
    result.set(part, pos);
    pos += part.length;
  });
  
  result.set(new Uint8Array(end), pos);
  
  return result;
}

module.exports = {
  createZipBlob: createZipBlob,
  crc32: crc32,
  getDosDateTime: getDosDateTime
};
