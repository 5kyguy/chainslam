import { API_BASE_URL } from "./client";
import type { WsEnvelope, WsStatus } from "../types";

export interface MatchSocketHandlers {
  onMessage: (message: WsEnvelope) => void;
  onStatus?: (status: WsStatus) => void;
  onError?: (error: Event) => void;
}

function wsBaseUrl(): string {
  if (API_BASE_URL.startsWith("https://")) return API_BASE_URL.replace(/^https:\/\//, "wss://");
  if (API_BASE_URL.startsWith("http://")) return API_BASE_URL.replace(/^http:\/\//, "ws://");
  return API_BASE_URL;
}

export function matchWsUrl(matchId: string): string {
  return `${wsBaseUrl()}/ws/matches/${encodeURIComponent(matchId)}`;
}

export function connectMatchSocket(matchId: string, handlers: MatchSocketHandlers): () => void {
  let socket: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | undefined;
  let attempt = 0;

  const connect = () => {
    handlers.onStatus?.(attempt === 0 ? "connecting" : "reconnecting");
    socket = new WebSocket(matchWsUrl(matchId));

    socket.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus?.("connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        handlers.onMessage(JSON.parse(event.data) as WsEnvelope);
      } catch (err) {
        console.warn("[match-ws] failed to parse message", err);
      }
    });

    socket.addEventListener("error", (error) => {
      handlers.onStatus?.("error");
      handlers.onError?.(error);
    });

    socket.addEventListener("close", () => {
      if (closedByClient) {
        handlers.onStatus?.("closed");
        return;
      }
      attempt += 1;
      const delay = Math.min(5000, 800 * attempt);
      handlers.onStatus?.("reconnecting");
      reconnectTimer = window.setTimeout(connect, delay);
    });
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
