import { WritingTask1, Task1ChartData, Task1ChartType } from '../types';

const PALETTE = ['#1e293b', '#94a3b8', '#c2703d', '#4d7c0f', '#7c3aed', '#0e7490', '#be123c', '#0369a1'];

/** Pretty JSON starter for each chart type (Exam Wizard "Load template"). */
export function chartTemplateFor(chartType: WritingTask1['chartType']): string {
  switch (chartType) {
    case 'line_graph':
      return JSON.stringify({
        labels: ['2010', '2015', '2020', '2025'],
        unit: '$B',
        series: [
          { name: 'Asia-Pacific', values: [42, 80, 130, 185] },
          { name: 'Europe', values: [55, 68, 79, 92] }
        ]
      }, null, 2);
    case 'pie_chart':
      return JSON.stringify({
        labels: ['Solar', 'Wind', 'Hydro', 'Bio-energy'],
        unit: '$B',
        values: [277, 240, 90, 60]
      }, null, 2);
    case 'process_diagram':
      return JSON.stringify({
        stages: [
          { label: 'Collection', detail: 'Used paper is collected' },
          { label: 'Sorting', detail: 'Sorted by type and grade' },
          { label: 'Pulping', detail: 'Mixed with water and chemicals' },
          { label: 'Filtering', detail: 'Impurities are removed' },
          { label: 'De-inking', detail: 'Ink is washed out' },
          { label: 'Pressing and drying', detail: 'Rolled into new sheets' },
          { label: 'New paper', detail: 'Recycled products made' }
        ]
      }, null, 2);
    case 'map':
      return JSON.stringify({
        stages: [
          { label: 'Site A', detail: 'Main entrance in the north' },
          { label: 'Site B', detail: 'Reception in the centre' },
          { label: 'Site C', detail: 'Exit in the south' }
        ]
      }, null, 2);
    case 'bar_chart':
    default:
      return JSON.stringify({
        labels: ['Asia-Pacific', 'Europe', 'N. America'],
        unit: '$B',
        series: [
          { name: 'Solar 2010', values: [42, 55, 31] },
          { name: 'Solar 2025', values: [185, 92, 88] }
        ]
      }, null, 2);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const TASK1_CHART_TYPES: readonly Task1ChartType[] = ['bar_chart', 'line_graph', 'pie_chart', 'process_diagram', 'map'];

/**
 * Copy-paste prompt for an EXTERNAL AI (ChatGPT or similar): the admin pastes
 * this prompt together with the Task 1 chart picture, and the AI returns a
 * ready-to-paste Task 1 JSON for the Quick Setup holder below.
 */
export const TASK1_AI_PROMPT = `You are an IELTS Academic Writing Task 1 author. I will attach the Task 1 visual (chart, graph, diagram, process or map) as a picture after the line ---CHART---. If there is no picture, I will describe the visual there instead.

Do the following:
1. Identify the visual and choose "chartType" from EXACTLY: bar_chart, line_graph, pie_chart, process_diagram, map.
2. Write a short "title" (e.g. "The Process of Producing Recycled Paper").
3. Write the candidate "prompt": 1-2 sentences describing the visual, then "Summarise the information by selecting and reporting the main features, and make comparisons where relevant." and finally "Write at least 150 words." on its own line.
4. Write a one-line "chartDescription" headline for the visual.
5. Write "chartDataSummary": the key numbers a candidate needs (with units), in 2-4 sentences.
6. Extract "chartData" in the EXACT shape for the chosen type (read real values off the image — NEVER invent numbers):
   - bar_chart / line_graph: {"labels": ["..."], "series": [{"name": "...", "values": [...]}], "unit": "£"}
     ("labels" = groups/years, one "values" entry per label, same order and length.)
   - pie_chart: {"labels": ["..."], "values": [...], "unit": "%"}
   - process_diagram / map: {"stages": [{"label": "...", "detail": "..."}]} (in order)
   Limits: at most 12 labels, at most 4 series, at most 12 stages.
   Numbers and units (mandatory):
   - "values" must be PLAIN numbers with no commas, spaces or symbols: 400000 (never "400,000" and never "£400,000").
   - "unit" must be VERY short — it labels the chart axis: "£", "$B", "%" (never a phrase like "pounds sterling"; put the full wording in "chartDescription" and "chartDataSummary" instead).
   MULTIPLE VISUALS: if the task shows TWO or more visuals (e.g. two pie charts, or a bar chart plus a line graph), return "chartData" as an ARRAY with one object per visual — in left-to-right / top-to-bottom order — and put a "chartType" INSIDE every object, e.g. "chartData": [{"chartType": "pie_chart", "title": "Chart 1: Male students", "labels": [...], "values": [...]}, {"chartType": "pie_chart", "title": "Chart 2: Female students", "labels": [...], "values": [...]}]. At most 6 visuals. A single visual stays a plain object (no array).

Return STRICT JSON only (no markdown fences, no commentary), exactly this shape:
{"title": "...", "prompt": "...", "chartType": "bar_chart", "chartDescription": "...", "chartDataSummary": "...", "chartData": {"labels": [...], "series": [{"name": "...", "values": [...]}], "unit": "..."}}

---CHART---
(describe the visual here if you did not attach a picture)`;

/** Full Task 1 JSON template for the Quick Setup holder. */
export function task1TemplateFor(chartType: WritingTask1['chartType']): string {
  const chartData = JSON.parse(chartTemplateFor(chartType));
  return JSON.stringify({
    title: 'Writing Task 1: Sample Chart Report',
    prompt: 'The chart below shows sample data.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.',
    chartType,
    chartDescription: 'Sample chart headline',
    chartDataSummary: 'Key figures: see the chart.',
    chartData
  }, null, 2);
}

export interface Task1Draft {
  title?: string;
  prompt?: string;
  chartType?: WritingTask1['chartType'];
  chartDescription?: string;
  chartDataSummary?: string;
  chartData?: Task1ChartData | Task1ChartData[];
}

/**
 * Parse + validate a pasted full-Task-1 JSON for the Quick Setup holder.
 * Unknown keys are ignored; `chartData` (when present) is validated against
 * the draft's own chartType (or `fallbackType`). Never throws.
 */
export function parseTask1DraftJson(
  text: string,
  fallbackType: WritingTask1['chartType']
): { draft?: Task1Draft; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : 'cannot parse'}` };
  }
  if (!isRecord(raw)) return { error: 'Task JSON must be an object like {"title": "...", "chartType": "bar_chart", ...}.' };

  const draft: Task1Draft = {};
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v : undefined;

  const title = str(raw.title);
  if (title) draft.title = title.slice(0, 200);
  const prompt = str(raw.prompt);
  if (prompt) draft.prompt = prompt.slice(0, 4000);
  const chartDescription = str(raw.chartDescription);
  if (chartDescription) draft.chartDescription = chartDescription.slice(0, 300);
  const chartDataSummary = str(raw.chartDataSummary);
  if (chartDataSummary) draft.chartDataSummary = chartDataSummary.slice(0, 2000);

  let chartType = fallbackType;
  if (raw.chartType !== undefined) {
    if (typeof raw.chartType !== 'string' || !(TASK1_CHART_TYPES as readonly string[]).includes(raw.chartType)) {
      return { error: `"chartType" must be one of: ${TASK1_CHART_TYPES.join(', ')}.` };
    }
    chartType = raw.chartType as WritingTask1['chartType'];
    draft.chartType = chartType;
  }

  if (raw.chartData !== undefined && raw.chartData !== null) {
    const parsed = parseTask1ChartData(JSON.stringify(raw.chartData), chartType);
    if (parsed.error || !parsed.data) {
      return { error: `chartData problem: ${parsed.error || 'invalid'}` };
    }
    draft.chartData = parsed.data;
  }

  if (
    draft.title === undefined && draft.prompt === undefined &&
    draft.chartType === undefined && draft.chartDescription === undefined &&
    draft.chartDataSummary === undefined && draft.chartData === undefined
  ) {
    return { error: 'No Task 1 fields found. Expected keys: title, prompt, chartType, chartDescription, chartDataSummary, chartData.' };
  }
  return { draft };
}

function resolveItemType(raw: Record<string, unknown>, fallback: Task1ChartType): { type?: Task1ChartType; error?: string } {
  if (raw.chartType === undefined) return { type: fallback };
  if (typeof raw.chartType !== 'string' || !(TASK1_CHART_TYPES as readonly string[]).includes(raw.chartType)) {
    return { error: `"chartType" must be one of: ${TASK1_CHART_TYPES.join(', ')}.` };
  }
  return { type: raw.chartType as Task1ChartType };
}

function parseSingleChartItem(
  raw: Record<string, unknown>,
  chartType: Task1ChartType
): { data?: Task1ChartData; error?: string } {
  const strArr = (v: unknown): string[] | null =>
    Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string') ? [...v] : null;
  const numArr = (v: unknown): number[] | null =>
    Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number' && isFinite(x)) ? [...v] : null;

  const keepType = (out: Task1ChartData): Task1ChartData => {
    if (typeof raw.chartType === 'string') out.chartType = chartType;
    return out;
  };

  if (chartType === 'process_diagram' || chartType === 'map') {
    const st = raw.stages;
    if (!Array.isArray(st) || st.length === 0) {
      return { error: 'This chart type needs a non-empty "stages" array, e.g. {"stages": ["Collection", "Sorting", ...]}.' };
    }
    const stages: Task1ChartData['stages'] = [];
    for (const s of st) {
      if (typeof s === 'string' && s.trim()) stages.push(s);
      else if (isRecord(s) && typeof s.label === 'string' && s.label.trim()) {
        stages.push({ label: s.label, detail: typeof s.detail === 'string' ? s.detail : undefined });
      } else {
        return { error: 'Each stage must be a string or {"label": "...", "detail": "..."}.' };
      }
    }
    const out: Task1ChartData = { stages };
    if (typeof raw.title === 'string') out.title = raw.title;
    return { data: keepType(out) };
  }

  const labels = strArr(raw.labels);
  if (!labels) return { error: 'Needs a non-empty "labels" array of strings, e.g. {"labels": ["2010", "2025"]}.' };

  if (chartType === 'pie_chart') {
    let values = numArr(raw.values);
    if (!values && Array.isArray(raw.series) && raw.series.length > 0 && isRecord(raw.series[0])) {
      values = numArr((raw.series[0] as Record<string, unknown>).values);
    }
    if (!values) {
      return { error: 'Pie charts need "values" (or one "series"), e.g. {"labels": ["Solar", "Wind"], "values": [60, 40]}.' };
    }
    if (values.length !== labels.length) {
      return { error: `"values" (${values.length}) must match "labels" (${labels.length}).` };
    }
    const out: Task1ChartData = { labels, values };
    if (typeof raw.unit === 'string') out.unit = raw.unit;
    if (typeof raw.title === 'string') out.title = raw.title;
    return { data: keepType(out) };
  }

  // bar_chart / line_graph
  if (!Array.isArray(raw.series) || raw.series.length === 0) {
    return { error: 'Needs a non-empty "series" array, e.g. {"labels": [...], "series": [{"name": "Solar", "values": [...]}]}.' };
  }
  const series: NonNullable<Task1ChartData['series']> = [];
  for (const s of raw.series) {
    if (!isRecord(s) || typeof s.name !== 'string' || !s.name.trim()) {
      return { error: 'Each series needs a "name" and numeric "values".' };
    }
    const values = numArr(s.values);
    if (!values) return { error: `Series "${s.name}" needs a non-empty numeric "values" array.` };
    if (values.length !== labels.length) {
      return { error: `Series "${s.name}" has ${values.length} values but there are ${labels.length} labels.` };
    }
    series.push({
      name: s.name,
      values,
      color: typeof s.color === 'string' ? s.color : undefined
    });
  }
  const out: Task1ChartData = { labels, series };
  if (typeof raw.unit === 'string') out.unit = raw.unit;
  if (typeof raw.title === 'string') out.title = raw.title;
  return { data: keepType(out) };
}

/**
 * Parse + structurally validate admin-pasted chart JSON for the given type.
 * Accepts ONE chart object or an ARRAY of them (multi-visual tasks: each
 * item may carry its own "chartType" for mixed charts; items without one
 * use the fallback type). At most 6 visuals are kept. Returns the
 * normalized data or a short human-readable error (never throws).
 */
export function parseTask1ChartData(
  text: string,
  chartType: WritingTask1['chartType']
): { data?: Task1ChartData | Task1ChartData[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : 'cannot parse'}` };
  }
  const finish = (items: Task1ChartData[]): { data?: Task1ChartData | Task1ChartData[] } =>
    items.length === 1 && !Array.isArray(raw) ? { data: items[0] } : { data: items };
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { error: 'Chart array is empty — include at least one chart object.' };
    const items: Task1ChartData[] = [];
    for (let i = 0; i < Math.min(raw.length, 6); i++) {
      const item = raw[i];
      if (!isRecord(item)) return { error: `Chart ${i + 1}: must be an object like {"labels": [...], "series": [...]}, or {"stages": [...]}.` };
      const resolved = resolveItemType(item, chartType);
      if (resolved.error || !resolved.type) return { error: `Chart ${i + 1}: ${resolved.error}` };
      const parsed = parseSingleChartItem(item, resolved.type);
      if (parsed.error || !parsed.data) return { error: `Chart ${i + 1}: ${parsed.error}` };
      items.push(parsed.data);
    }
    return finish(items);
  }
  if (!isRecord(raw)) return { error: 'Chart JSON must be an object like {"labels": [...], "series": [...]}, or an array of such objects.' };
  const resolved = resolveItemType(raw, chartType);
  if (resolved.error || !resolved.type) return { error: resolved.error };
  const parsed = parseSingleChartItem(raw, resolved.type);
  if (parsed.error || !parsed.data) return { error: parsed.error };
  return finish([parsed.data]);
}

/** Round the axis max up to a clean 1/2/2.5/5 × 10^n step. */
function niceMax(v: number): number {
  if (!(v > 0)) return 10;
  const exp = Math.floor(Math.log10(v));
  const base = v / Math.pow(10, exp);
  const step = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return step * Math.pow(10, exp);
}

function seriesColor(i: number, custom?: string): string {
  return custom || PALETTE[i % PALETTE.length];
}

/** Shorten large axis numbers: 500000 -> 500k, 2500000 -> 2.5M, 1400000000 -> 1.4B. */
export function formatCompact(v: number): string {
  const abs = Math.abs(v);
  const trim = (n: number) => {
    const s = (Math.round(n * 10) / 10).toString();
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };
  if (abs >= 1e9) return `${trim(v / 1e9)}B`;
  if (abs >= 1e6) return `${trim(v / 1e6)}M`;
  if (abs >= 1e3) return `${trim(v / 1e3)}k`;
  return `${Math.round(v)}`;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-slate-300 rounded-sm p-6 text-center">
      <p className="text-[12px] text-slate-500">{children}</p>
    </div>
  );
}

function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1">
      {items.map(it => (
        <span key={it.name} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

function BarChart({ data }: { data: Task1ChartData }) {
  const labels = (data.labels || []).slice(0, 12);
  const series = (data.series || []).slice(0, 4);
  if (labels.length === 0 || series.length === 0) return <Placeholder>No chart data provided yet.</Placeholder>;
  const W = 450;
  const H = 200;
  const L = 46;
  const R = 8;
  const unit = (data.unit || '').trim();
  const T = unit ? 24 : 10;
  const B = 184;
  const plotW = W - L - R;
  const plotH = B - T;
  const max = niceMax(Math.max(...series.flatMap(s => s.values)));
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const groupW = plotW / labels.length;
  const barW = Math.min(28, (groupW * 0.72) / series.length);
  const ticks = [0.25, 0.5, 0.75, 1];
  return (
    <div>
      <Legend items={series.map((s, i) => ({ name: s.name, color: seriesColor(i, s.color) }))} />
      <svg viewBox={`0 0 ${W} ${H + 8}`} className="w-full h-auto font-sans text-[10px]" role="img" aria-label="Bar chart">
        {unit && <text x={L} y={13} fill="#94a3b8" fontSize="9">{unit}</text>}
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} y1={T + plotH * (1 - t)} x2={W - R} y2={T + plotH * (1 - t)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={L - 6} y={T + plotH * (1 - t) + 3} textAnchor="end" fill="#64748b">{formatCompact(max * t)}</text>
          </g>
        ))}
        <text x={L - 6} y={B + 3} textAnchor="end" fill="#64748b">0</text>
        <line x1={L} y1={B} x2={W - R} y2={B} stroke="#94a3b8" strokeWidth="1.5" />
        {labels.map((lb, gi) => (
          <g key={gi}>
            {series.map((s, si) => {
              const v = s.values[gi];
              const bw = barW;
              const x = L + gi * groupW + groupW / 2 - (series.length * bw) / 2 + si * bw + 1;
              return <rect key={si} x={x} y={y(v)} width={bw - 2} height={Math.max(1, B - y(v))} fill={seriesColor(si, s.color)} rx="2" />;
            })}
            <text x={L + gi * groupW + groupW / 2} y={H - 4} textAnchor="middle" fill="#475569" fontWeight="bold">
              {lb.length > 12 ? `${lb.slice(0, 11)}…` : lb}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function LineGraph({ data }: { data: Task1ChartData }) {
  const labels = (data.labels || []).slice(0, 12);
  const series = (data.series || []).slice(0, 4);
  if (labels.length < 2 || series.length === 0) return <Placeholder>Line graphs need at least 2 labels and one series.</Placeholder>;
  const W = 450;
  const H = 200;
  const L = 46;
  const R = 8;
  const unit = (data.unit || '').trim();
  const T = unit ? 24 : 10;
  const B = 184;
  const plotW = W - L - R;
  const plotH = B - T;
  const max = niceMax(Math.max(...series.flatMap(s => s.values)));
  const x = (i: number) => (labels.length === 1 ? L + plotW / 2 : L + (i / (labels.length - 1)) * plotW);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0.25, 0.5, 0.75, 1];
  return (
    <div>
      <Legend items={series.map((s, i) => ({ name: s.name, color: seriesColor(i, s.color) }))} />
      <svg viewBox={`0 0 ${W} ${H + 8}`} className="w-full h-auto font-sans text-[10px]" role="img" aria-label="Line graph">
        {unit && <text x={L} y={13} fill="#94a3b8" fontSize="9">{unit}</text>}
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} y1={T + plotH * (1 - t)} x2={W - R} y2={T + plotH * (1 - t)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={L - 6} y={T + plotH * (1 - t) + 3} textAnchor="end" fill="#64748b">{formatCompact(max * t)}</text>
          </g>
        ))}
        <text x={L - 6} y={B + 3} textAnchor="end" fill="#64748b">0</text>
        <line x1={L} y1={B} x2={W - R} y2={B} stroke="#94a3b8" strokeWidth="1.5" />
        {series.map((s, si) => (
          <g key={si}>
            <polyline
              points={s.values.slice(0, labels.length).map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={seriesColor(si, s.color)}
              strokeWidth="2.5"
            />
            {s.values.slice(0, labels.length).map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={seriesColor(si, s.color)} stroke="#fff" strokeWidth="1" />
            ))}
          </g>
        ))}
        {labels.map((lb, i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fill="#475569" fontWeight="bold">
            {lb.length > 10 ? `${lb.slice(0, 9)}…` : lb}
          </text>
        ))}
      </svg>
    </div>
  );
}

function PieChart({ data }: { data: Task1ChartData }) {
  const labels = (data.labels || []).slice(0, 8);
  const values = (data.values || data.series?.[0]?.values || []).slice(0, 8);
  if (labels.length === 0 || values.length !== labels.length) {
    return <Placeholder>Pie charts need matching "labels" and "values".</Placeholder>;
  }
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return <Placeholder>Pie chart values must be positive numbers.</Placeholder>;
  const cx = 120;
  const cy = 95;
  const r = 72;
  const polar = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  let acc = 0;
  const unit = data.unit ? ` ${data.unit}` : '';
  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <svg viewBox="0 0 240 190" className="w-56 h-auto font-sans text-[10px] shrink-0" role="img" aria-label="Pie chart">
        {values.map((v, i) => {
          const start = (acc / total) * 360;
          acc += v;
          const end = (acc / total) * 360;
          const large = end - start > 180 ? 1 : 0;
          const [x1, y1] = polar(start);
          const [x2, y2] = polar(end);
          if (end - start >= 359.99) {
            return <circle key={i} cx={cx} cy={cy} r={r} fill={seriesColor(i)} />;
          }
          return (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={seriesColor(i)}
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <div className="space-y-1 text-[11px] w-full">
        {labels.map((lb, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: seriesColor(i) }} />
            <span className="font-semibold text-slate-700 truncate">{lb}</span>
            <span className="ml-auto font-mono text-slate-600 shrink-0">
              {values[i]}{unit} · {Math.round((values[i] / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowList({ data, kind }: { data: Task1ChartData; kind: 'process' | 'map' }) {
  const stages = (data.stages || []).slice(0, 12);
  if (stages.length === 0) {
    return (
      <Placeholder>
        {kind === 'process'
          ? 'No stages provided yet — paste a "stages" array in the Exam Wizard.'
          : 'No locations provided yet — paste a "stages" array in the Exam Wizard.'}
      </Placeholder>
    );
  }
  return (
    <ol className="space-y-0">
      {stages.map((s, i) => {
        const label = typeof s === 'string' ? s : s.label;
        const detail = typeof s === 'string' ? undefined : s.detail;
        return (
          <li key={i}>
            <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-sm px-2.5 py-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center mt-px">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-slate-800 leading-snug">{label}</p>
                {detail && <p className="text-[11px] text-slate-500 leading-snug">{detail}</p>}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className="flex justify-start pl-[18px]" aria-hidden="true">
                <span className="text-slate-400 text-sm leading-none">↓</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function isValidChartType(t: unknown): t is Task1ChartType {
  return typeof t === 'string' && (TASK1_CHART_TYPES as readonly string[]).includes(t);
}

function SingleChart({ data, chartType }: { data: Task1ChartData; chartType: Task1ChartType }) {
  switch (chartType) {
    case 'line_graph':
      return <LineGraph data={data} />;
    case 'pie_chart':
      return <PieChart data={data} />;
    case 'process_diagram':
      return <FlowList data={data} kind="process" />;
    case 'map':
      return <FlowList data={data} kind="map" />;
    case 'bar_chart':
    default:
      return <BarChart data={data} />;
  }
}

/**
 * Built-in Task 1 vector visual(s), driven by chartType + chartData JSON.
 * chartData may hold ONE chart (rendered exactly as before) or an ARRAY of
 * them (e.g. two pie charts, or a bar chart plus a process) — each item may
 * carry its own chartType for mixed visuals and renders under its own
 * title (or "Chart N"). Process diagrams and maps render as numbered flows;
 * without usable data a neutral placeholder is shown (never invented numbers).
 */
export function Task1Chart({ task1 }: { task1: WritingTask1 }) {
  const raw = task1.chartData;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter((d): d is Task1ChartData => !!d && typeof d === 'object')
    .slice(0, 6);
  if (items.length === 0) {
    switch (task1.chartType) {
      case 'process_diagram':
        return <Placeholder>No stages provided yet.</Placeholder>;
      case 'map':
        return <Placeholder>No locations provided yet.</Placeholder>;
      default:
        return <Placeholder>No chart data provided yet.</Placeholder>;
    }
  }
  if (items.length === 1) {
    const d = items[0];
    return <SingleChart data={d} chartType={isValidChartType(d.chartType) ? d.chartType : task1.chartType} />;
  }
  return (
    <div className="space-y-4">
      {items.map((d, i) => (
        <div key={i}>
          <p className="text-[11px] font-bold text-slate-700 mb-1">{d.title || `Chart ${i + 1}`}</p>
          <SingleChart data={d} chartType={isValidChartType(d.chartType) ? d.chartType : task1.chartType} />
        </div>
      ))}
    </div>
  );
}
