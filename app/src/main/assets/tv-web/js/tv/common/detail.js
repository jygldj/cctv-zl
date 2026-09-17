
function setupVideo(video) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.zIndex = '2147483647';
    container.style.backgroundColor = 'black';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.transform = 'translateZ(0)';
    container.appendChild(video);
    document.body.appendChild(container);
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

}
// 这里已经是文档加载后的了
(function(){
    _tvFunc.waitForVideoElement().then(video => {
        /* [v4.5.33] waitForVideoElement() 等不到时 resolve(null)。
           原实现立刻拿 null 去访问 video.style / video.muted，抛 TypeError，
           整条 Promise 链当场断掉、且没有任何兜底被执行 —— 页面就停在未脱壳的原样。
           实测地方台多为 SPA，<video> 由 JS 运行时创建，等不到是常态，
           这正是「各省地方台 90%+ 不脱壳」的直接原因之一。先判空，避免静默断链。 */
        if(!video){
            console.log("[道玄电视] waitForVideoElement 未取到 video，跳过脱壳兜底");
            return;
        }
        let param=_tvFunc.getQueryParams();
        let type="0";
        if(param["utaot"]){
            type=param["utaot"];
        }
        console.log("type::",type);
        if(type==="0"){
            /* [v4.5.33] 补回 gao 的护栏：pageFsBtn 若已成功让站点自己进入全屏，
               就不需要再把 video 粗暴搬进黑箱。x5 迁移时这两道护栏被删掉了。 */
            if(!window.__DXTV_PAGE_FS__){
                setupVideo(video);
            }
        }
        if(type==="1"){
            if(!window.__DXTV_PAGE_FS__){
                _tvFunc.fixedW("body");
                _tvFunc.fullscreen("video");
                $$("video").css("position","fixed !important");
            }
        }
        video.muted = false;
        video.volume = 1;
        video.playsInline = false;
        video.setAttribute('playsinline', 'false');
        try {
            video.play();
        } catch (e) {
        }
        $$("body").css("min-width","100%");
        $$("html").css("min-width","100%");
        _tvFunc.check(function (){
            let videoPlay=_tvFunc.isVideoPlaying(video);
            if(!videoPlay){
                try{
                    _tvFunc.getVideo().play();
                }catch(e){}
            }
            return videoPlay},function (){_data.hzList(video);},1000,5);

    }).catch(function(e){
        /* [v4.5.33] 兜底：任何异常都要留下痕迹，不能再像以前那样静默断链。 */
        console.error("[道玄电视] 地方台脱壳链异常", e);
    });
})();
$$(function (){
    let url = window.location.href;
    if(url.indexOf("u-link=1")>0){
        _tvFunc.check(function (){
            let utaoLoc =  sessionStorage.getItem("u-loc");
            if(utaoLoc){
                console.log("utaoLoc",utaoLoc,url);
                if(url==utaoLoc){
                    window.location.href=extractDomain(utaoLoc)+"/tv-web/live.html?url="+sessionStorage.getItem("u-m3u8");
                    return true
                }
            }
            return false},function (){},1000,10);
    }
  /*  let param=_tvFunc.getQueryParams();
    if(param["ujs"]){
        let ujs = param["ujs"];
        ujs=decodeURIComponent(ujs);
        console.log("ujs",ujs);
    }*/
    let ujs=   _tvFunc.getQueryParams()["ujs"];
        //url.indexOf("ujs=");
    if(ujs){
        let ujsContent=decodeUnicodeBase64(ujs.replace(/ /g, '+'));
        console.log("ujsContent",ujsContent);
        eval(ujsContent);
        //$$(tag).click();
    }
    //viewport
 /*   let viewport = document.getElementById("viewport");
    console.log("viewport::",viewport);
    if(viewport){
        viewport.content = "width=device-width, initial-scale=1";
    }*/
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    console.log("viewportMeta::",viewportMeta);
    if (viewportMeta) {
        viewportMeta.setAttribute('content', `width=device-width, initial-scale=1`);
    }
    //

// _tvFunc.videoReady(function (video)

});



