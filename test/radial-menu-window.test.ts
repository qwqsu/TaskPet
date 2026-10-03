import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createRadialMenuWindowOptions,
  radialMenuShape,
  radialMenuBoundsForPoint
} from "../src/main/windows/radial-menu-window";

test("radial menu is a single secure transparent overlay", () => {
  const options = createRadialMenuWindowOptions({ preloadPath: "C:\\TaskPet\\radial.js" });
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
});

test("radial menu stays inside negative and positive display work areas", () => {
  const leftDisplay = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(radialMenuBoundsForPoint({ x: -1915, y: 5 }, leftDisplay), {
    x: -1912,
    y: 8,
    width: 300,
    height: 400
  });
  assert.deepEqual(radialMenuBoundsForPoint({ x: -5, y: 1075 }, leftDisplay), {
    x: -308,
    y: 672,
    width: 300,
    height: 400
  });
});

test("radial menu uses dynamic actions, transparent center and explicit dismissal", () => {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(
    path.join(root, "src", "renderer", "radial-menu", "index.html"),
    "utf8"
  );
  const renderer = fs.readFileSync(
    path.join(root, "src", "renderer", "radial-menu", "radial-menu.ts"),
    "utf8"
  );
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  for (const action of [
    "open-settings",
    "toggle-pet",
    "toggle-ignore-mouse",
    "pet-opacity",
    "pet-scale",
    "music",
    "quit"
  ]) {
    assert.ok(renderer.includes(action));
  }
  assert.doesNotMatch(html, /menu-center|opacityValue/);
  assert.match(html, /id="panel"[^>]*hidden/);
  assert.match(renderer, /event\.key==="Escape"/);
  assert.doesNotMatch(renderer, /document\.addEventListener\("mouseleave"/);
  assert.match(main, /if \(radialMenuWindow && !radialMenuWindow\.isDestroyed\(\)\) return radialMenuWindow/);
});

test("odd-sized wheel anchors remain stable and reserve the footer at every edge", () => {
  const area={x:-1920,y:-100,width:1920,height:1080};
  for(const size of [253,429,605]) for(const point of [
    {x:-1900,y:-90},{x:-10,y:-90},{x:-1900,y:970},{x:-10,y:970},{x:-900,y:400}
  ]) {
    const bounds=radialMenuBoundsForPoint(point,area,size);
    assert.equal(bounds.height-bounds.width,100);
    assert.ok(bounds.x>=area.x && bounds.y>=area.y);
    assert.ok(bounds.x+bounds.width<=area.x+area.width);
    assert.ok(bounds.y+bounds.height<=area.y+area.height);
    const center={x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.width/2)};
    assert.deepEqual(radialMenuBoundsForPoint(center,area,size),bounds);
  }
});

test("native shape passes the pet body through while keeping wheel and footer clickable", () => {
  const shape=radialMenuShape(429,529,{x:166,y:162,width:96,height:104});
  const hit=(x:number,y:number)=>shape.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
  assert.equal(hit(214,214),false);
  assert.equal(hit(166,162),false);
  assert.equal(hit(261,265),false);
  assert.equal(hit(214,60),true);
  assert.equal(hit(80,214),true);
  assert.equal(hit(350,214),true);
  assert.equal(hit(214,470),true);
});
