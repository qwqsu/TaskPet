import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import { QqMusicService, type QqMusicCommand } from "../src/main/services/qq-music-service";
import { QQ_MUSIC_HELPER_FUNCTIONS, createQqMusicHelperScript } from "../src/main/services/qq-music-helper";

function fixture(timeoutMs = 1000) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    kills: 0, kill() { this.kills++; return true; }
  });
  const calls: unknown[][] = [];
  const spawnHelper = ((...args: unknown[]) => { calls.push(args); return child; }) as unknown as typeof spawn;
  const service = new QqMusicService({ platform: "win32", spawnHelper, timeoutMs });
  const reply = (value: unknown, code: number | null = 0) => {
    child.stdout.write(JSON.stringify(value));
    child.emit("close", code);
  };
  return { child, calls, service, reply };
}

test("non-Windows and disposed services do not launch helpers", async () => {
  const service = new QqMusicService({ platform: "linux", spawnHelper: (() => {
    throw new Error("must not spawn");
  }) as typeof spawn });
  assert.deepEqual(await service.execute("status"), { available: false });
  service.dispose();
  assert.match((await service.execute("toggle")).error!, /已关闭/);
});

test("status returns only the observed playback state and launches hidden encoded PowerShell", async () => {
  const f = fixture();
  const request = f.service.execute("status");
  f.reply({ available: true, playing: false, title: "discard me" });
  assert.deepEqual(await request, { available: true, playing: false });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0]![0] as string, /System32\\WindowsPowerShell\\v1.0\\powershell.exe$/);
  const args = f.calls[0]![1] as string[];
  assert.equal(Buffer.from(args.at(-1)!, "base64").toString("utf16le"), createQqMusicHelperScript("status"));
  assert.deepEqual(f.calls[0]![2], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  f.service.dispose();
});

for (const command of ["previous", "toggle", "next"] as const) {
  test(`${command} requires an explicit Boolean Windows acknowledgment`, async () => {
    for (const acknowledged of [undefined, false, "true", true]) {
      const f = fixture();
      const request = f.service.execute(command);
      f.reply({ available: true, acknowledged });
      const result = await request;
      if (acknowledged === true) assert.deepEqual(result, { available: true });
      else assert.match(result.error!, /未确认/);
      assert.equal(f.calls.length, 1);
      f.service.dispose();
    }
  });
}

test("missing session and rejected command remain distinct", async () => {
  const f = fixture();
  const absent = f.service.execute("status");
  f.reply({ available: false });
  assert.deepEqual(await absent, { available: false });
  f.service.dispose();
  const g = fixture();
  const rejected = g.service.execute("next");
  g.reply({ available: true, acknowledged: false, error: "Windows rejected the QQ Music command." });
  assert.deepEqual(await rejected, { available: true, error: "Windows rejected the QQ Music command." });
  g.service.dispose();
});

test("concurrent commands are not queued, repeated, or launched twice", async () => {
  const f = fixture();
  const pending = f.service.execute("toggle");
  const busyToggle = f.service.execute("toggle");
  const busyNext = f.service.execute("next");
  assert.equal(f.calls.length, 1);
  f.reply({ available: true, acknowledged: true });
  assert.match((await busyToggle).error!, /正在处理/);
  assert.match((await busyNext).error!, /正在处理/);
  assert.deepEqual(await pending, { available: true });
  f.service.dispose();
});

test("timeout kills a silent helper and settles without a close event or retries", async () => {
  const f = fixture(10);
  const result = await f.service.execute("toggle");
  assert.match(result.error!, /超时.*无法确认/);
  assert.equal(f.child.kills, 1);
  assert.equal(f.calls.length, 1);
  f.reply({ available: true, acknowledged: true });
  f.service.dispose();
});

test("dispose kills the pending helper once and settles without exit", async () => {
  const f = fixture();
  const pending = f.service.execute("next");
  f.service.dispose();
  f.service.dispose();
  assert.match((await pending).error!, /已关闭/);
  assert.equal(f.child.kills, 1);
  assert.match((await f.service.execute("status")).error!, /已关闭/);
  f.child.emit("error", new Error("late error after kill"));
});

test("spawn failure, nonzero exit, malformed protocol and oversized output fail safely", async () => {
  const service = new QqMusicService({ platform: "win32", spawnHelper: (() => {
    throw new Error("missing powershell");
  }) as typeof spawn });
  assert.match((await service.execute("status")).error!, /启动/);
  service.dispose();
  for (const mode of ["error", "exit", "json", "shape", "overflow", "stream"] as const) {
    const f = fixture();
    const pending = f.service.execute("status");
    if (mode === "error") f.child.emit("error", new Error("ENOENT"));
    if (mode === "exit") f.reply({ available: true }, 1);
    if (mode === "json") { f.child.stdout.write("not JSON"); f.child.emit("close", 0); }
    if (mode === "shape") f.reply({ available: true, playing: "yes" });
    if (mode === "overflow") f.child.stdout.write("x".repeat(16385));
    if (mode === "stream") f.child.stdout.emit("error", new Error("broken pipe"));
    assert.equal((await pending).available, false);
    assert.equal(f.calls.length, 1);
    f.service.dispose();
  }
});

test("invalid commands never enter PowerShell", async () => {
  const f = fixture();
  assert.match((await f.service.execute("next; malicious" as QqMusicCommand)).error!, /不支持/);
  assert.throws(() => createQqMusicHelperScript("next; malicious"), /不支持/);
  assert.equal(f.calls.length, 0);
  f.service.dispose();
});

function runPowerShell(script: string): unknown {
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("actual PowerShell regex accepts exact QQMusic executable identities only", { skip: process.platform !== "win32" }, () => {
  const identities = [
    "QQMusic.exe", "qqmusic.EXE", "C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe",
    "C:\\QQMusic.exe", "Spotify.exe", "chrome.exe", "NotQQMusic.exe", "QQMusic.exe.bak",
    "QQMusic.exe\n", "QQMusic.exe\r\n", "prefixQQMusic.exe", "QQMusic", "QQMusic.exe!App",
    "Tencent.QQMusic_random!App", "C:\\QQMusic.exe\\Spotify.exe", "relative\\QQMusic.exe",
    "https://example.com/QQMusic.exe", "", "QQMusicHelper.exe"
  ];
  const literal = identities.map((id) => `'${id.replaceAll("'", "''")}'`).join(",");
  const result = runPowerShell(QQ_MUSIC_HELPER_FUNCTIONS + `\n@(${literal}) | ForEach-Object { Test-QqMusicIdentity $_ } | ConvertTo-Json -Compress`);
  assert.deepEqual(result, identities.map((_, index) => index < 4));
});

test("actual helper targets QQMusic only and dispatches each method exactly once with OS ack", { skip: process.platform !== "win32" }, () => {
  const script = QQ_MUSIC_HELPER_FUNCTIONS + String.raw`
function Wait-WinRt($Operation, [Type] $ResultType) { return $Operation }
function New-Session([string] $Identity, [bool] $Ack = $true) {
    $session = [pscustomobject]@{ SourceAppUserModelId = $Identity; Calls = @(); Ack = $Ack }
    $session | Add-Member ScriptMethod TrySkipPreviousAsync { $this.Calls += 'previous'; return $this.Ack }
    $session | Add-Member ScriptMethod TryTogglePlayPauseAsync { $this.Calls += 'toggle'; return $this.Ack }
    $session | Add-Member ScriptMethod TrySkipNextAsync { $this.Calls += 'next'; return $this.Ack }
    $session | Add-Member ScriptMethod GetPlaybackInfo { return @{ PlaybackStatus = 'Paused' } }
    return $session
}
$other = New-Session 'Spotify.exe'
$lookalike = New-Session 'NotQQMusic.exe'
$qq = New-Session 'QQMusic.exe'
$results = @('status', 'previous', 'toggle', 'next') | ForEach-Object { Invoke-QqMusicCommand @($other, $lookalike, $qq) $_ }
$absent = Invoke-QqMusicCommand @($other, $lookalike) 'next'
$ambiguous = Invoke-QqMusicCommand @($qq, (New-Session 'C:\QQMusic.exe')) 'next'
$rejected = Invoke-QqMusicCommand @((New-Session 'QQMusic.exe' $false)) 'toggle'
@{ results = @($results); calls = @($qq.Calls); otherCalls = @($other.Calls); lookalikeCalls = @($lookalike.Calls); absent = $absent; ambiguous = $ambiguous; rejected = $rejected } | ConvertTo-Json -Depth 5 -Compress
`;
  const value = runPowerShell(script) as any;
  assert.deepEqual(value.calls, ["previous", "toggle", "next"]);
  assert.deepEqual(value.otherCalls, []);
  assert.deepEqual(value.lookalikeCalls, []);
  assert.deepEqual(value.results[0], { available: true, playing: false });
  for (const result of value.results.slice(1)) assert.deepEqual(result, { available: true, playing: false, acknowledged: true });
  assert.deepEqual(value.absent, { available: false });
  assert.equal(value.ambiguous.available, false);
  assert.match(value.ambiguous.error, /无法确定/);
  assert.equal(value.rejected.acknowledged, false);
  assert.match(value.rejected.error, /拒绝/);
});

test("acknowledged dispatch survives a stale status snapshot without guessing playback or retrying", { skip: process.platform !== "win32" }, () => {
  const value = runPowerShell(QQ_MUSIC_HELPER_FUNCTIONS + String.raw`
function Wait-WinRt($Operation, [Type] $ResultType) { return $Operation }
$session = [pscustomobject]@{ SourceAppUserModelId = 'QQMusic.exe'; Calls = 0 }
$session | Add-Member ScriptMethod TryTogglePlayPauseAsync { $this.Calls++; return $true }
$session | Add-Member ScriptMethod GetPlaybackInfo { throw 'Session closed after acknowledgement' }
$result = Invoke-QqMusicCommand @($session) 'toggle'
@{ result = $result; calls = $session.Calls } | ConvertTo-Json -Compress
`) as any;
  assert.deepEqual(value, { result: { available: true, acknowledged: true }, calls: 1 });
});

test("timeout terminates a real Windows helper process", { skip: process.platform !== "win32", timeout: 5000 }, async () => {
  let exited: Promise<void> | undefined;
  let helper: ReturnType<typeof spawn> | undefined;
  const service = new QqMusicService({ platform: "win32", timeoutMs: 150, spawnHelper: ((file, _args, options) => {
    helper = spawn(file, ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"], options ?? {});
    exited = new Promise<void>((resolve) => { helper!.once("close", () => resolve()); });
    return helper;
  }) as typeof spawn });
  try {
    const result = await service.execute("status");
    assert.match(result.error!, /超时/);
    assert.equal(helper?.killed, true);
    await exited;
  } finally {
    service.dispose();
    helper?.kill();
  }
});
