/** Embedded so tsc/electron-builder ship the helper without an extra copy step.
 * GSMTC reference: https://learn.microsoft.com/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession
 * Deliberately allow only the desktop executable identity (or its absolute DOS
 * path). Unknown packaged AUMIDs fail closed; never substring-match "QQMusic".
 */
export const QQ_MUSIC_IDENTITY_PATTERN = String.raw`\A(?:[A-Za-z]:\\(?:[^\\\r\n]+\\)*)?QQMusic\.exe\z`;

// Functions are separate from the entry point so tests can exercise the actual
// PowerShell selection/dispatch logic with fake sessions, without controlling music.
export const QQ_MUSIC_HELPER_FUNCTIONS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Test-QqMusicIdentity([string] $Identity) {
    $options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    return [regex]::IsMatch($Identity, '${QQ_MUSIC_IDENTITY_PATTERN}', $options)
}

function Wait-WinRt($Operation, [Type] $ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
        $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1'
    } | Select-Object -First 1
    if ($null -eq $method) { throw 'Windows 媒体控制接口不可用。' }
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(2000)) { throw 'Windows 媒体操作超时，操作结果无法确认。' }
    return $task.GetAwaiter().GetResult()
}

function Invoke-QqMusicCommand($Sessions, [string] $Command) {
    $matches = @($Sessions | Where-Object { Test-QqMusicIdentity ([string] $_.SourceAppUserModelId) })
    if ($matches.Count -eq 0) { return @{ available = $false } }
    if ($matches.Count -ne 1) {
        return @{ available = $false; error = '检测到多个 QQ 音乐播放会话，无法确定要控制的播放器。' }
    }
    $session = $matches[0]
    if ($Command -ne 'status') {
        $operation = switch ($Command) {
            'previous' { $session.TrySkipPreviousAsync(); break }
            'toggle' { $session.TryTogglePlayPauseAsync(); break }
            'next' { $session.TrySkipNextAsync(); break }
            default { throw '不支持此 QQ 音乐操作。' }
        }
        $acknowledged = Wait-WinRt $operation ([bool])
        if ($acknowledged -isnot [bool] -or -not $acknowledged) {
            return @{ available = $true; acknowledged = $false; error = 'Windows 拒绝了此 QQ 音乐操作。' }
        }
    }
    $result = @{ available = $true }
    if ($Command -ne 'status') { $result.acknowledged = $true }
    # The state is a snapshot, not a prediction from the requested command.
    # A post-ack state read failure must not imply the command should be retried.
    try {
        $state = [string] $session.GetPlaybackInfo().PlaybackStatus
        if ($state -eq 'Playing') { $result.playing = $true }
        elseif ($state -eq 'Paused' -or $state -eq 'Stopped') { $result.playing = $false }
    } catch {
        if ($Command -eq 'status') { throw }
    }
    return $result
}
`;

export function createQqMusicHelperScript(command: string): string {
  if (!["status", "previous", "toggle", "next"].includes(command)) {
    throw new Error("不支持此 QQ 音乐操作。");
  }
  return QQ_MUSIC_HELPER_FUNCTIONS + String.raw`
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $manager = Wait-WinRt ($managerType::RequestAsync()) $managerType
    $result = Invoke-QqMusicCommand ($manager.GetSessions()) '${command}'
    $result | ConvertTo-Json -Compress
} catch {
    # Do not expose OS exception text, which may contain paths or English details.
    $message = if ('${command}' -eq 'status') {
        '无法读取 QQ 音乐状态，请确认 QQ 音乐和系统媒体控制可用。'
    } else {
        'QQ 音乐操作未完成，执行结果无法确认。'
    }
    @{ available = $false; error = $message } | ConvertTo-Json -Compress
}
`;
}
