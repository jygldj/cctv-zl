if(typeof _tvload == "undefined"){
     _tvload=false;
}
function extractDomain(url) {
    const match = url.match(/^(https?:\/\/[^/?#]+)/i);
    return match ? match[1] : null;
}
function decodeUnicodeBase64(base64Str) {
    return decodeURIComponent(escape(atob(base64Str)));
}
_data={
    hzList(video){
        let hzName =  _tvFunc.getVideoQuality(video);
        let hzList=[];
        let itemData={name:hzName,level:_tvFunc.hzLevel(hzName,1)};
        hzList.push(itemData);
        _apiX.msg("videoQuality",hzList);
        return hzList;
    }
};
(function(){
    if(_tvload){
        return;
    }
    _tvload=true;

    function loadLocalText(path){
        try{
            // 只要原生桥 getJson 可用即读本地资源（不再强依赖 _tvIsApp 标志）
            if(window._api && typeof window._api.getJson === "function"){
                return window._api.getJson(path, JSON.stringify({})) || "";
            }
        }catch(e){
            console.error("loadLocalText error "+path, e);
        }
        return "";
    }
    function execJs(content, onload){
        if(!content || content.length===0){
            if(onload) onload(false);
            return false;
        }
        let script = document.createElement('script');
        script.textContent = content;
        if(onload){ script.onload = function(){ onload(true); }; script.onerror=function(){ onload(false); }; }
        document.body.appendChild(script);
        // 同步 append 的 textContent 脚本会在 append 后异步执行，
        // 因此务必依赖 onload 串联顺序，不能在外部连续 append 后假设已就绪。
        if(!onload) { /* 无回调时由调用方自行保证顺序 */ }
        return true;
    }
    function loadLocalJs(path, onload){
        return execJs(loadLocalText(path), onload);
    }
    function loadLocalCss(path){
        let content = loadLocalText(path);
        if(!content || content.length===0){ return false; }
        let style = document.createElement('style');
        style.textContent = content;
        document.head.appendChild(style);
        return true;
    }

  /*  if(window.location.href.startsWith("https://v.qq.com/x/cover/")){
        return ;
    }*/
    function loadDetailByUrl(url){
       /* if(url.startsWith("https://www.yangshipin.cn/tv/home")){
            return "cctv";
        }*/
        if(url.startsWith("https://tv.cctv.com/live")){
            return "tv/cctv";
        }
        if(url.startsWith("https://www.yangshipin.cn")){
            return "tv/ysptv"
        }
        //各大tv
        if(url.startsWith("https://live.jstv.com")){
            return "tv/jstv"
        }

        if(url.startsWith("https://www.btime.com")){
            return "tv/bjtv"
        }
        if(url.startsWith("https://www.jlntv.cn/")){
            return "tv/jltv"
        }
        if(url.startsWith("https://www.lcxw.cn/")){
            _tvLoadRes.js("https://cdn.bootcdn.net/ajax/libs/hls.js/1.5.13/hls.js");
            return "tv/lctv"
        }
        if(url.startsWith("https://www.fengshows.com/")){
            return "tv/fengshows"
        }
        if(url.startsWith("https://www.nmtv.cn")){
            return "tv/nmtv"
        }
        if(url.startsWith("https://www.mgtv.com/live")){
            return "tv/hntv"
        }
        if(url.startsWith("https://web.guangdianyun.tv")){
            return "tv/gdytv"
        }
        return "tv/common"
    }
    let detailPath=loadDetailByUrl(window.location.href);
    console.log("detailPath:: "+detailPath);

    function loadFromLocal(){
        console.log("[道玄电视] app env, load detail resources from local assets");
        loadLocalCss("css/my.css");
        /* 顺序加载：zepto -> common -> pageFsBtn -> detail，每个 onload 后再下一个，
           确保 detail.js 执行时 $$ 与 _tvFunc 已就绪（对齐 assets2.0 外部 script 顺序执行语义）。
           [v4.5.33] 补回 pageFsBtn（通用全屏点击器）这一环 —— 它在 x5 的地方台链路上
           整个缺失，是「各省地方台 90%+ 不脱壳」的主因：
             · gao（已验证稳定的模板工程）的加载链是 zepto -> common -> pageFsBtn -> detail；
             · x5 迁移时把 pageFsBtn 这一环丢了，只剩 zepto -> common -> detail。
           为什么这一环要命：实测抽样 8 个地方台页面，其中 6 个（cztv / gdtv / jstv /
           fjtv / mgtv / hebtv）静态 HTML 里根本不含 <video>，播放器是 SPA 运行时才创建的。
           而 detail.js 的兜底 setupVideo() 完全依赖 waitForVideoElement() 拿到 video，
           video 不到位就无从下手。pageFsBtn 不依赖 video：它按 16 个选择器 +
           [class*="fullscreen"] 一类松匹配去找站点**自己的全屏按钮**并点击，
           让站点自己进入全屏（真脱壳），成功时置 __DXTV_PAGE_FS__ = true。
           pageFsBtn 自带 __DXTV_PAGEFS_INJECTED__ 幂等保护：tv.cctv.com 那条链
           已被原生侧 injectCctvFullscreenPipeline 注入过，这里重复加载会直接 return，
           不会重复施力。 */
        loadLocalJs("js/zepto.min.js", function(ok1){
            if(!ok1){ console.error("[道玄电视] zepto load failed"); }
            loadLocalJs("js/common.js", function(ok2){
                if(!ok2){ console.error("[道玄电视] common.js load failed"); }
                loadLocalJs("js/pageFsBtn.js", function(ok3){
                    if(!ok3){ console.error("[道玄电视] pageFsBtn.js load failed"); }
                    loadLocalJs("js/" + detailPath + "/detail.js", function(ok4){
                        console.log("[道玄电视] detail.js injected: " + ok4 + " path=" + detailPath);
                    });
                });
            });
        });
    }
    function loadFromRemote(){
        let fullUrl=window.location.href;
        let domain=extractDomain(fullUrl);
        _tvLoadRes.css(domain+`/tv-web/css/my.css`);
        _tvLoadRes.js(domain+`/tv-web/js/zepto.min.js?v=x`);
        _tvLoadRes.js(domain+`/tv-web/js/common.js?v=x`);
        _tvLoadRes.js(domain+`/tv-web/js/pageFsBtn.js?v=x`);
        _tvLoadRes.js(domain+`/tv-web/js/${detailPath}/detail.js`);
    }
    // 双保险：_tvIsApp 为真，或检测到 window._api 原生桥存在（说明在 app 内）均走本地加载。
    // 避免 end.js 未注入导致 _tvIsApp 未设而整体不触发的单点依赖。
    let isApp = (typeof _tvIsApp !== "undefined" && _tvIsApp) || (typeof window._api !== "undefined" && window._api);
    if(isApp){
        // X5 的 addJavascriptInterface 暴露给 JS 的时机并非 100% 同步，
        // 央视网等外部页面易在 onPageFinished 注入瞬间 window._api 尚不可见，
        // 导致一次性判条件静默落空(走远程 404)。改为轮询等待 _api 就绪再加载本地资源。
        let _waitTimes=0;
        let _timer=setInterval(function(){
            _waitTimes++;
            try{
                if(window._api && typeof window._api.getJson === "function"){
                    clearInterval(_timer);
                    loadFromLocal();
                    return;
                }
            }catch(e){
                console.error("[道玄电视] wait _api error", e);
            }
            if(_waitTimes>=50){ // 约 5 秒仍无 _api，降级走远程(兼容非 app 环境)
                clearInterval(_timer);
                console.log("[道玄电视] _api not ready after wait, fallback to remote");
                loadFromRemote();
            }
        },100);
    } else {
        loadFromRemote();
    }
})();