"use client";

/**
 * In-app playback only. The browser's download control and the context
 * menu are suppressed so the recording is listened to here, not saved.
 * The proxy route still requires the session, so the URL is not shareable.
 */
export function RecordingPlayer({ callId }: { callId: string }) {
  return (
    <audio
      controls
      controlsList="nodownload noplaybackrate"
      onContextMenu={(event) => event.preventDefault()}
      preload="metadata"
      className="w-full"
      src={`/api/calls/${encodeURIComponent(callId)}/recording.mp3`}
    >
      Your browser cannot play this recording.
    </audio>
  );
}
