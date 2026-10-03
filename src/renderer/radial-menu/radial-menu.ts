/** Radial UI: the center remains transparent; main owns native operations. */
(() => {
type Bridge = import("../../preload/radial-menu-preload").RadialMenuBridge;
type State = import("../../preload/radial-menu-preload").RadialMenuState;
type Item = import("../../preload/radial-menu-preload").RadialMenuItem;
type Update = import("../../preload/radial-menu-preload").RadialMenuUpdate;
type Music = import("../../preload/radial-menu-preload").RadialMusicState;
const api = (window as unknown as {taskPetRadialMenu: Bridge}).taskPetRadialMenu;
const root = document.getElementById("menu")!;
const items = document.getElementById("items")!;
const panel = document.getElementById("panel")!;
const feedback = document.getElementById("feedback")!;
const names: Record<string,string> = {
  "open-panel":"任务面板","quick-add":"添加任务","open-settings":"设置","toggle-monitoring":"暂停 / 恢复监控",
  "toggle-pet":"显示 / 隐藏桌宠","toggle-ignore-mouse":"忽略鼠标事件","toggle-always-on-top":"始终置顶",
  "pet-opacity":"桌宠透明度","pet-scale":"桌宠大小","radial-opacity":"轮盘透明度","radial-scale":"轮盘大小",
  music:"QQ 音乐",quit:"退出 TaskPet",more:"更多操作"
};
const paths: Record<string,string> = {
  "open-panel":"M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  "quick-add":"M12 4v16 M4 12h16",
  "open-settings":"M9 4h6l1 3 3 1v8l-3 1-1 3H9l-1-3-3-1V8l3-1z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  "toggle-monitoring":"M8 5v14 M16 5v14","toggle-pet":"M2 12Q12 0 22 12Q12 24 2 12 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  "toggle-ignore-mouse":"M6 3l12 9-6 1-3 6z","toggle-always-on-top":"M8 3h8l-1 7 4 4H5l4-4z M12 14v7",
  "pet-opacity":"M12 3Q-3 18 12 21Q27 18 12 3z M12 8v10",
  "pet-scale":"M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  "radial-opacity":"M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 3v18",
  "radial-scale":"M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z",
  music:"M9 17V5l11-2v12 M9 17a3 2 0 1 1-6 0a3 2 0 1 1 6 0 M20 15a3 2 0 1 1-6 0a3 2 0 1 1 6 0",
  quit:"M12 2v10 M7 5a9 9 0 1 0 10 0",more:"M4 8h16 M4 12h16 M4 16h16",
  previous:"M5 5v14 M19 5L7 12l12 7z",next:"M19 5v14 M5 5l12 7-12 7z",
  play:"M7 4l13 8-13 8z",pause:"M8 5v14 M16 5v14",app:"M3 5h18v14H3z M3 9h18"
};
let state: State | null = null;
let page = 0;
let panelId: string | null = null;
let owner: HTMLButtonElement | null = null;
let hoverTimer: number | undefined;
let leaveTimer: number | undefined;
let feedbackTimer: number | undefined;
let closeTimer: number | undefined;
let music: Music = {available:false};
let musicBusy = false;
let musicEpoch = 0;
let pending: Update | null = null;
let writing = false;
let activeSlider: HTMLInputElement | null = null;
let signature = "";
let wasHidden = document.hidden;
let restoringFocus = false;
function icon(id:string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("aria-hidden","true");
  const path = document.createElementNS(svg.namespaceURI,"path");
  path.setAttribute("d", paths[id] ?? paths.app!); svg.append(path); return svg;
}
function buttons(): HTMLButtonElement[] { return Array.from(items.querySelectorAll("button")); }
function tell(text:string,error=false):void {
  window.clearTimeout(feedbackTimer); feedback.replaceChildren(document.createTextNode(text));
  feedback.hidden=false; feedback.classList.toggle("error",error);
  if(error) {
    const settings=document.createElement("button"); settings.textContent="打开设置"; settings.onclick=()=>{void api.action("open-settings");};
    feedback.append(settings);
  } else feedbackTimer=window.setTimeout(()=>feedback.hidden=true,2200);
}
function place(element:HTMLElement, _button?:HTMLElement):void {
  // The wheel occupies a square; the remaining 100px are a fixed-size footer.
  element.style.left = Math.max(8, (window.innerWidth - element.offsetWidth) / 2) + "px";
  element.style.top = (window.innerWidth + 8) + "px";
}
function closePanel(refocus=true):void {
  window.clearTimeout(hoverTimer); window.clearTimeout(leaveTimer);
  musicEpoch++; panel.hidden=true; panelId=null; activeSlider=null;
  owner?.classList.remove("selected");
  if(refocus) {restoringFocus=true;owner?.focus();restoringFocus=false;}
  owner=null;
}
function closeMenu():void {
  if(writing || pending) { void flush().then(()=>closeMenu()); return; }
  closePanel(false); 
  root.classList.remove("opening"); root.classList.add("closing");
  window.clearTimeout(closeTimer);
  closeTimer=window.setTimeout(()=>{api.close();root.classList.remove("closing");},state?.radialMenu.animations && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 150:0);
}
function heading(text:string):void {
  const row=document.createElement("div"); row.className="panel-heading";
  const label=document.createElement("span"); label.textContent=text;
  const back=document.createElement("button"); back.className="panel-back"; back.textContent="收起"; back.onclick=()=>closePanel();
  row.append(label,back); panel.append(row);
}
function selected(id:string,button:HTMLButtonElement):void {
  closePanel(false); panelId=id;owner=button;button.classList.add("selected");
  panel.replaceChildren();panel.hidden=false;
  panel.setAttribute("aria-label", names[id] ?? "调节面板"); heading(names[id] ?? "");
}
function progress(slider:HTMLInputElement):void {
  slider.style.setProperty("--progress",((Number(slider.value)-Number(slider.min))/(Number(slider.max)-Number(slider.min))*100)+"%");
}
async function flush():Promise<void> {
  if(writing) { await new Promise(resolve=>window.setTimeout(resolve,20)); return; }
  writing=true;
  try {
    while(pending) {const update=pending;pending=null;
      try { render(await api.update(update)); } catch(error) {tell(error instanceof Error?error.message:"设置保存失败",true);}
    }
  } finally {writing=false;}
}
function sliderPanel(id:string,button:HTMLButtonElement):void {
  if(!state)return;
  if(panelId===id){closePanel();return;}
  selected(id,button);
  const slider=document.createElement("input"); slider.type="range";slider.className="slider";slider.setAttribute("aria-label",names[id]!);
  const isPet=id.startsWith("pet"), isScale=id.endsWith("scale");
  slider.min=isScale?(isPet?"60":"50"):(isPet?"20":"40");
  slider.max=isScale?(isPet?"180":"130"):"100"; slider.step=isScale&&isPet?"5":"1";
  slider.value=String(isPet?(isScale?state.petScale:state.petOpacity):(isScale?state.radialMenu.scale:state.radialMenu.opacity));
  const current=document.createElement("output");current.className="slider-value";
  current.textContent="当前值："+slider.value;
  const limits=document.createElement("div");limits.className="slider-limits";
  const minimum=document.createElement("span");minimum.textContent=slider.min;
  const maximum=document.createElement("span");maximum.textContent=slider.max;
  limits.append(minimum,maximum);
  progress(slider);panel.append(current,slider,limits);activeSlider=slider;place(panel);
  slider.oninput=()=>{
    const value=Number(slider.value);progress(slider);current.textContent="当前值："+value;
    pending=isPet?(isScale?{petScale:value}:{petOpacity:value}):{radialMenu:isScale?{scale:value}:{opacity:value}};
    void flush();
  };
  slider.focus();
}
function paintMusic():void {
  if(panelId!=="music")return;
  const focusedCommand=(document.activeElement as HTMLElement | null)?.dataset.command;
  panel.replaceChildren();
  const controls=document.createElement("div"); controls.className="music-controls";
  for(const [command,label,glyph] of [["previous","上一首","previous"],["toggle","暂停","pause"],["next","下一首","next"]] as const){
    const button=document.createElement("button");button.className="music-button";button.setAttribute("aria-label",label);button.dataset.command=command;
    button.setAttribute("aria-disabled",String(!music.available || musicBusy));button.append(icon(glyph));
    const caption=document.createElement("span");caption.textContent=label;button.append(caption);
    button.onclick=()=>{if(music.available && !musicBusy)void runMusic(command);};controls.append(button);
  }
  panel.append(controls);
  if(owner)place(panel,owner);
  if(focusedCommand)panel.querySelector<HTMLButtonElement>('[data-command="'+focusedCommand+'"]')?.focus();
}
async function runMusic(command:"status"|"previous"|"toggle"|"next"):Promise<void>{
  if(musicBusy)return;
  const epoch=musicEpoch;musicBusy=true;paintMusic();
  const result=await api.music(command);musicBusy=false;
  if(epoch!==musicEpoch){if(panelId==="music")void runMusic("status");return;}
  music=result;paintMusic();
  const button=buttons().find(b=>b.dataset.action==="music");button?.classList.toggle("unavailable",!music.available);
}
function musicPanel(button:HTMLButtonElement):void{
  window.clearTimeout(leaveTimer);
  if(panelId==="music")return;
  selected("music",button);paintMusic();void runMusic("status");
}
async function execute(button:HTMLButtonElement):Promise<void>{
  const id=button.dataset.action!;
  
  if(id==="more"){closePanel(false);page++;signature="";render(state!);buttons()[0]?.focus();return;}
  if(id==="music"){musicPanel(button);return;}
  if(["pet-opacity","pet-scale","radial-opacity","radial-scale"].includes(id)){sliderPanel(id,button);return;}
  closePanel(false);
  if(button.getAttribute("aria-busy")==="true")return;
  button.setAttribute("aria-busy","true");
  const result=await api.action(id);button.removeAttribute("aria-busy");
  button.classList.toggle("failed",!result.ok);
  if(!result.ok)tell(result.error || "操作失败，请重试",true);
  else {button.classList.add("succeeded");window.setTimeout(()=>button.classList.remove("succeeded"),1600);}
}
function render(next:State):void{
  state=next;
  root.style.setProperty("--menu-opacity",String(next.radialMenu.opacity/100));
  root.classList.toggle("reduce-motion",!next.radialMenu.animations);
  const enabled=next.radialMenu.items.filter(i=>i.enabled);
  const pageCount=enabled.length>8?Math.ceil(enabled.length/7):1;
  page%=pageCount;
  const visible:Item[]=pageCount>1?[...enabled.slice(page*7,page*7+7),{id:"more",enabled:true}]:enabled;
  const nextSignature=JSON.stringify(visible);
  if(signature!==nextSignature){
    closePanel(false);signature=nextSignature;items.replaceChildren();
    visible.forEach((item,index)=>{
      const button=document.createElement("button");button.type="button";button.className="menu-action";button.dataset.action=item.id;
      button.setAttribute("aria-label",names[item.id] ?? item.name ?? "应用");
      const label=document.createElement("span");label.className="menu-label";label.textContent=button.getAttribute("aria-label");
      button.append(icon(item.id),label);button.onclick=()=>{void execute(button);};
      if(item.id.startsWith("app-"))void api.appIcon(item.id).then(data=>{
        if(!data||!button.isConnected)return;
        const image=document.createElement("img");image.src=data;image.alt="";image.width=26;image.height=26;
        button.replaceChildren(image,label);
      }).catch(()=>{});
      button.onmouseenter=()=>{if(item.id==="music"){window.clearTimeout(leaveTimer);hoverTimer=window.setTimeout(()=>musicPanel(button),150);}};
      button.onfocus=()=>{if(item.id==="music"&&!restoringFocus)musicPanel(button);};
      button.onmouseleave=()=>{window.clearTimeout(hoverTimer);if(item.id==="music")leaveTimer=window.setTimeout(()=>{if(panelId==="music"&&!panel.matches(":hover")&&!panel.contains(document.activeElement))closePanel(false);},350);};
      items.append(button);
    });
  }
  const dimension=window.innerWidth;
  const card=Math.max(28,Math.min(56,dimension*.12));
  const radius=dimension/2-card/2-36;
  buttons().forEach((button,index,all)=>{
    const angle=-Math.PI/2+index*Math.PI*2/all.length;
    const dx=Math.cos(angle)*radius,dy=Math.sin(angle)*radius;
    button.style.left=window.innerWidth/2+dx+"px";button.style.top=dimension/2+dy+"px";
    button.style.setProperty("--dx",dx+"px");button.style.setProperty("--dy",dy+"px");button.style.setProperty("--card-size",card+"px");
    const id=button.dataset.action;
    const pressed=id==="toggle-ignore-mouse"?next.ignoreMouseEvents:id==="toggle-always-on-top"?next.alwaysOnTop:id==="toggle-monitoring"?next.monitoringPaused:undefined;
    if(pressed!==undefined)button.setAttribute("aria-pressed",String(pressed));
  });
  if(activeSlider && !writing && !pending) {
    const isPet=panelId!.startsWith("pet"), isScale=panelId!.endsWith("scale");
    activeSlider.value=String(isPet?(isScale?next.petScale:next.petOpacity):(isScale?next.radialMenu.scale:next.radialMenu.opacity));
    progress(activeSlider);
    panel.querySelector("output")!.textContent="当前值："+activeSlider.value;
  }
  if(owner)place(panel,owner);
  if(!enabled.length)tell("当前没有启用的菜单项，请打开设置添加。",true);
}
panel.onmouseenter=()=>window.clearTimeout(leaveTimer);
panel.onmouseleave=()=>{if(panelId==="music"&&!panel.contains(document.activeElement))leaveTimer=window.setTimeout(()=>closePanel(false),350);};
document.addEventListener("pointerdown",event=>{
  if(!(event.target instanceof Element)||event.target.closest("button,input,#panel,#feedback"))return;
  if(panelId)closePanel();else closeMenu();
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"){event.preventDefault();if(panelId)closePanel();else closeMenu();return;}
  if(event.target instanceof HTMLInputElement)return;
  const list=buttons();if(!list.length)return;
  if(["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"].includes(event.key)){
    event.preventDefault();const index=list.indexOf(document.activeElement as HTMLButtonElement);
    list[(index+(event.key==="ArrowLeft"||event.key==="ArrowUp"?-1:1)+list.length)%list.length]?.focus();
  }else if(/^[1-8]$/.test(event.key)){event.preventDefault();const b=list[Number(event.key)-1];if(b)void execute(b);}
  else if(event.key==="Tab"){
    const focusable=Array.from(root.querySelectorAll<HTMLElement>("button,input")).filter(el=>!el.closest("[hidden]"));
    const current=focusable.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();focusable[(current+(event.shiftKey?-1:1)+focusable.length)%focusable.length]?.focus();
  }
});
function open():void{
  window.clearTimeout(closeTimer);root.classList.remove("closing");root.classList.remove("opening");
  void root.offsetWidth;root.classList.add("opening");feedback.hidden=true;closePanel(false);
  void api.getState().then(next=>{if(next)render(next);}).catch(()=>tell("无法读取轮盘配置",true));
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){wasHidden=true;closePanel(false);}else if(wasHidden){wasHidden=false;open();}
});
window.addEventListener("resize",()=>{if(state)render(state);});
const unsubscribe=api.onChanged(render);
window.addEventListener("beforeunload",()=>{unsubscribe();window.clearTimeout(hoverTimer);window.clearTimeout(leaveTimer);window.clearTimeout(closeTimer);window.clearTimeout(feedbackTimer);});
open();
})();
