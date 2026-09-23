'use strict';

// Bounded heuristic for the larger village ledger. All route feasibility and
// conservation checks use the same helpers as the small exact candidate search.
const ALGORITHM = 'ruian-bounded-insertion-heuristic-3.4';
const compare = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  return 0;
};
const planScore = p => [-p.onboardCount, -p.urgentPeople, -p.assistedPeople, -p.servedPeople, p.wait, p.finish, p.drive];
const signature = p => p.routes.map(r => r.vehicleId + ':' + r.stops.map(h => h.id).join(',') + '>' + r.shelterId).join('|');
const total = (items, fn) => items.reduce((n, x) => n + fn(x), 0);

// Long routes try evenly spaced insertion positions, including both ends.
// This bound is independent of village group count and avoids permutation search.
function insertionPositions(length) {
  if (length <= 8) return Array.from({length: length + 1}, (_, k) => k);
  return [...new Set(Array.from({length: 9}, (_, k) => Math.round(k * length / 8)))];
}

function solve(snapshot, {routeBuilder, summarize, validate, baseline}) {
  const started = Date.now(), s = snapshot.scenario, builder = routeBuilder(snapshot);
  const homes = new Map(s.households.map(h => [h.id, h]));
  const waiting = s.households.filter(h => snapshot.stage[h.id] === 'waiting');
  const shelters = new Map(s.shelters.map(sh => [sh.id, sh]));
  const options = new Map(waiting.map(h => [h.id,
    total(s.vehicles, v => total(s.shelters, sh => builder.route(v, [h], sh) ? 1 : 0))
  ]));
  const seeds = [
    {order:'large', allocation:'time', onboard:'scarce'},
    {order:'small', allocation:'time', onboard:'scarce'},
    {order:'scarce', allocation:'time', onboard:'scarce'},
    {order:'id', allocation:'time', onboard:'large'},
    {order:'large', allocation:'compact', onboard:'scarce'},
    {order:'small', allocation:'compact', onboard:'large'},
    {order:'scarce', allocation:'compact', onboard:'large'},
    {order:'large', allocation:'time', onboard:'reverse'}
  ];
  const candidates = [];
  let routeEvaluations = 0;

  function build(seed) {
    const routes = s.vehicles.map(builder.idle), loads = {};
    const fits = (route, old) => route &&
      (loads[route.shelterId] || 0) - (old.shelterId === route.shelterId ? old.people : 0) +
      route.people + (snapshot.occupancy[route.shelterId] || 0) <= shelters.get(route.shelterId).capacity;
    const replace = (vi, next) => {
      const old = routes[vi];
      if (old.shelterId) loads[old.shelterId] -= old.people;
      routes[vi] = next;
      loads[next.shelterId] = (loads[next.shelterId] || 0) + next.people;
    };
    const onboard = s.vehicles.map((v, vi) => ({v, vi,
      people: total(snapshot.fleet[v.id].onboard, id => homes.get(id).people),
      choices: s.shelters.map(sh => builder.route(v, [], sh)).filter(Boolean)
    })).filter(x => snapshot.fleet[x.v.id].onboard.length);
    onboard.sort((a, b) => seed.onboard === 'reverse' ? b.vi - a.vi :
      seed.onboard === 'large' ? b.people - a.people || a.vi - b.vi :
      a.choices.length - b.choices.length || b.people - a.people || a.vi - b.vi);

    // Reserve feasible destinations for passengers already on their original car.
    // If no feasible destination exists, idle() exposes an explicit holding state.
    for (const item of onboard) {
      const choices = item.choices.filter(r => fits(r, routes[item.vi]));
      choices.sort((a, b) => compare([a.finish, a.drive], [b.finish, b.drive]) || a.shelterId.localeCompare(b.shelterId));
      if (choices.length) replace(item.vi, choices[0]);
    }
    const order = [...waiting].sort((a, b) => {
      const priority = Number(b.risk === 3) - Number(a.risk === 3) || Number(b.assistance) - Number(a.assistance);
      if (priority) return priority;
      const variant = seed.order === 'large' ? b.people - a.people : seed.order === 'small' ? a.people - b.people :
        seed.order === 'scarce' ? (options.get(a.id) || Infinity) - (options.get(b.id) || Infinity) || b.people - a.people : 0;
      return variant || a.id.localeCompare(b.id);
    });
    for (const home of order) {
      let best = null;
      for (let vi = 0; vi < s.vehicles.length; vi++) {
        const vehicle = s.vehicles[vi], old = routes[vi], fleet = snapshot.fleet[vehicle.id];
        if (!vehicle.available || fleet.finished) continue;
        const manifest = [...fleet.onboard, ...old.stops.map(st => st.id)].map(id => homes.get(id));
        const people = total(manifest, h => h.people) + home.people;
        if (people > vehicle.capacity || total(manifest, h => Number(h.wheelchair)) + Number(home.wheelchair) > Number(vehicle.wheelchair)) continue;
        const existing = old.stops.map(st => homes.get(st.id));
        const otherFinish = Math.max(0, ...routes.filter((r, index) => index !== vi && r.people).map(r => r.finish));
        for (const at of insertionPositions(existing.length)) {
          const nextOrder = [...existing.slice(0, at), home, ...existing.slice(at)];
          for (let si = 0; si < s.shelters.length; si++) {
            routeEvaluations++;
            const route = builder.route(vehicle, nextOrder, s.shelters[si]);
            if (!fits(route, old)) continue;
            // Added passengers are identical for every placement of this group;
            // compare route costs, or available seat fit in the compact variants.
            const cost = [route.wait - old.wait, Math.max(otherFinish, route.finish), route.drive - old.drive];
            const key = seed.allocation === 'compact' ? [vehicle.capacity - people, ...cost, vi, si, at] : [...cost, vehicle.capacity - people, vi, si, at];
            if (!best || compare(key, best.key) < 0) best = {vi, route, key};
          }
        }
      }
      if (best) replace(best.vi, best.route);
    }
    const plan = summarize(snapshot, routes, ALGORITHM);
    plan.selectedCandidate = `${seed.order}/${seed.allocation}/${seed.onboard}`;
    return plan;
  }

  // Retaining the baseline as a candidate prevents a heuristic regression under
  // the existing lexicographic objective; it does not imply global optimality.
  const base = baseline(snapshot);
  candidates.push({...base, algorithm:ALGORITHM, selectedCandidate:'retained-baseline'});
  for (const seed of seeds) candidates.push(build(seed));
  const distinct = new Map();
  for (const candidate of candidates) {
    const errors = validate(snapshot, candidate);
    if (errors.length) throw new Error('大规模调度校验失败：' + errors.join('；'));
    const key = signature(candidate);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  const ranked = [...distinct.values()].sort((a, b) => compare(planScore(a), planScore(b)) || signature(a).localeCompare(signature(b)));
  const top = ranked.slice(0, 2);
  for (const plan of top) Object.assign(plan, {
    heuristic:true,
    optimality:'not-proven',
    searchMethod:'有界多起点贪心插入；不保证全局最优',
    combinations:candidates.length,
    evaluatedCandidates:candidates.length,
    distinctCandidates:distinct.size,
    routeEvaluations,
    elapsedMs:Date.now() - started
  });
  return {plan:top[0], alternative:top[1] || null};
}

module.exports = {solve, ALGORITHM};
