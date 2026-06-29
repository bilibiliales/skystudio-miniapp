// pages/index/index.js

var app = getApp()
var zipHelper = require('./zipHelper.js')

// ===== 编码辅助函数 =====
function utf8ArrayToString(bytes) {
  var result = []
  var i = 0
  while (i < bytes.length) {
    var b = bytes[i]
    if (b <= 0x7F) { result.push(String.fromCharCode(b)); i++ }
    else if ((b & 0xE0) === 0xC0) {
      result.push(String.fromCharCode(((b & 0x1F) << 6) | (bytes[i+1] & 0x3F))); i += 2
    } else if ((b & 0xF0) === 0xE0) {
      result.push(String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i+1] & 0x3F) << 6) | (bytes[i+2] & 0x3F))); i += 3
    } else if ((b & 0xF8) === 0xF0) {
      var code = ((b & 0x07) << 18) | ((bytes[i+1] & 0x3F) << 12) | ((bytes[i+2] & 0x3F) << 6) | (bytes[i+3] & 0x3F)
      if (code > 0xFFFF) {
        var hi = Math.floor((code - 0x10000) / 0x400) + 0xD800
        var lo = ((code - 0x10000) % 0x400) + 0xDC00
        result.push(String.fromCharCode(hi, lo))
      } else { result.push(String.fromCharCode(code)) }
      i += 4
    } else { result.push(String.fromCharCode(b)); i++ }
  }
  return result.join('')
}
function isLikelyGBK(bytes) {
  var gbkLike = 0, total = 0
  for (var i = 0; i < bytes.length - 1; i += Math.max(1, Math.floor(bytes.length / 300))) {
    var b1 = bytes[i], b2 = bytes[i+1]
    if (b1 >= 0x81 && b1 <= 0xFE && b2 >= 0x40 && b2 !== 0x7F && b2 <= 0xFE) gbkLike++
    total++
    if (total > 300) break
  }
  return total > 0 && (gbkLike / total) > 0.25
}
function gbkArrayToString(bytes) {
  // 纯JS实现GBK解码（不依赖TextDecoder）
  // GBK双字节范围：0x81-0xFE + 0x40-0xFE（排除0x7F）
  var result = []
  for (var i = 0; i < bytes.length; i++) {
    var b1 = bytes[i]
    if (b1 < 0x80) {
      // ASCII单字节
      result.push(String.fromCharCode(b1))
    } else if (b1 >= 0x81 && b1 <= 0xFE && i + 1 < bytes.length) {
      var b2 = bytes[i + 1]
      if (b2 >= 0x40 && b2 !== 0x7F && b2 <= 0xFE) {
        // GBK双字节：查表或近似映射
        // 先用常见GBK->Unicode近似映射（覆盖大部分中文）
        var code = gbkToUnicode(b1, b2)
        if (code) {
          if (code > 0xFFFF) {
            var hi = Math.floor((code - 0x10000) / 0x400) + 0xD800
            var lo = ((code - 0x10000) % 0x400) + 0xDC00
            result.push(String.fromCharCode(hi, lo))
          } else {
            result.push(String.fromCharCode(code))
          }
        } else {
          // 查不到就保留原始字节
          result.push(String.fromCharCode(b1, b2))
        }
        i++
      } else {
        result.push(String.fromCharCode(b1))
      }
    } else {
      result.push(String.fromCharCode(b1))
    }
  }
  return result.join('')
}

// 常见GBK字符→Unicode近似映射（覆盖大部分中文）
function gbkToUnicode(b1, b2) {
  // GBK的汉字区：0xB0A1-0xF7FE 对应 Unicode 0x4E00-0x9FA5
  // 简化映射：用code page 936近似算法
  if (b1 >= 0xB0 && b1 <= 0xF7) {
    var offset = (b1 - 0xB0) * 94 + (b2 - 0xA1)
    if (offset >= 0) return 0x4E00 + offset  // 近似对应常用汉字
  }
  // ASCII可打印字符
  if (b1 === 0xA3 && b2 >= 0xA1 && b2 <= 0xFE) return 0xFF01 + (b2 - 0xA1)  // 全角字符
  return null  // 让调用方决定如何处理
}

// ===== 解密算法 =====
var ENC_RAGUS = [0x0E,0x18,0x76,0x08,0x7C,0x0B,0x27,0x77,0x0F,0x16,0x1C,0x02,0x1C,0x6D,0x67,0x21,0x34,0x0F,0x6D,0x2C,0x65,0x3C,0x23,0x79,0x11,0x32,0x28,0x63,0x17,0x32,0x2F,0x2F]
var ENC_TLAS  = [0x20,0x2E,0x18,0x05,0x31,0x3B,0x1C,0x3F,0x0B,0x3F,0x75,0x2D,0x3B,0x62,0x11,0x2B,0x21,0x28,0x05,0x30,0x20,0x7B,0x28,0x67,0x0A,0x07,0x73,0x32,0x0B,0x16,0x72,0x3C]
var XOR_KEY = 0x5A

function decryptKey(data) {
  var r = ''
  for (var i = 0; i < data.length; i++) r += String.fromCharCode(data[i] ^ XOR_KEY)
  return r
}
var RAGUS = decryptKey(ENC_RAGUS)
var TLAS  = decryptKey(ENC_TLAS)

function decrypt(shortList, onLog) {
  var result = ''
  for (var i = 0; i < shortList.length; i++) {
    var val = shortList[i]
    var kc = RAGUS.charAt(i % RAGUS.length)
    var d = val - kc.charCodeAt(0) + 100
    if (d >= 0 && d < 0x110000) {
      result += String.fromCharCode(d)
    } else {
      if (onLog) onLog('[!] warn: pos ' + i + ' val=' + d)
      result += '?'
    }
  }
  var idx = result.indexOf(TLAS)
  if (idx !== -1) result = result.substring(0, idx)
  return result
}

function decryptContent(jsonContent, onLog) {
  try {
    if (onLog) onLog('[*] decrypt start...')
    var dataArray = JSON.parse(jsonContent)
    if (dataArray.length === 0) throw new Error('empty file')
    var song = dataArray[0]
    if (!song.isEncrypted) {
      if (onLog) onLog('[*] not encrypted, skip')
      return jsonContent
    }
    if (onLog) onLog('[*] decrypting...')
    var decryptedJson = decrypt(song.songNotes, onLog)
    if (onLog) onLog('[*] parse decrypted data...')
    var notesArray = JSON.parse(decryptedJson)
    var plaintext = {}
    for (var k in song) {
      if (k !== 'isEncrypted' && k !== 'keyVersion' && k !== 'songNotes') plaintext[k] = song[k]
    }
    plaintext.isEncrypted = false
    plaintext.songNotes = notesArray
    if (onLog) {
      onLog('[ok] decrypt done, notes=' + notesArray.length)
    }
    return JSON.stringify([plaintext])
  } catch (e) {
    if (onLog) onLog('[!] error: ' + e.message)
    throw e
  }
}

// ===== 转换工具 =====
var SEARCH1 = ['"1Key0"','"1Key1"','"1Key2"','"1Key3"','"1Key4"','"1Key5"','"1Key6"','"1Key7"','"1Key8"','"1Key9"','"1Key10"','"1Key11"','"1Key12"','"1Key13"','"1Key14"']
var SEARCH2 = ['"2Key0"','"2Key1"','"2Key2"','"2Key3"','"2Key4"','"2Key5"','"2Key6"','"2Key7"','"2Key8"','"2Key9"','"2Key10"','"2Key11"','"2Key12"','"2Key13"','"2Key14"']
var REPLACE  = ['"A1"','"A2"','"A3"','"A4"','"A5"','"A6"','"A7"','"B1"','"B2"','"B3"','"B4"','"B5"','"B6"','"B7"','"C1"']

function normalizeKeyNames(content) {
  var r = content
  for (var i = 0; i < SEARCH1.length; i++) r = r.replace(new RegExp(SEARCH1[i], 'g'), REPLACE[i])
  for (var i = 0; i < SEARCH2.length; i++) r = r.replace(new RegExp(SEARCH2[i], 'g'), REPLACE[i])
  return r
}

function getPaizi(bitsPerPage) {
  return Math.floor(Number(bitsPerPage || 0) / 4) + '/4'
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b) }

function buildTimingModel(songNotes) {
  console.log('[buildTimingModel] 输入 songNotes 长度:', songNotes ? songNotes.length : 'null');
  if (!Array.isArray(songNotes) || songNotes.length === 0) {
    console.log('[buildTimingModel] 输入无效，返回默认值');
    return { rawDurations: [], sleepUnits: [], unit: 1 }
  }
  var raw = [], uniq = [], fallback = 0
  for (var i = 0; i < songNotes.length - 1; i++) {
    var d = Math.round((songNotes[i+1].time || 0) - (songNotes[i].time || 0))
    console.log('[buildTimingModel] i=' + i + ' time[i]=' + (songNotes[i].time || 0) + ' time[i+1]=' + (songNotes[i+1].time || 0) + ' d=' + d);
    if (d > 0) {
      if (fallback === 0) fallback = d
      if (uniq.indexOf(d) === -1) uniq.push(d)
    }
  }
  console.log('[buildTimingModel] uniq=', JSON.stringify(uniq), 'fallback=', fallback);
  for (var i = 0; i < songNotes.length; i++) {
    var next = (i < songNotes.length - 1) ? (songNotes[i+1].time || 0) : ((songNotes[i].time || 0) + (fallback || 1))
    raw.push(Math.max(0, Math.round(next - (songNotes[i].time || 0))))
  }
  console.log('[buildTimingModel] raw=', JSON.stringify(raw.slice(0, 10)), '...');
  if (uniq.length === 0) {
    console.log('[buildTimingModel] uniq 为空，返回默认 sleepUnits');
    return { rawDurations: raw, sleepUnits: raw.map(function(){return 0}), unit: 1 }
  }
  var unit = uniq[0]
  for (var i = 1; i < uniq.length; i++) unit = gcd(unit, uniq[i])
  console.log('[buildTimingModel] unit=', unit);
  var sleepUnits = raw.map(function(d){ return d > 0 ? Math.round(d / unit) : 0 })
  console.log('[buildTimingModel] sleepUnits=', JSON.stringify(sleepUnits.slice(0, 10)), '...');
  return { rawDurations: raw, sleepUnits: sleepUnits, unit: unit }
}

// ===== 简谱绘图工具 =====
var NOTATION_BEATS_PER_MEASURE = 4;
var NOTATION_MEASURES_PER_LINE = 4;

var keyOrder = ['A1','A2','A3','A4','A5','A6','A7','B1','B2','B3','B4','B5','B6','B7','C1'];

function getKeyIndex(keyName) {
  return keyOrder.indexOf(keyName);
}

function getNumberedNotationParts(keyName) {
  var keyIndex = getKeyIndex(keyName);
  if (keyIndex < 0) {
    return { digit: '?', dots: 0 };
  }
  return {
    digit: String((keyIndex % 7) + 1),
    dots: Math.floor(keyIndex / 7)
  };
}

function buildNotationGroups(songNotes) {
  var groups = [];
  for (var i = 0; i < songNotes.length; i++) {
    var note = songNotes[i];
    var time = Math.round(Number(note.time) || 0);
    var lastGroup = groups[groups.length - 1];
    var canAppendToLastGroup = lastGroup ? (lastGroup.time === time) : false;
    if (canAppendToLastGroup) {
      lastGroup.notes.push(note);
      lastGroup.noteIndices.push(i);
    } else {
      groups.push({
        time: time,
        notes: [note],
        noteIndices: [i]
      });
    }
  }
  return groups;
}

function createEmptyNotationMeasures(count) {
  var measures = [];
  for (var i = 0; i < count; i++) {
    var measure = [];
    for (var j = 0; j < NOTATION_BEATS_PER_MEASURE; j++) {
      measure.push([]);
    }
    measures.push(measure);
  }
  return measures;
}

function buildNotationMeasures(songNotes, bpm) {
  var noteGroups = buildNotationGroups(songNotes);
  if (noteGroups.length === 0) {
    return createEmptyNotationMeasures(1);
  }
  var timingModel = buildTimingModel(songNotes);
  var beatDuration = timingModel.unit || 1;
  var measureDuration = beatDuration * NOTATION_BEATS_PER_MEASURE;
  var startTime = 0;
  var lastRelativeTime = Math.max(0, noteGroups[noteGroups.length - 1].time - startTime);
  var initialMeasureCount = Math.max(1, Math.floor((lastRelativeTime + 0.001) / measureDuration) + 1);
  var measures = createEmptyNotationMeasures(initialMeasureCount);
  
  for (var g = 0; g < noteGroups.length; g++) {
    var group = noteGroups[g];
    var relativeTime = Math.max(0, group.time - startTime);
    var measureIndex = Math.floor((relativeTime + 0.001) / measureDuration);
    var measureOffset = relativeTime - (measureIndex * measureDuration);
    
    if (measureOffset < 0) measureOffset = 0;
    
    var beatIndex = Math.floor((measureOffset + 0.001) / beatDuration);
    if (beatIndex >= NOTATION_BEATS_PER_MEASURE) {
      measureIndex += 1;
      beatIndex = 0;
      measureOffset = 0;
    }
    
    while (measureIndex >= measures.length) {
      measures.push(createEmptyNotationMeasures(1)[0]);
    }
    
    var beatStart = beatIndex * beatDuration;
    var beatOffset = Math.max(0, Math.min(1, (measureOffset - beatStart) / beatDuration));
    
    var noteInfos = [];
    for (var n = 0; n < group.notes.length; n++) {
      noteInfos.push({
        key: group.notes[n].key,
        noteIndex: group.noteIndices[n]
      });
    }
    noteInfos.sort(function(a, b) {
      return getKeyIndex(b.key) - getKeyIndex(a.key);
    });
    
    measures[measureIndex][beatIndex].push({
      beatOffset: beatOffset,
      noteInfos: noteInfos,
      noteIndices: group.noteIndices
    });
  }
  
  return measures;
}

// ===== 生成代码 =====
function parseMeta(content) {
  try {
    var arr = JSON.parse(content)
    if (!Array.isArray(arr) || arr.length === 0) return { valid: false, error: 'invalid file' }
    var s = arr[0]
    if (!s || typeof s !== 'object') return { valid: false, error: 'not object' }
    if (!Array.isArray(s.songNotes)) return { valid: false, error: 'no songNotes' }
    console.log("内容：" + content);
    return {
      valid: true,
      name: s.name || 'unknown',
      author: s.author || 'unknown',
      transcribedBy: s.transcribedBy || 'unknown',
      bpm: s.bpm || 120,
      bitsPerPage: s.bitsPerPage || 0,
      paizi: getPaizi(s.bitsPerPage || 0),
      isEncrypted: !!s.isEncrypted,
      noteCount: s.songNotes.length
    }
  } catch (e) { console.log("错误：" + e.message + "内容：" + content); return { valid: false, error: e.message } }
}

// ===== 生成代码 =====
function buildCode(songData, paizi, timingModel, unit) {
  var bpm = songData.bpm || 120
  var notes = Array.isArray(songData.songNotes) ? songData.songNotes : []
  if (!timingModel) timingModel = buildTimingModel(notes)
  if (!unit) unit = timingModel.unit
  var lines = []
  lines.push('const name = ' + JSON.stringify(songData.name || 'unknown') + ';')
  lines.push('const author = ' + JSON.stringify(songData.author || 'unknown') + ';')
  lines.push('const transcribedBy = ' + JSON.stringify(songData.transcribedBy || 'unknown') + ';')
  lines.push('console.log("name:" + name + " author:" + author);')
  lines.push('const BPM=' + bpm + ';const n=4;const m="' + paizi + '";var a=60000/BPM/' + unit + ';')
  for (var i = 0; i < notes.length; i++) {
    var key = notes[i].key
    var su  = timingModel.sleepUnits[i] || 0
    lines.push('zdjl.click(' + key + '.x,' + key + '.y,1);sleep(' + su + '*a);')
  }
  return lines.join('\n')
}

// ===== Page =====
Page({
  data: {
    isDarkMode: false,
    showSidebar: false,
    projectFiles: [],
    activeProjectId: null,
    activeProject: null,
    allSelected: false,
    selectedCount: 0,
    isPlaying: false,
    currentSpeed: 1,
    currentNoteIndex: 0,
    playProgress: 0,
    showNotation: false,
    showCode: false,
    isPaused: false,
    // ZIP Dialog 状态
    showZipDialog: false,
    zipFileName: '',
    zipFilePath: ''
  },

  audioBuffers: {},
  isPreviewing: false,
  playbackTimers: [],
  _idx: 0,
  _model: null,
  _unit: 1,

  onLoad: function() {
    try {
      var t = wx.getStorageSync('panelTheme')
      if (t) this.setData({ isDarkMode: t === 'dark' })
    } catch(e) {}
    
    // 初始化实例属性（Page 构造器中直接写的非函数属性不会被初始化）
    this.audioBuffers = {}
    this.isPreviewing = false
    this.playbackTimers = []
    this._idx = 0
    this._model = null
    this._unit = 1
    
    this._loadProjects()
    this._initAudio()
  },

  onUnload: function() {
    this._stopPlay()
    for (var k in this.audioBuffers) { try { this.audioBuffers[k].destroy() } catch(e){} }
  },

  // ---- 音频 ----
  _initAudio: function() {
    var self = this
    var sounds = ['b1','b2','b3','b4','b5','b6','b7','c1','c2','c3','c4','c5','c6','c7','d1']
    sounds.forEach(function(s) {
      var a = wx.createInnerAudioContext()
      a.src = '/sounds/' + s + '.mp3'
      a.obeyMuteSwitch = false
      a.onError(function(err){ console.error('audio fail ' + s, err) })
      self.audioBuffers[s] = a
    })
    console.log('[+] audio loaded')
  },

  _playNote: function(key) {
    var map = {'A1':'b1','A2':'b2','A3':'b3','A4':'b4','A5':'b5','A6':'b6','A7':'b7','B1':'c1','B2':'c2','B3':'c3','B4':'c4','B5':'c5','B6':'c6','B7':'c7','C1':'d1'}
    var s = map[key]
    if (s && this.audioBuffers[s]) {
      var a = this.audioBuffers[s]
      a.stop(); a.seek(0); a.play()
    }
  },

  // ---- 播放（数组方案：和弦同时播放）----
  _startPlay: function() {
    var p = this.data.activeProject
    if (!p || !p.notesData || p.notesData.length === 0) { wx.showToast({ title: '没有可播放的内容', icon: 'none' }); return }
    this._model = p._timingModel || null
    this._unit  = p._timingUnit  || 1
    
    // 添加调试日志
    console.log('[_startPlay] p._timingModel=', p._timingModel)
    console.log('[_startPlay] this._model=', this._model)
    if (this._model && this._model.sleepUnits) {
      console.log('[_startPlay] sleepUnits (前20个)=', JSON.stringify(this._model.sleepUnits.slice(0, 20)))
      console.log('[_startPlay] sleepUnits 长度=', this._model.sleepUnits.length)
    }
    
    this.isPreviewing = true
    // 如果不是从暂停状态恢复，则从头开始
    if (!this.data.isPaused) {
      this._idx = 0
    }
    this.playbackTimers = []
    this.setData({ isPlaying: true, isPaused: false, currentNoteIndex: this._idx, playProgress: this._idx / p.notesData.length })
    this._scheduleNext()
  },

  _scheduleNext: function() {
    if (!this.isPreviewing) return
    var self  = this
    var notes = this.data.activeProject.notesData
    var idx   = this._idx
    var model = this._model
    var unit  = this._unit
    var bpm   = this.data.activeProject.bpm || 120

    if (idx >= notes.length) {
      this.isPreviewing = false
      this.setData({ isPlaying: false })
      this.playbackTimers.forEach(function(t){ clearTimeout(t) })
      this.playbackTimers = []
      wx.showToast({ title: '播放完成', icon: 'success' })
      return
    }

    // 收集和弦：从 idx 开始，所有 sleepUnit=0 的音符一次性播放
    var chordEnd = idx
    if (model) {
      while (chordEnd < notes.length) {
        var su = model.sleepUnits[chordEnd] || 0
        if (su === 0 && chordEnd < notes.length - 1) {
          chordEnd++
        } else {
          break
        }
      }
    }
    // chordNotes = notes[idx .. chordEnd]
    for (var ci = idx; ci <= chordEnd; ci++) {
      self._playNote(notes[ci].key)
    }

    // 更新进度（显示到和弦最后一个音）
    var progress = Math.round(chordEnd / notes.length * 100)
    this.setData({ currentNoteIndex: chordEnd, playProgress: progress })

    // 计算延迟：直接使用 rawDurations（单位：毫秒）
    var delayMs = 50
    if (model && model.rawDurations && model.rawDurations[chordEnd] !== undefined) {
      var rawDuration = model.rawDurations[chordEnd] || 0
      if (rawDuration === 0 && chordEnd >= notes.length - 1) {
        // 最后一个音，使用默认值
        delayMs = 10
      } else {
        // rawDuration 已经是毫秒，除以 currentSpeed 实现变速
        delayMs = rawDuration / this.data.currentSpeed
      }
    }
    delayMs = Math.max(10, delayMs)  // 最小延时 10ms

    console.log('[play] chord ' + (idx+1) + '-' + (chordEnd+1) + '/' + notes.length + ' delay=' + delayMs.toFixed(2) + 'ms')

    this._idx = chordEnd + 1
    var tid = setTimeout(function() { self._scheduleNext() }, delayMs)
    this.playbackTimers.push(tid)
  },

  _pausePlay: function() {
    this.isPreviewing = false
    this.setData({ isPlaying: true, isPaused: true })
    this.playbackTimers.forEach(function(t){ clearTimeout(t) })
    this.playbackTimers = []
  },

  _stopPlay: function() {
    this.isPreviewing = false
    this._idx = 0
    this.setData({ isPlaying: false, isPaused: false, currentNoteIndex: 0, playProgress: 0 })
    this.playbackTimers.forEach(function(t){ clearTimeout(t) })
    this.playbackTimers = []
  },

  // ---- 侧边栏 ----
  onToggleSidebar: function() {
    this.setData({ showSidebar: !this.data.showSidebar })
  },
  onCloseSidebar: function() {
    this.setData({ showSidebar: false })
  },

  // ---- 主题 ----
  onThemeChange: function(e) {
    var d = !!e.detail.value
    this.setData({ isDarkMode: d })
    app.globalData.isDarkMode = d
    try { wx.setStorageSync('panelTheme', d ? 'dark' : 'light') } catch(ex) {}
  },

  // ---- 文件管理 ----
  _loadProjects: function() {
    try {
      var saved = wx.getStorageSync('projectFiles')
      if (saved) {
        var list = JSON.parse(saved)
        this.setData({
          projectFiles: list,
          selectedCount: list.filter(function(x){ return x.selected }).length,
          allSelected: list.length > 0 && list.every(function(x){ return x.selected })
        })
        var aid = wx.getStorageSync('activeProjectId')
        if (aid && list.some(function(x){ return x.id === aid })) this._setActive(aid, false)
      }
    } catch(e) { console.error('load fail', e) }
  },

  _saveProjects: function() {
    try {
      wx.setStorageSync('projectFiles', JSON.stringify(this.data.projectFiles))
      if (this.data.activeProjectId) {
        wx.setStorageSync('activeProjectId', this.data.activeProjectId)
      } else {
        wx.removeStorageSync('activeProjectId')
      }
    } catch(e) { console.error('save fail', e) }
  },

  // ---- 文件选择 ----
  onChooseFile: function() {
    var self = this
    wx.showActionSheet({
      itemList: ['从聊天选择'],
      success: function(res) {
        if (res.tapIndex === 0) {
          // 从聊天选择（wx.chooseMessageFile）
          wx.chooseMessageFile({
            count: 10, type: 'file', extension: ['txt'],
            success: function(r) {
              r.tempFiles.forEach(function(f){ self._readFile(f) })
              self.setData({ showSidebar: false })
            },
            fail: function(err) {
              if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return
              wx.showToast({ title: '选择文件失败', icon: 'none' })
            }
          })
        } else if (res.tapIndex === 1) {
          wx.showToast({ title: '当前版本不支持', icon: 'none' })
        }
      }
    })
  },

  // 纯 JS 实现 UTF-16 LE 解码器
  _decodeUTF16LE: function(uint8Array) {
    var str = '';
    // UTF-16LE 每两个字节代表一个字符
    for (var i = 0; i < uint8Array.length - 1; i += 2) {
      var codePoint = uint8Array[i] | (uint8Array[i + 1] << 8);
      // 处理代理对 (Surrogate Pairs)，支持 Emoji 等扩展字符
      if (codePoint >= 0xD800 && codePoint <= 0xDBFF && i + 3 < uint8Array.length) {
        var low = uint8Array[i + 2] | (uint8Array[i + 3] << 8);
        if (low >= 0xDC00 && low <= 0xDFFF) {
          var fullCode = ((codePoint - 0xD800) << 10) + (low - 0xDC00) + 0x10000;
          str += String.fromCodePoint(fullCode);
          i += 2; // 额外跳过两个字节
          continue;
        }
      }
      str += String.fromCharCode(codePoint);
    }
    return str;
  },

  // 纯 JS 实现 UTF-8 解码器（作为 TextDecoder 的兜底）
  _decodeUTF8: function(uint8Array) {
    var str = '';
    var i = 0;
    while (i < uint8Array.length) {
      var byte1 = uint8Array[i];
      if (byte1 < 0x80) {
        str += String.fromCharCode(byte1);
        i += 1;
      } else if (byte1 < 0xE0) {
        str += String.fromCharCode(((byte1 & 0x1F) << 6) | (uint8Array[i+1] & 0x3F));
        i += 2;
      } else if (byte1 < 0xF0) {
        str += String.fromCharCode(((byte1 & 0x0F) << 12) | ((uint8Array[i+1] & 0x3F) << 6) | (uint8Array[i+2] & 0x3F));
        i += 3;
      } else {
        var codePoint = ((byte1 & 0x07) << 18) | ((uint8Array[i+1] & 0x3F) << 12) | ((uint8Array[i+2] & 0x3F) << 6) | (uint8Array[i+3] & 0x3F);
        codePoint -= 0x10000;
        str += String.fromCharCode((codePoint >> 10) + 0xD800, (codePoint & 0x3FF) + 0xDC00);
        i += 4;
      }
    }
    return str;
  },

  // 读取文件（自动检测编码）
  _readFile: function(file) {
    var self = this
    var fs = wx.getFileSystemManager()
    // 以 ArrayBuffer 方式读取，在回调里同步解码
    fs.readFile({
      filePath: file.path,
      success: function(res) {
        var bytes = new Uint8Array(res.data)
        var content = ''

        // 0. 纯 JS 实现 UTF-16 LE 解码，完美避开 TextDecoder 兼容性问题
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
          content = self._decodeUTF16LE(bytes.slice(2)); // 必须 slice(2) 去掉 BOM 头
        } 
        // 1. 优先且严格处理 UTF-8 BOM
        else if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
          content = self._decodeUTF8(bytes.slice(3));
        } else {
          // 2. 尝试使用 TextDecoder 自动检测
          var decoded = false;
          if (typeof TextDecoder !== 'undefined') {
            try {
              // 优先尝试 utf-8
              var decoder = new TextDecoder('utf-8', { fatal: true });
              content = decoder.decode(bytes);
              decoded = true;
            } catch(e) {
              try {
                // 如果 utf-8 失败，尝试 gbk
                var decoder = new TextDecoder('gbk', { fatal: true });
                content = decoder.decode(bytes);
                decoded = true;
              } catch(e2) {
                // 若均失败，降级处理
              }
            }
          }
          
          // 3. 降级方案：启发式判断
          if (!decoded) {
            if (typeof isLikelyGBK === 'function' && isLikelyGBK(bytes)) {
              content = gbkArrayToString(bytes);
            } else {
              content = utf8ArrayToString(bytes);
            }
          }
        }

        content = content.replace(/^\uFEFF/, '').trim(); 

        // 安全地进行 JSON 解析
        try {
          // 解码完成，进入原有逻辑
          var meta = parseMeta(content)
          if (!meta.valid) {
            var inv = {
              id: Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),
              fileName: file.name, content: content, selected: true, meta: meta,
              sourceIsEncrypted: false, createdAt: Date.now(),
              decryptedSourceContent: null, generatedCode: '', scriptCode: '',
              notesData: null, bpm: 120, paizi: '0/4', _timingModel: null, _timingUnit: 1
            }
            var list = self.data.projectFiles; list.push(inv)
            self.setData({
              projectFiles: list,
              selectedCount: list.filter(function(x){return x.selected}).length,
              allSelected: list.length>0 && list.every(function(x){return x.selected})
            })
            self._saveProjects()
            return
          }
          var proj = {
            id: Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),
            fileName: file.name, content: content, selected: true, meta: meta,
            sourceIsEncrypted: meta.isEncrypted, createdAt: Date.now(),
            decryptedSourceContent: null, generatedCode: '', scriptCode: '',
            notesData: null, bpm: meta.bpm||120, paizi: meta.paizi||'0/4',
            _timingModel: null, _timingUnit: 1
          }
          if (!meta.isEncrypted) {
            self._convertProject(proj)
          } else {
            self._decryptProject(proj)
          }
        } catch (e) {
          console.error('JSON 解析失败，原始内容前100个字符:', content.slice(0, 100));
          wx.showToast({ title: '文件格式不正确', icon: 'none' });
        }
      },
      fail: function() { wx.showToast({ title: '读取文件失败', icon: 'none' }) }
    })
  },

  _decryptProject: function(proj) {
    try {
      var decrypted = decryptContent(proj.content, function(m){ console.log(m) })
      var normalized = normalizeKeyNames(decrypted)
      var song = JSON.parse(normalized)[0]
      if (song.isEncrypted) throw new Error('decrypt fail')
      var notes = Array.isArray(song.songNotes) ? song.songNotes : []
      if (notes.length === 0) throw new Error('no notes')
      var model = buildTimingModel(notes)
      proj._timingModel = model
      proj._timingUnit  = model.unit
      proj.decryptedSourceContent = decrypted
      proj.meta = parseMeta(normalized)
      proj.notesData = notes
      proj.generatedCode = buildCode(song, proj.meta.paizi, model, model.unit)
      proj.scriptCode   = '// Sky Studio auto-play script\n// Generated by Sky Studio Decrypt Tool\n\n' + proj.generatedCode
      proj.bpm  = song.bpm || 120
      proj.paizi = proj.meta.paizi || '0/4'
      var list = this.data.projectFiles; list.push(proj)
      this.setData({
        projectFiles: list,
        selectedCount: list.filter(function(x){return x.selected}).length,
        allSelected: list.length>0 && list.every(function(x){return x.selected})
      })
      this._setActive(proj.id, false)
      this._saveProjects()
      wx.showToast({ title: '解密成功', icon: 'success' })
    } catch(e) {
      console.error('[!] 解密失败:', e.message)
      wx.showToast({ title: '解密失败', icon: 'none' })
    }
  },

  _convertProject: function(proj) {
    try {
      var normalized = normalizeKeyNames(proj.content)
      var song = JSON.parse(normalized)[0]
      var notes = Array.isArray(song.songNotes) ? song.songNotes : []
      if (notes.length === 0) throw new Error('no notes')
      var model = buildTimingModel(notes)
      proj._timingModel = model
      proj._timingUnit  = model.unit
      proj.meta = parseMeta(normalized)
      proj.notesData = notes
      proj.generatedCode = buildCode(song, proj.meta.paizi, model, model.unit)
      proj.scriptCode   = '// Sky Studio auto-play script\n// Generated by Sky Studio Decrypt Tool\n\n' + proj.generatedCode
      proj.bpm  = song.bpm || 120
      proj.paizi = proj.meta.paizi || '0/4'
      var list = this.data.projectFiles; list.push(proj)
      this.setData({
        projectFiles: list,
        selectedCount: list.filter(function(x){return x.selected}).length,
        allSelected: list.length>0 && list.every(function(x){return x.selected})
      })
      this._setActive(proj.id, false)
      this._saveProjects()
      wx.showToast({ title: '转换成功', icon: 'success' })
    } catch(e) {
      console.error('[!] 转换失败:', e.message)
      wx.showToast({ title: '转换失败', icon: 'none' })
    }
  },

  _setActive: function(id, shouldSave) {
    var list = this.data.projectFiles
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        this.setData({ activeProjectId: id, activeProject: list[i], currentNoteIndex: 0, playProgress: 0 })
        break
      }
    }
    if (shouldSave !== false) this._saveProjects()
  },

  // ---- 文件列表操作 ----
  onToggleFileSelect: function(e) {
    var id = e.currentTarget.dataset.id
    var list = this.data.projectFiles
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].selected = !list[i].selected; break }
    }
    this.setData({
      projectFiles: list,
      selectedCount: list.filter(function(x){return x.selected}).length,
      allSelected: list.length>0 && list.every(function(x){return x.selected})
    })
    this._saveProjects()
  },

  onActivateProject: function(e) {
    this._setActive(e.currentTarget.dataset.id)
    this.setData({ showSidebar: false })
  },

  onFileLongPress: function(e) {
    var id = e.currentTarget.dataset.id
    var self = this
    wx.showActionSheet({
      itemList: ['download code', 'delete'],
      success: function(res) {
        if (res.tapIndex === 0) self._downloadSingle(id)
        if (res.tapIndex === 1) self._deleteProject(id)
      }
    })
  },

  onDeleteProject: function(e) {
    this._deleteProject(e.currentTarget.dataset.id)
  },

  _deleteProject: function(id) {
    var self = this
    wx.showModal({
      title: '确认删除', content: '删除这个项目吗？',
      success: function(res) {
        if (!res.confirm) return
        var list = self.data.projectFiles.filter(function(x){ return x.id !== id })
        var aid = self.data.activeProjectId
        var ap  = self.data.activeProject
        if (aid === id) {
          aid = list.length > 0 ? list[0].id : null
          ap  = aid ? list[0] : null
        }
        self.setData({
          projectFiles: list, activeProjectId: aid, activeProject: ap,
          selectedCount: list.filter(function(x){return x.selected}).length,
          allSelected: list.length>0 && list.every(function(x){return x.selected})
        })
        self._saveProjects()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  onToggleSelect: function() {
    var list = this.data.projectFiles
    var all = !this.data.allSelected
    list.forEach(function(x){ x.selected = all })
    this.setData({ projectFiles: list, allSelected: all,
      selectedCount: all ? list.length : 0
    })
    this._saveProjects()
  },

  onClearList: function() {
    var self = this
    wx.showModal({
      title: '确认清空', content: '清空所有项目吗？',
      success: function(res) {
        if (!res.confirm) return
        self.setData({ projectFiles: [], activeProjectId: null, activeProject: null, selectedCount: 0, allSelected: false })
        self._saveProjects()
        wx.showToast({ title: '已清空', icon: 'success' })
      }
    })
  },

  // ---- 批量下载 ----
  onBatchDownloadIndividual: function() {
    var list = this.data.projectFiles.filter(function(x){ return x.selected })
    if (list.length === 0) { wx.showToast({ title: '请先选择文件', icon: 'none' }); return }
    
    wx.showLoading({ title: '生成ZIP中...' })
    
    // 准备ZIP文件列表：将选中的文件转为未加密的源文件
    var files = []
    for (var i = 0; i < list.length; i++) {
      var proj = list[i]
      var fname = ''
      var fileContent = ''
      
      if (!proj.sourceIsEncrypted) {
        // 【未加密】原样导出，修改信息生效
        try {
          var songArr = JSON.parse(proj.content)
          if (Array.isArray(songArr) && songArr[0]) {
            songArr[0].name = proj.meta.name || songArr[0].name
            songArr[0].author = proj.meta.author || songArr[0].author
            songArr[0].bpm = proj.meta.bpm || songArr[0].bpm
            songArr[0].transcribedBy = proj.meta.transcribedBy || songArr[0].transcribedBy
            fileContent = JSON.stringify(songArr, null, 2)
          } else { fileContent = proj.content }
        } catch(e) { fileContent = proj.content }
        fname = proj.fileName || 'project.txt'
        if (!/\.txt$/i.test(fname)) fname = fname + '.txt'
      } else {
        // 【已加密】导出为可读 txt
        var decrypted = proj.decryptedSourceContent || ''
        if (!decrypted) {
          try { decrypted = decryptContent(proj.content, null) } catch(e) { decrypted = proj.content }
        }
        try {
          var songArr = JSON.parse(decrypted)
          if (Array.isArray(songArr) && songArr[0]) {
            var song = songArr[0], lines = []
            lines.push('========================================')
            lines.push('  Song: ' + (song.name || 'Unknown'))
            lines.push('  Author: ' + (song.author || 'Unknown'))
            lines.push('  BPM: ' + (song.bpm || 120))
            lines.push('  TranscribedBy: ' + (song.transcribedBy || ''))
            lines.push('========================================')
            lines.push('')
            var notes = song.songNotes || []
            lines.push('Notes (' + notes.length + '):')
            notes.forEach(function(n, idx) {
              lines.push('  [' + idx + ']  time=' + n.time + '  key=' + n.key + '  duration=' + (n.duration || 0))
            })
            fileContent = lines.join('\n')
          } else { fileContent = decrypted }
        } catch(e) { fileContent = decrypted }
        fname = (proj.meta.name || 'project') + '_decrypted.txt'
      }

      files.push({
        name: fname,
        content: fileContent
      })
    }
    
    if (files.length === 0) {
      wx.hideLoading()
      wx.showToast({ title: '没有可打包的文件', icon: 'none' })
      return
    }
    
    
    // 生成ZIP
    var zipData = zipHelper.createZipBlob(files)

    
    // 保存到本地
    var fname = 'skystudio_projects.zip'
    var fpath = wx.env.USER_DATA_PATH + '/' + fname
    var fs = wx.getFileSystemManager()
    var self = this
    
    // 将Uint8Array转换为ArrayBuffer
    var buffer = zipData.buffer.slice(zipData.byteOffset, zipData.byteOffset + zipData.byteLength)

    fs.writeFile({
      filePath: fpath,
      data: buffer,
      success: function() {
        wx.hideLoading()
        // 显示自定义Dialog（避免wx.showModal和hideLoading冲突）
        self.setData({
          showZipDialog: true,
          zipFileName: fname,
          zipFilePath: fpath
        })
      },
      fail: function() {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  _downloadSingle: function(id) {
    var list = this.data.projectFiles
    var proj = null
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { proj = list[i]; break } }
    if (!proj || !proj.generatedCode) { wx.showToast({ title: '没有代码', icon: 'none' }); return }
    var fname = (proj.meta.name || 'project') + '_code.txt'
    var fpath = wx.env.USER_DATA_PATH + '/' + fname
    var fs = wx.getFileSystemManager()
    fs.writeFile({
      filePath: fpath, data: proj.generatedCode, encoding: 'utf-8',
      success: function() {
        // 保存成功后，提供用户操作选项
        wx.showActionSheet({
          itemList: ['分享到聊天', '复制代码内容'],
          success: function(res) {
            if (res.tapIndex === 0) {
              // 分享到聊天
              wx.shareFileMessage({
                filePath: fpath, fileName: fname,
                success: function() { wx.showToast({ title: '已分享', icon: 'success' }) },
                fail: function() { 
                  // 分享失败，自动复制到剪贴板
                  wx.setClipboardData({
                    data: proj.generatedCode,
                    success: function() { wx.showToast({ title: '分享失败，代码已复制', icon: 'none' }) }
                  })
                }
              })
            } else if (res.tapIndex === 1) {
              // 复制代码内容
              wx.setClipboardData({
                data: proj.generatedCode,
                success: function() { wx.showToast({ title: '代码已复制', icon: 'success' }) }
              })
            }
          }
        })
      },
      fail: function(){ wx.showToast({ title: '保存失败', icon: 'none' }) }
    })
  },

  // ---- 代码操作 ----
  onCopyCode: function() {
    var code = this.data.activeProject ? this.data.activeProject.generatedCode : ''
    if (!code) { wx.showToast({ title: '没有代码', icon: 'none' }); return }
    wx.setClipboardData({ data: code, success: function(){ wx.showToast({ title: '已复制', icon: 'success' }) } })
  },

  onDownloadCode: function() {
    var p = this.data.activeProject
    if (!p || !p.generatedCode) { wx.showToast({ title: '没有代码', icon: 'none' }); return }
    var fname = (p.meta.name || 'skystudio') + '_code.txt'
    var fpath = wx.env.USER_DATA_PATH + '/' + fname
    var fs = wx.getFileSystemManager()
    var self = this
    fs.writeFile({
      filePath: fpath, data: p.generatedCode, encoding: 'utf-8',
      success: function() {
        wx.shareFileMessage({
          filePath: fpath, fileName: fname,
          success: function(){ wx.showToast({ title: '已分享', icon: 'success' }) },
          fail: function() {
            wx.showModal({ title: '已保存', content: '文件已保存到本地缓存', showCancel: false })
          }
        })
      },
      fail: function(){ wx.showToast({ title: '保存失败', icon: 'none' }) }
    })
  },

  onExportImage: function() {
    var p = this.data.activeProject
    if (!p || !p.meta || !p.meta.valid) { wx.showToast({ title: '没有可导出的内容', icon: 'none' }); return }
    wx.showLoading({ title: '生成中...' })
    var ctx = wx.createCanvasContext('notationCanvas')
    var dark = this.data.isDarkMode
    
    // 画布尺寸
    var canvasWidth = 375
    var canvasHeight = 500
    var left = 20, right = 20, top = 100, bottom = 40
    var measureWidth = 80
    var beatWidth = measureWidth / NOTATION_BEATS_PER_MEASURE
    var lineHeight = 30
    
    // 背景
    ctx.setFillStyle(dark ? '#1e1e1e' : '#ffffff')
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    
    // 标题区域
    ctx.setFontSize(16)
    ctx.setFillStyle(dark ? '#e8edf4' : '#262626')
    ctx.fillText('Song: ' + (p.meta.name || ''), 20, 30)
    ctx.fillText('Author: ' + (p.meta.author || ''), 20, 55)
    ctx.fillText('BPM: ' + (p.meta.bpm || 0), 20, 80)
    
    // 构建小节数据
    var measures = []
    if (p.notesData && p.notesData.length > 0) {
      measures = buildNotationMeasures(p.notesData, p.meta.bpm || 120)
    }
    
    // 计算总行数
    var lineCount = Math.max(1, Math.ceil(measures.length / NOTATION_MEASURES_PER_LINE))
    canvasHeight = top + (lineCount * lineHeight) + bottom
    
    // 重新绘制背景（高度可能变化）
    ctx.setFillStyle(dark ? '#1e1e1e' : '#ffffff')
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    
    // 重新绘制标题
    ctx.setFontSize(16)
    ctx.setFillStyle(dark ? '#e8edf4' : '#262626')
    ctx.fillText('Song: ' + (p.meta.name || ''), 20, 30)
    ctx.fillText('Author: ' + (p.meta.author || ''), 20, 55)
    ctx.fillText('BPM: ' + (p.meta.bpm || 0), 20, 80)
    
    // 绘制简谱
    ctx.setFontSize(14)
    for (var lineStart = 0; lineStart < measures.length; lineStart += NOTATION_MEASURES_PER_LINE) {
      var lineIndex = Math.floor(lineStart / NOTATION_MEASURES_PER_LINE)
      var y = top + (lineIndex * lineHeight) + 20
      
      for (var measureOffset = 0; measureOffset < NOTATION_MEASURES_PER_LINE; measureOffset++) {
        var measureIndex = lineStart + measureOffset
        if (measureIndex >= measures.length) break
        
        var measure = measures[measureIndex]
        var measureX = left + (measureOffset * measureWidth)
        
        // 绘制小节线
        ctx.setStrokeStyle(dark ? '#e8edf4' : '#262626')
        ctx.setLineWidth(1)
        ctx.beginPath()
        ctx.moveTo(measureX, y - 15)
        ctx.lineTo(measureX, y + 5)
        ctx.stroke()
        
        // 绘制拍子
        for (var beatIndex = 0; beatIndex < NOTATION_BEATS_PER_MEASURE; beatIndex++) {
          var beatX = measureX + (beatIndex * beatWidth) + 10
          var events = measure[beatIndex]
          
          if (events.length === 0) {
            // 空拍，绘制横线
            ctx.setStrokeStyle(dark ? '#666666' : '#cccccc')
            ctx.beginPath()
            ctx.moveTo(beatX, y)
            ctx.lineTo(beatX + beatWidth - 20, y)
            ctx.stroke()
          } else {
            // 绘制音符
            for (var e = 0; e < events.length; e++) {
              var event = events[e]
              var noteY = y - (e * 16)
              
              for (var n = 0; n < event.noteInfos.length; n++) {
                var noteInfo = event.noteInfos[n]
                var parts = getNumberedNotationParts(noteInfo.key)
                var noteX = beatX + (n * 12)
                
                // 绘制数字
                ctx.setFillStyle(dark ? '#e8edf4' : '#262626')
                ctx.fillText(parts.digit, noteX, noteY)
                
                // 绘制高音/低音点
                if (parts.dots > 0) {
                  // 高音点（在上方）
                  for (var d = 0; d < parts.dots; d++) {
                    ctx.fillText('.', noteX + 8, noteY - 10 - (d * 6))
                  }
                } else if (parts.dots < 0) {
                  // 低音点（在下方）
                  for (var d = 0; d < -parts.dots; d++) {
                    ctx.fillText('.', noteX + 8, noteY + 10 + (d * 6))
                  }
                }
              }
            }
          }
        }
        
        // 绘制小节结束线
        ctx.setStrokeStyle(dark ? '#e8edf4' : '#262626')
        ctx.beginPath()
        ctx.moveTo(measureX + measureWidth - 1, y - 15)
        ctx.lineTo(measureX + measureWidth - 1, y + 5)
        ctx.stroke()
      }
    }
    
    var self = this
    ctx.draw(false, function() {
      wx.canvasToTempFilePath({
        canvasId: 'notationCanvas',
        success: function(res) {
          wx.hideLoading()
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: function(){ wx.showToast({ title: '已保存到相册', icon: 'success' }) },
            fail: function() {
              wx.shareFileMessage({
                filePath: res.tempFilePath,
                fileName: (p.meta.name || 'notation') + '.png',
                success: function(){ wx.showToast({ title: '已分享', icon: 'success' }) },
                fail: function(){ wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) }
              })
            }
          })
        },
        fail: function(){ wx.hideLoading(); wx.showToast({ title: '导出失败', icon: 'none' }) }
      })
    })
  },

  // ---- UI ----
  onToggleCode: function() {
    this.setData({ showCode: !this.data.showCode })
  },

  onTogglePlay: function() {
    if (this.isPreviewing) { 
      // 当前正在播放，执行暂停
      this._pausePlay() 
    } else if (this.data.isPaused) { 
      // 当前已暂停，执行继续播放（从当前位置）
      this.isPreviewing = true
      this.setData({ isPlaying: true, isPaused: false })
      this._scheduleNext()
    } else { 
      // 当前已停止，执行从头播放
      this._startPlay() 
    }
  },

  onStop: function() {
    this._stopPlay()
  },

  onSpeedChange: function(e) {
    this.setData({ currentSpeed: e.detail.value })
  },

  onSongInfoInput: function(e) {
    var field = e.currentTarget.dataset.field
    var val   = e.detail.value
    var ap    = this.data.activeProject
    if (!ap) return
    var meta = ap.meta
    if (field === 'name')        meta.name = val
    if (field === 'author')      meta.author = val
    if (field === 'bpm')        meta.bpm = (Number(val) >= 1 && Number(val) <= 999) ? Number(val) : 120
    if (field === 'transcribedBy') meta.transcribedBy = val
    if (ap.notesData && ap.notesData.length > 0) {
      try {
        var src  = ap.decryptedSourceContent || ap.content
        var song = JSON.parse(src)[0]
        song.name = meta.name; song.author = meta.author; song.bpm = meta.bpm; song.transcribedBy = meta.transcribedBy
        var model = buildTimingModel(ap.notesData)
        ap._timingModel = model
        ap._timingUnit  = model.unit
        ap.generatedCode = buildCode(song, meta.paizi, model, model.unit)
        ap.scriptCode   = '// Sky Studio auto-play script\n// Generated by Sky Studio Decrypt Tool\n\n' + ap.generatedCode
        var list = this.data.projectFiles
        for (var i = 0; i < list.length; i++) { if (list[i].id === ap.id) { list[i] = ap; break } }
        this.setData({ activeProject: ap, projectFiles: list })
        this._saveProjects()
      } catch(ex) { console.error('update meta fail', ex) }
    }
  },

  onShareAppMessage: function() {
    return { title: 'Sky Studio 解密工具', path: '/pages/index/index' };
  },

  // ---- ZIP Dialog 操作 ----
  onCloseZipDialog: function() {
    this.setData({ showZipDialog: false, zipFileName: '', zipFilePath: '' })
  },

  onShareZipFile: function() {
    var fpath = this.data.zipFilePath
    var fname = this.data.zipFileName
    var self = this

    // 检测是否在模拟器环境（模拟器不支持大文件分享）
    var isDevTool = typeof __wxConfig !== 'undefined'

    if (isDevTool) {
      wx.showModal({
        title: '提示',
        content: '模拟器不支持分享大文件，请在真机上测试。',
        showCancel: false
      })
      return
    }

    // 真机环境
    
    // 先关闭Dialog，再分享（避免遮挡）
    self.setData({ showZipDialog: false })
    
    // 尝试分享到聊天
    wx.shareFileMessage({
      filePath: fpath,
      fileName: fname,
      success: function() { 
        wx.showToast({ title: '已分享', icon: 'success' }) 
      },
      fail: function() { 
        // 分享失败，提示用户手动保存
        self.setData({ showZipDialog: true }) // 重新显示Dialog
        wx.showToast({ title: '分享失败，请尝试其他方式', icon: 'none' })
      }
    })
  }
})

