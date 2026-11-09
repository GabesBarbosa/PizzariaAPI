/**
 * Horário de funcionamento (RF27).
 *
 * O servidor no Railway roda em UTC (3 horas à frente de Brasília), então "agora"
 * é sempre calculado no fuso America/Sao_Paulo. Sem isso o bot diria "fechado"
 * com a loja aberta.
 *
 * Limitação aceita: num horário que passa da meia-noite (ex.: sexta 18:00–01:00),
 * a madrugada de sábado é verificada pelo horário de sábado.
 */

export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';
export interface HorarioDia { aberto: boolean; abre?: string; fecha?: string; } // "18:00"
export type OpeningHours = Record<DiaSemana, HorarioDia>;

export const DIAS: DiaSemana[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const NOMES: Record<DiaSemana, string> = {
  dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta',
  qui: 'quinta', sex: 'sexta', sab: 'sábado',
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function agoraBrasilia(now = new Date()): { dia: DiaSemana; minutos: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => p.find(x => x.type === t)!.value;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  // Alguns runtimes devolvem "24" para meia-noite; o % 24 corrige.
  return { dia: DIAS[dia], minutos: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const min = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function diaValido(d: HorarioDia | undefined): d is Required<HorarioDia> {
  return !!d?.aberto && !!d.abre && !!d.fecha;
}

export function estaAberto(h: OpeningHours, now = new Date()): boolean {
  const { dia, minutos } = agoraBrasilia(now);
  const hoje = h[dia];
  if (!diaValido(hoje)) return false;
  const a = min(hoje.abre), f = min(hoje.fecha);
  return f > a
    ? minutos >= a && minutos < f   // ex.: 11:00–15:00
    : minutos >= a || minutos < f;  // passa da meia-noite, ex.: 18:00–01:00
}

/** "domingo: fechado; segunda: 18:00 às 23:00; ..." */
export function horarioEmTexto(h: OpeningHours): string {
  return DIAS.map(d => diaValido(h[d])
    ? `${NOMES[d]}: ${h[d].abre} às ${h[d].fecha}`
    : `${NOMES[d]}: fechado`).join('; ');
}

/**
 * Quando abre de novo, a partir de agora: "hoje às 18:00", "amanhã às 11:00",
 * "sexta às 18:00". Retorna null se nenhum dia estiver aberto.
 */
export function proximaAbertura(h: OpeningHours, now = new Date()): string | null {
  const { dia, minutos } = agoraBrasilia(now);
  const idxHoje = DIAS.indexOf(dia);
  for (let i = 0; i < 7; i++) {
    const d = DIAS[(idxHoje + i) % 7];
    const cfg = h[d];
    if (!diaValido(cfg)) continue;
    if (i === 0 && min(cfg.abre) <= minutos) continue; // já passou a abertura de hoje
    const quando = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : NOMES[d];
    return `${quando} às ${cfg.abre}`;
  }
  return null;
}

/** Valida o JSON recebido do painel. Retorna a mensagem de erro, ou null se estiver ok. */
export function validarOpeningHours(input: any): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Envie um objeto com os dias dom, seg, ter, qua, qui, sex e sab.';
  }
  for (const d of DIAS) {
    const cfg = input[d];
    if (!cfg || typeof cfg.aberto !== 'boolean') return `Dia "${d}" precisa do campo aberto (true/false).`;
    if (!cfg.aberto) continue;
    if (!HHMM.test(cfg.abre ?? '') || !HHMM.test(cfg.fecha ?? '')) {
      return `Dia "${d}": use o formato HH:MM em abre e fecha.`;
    }
    if (cfg.abre === cfg.fecha) return `Dia "${d}": o horário de abrir e fechar não pode ser igual.`;
  }
  return null;
}

/** Mantém só os campos esperados, para não gravar lixo em Settings. */
export function normalizarOpeningHours(input: any): OpeningHours {
  const out = {} as OpeningHours;
  for (const d of DIAS) {
    const cfg = input[d];
    out[d] = cfg.aberto ? { aberto: true, abre: cfg.abre, fecha: cfg.fecha } : { aberto: false };
  }
  return out;
}
