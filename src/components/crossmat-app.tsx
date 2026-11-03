import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Eye, Lightbulb, Maximize2, Printer, RotateCcw, Save as SaveIcon, Share2, Undo2, UserRound, Volume2, VolumeX } from "lucide-react";
import { LiveKitShareRoom } from "@/components/livekit-share-room";
import {
  campaignPuzzles,
  cellTone,
  equationStatus,
  numsOf,
  opGlyph,
  opLabel,
  practicePuzzle,
  type Cell,
  type Equation,
  type EqStatus,
  type Puzzle,
  type Tier,
} from "@/game/engine";

const CAMPAIGN = campaignPuzzles();

const TIERS: { id: Tier; label: string; detail: string }[] = [
  { id: "facil", label: "Fácil", detail: "Adição e subtração" },
  { id: "medio", label: "Médio", detail: "As quatro operações" },
  { id: "desafio", label: "Desafio", detail: "Mais cruzamentos" },
];

const OPS = [
  { glyph: "+", name: "Adição" },
  { glyph: "−", name: "Subtração" },
  { glyph: "×", name: "Multiplicação" },
  { glyph: "÷", name: "Divisão" },
] as const;

type Save = {
  version: 1;
  done: Record<string, { seconds: number; hints: number }>;
  studentName: string;
  classroom: string;
  activeAttempt?: { puzzleId: string; mode: "campaign" | "practice"; placed: Record<string, number>; bank: number[]; hints: number; seconds: number };
  sound: boolean;
  live: boolean;
  largeText: boolean;
  highContrast: boolean;
};

const EMPTY_SAVE: Save = { version: 1, done: {}, studentName: "", classroom: "", sound: false, live: true, largeText: false, highContrast: false };
const SAVE_KEY = "crossmat-v1";

function readSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return EMPTY_SAVE;
    const parsed = JSON.parse(raw) as Partial<Save>;
    const active = parsed.activeAttempt;
    return {
      version: 1,
      done: parsed.done && typeof parsed.done === "object" ? parsed.done : {},
      studentName: typeof parsed.studentName === "string" ? parsed.studentName.slice(0, 80) : "",
      classroom: typeof parsed.classroom === "string" ? parsed.classroom.slice(0, 40) : "",
      activeAttempt: active && typeof active === "object" && typeof active.puzzleId === "string" && (active.mode === "campaign" || active.mode === "practice")
        ? active
        : undefined,
      sound: Boolean(parsed.sound),
      live: parsed.live !== false,
      largeText: Boolean(parsed.largeText),
      highContrast: Boolean(parsed.highContrast),
    };
  } catch {
    return EMPTY_SAVE;
  }
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadProgress(save: Save) {
  const rows = [
    ["Nome", "Turma", "Fase", "Nível", "Status", "Tempo (segundos)", "Dicas"],
    ...CAMPAIGN.map((puzzle) => {
      const result = save.done[puzzle.id];
      const tier = TIERS.find((item) => item.id === puzzle.tier)?.label ?? puzzle.tier;
      return [save.studentName, save.classroom, puzzle.title, tier, result ? "Concluída" : "Pendente", result?.seconds ?? "", result?.hints ?? ""];
    }),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const fileBase = save.studentName.trim().toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "estudante";
  anchor.href = href;
  anchor.download = `crossmat-progresso-${fileBase}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function shareProgress(save: Save) {
  const completed = Object.keys(save.done).length;
  const totalSeconds = Object.values(save.done).reduce((sum, result) => sum + result.seconds, 0);
  const lines = [
    "Progresso no CrossMat",
    save.studentName ? `Nome: ${save.studentName}` : "",
    save.classroom ? `Turma: ${save.classroom}` : "",
    `Fases concluídas: ${completed} de ${CAMPAIGN.length}`,
    `Tempo registrado: ${clock(totalSeconds)}`,
    window.location.origin,
  ].filter(Boolean);
  const text = lines.join("\n");
  try {
    if (navigator.share) await navigator.share({ title: "Progresso no CrossMat", text });
    else if (await copyText(text)) window.alert("Resumo copiado. Você pode colá-lo na mensagem que quiser enviar.");
    else window.alert("Não foi possível compartilhar neste navegador.");
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) window.alert("Não foi possível compartilhar o progresso.");
  }
}

function writeSave(save: Save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be unavailable in private browsing or quota-limited contexts.
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function clock(total: number) {
  const safe = Math.max(0, total);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

let audioCtx: AudioContext | null = null;

function beep(freq: number, delay: number, dur: number, gain = 0.045) {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function playPlace() {
  beep(523, 0, 0.07, 0.03);
}

function playWin() {
  beep(523, 0, 0.12);
  beep(659, 0.09, 0.12);
  beep(784, 0.18, 0.18);
}

type Screen =
  | { name: "home" }
  | { name: "play"; puzzle: Puzzle; mode: "campaign" | "practice" };

export function CrossMatApp() {
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [practiceTier, setPracticeTier] = useState<Tier>("facil");
  const [presentation, setPresentation] = useState(false);

  useEffect(() => {
    setSave(readSave());
    document.documentElement.dataset.contrast = readSave().highContrast ? "high" : "normal";
    const params = new URLSearchParams(window.location.search);
    const levelId = params.get("fase");
    const level = levelId ? CAMPAIGN.find((item) => item.id === levelId) : undefined;
    if (level) setScreen({ name: "play", puzzle: level, mode: "campaign" });
    const practice = params.get("pratica")?.match(/^(facil|medio|desafio)-(\d+)$/);
    if (practice) {
      setScreen({
        name: "play",
        puzzle: practicePuzzle(practice[1] as Tier, Number(practice[2])),
        mode: "practice",
      });
    }
  }, []);

  const update = (fn: (current: Save) => Save) => {
    setSave((current) => {
      const next = fn(current);
      writeSave(next);
      return next;
    });
  };

  const togglePresentation = () => {
    const next = !presentation;
    setPresentation(next);
    if (!next && document.fullscreenElement) void document.exitFullscreen();
    if (next && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    document.documentElement.dataset.contrast = save.highContrast ? "high" : "normal";
  }, [save.highContrast]);

  return (
    <main
      className={"mx-auto min-h-screen w-full px-4 pb-24 " + (presentation ? "presentation-mode" : "max-w-lg pt-6 ") + (save.largeText ? "large-text " : "")}
      data-contrast={save.highContrast ? "high" : "normal"}
    >
      {screen.name === "home" ? (
        <Home
          save={save}
          practiceTier={practiceTier}
          onPracticeTier={setPracticeTier}
          onSound={() => update((current) => ({ ...current, sound: !current.sound }))}
          onSettings={(key, value) => update((current) => ({ ...current, [key]: value }))}
          onSaveStudent={(studentName, classroom) => update((current) => ({ ...current, studentName, classroom }))}
          onReset={() => {
            if (window.confirm("Apagar todo o progresso salvo neste navegador?")) {
              update((current) => ({ ...current, done: {}, activeAttempt: undefined }));
            }
          }}
          presentation={presentation}
          onPresentation={togglePresentation}
          onPlay={(puzzle, mode) => setScreen({ name: "play", puzzle, mode })}
        />
      ) : (
        <Play
          key={screen.puzzle.id}
          puzzle={screen.puzzle}
          mode={screen.mode}
          save={save}
          onSave={update}
          presentation={presentation}
          onPresentation={togglePresentation}
          onHome={() => setScreen({ name: "home" })}
          onPlay={(puzzle, mode) => setScreen({ name: "play", puzzle, mode })}
        />
      )}
    </main>
  );
}

function Home({
  save,
  practiceTier,
  onPracticeTier,
  onSaveStudent,
  onSound,
  onSettings,
  onReset,
  presentation,
  onPresentation,
  onPlay,
}: {
  save: Save;
  practiceTier: Tier;
  onPracticeTier: (tier: Tier) => void;
  onSaveStudent: (studentName: string, classroom: string) => void;
  onSound: () => void;
  onSettings: (key: "largeText" | "highContrast", value: boolean) => void;
  onReset: () => void;
  presentation: boolean;
  onPresentation: () => void;
  onPlay: (puzzle: Puzzle, mode: "campaign" | "practice") => void;
}) {
  const [studentName, setStudentName] = useState(save.studentName);
  const [classroom, setClassroom] = useState(save.classroom);
  const [profileMessage, setProfileMessage] = useState("");
  let resumablePuzzle: Puzzle | undefined;
  const activeAttempt = save.activeAttempt;
  if (activeAttempt?.mode === "campaign") {
    resumablePuzzle = CAMPAIGN.find((puzzle) => puzzle.id === activeAttempt.puzzleId);
  } else if (activeAttempt?.mode === "practice") {
    const match = activeAttempt.puzzleId.match(/^pratica-(facil|medio|desafio)-(\d+)$/);
    if (match) resumablePuzzle = practicePuzzle(match[1] as Tier, Number(match[2]));
  }

  useEffect(() => {
    setStudentName(save.studentName);
    setClassroom(save.classroom);
  }, [save.studentName, save.classroom]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-brass uppercase">Contas cruzadas</p>
          <h1 className="font-display text-5xl leading-none font-semibold text-ink">CrossMat</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onSound} aria-pressed={save.sound} aria-label={save.sound ? "Desligar som" : "Ligar som"} className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink">
            {save.sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <button type="button" onClick={onPresentation} aria-pressed={presentation} aria-label="Alternar modo de apresentação" className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink">
            <Maximize2 className="size-5" />
          </button>
        </div>
      </header>

      <p className="max-w-prose text-base leading-relaxed text-ink">
        Complete as contas na horizontal e na vertical. Cada número da bandeja entra uma vez. A conta é sempre
        dois números e uma operação: a ordem da esquerda para a direita, ou de cima para baixo.
      </p>

      <form onSubmit={(event) => {
        event.preventDefault();
        onSaveStudent(studentName.trim().slice(0, 80), classroom.trim().slice(0, 40));
        setProfileMessage("Nome e turma salvos neste navegador.");
      }} className="rounded-2xl border border-line bg-card p-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><UserRound className="size-5" /> Identificação do estudante</h2>
        <p className="mt-1 text-sm text-ink/70">Opcional. Os dados ficam neste navegador e não aparecem nos convites de atividade.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome
            <input value={studentName} onChange={(event) => setStudentName(event.target.value)} maxLength={80} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3" placeholder="Nome do estudante" />
          </label>
          <label className="text-sm">Turma
            <input value={classroom} onChange={(event) => setClassroom(event.target.value)} maxLength={40} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3" placeholder="Ex.: 6º A" />
          </label>
        </div>
        <button type="submit" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-paper"><SaveIcon className="size-4" /> Salvar identificação</button>
        {profileMessage ? <p role="status" className="mt-2 text-sm text-sage">{profileMessage}</p> : null}
      </form>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPS.map((op) => (
          <li key={op.name} className="rounded-xl border border-line bg-card px-3 py-2">
            <span className="font-display text-2xl leading-none text-brass">{op.glyph}</span>
            <span className="mt-1 block text-sm text-ink">{op.name}</span>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl font-semibold">Campanha</h2>
        <div className="flex flex-col gap-3">
          {TIERS.map((tier) => {
            const levels = CAMPAIGN.filter((puzzle) => puzzle.tier === tier.id);
            const cleared = levels.filter((puzzle) => save.done[puzzle.id]).length;
            const next = levels.find((puzzle) => !save.done[puzzle.id]) ?? levels[0];
            return (
              <article key={tier.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold">{tier.label}</h3>
                    <p className="text-sm text-ink/70">{tier.detail}</p>
                  </div>
                  <p className="text-sm text-brass">
                    {cleared} de {levels.length}
                  </p>
                </div>
                <div className="mt-3 flex gap-1" aria-hidden="true">
                  {levels.map((puzzle) => (
                    <span
                      key={puzzle.id}
                      className={
                        "h-1.5 flex-1 rounded-full " + (save.done[puzzle.id] ? "bg-sage" : "bg-deep")
                      }
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onPlay(next, "campaign")}
                  className="mt-4 min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-medium text-paper"
                >
                  {cleared === 0 ? "Começar" : cleared === levels.length ? "Jogar de novo" : "Continuar"}
                  {" · "}
                  {next.title}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-4" aria-labelledby="progress-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="progress-title" className="font-display text-2xl font-semibold">Seu progresso</h2>
            <p className="mt-1 text-sm text-ink/70">{Object.keys(save.done).length} de {CAMPAIGN.length} fases concluídas</p>
          </div>
          <p className="text-sm text-brass">{clock(Object.values(save.done).reduce((sum, item) => sum + item.seconds, 0))} jogados</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {CAMPAIGN.map((puzzle) => <span key={puzzle.id} title={puzzle.title} className={"rounded-full px-2 py-1 text-xs " + (save.done[puzzle.id] ? "bg-sage-soft text-sage" : "bg-deep text-ink/70")}>{save.done[puzzle.id] ? "✓" : "·"} {puzzle.title}</span>)}
        </div>
        {resumablePuzzle && activeAttempt ? <button type="button" onClick={() => onPlay(resumablePuzzle, activeAttempt.mode)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 text-sm font-medium text-paper"><SaveIcon className="size-4" /> Retomar atividade salva · {resumablePuzzle.title}</button> : null}
        <button type="button" onClick={onReset} className="mt-4 min-h-11 rounded-xl border border-line px-3 text-sm">Reiniciar progresso</button>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => downloadProgress(save)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm"><Download className="size-4" /> Baixar relatório CSV</button>
          <button type="button" onClick={() => void shareProgress(save)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm"><Share2 className="size-4" /> Compartilhar progresso</button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink/65">O relatório exportado inclui nome e turma. O compartilhamento só os inclui quando você aciona o botão.</p>
      </section>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-display text-2xl font-semibold">Acessibilidade</h2>
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>Texto ampliado</span><input className="size-5 accent-brass" type="checkbox" checked={save.largeText} onChange={(event) => onSettings("largeText", event.target.checked)} /></label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>Alto contraste</span><input className="size-5 accent-brass" type="checkbox" checked={save.highContrast} onChange={(event) => onSettings("highContrast", event.target.checked)} /></label>
        </div>
      </section>


      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-display text-2xl font-semibold">Prática livre</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink/70">
          Gera uma conta nova, fora da campanha. Serve para aula, lição de casa ou um minuto de revisão.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Nível da prática">
          {TIERS.map((tier) => {
            const on = practiceTier === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                aria-pressed={on}
                onClick={() => onPracticeTier(tier.id)}
                className={
                  "min-h-11 rounded-xl border px-2 text-sm font-medium " +
                  (on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink")
                }
              >
                {tier.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onPlay(practicePuzzle(practiceTier, Date.now()), "practice")}
          className="mt-3 min-h-11 w-full rounded-xl border border-brass bg-brass-soft px-4 text-sm font-medium text-ink"
        >
          Gerar conta
        </button>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold">Como jogar</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {[
            "Toque um número da bandeja.",
            "Toque uma casa vazia. O número já impresso, mais escuro, não sai do lugar.",
            "Cada conta, na linha e na coluna, precisa fechar. Verde confirma. Vermelho pede ajuste. Toque de novo numa casa sua para devolver o número.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brass-soft font-medium text-brass">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-sm leading-relaxed text-ink/70">
        Nome, turma e progresso ficam neste navegador. Os convites não incluem esses dados. Ao compartilhar o relatório, você escolhe enviar o resumo com sua identificação.
      </p>
    </div>
  );
}

function Play({
  puzzle,
  mode,
  save,
  onSave,
  presentation,
  onPresentation,
  onHome,
  onPlay,
}: {
  puzzle: Puzzle;
  mode: "campaign" | "practice";
  save: Save;
  onSave: (fn: (current: Save) => Save) => void;
  presentation: boolean;
  onPresentation: () => void;
  onHome: () => void;
  onPlay: (puzzle: Puzzle, mode: "campaign" | "practice") => void;
}) {
  const restored = save.activeAttempt?.puzzleId === puzzle.id && save.activeAttempt.mode === mode ? save.activeAttempt : undefined;
  const [placed, setPlaced] = useState<Record<string, number>>(() => restored?.placed ?? {});
  const [bank, setBank] = useState<number[]>(() => restored?.bank ?? puzzle.bank);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<{ placed: Record<string, number>; bank: number[] }[]>([]);
  const [hints, setHints] = useState(() => restored?.hints ?? 0);
  const [note, setNote] = useState("");
  const [live, setLive] = useState(save.live);
  const [peek, setPeek] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [teacherReveal, setTeacherReveal] = useState(false);
  const [confirmSolve, setConfirmSolve] = useState(false);
  const [won, setWon] = useState(false);
  const [seconds, setSeconds] = useState(() => restored?.seconds ?? 0);
  const [printDate, setPrintDate] = useState("");
  const [start] = useState(() => Date.now() - (restored?.seconds ?? 0) * 1000);
  const [popId, setPopId] = useState<string | null>(null);
  const [hinted, setHinted] = useState<string[]>([]);

  const numbers = useMemo(() => numsOf(puzzle), [puzzle]);
  const byId = useMemo(() => new Map(numbers.map((cell) => [cell.id, cell])), [numbers]);
  const report = equationStatus(puzzle, placed);
  const solved = report.every((item) => item.status === "ok");
  const closed = report.filter((item) => item.status === "ok").length;
  const allRevealed = numbers.every((cell) => cell.given || placed[cell.id] !== undefined);
  const showTone = live || peek || revealed || won || teacherReveal;

  useEffect(() => {
    setPrintDate(new Date().toLocaleDateString("pt-BR"));
  }, []);

  useEffect(() => {
    if (won || revealed || teacherReveal) return;
    const id = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [won, revealed, teacherReveal, start]);

  useEffect(() => {
    if (!solved || won || revealed || teacherReveal) return;
    const elapsed = Math.round((Date.now() - start) / 1000);
    setSeconds(elapsed);
    setWon(true);
    if (save.sound) playWin();
    if (mode === "campaign" && !save.done[puzzle.id]) {
      onSave((current) => ({
        ...current,
        done: { ...current.done, [puzzle.id]: { seconds: elapsed, hints } },
        activeAttempt: current.activeAttempt?.puzzleId === puzzle.id ? undefined : current.activeAttempt,
      }));
    }
  }, [solved, won, revealed, teacherReveal, start, save.sound, save.done, mode, puzzle.id, hints, onSave]);

  const remember = () => {
    setHistory((stack) => [...stack.slice(-39), { placed, bank }]);
  };

  const onUndo = () => {
    const previous = history[history.length - 1];
    if (!previous || won || teacherReveal) return;
    setHistory((stack) => stack.slice(0, -1));
    setPlaced(previous.placed);
    setBank(previous.bank);
    setSelected(null);
    setPeek(false);
    setNote("");
  };

  const onClear = () => {
    if (won || teacherReveal || (Object.keys(placed).length === 0 && bank.length === puzzle.bank.length)) return;
    remember();
    setPlaced({});
    setBank(puzzle.bank);
    setSelected(null);
    setPeek(false);
    setNote("");
  };

  const onHint = () => {
    if (won || revealed || teacherReveal || hints >= 3) return;
    const holes = numbers.filter((cell) => !cell.given && placed[cell.id] === undefined && !hinted.includes(cell.id));
    const target = holes.find((cell) => bank.includes(cell.solution)) ?? holes[0];
    if (!target) return;
    const position = puzzle.rows.flatMap((row, r) => row.map((cell, c) => cell.k === "n" && cell.id === target.id ? { r: r + 1, c: c + 1 } : null)).flat().find(Boolean);
    setHints((count) => count + 1);
    setHinted((current) => [...current, target.id]);
    setPopId(target.id);
    setNote(`Dica ${hints + 1}: linha ${position?.r}, coluna ${position?.c} recebe ${target.solution}. A casa continua vazia para voce preencher.`);
  };

  const onReveal = () => {
    const next: Record<string, number> = {};
    for (const cell of numbers) {
      if (!cell.given) next[cell.id] = cell.solution;
    }
    setPlaced(next);
    setBank([]);
    setSelected(null);
    setRevealed(true);
    setConfirmSolve(false);
    setPeek(true);
    setNote("Solução à mostra. Esta fase não entra como concluída.");
  };

  const onRevealNext = () => {
    if (!presentation || won || revealed) return;
    const target = numbers.find((cell) => !cell.given && placed[cell.id] === undefined);
    if (!target) {
      setNote("Todas as casas escondidas ja foram reveladas.");
      return;
    }
    const position = puzzle.rows.flatMap((row, r) => row.map((cell, c) => cell.k === "n" && cell.id === target.id ? { r: r + 1, c: c + 1 } : null)).flat().find(Boolean);
    setPlaced((current) => ({ ...current, [target.id]: target.solution }));
    setBank((current) => {
      const index = current.indexOf(target.solution);
      return index < 0 ? current : current.filter((_, item) => item !== index);
    });
    setSelected(null);
    setTeacherReveal(true);
    setPeek(true);
    setNote(`Revelada linha ${position?.r}, coluna ${position?.c}: ${target.solution}. Esta demonstracao nao marca a fase como concluida.`);
  };

  const onCell = (id: string) => {
    if (won || revealed || teacherReveal) return;
    const cell = byId.get(id);
    if (!cell || cell.given) return;
    const current = placed[id];
    if (selected === null) {
      if (current === undefined) return;
      remember();
      const next = { ...placed };
      delete next[id];
      setPlaced(next);
      setBank([current, ...bank]);
      setPeek(false);
      setNote("");
      return;
    }
    const value = bank[selected];
    if (value === undefined) {
      setSelected(null);
      return;
    }
    remember();
    const nextBank = bank.filter((_, index) => index !== selected);
    if (current !== undefined) nextBank.unshift(current);
    setBank(nextBank);
    setPlaced({ ...placed, [id]: value });
    setSelected(null);
    setPopId(id);
    setPeek(false);
    setNote("");
    if (save.sound) playPlace();
  };

  const saveAttempt = () => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    setSeconds(elapsed);
    onSave((current) => ({
      ...current,
      activeAttempt: { puzzleId: puzzle.id, mode, placed, bank, hints, seconds: elapsed },
    }));
    setNote("Tentativa salva neste navegador. Você pode voltar a esta fase mais tarde.");
  };

  const tier = TIERS.find((item) => item.id === puzzle.tier)!;
  const campaignIndex = CAMPAIGN.findIndex((item) => item.id === puzzle.id);
  const nextCampaign = campaignIndex >= 0 ? CAMPAIGN[campaignIndex + 1] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          className="print-hide flex size-11 items-center justify-center rounded-full border border-line bg-card"
          aria-label="Voltar ao início"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-widest text-brass uppercase">
            {mode === "practice" ? "Prática" : tier.label}
          </p>
          <h1 className="truncate font-display text-2xl leading-tight font-semibold">{puzzle.title}</h1>
        </div>
        <p className="font-display text-xl tabular-nums" aria-label={`Tempo ${clock(seconds)}`}>
          {clock(seconds)}
        </p>
      </header>

      <p className="print-hide text-sm text-ink/80" aria-live="polite">
        {closed} de {report.length} contas fechadas
        {selected !== null ? ` · ${bank[selected]} selecionado` : ""}
        {note ? ` · ${note}` : ""}
      </p>

      <section className="print-only mb-3 border-b border-black pb-3 text-sm">
        <p><strong>Nome:</strong> {save.studentName || "________________________________"}</p>
        <p><strong>Turma:</strong> {save.classroom || "________________"} <span className="ml-4"><strong>Data:</strong> {printDate}</span></p>
      </section>

      <Board
        rows={puzzle.rows}
        placed={placed}
        report={showTone ? report : report.map((item) => ({ ...item, status: "open" as EqStatus }))}
        selected={selected !== null}
        popId={popId}
        hintId={hinted[hinted.length - 1] ?? null}
        onCell={onCell}
      />

      <div className="presentation-hide print-hide grid grid-cols-5 gap-2">
        <ToolButton label="Salvar" disabled={won || revealed || teacherReveal} onClick={saveAttempt}>
          <SaveIcon className="size-4" />
        </ToolButton>
        <ToolButton label="Desfazer" disabled={history.length === 0 || won || teacherReveal} onClick={onUndo}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label="Limpar" disabled={won || teacherReveal} onClick={onClear}>
          <RotateCcw className="size-4" />
        </ToolButton>
        <ToolButton label={`Dica ${Math.max(0, 3 - hints)}`} disabled={won || revealed || teacherReveal || hints >= 3} onClick={onHint}>
          <Lightbulb className="size-4" />
        </ToolButton>
        <ToolButton
          label={live ? "Ao vivo" : "Verificar"}
          pressed={live}
          onClick={() => {
            if (live) {
              setLive(false);
              setPeek(false);
              onSave((current) => ({ ...current, live: false }));
              return;
            }
            setPeek(true);
          }}
        >
          <Eye className="size-4" />
        </ToolButton>
      </div>

      {presentation ? <button type="button" onClick={onRevealNext} disabled={revealed || allRevealed} className="print-hide min-h-12 rounded-xl border border-brass bg-brass-soft px-4 text-sm font-medium disabled:opacity-50">{allRevealed ? "Todas as casas foram reveladas" : "Revelar proxima casa"}</button> : null}

      <div className="print-hide grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={async () => {
          const url = new URL(window.location.href);
          url.search = "";
          if (mode === "campaign") url.searchParams.set("fase", puzzle.id);
          else {
            const match = puzzle.id.match(/^pratica-(facil|medio|desafio)-(\d+)$/);
            if (match) url.searchParams.set("pratica", `${match[1]}-${match[2]}`);
          }
          const link = url.toString();
          try {
            if (navigator.share) await navigator.share({ title: `CrossMat - ${puzzle.title}`, url: link });
            else if (await copyText(link)) setNote("Link copiado. Quem abrir recebera o mesmo desafio.");
            else setNote("Este navegador nao permitiu copiar o link.");
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) setNote("Nao foi possivel compartilhar o link.");
          }
        }} className="presentation-hide flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm"><Share2 className="size-4" />Compartilhar fase</button>
        <button type="button" onClick={onPresentation} aria-pressed={presentation} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm"><Maximize2 className="size-4" />{presentation ? "Sair da apresentacao" : "Apresentar"}</button>
        <LiveKitShareRoom puzzleId={puzzle.id} />
        <button type="button" onClick={() => { setNote("Na janela de impressão, escolha Salvar como PDF."); window.print(); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm"><Printer className="size-4" /> Baixar atividade PDF</button>
      </div>

      {!live && !won ? (
        <button
          type="button"
          className="print-hide text-left text-sm text-brass"
          onClick={() => {
            setLive(true);
            onSave((current) => ({ ...current, live: true }));
          }}
        >
          Ligar correção ao vivo
        </button>
      ) : null}

      <section className="print-hide">
        <h2 className="text-sm font-medium text-ink/70">Números</h2>
        <div className="mt-2 flex flex-wrap gap-2" role="listbox" aria-label="Números disponíveis">
          {bank.length === 0 ? (
            <p className="text-sm text-ink/70">
              {solved ? "Bandeja vazia." : "Bandeja vazia, mas ainda há conta errada."}
            </p>
          ) : (
            bank.map((value, index) => {
              const on = selected === index;
              return (
                <button
                  key={`${value}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => setSelected(on ? null : index)}
                  disabled={won || revealed || teacherReveal}
                  className={
                    "flex h-12 min-w-12 items-center justify-center rounded-xl border px-3 font-display text-xl tabular-nums " +
                    (on
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-card text-ink shadow-sm")
                  }
                >
                  {value}
                </button>
              );
            })
          )}
        </div>
      </section>

      {!won && !revealed && !teacherReveal && !presentation ? (
        confirmSolve ? (
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="text-sm leading-relaxed">
              Mostrar a solução encerra a tentativa. A fase não fica marcada como concluída.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onReveal}
                className="min-h-11 flex-1 rounded-xl bg-ink text-sm font-medium text-paper"
              >
                Mostrar
              </button>
              <button
                type="button"
                onClick={() => setConfirmSolve(false)}
                className="min-h-11 flex-1 rounded-xl border border-line text-sm"
              >
                Voltar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmSolve(true)} className="text-sm text-ink/60">
            Mostrar solução
          </button>
        )
      ) : null}

      {won ? (
        <div className="panel-in relative overflow-hidden rounded-2xl border border-line bg-card p-4">
          <p className="text-xs tracking-widest text-brass uppercase">Conta fechada</p>
          <h2 className="font-display text-3xl font-semibold">Todas as contas fecharam.</h2>
          <p className="mt-1 text-sm text-ink/80">
            {clock(seconds)}
            {hints > 0 ? ` · ${hints} ${hints === 1 ? "dica" : "dicas"}` : " · sem dicas"}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {mode === "campaign" && nextCampaign ? (
              <button
                type="button"
                onClick={() => onPlay(nextCampaign, "campaign")}
                className="min-h-11 rounded-xl bg-ink text-sm font-medium text-paper"
              >
                Próxima · {nextCampaign.title}
              </button>
            ) : null}
            {mode === "practice" ? (
              <button
                type="button"
                onClick={() => onPlay(practicePuzzle(puzzle.tier, Date.now()), "practice")}
                className="min-h-11 rounded-xl bg-ink text-sm font-medium text-paper"
              >
                Outra conta
              </button>
            ) : null}
            <button
              type="button"
              onClick={onHome}
              className="min-h-11 rounded-xl border border-line text-sm font-medium"
            >
              Início
            </button>
          </div>
        </div>
      ) : null}

      {revealed && !won ? (
        <button
          type="button"
          onClick={onHome}
          className="min-h-11 rounded-xl border border-line bg-card text-sm font-medium"
        >
          Voltar ao início
        </button>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={
        "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 text-xs font-medium " +
        (pressed ? "border-ink bg-ink text-paper " : "border-line bg-card text-ink ") +
        (disabled ? "opacity-40" : "")
      }
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function Board({
  rows,
  placed,
  report,
  selected,
  popId,
  hintId,
  onCell,
}: {
  rows: Cell[][];
  placed: Record<string, number>;
  report: { eq: Equation; status: EqStatus }[];
  selected: boolean;
  popId: string | null;
  hintId: string | null;
  onCell: (id: string) => void;
}) {
  const cols = rows[0]?.length ?? 1;
  return (
    <div
      className="mx-auto grid w-full max-w-sm gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {rows.flatMap((row, r) =>
        row.map((cell, c) => {
          const key = `${r}-${c}`;
          if (cell.k === "off") return <span key={key} aria-hidden="true" />;
          if (cell.k === "op") {
            return (
              <span
                key={key}
                className="flex aspect-square items-center justify-center font-display text-xl text-brass sm:text-2xl"
                aria-label={opLabel(cell.op)}
              >
                {opGlyph(cell.op)}
              </span>
            );
          }
          if (cell.k === "eq") {
            return (
              <span
                key={key}
                className="flex aspect-square items-center justify-center font-display text-xl text-ink/50"
                aria-label="igual"
              >
                =
              </span>
            );
          }
          const tone = cellTone(cell.id, report);
          const value = cell.given ? cell.solution : placed[cell.id];
          const filled = value !== undefined;
          const toneClass = cell.id === hintId
            ? "border-brass bg-brass-soft text-ink ring-2 ring-brass"
            :
            tone === "ok"
              ? "border-sage bg-sage-soft text-sage"
              : tone === "bad"
                ? "border-clay bg-clay-soft text-clay"
                : cell.given
                  ? "border-transparent bg-deep text-ink"
                  : filled
                    ? "border-line bg-card text-ink shadow-sm"
                    : selected
                      ? "border-brass bg-brass-soft text-transparent"
                      : "border-line bg-paper/40 text-transparent";
          const label = cell.given
            ? `Número dado ${cell.solution}`
            : filled
              ? `Casa com ${value}. Toque para devolver.`
              : "Casa vazia";
          return (
            <button
              key={key}
              type="button"
              onClick={() => onCell(cell.id)}
              aria-disabled={cell.given}
              aria-label={label}
              className={
                "board-cell flex aspect-square items-center justify-center rounded-lg border font-display text-lg tabular-nums sm:text-xl " +
                toneClass +
                (popId === cell.id && filled ? " tile-in" : "")
              }
            >
              {filled ? value : ""}
            </button>
          );
        }),
      )}
    </div>
  );
}
