import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { MusicService, musicIdentityPattern } from "../src/main/services/music-service";
import { createMusicHelperFunctions } from "../src/main/services/qq-music-helper";
import { normalizeMusicBinding } from "../src/shared/music-settings";
import type { QqMusicCommand, QqMusicResult } from "../src/main/services/qq-music-service";

const binding = {name: "Music", path: "C:\\Music\\Player.exe", executablePath: "C:\\Music\\Player.exe"};
function fixture(options: { bound?: boolean; running?: boolean; before?: QqMusicResult; after?: QqMusicResult; invalid?: boolean } = {}) {
  const calls: string[] = [];
  const service = new MusicService({
    binding: () => options.bound === false ? null : binding,
    validatePath: async value => { if (options.invalid) throw new Error("文件不存在，请重新绑定路径"); return value; },
    isRunning: async () => options.running ?? false,
    openPath: async target => { calls.push(target); return ""; },
    wait: async () => {},
    createTransport: () => ({
      execute: async (command: QqMusicCommand) => { calls.push(command); return command === "status" ? options.before ?? {available: false} : options.after ?? {available: true, playing: true}; },
      dispose: () => {}
    })
  });
  return {service, calls};
}

test("music launches a selected player and requests explicit play, never toggle", async () => {
  const f = fixture();
  const result = await f.service.execute("launch-play");
  assert.deepEqual(f.calls, ["status", binding.path, "play"]);
  assert.equal(result.launched, true);
  assert.equal(result.playing, true);
  f.service.dispose();
});
test("music click never pauses playing sessions or relaunches a running player", async () => {
  const playing = fixture({before: {available: true, playing: true}});
  await playing.service.execute("launch-play");
  assert.deepEqual(playing.calls, ["status"]);
  const running = fixture({running: true});
  await running.service.execute("launch-play");
  assert.deepEqual(running.calls, ["status", "play"]);
});
test("unbound launch asks for binding while old QQ controls remain available", async () => {
  const f = fixture({bound: false});
  assert.equal((await f.service.execute("launch-play")).needsBinding, true);
  assert.deepEqual(f.calls, []);
  await f.service.execute("previous");
  assert.deepEqual(f.calls, ["previous"]);
});
test("missing path, ambiguous session and unsupported playback return distinct failures", async () => {
  const invalid = fixture({invalid: true});
  assert.match((await invalid.service.execute("launch-play")).error!, /重新绑定/);
  assert.deepEqual(invalid.calls, []);
  const ambiguous = fixture({before: {available: false, error: "检测到多个 QQ 音乐播放会话"}});
  assert.match((await ambiguous.service.execute("launch-play")).error!, /多个播放器/);
  assert.deepEqual(ambiguous.calls, ["status"]);
  const unsupported = fixture({after: {available: false}});
  const result = await unsupported.service.execute("launch-play");
  assert.equal(result.launched, true);
  assert.match(result.error!, /手动播放/);
});
test("concurrent launch clicks are not queued or duplicated", async () => {
  const f = fixture();
  const first = f.service.execute("launch-play");
  assert.match((await f.service.execute("launch-play")).error!, /本次请求未发送/);
  await first;
  assert.equal(f.calls.filter(call => call === binding.path).length, 1);
});
test("saved music binding rejects URI, arguments and malformed shortcut targets", () => {
  assert.deepEqual(normalizeMusicBinding(binding), binding);
  for (const path of ["https://example.com/Player.exe", "C:\\Player.exe --evil", "relative.exe", "C:\\Player.exe\0"]) {
    assert.equal(normalizeMusicBinding({...binding, path}), null);
  }
});
test("generic Windows helper uses exact identity, rejects lookalikes and safely handles quotes", {skip: process.platform !== "win32"}, () => {
  const target = "C:\\Music's folder\\Player.exe";
  const functions = createMusicHelperFunctions(musicIdentityPattern(target), target);
  const script = functions + String.raw`
function Wait-WinRt($Operation, [Type] $ResultType) { return $Operation }
function Get-MusicExecutablePaths([string] $Name) { return "C:\Music's folder\Player.exe" }
$player = [pscustomobject]@{SourceAppUserModelId = "C:\Music's folder\Player.exe"; Calls = @()}
$player | Add-Member ScriptMethod GetPlaybackInfo { return @{ PlaybackStatus = 'Playing' } }
$player | Add-Member ScriptMethod TryPlayAsync { $this.Calls += 'play'; return $true }
$result = Invoke-QqMusicCommand @($player) 'play'
$matches = @('Player.exe', 'NotPlayer.exe', 'C:\Other\Player.exe', 'Player.exe!App') | ForEach-Object { Test-QqMusicIdentity $_ }
function Get-MusicExecutablePaths([string] $Name) { return 'C:\Other\Player.exe' }
$differentPath = Test-QqMusicIdentity 'Player.exe'
function Get-MusicExecutablePaths([string] $Name) { return @("C:\Music's folder\Player.exe", 'C:\Other\Player.exe') }
$ambiguousPaths = Test-QqMusicIdentity 'Player.exe'
@{ matches = @($matches); differentPath = $differentPath; ambiguousPaths = $ambiguousPaths; result = $result; calls = @($player.Calls) } | ConvertTo-Json -Depth 5 -Compress
`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {encoding: "utf8", windowsHide: true, timeout: 10000});
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim());
  assert.deepEqual(value.matches, [true, false, false, false]);
  assert.equal(value.result.playing, true);
  assert.equal(value.differentPath, false);
  assert.equal(value.ambiguousPaths, false);
  assert.deepEqual(value.calls, []);
});
