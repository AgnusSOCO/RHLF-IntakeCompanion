import WebSocket from "ws";
import { config } from "../config";

export type SpeakerChannel = "caller" | "agent";

export interface TranscriptResult {
  speaker: SpeakerChannel;
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  start: number;
  duration: number;
  language?: string;
  confidence?: number;
}

/**
 * One Deepgram live transcription connection per audio channel.
 * Sends raw s16le 16 kHz mono PCM; receives Results messages.
 * Caller and agent are separate connections (clean speaker labels,
 * no diarization needed).
 */
export class DeepgramLiveStream {
  private ws?: WebSocket;
  private keepAlive?: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly speaker: SpeakerChannel,
    private readonly onResult: (r: TranscriptResult) => void,
    private readonly onError: (e: Error) => void
  ) {}

  open(): void {
    const params = new URLSearchParams({
      model: config.dgModel,
      language: config.dgLanguage,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      endpointing: "100",
      smart_format: "true",
      mip_opt_out: "true",
      tag: `rhlf-${this.speaker}`,
    });
    const url = `wss://api.deepgram.com/v1/listen?${params}`;

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${config.deepgramApiKey}` },
    });

    this.ws.on("open", () => {
      // Deepgram closes idle streams; KeepAlive covers silence/holds.
      this.keepAlive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8000);
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== "Results") return;
        const alt = msg.channel?.alternatives?.[0];
        if (!alt || !alt.transcript) return;
        this.onResult({
          speaker: this.speaker,
          text: alt.transcript,
          isFinal: Boolean(msg.is_final),
          speechFinal: Boolean(msg.speech_final),
          start: msg.start ?? 0,
          duration: msg.duration ?? 0,
          language: alt.languages?.[0],
          confidence: alt.confidence,
        });
      } catch {
        /* non-JSON frame */
      }
    });

    this.ws.on("error", (err) => this.onError(err));
    this.ws.on("close", (code, reason) => {
      if (!this.closed) {
        this.onError(new Error(`Deepgram ${this.speaker} stream closed: ${code} ${reason}`));
      }
    });
  }

  send(pcm: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.keepAlive);
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}
