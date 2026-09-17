package com.daoxuan.cctv.impl;

import android.content.Context;
import android.graphics.Bitmap;

import android.net.http.SslError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.text.MessageFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import com.daoxuan.cctv.MyApplication;
import com.daoxuan.cctv.util.AppVersionUtils;
import com.daoxuan.cctv.util.ConstantMy;
import com.daoxuan.cctv.util.FileUtil;
import com.daoxuan.cctv.util.HttpUtil;
import com.daoxuan.cctv.util.JsonUtil;
import com.daoxuan.cctv.util.LogUtil;
import com.daoxuan.cctv.util.TplUtil;
import com.daoxuan.cctv.util.Util;

public class WebViewClientImpl extends WebViewClient {

    /**
     * 页面加载状态回调：用于把「加载遮罩」和「失败提示」交给界面处理。
     */
    public interface PageLoadCallback {
        void onStarted(String url);

        void onFinished(String url);

        void onError(int code, String description, String url);
    }

    private static PageLoadCallback sPageLoadCallback;

    public static void setPageLoadCallback(PageLoadCallback callback) {
        sPageLoadCallback = callback;
    }

    private static void notifyStarted(String url) {
        if (sPageLoadCallback != null) {
            sPageLoadCallback.onStarted(url);
        }
    }

    private static void notifyFinished(String url) {
        if (sPageLoadCallback != null) {
            sPageLoadCallback.onFinished(url);
        }
    }

    private static void notifyError(int code, String description, String url) {
        if (sPageLoadCallback != null) {
            sPageLoadCallback.onError(code, description, url);
        }
    }

    private  static  String TAG="WebViewClient";
    private Context context;
    private WebView mWebView;

    /**
     * 注入脚本的内存缓存。
     *
     * 这些脚本在每次页面加载时都会通过 onPageStarted / onPageFinished 注入，
     * 原来每次都走 FileUtil.readExt 从 assets 重新读一遍（assets 是压缩的，
     * 每次 open 都要解压 + 逐行拼串 + 打日志），而且是在 UI 线程上做。
     * 换台越频繁、这套 I/O 越浪费，缓存后只读一次。
     */
    private static String sEndJs;
    private static String sLoadDetailTvJs;
    private static String sLoadDetailVideoJs;
    private static String sCctvFullscreenJs;
    private static String sPageFsBtnJs;
    private static String sPageToastKillJs;

    private static String assetText(String name) {
        try {
            String text = FileUtil.readExt(MyApplication.getAppContext(), "tv-web/" + name);
            return text == null ? "" : text;
        } catch (Exception e) {
            LogUtil.e(TAG, "read asset failed: " + name + " " + e.getMessage());
            return "";
        }
    }

    /**
     * 自愈用：脱壳脚本的注入闸门 _tvload（定义在 assets/tv-web/js/load_detail_tv.js）。
     * 若上一次注入是在 DOM 未就绪时半途中断的（连带 end.js 的 _tvLoadRes 都没定义出来），
     * 说明闸门属于「假置位」——放行重来，否则脱壳脚本永远不再加载。
     */
    private static final String RESET_STALE_TVLOAD_JS =
            "(function(){try{if(window._tvload&&!window._tvLoadRes){window._tvload=false;}}catch(e){}})()";

    private static  String lastUrl=null;
    private static  String rootUrl=null;
    private static  String currentUrl=null;
    private static  WebView sWebView=null;
    private int type;
    public WebViewClientImpl(Context context,WebView mWebView,int type){
        this.context=context;
        this.mWebView=mWebView;
        sWebView=mWebView;
        this.type=type;
    }
    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        view.clearCache(false);
        view.clearHistory();
        return true;
    }

    @Override
    public void onReceivedSslError(WebView webView,
                                   SslErrorHandler handler,
                                   SslError error) {
        LogUtil.i(TAG,"onReceivedSslError");
        handler.proceed();
    }
    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        notifyStarted(url);
        currentUrl=url;
        /* [v4.5.34] 恢复早注入 —— 对齐 cctv-gao（实测 gao 各省地方台 90%+ 成功脱壳，
           而本工程 90%+ 不脱壳；两者在地方台链路上唯一的结构性差异就是这段早注入）。

           为什么 v4.5.26 曾把它删掉：当时 js/end.js 没有 DOM 兜底，onPageStarted 时
           <head> 刚解析、<body> 通常还不存在，appendChild 抛异常中断整段脚本，
           而 load_detail_tv.js 的 _tvload=true 却已落地（假置位），
           导致 onPageFinished 的正常注入被闸门挡成空转 —— yangshipin 整条链失效。

           为什么现在可以恢复：js/end.js 在 v4.5.26 当次已补齐 DOM 兜底
           （loadCssCode 加 try-catch 与 head 判空、createDiv 用 body||documentElement、
           _tvLoadRes.js/css 全部加 host 判空），「早注入必抛异常」的前提已不成立。

           三重保险，任何一环失败都不影响最终脱壳：
             1) 注入前先跑 RESET_STALE_TVLOAD_JS 清假置位（该常量此前定义了却从未被调用）；
             2) 整段包 try-catch，异常不影响后续 onPageFinished；
             3) onPageFinished 注入前同样先跑自愈，早注入半途失败仍可补救。

           作用域：type==1 且非 tv.cctv.com 的页面（即各省地方台）。
           显式排除 yangshipin.cn：它在 v4.5.31 已改走 CCTV直播入口那条已验证的链、
           实测正常，不纳入早注入，避免把已验收的链路拖下水。 */
        if (type == 1 && !url.contains("tv.cctv.com") && !url.contains("yangshipin.cn")) {
            try {
                view.evaluateJavascript(RESET_STALE_TVLOAD_JS, null);
                String earlyJs = getFileContent(url);
                if (null != earlyJs && !earlyJs.isEmpty()) {
                    view.evaluateJavascript(earlyJs, new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String s) {
                        }
                    });
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "early inject error: " + e.getMessage());
            }
        }
        String baseFolder = "tv-web/";
        if(url.contains("tv-web")){
            if(url.endsWith("index.html")){
                rootUrl=url;
            }
            lastUrl=url;
        }
    }


    private String getFileContent(String url){
        String baseFolder = "tv-web/";
        if(url.contains(baseFolder)){
            return null;
        }
        if (sEndJs == null) { sEndJs = assetText("js/end.js"); }
        String detail;
        /* [v4.5.31] 央视频（央视源2 / 卫视 / 教育）在央视网入口（LiveActivity, type=1）
           原本走 load_detail_tv.js → js/tv/ysptv/detail.js，实测「计时器走完、未脱壳、
           视频在骨架窗口播放」。而同一个站点在 CCTV直播入口（type=0，走
           load_detail_video.js → js/cctv/detail.js）实测正常播放。

           两者访问的是同一类页面（yangshipin.cn/tv/home?pid=...），差别只在承载的
           Activity 与随之而来的注入链。故这里让央视频在 LiveActivity 里直接复用
           CCTV直播入口那条已验证可用的链：同一个加载器、同一种资源加载方式
           （_tvLoadRes + 外链 script src）、同一套脚本。

           这与 v4.5.28 不同：v4.5.28 只把目标文件换成 js/cctv/detail.js，却仍保留
           load_detail_tv.js 那套「原生桥 getJson + 内联 script」的加载机制，
           机制本身未变，故实测仍失败。本次是整条链一起换。

           作用域仅限 yangshipin.cn，其余站点（tv.cctv.com 与各地方台）行为不变。 */
        if(type==1 && url.startsWith("https://www.yangshipin.cn")){
            if (sLoadDetailVideoJs == null) { sLoadDetailVideoJs = assetText("js/load_detail_video.js"); }
            detail = sLoadDetailVideoJs;
        } else if(type==1){
            if (sLoadDetailTvJs == null) { sLoadDetailTvJs = assetText("js/load_detail_tv.js"); }
            detail = sLoadDetailTvJs;
        } else {
            if (sLoadDetailVideoJs == null) { sLoadDetailVideoJs = assetText("js/load_detail_video.js"); }
            detail = sLoadDetailVideoJs;
        }
        return sEndJs + detail;
    }
    @Override
    public void onPageFinished(WebView view, String url) {
        notifyFinished(url);
        if (url.contains("tv.cctv.com")) {
            injectCctvFullscreenPipeline(view);
            return;
        }
        /* 央视频（yangshipin.cn）播放器自带的「全力加载中…」气泡需要压掉，
           故注入 pageToastKill（脚本自带幂等保护，重复注入无副作用）。
           [v4.5.31] 这里不再注入 v4.5.30 的 yspFullscreen 兜底器：它属于未被证实的
           猜测性改动，且会持续 90 秒操作 DOM，与站点自身渲染互相拉锯。
           央视频在央视网入口改由 getFileContent 直接复用 CCTV直播入口那条已验证的链解决。 */
        if (url.contains("yangshipin.cn")) {
            final String toastKill = pageToastKillJs();
            injectToastKiller(view, toastKill);
            view.postDelayed(new Runnable() {
                @Override
                public void run() {
                    injectToastKiller(view, toastKill);
                }
            }, 350);
        }
        final String fileContent = getFileContent(url);
        if (null == fileContent) {
            return;
        }
        /* [v4.5.31] 注入门禁按 type 分域，避免相互牵连：

           type==1（央视网入口 LiveActivity）：解除进度门禁。
           yangshipin 等第三方直播页常驻 HLS 分片与心跳长连接，WebView 进度会长期停在
           60~90%（实测三张截图恰好是 70/70/10），若坚持等 100 则脱壳脚本永不注入，
           页面保持裸奔，LiveActivity 的「频道名 X%」也永远等不到 100。
           onPageFinished 本身即代表主文档已就绪，故直接注入；未走完再补一次。

           type==0（CCTV直播入口 MainActivity）：完整保留 v4.5.27 的原始门禁
           （仅 progress==100 时注入）。该入口在 v4.5.27 实测正常，这里不做任何行为改变，
           以免把已验收的链路拖下水。 */
        if (type == 1) {
            /* [v4.5.34] 注入前先清「假置位」：若早注入是在 DOM 未就绪时半途中断的，
               _tvload 已为 true 但 _tvLoadRes 未定义（end.js 没跑完）——
               此时必须放行重来，否则本次注入会被 _tvload 闸门挡成空转，
               脱壳脚本永远不再加载，页面保持裸奔。 */
            view.evaluateJavascript(RESET_STALE_TVLOAD_JS, null);
            view.evaluateJavascript(fileContent, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String s) {
                }
            });
            if (mWebView.getProgress() != 100) {
                view.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try { view.evaluateJavascript(fileContent, null); } catch (Exception ignore) {}
                    }
                }, 500);
            }
            return;
        }
        if (mWebView.getProgress() == 100) {
            view.evaluateJavascript(fileContent, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String s) {
                }
            });
        }
    }

    /**
     * 央视外页脱壳的主链路：主方案与兜底都立即注入。
     *
     * 演进：原实现要串行熬过 onPageFinished + progress==100 + 5000ms 三段等待才上兜底；
     * 上一版把兜底压到 800ms，但 cctvFullscreen 不只是「全屏兜底」——它同时是
     * 「专辑页 → 播放页」自动跳转的执行者（tryEnterPlayer）。等 800ms 注入，
     * 等于每次点节目都白等 0.8 秒才有人去点「立即观看」。因此改为立即注入。
     * 脚本内自带 __DXTV_FS_INJECTED__ / fsMarked 幂等保护，重复注入无副作用。
     */
    private void injectCctvFullscreenPipeline(final WebView view) {
        final String fsBtn = pageFsBtnJs();
        final String cctvFs = getCctvFullscreenJs();
        if (fsBtn != null && !fsBtn.trim().isEmpty()) {
            view.evaluateJavascript(fsBtn, null);
        }
        injectCctvFullscreen(view, cctvFs);
        // 350ms 补一次，防止首次注入时页面 body 尚未就绪（幂等，重复注入无副作用）
        view.postDelayed(new Runnable() {
            @Override
            public void run() {
                injectCctvFullscreen(view, cctvFs);
            }
        }, 350);
    }

    /** 无条件注入气泡压制器。脚本自带 __DXTV_TOASTKILL_INJECTED__ 幂等保护，重复注入无副作用。 */
    private void injectToastKiller(WebView view, String js) {
        if (js == null || js.trim().isEmpty()) {
            LogUtil.e(TAG, "pageToastKill.js load failed or empty");
            return;
        }
        try {
            view.evaluateJavascript(js, null);
        } catch (Exception e) {
            LogUtil.e(TAG, "inject pageToastKill error: " + e.getMessage());
        }
    }

    private void injectCctvFullscreen(final WebView view, final String cctvFs) {
        if (cctvFs == null || cctvFs.trim().isEmpty()) { return; }
        view.evaluateJavascript(
                "(function(){return !!(window.__DXTV_FS_INJECTED__||window.__DXTV_FS_DONE__);})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String s) {
                        if (s != null && s.contains("true")) { return; }
                        view.evaluateJavascript(cctvFs, null);
                    }
                });
    }

    private String getCctvFullscreenJs(){
        if (sCctvFullscreenJs == null) {
            sCctvFullscreenJs = assetText("js/cctvFullscreen.js");
            if (sCctvFullscreenJs.isEmpty()) {
                LogUtil.e(TAG, "cctvFullscreen.js load failed or empty");
            }
        }
        return sCctvFullscreenJs;
    }

    private String pageFsBtnJs() {
        if (sPageFsBtnJs == null) { sPageFsBtnJs = assetText("js/pageFsBtn.js"); }
        return sPageFsBtnJs;
    }

    private String pageToastKillJs() {
        if (sPageToastKillJs == null) { sPageToastKillJs = assetText("js/pageToastKill.js"); }
        return sPageToastKillJs;
    }

    @Override
    public void onReceivedError(WebView webView, int errorCode, String description, String failingUrl) {
        LogUtil.e(TAG, "onReceivedError: " + errorCode
                + ", description: " + description
                + ", url: " + failingUrl);
        notifyError(errorCode, description, failingUrl);
    }

    private Map<String,String> toHeader(Map<String,String> orgHeader){
        Map<String,String> headerMap = new HashMap<>();
        if(orgHeader.containsKey("Referer")){
            headerMap.put("Referer",orgHeader.get("Referer"));
        }
        if(orgHeader.containsKey("Origin")){
            headerMap.put("Origin",orgHeader.get("Origin"));
        }
        if(orgHeader.containsKey("User-Agent")){
            headerMap.put("User-Agent",orgHeader.get("User-Agent"));
        }
        if(orgHeader.containsKey("Host")){
            headerMap.put("Host",orgHeader.get("Host"));
        }
        return headerMap;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest webResourceRequest) {
        String accept=  webResourceRequest.getRequestHeaders().get("Accept");
        String url=webResourceRequest.getUrl().toString();
        String orgUrl=url;
        String method = webResourceRequest.getMethod();
        if(type==1){
            if(orgUrl.startsWith("https://tlive.fengshows.com/live/")||orgUrl.startsWith("https://hkmolive.fengshows.com/live/")){
                String realUrl= "https://qctv.fengshows.cn"+orgUrl.substring(orgUrl.indexOf("/live"));
                Map<String,String> headerMap = new HashMap<>();
                InputStream inputStream = HttpUtil.get(realUrl,new HashMap<>());
                if(null==inputStream){
                    return super.shouldInterceptRequest(webView, webResourceRequest);
                }
                WebResourceResponse resp=new WebResourceResponse("video/x-flv",
                        ConstantMy.UTF8, inputStream);
                headerMap.put("access-control-allow-origin","*");
                resp.setResponseHeaders(headerMap);
                return resp;
            }

            if(orgUrl.startsWith("https://gdtv-api.gdtv.cn/api/tv/v2/tvChannel")){
                Map<String,String> orgHeadMap = webResourceRequest.getRequestHeaders();
                if (!"GET".equalsIgnoreCase(method)) {
                    return super.shouldInterceptRequest(webView, webResourceRequest);
                }
                Map<String,String> headerMap = new HashMap<>(orgHeadMap);
                headerMap.remove("x-requested-with");
                String json = HttpUtil.getJson(orgUrl,headerMap);
                WebResourceResponse resp=new WebResourceResponse("application/json;charset=UTF-8",
                        ConstantMy.UTF8, new ByteArrayInputStream(json.getBytes(Charset.defaultCharset())));
                headerMap.put("access-control-allow-origin","*");
                resp.setResponseHeaders(headerMap);
                return resp;
            }
            if(url.contains(".m3u8")&&currentUrl!=null&&currentUrl.contains("u-link=1")){
               String js= MessageFormat.format(
                        "sessionStorage.setItem(\"{0}\",\"{1}\");sessionStorage.setItem(\"{2}\",\"{3}\");",
                        "u-m3u8",url,"u-loc",currentUrl);
                Util.evalOnUi(webView,js);
            }
        }
        if(null!=accept&&accept.startsWith("image/")&&!imageLoad(url)){
            return new WebResourceResponse(null,
                    null, null);
        }
        int index= url.indexOf("tv-web");
        if(index<0){
            if(webResourceRequest.getMethod().equals("GET")&&url.startsWith("https://mesh.if.iqiyi")){
                if(url.startsWith("https://mesh.if.iqiyi.com/tvg/v2/lw/base_info")){
                    Util.evalOnUi(webView,Util.sessionStorageWithTime("iqiyiXj",url));
                }
            }
            return super.shouldInterceptRequest(webView, webResourceRequest);
        }
        if(url.endsWith("tvImg=1")){
            if(index>0) {
                String fileName = url.substring(index,url.indexOf("?"));
                return new WebResourceResponse("image/jpeg",
                        ConstantMy.UTF8, FileUtil.readExtIn(MyApplication.getAppContext(),fileName));
            }
        }
        int indexWen=url.indexOf("?");
        if(indexWen>0){
            url=url.substring(0,indexWen);
        }

        if(url.endsWith("js")){
            if(index>0) {
                String fileName = url.substring(index);
                if(fileName.endsWith("basex.js")){
                    return new WebResourceResponse("text/html",
                            ConstantMy.UTF8, new ByteArrayInputStream(baseJs(fileName).getBytes(Charset.defaultCharset())));
                }
                return new WebResourceResponse("text/javascript",
                        ConstantMy.UTF8, FileUtil.readExtIn( MyApplication.getAppContext(),fileName));
            }
        }
        if(url.endsWith("css")){
            if(index>0) {
                String fileName = url.substring(index);
                return new WebResourceResponse("text/css",
                        ConstantMy.UTF8, FileUtil.readExtIn(MyApplication.getAppContext(),fileName));
            }
        }
        if(url.endsWith(".html")){
            if(index>0){
                String fileName=url.substring(index);
                String html = FileUtil.readExt(MyApplication.getAppContext(),fileName);
                html= html.replace("base.js","basex.js");
                return new WebResourceResponse("text/html",
                        ConstantMy.UTF8, new ByteArrayInputStream(html.getBytes(Charset.defaultCharset())));
            }
        }
        if(url.endsWith(".woff2")){
            if(index>0){
                String fileName = url.substring(index);
                return new WebResourceResponse("font/woff2",
                        ConstantMy.UTF8, FileUtil.readExtIn(MyApplication.getAppContext(),fileName));
            }
        }
        return super.shouldInterceptRequest(webView, webResourceRequest);

    }




    private String baseJs(String fileName){
       String baseStr= FileUtil.readExt(MyApplication.getAppContext(),fileName);
        Map<String, Object> data = new HashMap<>();
        data.put("version", AppVersionUtils.getVersionCode());
       return TplUtil.tpl(baseStr,data);
    }


   private  boolean notLoadUrl(String url){

       if(url.contains("https://cmts.iqiyi.com/bulle")){
           return  true;
       }
      if(url.contains("https://puui.qpic.cn/iwan_cloud")){
          return  true;
      }
       if(url.contains("https://msg.qy.net/")){
           return  true;
       }
      return  false;
   }
    private boolean  imageLoad(String url){
        if(url.contains("tvImg")){
            return true;
        }
        if(url.contains("cctvpic.com")){
            return true;
        }
        if(url.contains("default")){
            return true;
        }
        if(url.contains("open.weixin.qq.com/connect/qrcode")){
            String code=Util.loginQr(url,"微信");
            Util.evalOnUi(mWebView, code);
            return true;
        }
        if(url.contains("ptlogin2.qq.com/ssl/ptqrshow")){
            String code=Util.loginQr(url,"手机端qq");
            Util.evalOnUi(mWebView, code);
            return true;
        }
        if(url.startsWith("https://img.alicdn.com/imgextra/")&&url.endsWith("xcode.png")){
            String code=Util.loginQr(url,"youkuQr");
            Util.evalOnUi(mWebView, code);
            return true;
        }
        return false;
    }

    public  static Boolean currentUrlIsHome(){
        if(null==currentUrl){
            return  false;
        }
        if(currentUrl.contains("tv-web")){
            return true;
        }
        return false;
    }
    public static String  backUrl(){
        if(null==currentUrl){
            return null;
        }
        if(null!=sWebView && sWebView.canGoBack()){
            sWebView.goBack();
            return "$$GOBACK$$";
        }
        if(currentUrl.contains("tv-web")){
            if(currentUrl.endsWith("index.html")){
                return null;
            }
            return rootUrl;
        }
        return lastUrl;
    }

}