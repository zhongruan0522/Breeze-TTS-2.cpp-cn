// built-in english and chinese strings for the web ui
(function () {
  "use strict";

  const STORE_KEY = "breeze.lang";

  const DICT = {
    en: {
      "app.title": "Breeze-TTS-2 · WebUI",
      "lang.label": "Language",

      "header.sub": "open-weight bilingual text to speech, running on ggml. voice design, cloning, direction, conversion.",

      "tab.design": "VOICE DESIGN",
      "tab.clone": "VOICE CLONE",
      "tab.direction": "VOICE DIRECTION",
      "tab.changer": "VOICE CHANGER",
      "tab.library": "VOICE LIBRARY",

      "field.text": "TEXT TO SPEAK",
      "field.voiceDesc": "VOICE DESCRIPTION",
      "field.direction": "DIRECTION",
      "field.cfg": "CFG SCALE",
      "field.seed": "SEED",
      "field.savedVoice": "SAVED VOICE",
      "field.refAudio": "REFERENCE AUDIO (WAV)",
      "field.refText": "REFERENCE TRANSCRIPT (EXACT)",
      "field.descOptional": "DESCRIPTION (OPTIONAL, SAVED WITH THE VOICE)",
      "field.saveAs": "SAVE AS",
      "field.sourceAudio": "SOURCE AUDIO (WAV)",
      "field.targetVoice": "TARGET VOICE (WAV)",
      "field.targetRefText": "TARGET VOICE TRANSCRIPT (EXACT)",
      "field.sourceText": "SOURCE TRANSCRIPT (OPTIONAL, SHARPENS THE WORDS)",
      "field.keepMelody": "KEEP MELODY",
      "field.filter": "FILTER",
      "field.description": "DESCRIPTION",
      "field.extra": "EXTRA FIELDS",

      "ph.text.design": "Welcome aboard. Your journey begins now.",
      "ph.desc.design": "A warm, thoughtful young woman with a clear, calm delivery.",
      "ph.text.clone": "It is good to hear your voice again after all this time.",
      "ph.text.direction": "We need to discuss what happened last night.",
      "ph.direction": "Speak slowly with a restrained, serious tone.",
      "ph.refText": "This is the exact transcript of the reference audio.",
      "ph.targetRefText": "This is the exact transcript of the target voice clip.",
      "ph.saveDesc": "Gravelly older narrator, slow and warm. Good for audiobooks.",
      "ph.saveName": "my_voice",
      "ph.sourceText": "Leave empty unless you have the exact words of the source.",
      "ph.filter": "name, description, transcript or field",
      "ph.metaKey": "field",
      "ph.metaValue": "value",
      "ph.voiceDescCard": "what this voice sounds like, where it came from, what it is good for",

      "btn.generate": "GENERATE",
      "btn.convert": "CONVERT",
      "btn.saveVoice": "SAVE VOICE",
      "btn.refresh": "REFRESH",
      "btn.stop": "STOP",
      "btn.download": "DOWNLOAD WAV",
      "btn.use": "USE",
      "btn.addField": "+ FIELD",
      "btn.saveChanges": "SAVE CHANGES",

      "note.changer": "respeaks an existing recording in another voice, keeping its words and timing. no text needed. pitch normally comes from the target voice, so raise KEEP MELODY if the source is sung or strongly intonated.",

      "option.upload": "upload a clip instead",
      "option.temporary": "temporary",
      "output.stream": "STREAM WHILE GENERATING",
      "output.buffer": "BUFFER",
      "status.idle": "IDLE",

      "status.textRequired": "TEXT IS REQUIRED",
      "status.encoding": "ENCODING REFERENCE ...",
      "status.encodeFailed": "could not encode the reference",
      "status.connecting": "CONNECTING ...",
      "status.streaming": "STREAMING - {secs}s",
      "status.streamingShort": "STREAMING ...",
      "status.streamingRebuffer": "STREAMING - {secs}s  ({n} REBUFFER)",
      "status.generating": "GENERATING - {secs}s",
      "status.generatingShort": "GENERATING ...",
      "status.generatingRebuffer": "GENERATING - {secs}s  ({n} REBUFFER)",
      "status.queued": "QUEUED, WAITING FOR THE GPU ...",
      "status.stopped": "STOPPED",
      "status.stoppedSecs": "STOPPED - {secs}s",
      "status.done": "DONE - {audio}s audio in {wall}s, {rtf}x @ {sr}Hz",
      "status.error": "ERROR: {msg}",
      "status.errorCode": "ERROR {code}",
      "status.unknown": "unknown",
      "status.wsError": "WEBSOCKET ERROR",
      "status.converting": "CONVERTING ...",
      "status.receiving": "RECEIVING - {secs}s",
      "status.busy": "BUSY - ONE REQUEST AT A TIME",
      "status.savingVoice": "SAVING VOICE ...",
      "status.saved": "SAVED {id} - {secs}s",
      "status.nameFirst": "NAME THE VOICE FIRST",
      "status.nameBad": "NAME CAN ONLY USE LETTERS, DIGITS, DASH AND UNDERSCORE",
      "status.saveNeedClip": "A CLIP AND ITS TRANSCRIPT ARE REQUIRED TO SAVE A VOICE",
      "status.sourceRequired": "A SOURCE WAV IS REQUIRED",
      "status.targetRequired": "PICK A SAVED VOICE OR UPLOAD A TARGET VOICE WAV",
      "status.targetTextRequired": "TARGET VOICE TRANSCRIPT IS REQUIRED",

      "lib.none": "no voices yet, save one from the clone, direction or changer tab",
      "lib.all": "{n} voices",
      "lib.some": "{shown} of {total} voices",
      "lib.saved": "SAVED",
      "lib.temporary": "TEMPORARY",
      "lib.useTitle": "pick this voice in the clone tab",
      "lib.tempNote": "temporary voices lose their notes when the server restarts",
      "lib.unsaved": "unsaved changes",
      "lib.saving": "saving ...",
      "lib.savedOk": "saved",
      "lib.savedTemp": "updated until the server restarts",
      "lib.badField": "field names are letters, digits, dot, dash or underscore: {name}",
      "lib.error": "error: {msg}",
      "lib.removeField": "remove field",
      "lib.emptyKey": "(empty)",

      "footer.hint": "vocal events go inline in parentheses, (laugh) (sigh) (gasp) (yawn) (whispers), or square brackets in chinese, [笑] [叹气]. the tag is plain text so other ones often work too, reroll the seed if it gets read out loud instead"
    },

    zh: {
      "app.title": "Breeze-TTS-2 · 语音工作台",
      "lang.label": "语言",

      "header.sub": "开放权重的双语语音合成，运行于 ggml。音色设计、克隆、指令控制与音色转换。",

      "tab.design": "音色设计",
      "tab.clone": "音色克隆",
      "tab.direction": "风格指令",
      "tab.changer": "音色转换",
      "tab.library": "音色库",

      "field.text": "要朗读的文本",
      "field.voiceDesc": "音色描述",
      "field.direction": "指令",
      "field.cfg": "CFG 强度",
      "field.seed": "随机种子",
      "field.savedVoice": "已保存音色",
      "field.refAudio": "参考音频（WAV）",
      "field.refText": "参考文本（逐字一致）",
      "field.descOptional": "描述（可选，随音色保存）",
      "field.saveAs": "保存为",
      "field.sourceAudio": "源音频（WAV）",
      "field.targetVoice": "目标音色（WAV）",
      "field.targetRefText": "目标音色文本（逐字一致）",
      "field.sourceText": "源文本（可选，可改善咬字）",
      "field.keepMelody": "保留韵律",
      "field.filter": "筛选",
      "field.description": "描述",
      "field.extra": "附加字段",

      "ph.text.design": "欢迎登机，你的旅程现在开始。",
      "ph.desc.design": "温暖细腻的年轻女声，吐字清晰，语气平静。",
      "ph.text.clone": "隔了这么久，能再次听到你的声音真好。",
      "ph.text.direction": "我们需要谈谈昨晚发生的事。",
      "ph.direction": "放慢语速，语气克制而严肃。",
      "ph.refText": "填写参考音频的逐字文本。",
      "ph.targetRefText": "填写目标音色片段的逐字文本。",
      "ph.saveDesc": "沙哑的年长旁白，语速缓慢而温暖，适合有声书。",
      "ph.saveName": "my_voice",
      "ph.sourceText": "除非你有源音频的准确文字，否则留空。",
      "ph.filter": "名称、描述、文本或字段",
      "ph.metaKey": "字段",
      "ph.metaValue": "值",
      "ph.voiceDescCard": "这个音色的听感、来源与适用场景",

      "btn.generate": "生成",
      "btn.convert": "转换",
      "btn.saveVoice": "保存音色",
      "btn.refresh": "刷新",
      "btn.stop": "停止",
      "btn.download": "下载 WAV",
      "btn.use": "使用",
      "btn.addField": "+ 字段",
      "btn.saveChanges": "保存修改",

      "note.changer": "用另一个音色重说已有录音，保留原词和节奏，无需输入文本。音高通常来自目标音色；如果源音频是歌唱或语调强烈，请调高「保留韵律」。",

      "option.upload": "改为上传音频",
      "option.temporary": "临时",
      "output.stream": "边生成边播放",
      "output.buffer": "缓冲",
      "status.idle": "空闲",

      "status.textRequired": "请先输入文本",
      "status.encoding": "正在编码参考音频……",
      "status.encodeFailed": "无法编码参考音频",
      "status.connecting": "连接中……",
      "status.streaming": "流式播放 - {secs}s",
      "status.streamingShort": "开始流式生成……",
      "status.streamingRebuffer": "流式播放 - {secs}s（{n} 次重新缓冲）",
      "status.generating": "生成中 - {secs}s",
      "status.generatingShort": "生成中……",
      "status.generatingRebuffer": "生成中 - {secs}s（{n} 次重新缓冲）",
      "status.queued": "排队中，等待 GPU……",
      "status.stopped": "已停止",
      "status.stoppedSecs": "已停止 - {secs}s",
      "status.done": "完成 - {audio}s 音频 / {wall}s 耗时 ({rtf}x) @ {sr}Hz",
      "status.error": "错误：{msg}",
      "status.errorCode": "错误 {code}",
      "status.unknown": "未知",
      "status.wsError": "WebSocket 错误",
      "status.converting": "转换中……",
      "status.receiving": "接收中 - {secs}s",
      "status.busy": "忙碌中，一次只能处理一个请求",
      "status.savingVoice": "正在保存音色……",
      "status.saved": "已保存 {id} - {secs}s",
      "status.nameFirst": "请先为音色命名",
      "status.nameBad": "名称只能包含字母、数字、短横线和下划线",
      "status.saveNeedClip": "保存音色需要上传音频片段及其文本",
      "status.sourceRequired": "请先上传源 WAV",
      "status.targetRequired": "请选择已保存音色，或上传目标音色 WAV",
      "status.targetTextRequired": "目标音色文本为必填",

      "lib.none": "还没有音色，可在克隆、风格指令或音色转换页保存",
      "lib.all": "共 {n} 个音色",
      "lib.some": "显示 {shown} / 共 {total} 个音色",
      "lib.saved": "已保存",
      "lib.temporary": "临时",
      "lib.useTitle": "在克隆页使用这个音色",
      "lib.tempNote": "临时音色的备注会在服务重启后丢失",
      "lib.unsaved": "有未保存的修改",
      "lib.saving": "保存中……",
      "lib.savedOk": "已保存",
      "lib.savedTemp": "已更新，服务重启后失效",
      "lib.badField": "字段名只能包含字母、数字、点、短横线或下划线：{name}",
      "lib.error": "错误：{msg}",
      "lib.removeField": "移除字段",
      "lib.emptyKey": "（空）",

      "footer.hint": "语气事件可直接写在圆括号里，如 (laugh) (sigh) (gasp) (yawn) (whispers)；中文可用方括号，如 [笑] [叹气]。标签是纯文本，其他写法通常也能生效；如果被读出来，换个种子重试。"
    }
  };

  let lang = "en";
  const listeners = [];

  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
    });
  }

  function t(key, vars) {
    const table = DICT[lang] || DICT.en;
    const text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : DICT.en[key];
    return interpolate(text === undefined ? key : text, vars);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  }

  function syncButtons() {
    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      const on = btn.getAttribute("data-lang") === lang;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function detect() {
    let saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) { }
    if (saved && DICT[saved]) return saved;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return /^zh/i.test(nav) ? "zh" : "en";
  }

  function setLang(next) {
    const value = DICT[next] ? next : "en";
    if (value === lang) { syncButtons(); return; }
    lang = value;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { }
    apply();
    syncButtons();
    listeners.forEach(function (fn) { fn(lang); });
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function init() {
    lang = detect();
    apply();
    syncButtons();
    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () { setLang(btn.getAttribute("data-lang")); });
    });
  }

  window.BreezeI18n = {
    t: t,
    apply: apply,
    setLang: setLang,
    onChange: onChange,
    languages: Object.keys(DICT),
    get lang() { return lang; }
  };

  init();
})();
