export type Op = "+" | "-" | "*" | "/";
export type Tier = "facil" | "medio" | "desafio";

export type Cell =
  | { k: "off" }
  | { k: "op"; op: Op }
  | { k: "eq" }
  | { k: "n"; id: string; solution: number; given: boolean };

export type Equation = { a: string; op: Op; b: string; c: string };

export type Puzzle = {
  id: string;
  tier: Tier;
  title: string;
  blurb: string;
  rows: Cell[][];
  equations: Equation[];
  bank: number[];
};

type Rng = () => number;

type Raw =
  | { k: "off" }
  | { k: "op"; op: Op }
  | { k: "eq" }
  | { k: "n"; id: string };

const OP_SET = new Set<Op>(["+", "-", "*", "/"]);

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function apply(a: number, op: Op, b: number, max: number): number | null {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return null;
  let r: number;
  switch (op) {
    case "+":
      r = a + b;
      break;
    case "-":
      r = a - b;
      break;
    case "*":
      if (a < 2 || b < 2) return null;
      r = a * b;
      break;
    case "/":
      if (b < 2 || a % b !== 0) return null;
      r = a / b;
      break;
    default:
      return null;
  }
  if (!Number.isInteger(r) || r < 1 || r > max) return null;
  return r;
}

function solveForB(a: number, op: Op, c: number, max: number): number | null {
  let b: number;
  switch (op) {
    case "+":
      b = c - a;
      break;
    case "-":
      b = a - c;
      break;
    case "*":
      if (a === 0 || c % a !== 0) return null;
      b = c / a;
      break;
    case "/":
      if (c === 0 || a % c !== 0) return null;
      b = a / c;
      break;
    default:
      return null;
  }
  return apply(a, op, b, max) === c ? b : null;
}

function solveForA(op: Op, b: number, c: number, max: number): number | null {
  let a: number;
  switch (op) {
    case "+":
      a = c - b;
      break;
    case "-":
      a = c + b;
      break;
    case "*":
      if (b === 0 || c % b !== 0) return null;
      a = c / b;
      break;
    case "/":
      a = c * b;
      break;
    default:
      return null;
  }
  return apply(a, op, b, max) === c ? a : null;
}

function parse(lines: string[]): { grid: Raw[][]; ids: string[] } {
  let n = 0;
  const grid: Raw[][] = lines.map((line) =>
    [...line].map((ch) => {
      if (ch === ".") return { k: "off" };
      if (ch === "=") return { k: "eq" };
      if (ch === "+" || ch === "-" || ch === "*" || ch === "/") return { k: "op", op: ch };
      if (ch === "#") {
        const id = `n${n++}`;
        return { k: "n", id };
      }
      throw new Error(`símbolo inválido: ${ch}`);
    }),
  );
  const w = grid[0]?.length ?? 0;
  if (!w || grid.some((row) => row.length !== w)) throw new Error("grade irregular");
  return { grid, ids: Array.from({ length: n }, (_, i) => `n${i}`) };
}

function extract(grid: Raw[][]): Equation[] {
  const h = grid.length;
  const w = grid[0].length;
  const eqs: Equation[] = [];
  const covered = new Set<string>();

  const scan = (coords: { r: number; c: number }[]) => {
    let run: { r: number; c: number }[] = [];
    const flush = () => {
      if (run.length === 0) return;
      if (run.length === 5) {
        const slots = run.map((p) => grid[p.r][p.c]);
        const [s0, s1, s2, s3, s4] = slots;
        if (
          s0.k === "n" &&
          s1.k === "op" &&
          s2.k === "n" &&
          s3.k === "eq" &&
          s4.k === "n"
        ) {
          eqs.push({ a: s0.id, op: s1.op, b: s2.id, c: s4.id });
          for (const p of run) covered.add(`${p.r},${p.c}`);
        } else {
          throw new Error("conta fora do formato número operação número = número");
        }
      } else if (run.length !== 1 || grid[run[0].r][run[0].c].k === "off") {
        throw new Error(`trecho inválido (${run.length})`);
      }
      run = [];
    };
    for (const p of coords) {
      if (grid[p.r][p.c].k === "off") flush();
      else run.push(p);
    }
    flush();
  };

  for (let r = 0; r < h; r++) {
    scan(Array.from({ length: w }, (_, c) => ({ r, c })));
  }
  for (let c = 0; c < w; c++) {
    scan(Array.from({ length: h }, (_, r) => ({ r, c })));
  }

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c].k !== "off" && !covered.has(`${r},${c}`)) {
        throw new Error(`casa solta em ${r},${c}`);
      }
    }
  }
  if (eqs.length < 3) throw new Error("poucas contas");
  return eqs;
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function solve(eqs: Equation[], ids: string[], max: number, rng: Rng): Record<string, number> | null {
  const val = new Map<string, number>();
  let nodes = 0;
  const domain: number[] = [];
  for (let n = 1; n <= Math.min(12, max); n++) domain.push(n);

  const deduce = (eq: Equation): "ok" | "bad" | { id: string; value: number } => {
    const a = val.get(eq.a);
    const b = val.get(eq.b);
    const c = val.get(eq.c);
    const known = [a, b, c].filter((v) => v !== undefined).length;
    if (known < 2) return "ok";
    if (known === 3) {
      return apply(a as number, eq.op, b as number, max) === c ? "ok" : "bad";
    }
    if (a !== undefined && b !== undefined) {
      const r = apply(a, eq.op, b, max);
      if (r === null) return "bad";
      return { id: eq.c, value: r };
    }
    if (a !== undefined && c !== undefined) {
      const r = solveForB(a, eq.op, c, max);
      if (r === null) return "bad";
      return { id: eq.b, value: r };
    }
    if (b !== undefined && c !== undefined) {
      const r = solveForA(eq.op, b, c, max);
      if (r === null) return "bad";
      return { id: eq.a, value: r };
    }
    return "ok";
  };

  const bt = (): boolean => {
    if (++nodes > 20000) return false;
    const added: string[] = [];
    let guard = 0;
    let stuck = false;
    while (!stuck && guard++ < 40) {
      stuck = true;
      for (const eq of eqs) {
        const res = deduce(eq);
        if (res === "bad") {
          for (const id of added) val.delete(id);
          return false;
        }
        if (res !== "ok") {
          val.set(res.id, res.value);
          added.push(res.id);
          stuck = false;
        }
      }
    }

    const unset = ids.filter((id) => !val.has(id));
    if (unset.length === 0) {
      const ok = eqs.every((eq) => apply(val.get(eq.a)!, eq.op, val.get(eq.b)!, max) === val.get(eq.c));
      if (!ok) for (const id of added) val.delete(id);
      return ok;
    }

    let pick = unset[0];
    let best = -1;
    for (const id of unset) {
      let score = 0;
      for (const eq of eqs) {
        if (eq.a !== id && eq.b !== id && eq.c !== id) continue;
        const known = [eq.a, eq.b, eq.c].filter((x) => x !== id && val.has(x)).length;
        score += known * 4;
        if (eq.a === id || eq.b === id) score += 1;
      }
      if (score > best) {
        best = score;
        pick = id;
      }
    }

    for (const n of shuffle(domain, rng)) {
      val.set(pick, n);
      if (bt()) return true;
      val.delete(pick);
    }
    for (const id of added) val.delete(id);
    return false;
  };

  if (!bt()) return null;
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = val.get(id)!;
  return out;
}

function weightedHide(ids: string[], eqs: Equation[], count: number, rng: Rng): Set<string> {
  const weight = new Map<string, number>(ids.map((id) => [id, 1]));
  for (const eq of eqs) {
    weight.set(eq.a, (weight.get(eq.a) ?? 1) + 3);
    weight.set(eq.b, (weight.get(eq.b) ?? 1) + 3);
    weight.set(eq.c, (weight.get(eq.c) ?? 1) + 1);
  }
  const pool = [...ids];
  const hidden = new Set<string>();
  const target = Math.min(count, ids.length - 2);
  while (hidden.size < target && pool.length) {
    const total = pool.reduce((sum, id) => sum + (weight.get(id) ?? 1), 0);
    let ticket = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      ticket -= weight.get(pool[idx]) ?? 1;
      if (ticket <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    hidden.add(pool[idx]);
    pool.splice(idx, 1);
  }
  return hidden;
}

export type BuildSpec = {
  id: string;
  tier: Tier;
  title: string;
  blurb: string;
  lines: string[];
  hide: number;
  max: number;
  seed: number;
  /** When set, `?` becomes a random operation from this list. */
  wild?: Op[];
};

export function buildPuzzle(spec: BuildSpec): Puzzle {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = mulberry32((spec.seed + attempt * 997) >>> 0);
    const lines = spec.lines.map((line) =>
      [...line]
        .map((ch) => {
          if (ch !== "?") return ch;
          const allowed = spec.wild ?? ["+", "-"];
          return allowed[Math.floor(rng() * allowed.length)];
        })
        .join(""),
    );
    if (spec.tier !== "facil") {
      const hasHard = lines.some((line) => line.includes("*") || line.includes("/"));
      if (!hasHard) continue;
    }
    let parsed: { grid: Raw[][]; ids: string[] };
    let eqs: Equation[];
    try {
      parsed = parse(lines);
      eqs = extract(parsed.grid);
    } catch {
      continue;
    }
    const solved = solve(eqs, parsed.ids, spec.max, rng);
    if (!solved) continue;
    const values = Object.values(solved);
    if (values.some((v) => v > spec.max)) continue;
    const hidden = weightedHide(parsed.ids, eqs, spec.hide, rng);
    const rows: Cell[][] = parsed.grid.map((row) =>
      row.map((cell) => {
        if (cell.k !== "n") return cell;
        return {
          k: "n",
          id: cell.id,
          solution: solved[cell.id],
          given: !hidden.has(cell.id),
        };
      }),
    );
    const bank = shuffle(
      parsed.ids.filter((id) => hidden.has(id)).map((id) => solved[id]),
      rng,
    );
    const puzzle: Puzzle = {
      id: spec.id,
      tier: spec.tier,
      title: spec.title,
      blurb: spec.blurb,
      rows,
      equations: eqs,
      bank,
    };
    if (!audit(puzzle)) continue;
    return puzzle;
  }
  throw new Error(`não foi possível montar ${spec.id}`);
}

export function audit(puzzle: Puzzle): boolean {
  const value = new Map<string, number>();
  let hidden = 0;
  for (const row of puzzle.rows) {
    for (const cell of row) {
      if (cell.k !== "n") continue;
      value.set(cell.id, cell.solution);
      if (!cell.given) hidden += 1;
    }
  }
  if (hidden !== puzzle.bank.length) return false;
  const bank = [...puzzle.bank].sort((a, b) => a - b);
  const holes = [...value.entries()]
    .filter(([id]) => {
      for (const row of puzzle.rows) {
        for (const cell of row) {
          if (cell.k === "n" && cell.id === id) return !cell.given;
        }
      }
      return false;
    })
    .map(([, v]) => v)
    .sort((a, b) => a - b);
  if (bank.join(",") !== holes.join(",")) return false;
  return puzzle.equations.every((eq) => {
    const r = apply(value.get(eq.a) ?? 0, eq.op, value.get(eq.b) ?? 0, 999);
    return r === value.get(eq.c);
  });
}

export function opLabel(op: Op): string {
  switch (op) {
    case "+":
      return "adição";
    case "-":
      return "subtração";
    case "*":
      return "multiplicação";
    case "/":
      return "divisão";
  }
}

export function opGlyph(op: Op): string {
  switch (op) {
    case "+":
      return "+";
    case "-":
      return "−";
    case "*":
      return "×";
    case "/":
      return "÷";
  }
}

export function isOp(value: string): value is Op {
  return OP_SET.has(value as Op);
}

const FOUR: Op[] = ["+", "-", "*", "/"];
const SOFT: Op[] = ["+", "-"];

export const CAMPAIGN_SPECS: BuildSpec[] = [
  {
    id: "facil-1",
    tier: "facil",
    title: "Primeira cruz",
    blurb: "Adição e subtração, números pequenos.",
    lines: ["#+#=#", "+...-", "#+#=#", "=...=", "#-#=#"],
    hide: 4,
    max: 24,
    seed: 21,
  },
  {
    id: "facil-2",
    tier: "facil",
    title: "Diferenças",
    blurb: "A subtração cruza a soma.",
    lines: ["#-#=#", "+...+", "#+#=#", "=...=", "#-#=#"],
    hide: 5,
    max: 24,
    seed: 44,
  },
  {
    id: "facil-3",
    tier: "facil",
    title: "Coluna do meio",
    blurb: "Três contas na vertical.",
    lines: ["#+#=#", "+.+.-", "#-#=#", "=.=.=", "#-#=#"],
    hide: 5,
    max: 24,
    seed: 63,
  },
  {
    id: "facil-4",
    tier: "facil",
    title: "Fecha a conta",
    blurb: "Quase tudo escondido. A bandeja segura a resposta.",
    lines: ["#+#=#", "-...+", "#+#=#", "=...=", "#+#=#"],
    hide: 6,
    max: 24,
    seed: 4,
  },
  {
    id: "medio-1",
    tier: "medio",
    title: "Entra a multiplicação",
    blurb: "Uma conta de vezes no topo.",
    lines: ["#*#=#", "+...-", "#+#=#", "=...=", "#-#=#"],
    hide: 5,
    max: 81,
    seed: 90,
  },
  {
    id: "medio-2",
    tier: "medio",
    title: "Divide certo",
    blurb: "A divisão tem de fechar inteira.",
    lines: ["#-#=#", "/...+", "#*#=#", "=...=", "#+#=#"],
    hide: 5,
    max: 81,
    seed: 4,
  },
  {
    id: "medio-3",
    tier: "medio",
    title: "Miolo",
    blurb: "O centro da cruz também é uma conta.",
    lines: ["#+#=#", "+.*.-", "#+#=#", "=.=.=", "#-#=#"],
    hide: 6,
    max: 81,
    seed: 150,
  },
  {
    id: "medio-4",
    tier: "medio",
    title: "Quatro operações",
    blurb: "Soma, subtração, multiplicação e divisão na mesma grade.",
    lines: ["#*#=#", "-.../", "#+#=#", "=...=", "#-#=#"],
    hide: 6,
    max: 81,
    seed: 62,
  },
  {
    id: "desafio-1",
    tier: "desafio",
    title: "Cruz cheia",
    blurb: "Seis contas compartilham as mesmas casas.",
    lines: ["#*#=#", "-././", "#-#=#", "=.=.=", "#+#=#"],
    hide: 6,
    max: 96,
    seed: 210,
  },
  {
    id: "desafio-2",
    tier: "desafio",
    title: "A torre",
    blurb: "Uma conta em pé em cima da cruz.",
    lines: ["..#..", "..*..", "..#..", "..=..", "#+#=#", "+...-", "#+#=#", "=...=", "#-#=#"],
    hide: 7,
    max: 96,
    seed: 240,
  },
  {
    id: "desafio-3",
    tier: "desafio",
    title: "Torre mista",
    blurb: "Mais casas, as quatro operações.",
    lines: ["..#..", "../..", "..#..", "..=..", "#*#=#", "+...-", "#+#=#", "=...=", "#/#=#"],
    hide: 7,
    max: 96,
    seed: 275,
  },
  {
    id: "desafio-4",
    tier: "desafio",
    title: "Oficina",
    blurb: "Poucos números dados. Cada conta apoia a outra.",
    lines: ["#+#=#", "*.*.-", "#/#=#", "=.=.=", "#-#=#"],
    hide: 7,
    max: 96,
    seed: 9,
  },
];

const PRACTICE_TEMPLATES: Record<Tier, string[][]> = {
  facil: [
    ["#?#=#", "+...-", "#?#=#", "=...=", "#-#=#"],
    ["#-#=#", "?...?", "#+#=#", "=...=", "#?#=#"],
    ["#+#=#", "+.+.-", "#?#=#", "=.=.=", "#-#=#"],
    ["#?#=#", "-...+", "#?#=#", "=...=", "#+#=#"],
  ],
  medio: [
    ["#*#=#", "?...-", "#?#=#", "=...=", "#?#=#"],
    ["#/#=#", "+...?", "#?#=#", "=...=", "#*#=#"],
    ["#+#=#", "+.*.-", "#?#=#", "=.=.=", "#-#=#"],
    ["#?#=#", "-.../", "#*#=#", "=...=", "#?#=#"],
    ["..#..", "..?..", "..#..", "..=..", "#?#=#", "+...-", "#*#=#", "=...=", "#?#=#"],
  ],
  desafio: [
    ["#*#=#", "-././", "#?#=#", "=.=.=", "#?#=#"],
    ["..#..", "..*..", "..#..", "..=..", "#?#=#", "?...?", "#?#=#", "=...=", "#/#=#"],
    ["#?#=#", "*.*.-", "#/#=#", "=.=.=", "#?#=#"],
    ["..#..", "../..", "..#..", "..=..", "#*#=#", "+.../", "#?#=#", "=.=.=", "#-#=#"],
    ["#+#=#", "+.*./", "#*#=#", "=.=.=", "#/#=#"],
  ],
};

export function practicePuzzle(tier: Tier, seed: number): Puzzle {
  const templates = PRACTICE_TEMPLATES[tier];
  const base = Math.abs(seed) || 1;
  for (let i = 0; i < 24; i++) {
    const s = (base + i * 131) >>> 0;
    try {
      return buildPuzzle({
        id: `pratica-${tier}-${s}`,
        tier,
        title: "Prática livre",
        blurb: "Uma conta nova. Vale qualquer jeito que feche todas as linhas e colunas.",
        lines: templates[s % templates.length],
        hide: tier === "facil" ? 5 : tier === "medio" ? 6 : 7,
        max: tier === "facil" ? 24 : tier === "medio" ? 81 : 96,
        seed: (s + 17) >>> 0,
        wild: tier === "facil" ? SOFT : FOUR,
      });
    } catch {
      /* tenta outra semente */
    }
  }
  const fallback = campaignPuzzles().find((puzzle) => puzzle.tier === tier) ?? campaignPuzzles()[0];
  return {
    ...fallback,
    id: `pratica-${tier}-${base}`,
    title: "Prática livre",
    blurb: "Uma conta nova. Vale qualquer jeito que feche todas as linhas e colunas.",
  };
}

let cachedCampaign: Puzzle[] | null = null;

export function campaignPuzzles(): Puzzle[] {
  if (!cachedCampaign) cachedCampaign = CAMPAIGN_SPECS.map((spec) => buildPuzzle(spec));
  return cachedCampaign;
}

export function numsOf(puzzle: Puzzle): { id: string; solution: number; given: boolean }[] {
  const list: { id: string; solution: number; given: boolean }[] = [];
  for (const row of puzzle.rows) {
    for (const cell of row) {
      if (cell.k === "n") list.push(cell);
    }
  }
  return list;
}

export type EqStatus = "open" | "ok" | "bad";

export function equationStatus(
  puzzle: Puzzle,
  placed: Record<string, number>,
): { eq: Equation; status: EqStatus; value: (id: string) => number | null }[] {
  const given = new Map<string, number>();
  for (const cell of numsOf(puzzle)) {
    if (cell.given) given.set(cell.id, cell.solution);
  }
  const read = (id: string) => (given.has(id) ? given.get(id)! : (placed[id] ?? null));
  return puzzle.equations.map((eq) => {
    const a = read(eq.a);
    const b = read(eq.b);
    const c = read(eq.c);
    if (a === null || b === null || c === null) return { eq, status: "open" as const, value: read };
    const r = apply(a, eq.op, b, 999);
    return { eq, status: r === c ? ("ok" as const) : ("bad" as const), value: read };
  });
}

export function cellTone(
  id: string,
  report: { eq: Equation; status: EqStatus }[],
): EqStatus {
  const mine = report.filter((item) => item.eq.a === id || item.eq.b === id || item.eq.c === id);
  if (mine.some((item) => item.status === "bad")) return "bad";
  if (mine.length > 0 && mine.every((item) => item.status === "ok")) return "ok";
  return "open";
}
