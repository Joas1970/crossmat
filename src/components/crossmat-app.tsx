import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Eye, Lightbulb, RotateCcw, Undo2, Volume2, VolumeX } from "lucide-react";
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
  done: Record<string, { seconds: number; hints: number }>;
  sound: boolean;
  live: boolean;
};

const EMPTY_SAVE: Save = { done: {}, sound: false, live: true };
const SAVE_KEY = "crossmat-v1";

function readSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return EMPTY_SAVE;
    const parsed = JSON.parse(raw) as Partial<Save>;
    return {
      done: parsed.done && typeof parsed.done === "object" ? parsed.done : {},
      sound: Boolean(parsed.sound),
      live: parsed.live !== false,
    };
  } catch {
    return EMPTY_SAVE;
  }
}

function writeSave(save: Save) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
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

  useEffect(() => {
    setSave(readSave());
  }, []);

  const update = (fn: (current: Save) => Save) => {
    setSave((current) => {
      const next = fn(current);
      writeSave(next);
      return next;
    });
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 pt-6 pb-24">
      {screen.name === "home" ? (
        <Home
          save={save}
          practiceTier={practiceTier}
          onPracticeTier={setPracticeTier}
          onSound={() => update((current) => ({ ...current, sound: !current.sound }))}
          onPlay={(puzzle, mode) => setScreen({ name: "play", puzzle, mode })}
        />
      ) : (
        <Play
          key={screen.puzzle.id}
          puzzle={screen.puzzle}
          mode={screen.mode}
          save={save}
          onSave={update}
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
  onSound,
  onPlay,
}: {
  save: Save;
  practiceTier: Tier;
  onPracticeTier: (tier: Tier) => void;
  onSound: () => void;
  onPlay: (puzzle: Puzzle, mode: "campaign" | "practice") => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-brass uppercase">Contas cruzadas</p>
          <h1 className="font-display text-5xl leading-none font-semibold text-ink">CrossMat</h1>
        </div>
        <button
          type="button"
          onClick={onSound}
          aria-pressed={save.sound}
          aria-label={save.sound ? "Desligar som" : "Ligar som"}
          className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink"
        >
          {save.sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </button>
      </header>

      <p className="max-w-prose text-base leading-relaxed text-ink">
        Complete as contas na horizontal e na vertical. Cada número da bandeja entra uma vez. A conta é sempre
        dois números e uma operação: a ordem da esquerda para a direita, ou de cima para baixo.
      </p>

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
        Tudo acontece neste navegador, sem login e sem guardar a conta de ninguém. Dá para publicar e abrir no
        celular da sala, ou colocar o link numa página do site.
      </p>
    </div>
  );
}

function Play({
  puzzle,
  mode,
  save,
  onSave,
  onHome,
  onPlay,
}: {
  puzzle: Puzzle;
  mode: "campaign" | "practice";
  save: Save;
  onSave: (fn: (current: Save) => Save) => void;
  onHome: () => void;
  onPlay: (puzzle: Puzzle, mode: "campaign" | "practice") => void;
}) {
  const [placed, setPlaced] = useState<Record<string, number>>({});
  const [bank, setBank] = useState<number[]>(puzzle.bank);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<{ placed: Record<string, number>; bank: number[] }[]>([]);
  const [hints, setHints] = useState(0);
  const [note, setNote] = useState("");
  const [live, setLive] = useState(save.live);
  const [peek, setPeek] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmSolve, setConfirmSolve] = useState(false);
  const [won, setWon] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [start] = useState(() => Date.now());
  const [popId, setPopId] = useState<string | null>(null);

  const numbers = useMemo(() => numsOf(puzzle), [puzzle]);
  const byId = useMemo(() => new Map(numbers.map((cell) => [cell.id, cell])), [numbers]);
  const report = equationStatus(puzzle, placed);
  const solved = report.every((item) => item.status === "ok");
  const closed = report.filter((item) => item.status === "ok").length;
  const showTone = live || peek || revealed || won;

  useEffect(() => {
    if (won || revealed) return;
    const id = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [won, revealed, start]);

  useEffect(() => {
    if (!solved || won || revealed) return;
    const elapsed = Math.round((Date.now() - start) / 1000);
    setSeconds(elapsed);
    setWon(true);
    if (save.sound) playWin();
    if (mode === "campaign" && !save.done[puzzle.id]) {
      onSave((current) => ({
        ...current,
        done: { ...current.done, [puzzle.id]: { seconds: elapsed, hints } },
      }));
    }
  }, [solved, won, revealed, start, save.sound, save.done, mode, puzzle.id, hints, onSave]);

  const remember = () => {
    setHistory((stack) => [...stack.slice(-39), { placed, bank }]);
  };

  const onUndo = () => {
    const previous = history[history.length - 1];
    if (!previous || won) return;
    setHistory((stack) => stack.slice(0, -1));
    setPlaced(previous.placed);
    setBank(previous.bank);
    setSelected(null);
    setPeek(false);
    setNote("");
  };

  const onClear = () => {
    if (won || (Object.keys(placed).length === 0 && bank.length === puzzle.bank.length)) return;
    remember();
    setPlaced({});
    setBank(puzzle.bank);
    setSelected(null);
    setPeek(false);
    setNote("");
  };

  const onHint = () => {
    if (won || revealed || hints >= 3) return;
    const holes = numbers.filter((cell) => !cell.given && placed[cell.id] === undefined);
    const target = holes.find((cell) => bank.includes(cell.solution)) ?? holes[0];
    if (!target) return;
    remember();
    const nextPlaced = { ...placed };
    const nextBank = [...bank];
    const fromBank = nextBank.indexOf(target.solution);
    if (fromBank >= 0) {
      nextBank.splice(fromBank, 1);
    } else {
      const donor = Object.keys(nextPlaced).find(
        (id) => nextPlaced[id] === target.solution && nextPlaced[id] !== byId.get(id)?.solution,
      );
      if (!donor) {
        setNote("Esse número já está numa casa. Devolva uma casa sua ou use desfazer.");
        setHistory((stack) => stack.slice(0, -1));
        return;
      }
      delete nextPlaced[donor];
    }
    nextPlaced[target.id] = target.solution;
    setPlaced(nextPlaced);
    setBank(nextBank);
    setHints((count) => count + 1);
    setSelected(null);
    setPopId(target.id);
    setNote("Dica: uma casa possível.");
    if (save.sound) playPlace();
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

  const onCell = (id: string) => {
    if (won || revealed) return;
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

  const tier = TIERS.find((item) => item.id === puzzle.tier)!;
  const campaignIndex = CAMPAIGN.findIndex((item) => item.id === puzzle.id);
  const nextCampaign = campaignIndex >= 0 ? CAMPAIGN[campaignIndex + 1] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          className="flex size-11 items-center justify-center rounded-full border border-line bg-card"
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

      <p className="text-sm text-ink/80" aria-live="polite">
        {closed} de {report.length} contas fechadas
        {selected !== null ? ` · ${bank[selected]} selecionado` : ""}
        {note ? ` · ${note}` : ""}
      </p>

      <Board
        rows={puzzle.rows}
        placed={placed}
        report={showTone ? report : report.map((item) => ({ ...item, status: "open" as EqStatus }))}
        selected={selected !== null}
        popId={popId}
        onCell={onCell}
      />

      <div className="grid grid-cols-4 gap-2">
        <ToolButton label="Desfazer" disabled={history.length === 0 || won} onClick={onUndo}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label="Limpar" disabled={won} onClick={onClear}>
          <RotateCcw className="size-4" />
        </ToolButton>
        <ToolButton label={`Dica ${Math.max(0, 3 - hints)}`} disabled={won || revealed || hints >= 3} onClick={onHint}>
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

      {!live && !won ? (
        <button
          type="button"
          onClick={() => {
            setLive(true);
            onSave((current) => ({ ...current, live: true }));
          }}
          className="text-left text-sm text-brass"
        >
          Ligar correção ao vivo
        </button>
      ) : null}

      <section>
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
                  disabled={won || revealed}
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

      {!won && !revealed ? (
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
  onCell,
}: {
  rows: Cell[][];
  placed: Record<string, number>;
  report: { eq: Equation; status: EqStatus }[];
  selected: boolean;
  popId: string | null;
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
          const toneClass =
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
              disabled={cell.given}
              aria-label={label}
              className={
                "flex aspect-square items-center justify-center rounded-lg border font-display text-lg tabular-nums disabled:opacity-100 sm:text-xl " +
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
