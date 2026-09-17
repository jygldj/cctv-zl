// 播放页：片库 VOD 直链；选集栏 + 自动连播。取流走原生桥 window._api.getJson，_apiX 为兼容别名。
// 切集用 player.switchURL 页内切源（player.load 在已播放态不重载 HLS）。
// 画质：直接播真库 hls_url（自带 maxbr=2048 高清主链），不改造、不降级、不兜底。遥控仅由 Android dispatchKeyEvent 派发 window.__cctvKey（单一事件源，无兜底）。
(function(){
    "use strict";

    function getParam(k){
        try{ return new URLSearchParams(window.location.search).get(k); }catch(e){ return null; }
   }
    let pUrl = getParam("url");
    let album = getParam("album") || "";
    let albumName = getParam("name") || "";
    let entryGuid = getParam("guid") || "";
    let epParam = parseInt(getParam("ep") || "0", 10);
    if(isNaN(epParam) || epParam < 0){ epParam = 0; }

    let player = null;

    // 锁死最高画质（高清），ABR 停止自动降码率；弱网卡死风险已知。
    function _lockTopQuality(){
        try{
            var hls = player && (player.hls || (player.plugins && player.plugins.hls && (player.plugins.hls.hls || player.plugins.hls)));
            if(hls && hls.levels && hls.levels.length){
                hls.currentLevel = hls.levels.length - 1; // 手动选最高档，ABR 停止自动切换
            }
        }catch(e){ console.error("lockTop err", e); }
    }

    // ============ 画质：直接播真库 hls_url（自带 maxbr=2048 高清主链），不改造、不降级 ============
    let _currentRaw = "";    // 当前集原始 hls 主链
    let _curPlayUrl = "";    // 当前实际播放 url

    // 切源：优先 switchURL；不可用时回退 player.src=url;player.load(url)
    function _switchTo(url){
        try{
            if(typeof player.switchURL === "function"){ player.switchURL(url); }
            else { player.src = url; player.load(url); }
       }catch(e){
            try{ player.src = url; player.load(url); }catch(e2){ console.error("switch err", e2); }
       }

   }
    // 加载一路流：固定 2000 高清直链（实测有效，约2Mbps），永不降级
    function loadStream(raw){
        if(!raw) return;
        _currentRaw = raw;
        let url = raw;
        _curPlayUrl = url;
        _switchTo(url);
        setTimeout(_lockTopQuality, 1500); // 切集后补锁高清（switchURL 复用实例，兜底）
   }

    // ============ 取流：原生桥单次直取，失败即黑屏（无兜底、无网络容错） ============
    function apiGetJson(url, cb){
        if(window._apiX && typeof window._apiX.getJson === "function"){

            try{
                window._apiX.getJson(url, {"User-Agent":_apiX.userAgent(false),"tv-ref":"https://tv.cctv.com/"}, function(text){
                    if(text && text !== "505" && text !== "500"){ try{ cb(text); }catch(e){} }
                    // 取流失败/异常：不兜底，静默黑屏
               }, function(){ /* 取流失败：不兜底，静默黑屏 */ });
                return;
           }catch(e){ console.error("apiX bridge err", e); }
       }
        if(window._api && typeof window._api.getJson === "function"){

            try{
                let res = window._api.getJson(url, JSON.stringify({"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36","tv-ref":"https://tv.cctv.com/"}));
                if(res && res !== "505" && res !== "500"){ try{ cb(res); }catch(e){} return; }
           }catch(e){ console.error("api bridge err", e); }
       }

   }

    // ============ 选集模块 ============
    let eps = [];
    let curIdx = 0;
    let focusIdx = 0;
    let panelOpen = false;
    let btnEl = document.getElementById("cctv-ep-btn");
    let panelEl = document.getElementById("cctv-ep-panel");
    let listEl = document.getElementById("cctv-ep-list");
    let nameEl = document.getElementById("cctv-ep-name");

    function loadEps(cb){
        try{
            let s = sessionStorage.getItem("cctv_eps_" + album);
            if(s){ eps = JSON.parse(s); afterEps(cb); return; }
       }catch(e){}
        if(!album){ cb(false); return; }
        let url = "https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?id=" + encodeURIComponent(album) + "&serviceId=tvcctv&p=1&n=500&mode=0&pub=1";
        apiGetJson(url, function(text){
            try{
                let d = JSON.parse(text);
                eps = (d.data && d.data.list) || [];
                try{ sessionStorage.setItem("cctv_eps_" + album, JSON.stringify(eps)); }catch(e){}
                afterEps(cb);
           }catch(e){ cb(false); }
       });
   }
    function afterEps(cb){

        if(entryGuid){
            let i = eps.findIndex(function(e){ return e.guid === entryGuid; });
            if(i >= 0) curIdx = i;
       } else if(epParam > 0 && epParam < eps.length){ curIdx = epParam; }
        cb(eps.length > 0);
   }
    function renderEps(){
        listEl.innerHTML = "";
        eps.forEach(function(ep, idx){
            let el = document.createElement("div");
            el.className = "cctv-ep" + (idx === curIdx ? " cur" : "");
            el.textContent = ep.title || ("第" + (idx + 1) + "集");
            el.addEventListener("click", function(){ playEpisode(idx); });
            listEl.appendChild(el);
       });
        if(albumName){ nameEl.textContent = albumName + "（共" + eps.length + "集）"; }
   }
    function setFocus(idx){
        focusIdx = idx;
        let items = listEl.querySelectorAll(".cctv-ep");
        items.forEach(function(it, i){ it.classList.toggle("focus", i === idx); });
        let f = items[idx];
        if(f){ f.scrollIntoView({block: "nearest"}); }
   }
    function openPanel(){
        if(eps.length === 0) return;
        panelOpen = true;
        btnEl.classList.remove("focus");
        panelEl.style.display = "flex";
        focusIdx = curIdx;
        setFocus(curIdx);
   }
    function closePanel(){ panelOpen = false; btnEl.classList.add("focus"); panelEl.style.display = "none"; }
    function togglePanel(){ panelOpen ? closePanel() : openPanel(); }

    // ============ 遥控核心：直接暴露给 Android 层调用 ============
    // code：13/23=OK，37/38/39/40=方向。仅由 Android 层 dispatchKeyEvent 经 __cctvKey 派发（单一事件源，无兜底）。返回键不在此处理，交回 Android 默认返回逻辑退出播放页。
    let _lastKeyTs = 0, _lastKeyCode = -1;
    window.__cctvKey = function(code){

        let now = Date.now();
        // 120ms 同键去抖：防止 Android 重复按键令单次物理键被多次调用
        if(code === _lastKeyCode && (now - _lastKeyTs) < 120){ return; }
        _lastKeyTs = now; _lastKeyCode = code;
        if(!panelOpen){
            if(code === 13 || code === 23){ openPanel(); return; }
            return;
       }
        if(code === 13 || code === 23){ playEpisode(focusIdx); return; }
        let cols = 6;
        if(code === 37) setFocus(Math.max(0, focusIdx - 1));
        else if(code === 39) setFocus(Math.min(eps.length - 1, focusIdx + 1));
        else if(code === 38) setFocus(Math.max(0, focusIdx - cols));
        else if(code === 40) setFocus(Math.min(eps.length - 1, focusIdx + cols));
   };
    function playEpisode(idx){
        if(idx < 0 || idx >= eps.length) return;
        let ep = eps[idx];
        curIdx = idx;
        let items = listEl.querySelectorAll(".cctv-ep");
        items.forEach(function(it, i){ it.classList.toggle("cur", i === idx); });
        let pid = ep.guid;
        if(!pid){ return; }
        let m3u8 = "https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=" + encodeURIComponent(pid);
        apiGetJson(m3u8, function(text){
            try{
                let jo = JSON.parse(text);
                let hls = jo.hls_url;
                // switchURL 异步、无法确认切换成功，故切源后延迟 3 秒隐藏面板（B案）
                if(hls){  loadStream(hls); if(panelOpen) setTimeout(closePanel, 3000); }
                else {  console.warn("no hls for", pid); }
           }catch(e){  console.error("parse err", e); }
       });
   }

    // ============ 启动播放（首集） ============
    function bootPlayer(hlsRaw){
        if(!hlsRaw){ console.warn("no hls to play"); return; }
        let isVod = typeof hlsRaw === "string" && (hlsRaw.indexOf('/hls/main/') >= 0 || hlsRaw.indexOf('hls.cntv.lxdns.com') >= 0);
        let config = {
            "id": "mse",
            "url": hlsRaw,
            "plugins": [],
            "isLive": !isVod,
            "autoplay": true,
            volume: 1,
            "width": "100%",
            "height": "100%",
            "capLevelToPlayerSize": false   // 不按播放器尺寸限码率（防尺寸降）
       };
        player = new HlsJsPlayer(config);
        // manifest 解析后 & 播放器 ready 后，均锁最高档（高清），ABR 停切
        try{
            player.on('hlsManifestParsed', function(){ _lockTopQuality(); });
            player.on('ready', function(){ _lockTopQuality(); });
       }catch(e){ console.error("lockTop bind err", e); }
        setTimeout(_lockTopQuality, 2000); // 首集兜底：不依赖事件名，确保锁高清
        // 注意：不请求原生全屏，保留网页层"选集"浮层与遥控器焦点（机顶盒原生全屏会盖住 HTML 浮层）
        if(album){
            btnEl.style.display = "block";
            btnEl.classList.add("focus");
            btnEl.addEventListener("click", togglePanel);
            loadEps(function(ok){
                if(ok){ renderEps(); } else { btnEl.style.display = "none"; }
           });
            player.on('ended', function(){
                let n = curIdx + 1;
                if(n < eps.length){ playEpisode(n); }
           });
       }
   }
    function fetchAndBoot(guid){
        if(!guid){ return; }
        let m3u8 = "https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=" + encodeURIComponent(guid);
        apiGetJson(m3u8, function(text){
            try{
                let jo = JSON.parse(text);
                if(jo.hls_url){  bootPlayer(jo.hls_url); }
                else {  console.warn("no hls for", guid); }
           }catch(e){ console.error("parse err", e); }
       });
   }

    // 入口分发：优先 url 直链；其次 guid 取流；再次 album 取首集
    if(pUrl !== null){
        bootPlayer(pUrl);
   } else if(entryGuid){
        fetchAndBoot(entryGuid);
   } else if(album){
        loadEps(function(ok){ if(ok && eps[0]) fetchAndBoot(eps[0].guid); });
   }
})();
