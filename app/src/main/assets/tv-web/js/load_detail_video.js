if(typeof _tvload == "undefined"){
     _tvload=false;
}
(function(){
    if(_tvload){
        return;
    }
    _tvload=true;
    function loadDetailByUrl(url){
        if(url.startsWith("https://www.yangshipin.cn/tv/home")){
            return "cctv";
        }
        if(url.startsWith("https://tv.cctv.com/")){
            return "cctvideo";
        }
        return null;
    }
    let detailPath=loadDetailByUrl(window.location.href);
    console.log("detailPath:: "+detailPath);
    if(null!=detailPath){
        _tvLoadRes.css(_browser.getURL("css/my.css?v=x"));
        _tvLoadRes.js(_browser.getURL("js/zepto.min.js?v=x"));
        _tvLoadRes.js(_browser.getURL("js/common.js?v=x"));
        _tvLoadRes.js(_browser.getURL("js/myfocus.js?v=x"));
        _tvLoadRes.js(_browser.getURL("js/vuex.min.js?v=x"));
        _tvLoadRes.js(_browser.getURL("js/detailBase.js?v=x"));
        _tvLoadRes.js(_browser.getURL(`js/${detailPath}/detail.js?v=x`));
    }
})();