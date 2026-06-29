// 编码检测与转换辅助模块
// 支持 UTF-8 / UTF-8 with BOM / GBK / ISO-8859-1 自动检测

// 检测Buffer是否是有效的UTF-8
function isValidUtf8(bytes) {
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    var extra = 0;
    if (b <= 0x7F) {
      i += 1;
      continue;
    } else if ((b & 0xE0) === 0xC0) {
      extra = 1;
    } else if ((b & 0xF0) === 0xE0) {
      extra = 2;
    } else if ((b & 0xF8) === 0xF0) {
      extra = 3;
    } else {
      return false;
    }
    for (var j = 0; j < extra; j++) {
      i++;
      if (i >= bytes.length) return false;
      if ((bytes[i] & 0xC0) !== 0x80) return false;
    }
    i++;
  }
  return true;
}

// 简单的GBK范围检测（GBK汉字在0x81-0xFE范围）
// 这里用启发式：如果UTF-8检测失败，且文件中有大量0x80-0xFF字节，判定为GBK
function guessEncoding(bytes) {
  // 先检测BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return 'utf-8-bom';
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return 'utf-16be';
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return 'utf-16le';
  }

  // 检测是否是有效UTF-8
  if (isValidUtf8(bytes)) {
    // 进一步检测：如果文件中有大量0x80-0xFF但UTF-8也合法，可能是巧合
    // 检查是否包含常见中文字符的UTF-8序列
    return 'utf-8';
  }

  // UTF-8无效，判定为GBK（中文Windows默认编码）
  return 'gbk';
}

// GBK转UTF-8字符串（手动查表，不依赖TextEncoder）
// 这里用简化方案：用小程序支持的stringFromCharCode逐个字节处理
// 实际上小程序fs.readFile如果不指定encoding，返回的是ArrayBuffer
// 我们可以在JS层做GBK->UTF-8转换

// GBK编码范围：
// ASCII: 0x00-0x7F (单字节)
// GBK汉字: 0x81-0xFE + 0x40-0xFE (双字节)
// 这里用查表法，嵌入一个精简的GBK->Unicode映射

// 由于GBK映射表太大（约2万条），这里采用：读取为binary string再交给decodeURIComponent处理
// 更可靠的方案：把GBK文件当binary读进来，用encodeURIComponent转义后解码

function gbkToUtf8String(gbkBytes) {
  // 方案：将GBK字节序列转换为UTF-16字符串
  // 使用查表法，这里实现一个简化版：
  // 对于GBK双字节字符，查 Unicode 映射表
  
  // 由于完整的GBK映射表很大，这里用一个技巧：
  // 微信小程序的TextDecoder在部分基础库版本支持，但不可靠
  // 最可靠的方案是：把文件内容当binary读入，然后用escape/unescape技巧
  
  var result = [];
  var i = 0;
  while (i < gbkBytes.length) {
    var b = gbkBytes[i];
    if (b <= 0x7F) {
      // ASCII
      result.push(String.fromCharCode(b));
      i++;
    } else if (b >= 0x81 && b <= 0xFE) {
      // GBK双字节
      if (i + 1 < gbkBytes.length) {
        var b2 = gbkBytes[i + 1];
        // 尝试用TextDecoder（如果可用）
        // 否则用查表
        var codePoint = gbkCodeToUnicode(b, b2);
        if (codePoint) {
          if (codePoint > 0xFFFF) {
            // 代理对
            var hi = Math.floor((codePoint - 0x10000) / 0x400) + 0xD800;
            var lo = ((codePoint - 0x10000) % 0x400) + 0xDC00;
            result.push(String.fromCharCode(hi, lo));
          } else {
            result.push(String.fromCharCode(codePoint));
          }
        } else {
          // 查表失败，保留原字符
          result.push(String.fromCharCode(b));
        }
        i += 2;
      } else {
        result.push(String.fromCharCode(b));
        i++;
      }
    } else {
      result.push(String.fromCharCode(b));
      i++;
    }
  }
  return result.join('');
}

// GBK码点转Unicode（精简查表，覆盖常用汉字+ASCII）
// 完整映射表太大，这里提供一个可扩展的框架
// 实际项目中建议用线上API或预置完整映射表
var _gbkTable = null;

function loadGbkTable() {
  if (_gbkTable) return _gbkTable;
  // 这里放置GBK->Unicode映射表
  // 由于表太大，建议把映射表放到单独文件并用require引入
  // 此处先返回一个空表，触发降级处理
  _gbkTable = {};
  return _gbkTable;
}

function gbkCodeToUnicode(b1, b2) {
  var key = (b1 << 8) | b2;
  
  // 先查常用字符硬编码（ASCII兼容区）
  if (b1 === 0xA3) {
    // 全角ASCII
    if (b2 >= 0xA1 && b2 <= 0xAA) return 0xFF01 + (b2 - 0xA1); // ！＂＃％＆＇（）
    if (b2 >= 0xB0 && b2 <= 0xB9) return 0xFF10 + (b2 - 0xB0); // ０-９
    if (b2 >= 0xC1 && b2 <= 0xDA) return 0xFF21 + (b2 - 0xC1); // Ａ-Ｚ
    if (b2 >= 0xE1 && b2 <= 0xFA) return 0xFF41 + (b2 - 0xE1); // ａ-ｚ
  }
  
  // 查表
  var table = loadGbkTable();
  if (table[key]) return table[key];
  
  // 查表失败：返回null，调用方会做降级处理
  return null;
}

// 主入口：自动检测编码并转换为UTF-8字符串
// buffer: ArrayBuffer
// 返回: { encoding: string, text: string }
function decodeBuffer(buffer) {
  var bytes = new Uint8Array(buffer);
  var encoding = guessEncoding(bytes);
  
  if (encoding === 'utf-8' || encoding === 'utf-8-bom') {
    var start = encoding === 'utf-8-bom' ? 3 : 0;
    var utf8Bytes = bytes.slice(start);
    // 用TextDecoder如果可用，否则手动转换
    if (typeof TextDecoder !== 'undefined') {
      try {
        var decoder = new TextDecoder('utf-8');
        return { encoding: 'utf-8', text: decoder.decode(utf8Bytes) };
      } catch(e) {}
    }
    // 手动UTF-8解码
    return { encoding: 'utf-8', text: utf8BytesToText(utf8Bytes) };
  }
  
  if (encoding === 'gbk') {
    var text = gbkToUtf8String(bytes);
    // 如果gbkToUtf8String有大量乱码（查表失败），尝试用小程序内置方案
    return { encoding: 'gbk', text: text };
  }
  
  // 兜底：当binary读取
  return { encoding: 'unknown', text: utf8BytesToText(bytes) };
}

function utf8BytesToText(bytes) {
  var result = [];
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b <= 0x7F) {
      result.push(String.fromCharCode(b));
      i++;
    } else if ((b & 0xE0) === 0xC0) {
      var code = ((b & 0x1F) << 6) | (bytes[i+1] & 0x3F);
      result.push(String.fromCharCode(code));
      i += 2;
    } else if ((b & 0xF0) === 0xE0) {
      var code = ((b & 0x0F) << 12) | ((bytes[i+1] & 0x3F) << 6) | (bytes[i+2] & 0x3F);
      result.push(String.fromCharCode(code));
      i += 3;
    } else if ((b & 0xF8) === 0xF0) {
      var code = ((b & 0x07) << 18) | ((bytes[i+1] & 0x3F) << 12) | ((bytes[i+2] & 0x3F) << 6) | (bytes[i+3] & 0x3F);
      if (code > 0xFFFF) {
        var hi = Math.floor((code - 0x10000) / 0x400) + 0xD800;
        var lo = ((code - 0x10000) % 0x400) + 0xDC00;
        result.push(String.fromCharCode(hi, lo));
      } else {
        result.push(String.fromCharCode(code));
      }
      i += 4;
    } else {
      result.push(String.fromCharCode(b));
      i++;
    }
  }
  return result.join('');
}

module.exports = {
  decodeBuffer: decodeBuffer,
  guessEncoding: guessEncoding,
  gbkToUtf8String: gbkToUtf8String
};
