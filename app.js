function main(DATA) {
const CAT_META = {
  running:          { label: 'Correr',    color: 'var(--cat-running)',  icon: '🏃' },
  indoor_cycling:   { label: 'Ciclismo',  color: 'var(--cat-cycling)',  icon: '🚴' },
  strength_training:{ label: 'Fuerza',    color: 'var(--cat-strength)', icon: '🏋️' },
  yoga:             { label: 'Yoga',      color: 'var(--cat-yoga)',     icon: '🧘' },
  paddelball:       { label: 'Pádel',     color: 'var(--cat-padel)',    icon: '🎾' },
  walking:          { label: 'Caminar',   color: 'var(--cat-walking)',  icon: '🚶' },
};

function fmt(n, d) { return (n === '' || n === null || n === undefined || Number.isNaN(Number(n))) ? '—' : Number(n).toFixed(d === undefined ? 0 : d); }
function fmtClock(totalSec) {
  if (totalSec === null || totalSec === undefined || Number.isNaN(Number(totalSec))) return '—';
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtPace(secPerKm) {
  if (!secPerKm) return '—';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')}/km`;
}
function fmtDateShort(iso) {
  if (!iso) return '';
  const d = iso.slice(0,10);
  return `${d.slice(8,10)}/${d.slice(5,7)}`;
}

// ---------- Shared derived data ----------
// A day only counts as having real sleep/HRV data once the watch has actually
// uploaded it — Garmin Connect can take a few hours after waking, so the early
// morning sync can catch a "today" row with sleep_hours=0 and hrv_avg empty.
// Without this check that partial row would look like a closed, valid night.
function isDayComplete(d) {
  return !!d && d.sleep_score !== '' && d.sleep_score !== null && d.sleep_score !== undefined
    && Number(d.sleep_hours) > 0
    && d.hrv_avg !== '' && d.hrv_avg !== null && d.hrv_avg !== undefined && !Number.isNaN(Number(d.hrv_avg));
}
const dailyWithData = DATA.daily.filter(isDayComplete);
const last = dailyWithData[dailyWithData.length - 1] || {};
const readinessRows = DATA.daily.filter(d => d.training_readiness !== '' && d.training_readiness !== undefined);
const lastReadiness = readinessRows[readinessRows.length - 1] || {};
const readinessLevel = (score) => score === '' || score === undefined ? '' : (score >= 70 ? 'Alto' : score >= 40 ? 'Moderado' : 'Bajo');
const lastRace = DATA.racePredictions[DATA.racePredictions.length - 1] || {};
const runActivities = DATA.activities.filter(a => a.type === 'running');
const strengthActivities = DATA.activities.filter(a => a.type === 'strength_training');
const splitsEntries = Object.values(DATA.runSplits).sort((a,b) => a.date < b.date ? 1 : -1);
const refEntry = splitsEntries.find(e => /referencia/i.test(e.name)) || splitsEntries[0];
const buildEntry = splitsEntries.find(e => e !== refEntry && e.active_laps.length > 1);
const todayStr = new Date().toISOString().slice(0, 10);
const todayDailyRaw = DATA.daily.find(d => d.date === todayStr) || null;
const todayDailyComplete = isDayComplete(todayDailyRaw);
const coachPlan = (DATA.coachPlan || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
const STEP_TYPE_LABEL = { warmup: 'Calent.', cooldown: 'Enfr.', interval: 'Tramo', recovery: 'Recup.', rest: 'Descanso', repeat: 'Repite', other: 'Libre' };
function stepShortLabel(step) {
  const desc = (step.description || '').toLowerCase();
  if (step.type === 'interval') {
    if (desc.includes('opcional')) return 'Opcional';
    if (desc.includes('fácil') || desc.includes('facil')) return 'Fácil';
    if (desc.includes('rápido') || desc.includes('rapido')) return 'Rápido';
    if (desc.includes('umbral')) return 'Umbral';
    if (desc.includes('tempo')) return 'Tempo';
  }
  return STEP_TYPE_LABEL[step.type] || step.type || '';
}
function findCoachStepsForRun(entryDate) {
  const planDay = coachPlan.find(w => w.date === entryDate && w.sport === 'running');
  const steps = planDay && planDay.detail && planDay.detail.steps ? planDay.detail.steps : null;
  if (!steps || !steps.length) return null;
  const flat = [];
  steps.forEach(s => {
    if (s.type === 'repeat' && s.steps && s.steps.length) {
      for (let i = 0; i < (s.iterations || 1); i++) s.steps.forEach(inner => flat.push(inner));
    } else {
      flat.push(s);
    }
  });
  return flat;
}

function fmtRecoveryMinutes(min) {
  if (min === '' || min === undefined || min === null) return '—';
  const m = Number(min);
  if (m <= 5) return 'Listo ahora';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), rem = Math.round(m % 60);
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}

// ---------- Header sync time ----------
if (DATA.generatedAt) {
  const genDate = new Date(DATA.generatedAt);
  if (!Number.isNaN(genDate.getTime())) {
    const hh = String(genDate.getHours()).padStart(2, '0');
    const mm = String(genDate.getMinutes()).padStart(2, '0');
    document.getElementById('syncTime').textContent = `Datos de las ${hh}:${mm}`;
  }
}

// ---------- Stat tiles ----------
const tiles = [
  { label: 'Training Readiness', value: fmt(lastReadiness.training_readiness, 0), unit: readinessLevel(lastReadiness.training_readiness), foot: 'Sueño + HRV + carga combinados' },
  { label: '10K estimado', value: fmtClock(lastRace.time10K), unit: '', foot: DATA.racePredictions.length ? 'Predicción de Garmin, hoy' : 'Aún sin datos suficientes' },
  { label: 'Sueño anoche', value: fmt(last.sleep_score, 0), unit: '/ 100', foot: fmt(last.sleep_hours,1) + ' h de sueño' },
];
document.getElementById('tiles').innerHTML = tiles.map(t => `
  <div class="tile">
    <div class="label">${t.label}</div>
    <div class="value num">${t.value}<span class="unit">${t.unit}</span></div>
    <div class="foot">${t.foot}</div>
  </div>`).join('');

// ---------- Insights ----------
const lb = DATA.loadBalance;
const runCount = runActivities.length;
const totalRunKm = runActivities.reduce((s,a)=>s+Number(a.distance_km||0),0);
const yogaCount = DATA.activities.filter(a => a.type === 'yoga').length;
const vsPhraseParts = [];
if (strengthActivities.length) vsPhraseParts.push(`${strengthActivities.length} sesiones de fuerza`);
if (yogaCount) vsPhraseParts.push(`${yogaCount} de yoga`);
const vsPhrase = vsPhraseParts.length ? ` frente a ${vsPhraseParts.join(' y ')}` : '';

const dateMinus1 = (iso) => { const d = new Date(iso); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); };
function isWithinLastDays(dateStr, days) {
  return (new Date(todayStr) - new Date(dateStr)) / 86400000 <= days;
}

// Detect strength sessions same-day or day-before a quality run (TE aerobic >= 2.5).
// Only surfaced if it's recent (last 7 days) AND not already contradicted by 2+ later
// quality runs that DID keep good spacing — otherwise it's stale advice.
const qualityRuns = runActivities.filter(a => Number(a.training_effect_aerobic || 0) >= 2.5);
const proximityHitRaw = qualityRuns.find(run =>
  strengthActivities.some(s => s.date === run.date || s.date === dateMinus1(run.date))
);
let proximityHit = null;
if (proximityHitRaw && isWithinLastDays(proximityHitRaw.date, 7)) {
  const laterContradicting = qualityRuns.filter(r => r.date > proximityHitRaw.date &&
    !strengthActivities.some(s => s.date === r.date || s.date === dateMinus1(r.date)));
  if (laterContradicting.length < 2) proximityHit = proximityHitRaw;
}

// What today's plan actually calls for. The planner (same source as the "Hoy" card
// — strength/bike sessions it assigns aren't in Garmin Coach's own plan at all) is
// the authority here, but it only resolves once plannerData loads asynchronously, so
// this starts with a same-structure placeholder and updateReadinessInsight() (called
// from renderTodayCard, which already computes todayEntry) patches it in place once
// the real plan is known — keeping both cards in sync instead of guessing from
// Garmin Coach's running-only schedule.
function todayPlanSummary(todayEntry) {
  const active = todayEntry ? todayEntry.sessions.filter(s => s.status !== 'skipped') : [];
  if (!active.length) return { label: null, hasRun: false };
  return { label: active.map(s => s.label).join(' + '), hasRun: active.some(s => s.type === 'run') };
}
function readinessInsightHtml(todayEntry) {
  if (lastReadiness.training_readiness === undefined || lastReadiness.training_readiness === '') {
    return { tone: 'neutral', html: `Aún no hay suficiente historial para calcular tu Training Readiness diario — debería aparecer en los próximos días de uso.` };
  }
  const tone = lastReadiness.training_readiness >= 70 ? 'good' : lastReadiness.training_readiness >= 40 ? 'neutral' : 'warning';
  const recovMin = Number(lastReadiness.recovery_time_minutes);
  const hadActivityYesterday = DATA.activities.some(a => a.date === dateMinus1(lastReadiness.date || last.date));
  const recovPhrase = recovMin <= 5 ? 'ya sin tiempo de recuperación pendiente'
    : hadActivityYesterday ? `tras el entreno de ayer, con ${fmtRecoveryMinutes(recovMin).toLowerCase()} de recuperación estimada todavía`
    : `con ${fmtRecoveryMinutes(recovMin).toLowerCase()} de recuperación estimada todavía`;
  const { label, hasRun } = todayPlanSummary(todayEntry);
  let advice;
  if (!label) advice = 'hoy toca descanso según tu planificador.';
  else if (!hasRun) advice = `hoy toca ${label} según tu planificador, no una sesión de carrera.`;
  else advice = lastReadiness.training_readiness >= 70 ? 'buen día para una sesión de calidad.' : lastReadiness.training_readiness >= 40 ? 'un día para intensidad moderada, sin forzar.' : 'mejor priorizar descanso o algo suave hoy.';
  return { tone, html: `Tu <strong>Training Readiness de hoy es ${fmt(lastReadiness.training_readiness,0)} (${readinessLevel(lastReadiness.training_readiness)})</strong>, ${recovPhrase} — ${advice}` };
}
function updateReadinessInsight(todayEntry) {
  const dotEl = document.getElementById('readinessInsight-dot');
  const textEl = document.getElementById('readinessInsight-text');
  if (!dotEl || !textEl) return;
  const { tone, html } = readinessInsightHtml(todayEntry);
  dotEl.className = 'dot ' + tone;
  textEl.innerHTML = html;
}

const insights = [
  {
    tone: 'warning',
    html: `Tu <strong>carga aeróbica de baja intensidad</strong> (${fmt(lb.monthlyLoadAerobicLow,0)}) está por debajo del rango objetivo de Garmin (${lb.monthlyLoadAerobicLowTargetMin}–${lb.monthlyLoadAerobicLowTargetMax}). Con ${runCount} carreras (${fmt(totalRunKm,1)} km)${vsPhrase}, añadir rodajes suaves en Z2 ayudaría a construir la base del 10K.`
  },
  { id: 'readinessInsight', ...readinessInsightHtml(null) },
  {
    tone: proximityHit ? 'warning' : 'good',
    html: proximityHit
      ? `Detecté fuerza justo antes de una carrera de calidad: <strong>${proximityHit.name}</strong> (${fmtDateShort(proximityHit.date)}) tuvo una sesión de fuerza el mismo día o el anterior — si notas piernas cargadas en las carreras de Coach, prueba a separarlas al menos un día.`
      : `Tus sesiones de fuerza no coinciden con tus carreras de calidad de Coach en este periodo — buen espaciado para llegar fresco a las sesiones importantes.`
  },
  {
    tone: 'neutral',
    html: DATA.racePredictions.length
      ? `Tu predicción de 10K (<strong>${fmtClock(lastRace.time10K)}</strong>) se basa en tu VO2max y tu última prueba de referencia (${fmtDateShort(refEntry?.date || '')}). Es un único dato por ahora — se irá afinando con cada nueva prueba que te ponga Coach.`
      : `Todavía no hay predicción de carrera — aparecerá en cuanto acumules algunas sesiones más con el reloj.`
  },
];

// Correlate self-evaluation (feel/RPE) with real HR zones for the most recent case
// where an "easy" session actually ran hard. Same 7-day + contradiction rule as above.
function zonePctBreakdown(hrZones) {
  if (!hrZones || !hrZones.length) return null;
  const total = hrZones.reduce((s,z) => s + (z.secs||0), 0);
  if (!total) return null;
  let best = hrZones[0];
  hrZones.forEach(z => { if ((z.secs||0) > (best.secs||0)) best = z; });
  return { zone: best.zone, pct: Math.round((best.secs||0) / total * 100) };
}
const flaggedEffortRunRaw = runActivities.find(a => {
  const rpe = a.rpe !== undefined && a.rpe !== null && a.rpe !== '' ? Number(a.rpe) : null;
  return rpe !== null && rpe >= 7 && wasIntendedEasy(a) && a.hr_zones && a.hr_zones.length;
});
let flaggedEffortRun = null;
if (flaggedEffortRunRaw && isWithinLastDays(flaggedEffortRunRaw.date, 7)) {
  const laterEasyRuns = runActivities.filter(a => a.date > flaggedEffortRunRaw.date && wasIntendedEasy(a));
  const contradicting = laterEasyRuns.filter(a => {
    const rpe = a.rpe !== undefined && a.rpe !== null && a.rpe !== '' ? Number(a.rpe) : null;
    return !(rpe !== null && rpe >= 7);
  });
  if (contradicting.length < 2) flaggedEffortRun = flaggedEffortRunRaw;
}
if (flaggedEffortRun) {
  const bd = zonePctBreakdown(flaggedEffortRun.hr_zones);
  if (bd) {
    insights.push({
      tone: 'warning',
      html: `Esfuerzo ${fmt(Number(flaggedEffortRun.rpe),0)}/10 con el ${bd.pct}% del tiempo en Z${bd.zone} en <strong>${flaggedEffortRun.name}</strong> (${fmtDateShort(flaggedEffortRun.date)}) — la sesión no fue tan suave como estaba pensada.`,
    });
  }
}

// HR drift over 5% in a session meant to be easy. Same 7-day + contradiction rule.
const driftRunRaw = runActivities.find(a => wasIntendedEasy(a) && a.hr_drift_pct !== undefined && a.hr_drift_pct !== null && a.hr_drift_pct !== '' && Number(a.hr_drift_pct) > 5);
let driftRun = null;
if (driftRunRaw && isWithinLastDays(driftRunRaw.date, 7)) {
  const laterEasyRuns = runActivities.filter(a => a.date > driftRunRaw.date && wasIntendedEasy(a) && a.hr_drift_pct !== undefined && a.hr_drift_pct !== null && a.hr_drift_pct !== '');
  const contradicting = laterEasyRuns.filter(a => Number(a.hr_drift_pct) <= 5);
  if (contradicting.length < 2) driftRun = driftRunRaw;
}
if (driftRun) {
  insights.push({
    tone: 'warning',
    html: `<strong>${driftRun.name}</strong> (${fmtDateShort(driftRun.date)}) tuvo una deriva cardíaca del ${fmt(Number(driftRun.hr_drift_pct),1)}% — la FC subió bastante en la segunda mitad para ser una sesión suave; puede indicar que el ritmo inicial fue algo alto, calor o falta de hidratación.`,
  });
}

// Z2 pace trend, week over week
const z2Weeks = (DATA.runTrends || []).filter(w => w.z2_pace_sec_km);
if (z2Weeks.length >= 2) {
  const currW = z2Weeks[z2Weeks.length-1], prevW = z2Weeks[z2Weeks.length-2];
  const better = currW.z2_pace_sec_km < prevW.z2_pace_sec_km;
  const z2b = DATA.profile && Array.isArray(DATA.profile.hrZoneBoundaries) ? DATA.profile.hrZoneBoundaries : null;
  const z2Label = z2b ? `${z2b[1]?.low}–${(z2b[2]?.low||1)-1} ppm` : '120–139 ppm';
  insights.push({
    tone: better ? 'good' : 'neutral',
    html: `Tu ritmo medio en Z2 (${z2Label}) ha ${better?'mejorado':'empeorado'} de ${fmtPace(prevW.z2_pace_sec_km)} a ${fmtPace(currW.z2_pace_sec_km)} respecto a la semana anterior con carreras — ${better?'buena señal de eficiencia aeróbica.':'vale la pena vigilarlo en las próximas semanas.'}`,
  });
}

document.getElementById('insights').innerHTML = insights.map(i => `
  <div class="insight"><div class="dot ${i.tone}"${i.id ? ` id="${i.id}-dot"` : ''}></div><p${i.id ? ` id="${i.id}-text"` : ''}>${i.html}</p></div>`).join('');

// ---------- Camino al 10K ----------
const raceLabels = [
  { key: 'time5K', label: '5K' },
  { key: 'time10K', label: '10K' },
  { key: 'timeHalfMarathon', label: 'Media' },
  { key: 'timeMarathon', label: 'Maratón' },
];
document.getElementById('raceChips').innerHTML = DATA.racePredictions.length
  ? raceLabels.map(r => `
    <div class="chip">
      <div class="chip-label">${r.label}</div>
      <div class="chip-val num">${fmtClock(lastRace[r.key])}</div>
    </div>`).join('')
  : `<div class="track-note">Garmin todavía no ha generado una predicción — necesita más carreras registradas.</div>`;
document.getElementById('raceNote').textContent = DATA.racePredictions.length
  ? `Basado en ${DATA.racePredictions.length} día(s) de historial y tu VO2max (${fmt(DATA.vo2max.vo2MaxValue,0)}) — se refinará con cada carrera nueva.`
  : '';

// Reference run (Coach benchmark) + build-up laps from the easy run
let refHtml = '';
if (refEntry && refEntry.active_laps.length) {
  const lap = refEntry.active_laps[0];
  refHtml += `
    <div class="rr-head">
      <span class="rr-title">Última prueba de referencia (Coach)</span>
      <span class="rr-date">${fmtDateShort(refEntry.date)}</span>
    </div>
    <div class="rr-stats">
      <div><div class="v num">${fmtPace(lap.pace_sec_km)}</div><div class="l">Ritmo 1K</div></div>
      <div><div class="v num">${fmt(lap.avg_hr,0)}</div><div class="l">FC media (ppm)</div></div>
    </div>`;
}
if (buildEntry && buildEntry.active_laps.length > 1) {
  const maxPace = Math.max(...buildEntry.active_laps.map(l => l.pace_sec_km));
  const coachSteps = findCoachStepsForRun(buildEntry.date);
  const useSteps = coachSteps && coachSteps.length === buildEntry.active_laps.length;
  refHtml += `
    <div class="track-note" style="margin-top:14px;">Tramos del entreno de Coach — ${buildEntry.name} (${fmtDateShort(buildEntry.date)})</div>
    <div class="splits-bars">
      ${buildEntry.active_laps.map((l,i) => `
        <div class="sb">
          <div class="bar" style="height:${Math.max(12, l.pace_sec_km / maxPace * 56)}px;"></div>
          <div class="lab">${useSteps ? stepShortLabel(coachSteps[i]) : `Km ${i+1}`}</div>
          <div class="lab num">${fmtPace(l.pace_sec_km)}</div>
        </div>`).join('')}
    </div>`;
}
document.getElementById('refRun').innerHTML = refHtml || '<div class="track-note">Aún no hay carreras con splits registrados.</div>';

// Personal records
const pr = DATA.personalRecords;
document.getElementById('prList').innerHTML = `
  <div class="pr-item">
    <div>
      <div class="pr-label">Mejor 1K</div>
      <span class="pr-date">${pr.best_1k_date ? fmtDateShort(pr.best_1k_date) : '—'}</span>
    </div>
    <div class="pr-val num">${fmtPace(pr.best_1k_sec)}</div>
  </div>
  <div class="pr-item">
    <div>
      <div class="pr-label">Carrera más larga</div>
      <span class="pr-date">${pr.longest_run_date ? fmtDateShort(pr.longest_run_date) : '—'}</span>
    </div>
    <div class="pr-val num">${fmt((pr.longest_run_m||0)/1000, 2)} km</div>
  </div>
  <div class="track-note">Marcas cortas por ahora — el reloj lleva poco más de una semana registrando. Se irán superando a medida que avances en el plan.</div>`;

// ---------- Calendario de Coach ----------
const MONTH_ABBR = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const PLAN_BADGE = { done: 'Hecho', upcoming: 'Próximo', missed: 'Perdido' };
const SPORT_ICON = { running: '🏃', cycling: '🚴', strength_training: '🏋️' };

document.getElementById('planSub').textContent = coachPlan.length
  ? 'Entrenos planificados por Garmin Coach y si los has completado'
  : 'Garmin Coach aún no tiene entrenos programados en tu calendario';

function fmtStepDuration(step) {
  if (step.end_condition === 'time' && step.end_value) {
    const sec = step.end_value;
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = sec / 60;
    return `${Number.isInteger(min) ? min : min.toFixed(1)}'`;
  }
  if (step.end_condition === 'distance' && step.end_value) return `${(step.end_value / 1000).toFixed(1)}km`;
  if (step.end_condition === 'lap.button') return 'hasta lap';
  return '';
}
function fmtStepTarget(step) {
  if (!step.target_type) return '';
  if (step.zone_number) return ` · Z${step.zone_number}`;
  if (step.target_low && step.target_high) return ` · ${fmt(step.target_low,0)}-${fmt(step.target_high,0)}${step.target_unit || ''}`;
  return '';
}
// A block of repetitions (e.g. 8 x stride) arrives as a step with its own nested
// `steps` and an `iterations` count -- render it as "8 × (Rápido 20s + Recup. 45s)"
// instead of flattening it away or dropping the repeat count.
function stepNodeHtml(step) {
  if (step.type === 'repeat' && step.steps && step.steps.length) {
    const inner = step.steps.map(s => `${stepShortLabel(s)}${fmtStepDuration(s) ? ' ' + fmtStepDuration(s) : ''}${fmtStepTarget(s)}`).join(' + ');
    return `<span class="plan-step-chip interval">${step.iterations || '?'} × (${inner})</span>`;
  }
  const label = stepShortLabel(step);
  const dur = fmtStepDuration(step);
  const target = fmtStepTarget(step);
  const cls = step.type === 'interval' ? ' interval' : '';
  return `<span class="plan-step-chip${cls}">${label}${dur ? ' ' + dur : ''}${target}</span>`;
}
function planStepsHtml(detail, compact) {
  if (!detail || !detail.steps || !detail.steps.length) return '';
  const chips = detail.steps.map(stepNodeHtml).join('');
  return `<div class="plan-steps${compact ? ' compact' : ''}">${chips}</div>`;
}

document.getElementById('planList').innerHTML = coachPlan.length ? coachPlan.map(w => {
  const day = w.date ? w.date.slice(8, 10) : '--';
  const month = w.date ? MONTH_ABBR[parseInt(w.date.slice(5, 7), 10) - 1] : '';
  const icon = SPORT_ICON[w.sport] || '🏃';
  const detail = w.detail;
  let sub = w.sport === 'running' ? 'Carrera · Coach' : (w.sport || 'Coach');
  if (detail && detail.description) sub = detail.description;
  if (detail && detail.estimated_duration_sec) sub += ` · ${Math.round(detail.estimated_duration_sec / 60)} min`;
  if (detail && detail.estimated_distance_m) sub += ` · ${(detail.estimated_distance_m / 1000).toFixed(1)} km`;
  const hasSteps = detail && detail.steps && detail.steps.length;
  if (w.status === 'done' && w.avg_hr) {
    sub = `${fmt(w.distance_km, 1)} km · ${fmt(w.duration_min, 0)} min · ${fmt(w.avg_hr, 0)} ppm`;
  } else if (w.status === 'done') {
    sub = w.activity_name || sub;
  } else if (!hasSteps) {
    sub = 'Pendiente de concretar por Coach';
  }
  const isToday = w.date === todayStr ? ' is-today' : '';
  const steps = (w.status !== 'done' && hasSteps) ? planStepsHtml(detail) : '';
  return `
  <div class="plan-row${isToday}">
    <div class="plan-date"><div class="d num">${day}</div><div class="m">${month}</div></div>
    <div class="plan-main">
      <div class="t">${icon} ${w.title || 'Entreno'}</div>
      <div class="s">${sub}</div>
    </div>
    <span class="plan-badge ${w.status}">${PLAN_BADGE[w.status] || w.status}</span>
    ${steps}
  </div>`;
}).join('') : '<div class="track-note">Cuando Coach te programe entrenos aparecerán aquí.</div>';

// ---------- Fuerza — apoyo, no competencia ----------
const typeCounts = {};
DATA.activities.forEach(a => { typeCounts[a.type] = (typeCounts[a.type]||0) + 1; });
const catColor = { running: 'var(--cat-running)', strength_training: 'var(--cat-strength)', indoor_cycling: 'var(--cat-cycling)', yoga: 'var(--cat-yoga)', paddelball: 'var(--cat-padel)', walking: 'var(--cat-walking)' };
const catLabel = { running: 'Carrera', strength_training: 'Fuerza', indoor_cycling: 'Ciclismo', yoga: 'Yoga', paddelball: 'Pádel', walking: 'Caminar' };
const totalActs = DATA.activities.length;

document.getElementById('strengthSub').textContent =
  `${typeCounts.strength_training || 0} sesiones de fuerza y ${runCount} de carrera en los últimos ${totalActs > 0 ? Math.ceil((new Date(DATA.activities[0].date) - new Date(DATA.activities[DATA.activities.length-1].date))/86400000)+1 : 0} días`;

document.getElementById('balanceRow').innerHTML = `
  <div class="balance-item" style="flex:1 1 100%;">
    <div class="bl-head"><span class="name">Reparto de sesiones</span></div>
    <div class="balance-bar-track">
      ${Object.entries(typeCounts).map(([t,c]) => `<div class="balance-bar-seg" style="width:${c/totalActs*100}%; background:${catColor[t]||'var(--text-muted)'};" title="${catLabel[t]||t}: ${c}"></div>`).join('')}
    </div>
    <div class="legend" style="margin-top:10px;">
      ${Object.entries(typeCounts).map(([t,c]) => `<div class="li"><span class="sw" style="background:${catColor[t]||'var(--text-muted)'}"></span>${catLabel[t]||t} (${c})</div>`).join('')}
    </div>
  </div>`;

document.getElementById('strengthInsight').innerHTML = `
  <div class="insight"><div class="dot ${proximityHit ? 'warning' : 'good'}"></div><p>${
    proximityHit
      ? `Deja al menos un día entre <strong>fuerza</strong> y tus carreras de calidad para llegar con las piernas frescas.`
      : `Buen espaciado entre fuerza y carrera esta semana — sigue así de cara a las sesiones de calidad de Coach.`
  }</p></div>`;

// ---------- Training load ----------
const acute = DATA.trainingStatus.acuteTrainingLoadDTO;
document.getElementById('acwrBadgeVal').textContent = (acute.dailyTrainingLoadAcute / acute.dailyTrainingLoadChronic).toFixed(2);
const ACWR_STATUS = {
  LOW: { label: 'Bajo', cls: 'warning' },
  OPTIMAL: { label: 'Óptimo', cls: 'good' },
  HIGH: { label: 'Alto', cls: 'critical' },
  VERY_HIGH: { label: 'Muy alto', cls: 'critical' },
};
const acwrInfo = ACWR_STATUS[acute.acwrStatus] || { label: acute.acwrStatus, cls: 'good' };
const acwrBadgeEl = document.getElementById('acwrBadge');
acwrBadgeEl.textContent = acwrInfo.label;
acwrBadgeEl.className = 'badge ' + acwrInfo.cls;
document.getElementById('acuteVal').textContent = acute.dailyTrainingLoadAcute;
document.getElementById('chronicVal').textContent = acute.dailyTrainingLoadChronic;
const acMax = Math.max(acute.dailyTrainingLoadAcute, acute.dailyTrainingLoadChronic, acute.maxTrainingLoadChronic);
document.getElementById('acuteBar').style.width = (acute.dailyTrainingLoadAcute / acMax * 100) + '%';
document.getElementById('chronicBar').style.width = (acute.dailyTrainingLoadChronic / acMax * 100) + '%';

const loadRows = [
  { name: 'Aeróbico bajo', val: lb.monthlyLoadAerobicLow, min: lb.monthlyLoadAerobicLowTargetMin, max: lb.monthlyLoadAerobicLowTargetMax },
  { name: 'Aeróbico alto', val: lb.monthlyLoadAerobicHigh, min: lb.monthlyLoadAerobicHighTargetMin, max: lb.monthlyLoadAerobicHighTargetMax },
  { name: 'Anaeróbico',    val: lb.monthlyLoadAnaerobic,    min: lb.monthlyLoadAnaerobicTargetMin,    max: lb.monthlyLoadAnaerobicTargetMax },
];
const rowMax = Math.max(...loadRows.map(r => Math.max(r.val, r.max))) * 1.1;
document.getElementById('loadBars').innerHTML = loadRows.map(r => {
  const short = r.val < r.min;
  return `
  <div class="load-bar-row">
    <div class="lb-head"><span class="name">${r.name}</span><span class="val num">${fmt(r.val,0)}</span></div>
    <div class="lb-track">
      <div class="lb-target" style="left:${r.min/rowMax*100}%; width:${(r.max-r.min)/rowMax*100}%;"></div>
      <div class="lb-fill ${short ? 'short' : ''}" style="width:${r.val/rowMax*100}%;"></div>
    </div>
    <div class="lb-caption">Objetivo mensual: ${r.min}–${r.max}${short ? ' · por debajo del objetivo' : ''}</div>
  </div>`;
}).join('');

// ---------- Line charts ----------
function lineChart(title, series, unit, decimals, refValue, refLabel, fmtFn) {
  const w = 280, h = 120, padL = 8, padR = 8, padT = 14, padB = 18;
  const isValid = v => v !== null && v !== undefined && !Number.isNaN(Number(v));
  const vals = series.filter(d => isValid(d.v)).map(d => Number(d.v));
  let dataMin = vals.length ? Math.min(...vals) : 0, dataMax = vals.length ? Math.max(...vals) : 1;
  if (refValue !== undefined && refValue !== null && !Number.isNaN(refValue)) {
    dataMin = Math.min(dataMin, refValue);
    dataMax = Math.max(dataMax, refValue);
  }
  const dataRange = (dataMax - dataMin) || 1;
  const marginPad = dataRange * 0.12;
  const vMin = dataMin - marginPad, vMax = dataMax + marginPad;
  const range = (vMax - vMin) || 1;
  const x = i => padL + (i / (series.length - 1)) * (w - padL - padR);
  const y = v => padT + (1 - (v - vMin) / range) * (h - padT - padB);
  const fmtAxis = v => fmtFn ? fmtFn(v) : fmt(v, decimals);
  const fmtFull = v => fmtFn ? fmtFn(v) : fmt(v, decimals) + unit;

  // Null/undefined values break the line into separate segments ("gaps")
  // instead of being drawn as 0, so a missing week/day never fakes a dip.
  const pts = series.map((d,i) => isValid(d.v) ? [x(i), y(Number(d.v))] : null);
  const runs = [];
  let cur = [];
  pts.forEach((p,i) => { if (p) cur.push(i); else { if (cur.length) runs.push(cur); cur = []; } });
  if (cur.length) runs.push(cur);
  let linePath = '', areaPath = '';
  runs.forEach(run => {
    const seg = run.map((i,j) => (j===0?'M':'L') + pts[i][0].toFixed(1) + ',' + pts[i][1].toFixed(1)).join(' ');
    linePath += seg + ' ';
    const first = pts[run[0]], lastP = pts[run[run.length-1]];
    areaPath += seg + ` L${lastP[0].toFixed(1)},${h-padB} L${first[0].toFixed(1)},${h-padB} Z `;
  });
  const gridY = [dataMin, (dataMin+dataMax)/2, dataMax];

  const id = 'c' + Math.random().toString(36).slice(2,8);
  const lastValidIdx = [...pts.keys()].reverse().find(i => pts[i]);
  const lastPt = lastValidIdx !== undefined ? pts[lastValidIdx] : null;
  const lastVal = lastValidIdx !== undefined ? Number(series[lastValidIdx].v) : null;
  const hasRef = refValue !== undefined && refValue !== null && !Number.isNaN(refValue);
  const refY = hasRef ? y(refValue).toFixed(1) : null;

  const html = `
  <div class="chart-box">
    <div class="chart-head">
      <span class="chart-title">${title}</span>
      <span class="chart-last num">${lastVal !== null ? fmtFull(lastVal) : '—'}</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${w} ${h}" id="${id}">
        <g class="chart-grid">
          ${gridY.map(gv => `<line x1="${padL}" x2="${w-padR}" y1="${y(gv).toFixed(1)}" y2="${y(gv).toFixed(1)}"/>`).join('')}
        </g>
        ${hasRef ? `<line x1="${padL}" x2="${w-padR}" y1="${refY}" y2="${refY}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3"/>
        <text class="chart-axis-label" x="${w-padR}" y="${(Number(refY)-3).toFixed(1)}" text-anchor="end">${refLabel||'media'}</text>` : ''}
        <path class="chart-area" d="${areaPath}"/>
        <path class="chart-line" d="${linePath}"/>
        ${lastPt ? `<circle class="chart-dot-end" cx="${lastPt[0].toFixed(1)}" cy="${lastPt[1].toFixed(1)}" r="4"/>` : ''}
        ${gridY.map(gv => `<text class="chart-axis-label" x="${padL}" y="${(y(gv)-3).toFixed(1)}">${fmtAxis(gv)}</text>`).join('')}
        <line class="chart-hover-line" id="${id}-hl" x1="0" x2="0" y1="${padT}" y2="${h-padB}"/>
        <circle class="chart-hover-dot" id="${id}-hd" r="4.5"/>
      </svg>
      <div class="chart-tip" id="${id}-tip"></div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const svg = document.getElementById(id);
    const hl = document.getElementById(id+'-hl');
    const hd = document.getElementById(id+'-hd');
    const tip = document.getElementById(id+'-tip');
    svg.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * w;
      let idx = Math.round((px - padL) / (w - padL - padR) * (series.length - 1));
      idx = Math.max(0, Math.min(series.length - 1, idx));
      const d = series[idx];
      const p = pts[idx];
      hl.setAttribute('x1', x(idx)); hl.setAttribute('x2', x(idx)); hl.style.opacity = 1;
      if (p) {
        hd.setAttribute('cx', p[0]); hd.setAttribute('cy', p[1]); hd.style.opacity = 1;
        tip.textContent = `${d.date.slice(8,10)}/${d.date.slice(5,7)} · ${fmtFull(Number(d.v))}${d.extra ? ' · ' + d.extra : ''}`;
      } else {
        hd.style.opacity = 0;
        tip.textContent = `${d.date.slice(8,10)}/${d.date.slice(5,7)} · sin dato`;
      }
      tip.style.left = (x(idx) / w * 100) + '%';
      tip.style.top = (p ? p[1] : h/2) / h * 100 + '%';
      tip.style.opacity = 1;
    });
    svg.addEventListener('pointerleave', () => {
      hl.style.opacity = 0; hd.style.opacity = 0; tip.style.opacity = 0;
    });
  });

  return html;
}

const seriesDaily = dailyWithData.map(d => d);
// Body Battery end-of-day, steps and avg stress are all day-long accumulators that
// aren't final until the day ends, so an in-progress today would otherwise show as a
// misleading dip — exclude it from these trend series (unlike sleep/HRV, which are
// overnight measurements already complete by the time today's row appears).
const bbSeries = DATA.bodyBattery.filter(d => d.end_level !== null && d.end_level !== undefined && d.date !== todayStr);
const stressSeries = DATA.daily.filter(d => d.avg_stress !== '' && d.avg_stress !== undefined && d.avg_stress !== null && Number(d.avg_stress) >= 0 && d.date !== todayStr);
const stepsSeries = DATA.daily.filter(d => d.steps !== '' && d.steps !== undefined && d.steps !== null && d.date !== todayStr);
document.getElementById('trendsSub').textContent =
  `Últimos ${dailyWithData.length} días con datos de bienestar registrados (${fmtDateShort(dailyWithData[0]?.date)}–${fmtDateShort(dailyWithData[dailyWithData.length-1]?.date)})`;
const hrvBaseline = last.hrv_weekly_avg !== '' && last.hrv_weekly_avg !== undefined ? Number(last.hrv_weekly_avg) : null;
document.getElementById('charts').innerHTML =
  lineChart('Horas de sueño', seriesDaily.map(d => ({date:d.date, v:Number(d.sleep_hours)})), ' h', 1) +
  lineChart('HRV nocturno', seriesDaily.map(d => ({date:d.date, v:Number(d.hrv_avg)})), ' ms', 0, hrvBaseline, 'media 7d') +
  (bbSeries.length > 1 ? lineChart('Body Battery (fin del día)', bbSeries.map(d => ({date:d.date, v:Number(d.end_level)})), '%', 0) : '') +
  (readinessRows.length > 1 ? lineChart('Training Readiness', readinessRows.map(d => ({date:d.date, v:Number(d.training_readiness)})), '', 0) : '') +
  (stressSeries.length > 1 ? lineChart('Estrés medio', stressSeries.map(d => ({date:d.date, v:Number(d.avg_stress)})), '', 0) : '') +
  (stepsSeries.length > 1 ? lineChart('Pasos', stepsSeries.map(d => ({date:d.date, v:Number(d.steps)})), '', 0) : '');

// ---------- HR zones ----------
// Prefer the watch's own configured zone boundaries (DATA.profile.hrZoneBoundaries); fall back
// to an estimate from % of observed max HR if the profile call didn't return anything.
const MAX_HR = (DATA.profile && DATA.profile.observedMaxHr) || Math.max(...DATA.activities.map(a => Number(a.max_hr) || 0));
const ZONE_NAMES = ['Muy suave', 'Recuperación', 'Base aeróbica', 'Tempo', 'Umbral', 'Máximo'];
let ZONE_BOUNDS;
let zonesAreReal = false;
if (DATA.profile && Array.isArray(DATA.profile.hrZoneBoundaries) && DATA.profile.hrZoneBoundaries.length === 5) {
  ZONE_BOUNDS = DATA.profile.hrZoneBoundaries.map(z => z.low);
  zonesAreReal = true;
} else {
  ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9].map(p => Math.round(p * MAX_HR));
}
function hrZone(hr) {
  if (!hr) return null;
  let z = 0;
  ZONE_BOUNDS.forEach((b, i) => { if (hr >= b) z = i + 1; });
  return z;
}
function zoneBadge(z) {
  if (z === null) return '<span class="zone z0">—</span>';
  return `<span class="zone z${z}" title="${ZONE_NAMES[z]}">${z === 0 ? '&lt;Z1' : 'Z' + z}</span>`;
}
function dominantZoneFromReal(hrZones) {
  if (!hrZones || !hrZones.length) return null;
  let best = hrZones[0];
  hrZones.forEach(z => { if ((z.secs||0) > (best.secs||0)) best = z; });
  return best.secs > 0 ? best.zone : null;
}
const ZONE_COLORS = ['var(--text-muted)', '#7a8fa6', 'var(--accent)', '#1baf7a', '#e07a1f', 'var(--critical)'];
function realZoneBar(hrZones) {
  if (!hrZones || !hrZones.length) return '';
  const total = hrZones.reduce((s,z) => s + (z.secs||0), 0);
  if (!total) return '';
  return `<div class="act-zonebar">${hrZones.map(z => {
    const pct = (z.secs||0) / total * 100;
    if (pct <= 0) return '';
    return `<div class="seg" style="width:${pct}%; background:${ZONE_COLORS[z.zone] || ZONE_COLORS[0]};" title="Z${z.zone}: ${Math.round(z.secs/60)} min"></div>`;
  }).join('')}</div>`;
}

// ---------- Training effect label colors ----------
const TE_COLOR = {
  'Sin efecto': 'var(--text-muted)', 'Mínimo': 'var(--text-muted)', 'Mantiene': 'var(--accent)',
  'Mejora': 'var(--good)', 'Mejora mucho': 'var(--good)', 'Sobrecarga': 'var(--critical)',
};

// ---------- Activity list ----------
function wasIntendedEasy(a) {
  return /suave|f[aá]cil|\bz1\b|\bz2\b/i.test(a.name || '');
}
// Matches RUN_CADENCE_THRESHOLD in fetch_garmin_data.py: below this (already-doubled,
// total steps/min) cadence, a chart sample is treated as walking rather than running.
const RUN_CADENCE_THRESHOLD_JS = 130;
function buildGlucoseChart(a) {
  const gc = a.glucose_chart;
  if (!gc || !gc.series || gc.series.length < 2) return '';
  const w = chartContainerWidth(), h = 150, padL = 32, padR = 10, padT = 10, padB = 18;
  const duration = gc.duration_min || 0;
  const tMin = -30, tMax = duration + 120;
  const span = (tMax - tMin) || 1;
  const x = t => padL + ((t - tMin) / span) * (w - padL - padR);

  const RANGE_LOW = 70, RANGE_HIGH = 180;
  const series = decimateArray(gc.series.slice().sort((p1,p2) => p1.t - p2.t), 300);
  const vals = series.map(p => p.value_mgdl);
  const yMin = Math.min(...vals, RANGE_LOW - 10);
  const yMax = Math.max(...vals, RANGE_HIGH + 10);
  const y = v => padT + (1 - (v - yMin) / ((yMax - yMin) || 1)) * (h - padT - padB);

  const bandTop = y(Math.min(RANGE_HIGH, yMax));
  const bandBot = y(Math.max(RANGE_LOW, yMin));
  const bandSvg = `<rect x="${padL}" y="${bandTop.toFixed(1)}" width="${w-padL-padR}" height="${(bandBot-bandTop).toFixed(1)}" fill="var(--good)" opacity="0.10"/>`;
  const refSvg = [RANGE_LOW, RANGE_HIGH].map(v => `<line x1="${padL}" x2="${w-padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3"/><text x="${(padL-4).toFixed(1)}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${v}</text>`).join('');
  const yTicks = [yMin, yMin + (yMax-yMin)*0.5, yMax].filter(v => Math.abs(v-RANGE_LOW) > 8 && Math.abs(v-RANGE_HIGH) > 8);
  const yAxisSvg = yTicks.map(v => `<text x="${(padL-4).toFixed(1)}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${fmt(v,0)}</text>`).join('');

  const actX0 = x(0), actX1 = x(duration);
  const actSvg = `<rect x="${actX0.toFixed(1)}" y="${padT}" width="${(actX1-actX0).toFixed(1)}" height="${h-padT-padB}" fill="var(--accent)" opacity="0.1"/>`;

  let path = '';
  series.forEach(p => { path += `${path===''?'M':'L'}${x(p.t).toFixed(1)},${y(p.value_mgdl).toFixed(1)} `; });
  const lineSvg = `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>`;

  const dots = [];
  if (gc.start) dots.push({ ...gc.start, t: 0, label: 'Inicio' });
  if (gc.end) dots.push({ ...gc.end, t: duration, label: 'Fin' });
  if (gc.post_2h) dots.push({ ...gc.post_2h, t: duration + 120, label: '+2h' });
  const duringActivity = series.filter(p => p.t >= 0 && p.t <= duration);
  if (duringActivity.length) {
    const minPt = duringActivity.reduce((b,p) => p.value_mgdl < b.value_mgdl ? p : b, duringActivity[0]);
    if (!dots.some(d => d.t === minPt.t)) dots.push({ value_mgdl: minPt.value_mgdl, time: minPt.time, t: minPt.t, label: 'Mínimo' });
  }
  // Stagger labels that sit close together on the X axis (e.g. "Mínimo" landing right
  // next to "Fin") so their value text doesn't overlap into an unreadable smear.
  const dotLabelOffset = new Map();
  let prevX = -Infinity, prevLevel = 0;
  dots.slice().sort((d1,d2) => d1.t - d2.t).forEach(d => {
    const cx = x(d.t);
    const level = (cx - prevX < 26) ? prevLevel + 1 : 0;
    dotLabelOffset.set(d, level);
    prevX = cx; prevLevel = level;
  });
  const dotsSvg = dots.map(d => {
    const color = d.label === 'Mínimo' ? (d.value_mgdl < RANGE_LOW ? 'var(--critical)' : 'var(--warning)') : 'var(--accent)';
    const cx = x(d.t);
    const yOff = 8 + (dotLabelOffset.get(d) || 0) * 10;
    return `<circle cx="${cx.toFixed(1)}" cy="${y(d.value_mgdl).toFixed(1)}" r="4" fill="var(--surface-card)" stroke="${color}" stroke-width="2"/><text x="${cx.toFixed(1)}" y="${(y(d.value_mgdl)-yOff).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-secondary)">${fmt(d.value_mgdl,0)}</text>`;
  }).join('');

  const xTicks = [];
  const xStep = span > 180 ? 60 : 30;
  for (let t = Math.ceil(tMin/xStep)*xStep; t <= tMax + 0.01; t += xStep) xTicks.push(t);
  const xAxisSvg = xTicks.map(t => `<text x="${x(t).toFixed(1)}" y="${h-4}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${t===0?'inicio':(t>0?'+':'')+Math.round(t)+"'"}</text>`).join('');

  const legendBits = [
    `<span><span class="sw" style="background:var(--accent)"></span>Glucosa</span>`,
    `<span><span class="sw" style="background:var(--good);opacity:.3"></span>Rango objetivo 70–180</span>`,
    `<span><span class="sw" style="background:var(--accent);opacity:.3"></span>Durante la actividad</span>`,
  ];
  const dotCaption = dots.map(d => `${d.label}: ${fmt(d.value_mgdl,0)} mg/dL${d.time ? ' (' + d.time + ')' : ''}`).join(' · ');

  const chartId = 'gc' + Math.random().toString(36).slice(2,8);
  const html = `<div class="act-chart-wrap">
    <div class="act-chart-info" id="${chartId}-tip">Pasa el cursor o el dedo por el gráfico para ver cada lectura</div>
    <svg viewBox="0 0 ${w} ${h}" id="${chartId}">
      ${bandSvg}${refSvg}${actSvg}${lineSvg}${yAxisSvg}${xAxisSvg}${dotsSvg}
      <line class="chart-hover-line" id="${chartId}-hl" x1="0" x2="0" y1="${padT}" y2="${h-padB}"/>
      <circle class="chart-hover-dot" id="${chartId}-hd" r="4"/>
    </svg>
    <div class="act-chart-legend">${legendBits.join('')}</div>
    ${dotCaption ? `<div class="activity-glucose">🩸 ${dotCaption}</div>` : ''}
    ${gc.partial ? `<div class="act-detail-empty" style="margin-top:4px;">Datos parciales — faltan lecturas de glucosa en parte de este tramo (se completará en próximas sincronizaciones).</div>` : ''}
  </div>`;

  requestAnimationFrame(() => {
    const svg = document.getElementById(chartId);
    if (!svg) return;
    const hl = document.getElementById(chartId+'-hl');
    const hd = document.getElementById(chartId+'-hd');
    const tip = document.getElementById(chartId+'-tip');
    svg.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width * w;
      let best = series[0], bestDiff = Infinity;
      series.forEach(p => { const diff = Math.abs(x(p.t) - relX); if (diff < bestDiff) { bestDiff = diff; best = p; } });
      const cx = x(best.t), cy = y(best.value_mgdl);
      hl.setAttribute('x1', cx); hl.setAttribute('x2', cx); hl.style.opacity = 1;
      hd.setAttribute('cx', cx); hd.setAttribute('cy', cy); hd.style.opacity = 1;
      tip.textContent = `${best.time} · ${fmt(best.value_mgdl,0)} mg/dL`;
    });
    svg.addEventListener('pointerleave', () => {
      hl.style.opacity = 0; hd.style.opacity = 0;
      tip.textContent = 'Pasa el cursor o el dedo por el gráfico para ver cada lectura';
    });
  });

  return html;
}

function fmtHMS(totalSec) {
  if (!totalSec) return '0:00';
  const s = Math.round(totalSec);
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function findRecoveryForDate(dateStr) {
  const row = DATA.daily.find(d => d.date === dateStr);
  if (!row || row.recovery_time_minutes === '' || row.recovery_time_minutes === undefined || row.recovery_time_minutes === null) return null;
  return Number(row.recovery_time_minutes);
}
function findPreviousSameType(a) {
  const idx = DATA.activities.findIndex(x => x.activity_id === a.activity_id);
  if (idx === -1) return null;
  const older = DATA.activities.slice(idx + 1).filter(x => x.type === a.type);
  if (!older.length) return null;
  if (a.type === 'running') {
    const easy = wasIntendedEasy(a);
    return older.find(x => wasIntendedEasy(x) === easy) || older[0];
  }
  if (a.type === 'strength_training') {
    // Only a session of the SAME push/pull/leg type counts as comparable — no
    // fallback to "whatever strength session came before" when types differ.
    return older.find(x => x.session_type === a.session_type) || null;
  }
  return older[0];
}
function strengthComparisonHtml(a) {
  const prev = findPreviousSameType(a);
  if (!prev) return '';
  const prevByName = {};
  (prev.exercises || []).forEach(e => { prevByName[e.name] = e; });
  const rows = (a.exercises || []).filter(e => e.best_set).map(e => {
    const pe = prevByName[e.name];
    if (!pe || !pe.best_set) return null;
    const weightDiff = e.best_set.weight_kg - pe.best_set.weight_kg;
    const repsDiff = e.best_set.reps - pe.best_set.reps;
    const diff = weightDiff !== 0 ? weightDiff : repsDiff;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '＝';
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
    const pr = e.is_pr ? ' 🏆' : '';
    return `<div>${e.display_name} ${fmt(pe.best_set.weight_kg,1)}×${pe.best_set.reps} → ${fmt(e.best_set.weight_kg,1)}×${e.best_set.reps} <span class="${cls}">${arrow}</span>${pr}</div>`;
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<div class="act-compare">vs. último "${prev.session_type}" (${fmtDateShort(prev.date)}):${rows.join('')}</div>`;
}
function activityComparisonHtml(a) {
  const prev = findPreviousSameType(a);
  if (!prev) return '';
  const bits = [];
  const hrA = Number(a.avg_hr), hrP = Number(prev.avg_hr);
  if (a.avg_hr && prev.avg_hr) {
    const diff = Math.round(hrA - hrP);
    if (diff !== 0) bits.push(`<span class="${diff<=0?'up':'down'}">${diff>0?'+':''}${diff} ppm de media</span>`);
  }
  if (a.type === 'running' && a.pace_sec_km && prev.pace_sec_km) {
    const diff = Math.round(a.pace_sec_km - prev.pace_sec_km);
    if (diff !== 0) {
      const mm = Math.floor(Math.abs(diff)/60), ss = Math.abs(diff)%60;
      bits.push(`<span class="${diff<=0?'up':'down'}">${diff>0?'+':'−'}${mm}:${String(ss).padStart(2,'0')}/km</span>`);
    }
  } else if (a.duration_min && prev.duration_min) {
    const diff = Math.round(a.duration_min - prev.duration_min);
    if (diff !== 0) bits.push(`<span>${diff>0?'+':''}${diff} min</span>`);
  }
  if (a.rpe !== '' && a.rpe != null && prev.rpe !== '' && prev.rpe != null) {
    const diff = Number(a.rpe) - Number(prev.rpe);
    if (diff !== 0) bits.push(`<span class="${diff<=0?'up':'down'}">${diff>0?'+':''}${diff.toFixed(0)} esfuerzo</span>`);
  }
  if (!bits.length) return '';
  return `<div class="act-compare">vs. último "${prev.name}" (${fmtDateShort(prev.date)}): ${bits.join(' · ')}</div>`;
}
function fastestSlowestSplit(splits) {
  const full = (splits || []).filter(s => !s.partial && s.pace_sec_km);
  if (!full.length) return { fastest: null, slowest: null };
  let fastest = full[0], slowest = full[0];
  full.forEach(s => { if (s.pace_sec_km < fastest.pace_sec_km) fastest = s; if (s.pace_sec_km > slowest.pace_sec_km) slowest = s; });
  return { fastest, slowest };
}
function bearingDeg(lat0, lon0, lat1, lon1) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(lon1 - lon0)) * Math.cos(toRad(lat1));
  const x = Math.cos(toRad(lat0)) * Math.sin(toRad(lat1)) - Math.sin(toRad(lat0)) * Math.cos(toRad(lat1)) * Math.cos(toRad(lon1 - lon0));
  let brg = Math.atan2(y, x) * 180 / Math.PI;
  if (brg < 0) brg += 360;
  return brg;
}
function routeAvgBearingDeg(route) {
  // Distance-weighted average heading over the whole route (vector mean of each
  // segment's bearing), so a curved or looping route still gets one representative
  // "direction you were mostly facing" instead of just the start→end straight line.
  if (!route || route.length < 2) return null;
  let sx = 0, sy = 0, totalW = 0;
  for (let i = 1; i < route.length; i++) {
    const [lat0, lon0, , dist0] = route[i-1];
    const [lat1, lon1, , dist1] = route[i];
    if (lat0 === lat1 && lon0 === lon1) continue;
    const segDist = (dist1 != null && dist0 != null) ? (dist1 - dist0) : null;
    const w = (segDist && segDist > 0) ? segDist : 1;
    const brg = bearingDeg(lat0, lon0, lat1, lon1);
    sx += w * Math.sin(brg * Math.PI / 180);
    sy += w * Math.cos(brg * Math.PI / 180);
    totalW += w;
  }
  if (totalW === 0) return null;
  let avg = Math.atan2(sx, sy) * 180 / Math.PI;
  if (avg < 0) avg += 360;
  return avg;
}
const COMPASS_POINTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function degToCompass(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '';
  const idx = (Math.round(deg / 22.5) % 16 + 16) % 16;
  return COMPASS_POINTS[idx];
}
function windEffectLabel(a) {
  // windDirection from Garmin's weather API is the meteorological "from" bearing
  // (e.g. 0 = wind coming FROM the north), so it blows TOWARD (dir + 180).
  if (a.wind_dir_deg === undefined || a.wind_dir_deg === null || !a.wind_speed_kmh) return '';
  const heading = routeAvgBearingDeg(a.route);
  if (heading === null) return '';
  const towardDeg = (a.wind_dir_deg + 180) % 360;
  const rel = Math.abs(((towardDeg - heading + 540) % 360) - 180); // 0 = pure tailwind, 180 = pure headwind
  const component = Math.abs(a.wind_speed_kmh * Math.cos(rel * Math.PI / 180));
  if (rel <= 50) return `De cola — empujando ~${fmt(component,0)} km/h`;
  if (rel >= 130) return `De cara — frenando ~${fmt(component,0)} km/h`;
  return `Lateral — poco efecto directo`;
}
function summaryGridHtml(a) {
  const stats = [];
  const isStrength = a.type === 'strength_training';
  const push = (label, value) => { if (value !== null && value !== undefined && value !== '') stats.push([label, value]); };

  if (a.distance_km > 0) push('Distancia', fmt(a.distance_km,2) + ' km');
  push('Tiempo total', fmt(a.duration_min,0) + ' min');

  const standMin = (a.stand_sec || 0) / 60;
  const movingMin = a.duration_min - standMin;
  if (standMin >= 1 && movingMin > 0) {
    push('Tiempo en movimiento', fmt(movingMin,0) + ' min');
    if (a.distance_km > 0) push('Ritmo en movimiento', fmtPace(movingMin * 60 / a.distance_km));
  }
  if (a.pace_sec_km) push('Ritmo medio', fmtPace(a.pace_sec_km));
  const { fastest } = fastestSlowestSplit(a.km_splits);
  if (fastest) push('Mejor km', `Km ${fastest.km} a ${fmtPace(fastest.pace_sec_km)}`);

  if (a.avg_hr) push('FC media', fmt(a.avg_hr,0) + ' ppm');
  if (a.max_hr) push('FC máxima', fmt(a.max_hr,0) + ' ppm');

  if (a.hr_zones && a.hr_zones.length && !isStrength) {
    const total = a.hr_zones.reduce((s,z) => s + (z.secs||0), 0);
    if (total > 0) a.hr_zones.forEach(z => push(`Tiempo en Z${z.zone}`, fmt((z.secs||0)/total*100,0) + '%'));
  }

  if (a.elevation_gain_m !== undefined && a.elevation_gain_m !== null && a.elevation_gain_m !== '') push('Desnivel +', fmt(a.elevation_gain_m,0) + ' m');
  if (a.elevation_loss_m !== undefined && a.elevation_loss_m !== null && a.elevation_loss_m !== '') push('Desnivel −', fmt(a.elevation_loss_m,0) + ' m');

  if (a.avg_cadence_running) {
    const totalDiffers = a.avg_cadence_total && Math.round(a.avg_cadence_total) !== Math.round(a.avg_cadence_running);
    push('Cadencia media', fmt(a.avg_cadence_running,0) + ' spm' + (totalDiffers ? ` (total ${fmt(a.avg_cadence_total,0)})` : ''));
  } else if (a.cadence_spm) {
    push('Cadencia media', fmt(a.cadence_spm,0) + ' spm');
  }
  if (a.stride_length_cm) push('Zancada', fmt(a.stride_length_cm/100,2) + ' m');

  if (a.avg_power_w) push('Potencia media', fmt(a.avg_power_w,0) + ' W');
  if (a.max_power_w) push('Potencia máx.', fmt(a.max_power_w,0) + ' W');

  if (a.hr_drift_pct !== undefined && a.hr_drift_pct !== null && a.hr_drift_pct !== '') push('Deriva cardíaca', (a.hr_drift_pct > 0 ? '+' : '') + fmt(a.hr_drift_pct,1) + '%');

  if (a.temp_c !== undefined && a.temp_c !== null && a.temp_c !== '') push('Temperatura', fmt(a.temp_c,0) + ' °C');
  const hasHourlyWind = a.wind_hourly && a.wind_hourly.length > 0;
  if (a.wind_speed_kmh !== undefined && a.wind_speed_kmh !== null) {
    push(hasHourlyWind ? 'Viento (Garmin)' : 'Viento', fmt(a.wind_speed_kmh,0) + ' km/h' + (a.wind_dir_compass ? ` del ${a.wind_dir_compass}` : '') + (a.wind_gust_kmh ? ` (ráfagas ${fmt(a.wind_gust_kmh,0)})` : ''));
    const effect = windEffectLabel(a);
    if (effect) push('Efecto del viento', effect);
  }
  if (hasHourlyWind) {
    // Only for activities long enough to plausibly see the wind shift (see
    // LONG_ACTIVITY_WIND_MIN in fetch_garmin_data.py) — an independent hour-by-hour
    // reading from Open-Meteo, shown next to Garmin's own single snapshot above so
    // they can be compared rather than silently replacing one with the other.
    a.wind_hourly.forEach(h => {
      if (h.wind_speed_kmh === null || h.wind_speed_kmh === undefined) return;
      const compass = degToCompass(h.wind_dir_deg);
      push(`Viento ${h.hour}`, fmt(h.wind_speed_kmh,0) + ' km/h' + (compass ? ` del ${compass}` : '') + (h.wind_gust_kmh ? ` (ráfagas ${fmt(h.wind_gust_kmh,0)})` : ''));
    });
  }

  if (a.training_load && !isStrength) push('Carga', fmt(a.training_load,0));
  if (!isStrength && a.training_effect_aerobic !== undefined && a.training_effect_aerobic !== null && a.training_effect_aerobic !== '') push('TE aeróbico', fmt(a.training_effect_aerobic,1) + (a.te_aerobic_label ? ' · ' + a.te_aerobic_label : ''));
  if (!isStrength && a.training_effect_anaerobic !== undefined && a.training_effect_anaerobic !== null && a.training_effect_anaerobic !== '') push('TE anaeróbico', fmt(a.training_effect_anaerobic,1) + (a.te_anaerobic_label ? ' · ' + a.te_anaerobic_label : ''));

  if (isStrength) {
    // Match the collapsed row's "series" figure exactly (effective sets, not
    // Garmin's raw num_sets which also counts warm-ups) and add the raw count
    // alongside it so the two numbers are never seen in conflict.
    if (a.effective_sets_total !== undefined && a.effective_sets_total !== null) {
      const totalSets = (a.exercises||[]).reduce((s,e) => s + (e.sets||[]).length, 0);
      push('Series', `${fmt(a.effective_sets_total,0)} efectivas${totalSets ? ` (${totalSets} registradas)` : ''}`);
    }
    if (a.active_sec) push('Tiempo activo', fmtHMS(a.active_sec));
    if (a.rest_sec) push('Descanso entre series', fmtHMS(a.rest_sec));
    if (a.avg_hr_during_sets) push('FC media en series', fmt(a.avg_hr_during_sets,0) + ' ppm');
  }

  if (!isStrength) {
    const recovery = findRecoveryForDate(a.date);
    if (recovery !== null) push('Recuperación (ese día)', fmtRecoveryMinutes(recovery));
  }

  if (!stats.length) return '';
  const tiles = stats.map(([l,v]) => `<div class="act-detail-stat"><div class="rl">${l}</div><div class="rv num">${v}</div></div>`).join('');
  return `<details class="act-summary-details">
    <summary>Métricas detalladas (${stats.length})</summary>
    <div class="act-detail-grid compact">${tiles}</div>
  </details>`;
}
function kmSplitsTableHtml(a) {
  const splits = a.km_splits || [];
  if (!splits.length) return '';
  const { fastest, slowest } = fastestSlowestSplit(splits);
  const hasElev = splits.some(s => s.elev_net_m !== undefined && s.elev_net_m !== null);
  const rows = splits.map(s => {
    const kmLabel = s.partial ? `${fmt((s.distance_m||0)/1000,2)} km` : `${s.km}`;
    const rowCls = s === fastest ? ' split-fastest' : s === slowest ? ' split-slowest' : '';
    const elevCell = hasElev ? `<td class="num">${s.elev_net_m != null ? (s.elev_net_m > 0 ? '+' : '') + fmt(s.elev_net_m,0) + ' m' : '—'}</td>` : '';
    return `<tr class="${rowCls.trim()}">
      <td>${kmLabel}</td>
      <td class="num">${s.pace_sec_km ? fmtPace(s.pace_sec_km) : '—'}</td>
      <td class="num">${s.avg_hr ? fmt(s.avg_hr,0) : '—'}</td>
      <td class="num">${s.avg_cadence ? fmt(s.avg_cadence,0) : '—'}</td>
      ${elevCell}
    </tr>`;
  }).join('');
  return `<div class="act-splits-wrap"><table class="act-splits">
    <thead><tr><th>Km</th><th>Ritmo</th><th>FC media</th><th>Cadencia</th>${hasElev ? '<th>Desnivel</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}
function decimateArray(arr, maxPts) {
  if (!arr || arr.length <= maxPts) return arr;
  const n = arr.length, step = (n - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
}
function decimateChart(chart, maxPts) {
  if (!chart || !chart.t || chart.t.length <= maxPts) return chart;
  const n = chart.t.length, step = (n - 1) / (maxPts - 1);
  const idxs = Array.from({ length: maxPts }, (_, i) => Math.round(i * step));
  const pick = arr => (arr ? idxs.map(i => arr[i]) : arr);
  return { t: pick(chart.t), hr: pick(chart.hr), pace_sec_km: pick(chart.pace_sec_km), cadence: pick(chart.cadence), elevation_m: pick(chart.elevation_m), speed_kmh: pick(chart.speed_kmh) };
}
function cumulativeDistanceKm(chart) {
  const n = chart.t.length;
  const dist = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dtH = (chart.t[i] - chart.t[i-1]) / 3600;
    const v0 = chart.speed_kmh ? chart.speed_kmh[i-1] : null, v1 = chart.speed_kmh ? chart.speed_kmh[i] : null;
    const avgV = (v0 != null && v1 != null) ? (v0+v1)/2 : (v0 != null ? v0 : (v1 != null ? v1 : 0));
    dist[i] = dist[i-1] + avgV * dtH;
  }
  return dist;
}
function nearestRouteIndexByDist(route, distKm) {
  if (!route || !route.length) return -1;
  const targetM = distKm * 1000;
  let best = 0, bestDiff = Infinity;
  route.forEach((p,i) => {
    if (p[3] === null || p[3] === undefined) return;
    const diff = Math.abs(p[3] - targetM);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}
function niceTicks(min, max, maxCount, steps) {
  const range = (max - min) || 1;
  const rawStep = range / maxCount;
  const step = steps.find(s => s >= rawStep) || steps[steps.length - 1];
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}
function chartContainerWidth() {
  // SVGs here use viewBox="0 0 w h" + CSS width:100%, so 1 user-unit renders at
  // (real css px width / w) px. On narrow screens w=600 made that ratio ~0.55,
  // shrinking every font-size inside the chart well below its nominal value. Sizing
  // w to the actual rendered width instead keeps 1 user-unit ≈ 1 real px everywhere.
  const el = document.getElementById('actList');
  const cw = el && el.clientWidth;
  if (!cw) return 600;
  const narrow = cw <= 480;
  return Math.max(260, cw - 28 - (narrow ? 0 : 46)); // .act-item padding + .act-detail indent
}
function buildActivityAnalysis(a) {
  const chart = decimateChart(a.chart, 300);
  if (!chart || !chart.t || chart.t.length < 2) return '';
  const hrVals = chart.hr.filter(v => v !== null);
  if (!hrVals.length) return '';

  const n = chart.t.length;
  const tMaxMin = chart.t[n-1] / 60 || 1;
  const w = chartContainerWidth(), h = 190, padL = 36, padR = 36, padT = 14, padB = 24;
  const x = i => padL + (chart.t[i] / 60 / tMaxMin) * (w - padL - padR);
  const xAtMin = mins => padL + (mins / tMaxMin) * (w - padL - padR);

  // ---- FC axis (izquierda) — ajustado al rango REAL de FC de esta actividad, no a
  // los límites de las zonas (que podían forzar el eje hasta 200 ppm aunque nunca se
  // llegara a esa zona). Las bandas de zona se recortan igualmente al rango visible.
  const hrMin = Math.min(...hrVals) - 6;
  const hrMax = Math.max(...hrVals) + 8;
  const yHr = v => padT + (1 - (v - hrMin) / ((hrMax - hrMin) || 1)) * (h - padT - padB);
  const hrTicks = niceTicks(hrMin, hrMax, 4, [5,10,15,20,25,50,100]);

  // ---- Ritmo (derecha, invertido: más rápido arriba), recortando paradas/outliers ----
  const PACE_CAP = 900; // 15:00/km
  const isRun = a.type === 'running';
  const paceVals = (isRun && chart.pace_sec_km) ? chart.pace_sec_km.filter(v => v !== null && v <= PACE_CAP) : [];
  const havePace = paceVals.length > 1;
  let yPace = null, paceTicks = [];
  if (havePace) {
    const pMin = Math.min(...paceVals), pMax = Math.max(...paceVals);
    const pSpan = (pMax - pMin) || 1;
    yPace = v => padT + ((Math.min(v, PACE_CAP) - pMin) / pSpan) * (h - padT - padB);
    paceTicks = niceTicks(pMin, pMax, 4, [15,30,60,120,300,600]);
  }

  // ---- Bandas de zona FC + etiquetas Z1..Z5 en el margen (no para fuerza: el
  // concepto de zona de carrera no aplica, solo interesa la línea y la media) ----
  const bandBounds = [hrMin, ZONE_BOUNDS[0], ZONE_BOUNDS[1], ZONE_BOUNDS[2], ZONE_BOUNDS[3], ZONE_BOUNDS[4], hrMax];
  let bandsSvg = '', zoneLabelsSvg = '';
  if (a.type !== 'strength_training') {
    for (let z = 0; z < 6; z++) {
      const lo = Math.max(bandBounds[z], hrMin), hi = Math.min(bandBounds[z+1], hrMax);
      if (hi <= lo) continue;
      const yTop = yHr(hi), yBot = yHr(lo);
      bandsSvg += `<rect x="${padL}" y="${yTop.toFixed(1)}" width="${w-padL-padR}" height="${(yBot-yTop).toFixed(1)}" fill="${ZONE_COLORS[z]}" opacity="0.1"/>`;
      if (z >= 1 && (yBot - yTop) > 9) zoneLabelsSvg += `<text x="${padL+3}" y="${((yTop+yBot)/2+3).toFixed(1)}" font-size="8" fill="var(--text-muted)">Z${z}</text>`;
    }
  }

  let walkSvg = '';
  if (isRun && chart.cadence) {
    let segStart = null;
    for (let i = 0; i < n; i++) {
      const walking = chart.cadence[i] !== null && chart.cadence[i] < RUN_CADENCE_THRESHOLD_JS;
      if (walking && segStart === null) segStart = i;
      if (!walking && segStart !== null) {
        walkSvg += `<rect x="${x(segStart).toFixed(1)}" y="${padT}" width="${(x(i)-x(segStart)).toFixed(1)}" height="${h-padT-padB}" fill="var(--text-muted)" opacity="0.14"/>`;
        segStart = null;
      }
    }
    if (segStart !== null) walkSvg += `<rect x="${x(segStart).toFixed(1)}" y="${padT}" width="${(x(n-1)-x(segStart)).toFixed(1)}" height="${h-padT-padB}" fill="var(--text-muted)" opacity="0.14"/>`;
  }

  let hrPath = '';
  chart.hr.forEach((v,i) => { if (v === null) return; hrPath += `${hrPath===''?'M':'L'}${x(i).toFixed(1)},${yHr(v).toFixed(1)} `; });

  let paceSvg = '';
  if (havePace) {
    let path = '', open = false;
    chart.pace_sec_km.forEach((v,i) => {
      if (v === null || v > PACE_CAP) { open = false; return; }
      path += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${yPace(v).toFixed(1)} `;
      open = true;
    });
    paceSvg = `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>`;
  }

  let avgHrSvg = '';
  if (a.avg_hr) {
    const yAvg = yHr(Number(a.avg_hr));
    avgHrSvg = `<line x1="${padL}" x2="${w-padR}" y1="${yAvg.toFixed(1)}" y2="${yAvg.toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${w-padR}" y="${(yAvg-3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-secondary)">media ${fmt(a.avg_hr,0)}</text>`;
  }

  const xStep = tMaxMin <= 25 ? 5 : 10;
  let xAxisSvg = '';
  for (let m = 0; m <= tMaxMin + 0.01; m += xStep) {
    const xp = xAtMin(m);
    xAxisSvg += `<line x1="${xp.toFixed(1)}" x2="${xp.toFixed(1)}" y1="${h-padB}" y2="${h-padB+3}" stroke="var(--text-muted)"/><text x="${xp.toFixed(1)}" y="${h-4}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${Math.round(m)}'</text>`;
  }
  const hrAxisSvg = hrTicks.map(v => `<text x="${(padL-4).toFixed(1)}" y="${(yHr(v)+3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${v}</text>`).join('');
  const paceAxisSvg = havePace ? paceTicks.map(v => `<text x="${(w-padR+4).toFixed(1)}" y="${(yPace(v)+3).toFixed(1)}" font-size="10" fill="var(--text-muted)">${fmtPace(v).replace('/km','')}</text>`).join('') : '';

  const legendBits = [`<span><span class="sw" style="background:var(--critical)"></span>FC (ppm)</span>`];
  if (havePace) legendBits.push(`<span><span class="sw" style="background:var(--accent)"></span>Ritmo (min/km)</span>`);
  if (walkSvg) legendBits.push(`<span><span class="sw" style="background:var(--text-muted);opacity:.5"></span>Caminando / parado</span>`);

  const chartId = 'ac' + Math.random().toString(36).slice(2,8);
  const mainChartSvg = `<svg viewBox="0 0 ${w} ${h}" id="${chartId}">
      ${bandsSvg}${zoneLabelsSvg}${walkSvg}${avgHrSvg}${paceSvg}
      <path d="${hrPath}" fill="none" stroke="var(--critical)" stroke-width="2" stroke-linecap="round"/>
      ${hrAxisSvg}${paceAxisSvg}${xAxisSvg}
      <line class="chart-hover-line" id="${chartId}-hl" x1="0" x2="0" y1="${padT}" y2="${h-padB}"/>
      <circle class="chart-hover-dot" id="${chartId}-hrd" r="4"/>
      ${havePace ? `<circle class="chart-hover-dot" id="${chartId}-pad" r="4"/>` : ''}
    </svg>`;

  // ---- Perfil de altitud (mismo eje X, sincronizado) ----
  const elevVals = (chart.elevation_m || []).filter(v => v !== null);
  const haveAlt = elevVals.length > 1 && a.type !== 'strength_training';
  const hAlt = 60, padTAlt = 6, padBAlt = 4;
  let altBlock = '';
  if (haveAlt) {
    const eMin = Math.min(...elevVals), eMax = Math.max(...elevVals);
    const yAlt = v => padTAlt + (1 - (v - eMin) / ((eMax - eMin) || 1)) * (hAlt - padTAlt - padBAlt);
    let linePath = '';
    chart.elevation_m.forEach((v,i) => { if (v === null) return; linePath += `${linePath===''?'M':'L'}${x(i).toFixed(1)},${yAlt(v).toFixed(1)} `; });
    const areaPath = linePath + ` L${x(n-1).toFixed(1)},${hAlt-padBAlt} L${x(0).toFixed(1)},${hAlt-padBAlt} Z`;
    altBlock = `<div class="act-alt-wrap">
      <svg viewBox="0 0 ${w} ${hAlt}" id="${chartId}-alt">
        <path d="${areaPath}" fill="var(--text-muted)" opacity="0.14"/>
        <path d="${linePath}" fill="none" stroke="var(--text-secondary)" stroke-width="1.5"/>
        <line class="chart-hover-line" id="${chartId}-alt-hl" x1="0" x2="0" y1="${padTAlt}" y2="${hAlt-padBAlt}"/>
        <circle class="chart-hover-dot" id="${chartId}-alt-d" r="3.5"/>
      </svg>
      <div class="act-alt-label">${fmt(eMin,0)}–${fmt(eMax,0)} m</div>
    </div>`;
  }

  // ---- Mapa de ruta (sincronizado por distancia) ----
  const route = decimateArray(a.route, 300);
  const hasRoute = route && route.length > 1 && (a.type === 'running' || a.type === 'walking');
  let routeBlock = '', routeCtx = null;
  if (hasRoute) {
    const lats = route.map(p=>p[0]), lons = route.map(p=>p[1]);
    const latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
    // Same reasoning as chartContainerWidth() elsewhere: size the viewBox to the
    // actual rendered width so the map fills the card like the other charts instead
    // of sitting fixed-small, and so in-SVG text doesn't shrink on narrow phones.
    const rw = chartContainerWidth(), rh = Math.round(rw * 220 / 320), pad = 16;
    const latMid = (latMin + latMax) / 2;
    const lonAspect = Math.cos(latMid * Math.PI / 180) || 1;
    const spanLon = Math.max((lonMax - lonMin) * lonAspect, 0.00005);
    const spanLat = Math.max(latMax - latMin, 0.00005);
    const scale = Math.min((rw - 2*pad) / spanLon, (rh - 2*pad) / spanLat);
    const cx0 = (lonMin + lonMax) / 2, cy0 = (latMin + latMax) / 2;
    const px = lon => rw/2 + (lon - cx0) * lonAspect * scale;
    const py = lat => rh/2 - (lat - cy0) * scale;

    let segs = '';
    for (let i = 1; i < route.length; i++) {
      const [lat0, lon0] = route[i-1];
      const [lat1, lon1, hr1] = route[i];
      const z = hrZone(Number(hr1));
      const color = (z !== null ? ZONE_COLORS[z] : null) || 'var(--accent)';
      segs += `<line x1="${px(lon0).toFixed(1)}" y1="${py(lat0).toFixed(1)}" x2="${px(lon1).toFixed(1)}" y2="${py(lat1).toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
    }

    // Segment-by-segment wind effect: a looping/non-straight route faces the wind
    // differently at different points even though Garmin's wind reading is a single
    // snapshot for the whole activity, so colour each leg by ITS OWN bearing relative
    // to the wind. For long activities with hourly wind data (see wind_hourly), the
    // DIRECTION used per segment also follows the real clock time of that segment
    // instead of one constant direction for the whole run.
    const haveWind = a.wind_dir_deg !== undefined && a.wind_dir_deg !== null && a.wind_speed_kmh > 0;
    const hourlyWind = a.wind_hourly && a.wind_hourly.length > 1 ? a.wind_hourly : null;
    let segsWind = '';
    if (haveWind) {
      let distKmForWind = null, startMs = null;
      if (hourlyWind && a.start_time_gmt) {
        distKmForWind = cumulativeDistanceKm(chart);
        startMs = Date.parse(a.start_time_gmt.replace(' ', 'T') + 'Z');
      }
      const windDirForDist = distM => {
        if (!hourlyWind || !distKmForWind || startMs === null || Number.isNaN(startMs)) return a.wind_dir_deg;
        let bestIdx = 0, bestDiff = Infinity;
        for (let k = 0; k < distKmForWind.length; k++) {
          const diff = Math.abs(distKmForWind[k] * 1000 - distM);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = k; }
        }
        const segDt = new Date(startMs + chart.t[bestIdx] * 1000);
        const hh = String(segDt.getUTCHours()).padStart(2, '0') + ':00';
        const bucket = hourlyWind.find(h => h.hour === hh) || hourlyWind[hourlyWind.length - 1];
        return (bucket && bucket.wind_dir_deg != null) ? bucket.wind_dir_deg : a.wind_dir_deg;
      };
      for (let i = 1; i < route.length; i++) {
        const [lat0, lon0, , dist0] = route[i-1];
        const [lat1, lon1, , dist1] = route[i];
        if (lat0 === lat1 && lon0 === lon1) continue;
        const dirHere = windDirForDist(((dist0||0) + (dist1||0)) / 2);
        const towardDeg = (dirHere + 180) % 360;
        const brg = bearingDeg(lat0, lon0, lat1, lon1);
        const rel = Math.abs(((towardDeg - brg + 540) % 360) - 180);
        const color = rel <= 50 ? 'var(--good)' : rel >= 130 ? 'var(--critical)' : 'var(--text-muted)';
        segsWind += `<line x1="${px(lon0).toFixed(1)}" y1="${py(lat0).toFixed(1)}" x2="${px(lon1).toFixed(1)}" y2="${py(lat1).toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
      }
    }

    const totalDist = route[route.length - 1][3];
    const kmMarkers = [];
    if (totalDist) {
      for (let km = 1; km * 1000 < totalDist; km++) {
        const target = km * 1000;
        let best = null, bestDiff = Infinity;
        route.forEach(p => { if (p[3] !== null && p[3] !== undefined) { const diff = Math.abs(p[3]-target); if (diff < bestDiff) { bestDiff = diff; best = p; } } });
        if (best) kmMarkers.push({ km, p: best });
      }
    }
    const markers = kmMarkers.map(({km,p}) => `<circle cx="${px(p[1]).toFixed(1)}" cy="${py(p[0]).toFixed(1)}" r="7" fill="var(--surface-card)" stroke="var(--text-secondary)" stroke-width="1.5"/><text x="${px(p[1]).toFixed(1)}" y="${(py(p[0])+3).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="var(--text-secondary)" font-weight="700">${km}</text>`).join('');

    const start = route[0], end = route[route.length-1];
    const sameStartEnd = Math.hypot(px(end[1])-px(start[1]), py(end[0])-py(start[0])) < 6;
    const startEndSvg = sameStartEnd
      ? `<circle cx="${px(start[1]).toFixed(1)}" cy="${py(start[0]).toFixed(1)}" r="6" fill="var(--good)" stroke="var(--surface-card)" stroke-width="1.5"/><rect x="${(px(start[1])-3).toFixed(1)}" y="${(py(start[0])-3).toFixed(1)}" width="6" height="6" fill="var(--critical)" stroke="var(--surface-card)" stroke-width="1"/>`
      : `<circle cx="${px(start[1]).toFixed(1)}" cy="${py(start[0]).toFixed(1)}" r="5" fill="var(--good)" stroke="var(--surface-card)" stroke-width="1.5"/><rect x="${(px(end[1])-4).toFixed(1)}" y="${(py(end[0])-4).toFixed(1)}" width="8" height="8" fill="var(--critical)" stroke="var(--surface-card)" stroke-width="1.5"/>`;

    // scale ≈ px por grado de latitud (y por lon*cos(lat)); 1° lat ≈ 111320 m.
    const pxPerMeter = scale / 111320;
    const niceMeters = [100,200,250,500,1000,2000,5000].reduce((best,m) => {
      const px_ = m * pxPerMeter;
      return (px_ <= 90 && px_ > (best ? best.px : 0)) ? { m, px: px_ } : best;
    }, null) || { m: 100, px: 100*pxPerMeter };
    const barLabel = niceMeters.m >= 1000 ? `${niceMeters.m/1000} km` : `${niceMeters.m} m`;
    const barX0 = pad, barY = rh - 8;
    const scaleBarSvg = `<line x1="${barX0}" x2="${(barX0+niceMeters.px).toFixed(1)}" y1="${barY}" y2="${barY}" stroke="var(--text-secondary)" stroke-width="2"/>
      <line x1="${barX0}" x2="${barX0}" y1="${barY-3}" y2="${barY+3}" stroke="var(--text-secondary)" stroke-width="2"/>
      <line x1="${(barX0+niceMeters.px).toFixed(1)}" x2="${(barX0+niceMeters.px).toFixed(1)}" y1="${barY-3}" y2="${barY+3}" stroke="var(--text-secondary)" stroke-width="2"/>
      <text x="${(barX0+niceMeters.px/2).toFixed(1)}" y="${barY-5}" text-anchor="middle" font-size="9" fill="var(--text-secondary)">${barLabel}</text>`;

    const zoneLegend = [1,2,3,4,5].map(z => {
      const lo = ZONE_BOUNDS[z-1], hi = z < 5 ? ZONE_BOUNDS[z]-1 : null;
      return `<span><span class="sw" style="background:${ZONE_COLORS[z]}"></span>Z${z} ${lo}${hi===null?'+':'–'+hi}</span>`;
    }).join('');
    const windLegend = `
      <span><span class="sw" style="background:var(--good);"></span>De cola</span>
      <span><span class="sw" style="background:var(--critical);"></span>De cara</span>
      <span><span class="sw" style="background:var(--text-muted);"></span>Lateral</span>
      <span>${hourlyWind ? 'viento variable por hora (Garmin: ' + fmt(a.wind_speed_kmh,0) + ' km/h)' : fmt(a.wind_speed_kmh,0) + ' km/h' + (a.wind_dir_compass ? ' del ' + a.wind_dir_compass : '')}</span>`;
    const mapToggle = haveWind ? `<div class="act-map-toggle">
      <button type="button" class="act-filter-tab active" data-map-mode="zone">Por zona FC</button>
      <button type="button" class="act-filter-tab" data-map-mode="wind">Por viento</button>
    </div>` : '';

    routeBlock = `<div class="act-route-wrap">
      ${mapToggle}
      <div class="act-chart-info" id="${chartId}-map-tip">Pasa el cursor o el dedo por el mapa o el gráfico para ver cada punto</div>
      <svg viewBox="0 0 ${rw} ${rh}" id="${chartId}-map">
        <g id="${chartId}-map-zone">${segs}</g>
        ${haveWind ? `<g id="${chartId}-map-wind" style="display:none">${segsWind}</g>` : ''}
        ${markers}${startEndSvg}${scaleBarSvg}
        <circle class="chart-hover-dot" id="${chartId}-map-d" r="5.5" fill="none" stroke="var(--text-primary)" stroke-width="2"/>
      </svg>
      <div class="act-chart-legend" id="${chartId}-map-legend-zone">
        <span><span class="sw" style="background:var(--good);border-radius:50%;"></span>Salida</span>
        <span><span class="sw" style="background:var(--critical);"></span>Llegada${sameStartEnd?' (= salida)':''}</span>
        ${zoneLegend}
      </div>
      ${haveWind ? `<div class="act-chart-legend" id="${chartId}-map-legend-wind" style="display:none">
        <span><span class="sw" style="background:var(--good);border-radius:50%;"></span>Salida</span>
        <span><span class="sw" style="background:var(--critical);"></span>Llegada${sameStartEnd?' (= salida)':''}</span>
        ${windLegend}
      </div>` : ''}
    </div>`;
    routeCtx = { route, px, py };
  }

  requestAnimationFrame(() => {
    const svg = document.getElementById(chartId);
    if (!svg) return;
    const hl = document.getElementById(chartId+'-hl');
    const hrd = document.getElementById(chartId+'-hrd');
    const padDot = document.getElementById(chartId+'-pad');
    const tip = document.getElementById(chartId+'-tip');
    const altSvg = document.getElementById(chartId+'-alt');
    const altHl = document.getElementById(chartId+'-alt-hl');
    const altD = document.getElementById(chartId+'-alt-d');
    const mapD = document.getElementById(chartId+'-map-d');
    const mapTip = document.getElementById(chartId+'-map-tip');
    const elevForAlt = haveAlt ? chart.elevation_m.filter(v => v !== null) : [];
    const eMin2 = haveAlt ? Math.min(...elevForAlt) : 0, eMax2 = haveAlt ? Math.max(...elevForAlt) : 0;
    const distKm = routeCtx ? cumulativeDistanceKm(chart) : null;

    const mapSvg = document.getElementById(chartId+'-map');
    if (mapSvg) {
      const wrap = mapSvg.parentElement;
      const toggleBtns = wrap ? wrap.querySelectorAll('.act-map-toggle button') : [];
      const zoneG = document.getElementById(chartId+'-map-zone');
      const windG = document.getElementById(chartId+'-map-wind');
      const legendZone = document.getElementById(chartId+'-map-legend-zone');
      const legendWind = document.getElementById(chartId+'-map-legend-wind');
      toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mapMode;
          toggleBtns.forEach(b => b.classList.toggle('active', b === btn));
          if (zoneG) zoneG.style.display = mode === 'zone' ? '' : 'none';
          if (windG) windG.style.display = mode === 'wind' ? '' : 'none';
          if (legendZone) legendZone.style.display = mode === 'zone' ? '' : 'none';
          if (legendWind) legendWind.style.display = mode === 'wind' ? '' : 'none';
        });
      });
    }

    function updateHover(idx) {
      idx = Math.max(0, Math.min(n-1, idx));
      const cx = x(idx);
      hl.setAttribute('x1', cx); hl.setAttribute('x2', cx); hl.style.opacity = 1;
      const hrv = chart.hr[idx];
      if (hrv !== null) { hrd.setAttribute('cx', cx); hrd.setAttribute('cy', yHr(hrv)); hrd.style.opacity = 1; } else { hrd.style.opacity = 0; }
      const pv = chart.pace_sec_km ? chart.pace_sec_km[idx] : null;
      if (padDot) {
        if (havePace && pv !== null && pv <= PACE_CAP) { padDot.setAttribute('cx', cx); padDot.setAttribute('cy', yPace(pv)); padDot.style.opacity = 1; } else { padDot.style.opacity = 0; }
      }
      const bits = [`${Math.round(chart.t[idx]/60)}'`];
      if (distKm) bits.push(`${fmt(distKm[idx],2)} km`);
      if (hrv !== null) bits.push(`${fmt(hrv,0)} ppm`);
      if (pv !== null && pv !== undefined) bits.push(fmtPace(pv));
      if (chart.cadence && chart.cadence[idx] !== null) bits.push(`${fmt(chart.cadence[idx],0)} spm`);
      if (chart.elevation_m && chart.elevation_m[idx] !== null) bits.push(`${fmt(chart.elevation_m[idx],0)} m`);
      tip.textContent = bits.join(' · ');

      if (altSvg && haveAlt && chart.elevation_m[idx] !== null) {
        const yAlt2 = padTAlt + (1 - (chart.elevation_m[idx] - eMin2) / ((eMax2-eMin2)||1)) * (hAlt-padTAlt-padBAlt);
        altHl.setAttribute('x1', cx); altHl.setAttribute('x2', cx); altHl.style.opacity = 1;
        altD.setAttribute('cx', cx); altD.setAttribute('cy', yAlt2); altD.style.opacity = 1;
      }

      if (routeCtx && distKm) {
        const ri = nearestRouteIndexByDist(routeCtx.route, distKm[idx]);
        if (ri >= 0) {
          const p = routeCtx.route[ri];
          mapD.setAttribute('cx', routeCtx.px(p[1])); mapD.setAttribute('cy', routeCtx.py(p[0])); mapD.style.opacity = 1;
          if (mapTip) mapTip.textContent = `${fmt(distKm[idx],2)} km${p[2] ? ' · ' + fmt(p[2],0) + ' ppm' : ''}`;
        }
      }
    }
    function handleMove(e, refSvg) {
      const rect = refSvg.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const relX = (clientX - rect.left) / rect.width * w;
      updateHover(Math.round((relX - padL) / (w - padL - padR) * (n - 1)));
    }
    function clearHover() {
      hl.style.opacity = 0; hrd.style.opacity = 0; if (padDot) padDot.style.opacity = 0;
      tip.textContent = 'Pasa el cursor o el dedo por el gráfico para ver el detalle de cada punto';
      if (altHl) altHl.style.opacity = 0; if (altD) altD.style.opacity = 0;
      if (mapD) mapD.style.opacity = 0;
      if (mapTip) mapTip.textContent = 'Pasa el cursor o el dedo por el mapa o el gráfico para ver cada punto';
    }
    svg.addEventListener('pointermove', e => handleMove(e, svg));
    svg.addEventListener('pointerleave', clearHover);
    if (altSvg) { altSvg.addEventListener('pointermove', e => handleMove(e, altSvg)); altSvg.addEventListener('pointerleave', clearHover); }
  });

  return `<div class="act-chart-wrap">
    <div class="act-chart-info" id="${chartId}-tip">Pasa el cursor o el dedo por el gráfico para ver el detalle de cada punto</div>
    ${mainChartSvg}
    <div class="act-chart-legend">${legendBits.join('')}</div>
  </div>${altBlock}${routeBlock}`;
}
// ---------- Strength-specific detail: body heatmap + exercise log ----------
// Simplified front/back body silhouette built from plain shapes (not a traced
// anatomical illustration) with named regions mapped to the same muscle groups
// used elsewhere (MUSCLE_GROUP_MAP in build_combined.py). Untracked areas
// (forearms, neck, hips, feet) stay outline-only since Garmin's exercise
// categories don't distinguish them.
const BODY_REGIONS = [
  { view:'front', group:'Pecho', points:'518 416 510 551 580 580 678 555 706 473 620 416' },
  { view:'front', group:'Pecho', points:'298 465 314 555 408 580 482 551 478 420 376 420' },
  { view:'front', group:'Core', points:'686 633 673 571 588 596 600 641 604 833 657 788 665 698' },
  { view:'front', group:'Core', points:'339 784 331 718 310 633 322 571 408 592 392 633 392 837' },
  { view:'front', group:'Core', points:'563 592 580 641 584 780 584 927 563 984 551 1041 514 1078 510 845 506 673 510 571' },
  { view:'front', group:'Core', points:'437 588 486 571 490 673 486 845 482 1073 445 1037 408 914 408 784 412 645' },
  { view:'front', group:'Bíceps', points:'167 682 180 714 229 661 290 539 278 494 204 559' },
  { view:'front', group:'Bíceps', points:'714 494 702 547 763 661 816 718 829 690 788 555' },
  { view:'front', group:'Tríceps', points:'694 555 694 616 759 727 776 702 755 673' },
  { view:'front', group:'Tríceps', points:'224 694 298 555 298 608 229 731' },
  { view:'front', group:null, points:'555 237 506 335 506 392 616 400 706 449 694 367 633 351 584 306' },
  { view:'front', group:null, points:'290 449 302 371 363 351 412 302 445 245 490 339 486 392 380 396' },
  { view:'front', group:'Hombros', points:'784 531 796 478 792 412 759 380 710 363 722 429 714 473' },
  { view:'front', group:'Hombros', points:'282 473 212 531 200 478 204 408 245 371 286 371 269 433' },
  { view:'front', group:null, points:'424 29 400 118 420 196 461 233 498 253 547 224 576 192 592 102 571 24 498 0' },
  { view:'front', group:'Cuádriceps', points:'527 1102 543 1249 600 1102 620 1000 649 943 600 927 567 1045' },
  { view:'front', group:'Cuádriceps', points:'478 1106 449 1253 420 1159 404 1131 396 1073 380 1024 347 939 396 922 416 992 437 1053' },
  { view:'front', group:'Cuádriceps', points:'347 988 371 1082 371 1278 343 1371 310 1327 294 1200 282 1114 294 1008 322 947' },
  { view:'front', group:'Cuádriceps', points:'633 1057 645 1000 669 947 702 1012 710 1118 682 1331 653 1376 624 1286 620 1114' },
  { view:'front', group:'Cuádriceps', points:'388 1294 384 1122 412 1184 445 1294 429 1351 400 1461 363 1465 355 1400' },
  { view:'front', group:'Cuádriceps', points:'596 1457 555 1290 608 1139 612 1302 641 1396 629 1465' },
  { view:'front', group:'Cuádriceps', points:'327 1384 265 1457 257 1367 257 1273 269 1143 294 1335' },
  { view:'front', group:'Cuádriceps', points:'718 1131 739 1241 739 1404 727 1457 665 1384 702 1335' },
  { view:'front', group:null, points:'339 1400 347 1433 355 1473 363 1510 351 1567 298 1567 273 1527 273 1473 302 1441' },
  { view:'front', group:null, points:'657 1400 722 1478 722 1522 698 1571 649 1567 629 1510' },
  { view:'front', group:'Gemelo', points:'714 1604 735 1535 767 1612 796 1678 784 1878 796 1955 747 1955' },
  { view:'front', group:'Gemelo', points:'249 1947 278 1649 282 1604 261 1543 249 1576 224 1616 208 1678 220 1882 208 1955' },
  { view:'front', group:'Gemelo', points:'727 1951 698 1592 653 1584 641 1624 641 1653 657 1771' },
  { view:'front', group:'Gemelo', points:'355 1584 359 1624 359 1669 351 1722 351 1767 322 1820 306 1873 269 1947 273 1878 282 1804 286 1755 290 1698 298 1641 302 1588' },
  { view:'front', group:null, points:'61 886 102 751 147 702 163 743 192 735 45 976 0 1000' },
  { view:'front', group:null, points:'845 698 833 735 800 731 951 984 1000 1004 935 894 898 763' },
  { view:'front', group:null, points:'776 722 776 776 804 841 853 898 922 1012 947 996' },
  { view:'front', group:null, points:'69 1012 135 906 188 841 216 771 212 718 49 988' },
  { view:'back', group:null, points:'506 0 460 9 409 55 404 128 451 200 557 200 591 136 596 47 557 13' },
  { view:'back', group:'Espalda', points:'447 217 477 217 472 383 477 647 383 532 353 409 311 366 391 332 438 272' },
  { view:'back', group:'Espalda', points:'523 217 557 217 566 272 609 328 689 366 647 404 617 532 523 647 532 383' },
  { view:'back', group:'Hombros', points:'294 370 230 391 174 443 183 536 243 494 272 464' },
  { view:'back', group:'Hombros', points:'711 370 783 396 826 447 817 536 749 489 723 451' },
  { view:'back', group:'Espalda', points:'311 387 281 489 285 553 340 753 472 711 472 664 366 540 336 413' },
  { view:'back', group:'Espalda', points:'689 387 719 494 715 562 660 753 528 711 528 664 634 545 664 417' },
  { view:'back', group:'Tríceps', points:'268 498 179 557 145 723 166 817 217 638 268 557' },
  { view:'back', group:'Tríceps', points:'736 502 821 557 860 732 834 821 779 630 732 557' },
  { view:'back', group:'Tríceps', points:'268 583 268 685 230 753 191 774 226 655' },
  { view:'back', group:'Tríceps', points:'728 583 770 647 804 774 766 753 728 689' },
  { view:'back', group:'Espalda', points:'477 728 345 770 353 834 494 1021 468 830' },
  { view:'back', group:'Espalda', points:'523 728 655 770 647 834 506 1021 532 838' },
  { view:'back', group:null, points:'864 757 911 834 932 940 1000 1064 962 1043 881 894 843 838' },
  { view:'back', group:null, points:'136 757 89 838 68 936 0 1064 38 1043 123 885 157 830' },
  { view:'back', group:null, points:'813 796 774 779 791 847 911 1038 932 1089 945 1047' },
  { view:'back', group:null, points:'187 796 221 779 209 843 94 1030 68 1085 51 1047' },
  { view:'back', group:'Glúteo', points:'447 996 302 1085 298 1187 315 1260 472 1213 494 1149' },
  { view:'back', group:'Glúteo', points:'553 991 511 1145 523 1209 681 1260 698 1191 694 1085' },
  { view:'back', group:'Cuádriceps', points:'481 1230 447 1230 413 1255 451 1443 485 1357 489 1294' },
  { view:'back', group:'Cuádriceps', points:'519 1226 557 1234 591 1260 549 1443 519 1362 511 1294' },
  { view:'back', group:'Isquios', points:'289 1221 311 1294 366 1260 353 1353 345 1502 294 1583 289 1468 277 1413 272 1315' },
  { view:'back', group:'Isquios', points:'715 1217 694 1289 638 1260 655 1366 664 1502 711 1583 715 1477 728 1421 736 1319' },
  { view:'back', group:'Isquios', points:'387 1255 443 1460 404 1668 362 1528 370 1353' },
  { view:'back', group:'Isquios', points:'617 1255 634 1362 643 1532 600 1668 562 1464' },
  { view:'back', group:null, points:'345 1532 311 1591 336 1664 374 1626' },
  { view:'back', group:null, points:'664 1536 630 1630 668 1664 694 1591' },
  { view:'back', group:'Gemelo', points:'294 1604 285 1672 247 1796 238 1928 255 1970 285 1932 298 1800 319 1711 319 1668' },
  { view:'back', group:'Gemelo', points:'374 1651 353 1677 332 1719 311 1804 302 1919 340 2000 387 1906 391 1689' },
  { view:'back', group:'Gemelo', points:'630 1651 613 1685 617 1906 664 1996 706 1919 689 1796 668 1702' },
  { view:'back', group:'Gemelo', points:'706 1604 723 1685 757 1791 766 1928 745 1966 723 1936 706 1796 681 1681' },
  { view:'back', group:'Gemelo', points:'285 1957 302 1957 336 2017 306 2200 285 2136 268 1983' },
  { view:'back', group:'Gemelo', points:'698 1957 719 1957 736 1983 719 2132 702 2196 672 2021' },
];
function muscleFillColor(frac) {
  if (!frac || frac <= 0) return 'var(--grid)';
  if (frac >= 0.85) return 'var(--critical)';
  if (frac >= 0.5) return 'color-mix(in srgb, var(--critical) 55%, var(--warning))';
  if (frac >= 0.25) return 'var(--warning)';
  return 'color-mix(in srgb, var(--warning) 45%, var(--grid))';
}
function buildMuscleBodyMap(a) {
  const gs = a.muscle_group_sets;
  if (!gs || !Object.keys(gs).length) return '';
  const maxSets = Math.max(...Object.values(gs));
  if (!maxSets) return '';
  const polysFor = view => BODY_REGIONS.filter(r => r.view === view).map(r => {
    const frac = r.group ? (gs[r.group] || 0) / maxSets : 0;
    const fill = r.group ? muscleFillColor(frac) : 'var(--surface-sunken)';
    return `<polygon points="${r.points}" fill="${fill}" stroke="var(--surface-card)" stroke-width="4"/>`;
  }).join('');
  const legend = Object.entries(gs).sort((x,y) => y[1]-x[1]).map(([g,v]) => {
    const frac = v / maxSets;
    return `<span><span class="sw" style="background:${muscleFillColor(frac)}"></span>${g} (${fmt(v,1)} series)</span>`;
  }).join('');
  return `<div class="act-muscle-map">
    <div class="act-muscle-figures">
      <div class="act-muscle-figure">
        <svg viewBox="0 0 1000 2220">${polysFor('front')}</svg>
        <div class="act-muscle-figure-label">Delante</div>
      </div>
      <div class="act-muscle-figure">
        <svg viewBox="0 0 1000 2220">${polysFor('back')}</svg>
        <div class="act-muscle-figure-label">Detrás</div>
      </div>
    </div>
    <div class="act-chart-legend">${legend}</div>
  </div>`;
}
function fmtWeightRange(min, max) {
  if (min === null || min === undefined) return '—';
  return min === max ? `${fmt(min,1)} kg` : `${fmt(min,1)}→${fmt(max,1)} kg`;
}
function exerciseTableHtml(a) {
  const exercises = (a.exercises || []).filter(e => (e.sets||[]).some(s => s.reps || s.weight_kg));
  if (!exercises.length) return '';
  const rows = exercises.map((e, i) => {
    const reps = (e.sets||[]).map(s => s.reps != null ? s.reps : '—').join('/');
    const prBadge = e.is_pr ? ' 🏆' : '';
    const bestSet = e.best_set ? `${fmt(e.best_set.weight_kg,1)}×${e.best_set.reps}${prBadge}` : '—';
    const setRows = (e.sets||[]).map((s,j) => `<tr class="exercise-set-row${s.warmup ? ' set-warmup' : ''}">
        <td>${s.warmup ? 'Calent.' : `Serie ${j+1}`}</td>
        <td class="num">${s.reps != null ? fmt(s.reps,0) : '—'}</td>
        <td class="num">${s.weight_kg != null ? fmt(s.weight_kg,1) + ' kg' : '—'}</td>
      </tr>`).join('');
    return `<tr class="exercise-row" data-exercise-idx="${i}">
      <td>${e.display_name}</td>
      <td class="num">${e.sets.length}</td>
      <td class="num reps-col">${reps}</td>
      <td class="num weight-col">${fmtWeightRange(e.weight_min, e.weight_max)}</td>
      <td class="num">${bestSet}</td>
    </tr>
    <tr class="exercise-sets-wrap" id="ex-sets-${a.activity_id}-${i}" hidden><td colspan="5">
      <table class="act-splits exercise-sets-table"><tbody>${setRows}</tbody></table>
    </td></tr>`;
  }).join('');
  const wrapId = 'ex-tbl-' + a.activity_id;
  const html = `<div class="act-splits-wrap" id="${wrapId}"><table class="act-splits exercise-table">
    <thead><tr><th>Ejercicio</th><th>Series</th><th class="reps-col">Reps</th><th class="weight-col">Peso</th><th>Mejor serie</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  requestAnimationFrame(() => {
    const wrap = document.getElementById(wrapId);
    if (!wrap || wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    wrap.addEventListener('click', e => {
      const row = e.target.closest('.exercise-row');
      if (!row) return;
      const setsRow = document.getElementById(`ex-sets-${a.activity_id}-${row.dataset.exerciseIdx}`);
      if (setsRow) setsRow.hidden = !setsRow.hidden;
    });
  });
  return html;
}
function renderActivityDetail(a) {
  if (a.type === 'strength_training') {
    const parts = [
      buildMuscleBodyMap(a),
      exerciseTableHtml(a),
      summaryGridHtml(a),
      strengthComparisonHtml(a),
      buildActivityAnalysis(a),
      buildGlucoseChart(a),
    ].filter(Boolean);
    if (!parts.length) return '<div class="act-detail-empty">Sin datos detallados disponibles para esta actividad (solo se guarda detalle de las más recientes en cada sincronización).</div>';
    return parts.join('');
  }
  const parts = [
    summaryGridHtml(a),
    activityComparisonHtml(a),
    kmSplitsTableHtml(a),
    buildActivityAnalysis(a),
    buildGlucoseChart(a),
  ].filter(Boolean);
  if (!parts.length) return '<div class="act-detail-empty">Sin datos detallados disponibles para esta actividad (solo se guarda detalle de las más recientes en cada sincronización).</div>';
  return parts.join('');
}
function collapsedStatsFor(a) {
  const hrStat = { v: a.avg_hr ? fmt(a.avg_hr,0) : '—', l: 'ppm' };
  if (a.type === 'running' || a.type === 'walking') {
    const stats = [];
    if (a.distance_km > 0) stats.push({ v: fmt(a.distance_km,2), l: 'km' });
    stats.push({ v: fmt(a.duration_min,0), l: 'min' });
    stats.push({ v: a.pace_sec_km ? fmtPace(a.pace_sec_km).replace('/km','') : '—', l: '/km' });
    stats.push(hrStat);
    return stats;
  }
  if (a.type === 'indoor_cycling' || a.type === 'cycling') {
    const stats = [];
    if (a.distance_km > 0) stats.push({ v: fmt(a.distance_km,2), l: 'km' });
    stats.push({ v: fmt(a.duration_min,0), l: 'min' });
    if (a.avg_speed_kmh) stats.push({ v: fmt(a.avg_speed_kmh,1), l: 'km/h' });
    else if (a.avg_power_w) stats.push({ v: fmt(a.avg_power_w,0), l: 'W' });
    stats.push(hrStat);
    return stats;
  }
  if (a.type === 'strength_training') {
    const stats = [{ v: fmt(a.duration_min,0), l: 'min' }];
    if (a.effective_sets_total !== undefined && a.effective_sets_total !== null) stats.push({ v: fmt(a.effective_sets_total,0), l: 'series' });
    if (a.volume_kg_total !== undefined && a.volume_kg_total !== null) stats.push({ v: fmt(a.volume_kg_total/1000,1), l: 't' });
    return stats;
  }
  const stats = [];
  if (a.distance_km > 0) stats.push({ v: fmt(a.distance_km,2), l: 'km' });
  stats.push({ v: fmt(a.duration_min,0), l: 'min' });
  stats.push(hrStat);
  return stats;
}
function activityRowHtml(a) {
  const meta = CAT_META[a.type] || { label: a.type, color: 'var(--text-muted)', icon: '•' };
  const d = a.date.slice(8,10) + '/' + a.date.slice(5,7);
  const distInStats = a.type !== 'strength_training' && a.distance_km > 0;
  const dist = (!distInStats && a.distance_km > 0) ? fmt(a.distance_km,2) + ' km' : '';
  const stats = collapsedStatsFor(a);
  const isStrength = a.type === 'strength_training';
  const realZone = dominantZoneFromReal(a.hr_zones);
  const zoneEl = isStrength ? '' : (realZone !== null ? zoneBadge(realZone) : zoneBadge(hrZone(Number(a.avg_hr))));
  const teLabel = a.te_aerobic_label;
  const teChip = (!isStrength && teLabel) ? `<span class="te-chip" style="--tec:${TE_COLOR[teLabel]||'var(--text-muted)'}">${teLabel}</span>` : '';
  const extras = [];
  const cadenceChip = a.type === 'running' ? (a.avg_cadence_running || a.cadence_spm) : null;
  if (cadenceChip) extras.push(`${fmt(cadenceChip,0)} spm`);
  if (a.type === 'running' && a.stride_length_cm) extras.push(`${fmt(a.stride_length_cm/100,2)} m/zancada`);
  if (a.training_load && !isStrength) extras.push(`carga ${fmt(a.training_load,0)}`);
  const muscleChips = (isStrength && a.muscle_group_sets)
    ? Object.entries(a.muscle_group_sets).sort((x,y) => y[1] - x[1]).map(([g,v]) => `<span class="act-chip">${g} ${fmt(v,1)}</span>`)
    : [];
  const rpe = a.rpe !== undefined && a.rpe !== null && a.rpe !== '' ? Number(a.rpe) : null;
  const highEffortEasy = rpe !== null && rpe >= 7 && wasIntendedEasy(a);
  const evalChips = [];
  if (a.feel_label) evalChips.push(`<span class="eval-chip">${a.feel_label}</span>`);
  if (rpe !== null) evalChips.push(`<span class="eval-chip${highEffortEasy ? ' warn' : ''}">Esfuerzo ${fmt(rpe,0)}/10</span>`);
  return `
  <details class="act-item" data-activity-id="${a.activity_id}">
    <summary class="act-row">
      <div class="act-top">
        <div class="act-pill" style="background:color-mix(in srgb, ${meta.color} 18%, transparent);">${meta.icon}</div>
        <div class="act-main">
          <div class="name">${a.name}</div>
          <div class="sub">${d} · ${meta.label}${dist ? ' · ' + dist : ''}</div>
        </div>
        <div class="act-stats">
          ${stats.map(s => `<div class="s"><div class="v num">${s.v}</div><div class="l">${s.l}</div></div>`).join('')}
        </div>
        <span class="act-chevron">▾</span>
      </div>
      <div class="act-chips">
        ${zoneEl}
        ${teChip}
        ${muscleChips.join('')}
        ${extras.map(e=>`<span class="act-chip">${e}</span>`).join('')}
        ${evalChips.join('')}
        ${highEffortEasy ? `<span class="act-chip warn">Esfuerzo alto para sesión suave</span>` : ''}
      </div>
      ${isStrength ? '' : realZoneBar(a.hr_zones)}
    </summary>
    <div class="act-detail"></div>
  </details>`;
}

const ACT_PAGE_SIZE = 5;
const ACT_LOAD_MORE_STEP = 10;
let actFilter = 'all';
let actVisibleCount = ACT_PAGE_SIZE;

function filteredActivities() {
  if (actFilter === 'all') return DATA.activities;
  return DATA.activities.filter(a => a.type === actFilter);
}

function renderActFilterTabs() {
  const total = DATA.activities.length;
  const counts = {};
  DATA.activities.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
  // One tab per type actually present, in CAT_META's defined order, plus any
  // unexpected type not in CAT_META tacked on at the end so nothing is hidden.
  const knownTypes = Object.keys(CAT_META).filter(t => counts[t]);
  const otherTypes = Object.keys(counts).filter(t => !CAT_META[t]);
  const tabs = [
    { key: 'all', label: `Todas (${total})` },
    ...[...knownTypes, ...otherTypes].map(t => ({ key: t, label: `${(CAT_META[t] || { label: t }).label} (${counts[t]})` })),
  ];
  document.getElementById('actFilterTabs').innerHTML = tabs.map(t =>
    `<button type="button" class="act-filter-tab${actFilter === t.key ? ' active' : ''}" data-filter="${t.key}">${t.label}</button>`
  ).join('');
}

function renderActList() {
  const filtered = filteredActivities();
  const visible = filtered.slice(0, actVisibleCount);
  document.getElementById('actSub').textContent = filtered.length
    ? `${visible.length} de ${filtered.length} actividades · toca una para ver el detalle`
    : 'No hay actividades en esta categoría.';
  document.getElementById('actList').innerHTML = visible.map(activityRowHtml).join('');
  const loadMoreBtn = document.getElementById('actLoadMore');
  const remaining = filtered.length - visible.length;
  loadMoreBtn.style.display = remaining > 0 ? '' : 'none';
  if (remaining > 0) loadMoreBtn.textContent = `Cargar más (${remaining} restantes)`;
}

document.getElementById('actFilterTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-filter-tab');
  if (!btn || btn.classList.contains('active')) return;
  actFilter = btn.dataset.filter;
  actVisibleCount = ACT_PAGE_SIZE;
  renderActFilterTabs();
  renderActList();
});
document.getElementById('actLoadMore').addEventListener('click', () => {
  actVisibleCount += ACT_LOAD_MORE_STEP;
  renderActList();
});

renderActFilterTabs();
renderActList();

// Lazy-render each activity's expanded detail (chart, route, comparison, stats) only the
// first time it's opened, so 17+ SVG charts/maps are never built unless actually viewed.
document.getElementById('actList').addEventListener('click', (e) => {
  // Clicking anywhere inside the open "Métricas detalladas" tile grid (but not its
  // own toggle button) collapses it again, so the whole block acts as a big button.
  const grid = e.target.closest('.act-summary-details .act-detail-grid.compact');
  if (grid) {
    const det = grid.closest('details.act-summary-details');
    if (det && det.open) det.open = false;
    return;
  }
  const item = e.target.closest('details.act-item');
  if (!item) return;
  requestAnimationFrame(() => {
    if (item.open && !item.dataset.rendered) {
      const aid = item.dataset.activityId;
      const a = DATA.activities.find(x => String(x.activity_id) === aid);
      if (a) {
        item.querySelector('.act-detail').innerHTML = renderActivityDetail(a);
        item.dataset.rendered = '1';
      }
    }
  });
});

const usedTypes = [...new Set(DATA.activities.map(a => a.type))];
document.getElementById('legend').innerHTML = usedTypes.map(t => {
  const meta = CAT_META[t] || { label: t, color: 'var(--text-muted)' };
  return `<div class="li"><span class="sw" style="background:${meta.color}"></span>${meta.label}</div>`;
}).join('');

document.getElementById('zoneScale').innerHTML = [1,2,3,4,5].map(z => {
  const lo = ZONE_BOUNDS[z-1], hi = z < 5 ? ZONE_BOUNDS[z] - 1 : MAX_HR;
  return `<span style="display:inline-flex;align-items:center;gap:6px;">${zoneBadge(z)}<span class="num">${lo}–${hi}</span></span>`;
}).join('');
document.getElementById('zoneNote').textContent = zonesAreReal
  ? `El color de cada actividad es su zona dominante real (más tiempo pasado ahí), medida por el reloj lap a lap. La barra fina bajo cada actividad muestra el reparto real entre zonas. Escala: zonas configuradas actualmente en tu reloj (${MAX_HR} ppm FC máx. observada).`
  : `Zona estimada con la FC media de cada actividad sobre tu FC máxima registrada (${MAX_HR} ppm) — Garmin aún no devolvió tus zonas reales para alguna actividad.`;

// ---------- Análisis de carreras ----------
function fmtMinSec(totalSec) {
  if (!totalSec) return '0:00';
  const s = Math.round(totalSec);
  const m = Math.floor(s/60), sec = s % 60;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
const runsWithSplits = runActivities.filter(a => a.km_splits && a.km_splits.length).slice(0, 6);
document.getElementById('runAnalysisSub').textContent = runsWithSplits.length
  ? `Parciales por km de tus ${runsWithSplits.length} carreras más recientes con datos suficientes`
  : 'Aún no hay carreras con datos suficientes para un análisis por km';
document.getElementById('runAnalysisList').innerHTML = runsWithSplits.map(a => {
  const speeds = a.km_splits.map(s => 1 / s.pace_sec_km);
  const minSpeed = Math.min(...speeds), maxSpeed = Math.max(...speeds);
  // Baseline the bar heights at 85% of the slowest km's speed (not 0) so that small,
  // normal pace variation across a run doesn't look dramatically different bar-to-bar.
  const baseline = minSpeed * 0.85;
  const spanSpeed = (maxSpeed - baseline) || 1;
  const kmBars = a.km_splits.map(s => {
    const speed = 1 / s.pace_sec_km;
    const pct = Math.max(8, Math.min(100, (speed - baseline) / spanSpeed * 100));
    const label = s.partial ? `${(s.distance_m/1000).toFixed(1)}` : `${s.km}`;
    const tip = `${fmtPace(s.pace_sec_km)}${s.avg_hr ? ' · ' + fmt(s.avg_hr,0) + ' ppm' : ''}${s.avg_cadence ? ' · ' + fmt(s.avg_cadence,0) + ' spm' : ''}`;
    return `<div class="kb">
      <div class="pace-lab num">${fmtPace(s.pace_sec_km).replace('/km','')}</div>
      <div class="bar${s.partial ? ' partial' : ''}" style="height:${pct}%;" title="${tip}"></div>
      <div class="lab">${label}</div>
    </div>`;
  }).join('');

  const driftPct = a.hr_drift_pct;
  const driftTxt = (driftPct === undefined || driftPct === null || driftPct === '') ? '—' : `${driftPct > 0 ? '+' : ''}${fmt(Number(driftPct),1)}%`;
  const elev = (a.elevation_gain_m || a.elevation_loss_m) ? `+${fmt(a.elevation_gain_m,0)} / -${fmt(a.elevation_loss_m,0)} m` : '—';
  const temp = (a.temp_c === undefined || a.temp_c === null || a.temp_c === '') ? '—' : `${fmt(a.temp_c,0)}°C`;

  const coachEntry = coachPlan.find(w => w.date === a.date && w.sport === 'running' && w.detail);
  let coachHtml = '';
  if (coachEntry && coachEntry.detail && (coachEntry.detail.estimated_duration_sec || coachEntry.detail.estimated_distance_m)) {
    const plannedMin = coachEntry.detail.estimated_duration_sec ? Math.round(coachEntry.detail.estimated_duration_sec / 60) : null;
    const plannedKm = coachEntry.detail.estimated_distance_m ? (coachEntry.detail.estimated_distance_m / 1000) : null;
    const cs = a.compliance_score;
    const hasCs = cs !== undefined && cs !== null && cs !== '';
    const csCls = !hasCs ? '' : (cs >= 80 ? 'ra-compliant' : cs >= 50 ? 'ra-partial-compliance' : 'ra-noncompliant');
    const csLabel = !hasCs ? '' : (cs >= 80 ? 'Cumplida' : cs >= 50 ? 'Parcialmente cumplida' : 'No cumplida');
    coachHtml = `<div class="ra-coach-compare">
      Coach pedía${plannedMin ? `: ${plannedMin} min` : ''}${plannedKm ? `${plannedMin ? ' · ' : ': '}${fmt(plannedKm,1)} km` : ''} —
      hiciste ${fmt(a.duration_min,0)} min${a.distance_km ? ' · ' + fmt(a.distance_km,1) + ' km' : ''}
      ${hasCs ? ` · <span class="${csCls}">${csLabel} (${cs}/100)</span>` : ''}
    </div>`;
  }

  const rpe = a.rpe !== undefined && a.rpe !== null && a.rpe !== '' ? Number(a.rpe) : null;
  const highEffortEasy = rpe !== null && rpe >= 7 && wasIntendedEasy(a);

  return `
  <div class="run-analysis-card">
    <div class="ra-head">
      <span class="ra-title">${a.name}</span>
      <span class="ra-date">${fmtDateShort(a.date)}</span>
    </div>
    <div class="ra-km-bars">${kmBars}</div>
    <div class="ra-stats-row">
      <div class="ra-stat"><div class="rl">Corriendo / caminando</div><div class="rv num">${fmtMinSec(a.run_sec)} / ${fmtMinSec(a.walk_sec)}</div></div>
      <div class="ra-stat"><div class="rl">Cadencia (corriendo)</div><div class="rv num">${a.avg_cadence_running ? fmt(a.avg_cadence_running,0) + ' spm' : '—'}</div></div>
      <div class="ra-stat"><div class="rl">Cadencia total</div><div class="rv num">${a.avg_cadence_total ? fmt(a.avg_cadence_total,0) + ' spm' : '—'}</div></div>
      <div class="ra-stat"><div class="rl">Deriva cardíaca</div><div class="rv num">${driftTxt}</div></div>
      <div class="ra-stat"><div class="rl">Desnivel</div><div class="rv num">${elev}</div></div>
      <div class="ra-stat"><div class="rl">Temperatura</div><div class="rv num">${temp}</div></div>
    </div>
    ${coachHtml}
    ${realZoneBar(a.hr_zones)}
    <div class="ra-eval-row">
      ${a.feel_label ? `<span class="eval-chip">${a.feel_label}</span>` : ''}
      ${rpe !== null ? `<span class="eval-chip${highEffortEasy ? ' warn' : ''}">Esfuerzo ${fmt(rpe,0)}/10</span>` : ''}
      ${highEffortEasy ? `<span class="eval-chip warn">Esfuerzo alto para sesión suave</span>` : ''}
    </div>
  </div>`;
}).join('');

// ---------- Tendencias semanales de carrera ----------
const runTrendsData = DATA.runTrends || [];
document.getElementById('runTrendsSub').textContent = runTrendsData.length
  ? `Últimas ${runTrendsData.length} semana(s) con carreras registradas (desde ${fmtDateShort(runTrendsData[0].week_start)})`
  : 'Aún no hay suficientes semanas con carreras registradas';
// A metric with fewer than 2 real (non-null) weeks can't show a trend line, so
// show its current value instead of a near-empty/misleading chart.
function trendMetric(title, unit, decimals, getValue, fmtFn) {
  const points = runTrendsData.map(w => ({ date: w.week_start, v: getValue(w) }));
  const validPoints = points.filter(p => p.v !== null && p.v !== undefined && !Number.isNaN(Number(p.v)));
  if (validPoints.length >= 2) return lineChart(title, points, unit, decimals, undefined, undefined, fmtFn);
  if (validPoints.length === 1) {
    const last = validPoints[validPoints.length - 1];
    const displayVal = fmtFn ? fmtFn(last.v) : fmt(last.v, decimals) + unit;
    return `<div class="chart-box"><div class="chart-head"><span class="chart-title">${title}</span><span class="chart-last num">${displayVal}</span></div><div class="track-note" style="margin-top:8px;">Se necesitan 2+ semanas para ver la tendencia.</div></div>`;
  }
  return '';
}
document.getElementById('runTrendsCharts').innerHTML = runTrendsData.length
  ? trendMetric('Km totales / semana', ' km', 1, w => Number(w.km_total))
    + trendMetric('Carrera más larga', ' km', 1, w => Number(w.longest_run_km))
    + trendMetric('Cadencia media (corriendo)', ' spm', 0, w => w.avg_cadence !== null && w.avg_cadence !== undefined ? Number(w.avg_cadence) : null)
    + trendMetric('Ritmo medio en Z2', '', 0, w => w.z2_pace_sec_km !== null && w.z2_pace_sec_km !== undefined ? Number(w.z2_pace_sec_km) : null, fmtPace)
  : '<div class="track-note">Necesitas al menos 2 semanas con carreras registradas para ver la tendencia.</div>';

// ---------- Resumen semanal ----------
function mondayOf(d) {
  const date = new Date(d + 'T00:00:00');
  const day = date.getDay(); // 0 = Sunday, in local time
  const diff = day === 0 ? -6 : 1 - day;
  // Apply the offset in UTC terms (not local) so the result never shifts by
  // a day when re-serialized via toISOString in a non-UTC timezone.
  const utc = new Date(d + 'T00:00:00Z');
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc.toISOString().slice(0, 10);
}
const weekStart = mondayOf(todayStr);
const weekRuns = runActivities.filter(a => a.date >= weekStart);
const weekStrength = strengthActivities.filter(a => a.date >= weekStart);
const weekKm = weekRuns.reduce((s,a)=>s+Number(a.distance_km||0),0);
const weekMin = weekRuns.reduce((s,a)=>s+Number(a.duration_min||0),0);
const weekLongest = weekRuns.reduce((max,a)=> Number(a.distance_km||0) > max ? Number(a.distance_km) : max, 0);
const weekEnd = new Date(new Date(weekStart+'T00:00:00Z').getTime() + 6*86400000).toISOString().slice(0,10);
const weekPlanned = coachPlan.filter(w => w.date >= weekStart && w.date <= weekEnd);
const weekDone = weekPlanned.filter(w => w.status === 'done');

document.getElementById('weekSub').textContent = `Semana actual (desde el lunes ${fmtDateShort(weekStart)})`;
document.getElementById('weekGrid').innerHTML = `
  <div class="week-item"><div class="l">Carrera</div><div class="v num">${fmt(weekKm,1)} km</div><div class="f">${fmt(weekMin,0)} min · ${weekRuns.length} sesiones</div></div>
  <div class="week-item"><div class="l">Más larga</div><div class="v num">${fmt(weekLongest,1)} km</div><div class="f">esta semana</div></div>
  <div class="week-item"><div class="l">Fuerza</div><div class="v num">${weekStrength.length}</div><div class="f">sesiones</div></div>
  <div class="week-item"><div class="l">Plan de Coach</div><div class="v num">${weekDone.length}/${weekPlanned.length || 0}</div><div class="f">${weekPlanned.length ? 'completados' : 'sin entrenos aún'}</div></div>
`;

// ---------- Series por grupo muscular — esta semana ----------
const FINE_MUSCLE_GROUPS = ['Pecho','Espalda','Hombros','Bíceps','Tríceps','Cuádriceps','Isquios','Glúteo','Gemelo','Core'];
const MUSCLE_SET_TARGET_MIN = 10, MUSCLE_SET_TARGET_MAX = 20, MUSCLE_SET_MAX_SCALE = 24;
function muscleSetCountsBetween(fromDate, toDate) {
  const counts = {};
  strengthActivities.filter(a => a.date >= fromDate && a.date < toDate).forEach(a => {
    Object.entries(a.muscle_group_sets || {}).forEach(([g,v]) => { counts[g] = (counts[g]||0) + v; });
  });
  return counts;
}
const lastWeekStart = new Date(new Date(weekStart+'T00:00:00Z').getTime() - 7*86400000).toISOString().slice(0,10);
const muscleSetCounts = muscleSetCountsBetween(weekStart, '9999-12-31');
const muscleSetCountsPrev = muscleSetCountsBetween(lastWeekStart, weekStart);
const extraMuscleGroups = Object.keys(muscleSetCounts).filter(g => !FINE_MUSCLE_GROUPS.includes(g) && muscleSetCounts[g] > 0);
const muscleGroupsToShow = [...FINE_MUSCLE_GROUPS, ...extraMuscleGroups];
document.getElementById('muscleSetsRow').innerHTML = muscleGroupsToShow.map(g => {
  const count = muscleSetCounts[g] || 0;
  const prevCount = muscleSetCountsPrev[g] || 0;
  const targetLeftPct = MUSCLE_SET_TARGET_MIN / MUSCLE_SET_MAX_SCALE * 100;
  const targetWidthPct = (MUSCLE_SET_TARGET_MAX - MUSCLE_SET_TARGET_MIN) / MUSCLE_SET_MAX_SCALE * 100;
  const fillPct = Math.min(100, count / MUSCLE_SET_MAX_SCALE * 100);
  const prevPct = Math.min(100, prevCount / MUSCLE_SET_MAX_SCALE * 100);
  const short = count < MUSCLE_SET_TARGET_MIN;
  return `<div class="load-bar-row">
    <div class="lb-head"><span class="name">${g}</span><span class="val num">${fmt(count,1)}<span style="color:var(--text-muted); font-weight:500;"> (sem. pasada ${fmt(prevCount,1)})</span></span></div>
    <div class="lb-track">
      <div class="lb-target" style="left:${targetLeftPct}%; width:${targetWidthPct}%;"></div>
      <div class="lb-fill${short ? ' short' : ''}" style="width:${fillPct}%;"></div>
      <div class="lb-prev-marker" style="left:${prevPct}%;"></div>
    </div>
  </div>`;
}).join('');
document.getElementById('muscleSetsNote').textContent =
  `Desde el lunes ${fmtDateShort(weekStart)} · series efectivas (sin calentamiento) · banda gris = rango orientativo ${MUSCLE_SET_TARGET_MIN}-${MUSCLE_SET_TARGET_MAX} series/semana por grupo (referencia general de hipertrofia, no un objetivo de Garmin) · línea gris = total de la semana pasada`;

// ---------- Progresión por ejercicio ----------
const exerciseHistory = {};
[...strengthActivities].sort((a,b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)).forEach(act => {
  (act.exercises || []).forEach(ex => {
    if (!ex.best_set) return;
    const key = ex.name;
    if (!exerciseHistory[key]) exerciseHistory[key] = { display_name: ex.display_name, typeCounts: {}, points: [] };
    const h = exerciseHistory[key];
    h.typeCounts[act.session_type] = (h.typeCounts[act.session_type]||0) + 1;
    h.points.push({ date: act.date, v: ex.best_set.weight_kg, extra: `${ex.best_set.reps} reps` });
  });
});
function dominantSessionType(h) {
  let best = null, bestN = -1;
  Object.entries(h.typeCounts).forEach(([t,n]) => { if (n > bestN) { bestN = n; best = t; } });
  return best;
}
const PROGRESSION_TABS = ['Todos','Push','Pull','Pierna'];
let progressionFilter = 'Todos';
function renderProgressionTabs() {
  document.getElementById('progressionTabs').innerHTML = PROGRESSION_TABS.map(t =>
    `<button type="button" class="act-filter-tab${progressionFilter===t?' active':''}" data-filter="${t}">${t}</button>`
  ).join('');
}
function renderProgressionCharts() {
  const entries = Object.values(exerciseHistory)
    .filter(h => h.points.length > 1)
    .filter(h => progressionFilter === 'Todos' || dominantSessionType(h) === progressionFilter)
    .sort((a,b) => b.points.length - a.points.length)
    .slice(0, 6);
  document.getElementById('progressionCharts').innerHTML = entries.length
    ? entries.map(h => lineChart(h.display_name, h.points, ' kg', 1)).join('')
    : '<div class="track-note">No hay suficientes sesiones todavía para ver progresión en esta categoría.</div>';
}
document.getElementById('progressionTabs').addEventListener('click', e => {
  const btn = e.target.closest('.act-filter-tab');
  if (!btn || btn.classList.contains('active')) return;
  progressionFilter = btn.dataset.filter;
  renderProgressionTabs();
  renderProgressionCharts();
});
renderProgressionTabs();
renderProgressionCharts();

// ---------- Tu perfil fisiológico ----------
const profile = DATA.profile || {};
document.getElementById('profileGrid').innerHTML = `
  <div class="chip"><div class="chip-label">FC máx. observada</div><div class="chip-val num">${profile.observedMaxHr ? fmt(profile.observedMaxHr,0) + ' ppm' : '—'}</div></div>
  <div class="chip"><div class="chip-label">FC umbral</div><div class="chip-val num">${profile.lactateThresholdHr ? fmt(profile.lactateThresholdHr,0) + ' ppm' : '—'}</div></div>
  <div class="chip"><div class="chip-label">VO2 max</div><div class="chip-val num">${fmt(DATA.vo2max.vo2MaxValue,0)}</div></div>
  <div class="chip"><div class="chip-label">Peso</div><div class="chip-val num">${profile.weightKg ? fmt(profile.weightKg,1) + ' kg' : '—'}</div></div>
`;
document.getElementById('profileZoneScale').innerHTML = [1,2,3,4,5].map(z => {
  const lo = ZONE_BOUNDS[z-1], hi = z < 5 ? ZONE_BOUNDS[z] - 1 : MAX_HR;
  return `<span style="display:inline-flex;align-items:center;gap:6px;">${zoneBadge(z)}<span class="num">${lo}–${hi}</span></span>`;
}).join('');
document.getElementById('profileNote').textContent = zonesAreReal
  ? `Estas son las zonas configuradas ahora mismo en tu reloj — con solo unas semanas de uso, es probable que Garmin las siga recalibrando (no las trates como algo definitivo todavía).`
  : `Garmin no devolvió zonas de FC configuradas — estimadas a partir de tu FC máxima observada.`;

// ---------- Fases de sueño (anoche) ----------
const STAGE_META = [
  { key: 'sleep_deep_min', label: 'Profundo', color: 'var(--accent)' },
  { key: 'sleep_light_min', label: 'Ligero', color: 'var(--cat-cycling)' },
  { key: 'sleep_rem_min', label: 'REM', color: 'var(--cat-strength)' },
  { key: 'sleep_awake_min', label: 'Despierto', color: 'var(--critical)' },
];
const lastStages = last;
const stageTotal = STAGE_META.reduce((s,st) => s + Number(lastStages[st.key]||0), 0);
if (stageTotal > 0) {
  document.getElementById('sleepStagesLabel').textContent = `Fases de sueño — anoche (${fmtDateShort(last.date)}, ${fmt(last.sleep_hours,1)} h)`;
  document.getElementById('sleepStagesBar').innerHTML = STAGE_META.map(st => {
    const mins = Number(lastStages[st.key]||0);
    const pct = mins / stageTotal * 100;
    return pct > 0 ? `<div class="seg" style="width:${pct}%; background:${st.color};"></div>` : '';
  }).join('');
  document.getElementById('sleepStagesLegend').innerHTML = STAGE_META.map(st => `
    <div class="li"><span class="sw" style="background:${st.color}"></span>${st.label} · ${fmt(lastStages[st.key],0)} min</div>`).join('');
} else {
  document.getElementById('sleepStagesLabel').textContent = '';
}

// ==================================================================
// Planificador semanal + Hoy
// ==================================================================
(function () {
  const DOW = ['mon','tue','wed','thu','fri','sat','sun'];
  const DOW_LABEL = { mon:'Lunes', tue:'Martes', wed:'Miércoles', thu:'Jueves', fri:'Viernes', sat:'Sábado', sun:'Domingo' };
  const AVAIL_LABEL = { no:'No puedo', rest:'Descanso', gym:'Gimnasio', run:'Correr', both:'Ambos' };
  const RUN_MIN = 20;
  const DEFAULT_STRENGTH_MIN = 90, DEFAULT_BIKE_MIN = 30;
  const EXCLUDE_LABEL = { leg: 'Pierna', push: 'Empuje', pull: 'Tirón', bike: 'Bici' };

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0,10);
  }
  function isoWeekId(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2,'0')}`;
  }
  function trailingAvg(key, n) {
    // Exclude today by date, not by position: dailyWithData already drops an
    // incomplete today, so when today IS complete it's the last row and this
    // still must not compare it against itself; when today is missing, the
    // last row is already yesterday and a positional slice(0,-1) would wrongly
    // drop that real day too.
    const rows = dailyWithData.filter(r => r.date !== todayStr);
    const vals = rows.filter(r => r[key] !== '' && r[key] !== undefined && r[key] !== null).slice(-n).map(r => Number(r[key]));
    if (!vals.length) return null;
    return vals.reduce((a,b)=>a+b,0) / vals.length;
  }
  function deltaChip(current, baseline, higherIsBetter, decimals, unit) {
    if (current === null || current === undefined || Number.isNaN(current) || baseline === null) {
      return { arrow: '', cls: 'flat', text: 'sin media de 7d aún' };
    }
    const diff = current - baseline;
    const threshold = Math.max(Math.abs(baseline) * 0.03, 0.05);
    if (Math.abs(diff) <= threshold) return { arrow: '→', cls: 'flat', text: `≈ media 7d (${fmt(baseline,decimals)}${unit})` };
    const better = higherIsBetter ? diff > 0 : diff < 0;
    return {
      arrow: diff > 0 ? '↑' : '↓',
      cls: better ? 'up' : 'down',
      text: `${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)}${unit} vs media 7d`,
    };
  }

  const weekEnd = addDays(weekStart, 6);
  const coachRunsThisWeek = coachPlan.filter(w => w.date >= weekStart && w.date <= weekEnd && w.sport === 'running');
  const activitiesThisWeek = DATA.activities.filter(a => a.date >= weekStart && a.date <= weekEnd);

  function normalizePlannerData(pd) {
    const days = {};
    DOW.forEach(dow => {
      const existing = (pd && pd.days && pd.days[dow]) || {};
      days[dow] = { avail: existing.avail || null, minutes: existing.minutes != null ? existing.minutes : 120 };
    });
    const s = (pd && pd.settings) || {};
    const settings = {
      strengthMin: s.strengthMin != null ? s.strengthMin : DEFAULT_STRENGTH_MIN,
      bikeMin: s.bikeMin != null ? s.bikeMin : DEFAULT_BIKE_MIN,
    };
    const ex = (pd && pd.excluded) || {};
    const excluded = { leg: !!ex.leg, push: !!ex.push, pull: !!ex.pull, bike: !!ex.bike };
    const runOverrides = Object.assign({}, (pd && pd.runOverrides) || {});
    const strengthOverrides = Object.assign({}, (pd && pd.strengthOverrides) || {});
    return { days, settings, excluded, runOverrides, strengthOverrides };
  }

  // A day already has real Garmin activities logged on it -> turn each into a
  // "done" session instead of asking the scheduler to guess at it.
  const STRENGTH_SUB_FOR_TYPE = { Push: 'push', Pull: 'pull', Pierna: 'leg' };
  function sessionFromActivity(a) {
    if (a.type === 'running') {
      const coachMatch = coachPlan.find(w => w.date === a.date && w.sport === 'running' && w.status === 'done');
      return { type: 'run', label: (coachMatch && coachMatch.title) || a.name, status: 'done' };
    }
    if (a.type === 'strength_training') {
      const sub = STRENGTH_SUB_FOR_TYPE[a.session_type] || null;
      return { type: 'strength', sub, label: a.name || 'Fuerza', status: 'done' };
    }
    if (a.type === 'indoor_cycling') {
      return { type: 'bike', label: a.name || 'Bici', status: 'done' };
    }
    const meta = CAT_META[a.type];
    return { type: 'other', label: (meta && meta.label) || a.type, status: 'done' };
  }

  // ---- Core scheduler: pure function of (days, coach runs, logged activities) ----
  // Days that already happened only ever show what was actually logged (or,
  // lacking that, count as a natural rest day) — the scheduler only ever
  // proposes NEW sessions on today or later, and only on days without a
  // logged activity yet, so the plan fills itself in as the week goes by.
  // Garmin Coach's calendar is the source of truth for runs: every scheduled
  // run for the week is placed on its own date, unconditionally — no cap, no
  // automatic relocation. The only way a run moves or disappears is a manual
  // per-run override (move/skip) saved from the panel.
  // Days since the most recent LOGGED session of this sub-type (push/pull/leg),
  // using session_type from any strength activity in the export — not just this
  // week, so last week's sessions count too. Infinity if never logged.
  function daysSinceLastSession(subType) {
    const matches = DATA.activities.filter(a => a.type === 'strength_training' && a.session_type === subType);
    if (!matches.length) return Infinity;
    const mostRecent = matches.reduce((latest, a) => (a.date > latest ? a.date : latest), matches[0].date);
    return (new Date(todayStr) - new Date(mostRecent)) / 86400000;
  }

  function computeWeekPlan(norm) {
    const { days, settings, excluded, runOverrides, strengthOverrides } = norm;
    const strengthMin = settings.strengthMin, bikeMin = settings.bikeMin;
    const plan = DOW.map((dow, i) => {
      const date = addDays(weekStart, i);
      const dayActs = activitiesThisWeek.filter(a => a.date === date);
      const locked = dayActs.length > 0;
      const avail = days[dow].avail;
      const minutes = days[dow].minutes || 0;
      const schedulable = !locked && date >= todayStr;
      return {
        dow, date, locked, schedulable, avail, minutes,
        remaining: schedulable && avail && avail !== 'no' && avail !== 'rest' ? minutes : 0,
        sessions: locked ? dayActs.map(sessionFromActivity) : [],
      };
    });
    const byDate = Object.fromEntries(plan.map(d => [d.date, d]));
    const dropped = [], moves = [], notes = [], warnings = [];
    const canRun = d => d.schedulable && (d.avail === 'run' || d.avail === 'both');
    const canStrength = d => d.schedulable && (d.avail === 'gym' || d.avail === 'both');
    const isRaceDay = d => d.sessions.some(s => s.type === 'run' && s.status !== 'skipped');
    const isEasyRunLabel = label => /suave|f[aá]cil/i.test(label || '');
    const dayHasQualityRun = d => d.sessions.some(s => s.type === 'run' && s.status !== 'skipped' && !isEasyRunLabel(s.label));

    // 1) Coach runs — every run scheduled this week gets placed, always, unless the
    // owner explicitly skipped it or moved it to a different day from the panel.
    coachRunsThisWeek.slice().sort((a,b) => a.date < b.date ? -1 : 1).forEach(run => {
      if (run.status === 'done') return; // already represented via its logged activity
      const override = runOverrides[run.date];
      if (override && override.action === 'skip') {
        const origDay = byDate[run.date];
        if (origDay) origDay.sessions.push({ type:'run', label: run.title, status:'skipped', origDate: run.date });
        return;
      }
      const targetDate = (override && override.action === 'move' && byDate[override.to]) ? override.to : run.date;
      const target = byDate[targetDate] || byDate[run.date];
      const estMin = (run.detail && run.detail.estimated_duration_sec) ? Math.round(run.detail.estimated_duration_sec/60) : 30;
      const used = target.remaining > 0 ? Math.min(estMin, target.remaining) : estMin;
      const moved = targetDate !== run.date;
      target.sessions.push({
        type:'run', label: run.title, estMin: used, short: used < estMin,
        status: run.status === 'missed' ? 'missed' : 'pending',
        origDate: run.date, moved,
        unconfirmedAvail: target.avail == null,
        detail: run.detail,
      });
      target.remaining = Math.max(0, target.remaining - used);
      if (moved) moves.push({ title: run.title, from: run.date, to: target.date });
    });

    // Sessions already done this week (from real activities) don't need scheduling again.
    const fulfilledSubs = new Set();
    plan.forEach(d => { if (d.locked) d.sessions.forEach(s => { if (s.type === 'strength' && s.sub) fulfilledSubs.add(s.sub); }); });

    // Race days this week, in order, each tagged easy/quality from its session label.
    // "Quality" = anything not explicitly suave/fácil (zancadas, series, ritmo, umbral,
    // tempo, carreras de referencia all default to the stricter 72h margin).
    const raceDays = plan
      .filter(isRaceDay)
      .map(d => ({ date: d.date, isEasy: d.sessions.filter(s => s.type === 'run' && s.status !== 'skipped').every(s => isEasyRunLabel(s.label)) }))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    const nextWeekFirstRun = coachPlan.find(w => w.sport === 'running' && w.date > weekEnd);
    function nextRaceAfter(dateStr) {
      const inWeek = raceDays.find(r => r.date > dateStr);
      if (inWeek) return inWeek;
      if (nextWeekFirstRun) return { date: nextWeekFirstRun.date, isEasy: isEasyRunLabel(nextWeekFirstRun.title) };
      return null;
    }
    function hoursBetween(dateA, dateB) {
      return (Date.parse(dateB + 'T00:00:00Z') - Date.parse(dateA + 'T00:00:00Z')) / 36e5;
    }
    const baseStrengthCandidates = excludeDates => plan.filter(d =>
      canStrength(d) && d.remaining >= strengthMin && !isRaceDay(d) && !excludeDates.has(d.date));

    // 2) Pierna — el día disponible con más horas hasta la siguiente carrera (contando
    // también la primera carrera de Coach de la semana que viene), respetando el margen
    // mínimo (48h si esa carrera es suave, 72h si es de calidad). Nunca el mismo día que
    // una carrera ni la víspera — eso ya queda excluido porque la víspera da <48h de margen.
    // Si ningún día cumple el mínimo, se usa el mejor disponible y se avisa. Se coloca
    // ANTES de reservar el descanso: si solo queda un día libre en toda la semana, pierna
    // tiene prioridad (con su propio aviso de margen) sobre reservarlo como descanso.
    const reservedDates = new Set();
    let legDay = null, legMovedByUser = false;
    if (!fulfilledSubs.has('leg') && !excluded.leg) {
      // A manual override is honored as long as the day is still free to use —
      // margin-to-race is checked only to warn, never to block the user's choice.
      const overrideDate = strengthOverrides.leg;
      if (overrideDate) {
        const forced = byDate[overrideDate];
        if (forced && forced.schedulable && !reservedDates.has(forced.date)) {
          legDay = forced;
          legMovedByUser = true;
          const next = nextRaceAfter(forced.date);
          const marginHours = next ? hoursBetween(forced.date, next.date) : Infinity;
          const minHours = next ? (next.isEasy ? 48 : 72) : 0;
          if (marginHours < minHours) {
            warnings.push(`Pierna el ${fmtDateShort(forced.date)} (movida por ti) queda con menos del margen recomendado antes de la próxima carrera.`);
          }
        }
      }
      if (!legDay) {
        const scored = baseStrengthCandidates(reservedDates).map(d => {
          const next = nextRaceAfter(d.date);
          const marginHours = next ? hoursBetween(d.date, next.date) : Infinity;
          const minHours = next ? (next.isEasy ? 48 : 72) : 0;
          return { d, marginHours, ok: marginHours >= minHours };
        });
        const valid = scored.filter(x => x.ok).sort((a, b) => b.marginHours - a.marginHours);
        if (valid.length) {
          legDay = valid[0].d;
        } else if (scored.length) {
          scored.sort((a, b) => b.marginHours - a.marginHours);
          legDay = scored[0].d;
          warnings.push(`Pierna el ${fmtDateShort(legDay.date)} queda con menos del margen recomendado antes de la próxima carrera — no había alternativa libre esta semana.`);
        } else {
          dropped.push('Pierna (ningún día de gimnasio libre esta semana)');
        }
      }
      if (legDay) { legDay.sessions.push({ type: 'strength', sub: 'leg', label: 'Pierna', estMin: strengthMin, status: 'pending', movedByUser: legMovedByUser }); legDay.remaining -= strengthMin; }
    }
    if (legDay) reservedDates.add(legDay.date);

    // 3) Día de descanso — un día ya marcado "No puedo"/"Descanso", o un día ya pasado
    // sin actividad registrada, YA cuenta como descanso completo: si existe al menos uno,
    // no se reserva ningún otro. Solo si no hay ninguno se busca uno hueco (preferiblemente
    // la víspera de la primera sesión de calidad de la semana, si no la del primer día de
    // carrera), y nunca a costa de dejar a empuje o tirón sin ningún día posible cuando sí
    // hay alternativa.
    const hasRestDay = plan.some(d => d.avail === 'no' || d.avail === 'rest' || (d.date < todayStr && !d.locked));
    let restDay = null;
    if (!hasRestDay) {
      const strengthNeeded = (fulfilledSubs.has('push') || excluded.push ? 0 : 1) + (fulfilledSubs.has('pull') || excluded.pull ? 0 : 1);
      const wouldStarve = dateToReserve => {
        if (strengthNeeded === 0) return false;
        const excl = new Set([dateToReserve]);
        if (legDay) excl.add(legDay.date);
        return baseStrengthCandidates(excl).length < 1;
      };
      const firstQualityRace = raceDays.find(r => !r.isEasy);
      const blockStart = (firstQualityRace || raceDays[0] || {}).date;
      if (blockStart) {
        const blockIdx = plan.findIndex(d => d.date === blockStart);
        for (let i = blockIdx - 1; i >= 0; i--) {
          const cand = plan[i];
          if (cand.schedulable && !isRaceDay(cand) && cand.sessions.length === 0 && !wouldStarve(cand.date)) { restDay = cand; break; }
        }
      }
    }
    if (restDay) reservedDates.add(restDay.date);

    // 4) Empuje y tirón — en días distintos entre sí y distintos de pierna/descanso;
    // se intenta que no queden en días consecutivos, cuando el hueco disponible lo permite.
    // A diferencia de pierna, SÍ pueden ir la víspera de cualquier carrera (también de
    // calidad) — el margen de 48h/72h es solo para pierna. Como último recurso, si no
    // cabe en ningún día sin carrera, pueden compartir un día "both" con una carrera si
    // sobran minutos tras ella (se prioriza la carrera suave sobre la de calidad).
    // Whichever of the two has gone longer since its last LOGGED session (across the
    // whole export, not just this week) gets first pick of the earliest free day.
    let pushDay = null, pullDay = null;
    const isAdjacent = (a, b) => Math.abs(plan.indexOf(a) - plan.indexOf(b)) === 1;
    const pushPullBySub = { push: ['push', 'Empuje'], pull: ['pull', 'Tirón'] };
    const pushPullOrder = ['push', 'pull']
      .sort((a, b) => daysSinceLastSession(a === 'push' ? 'Push' : 'Pull') < daysSinceLastSession(b === 'push' ? 'Push' : 'Pull') ? 1 : -1)
      .map(sub => pushPullBySub[sub]);
    pushPullOrder.forEach(([sub, label]) => {
      if (fulfilledSubs.has(sub) || excluded[sub]) return;
      const otherDay = sub === 'push' ? pullDay : pushDay;
      let pick = null, combined = false, onRaceDay = false, movedByUser = false;
      // A manual override is honored as long as the day is still free; otherwise
      // fall through to the normal automatic placement below.
      const overrideDate = strengthOverrides[sub];
      if (overrideDate) {
        const forced = byDate[overrideDate];
        if (forced && forced.schedulable && !reservedDates.has(forced.date)) { pick = forced; movedByUser = true; }
      }
      if (!pick) {
        const cand = baseStrengthCandidates(reservedDates).sort((a, b) => a.date < b.date ? -1 : 1);
        if (otherDay) {
          pick = cand.find(d => !isAdjacent(d, otherDay) && d.date !== otherDay.date)
            || cand.find(d => d.date !== otherDay.date);
          if (!pick && cand.length) { pick = otherDay.remaining >= strengthMin ? otherDay : cand[0]; combined = pick.date === otherDay.date; }
        } else {
          pick = cand[0];
        }
      }
      if (!pick) {
        const raceCand = plan.filter(d => d.schedulable && d.avail === 'both' && d.remaining >= strengthMin && !reservedDates.has(d.date) && isRaceDay(d))
          .sort((a, b) => {
            const aEasy = !dayHasQualityRun(a), bEasy = !dayHasQualityRun(b);
            if (aEasy !== bEasy) return aEasy ? -1 : 1;
            return a.date < b.date ? -1 : 1;
          });
        if (raceCand.length) { pick = raceCand[0]; onRaceDay = true; }
      }
      if (pick) {
        pick.sessions.push({ type: 'strength', sub, label, estMin: strengthMin, status: 'pending', movedByUser });
        pick.remaining -= strengthMin;
        reservedDates.add(pick.date);
        if (sub === 'push') pushDay = pick; else pullDay = pick;
        if (combined) notes.push(`Empuje y tirón han tenido que ir el mismo día (${fmtDateShort(pick.date)}) — no quedaba otro hueco esta semana.`);
        if (onRaceDay) notes.push(`${label} el ${fmtDateShort(pick.date)} coincide con una carrera — hazlo después de correr.`);
      } else dropped.push(label);
    });

    // 5) Bici tras fuerza — una sugerencia por cada sesión de fuerza recién colocada
    // (mismo día si queda tiempo, si no el día siguiente). Z1 corta tras pierna, Z2 tras
    // torso, o Z2 baja si al día siguiente de la bici hay una sesión de carrera de calidad.
    // Nunca se añade en un día que ya tiene una carrera, ni en uno que ya tenga OTRA sesión
    // de fuerza (puede pasar si una sesión se movió a mano a un día sin minutos propios y
    // su bici tendría que desbordar justo al día de otra fuerza) — ahí se omite la bici en
    // vez de etiquetarla con la zona que no le corresponde.
    if (!excluded.bike) {
      const placedStrength = [];
      if (legDay) placedStrength.push({ day: legDay, sub: 'leg' });
      if (pushDay) placedStrength.push({ day: pushDay, sub: 'push' });
      if (pullDay && pullDay !== pushDay) placedStrength.push({ day: pullDay, sub: 'pull' });
      placedStrength.forEach(({ day, sub }) => {
        if (isRaceDay(day)) return;
        const i = plan.indexOf(day);
        let target = null;
        if (day.remaining >= bikeMin) target = day;
        else if (i < plan.length - 1 && plan[i + 1].schedulable && plan[i + 1].remaining >= bikeMin && !plan[i + 1].sessions.some(s => s.type === 'strength')) target = plan[i + 1];
        if (!target) return;
        const j = plan.indexOf(target);
        const qualityNext = j < plan.length - 1 && dayHasQualityRun(plan[j + 1]);
        let label, zone;
        if (qualityNext) { label = 'Bici Z2 baja 25-30 min'; zone = 'z2'; }
        else if (sub === 'leg') { label = 'Bici Z1 10-15 min'; zone = 'z1'; }
        else { label = 'Bici Z2 40 min'; zone = 'z2'; }
        target.sessions.push({ type: 'bike', label, zone, estMin: bikeMin, status: 'pending' });
        target.remaining -= Math.min(bikeMin, target.remaining);
      });
    }

    // 6) Avisos de entrenador
    const activeRuns = plan.flatMap((d,i) => d.sessions.filter(s=>s.type==='run' && s.status!=='skipped').map(s => ({...s, date:d.date, idx:i})));
    if (activeRuns.length > 3) {
      warnings.push(`Semana con ${activeRuns.length} carreras: considera saltar una.`);
    }
    let streak = 0, maxStreak = 0, streakDates = [], bestStreakDates = [];
    plan.forEach(d => {
      if (d.sessions.some(s=>s.type==='run' && s.status!=='skipped')) {
        streak++; streakDates.push(d.date);
        if (streak > maxStreak) { maxStreak = streak; bestStreakDates = streakDates.slice(); }
      } else { streak = 0; streakDates = []; }
    });
    if (maxStreak > 2) {
      warnings.push(`${maxStreak} carreras en días seguidos (${bestStreakDates.map(fmtDateShort).join(', ')}) — valora mover una.`);
    }
    if (!plan.some(d => d.sessions.length === 0)) {
      warnings.push('Esta semana no ha quedado ningún día de descanso completo — intenta liberar al menos uno.');
    }

    return { plan, dropped, moves, notes, warnings };
  }

  // ---- Rendering ----
  const STATUS_LABEL = { done:'hecho', pending:'pendiente', missed:'perdida', skipped:'saltada por ti' };

  function renderSessionLine(s, currentDate, owner, weekFutureDays, strengthMoveDays, pendingStrength) {
    const bits = [];
    if (s.status) bits.push(STATUS_LABEL[s.status] || s.status);
    if (s.unconfirmedAvail) bits.push('según Coach, sin confirmar disponibilidad');
    if (s.short) bits.push('acortada para caber en el hueco');
    if (s.moved) bits.push(`movida desde ${fmtDateShort(s.origDate)} — mueve también esta sesión en Garmin Connect`);
    if (s.movedByUser) bits.push('movida por ti');
    const meta = bits.length ? ` (${bits.join(' · ')})` : '';
    let controls = '';
    if (owner && s.type === 'run') {
      if (s.status === 'pending' || s.status === 'missed') {
        const moveOptions = weekFutureDays.filter(d => d.date !== currentDate).map(d => `<option value="${d.date}">${d.label}</option>`).join('');
        controls = `<div class="run-controls">
          <select class="planner-select run-move-select" data-run-orig="${s.origDate}">
            <option value="">${s.moved ? 'Volver al día de Coach' : 'Mover a…'}</option>
            ${moveOptions}
          </select>
          <button type="button" class="planner-skip-btn" data-run-skip="${s.origDate}">Saltar</button>
        </div>`;
      } else if (s.status === 'skipped') {
        controls = `<button type="button" class="planner-skip-btn" data-run-unskip="${s.origDate}">Deshacer</button>`;
      }
    } else if (owner && s.type === 'strength' && s.status === 'pending' && s.sub) {
      const moveOptions = strengthMoveDays.filter(d => d.date !== currentDate).map(d => `<option value="${d.date}">${d.label}</option>`).join('');
      const others = pendingStrength.filter(o => o.sub !== s.sub);
      const swapOptions = others.map(o => `<option value="${o.sub}">${o.label} (${fmtDateShort(o.date)})</option>`).join('');
      controls = `<div class="run-controls">
        <select class="planner-select strength-move-select" data-strength-sub="${s.sub}">
          <option value="">${s.movedByUser ? 'Volver al reparto automático' : 'Mover a…'}</option>
          ${moveOptions}
        </select>
        ${others.length ? `<select class="planner-select strength-swap-select" data-strength-sub="${s.sub}">
          <option value="">Intercambiar…</option>
          ${swapOptions}
        </select>` : ''}
      </div>`;
    }
    const strike = s.status === 'skipped' ? ' style="text-decoration:line-through;opacity:0.6;"' : '';
    return `<div class="planner-session-line"><span${strike}>${s.label}${meta}</span>${controls}</div>`;
  }

  function renderPlannerUI(norm, owner, result) {
    const { days, settings, excluded, strengthOverrides } = norm;
    const weekFutureDays = result.plan.filter(d => d.date >= todayStr).map(d => ({ date: d.date, label: `${DOW_LABEL[d.dow]} ${fmtDateShort(d.date)}` }));
    // Strength sessions can only be moved onto days that aren't already locked by a
    // real logged activity (runs reuse weekFutureDays above, unaffected by this).
    const strengthMoveDays = result.plan.filter(d => d.schedulable).map(d => ({ date: d.date, label: `${DOW_LABEL[d.dow]} ${fmtDateShort(d.date)}` }));
    const pendingStrength = [];
    result.plan.forEach(d => d.sessions.forEach(s => { if (s.type === 'strength' && s.status === 'pending' && s.sub) pendingStrength.push({ sub: s.sub, label: s.label, date: d.date }); }));

    const settingsRow = owner ? `
    <div class="planner-settings">
      <label>Duración fuerza <input type="number" min="10" step="5" data-setting="strengthMin" value="${settings.strengthMin}"> min</label>
      <label>Duración bici <input type="number" min="10" step="5" data-setting="bikeMin" value="${settings.bikeMin}"> min</label>
    </div>
    <div class="planner-exclude">
      ${['leg','push','pull','bike'].map(sub => `<label><input type="checkbox" data-exclude="${sub}" ${excluded[sub]?'checked':''}> Sin ${EXCLUDE_LABEL[sub]} esta semana</label>`).join('')}
    </div>` : (() => {
      const excludedList = ['leg','push','pull','bike'].filter(sub => excluded[sub]).map(sub => EXCLUDE_LABEL[sub]);
      return `<div class="planner-settings">Fuerza: ${settings.strengthMin} min · Bici: ${settings.bikeMin} min${excludedList.length ? ' · Esta semana sin: ' + excludedList.join(', ') : ''}</div>`;
    })();

    const rows = DOW.map((dow, i) => {
      const date = addDays(weekStart, i);
      const d = days[dow];
      const planDay = result.plan[i];
      const isPast = date < todayStr;
      const editable = owner && planDay.schedulable;
      const assignedText = planDay.sessions.length
        ? planDay.sessions.map(s => renderSessionLine(s, date, owner, weekFutureDays, strengthMoveDays, pendingStrength)).join('')
        : (planDay.locked ? '—' : (d.avail === 'rest' ? 'Descanso' : (isPast ? 'Descanso' : (d.avail === 'no' ? '—' : 'Libre'))));
      let controls;
      if (editable) {
        controls = `
        <select class="planner-select" data-field="avail" data-dow="${dow}">
          ${['no','rest','gym','run','both'].map(v => `<option value="${v}" ${d.avail===v?'selected':''}>${AVAIL_LABEL[v]}</option>`).join('')}
        </select>
        <input class="planner-input num" type="number" min="0" step="5" data-field="minutes" data-dow="${dow}" value="${d.minutes}"> min
      `;
      } else if (planDay.locked) {
        controls = `<span class="planner-readonly-val">Ya registrado</span>`;
      } else if (isPast) {
        controls = `<span class="planner-readonly-val">Día pasado</span>`;
      } else {
        controls = `<span class="planner-readonly-val">${d.avail ? AVAIL_LABEL[d.avail] : 'Sin definir'}${d.avail && d.avail!=='no' && d.avail!=='rest' ? ' · ' + d.minutes + ' min' : ''}</span>`;
      }
      return `
      <div class="planner-row${date===todayStr?' is-today':''}">
        <div class="planner-day">${DOW_LABEL[dow]}<div class="dd">${fmtDateShort(date)}</div></div>
        ${controls}
        <div class="planner-assigned">${assignedText}</div>
      </div>`;
    }).join('');

    document.getElementById('plannerBody').innerHTML = settingsRow + rows;

    const bits = [];
    if (result.moves.length) bits.push(`<div class="insight"><div class="dot neutral"></div><p>${result.moves.map(m=>`Moviste <strong>${m.title}</strong> del ${fmtDateShort(m.from)} al ${fmtDateShort(m.to)} en el panel — mueve también esta sesión en Garmin Connect.`).join(' ')}</p></div>`);
    if (result.dropped.length) bits.push(`<div class="insight"><div class="dot warning"></div><p>No caben esta semana: <strong>${result.dropped.join(', ')}</strong>.</p></div>`);
    result.warnings.forEach(w => bits.push(`<div class="insight"><div class="dot warning"></div><p>${w}</p></div>`));
    result.notes.forEach(n => bits.push(`<div class="insight"><div class="dot neutral"></div><p>${n}</p></div>`));
    if (owner && Object.keys(strengthOverrides).length) {
      bits.push(`<div class="insight"><div class="dot neutral"></div><p>Has movido sesiones de fuerza a mano esta semana. <button type="button" class="planner-skip-btn" data-reset-strength="1">Restablecer</button></p></div>`);
    }
    if (!bits.length) bits.push(`<div class="insight"><div class="dot good"></div><p>Todo encaja esta semana con la disponibilidad indicada.</p></div>`);
    document.getElementById('plannerSummary').innerHTML = bits.join('');

    document.getElementById('plannerOwnerNote').textContent = owner
      ? ''
      : 'Solo el propietario del panel puede editar la disponibilidad — tú lo ves en modo lectura.';
  }

  function renderTodayCard(result) {
    const todayEntry = result.plan.find(d => d.date === todayStr);
    updateReadinessInsight(todayEntry);
    const readiness = lastReadiness.training_readiness;
    let sem;
    if (readiness === '' || readiness === undefined) sem = { cls:'flat', title:'Sin Training Readiness todavía', advice:'Aún no hay dato de hoy.' };
    else if (readiness >= 60) sem = { cls:'good', title:`Training Readiness ${fmt(readiness,0)} — Verde`, advice:'Entrena lo previsto.' };
    else if (readiness >= 40) sem = { cls:'warn', title:`Training Readiness ${fmt(readiness,0)} — Amarillo`, advice:'Suaviza: Z2 o técnica.' };
    else sem = { cls:'bad', title:`Training Readiness ${fmt(readiness,0)} — Rojo`, advice:'Descanso o Z2 muy suave.' };

    const semEl = document.getElementById('todaySemaphore');
    semEl.className = 'today-semaphore ' + sem.cls;
    semEl.innerHTML = `<div class="dot-big ${sem.cls}"></div><div><div class="tsm-title">${sem.title}</div><div class="tsm-sub">${sem.advice}</div></div>`;

    const z2Low = ZONE_BOUNDS[1], z2High = ZONE_BOUNDS[2] - 1;
    const metrics = [
      { key:'hrv_avg', label:'HRV', unit:' ms', higher:true, dec:0, pending:true },
      { key:'resting_hr', label:'FC reposo', unit:' ppm', higher:false, dec:0 },
      { key:'sleep_hours', label:'Horas sueño', unit:' h', higher:true, dec:1, pending:true },
      { key:'sleep_score', label:'Sueño', unit:'/100', higher:true, dec:0, pending:true },
    ];
    document.getElementById('recoveryGrid').innerHTML = metrics.map(m => {
      if (m.pending && !todayDailyComplete) {
        return `<div class="recovery-item">
          <div class="rl">${m.label}</div>
          <div class="rv" style="color:var(--text-muted);font-size:12.5px;font-weight:500;">pendiente de sincronizar el reloj</div>
        </div>`;
      }
      const todayRaw = todayDailyRaw ? todayDailyRaw[m.key] : undefined;
      const curRaw = (todayRaw !== '' && todayRaw !== undefined && todayRaw !== null) ? todayRaw : last[m.key];
      const cur = (curRaw === '' || curRaw === undefined) ? null : Number(curRaw);
      const base = trailingAvg(m.key, 7);
      const d = deltaChip(cur, base, m.higher, m.dec, m.unit);
      return `<div class="recovery-item">
        <div class="rl">${m.label}</div>
        <div class="rv num">${cur===null?'—':fmt(cur,m.dec)}${cur===null?'':m.unit}<span class="rd ${d.cls}">${d.arrow}</span></div>
        <div class="rf">${d.text}</div>
      </div>`;
    }).join('');

    let sessionHtml;
    if (!todayEntry || !todayEntry.sessions.length) {
      sessionHtml = `<div class="tb-main">Día libre</div><div class="tb-sub">No hay ninguna sesión planificada hoy.</div>`;
    } else {
      sessionHtml = todayEntry.sessions.map(s => {
        if (s.status === 'done') {
          return `<div class="tb-main">${s.label} <span style="font-weight:500;color:var(--good);font-size:11.5px;">(hecho hoy)</span></div>`;
        }
        if (s.status === 'skipped') {
          return `<div class="tb-main" style="text-decoration:line-through;opacity:0.6;">${s.label}</div><div class="tb-sub">Saltada desde el planificador.</div>`;
        }
        let sub = '';
        if (s.status === 'missed') sub = 'Coach la tenía programada y no se hizo — muévela desde el planificador si quieres recuperarla.';
        else if (sem.cls === 'bad') sub = `Sugerencia: descanso o Z2 muy suave (${z2Low}–${z2High} ppm) en vez de esto.`;
        else if (sem.cls === 'warn') {
          if (s.type === 'strength') sub = 'Suaviza: baja el peso o cámbialo por técnica / Z2.';
          else if (s.type === 'run') sub = 'Sin forzar tramos opcionales — deja que marque Coach.';
        }
        if (!sub && s.type === 'run' && /f[aá]cil|suave/i.test(s.label)) {
          sub = `Objetivo: Z2 del reloj (${z2Low}–${z2High} ppm). Si sube, camina.`;
        }
        const flags = [s.short ? 'acortada para caber en el hueco' : '', s.moved ? 'movida — mueve también esta sesión en Garmin Connect' : '', s.unconfirmedAvail ? 'según Coach, sin confirmar disponibilidad' : ''].filter(Boolean).join(' · ');
        const hasSteps = s.type === 'run' && s.detail && s.detail.steps && s.detail.steps.length;
        const stepsHtml = hasSteps ? planStepsHtml(s.detail, true) : '';
        const pendingNote = (s.type === 'run' && !hasSteps) ? `<div class="tb-sub" style="font-style:italic;">Pendiente de concretar por Coach.</div>` : '';
        return `<div class="tb-main">${s.label}${flags ? ` <span style="font-weight:500;color:var(--text-muted);font-size:11.5px;">(${flags})</span>` : ''}</div>${sub ? `<div class="tb-sub">${sub}</div>` : ''}${stepsHtml}${pendingNote}`;
      }).join('');
    }
    document.getElementById('todaySession').innerHTML = sessionHtml;

    const lastAct = DATA.activities[0];
    if (lastAct) {
      const meta = CAT_META[lastAct.type] || { label: lastAct.type, icon: '•' };
      const lastRpe = lastAct.rpe !== undefined && lastAct.rpe !== null && lastAct.rpe !== '' ? Number(lastAct.rpe) : null;
      const lastHighEffortEasy = lastRpe !== null && lastRpe >= 7 && wasIntendedEasy(lastAct);
      const lastEvalChips = [];
      if (lastAct.feel_label) lastEvalChips.push(`<span class="eval-chip">${lastAct.feel_label}</span>`);
      if (lastRpe !== null) lastEvalChips.push(`<span class="eval-chip${lastHighEffortEasy ? ' warn' : ''}">Esfuerzo ${fmt(lastRpe,0)}/10</span>`);
      document.getElementById('todayLastActivity').innerHTML = `
        <div class="tb-main">${lastAct.name}</div>
        <div class="tb-sub">${fmtDateShort(lastAct.date)} · ${meta.label} · ${fmt(lastAct.duration_min,0)} min${lastAct.avg_hr ? ' · ' + fmt(lastAct.avg_hr,0) + ' ppm' : ''}</div>
        ${lastEvalChips.length ? `<div class="act-chips" style="padding-left:0;margin-top:6px;">${lastEvalChips.join('')}</div>` : ''}
        ${lastHighEffortEasy ? `<div class="act-chips" style="padding-left:0;"><span class="act-chip warn">Esfuerzo alto para sesión suave</span></div>` : ''}
        ${realZoneBar(lastAct.hr_zones)}`;
    } else {
      document.getElementById('todayLastActivity').innerHTML = `<div class="tb-sub">Sin actividades registradas.</div>`;
    }

    const glucose = DATA.glucose || { available: false };
    const glucoseRowEl = document.getElementById('glucoseRow');
    const latestEl = document.getElementById('glucoseLatest');
    const tirEl = document.getElementById('glucoseTIR');
    if (glucose.available) {
      document.getElementById('glucoseLabel').textContent = 'Glucosa';
      glucoseRowEl.className = 'glucose-row';

      const latest = glucose.latest;
      if (latest) {
        const arrowCls = latest.trend === 'DOWN_FAST' ? 'down-fast' : (latest.trend === 'DOWN_SLOW' ? 'down' : '');
        latestEl.innerHTML = `<div class="glucose-latest">
          <span class="gv num">${fmt(latest.value_mgdl,0)}</span><span class="meta">mg/dL</span>
          <span class="arrow ${arrowCls}">${latest.trend_arrow}</span><span class="meta">${latest.trend_label}</span>
          <span class="meta">· ${latest.time}</span>
        </div>`;
      } else {
        latestEl.innerHTML = '';
      }

      glucoseRowEl.innerHTML = '';

      const tir = glucose.time_in_range;
      if (tir && tir.available) {
        tirEl.innerHTML = `
          <div class="tir-bar">
            ${tir.below_pct > 0 ? `<div class="seg low" style="width:${tir.below_pct}%;" title="Bajo rango: ${tir.below_pct}%"></div>` : ''}
            <div class="seg in" style="width:${tir.in_range_pct}%;" title="En rango: ${tir.in_range_pct}%"></div>
            ${tir.above_pct > 0 ? `<div class="seg high" style="width:${tir.above_pct}%;" title="Por encima: ${tir.above_pct}%"></div>` : ''}
          </div>
          <div class="tir-legend">
            <span><span class="sw" style="background:var(--good)"></span>En rango (${fmt(tir.range_low,0)}-${fmt(tir.range_high,0)}): ${tir.in_range_pct}%</span>
            <span><span class="sw" style="background:var(--critical)"></span>Bajo: ${tir.below_pct}%</span>
            <span><span class="sw" style="background:var(--warning)"></span>Alto: ${tir.above_pct}%</span>
          </div>`;
      } else {
        tirEl.innerHTML = '';
      }

      document.getElementById('glucoseNote').textContent = `Libre 2 vía LibreLinkUp · ventana de ~12h en cada sincronización`;
    } else {
      document.getElementById('glucoseLabel').textContent = 'Glucosa';
      latestEl.innerHTML = '';
      tirEl.innerHTML = '';
      glucoseRowEl.className = 'glucose-row unavailable';
      glucoseRowEl.innerHTML = '';
      const reasonNote = {
        not_configured: 'Pendiente de conectar Libre 2',
        login_failed: 'No se pudo conectar con LibreLinkUp en la última sincronización',
        no_patient: 'Cuenta LibreLinkUp sin paciente vinculado',
        no_readings: 'Sin lecturas recientes del sensor',
      }[glucose.reason] || 'Sin datos de glucosa disponibles';
      document.getElementById('glucoseNote').textContent = reasonNote;
    }
  }

  // ---- Capability wiring ----
  let plannerData = null;
  let isOwnerFlag = false;

  function rerender() {
    const norm = normalizePlannerData(plannerData);
    const result = computeWeekPlan(norm);
    renderPlannerUI(norm, isOwnerFlag, result);
    renderTodayCard(result);
  }
  rerender(); // render immediately with defaults so the page is never empty

  let saveFn = null;
  document.getElementById('plannerBody').addEventListener('change', async (e) => {
    if (!isOwnerFlag) return;
    const t = e.target;
    const norm = normalizePlannerData(plannerData);
    if (t.dataset.runOrig) {
      if (t.value) norm.runOverrides[t.dataset.runOrig] = { action: 'move', to: t.value };
      else delete norm.runOverrides[t.dataset.runOrig];
    } else if (t.dataset.strengthSub && t.classList.contains('strength-move-select')) {
      const sub = t.dataset.strengthSub;
      if (t.value) norm.strengthOverrides[sub] = t.value;
      else delete norm.strengthOverrides[sub];
    } else if (t.dataset.strengthSub && t.classList.contains('strength-swap-select')) {
      const subA = t.dataset.strengthSub, subB = t.value;
      if (subB) {
        // Swap uses each sub's CURRENT date (auto-placed or already overridden),
        // not its original auto-placement, so repeated swaps stay consistent.
        const currentPlan = computeWeekPlan(norm).plan;
        const dateOf = sub => {
          const day = currentPlan.find(d => d.sessions.some(s => s.type === 'strength' && s.sub === sub && s.status === 'pending'));
          return day ? day.date : null;
        };
        const dateA = dateOf(subA), dateB = dateOf(subB);
        if (dateA && dateB) {
          norm.strengthOverrides[subA] = dateB;
          norm.strengthOverrides[subB] = dateA;
        }
      }
    } else if (t.dataset.dow && t.dataset.field) {
      norm.days[t.dataset.dow][t.dataset.field] = t.dataset.field === 'minutes' ? Math.max(0, Number(t.value) || 0) : t.value;
    } else if (t.dataset.setting) {
      const fallback = t.dataset.setting === 'strengthMin' ? DEFAULT_STRENGTH_MIN : DEFAULT_BIKE_MIN;
      norm.settings[t.dataset.setting] = Math.max(5, Number(t.value) || fallback);
    } else if (t.dataset.exclude) {
      norm.excluded[t.dataset.exclude] = t.checked;
    } else {
      return;
    }
    plannerData = norm;
    rerender();
    if (saveFn) { try { await saveFn(norm); } catch (err) { console.error('planner save failed', err); } }
  });

  async function handlePlannerClick(e) {
    if (!isOwnerFlag) return;
    const t = e.target;
    const skipKey = t.dataset.runSkip, unskipKey = t.dataset.runUnskip, resetStrength = t.dataset.resetStrength;
    if (!skipKey && !unskipKey && !resetStrength) return;
    const norm = normalizePlannerData(plannerData);
    if (skipKey) norm.runOverrides[skipKey] = { action: 'skip' };
    else if (unskipKey) delete norm.runOverrides[unskipKey];
    else if (resetStrength) norm.strengthOverrides = {};
    plannerData = norm;
    rerender();
    if (saveFn) { try { await saveFn(norm); } catch (err) { console.error('planner save failed', err); } }
  }
  document.getElementById('plannerBody').addEventListener('click', handlePlannerClick);
  // The "Restablecer" button for strength overrides renders inside plannerSummary
  // (alongside the other weekly notes/warnings), not plannerBody, so it needs its
  // own listener using the same handler.
  document.getElementById('plannerSummary').addEventListener('click', handlePlannerClick);

  (async function initCapabilities() {
    if (!window.claude) return;
    let db = null, user = null;
    try { db = await window.claude.use('db'); } catch (e) {}
    try { user = await window.claude.use('user'); } catch (e) {}
    if (user) { try { isOwnerFlag = await user.isOwner(); } catch (e) {} }
    if (!db) { rerender(); return; }

    const ref = db.doc('planner/' + isoWeekId(todayStr));
    ref.onSnapshot(
      (snap) => { plannerData = snap.exists ? snap.data() : null; rerender(); },
      (err) => { console.error('planner onSnapshot error', err); }
    );
    if (isOwnerFlag) {
      saveFn = async (norm) => { await ref.set({ days: norm.days, settings: norm.settings, excluded: norm.excluded, runOverrides: norm.runOverrides, strengthOverrides: norm.strengthOverrides, updatedAt: new Date().toISOString() }); };
    } else {
      rerender();
    }
  })();
})();

}

(function bootstrap() {
  fetch('data.json').then(function (r) { return r.json(); }).then(function (DATA) {
    var loadingEl = document.getElementById('loadingScreen');
    if (loadingEl) loadingEl.remove();
    main(DATA);
  }).catch(function (err) {
    var loadingEl = document.getElementById('loadingScreen');
    if (loadingEl) loadingEl.textContent = 'No se han podido cargar los datos. Recarga la página.';
    console.error('Error loading data.json', err);
  });
})();
