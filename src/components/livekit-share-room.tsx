import { useEffect, useRef, useState } from "react";
import { Check, Copy, MonitorUp, ShieldCheck, UserRoundX, Users, X } from "lucide-react";
import type { Room } from "livekit-client";
import {
  closeLiveRoom,
  createLiveRoom,
  decideLiveRoomEntry,
  getLiveGuestAdmission,
  getLiveHostSession,
  getLiveRoomStatus,
  leaveLiveRoom,
  removeLiveRoomGuest,
  requestLiveRoomEntry,
} from "@/lib/multiplayer/livekit";

type HostSession = { role: "host"; roomId: string; hostSecret: string };
type GuestSession = { role: "guest"; roomId: string; guestId: string; requestSecret: string; alias: string };
type Session = HostSession | GuestSession;
type Guest = { id: string; display_name: string; status: "pending" | "approved" };

async function connectRoom(
  url: string,
  token: string,
  media: HTMLDivElement | null,
  onLocalShareChange?: (sharing: boolean) => void,
  onScreenVisible?: (visible: boolean) => void,
) {
  const { Room: LiveKitRoom, RoomEvent, Track } = await import("livekit-client");
  const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
  const attach = (track: { attach: () => HTMLMediaElement }, isLocal = false) => {
    const element = track.attach();
    element.className = "h-full w-full rounded-xl bg-black object-contain";
    if (element instanceof HTMLVideoElement) element.playsInline = true;
    if (isLocal && element instanceof HTMLVideoElement) element.muted = true;
    media?.replaceChildren(element);
  };
  const detach = (track: { detach: () => HTMLMediaElement[] }) => {
    for (const element of track.detach()) element.remove();
  };
  room.on(RoomEvent.TrackSubscribed, (track, publication) => {
    if (publication.source === Track.Source.ScreenShare) {
      attach(track);
      onScreenVisible?.(true);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
    detach(track);
    if (publication.source === Track.Source.ScreenShare) onScreenVisible?.(false);
  });
  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (publication.source === Track.Source.ScreenShare && publication.track) {
      attach(publication.track, true);
      onLocalShareChange?.(true);
      onScreenVisible?.(true);
    }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
    if (publication.track) detach(publication.track);
    if (publication.source === Track.Source.ScreenShare) {
      onLocalShareChange?.(false);
      onScreenVisible?.(false);
    }
  });
  await room.connect(url, token);
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    if (publication?.isSubscribed && publication.videoTrack) attach(publication.videoTrack);
  }
  const localScreen = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  if (localScreen?.track) attach(localScreen.track, true);
  return room;
}

function guestUrl(roomId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("sala", roomId);
  url.hash = "";
  return url.toString();
}

export function LiveKitShareRoom({ puzzleId }: { puzzleId: string }) {
  const [open, setOpen] = useState(false);
  const [roomIdInput, setRoomIdInput] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hasScreen, setHasScreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState("");
  const mediaRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const currentPuzzle = puzzleId;

  useEffect(() => () => {
    void roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  useEffect(() => {
    const roomId = new URLSearchParams(window.location.search).get("sala");
    if (!roomId) return;
    setOpen(true);
    setRoomIdInput(roomId);
    const hostSecret = window.sessionStorage.getItem(`crossmat:host:${roomId}`);
    if (!hostSecret) return;
    let cancelled = false;
    const hostSession: HostSession = { role: "host", roomId, hostSecret };
    setOpen(true);
    setSession(hostSession);
    setMessage("Reconectando à sala...");
    void getLiveHostSession({ data: { roomId, hostSecret } }).then(async (result) => {
      if (cancelled) return;
      const room = await connectRoom(result.url, result.token, mediaRef.current, setSharing, setHasScreen);
      if (cancelled) return void room.disconnect();
      roomRef.current = room;
      setConnected(true);
      setMessage("");
      setInvite(guestUrl(roomId));
      setRoomIdInput(roomId);
    }).catch(() => {
      if (!cancelled) setMessage("Não foi possível recuperar a sala. Ela pode ter expirado.");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session || session.role !== "host" || !connected) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await getLiveRoomStatus({ data: { roomId: session.roomId, hostSecret: session.hostSecret } });
        if (!cancelled) setGuests(result.guests as Guest[]);
      } catch {
        if (!cancelled) setMessage("Conexão de controle interrompida. Verifique se a sala continua ativa.");
      }
      if (!cancelled) timer = window.setTimeout(poll, 2200);
    };
    let timer = window.setTimeout(poll, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [session, connected]);

  useEffect(() => {
    if (!session || session.role !== "guest" || connected) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await getLiveGuestAdmission({ data: {
          roomId: session.roomId,
          guestId: session.guestId,
          requestSecret: session.requestSecret,
        } });
        if (cancelled) return;
        if (result.status === "approved") {
          const room = await connectRoom(result.url, result.token, mediaRef.current, setSharing, setHasScreen);
          if (cancelled) return void room.disconnect();
          roomRef.current = room;
          setConnected(true);
          setMessage("Entrada aprovada. Você está assistindo à transmissão.");
          return;
        }
        if (result.status === "denied" || result.status === "removed" || result.status === "left") {
          setMessage("O pedido não está mais ativo.");
          return;
        }
      } catch {
        if (!cancelled) setMessage("Não foi possível verificar o pedido. Confira o código da sala.");
        return;
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [session, connected]);

  const hostSession = session?.role === "host" ? session : null;
  const guestSession = session?.role === "guest" ? session : null;

  const startHost = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await createLiveRoom();
      const url = new URL(window.location.href);
      url.searchParams.set("fase", currentPuzzle);
      url.searchParams.set("sala", result.roomId);
      url.hash = "";
      window.history.replaceState(null, "", url);
      window.sessionStorage.setItem(`crossmat:host:${result.roomId}`, result.hostSecret);
      setSession({ role: "host", roomId: result.roomId, hostSecret: result.hostSecret });
      setRoomIdInput(result.roomId);
      setInvite(guestUrl(result.roomId));
      roomRef.current = await connectRoom(result.url, result.token, mediaRef.current, setSharing, setHasScreen);
      setConnected(true);
      setMessage("Sala criada. Compartilhe o convite e aprove cada pessoa antes da entrada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível criar a sala.");
    } finally {
      setBusy(false);
    }
  };

  const requestEntry = async () => {
    const roomId = roomIdInput.trim();
    if (!/^cm-[a-f0-9-]{36}$/.test(roomId)) {
      setMessage("Digite o código completo da sala.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await requestLiveRoomEntry({ data: { roomId } });
      setSession({ role: "guest", roomId, guestId: result.guestId, requestSecret: result.requestSecret, alias: result.alias });
      setMessage(`Pedido enviado como ${result.alias}. Aguarde o anfitrião aprovar.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível pedir entrada.");
    } finally {
      setBusy(false);
    }
  };

  const shareScreen = async () => {
    if (!roomRef.current) return;
    setBusy(true);
    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(!sharing);
      setSharing(!sharing);
      setMessage(!sharing ? "Escolha a tela ou janela que deseja compartilhar." : "Compartilhamento encerrado.");
    } catch {
      setMessage("O navegador não iniciou a captura. Tente novamente e escolha a tela que deseja mostrar.");
    } finally {
      setBusy(false);
    }
  };

  const answerRequest = async (guestId: string, approve: boolean) => {
    if (!hostSession) return;
    try {
      await decideLiveRoomEntry({ data: { roomId: hostSession.roomId, hostSecret: hostSession.hostSecret, guestId, approve } });
      setGuests((items) => approve
        ? items.map((guest) => guest.id === guestId ? { ...guest, status: "approved" } : guest)
        : items.filter((guest) => guest.id !== guestId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível responder ao pedido.");
    }
  };

  const close = async () => {
    if (roomRef.current) await roomRef.current.disconnect();
    roomRef.current = null;
    if (hostSession) {
      await closeLiveRoom({ data: { roomId: hostSession.roomId, hostSecret: hostSession.hostSecret } }).catch(() => {});
      window.sessionStorage.removeItem(`crossmat:host:${hostSession.roomId}`);
    } else if (guestSession) {
      await leaveLiveRoom({ data: { roomId: guestSession.roomId, guestId: guestSession.guestId, requestSecret: guestSession.requestSecret } }).catch(() => {});
    }
    setSession(null);
    setConnected(false);
    setGuests([]);
    setSharing(false);
    setHasScreen(false);
    setInvite("");
    setMessage("");
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("sala");
    url.hash = "";
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="presentation-hide flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-sm">
        <MonitorUp className="size-4" /> Sala segura
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-6" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="live-room-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-paper p-4 shadow-2xl sm:p-6">
            <header className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-brass"><ShieldCheck className="size-4" /> Transmissão com aprovação</p>
                <h2 id="live-room-title" className="mt-1 font-display text-2xl font-semibold">Sala segura</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Minimizar janela" className="flex size-11 items-center justify-center rounded-full border border-line bg-card"><X className="size-5" /></button>
            </header>

            <p className="mt-3 text-sm leading-relaxed text-ink/75">A tela é transmitida pelo LiveKit. Pessoas com o convite só entram depois da sua aprovação. Antes de compartilhar, feche janelas com informações privadas.</p>

            {!session ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-card p-4">
                  <h3 className="font-medium">Criar sala</h3>
                  <p className="mt-1 min-h-10 text-sm text-ink/70">Você será o anfitrião e poderá compartilhar a tela e controlar as entradas.</p>
                  <button type="button" disabled={busy} onClick={() => void startHost()} className="mt-3 min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-medium text-paper disabled:opacity-50">{busy ? "Criando…" : "Criar sala e ser anfitrião"}</button>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void requestEntry(); }} className="rounded-xl border border-line bg-card p-4">
                  <h3 className="font-medium">Entrar em uma sala</h3>
                  <label htmlFor="live-room-code" className="mt-3 block text-sm text-ink/70">Código do convite</label>
                  <input id="live-room-code" value={roomIdInput} onChange={(event) => setRoomIdInput(event.target.value)} placeholder="cm-…" autoComplete="off" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm" />
                  <button type="submit" disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-line bg-paper px-4 text-sm font-medium disabled:opacity-50">{busy ? "Enviando…" : "Pedir entrada"}</button>
                </form>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {hostSession ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3">
                      <span className="min-w-0 flex-1 text-sm"><strong>Código:</strong> <code className="break-all">{hostSession.roomId}</code></span>
                      {invite ? <button type="button" onClick={async () => { await navigator.clipboard.writeText(invite); setMessage("Convite copiado. O link não contém a chave do anfitrião."); }} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm"><Copy className="size-4" /> Copiar convite</button> : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 font-medium"><Users className="size-4" /> Pessoas e pedidos</h3>
                      <button type="button" disabled={!connected || busy} onClick={() => void shareScreen()} className="flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-paper disabled:opacity-50"><MonitorUp className="size-4" />{sharing ? "Parar tela" : "Compartilhar tela"}</button>
                    </div>
                    <div className="space-y-2">
                      {guests.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink/65">Ainda não há pedidos de entrada.</p> : guests.map((guest) => (
                        <div key={guest.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3">
                          <span className="min-w-0 flex-1 text-sm">{guest.display_name} · {guest.status === "pending" ? "aguardando" : "na sala"}</span>
                          {guest.status === "pending" ? <>
                            <button type="button" onClick={() => void answerRequest(guest.id, true)} aria-label={`Aprovar ${guest.display_name}`} className="flex min-h-10 items-center gap-1 rounded-lg bg-ink px-3 text-sm text-paper"><Check className="size-4" /> Aprovar</button>
                            <button type="button" onClick={() => void answerRequest(guest.id, false)} aria-label={`Recusar ${guest.display_name}`} className="min-h-10 rounded-lg border border-line px-3 text-sm">Recusar</button>
                          </> : <button type="button" onClick={async () => { await removeLiveRoomGuest({ data: { roomId: hostSession.roomId, hostSecret: hostSession.hostSecret, guestId: guest.id } }); setGuests((items) => items.filter((item) => item.id !== guest.id)); }} aria-label={`Remover ${guest.display_name}`} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm"><UserRoundX className="size-4" /> Remover</button>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : guestSession ? (
                  <div className="rounded-xl border border-line bg-card p-4">
                    <p className="font-medium">{connected ? "Você está na sala" : "Pedido enviado"}</p>
                    <p className="mt-1 text-sm text-ink/70">{connected ? `Você entrou como ${guestSession.alias}. O anfitrião pode encerrar seu acesso.` : `Seu nome nesta sala é ${guestSession.alias}. A conexão só começa após a aprovação.`}</p>
                  </div>
                ) : null}
                <div className="relative aspect-video min-h-40 overflow-hidden rounded-xl border border-line bg-ink">
                  <div ref={mediaRef} className="absolute inset-0" />
                  {!hasScreen ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-paper/70">{connected ? "Aguardando compartilhamento de tela…" : "Conectando com segurança…"}</p> : null}
                </div>
              </div>
            )}

            {message ? <p role="status" className="mt-4 rounded-lg border border-line bg-card px-3 py-2 text-sm">{message}</p> : null}
            <footer className="mt-5 flex flex-wrap justify-end gap-2">
              {session ? <button type="button" onClick={() => void close()} className="min-h-11 rounded-xl border border-line px-4 text-sm">{hostSession ? "Encerrar sala" : "Sair da sala"}</button> : null}
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-line px-4 text-sm">Fechar</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
