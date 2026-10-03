const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {screen, ipcMain} = require("electron");
const {defaultRadialSettings, normalizeRadialSettings} = require("../build/shared/radial-settings");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function p1Smoke(ctx) {
  const {app, BrowserWindow, applyAppSettings, appSettingsSnapshot, showRadialMenu,
    hideRadialMenu, radialMenuWindow: radial, petWindow: pet, taskSystem} = ctx;
  const output = path.join(app.getAppPath(), "dist", "qa-p1");
  await fs.mkdir(output, {recursive:true});
  const errors = [];
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 3) errors.push(message);
    });
    win.webContents.on("render-process-gone", (_e, detail) => errors.push(JSON.stringify(detail)));
  }
  const read = code => Promise.race([radial.webContents.executeJavaScript(code),
    sleep(5000).then(()=>{throw new Error("Renderer timeout: "+code.slice(0,100));})]);
  const readPet = code => pet.webContents.executeJavaScript(code);
  const restartCheck=process.argv.find(arg=>arg.startsWith("--p1-restart-ignore="));
  if(restartCheck) {
    const expected=restartCheck.endsWith("=true");
    assert.equal(appSettingsSnapshot().radialMenu.scale,101);
    assert.equal(appSettingsSnapshot().ignoreMouseEvents,expected);
    assert.equal((await read("window.taskPetRadialMenu.getState()")).radialMenu.scale,101);
    await applyAppSettings({ignoreMouseEvents:!expected});
    console.log("P1 restart passed: scale=101, ignoreMouseEvents="+expected);
    return;
  }
  const settings = BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("/settings/index.html"));
  const base = defaultRadialSettings();
  assert.equal(base.scale,90);
  for (const scale of [50,65,90,123,130]) assert.equal(normalizeRadialSettings({...base,scale}).scale,scale);
  for (const scale of [undefined,40,140]) assert.equal(normalizeRadialSettings({...base,scale}).scale,90);
  const sliderIds=["pet-opacity","pet-scale","radial-opacity","radial-scale"];
  pet.showInactive();
  await applyAppSettings({petScale:100,ignoreMouseEvents:false,radialMenu:{...base,animations:false,
    items:base.items.map(i=>({...i,enabled:sliderIds.includes(i.id)||i.id==="music"||i.id==="toggle-ignore-mouse"}))}});
  const area=screen.getPrimaryDisplay().workArea;
  const positions=[
    [area.x+area.width/2,area.y+area.height/2],
    [area.x,area.y], [area.x+area.width-120,area.y],
    [area.x,area.y+area.height-143], [area.x+area.width-120,area.y+area.height-143]
  ];
  const widths=[];
  let windowAt;
  if(process.platform==="win32"){
    const koffi=require("koffi");
    koffi.struct("TaskPetP1Point",{x:"long",y:"long"});
    const native=koffi.load("user32.dll");
    const hit=native.func("uintptr_t __stdcall WindowFromPoint(TaskPetP1Point point)");
    const root=native.func("uintptr_t __stdcall GetAncestor(uintptr_t window, uint32_t flags)");
    windowAt=point=>root(hit(point),2);
  }
  for (const scale of [50,90,130]) {
    console.log("P1 layout scale",scale);
    await applyAppSettings({radialMenu:{...appSettingsSnapshot().radialMenu,scale}});
    for (const [x,y] of positions) {
      console.log("P1 position",x,y);
      hideRadialMenu();pet.setPosition(Math.round(x),Math.round(y));
      showRadialMenu();await sleep(150);
      const bounds=radial.getBounds();
      if(windowAt){
        const point=screen.dipToScreenPoint({x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.width/2)});
        assert.equal(BigInt(windowAt(point)),pet.getNativeWindowHandle().readBigUInt64LE(),
          "native transparent center must hit the pet window");
      }
      assert.ok(bounds.x>=area.x && bounds.y>=area.y);
      assert.ok(bounds.x+bounds.width<=area.x+area.width && bounds.y+bounds.height<=area.y+area.height);
      let previous;
      for (const id of sliderIds) {
        await read(`document.querySelector('[data-action="${id}"]').click()`);
        const layout=await read(`(()=>{
          const panel=document.getElementById("panel"),b=panel.getBoundingClientRect(),s=panel.querySelector("input");
          const icons=[...document.querySelectorAll("#items button")].map(e=>e.getBoundingClientRect());
          return {hidden:panel.hidden,x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,
            windowWidth:innerWidth,windowHeight:innerHeight,maxIconBottom:Math.max(...icons.map(b=>b.bottom)),
            value:s.value,min:s.min,max:s.max};
        })()`);
        assert.equal(layout.hidden,false);
        assert.equal(radial.isVisible(),true,"adjustment must not dismiss wheel");
        assert.ok(Math.abs(layout.x+layout.width/2-layout.windowWidth/2)<1);
        assert.ok(layout.y>=layout.windowWidth && layout.y>layout.maxIconBottom);
        assert.ok(layout.bottom<=layout.windowHeight);
        if(previous)assert.deepEqual([layout.x,layout.y,layout.width,layout.height],previous);
        previous=[layout.x,layout.y,layout.width,layout.height];
        if(id==="radial-scale")assert.deepEqual([layout.min,layout.max,layout.value],["50","130",String(scale)]);
      }
      if(x===positions[0][0] && y===positions[0][1]) {
        widths.push(bounds.width);
        console.log("P1 capture",scale,radial.isVisible());
        if(!radial.isVisible())radial.showInactive();
        await sleep(100);
        const capture=await Promise.race([radial.webContents.capturePage(),sleep(5000).then(()=>{throw new Error("Capture timed out");})]);
        await fs.writeFile(path.join(output,"scale-"+scale+".png"),capture.toPNG());
      }
      await read(`document.querySelector('[data-action="toggle-ignore-mouse"]').click()`);
      assert.equal(await read('document.getElementById("panel").hidden'),true);
    }
  }
  assert.ok(widths[0]<widths[1] && widths[1]<widths[2], "all size ranges visibly resize");
  showRadialMenu();await sleep(120);
  await read(`document.querySelector('[data-action="radial-scale"]').click();
    const slider=document.querySelector('#panel input');slider.value='101';slider.dispatchEvent(new Event('input',{bubbles:true}));`);
  for(let i=0;i<50&&appSettingsSnapshot().radialMenu.scale!==101;i++)await sleep(20);
  assert.equal(appSettingsSnapshot().radialMenu.scale,101);
  assert.equal((await settings.webContents.executeJavaScript("window.taskPetSettings.get()")).data.radialMenu.scale,101);
  const beforeMove=radial.getBounds(),beforePet=pet.getBounds();
  pet.setPosition(beforePet.x-20,beforePet.y-20);await sleep(150);
  const afterMove=radial.getBounds();
  assert.equal(afterMove.x,beforeMove.x-20);
  assert.equal(afterMove.y,beforeMove.y-20);
  assert.equal(await read('document.getElementById("panel").hidden'),false);
  hideRadialMenu();await sleep(100);showRadialMenu();await sleep(100);
  assert.equal(await read('document.getElementById("panel").hidden'),true);
  hideRadialMenu();

  // Use actual Chromium input events, real preload IPC and the main action dispatcher.
  const actions=[];const drag=[];
  const originalToggle=taskSystem.togglePanel.bind(taskSystem);
  taskSystem.togglePanel=(...args)=>{actions.push("left");return originalToggle(...args);};
  const originalMonitor=taskSystem.setMonitoringPaused.bind(taskSystem);
  taskSystem.setMonitoringPaused=value=>{actions.push("double");return originalMonitor(value);};
  const onStart=()=>drag.push("start"),onMove=()=>drag.push("move");
  ipcMain.on("taskpet:start-window-drag",onStart);ipcMain.on("taskpet:move-window",onMove);
  await applyAppSettings({alwaysOnTop:true,mouseBindings:{leftClick:"open-panel",doubleClick:"toggle-monitoring",rightClick:"open-radial-menu"}});
  pet.show();pet.focus();await sleep(100);
  const delay=(await readPet("window.taskPet.getInitialState()")).config.doubleClickDelayMs;
  await readPet(`window.p1Events=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click'])
    document.getElementById('pet').addEventListener(type,e=>window.p1Events.push({type,button:e.button,x:e.screenX,y:e.screenY,primary:e.isPrimary}));`);
  const click=(count=1,button="left")=>{
    pet.webContents.sendInputEvent({type:"mouseDown",x:60,y:50,globalX:100,globalY:100,button,clickCount:count});
    pet.webContents.sendInputEvent({type:"mouseUp",x:60,y:50,globalX:100,globalY:100,button,clickCount:count});
  };
  for(const ignore of [false,true,false,true,false]) {
    console.log("P1 mouse ignore",ignore);
    hideRadialMenu();
    await applyAppSettings({ignoreMouseEvents:ignore});
    pet.focus();actions.length=0;click();await sleep(delay+150);
    assert.deepEqual(actions,ignore?[]:["left"],"single click switch="+ignore);
    actions.length=0;pet.focus();click();await sleep(50);click(2);await sleep(delay+150);
    assert.deepEqual(actions,["double"],"double click must not dispatch singles");
    actions.length=0;drag.length=0;pet.focus();
    pet.webContents.sendInputEvent({type:"mouseDown",x:60,y:50,globalX:100,globalY:100,button:"left",clickCount:1});
    pet.webContents.sendInputEvent({type:"mouseMove",x:80,y:50,globalX:120,globalY:100,button:"left",modifiers:["leftButtonDown"]});
    await sleep(60);
    assert.equal(await readPet('document.getElementById("pet").classList.contains("dragging")'),true,
      JSON.stringify(await readPet('window.p1Events')));
    pet.webContents.sendInputEvent({type:"mouseUp",x:80,y:50,globalX:120,globalY:100,button:"left",clickCount:1});
    await sleep(delay+100);
    assert.ok(drag.includes("start")&&drag.includes("move"));
    assert.deepEqual(actions,[]);
    assert.equal(await readPet('getComputedStyle(document.getElementById("pet")).cursor'),"default");
    pet.focus();click(1,"right");await sleep(150);
    assert.equal(radial.isVisible(),true,"right click remains enabled");
  }
  hideRadialMenu();
  showRadialMenu();await sleep(100);actions.length=0;click();await sleep(delay+150);
  assert.deepEqual(actions,["left"],"visible wheel must not swallow a pet click");
  assert.equal(radial.isVisible(),false);
  const stored=JSON.parse(await fs.readFile(path.join(app.getPath("userData"),"settings.json"),"utf8"));
  assert.equal(stored.ignoreMouseEvents,false);
  assert.equal(normalizeRadialSettings(stored.radialMenu).scale,101);
  assert.deepEqual(errors,[]);
  ipcMain.removeListener("taskpet:start-window-drag",onStart);ipcMain.removeListener("taskpet:move-window",onMove);
  console.log("P1 passed: 3 sizes x 5 positions x 4 sliders; real click/double/drag/right input x 5 switch states; IPC, saved settings, clean console.");
};
