let TvFocus={
    curFocusId:null,
    focusClass:"tv-focus",
    menuId: null,
    model:{
        event:{}
    },
   /* constructor(menuId) {
        this.menuId=menuId;
        console.log("constructor menuId",menuId)
    }*/
    init(menuId){
        this.menuId=menuId;
        this.menuCtrl();
        this.initKeyEvent();
        this.observe();
    },
    menuCtrl(){
        let _this=this;
        window._menuCtrl={
            menu(){
                //_this.keyMenuEvent();
                _this.menu();
                let data = _detailData();
                //console.log("menu",data);
                _apiX.message("menu",data);
            },
            ok(){
                _this.keyOkEvent();
            },
            back(){
                _this.keyBackEvent();
            },
            left(){
                _this.keyLeftEvent();
            },
            right(){
                _this.keyRightEvent();
            },
            down(){
                _this.keyDownEvent();
            },
            up(){
                _this.keyUpEvent();
            },
            focus(id){
                let realId = (id&&id.charAt(0)==="#") ? id.substring(1) : id;
                _this.curFocusId = realId;
                _this.applyFocus(realId);
                if(window.__setFocus){ window.__setFocus(realId); }
            }
        }
    },
    ok(){
        if(_ctrlx.ok){
            _ctrlx.ok();
        }
        return true;
    },
    menu(){
        if(_ctrlx.menu){
            _ctrlx.menu();
        }
        return true;
    },
    back(){
        return true;
    },
    left(){
        if(_isVideo){
            let duration=_tvFunc.getVideo().duration;
            if(duration=="Infinity"){
                return true;
            }
            _tvFunc.getVideo().currentTime-=20;_layer.notifyLess("进度减20秒");
        }
        return true;
    },
    right(){
        if(_isVideo){
            let duration=_tvFunc.getVideo().duration;
            if(duration=="Infinity"){
                return true;
            }
            _tvFunc.getVideo().currentTime+=20;_layer.notifyLess("进度加20秒");
        }
        return true;
    },
    up(){
        let video= _tvFunc.getVideo();
        let currentVolume=_tvFunc.getVideo().volume;
        if(currentVolume<1){if((currentVolume+0.2)>1){video.volume=1}else{video.volume+=0.2}}
        let name= Math.floor(video.volume*100);
        _layer.notifyLess("音量"+name);
        return true;
    },
    down(){
        let video= _tvFunc.getVideo();
        let currentVolume=_tvFunc.getVideo().volume;
        if(currentVolume>0){if((currentVolume-0.2)<0){video.volume=0}else{video.volume-=0.2;}}
        let name= Math.floor(video.volume*100);
        _layer.notifyLess("音量"+name);
        return true;
    },
    keyDownEvent(){
        var elem= this.getFocus();
        if(null==elem){
            this.down();
            return;
        }
        var updownNum= elem.attr("move-updown");
        if(updownNum){
            this.move(this.next(elem,updownNum));
        }
        this.moveBack(elem,"move-down");
    },
    moveBack(elem,attr){
        var attrElem= elem.attr(attr);
        if(attrElem){
            var strs =  attrElem.split(":");
            if(strs.length==1){
                if($$(attrElem).length>0){
                    this.move($$(attrElem).first());
                }else{
                    this.moveBack(elem,attr+"b");
                }
            }
            if(strs.length==2){
                this.move($$(strs[0]).find(strs[1]).first());
            }   
        }
    },
    keyUpEvent(){
        var elem= this.getFocus()
        if(null==elem){
            this.up();
            return;
        }
        var updownNum= elem.attr("move-updown");
        if(updownNum){
            this.move(this.prev(elem,updownNum));
            return;
        }
        var moveUp= elem.attr("move-up");
        if(moveUp){
            this.move($$(moveUp).first());
        }
    },
    keyRightEvent() {
        console.log("keyRightEvent");
        let focus=this.getFocus();
        if(null==focus){
            this.right();
            return;
        }
        this.move(focus.next());
    },
    found(location){
        if(null==this.menuId){
            return  $$(location);
        }
        let isShow=_layer.isShow(this.menuId);
        if(isShow){
            return $$("#"+this.menuId).find(location);
        }
        return  null;
    },
    getFocus(){
        let el = this.curFocusId ? $$("#"+this.curFocusId) : null;
        if(el && el.length>0){
            return el;
        }
        // 悬空救援：curFocusId 指向的元素已不存在 → 转移至当前可见频道的分页/列表元素
        return this.rescueFocus();
    },
    rescueFocus(){
        let contents = document.querySelectorAll(".tv-content");
        let box = null;
        for(let i=0;i<contents.length;i++){
            if(contents[i].style.display !== "none"){
                box = contents[i];
                break;
            }
        }
        if(box){
            let el = box.querySelector(".tv-prev") || box.querySelector(".tv-next") || box.querySelector(".tv-item");
            if(el && el.id){
                this.curFocusId = el.id;
                this.applyFocus(el.id);
                return $$("#"+el.id);
            }
        }
        return null;
    },
    // TvFocus 独占 tv-focus 类：全局仅一个框，直接增删，不依赖 Vue :class（根治 Vue 重渲染抢类）
    applyFocus(id){
        if(!id){ return; }
        $$(".tv-focus").removeClass("tv-focus");
        let el = $$("#"+id);
        if(el && el.length>0){ el.addClass("tv-focus"); }
        this.curFocusId = id;
    },
    // MutationObserver 兜底：Vue 重渲染会重置 className 抹掉手动加的 tv-focus，此处侦测并补回，确保全局仅一个焦点框
    observe(){
        let _this=this;
        this._focusObserver = new MutationObserver(function(){
            if(_this._raf){ cancelAnimationFrame(_this._raf); }
            _this._raf = requestAnimationFrame(function(){
                let id=_this.curFocusId;
                if(!id){ return; }
                let el=document.getElementById(id);
                if(el && !el.classList.contains("tv-focus")){ el.classList.add("tv-focus"); }
                let others = document.querySelectorAll(".tv-focus");
                for(let i=0;i<others.length;i++){
                    if(others[i].id!==id){ others[i].classList.remove("tv-focus"); }
                }
            });
        });
        this._focusObserver.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:["class"]});
    },
    keyLeftEvent() {
        console.log("keyLeftEvent");
        let focus=this.getFocus();
        if(null==focus){
            this.left();
            return;
        }
        this.move(focus.prev());
    },
    idFound(elem,num,down){
        let idPre=elem.attr("move-updown-id");
        if(idPre){
            let nowId=elem.attr("id").substring(idPre.length);
            console.log("foundId nowId::"+nowId);
            let newNum=Number(nowId)-Number(num);
            if(down){
                newNum=Number(nowId)+Number(num);
            }
            let foundId=idPre+newNum;
            console.log("foundId::"+foundId);
            if(null!=document.getElementById(foundId)){
                return $$("#"+foundId);
            }else{
                if(!down){
                    var moveUp= elem.attr("move-up");
                    return $$(moveUp);
                }
                return null;   // 下行目标不存在：返回 null，交 next() 兜底遍历 DOM 到"下一页"
            }

            return elem;
        }
        return null;
    },
    next(elem,num){
        let newElem = this.idFound(elem,num,true);
        if(null!=newElem){
             return newElem;
        }
        //var elem= $$(this.focusId);
        for(var i=0;i<num;i++){
            if(elem.next()&&elem.next().length>0){
                elem=elem.next();
            }
        }
        return elem;
    },
    prev(elem,num){
        let newElem = this.idFound(elem,num,false);
        if(null!=newElem){
             return newElem;
        }
        for(var i=0;i<num;i++){
            if(elem.prev()&&elem.prev().length>0){
                elem=elem.prev();
            }else{
                var moveUp= elem.attr("move-up");
                return $$(moveUp);
            }
        }
        return elem;
    },
    move(nextElm){
        if(nextElm&&nextElm.length>0){
            this.curFocusId = nextElm.attr("id");
            this.applyFocus(this.curFocusId);
            this.scrollTo();
            this.focusEvent();
        }
    },
    isElementInViewport(el) {
        var rect = el.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      },
    scrollIntoView(el) {
        // 找到可滚动的父容器
        var parent = el.parentElement;
        var isHeader = el.closest('.tv-header') !== null;

        if (isHeader) {
            parent = el.closest('.tv-header');
            // 轻微延迟以确保DOM更新
            setTimeout(() => {
                document.body.scrollTop = 0;
                document.documentElement.scrollTop = 0;

                var elementRect = el.getBoundingClientRect();
                if (elementRect.right > window.innerWidth) {
                    parent.scrollLeft += (elementRect.right - window.innerWidth) + 60;
                } else if (elementRect.left < 0) {
                    parent.scrollLeft = Math.max(0, parent.scrollLeft + elementRect.left - 60);
                }
            }, 50);
            return;
        }

        // 查找最近的可滚动容器
        while (parent) {
            var style = window.getComputedStyle(parent);
            var overflow = style.getPropertyValue('overflow');
            var overflowY = style.getPropertyValue('overflow-y');

            var isScrollable = (overflow === 'auto' || overflow === 'scroll' ||
                    overflowY === 'auto' || overflowY === 'scroll') &&
                parent.scrollHeight > parent.clientHeight;

            if (isScrollable) break;
            parent = parent.parentElement;
        }

        // 如果没找到可滚动容器，使用document.scrollingElement
        if (!parent) {
            parent = document.scrollingElement || document.documentElement;
        }

        var elementRect = el.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        var viewportWidth = window.innerWidth;

        // 使用 requestAnimationFrame 确保平滑滚动
        requestAnimationFrame(() => {
            // 计算垂直滚动
            if (elementRect.bottom > viewportHeight) {
                // 向下滚动时，确保元素完全可见
                var scrollOffset = elementRect.bottom - viewportHeight + 20;
                parent.scrollTop += scrollOffset;
            } else if (elementRect.top < 0) {
                // 向上滚动时，确保元素完全可见
                parent.scrollTop += elementRect.top - 20;
            }

            // 计算水平滚动
            if (elementRect.right > viewportWidth) {
                parent.scrollLeft += elementRect.right - viewportWidth + 40;
            } else if (elementRect.left < 0) {
                parent.scrollLeft = Math.max(0, parent.scrollLeft + elementRect.left - 40);
            }

            // 强制重绘以防止白屏
            parent.style.transform = 'translateZ(0)';
        });
    },
    scrollTo: function() {
        var el = this.curFocusId ? document.querySelector("#"+this.curFocusId) : null;
        if (!el) return; // 防止元素不存在时的错误
        
        var flag = this.isElementInViewport(el);
        if (!flag) {
            setTimeout(() => {
                el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
            },50);
        }
    },
    keyOkEvent() {
        console.log("点击了确认键");
        let focus=this.getFocus();
        if(null==focus){
            this.ok();
            return;
        }
        focus.trigger("click");
    },
    keyBackEvent(){
        if(_layer.isShow(this.menuId)){
            //menu
            _layer.hide(this.menuId);
            return;
        }
        /* [v4.5.27] App 内禁止「页面级返回首页」。
           本工程是全工程唯一一处会把 WebView 导航回首页的 JS：
               window.location.href = _browser.getURL("index.html")
           它由 _menuCtrl.back() 以及 keyCode 81(=Q) 直接触发，不需要任何用户意图。
           一旦触发，页面会自己跳回 index.html，而跳转前挂上的等待层
           （「等待跳转...」/「正在跳转到 XXX 」）就留在首页上，遥控焦点也跟着失效
           —— 实测 CCTV 直播入口：计数器走完 → 黑屏 → 自动退回首页 → 遮罩卡死。
           App 里返回键本来就归原生 Activity 统一处理
           （MainActivity.keyBack → WebView.goBack），不需要 JS 再跳一次。
           只有无原生壳的浏览器/Gecko 环境才保留跳首页兜底。 */
        try{
            if(_tvFunc && _tvFunc.isApp && _tvFunc.isApp()){
                return;
            }
        }catch(e){}
        window.location.href= this.backUrl();
    },
    backUrl(){
        return _browser.getURL("index.html");
    },
    keyMenuEvent(){
        console.log("keyMenuEvent");
        this.isShow= _layer.toggle(_tv_menuId);
        if(!this.isShow){
            this.focus=null;
            _apiX.msgStr("menuShow","0");
        }else{
            this.menu();
            this.focus=this.curFocusId ? $$("#"+this.curFocusId) : null;
            _apiX.msgStr("menuShow","1");
        }
    },
    focusEvent(){
        console.log("focusEvent ");
        let focus=this.getFocus();
        if(null!=focus){
            console.log("focusEvent focus");
            focus.trigger("focus");
        }
    },
    initKeyEvent() {
        var KEY_BACK = 8,
            KeyQ=81,
            KEY_OK = 13,
            KeyA=65,
            KeyW=87,
            KeyD = 68,
            KeyS=83,
            KeyR=82
        let _this=this;
        console.log("initKeyEvent....")
        document.addEventListener("keydown",function(e){
       // .onkeydown = function (e) {
            var keyCode=e.keyCode;
           // console.log(e.keyCode);
           // if(!e.code){ keyCode=e.keyCode;}
            /* [v4.5.27] 补回遥控器键码：本工程此前只认电脑键盘 W/A/S/D/Q/R，
               遥控器的 19/38(上) 20/40(下) 21/37(左) 22/39(右) 23/66(确定)
               一个都没绑（cctv-gao 是两组都认）。机顶盒上方向键全落空，
               所以这里对齐 cctv-gao：两组键码并存，谁到算谁。 */
            switch (keyCode) {
                case 19:
                case 38:
                case KeyW:
                    _this.keyUpEvent()
                    break;
                case 20:
                case 40:
                case KeyS:
                    _this.keyDownEvent()
                    break
                case 21:
                case 37:
                case KeyA:
                    _this.keyLeftEvent()
                    break
                case 4: /*ipannel*/
                case 22:
                case 39:
                case KeyD:
                    _this.keyRightEvent()
                    break
                case KeyQ:
                    _this.keyBackEvent()
                    break
                case 23:
                case 66:
                case KEY_OK:
                    _this.keyOkEvent();
                    e.preventDefault();
                    break
                case KeyR:
                    _this.keyMenuEvent();
                    break
                default:
                    break
            }
        });
    }
};
window.TvFocus = TvFocus;
