/* Client-side port of the creche_roster Python engine (engine.py, duties.py,
 * db_import.py, sample.py's Settings, parsing.py) so the Claude Artifact can
 * recompute the roster instantly in the browser on every staff/leave/transfer
 * change, instead of waiting for a Claude turn to rerun build_preview.py and
 * republish. Kept as a faithful, function-for-function translation of the
 * Python so the two stay in lockstep - see mobile/README.md for the rules
 * this implements. Dates are plain "YYYY-MM-DD" strings throughout (they
 * sort/compare correctly as strings, so no Date-object timezone pitfalls).
 */
(function (global) {
  'use strict';

  var SLOTS = ['early', 'mid1', 'mid2', 'late'];
  var ROLES = ['rotating', 'fixed', 'paired', 'static', 'vacant', 'blank'];
  var NDAYS = 5;
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  var W_FAIR = 10.0;
  var W_RECENT = 3.0;

  // ---------------------------------------------------------------- utils
  function g(obj, key) { return (obj && obj[key]) || 0; }
  function sumAll(obj) {
    var s = 0;
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) s += obj[k];
    return s;
  }
  function cmpArrays(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  function minByKey(arr, keyFn) {
    var best = null, bestKey = null;
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i], k = keyFn(x);
      if (best === null || cmpArrays(k, bestKey) < 0) { best = x; bestKey = k; }
    }
    return best;
  }
  function maxByKey(arr, keyFn) {
    var best = null, bestKey = null;
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i], k = keyFn(x);
      if (best === null || cmpArrays(k, bestKey) > 0) { best = x; bestKey = k; }
    }
    return best;
  }
  function sortByKey(arr, keyFn) {
    return arr.map(function (x) { return [keyFn(x), x]; })
      .sort(function (a, b) { return cmpArrays(a[0], b[0]); })
      .map(function (p) { return p[1]; });
  }
  function pyRound(x) {
    var floor = Math.floor(x), diff = x - floor;
    if (diff < 0.5) return floor;
    if (diff > 0.5) return floor + 1;
    return (floor % 2 === 0) ? floor : floor + 1;
  }
  function cellKey(key, d) { return key + '@@' + d; }

  // ---------------------------------------------------------------- dates
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function ymd(iso) {
    var p = iso.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function toEpochDay(iso) {
    var v = ymd(iso);
    return Math.floor(Date.UTC(v.y, v.m - 1, v.d) / 86400000);
  }
  function fromEpochDay(n) {
    var dt = new Date(n * 86400000);
    var y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function addDays(iso, n) { return fromEpochDay(toEpochDay(iso) + n); }
  function weekday(iso) {
    var v = ymd(iso);
    var jsDay = new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
    return (jsDay + 6) % 7; // Monday = 0
  }
  function mondayOfWeek(iso) { return addDays(iso, -weekday(iso)); }
  function fmtDay(iso) {
    var v = ymd(iso);
    return WD[weekday(iso)] + ' ' + v.d + ' ' + MONTHS[v.m - 1];
  }
  function fmtDays(days) {
    var sorted = days.slice().sort();
    if (!sorted.length) return '';
    if (sorted.length <= 3) return sorted.map(fmtDay).join(', ');
    return fmtDay(sorted[0]) + ' to ' + fmtDay(sorted[sorted.length - 1]) + ', ' + sorted.length + ' days';
  }
  function ddMon(iso) {
    var v = ymd(iso);
    return String(v.d).padStart(2, '0') + ' ' + MONTHS[v.m - 1];
  }
  function weekLabel(days) {
    var y = ymd(days[days.length - 1]).y;
    return ddMon(days[0]) + ' – ' + ddMon(days[days.length - 1]) + ' ' + y;
  }
  function isOff(text) { return (text || '').trim().toUpperCase() === 'OFF'; }

  // ---------------------------------------------------------------- time
  function t12(minutes) {
    var h = Math.floor(minutes / 60) % 12; if (h === 0) h = 12;
    var m = minutes % 60;
    return h + ':' + String(m).padStart(2, '0');
  }
  function shiftLabel(shift) { return t12(shift.start) + ' – ' + t12(shift.end); }
  function mostCommonSlot(slots) {
    var c = {};
    slots.forEach(function (sl) { c[sl] = (c[sl] || 0) + 1; });
    return maxByKey(Object.keys(c), function (sl) { return [c[sl], SLOTS.indexOf(sl)]; });
  }

  // ---------------------------------------------------------------- settings
  var SHIFTS = {
    early: { start: 450, end: 990 },   // 7:30 - 16:30
    mid1: { start: 480, end: 1020 },  // 8:00 - 17:00
    mid2: { start: 510, end: 1050 },  // 8:30 - 17:30
    late: { start: 540, end: 1080 },  // 9:00 - 18:00
  };
  function buildSettings(rosterStartIso) {
    return {
      title: 'STAFF ROSTER',
      roster_start: rosterStartIso,
      weeks: 4,
      floors: ['All'],
      shifts: SHIFTS,
      min_open: { All: 3 },
      min_close: { All: 3 },
      break_text: '10 MINS',
      day_headers: false,
      fallback_closer: 'Priscilla',
    };
  }

  // ---------------------------------------------------------------- validate
  function validate(inputs) {
    var p = [];
    var s = inputs.settings;
    if (weekday(s.roster_start) !== 0) p.push('Settings: roster_start ' + s.roster_start + ' is not a Monday.');
    if (!(s.weeks >= 1 && s.weeks <= 12)) p.push('Settings: weeks must be between 1 and 12.');
    if (!s.floors || !s.floors.length) p.push('Settings: floors is empty.');
    if (!s.title) p.push('Settings: title is empty.');

    var shiftsOk = SLOTS.every(function (sl) { return !!s.shifts[sl]; });
    if (!shiftsOk) {
      p.push('Settings: every slot (early, mid1, mid2, late) needs a start and end time.');
    } else {
      SLOTS.forEach(function (sl) {
        if (s.shifts[sl].start >= s.shifts[sl].end) p.push('Settings: ' + sl + ' start must be before its end.');
      });
      var starts = SLOTS.map(function (sl) { return s.shifts[sl].start; });
      for (var i = 0; i < starts.length - 1; i++) {
        if (starts[i] >= starts[i + 1]) { p.push('Settings: start times must increase: early < mid1 < mid2 < late.'); break; }
      }
    }

    s.floors.forEach(function (f) {
      [['min_open', s.min_open], ['min_close', s.min_close]].forEach(function (pair) {
        var label = pair[0], table = pair[1];
        var v = table[f];
        if (v === undefined || v === null || v < 0) {
          p.push('Settings: ' + label + '_' + f.toLowerCase().replace(/ /g, '_') + ' must be a number, 0 or more.');
        }
      });
    });

    var names = new Set();
    var paired = [];
    inputs.staff.forEach(function (st) {
      if (ROLES.indexOf(st.role) === -1) {
        p.push("Staff: '" + st.name + "' has role '" + st.role + "'. Use one of: " + ROLES.join(', ') + '.');
        return;
      }
      if (s.floors.indexOf(st.floor) === -1) {
        p.push("Staff: '" + (st.name || st.role) + "' is on floor '" + st.floor + "', which is not in Settings floors (" + s.floors.join(', ') + ').');
      }
      if (st.role === 'vacant' || st.role === 'blank') return;
      if (!st.name) { p.push('Staff: a row has no name.'); return; }
      if (names.has(st.name.toLowerCase())) p.push("Staff: '" + st.name + "' appears more than once.");
      names.add(st.name.toLowerCase());
      if (st.role === 'paired') paired.push(st.name);
      if (st.role === 'fixed' && SLOTS.indexOf(st.fixed_slot) === -1) {
        p.push("Staff: '" + st.name + "' is fixed but has no valid slot (use early, mid1, mid2, late or a start time).");
      }
      if (st.start_date && st.end_date && st.end_date < st.start_date) {
        p.push("Staff: '" + st.name + "' has an End date before their Start date.");
      }
    });
    if (!(paired.length === 0 || paired.length === 2)) {
      p.push("Staff: exactly two people must have role 'paired' (or none). Found " + paired.length + '.');
    }

    if (s.fallback_closer) {
      if (!names.has(s.fallback_closer.toLowerCase())) {
        p.push("Settings: fallback_closer '" + s.fallback_closer + "' is not in the Staff tab.");
      } else if (paired.indexOf(s.fallback_closer) !== -1) {
        p.push("Settings: fallback_closer '" + s.fallback_closer + "' can't be one of the two paired staff.");
      }
    }

    var exact = {};
    inputs.staff.forEach(function (st) {
      if (st.role !== 'vacant' && st.role !== 'blank' && st.name) exact[st.name] = st;
    });
    inputs.leave.forEach(function (lv) {
      if (!(lv.name in exact)) p.push("Leave: '" + lv.name + "' is not in the Staff tab.");
      if (lv.end != null && lv.end < lv.start) p.push('Leave: ' + lv.name + ' ends before it starts.');
    });
    inputs.overrides.forEach(function (ov) {
      if (!(ov.name in exact)) {
        p.push("Overrides: '" + ov.name + "' is not in the Staff tab.");
      } else if (exact[ov.name].role === 'static') {
        if (!ov.text) p.push('Overrides: ' + ov.name + ' has own hours, so type the hours (e.g. 10:00 - 2:00) or OFF.');
      } else if (SLOTS.indexOf(ov.slot) === -1) {
        p.push('Overrides: ' + ov.name + ' has an unknown start time.');
      }
      if (ov.end != null && ov.end < ov.start) p.push('Overrides: ' + ov.name + ' ends before it starts.');
    });
    return p;
  }

  // ---------------------------------------------------------------- fairness cost
  function cost(hist, lastSlot, name, slot) {
    var h = hist[name] || {};
    var total = sumAll(h);
    var c = W_FAIR * g(h, slot) / (total + 1);
    if (lastSlot[name] === slot) c += W_RECENT;
    return c;
  }

  function assignWeeklyBase(members, preCounts, needOpen, needClose, hist, lastSlot, weekIndex, roomOf, takenByRoom) {
    var remaining = members.slice();
    var result = {};
    roomOf = roomOf || {};
    takenByRoom = takenByRoom || {};

    function priority(n) {
      var idx = members.indexOf(n);
      return (((idx - weekIndex) % members.length) + members.length) % members.length;
    }
    function clashes(n, slot) {
      var room = roomOf[n];
      if (!room) return false;
      var set = takenByRoom[room];
      return !!(set && set.has(slot));
    }
    function claim(n, slot) {
      result[n] = slot;
      var room = roomOf[n];
      if (room) {
        if (!takenByRoom[room]) takenByRoom[room] = new Set();
        takenByRoom[room].add(slot);
      }
    }
    function take(slot, k) {
      var times = Math.min(k, remaining.length);
      for (var i = 0; i < times; i++) {
        var safe = remaining.filter(function (n) { return !clashes(n, slot); });
        var pool = safe.length ? safe : remaining;
        var n = minByKey(pool, function (n) {
          return [
            g(hist[n], 'early') + g(hist[n], 'late'),
            g(hist[n], slot),
            sumAll(hist[n]),
            lastSlot[n] === slot ? 1 : 0,
            priority(n),
          ];
        });
        remaining = remaining.filter(function (x) { return x !== n; });
        claim(n, slot);
      }
    }

    var earlyK = Math.max(0, needOpen - g(preCounts, 'early'));
    var lateK = Math.max(0, needClose - g(preCounts, 'late'));
    earlyK = Math.min(earlyK, Math.max(0, remaining.length - lateK));
    take('early', earlyK);
    take('late', lateK);

    var order = sortByKey(remaining, function (n) {
      return [g(hist[n], 'mid1') + g(hist[n], 'mid2'), sumAll(hist[n]), priority(n)];
    });
    var midCounts = { mid1: 0, mid2: 0 };
    order.forEach(function (n) {
      var options = ['mid1', 'mid2'].filter(function (sl) { return !clashes(n, sl); });
      if (!options.length) options = ['mid1', 'mid2'];
      var target = minByKey(options, function (sl) {
        return [g(hist[n], sl), midCounts[sl], lastSlot[n] === sl ? 1 : 0];
      });
      claim(n, target);
      midCounts[target] += 1;
    });

    resolveRoomClashes(result, roomOf, hist, lastSlot);
    avoidImmediateRepeats(result, roomOf, hist, lastSlot);
    return result;
  }

  // Start from what this floor's rotation would look like at full
  // strength (`idealBase` - everyone's slot as if this week's temporary
  // absences hadn't happened) and move as few people off it as actually
  // necessary to keep opening/closing cover met for who's really here.
  // See _patch_weekly_base's docstring in engine.py for the full
  // rationale - this is a straight port.
  function patchWeeklyBase(members, idealBase, preCounts, needOpen, needClose, hist, lastSlot, weekIndex, roomOf, takenByRoom) {
    roomOf = roomOf || {};
    var takenCopy = {};
    for (var r0 in (takenByRoom || {})) takenCopy[r0] = new Set(takenByRoom[r0]);
    var externalTaken = {};
    for (var r1 in takenCopy) externalTaken[r1] = new Set(takenCopy[r1]);

    var result = {};
    var displaced = [];
    members.forEach(function (n) {
      if (!(n in idealBase)) return;
      var slot = idealBase[n];
      var room = roomOf[n];
      if (room && externalTaken[room] && externalTaken[room].has(slot)) {
        displaced.push(n);
        return;
      }
      result[n] = slot;
      if (room) {
        if (!takenCopy[room]) takenCopy[room] = new Set();
        takenCopy[room].add(slot);
      }
    });

    displaced.forEach(function (n) {
      var room = roomOf[n];
      var options = SLOTS.filter(function (sl) { return !(room && takenCopy[room] && takenCopy[room].has(sl)); });
      if (!options.length) options = SLOTS.slice();
      var target = minByKey(options, function (sl) {
        return [g(hist[n], sl), sumAll(hist[n]), lastSlot[n] === sl ? 1 : 0];
      });
      result[n] = target;
      if (room) {
        if (!takenCopy[room]) takenCopy[room] = new Set();
        takenCopy[room].add(target);
      }
    });

    var need = { early: needOpen, late: needClose };
    ['early', 'late'].forEach(function (target) {
      while (g(preCounts, target) + Object.values(result).filter(function (s) { return s === target; }).length < need[target]) {
        var cnt = {};
        Object.values(result).forEach(function (s) { cnt[s] = (cnt[s] || 0) + 1; });
        var donors = Object.keys(result).filter(function (n) {
          var cur = result[n];
          if (cur === target) return false;
          if (cur in need && g(preCounts, cur) + (cnt[cur] || 0) <= need[cur]) return false;
          return true;
        });
        if (!donors.length) break;
        var safe = donors.filter(function (n) {
          return !(roomOf[n] && takenCopy[roomOf[n]] && takenCopy[roomOf[n]].has(target));
        });
        var pool = safe.length ? safe : donors;
        var n = minByKey(pool, function (n) {
          return [
            ['mid1', 'mid2'].indexOf(result[n]) !== -1 ? 0 : 1,
            g(hist[n], 'early') + g(hist[n], 'late'),
            g(hist[n], target),
            sumAll(hist[n]),
            lastSlot[n] === target ? 1 : 0,
            (((members.indexOf(n) - weekIndex) % members.length) + members.length) % members.length,
          ];
        });
        var old = result[n];
        var oldRoom = roomOf[n];
        if (oldRoom && takenCopy[oldRoom]) takenCopy[oldRoom].delete(old);
        result[n] = target;
        var newRoom = roomOf[n];
        if (newRoom) {
          if (!takenCopy[newRoom]) takenCopy[newRoom] = new Set();
          takenCopy[newRoom].add(target);
        }
      }
    });

    resolveRoomClashes(result, roomOf, hist, lastSlot);
    return result;
  }

  function roomClashFree(assignment, roomOf) {
    var seen = new Set();
    for (var n in assignment) {
      var slot = assignment[n];
      var room = roomOf[n];
      if (!room) continue;
      var key = room + '|' + slot;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }

  function resolveRoomClashes(result, roomOf, hist, lastSlot) {
    lastSlot = lastSlot || {};
    for (var iter = 0; iter < 20; iter++) {
      var clash = null;
      var seen = {};
      for (var n in result) {
        var slot = result[n];
        var room = roomOf[n];
        if (!room) continue;
        var key = room + '|' + slot;
        if (key in seen) { clash = [n, seen[key]]; break; }
        seen[key] = n;
      }
      if (!clash) return;

      var best = null;
      clash.forEach(function (mover) {
        var cur = result[mover];
        // Fixed, alphabetical order rather than whatever order `result`
        // happens to hold - opening/closing seats are always claimed
        // before the flexible ones, so iterating in that order would let
        // whoever got picked first for opening or closing also win every
        // tied swap, quietly undoing the fairness that pick was for.
        Object.keys(result).sort().forEach(function (other) {
          var oslot = result[other];
          if (other === mover || oslot === cur || roomOf[other] === roomOf[mover]) return;
          var trial = Object.assign({}, result);
          trial[mover] = oslot; trial[other] = cur;
          if (!roomClashFree(trial, roomOf)) return;
          var c = g(hist[mover], oslot) + g(hist[other], cur);
          if (lastSlot[mover] === oslot) c += W_RECENT;
          if (lastSlot[other] === cur) c += W_RECENT;
          if (best === null || c < best[0]) best = [c, mover, other, oslot, cur];
        });
      });
      if (best === null) return;
      result[best[1]] = best[3];
      result[best[2]] = best[4];
    }
  }

  // A last pass on top of resolveRoomClashes: cover and same-room clashes
  // are settled by then, but the least-done-first pass only ever treats a
  // straight repeat of someone's own last-week slot as a weak, final
  // tie-break - not strong enough when the rest of the ranking already
  // points at the same person again. So make a second, explicit pass just
  // for that: whoever's still sitting on exactly their own last-week slot
  // trades with whoever it costs least to trade with, as long as that
  // doesn't just hand the same problem to the other end of the swap or
  // introduce a same-room clash. Purely a swap between two already-
  // assigned people, so it can't change how many people land on any slot.
  function avoidImmediateRepeats(result, roomOf, hist, lastSlot) {
    var names = Object.keys(result).sort();
    var stuck = {};
    for (var iter = 0; iter < names.length; iter++) {
      var n = names.find(function (x) { return !stuck[x] && lastSlot[x] === result[x]; });
      if (!n) return;
      var cur = result[n];
      var best = null;
      names.slice().sort().forEach(function (other) {
        var oslot = result[other];
        if (other === n || oslot === cur || lastSlot[other] === cur) return;
        var trial = Object.assign({}, result);
        trial[n] = oslot; trial[other] = cur;
        if (!roomClashFree(trial, roomOf)) return;
        var c = g(hist[n], oslot) + g(hist[other], cur);
        if (best === null || c < best[0]) best = [c, other, oslot];
      });
      if (best === null) { stuck[n] = true; continue; }
      result[best[1]] = cur;
      result[n] = best[2];
    }
  }

  function choosePair(a, b, presentA, presentB, hist, lastSlot) {
    function share(name, slot) { return g(hist[name], slot) / (sumAll(hist[name]) + 1); }
    if (!presentA && !presentB) return {};
    if (presentA && presentB) {
      var ea = share(a, 'early'), eb = share(b, 'early');
      var aEarly;
      if (Math.abs(ea - eb) > 1e-9) {
        aEarly = ea < eb;
      } else {
        var la = lastSlot[a], lb = lastSlot[b];
        if (la === 'late' && lb !== 'late') aEarly = true;
        else if (lb === 'late' && la !== 'late') aEarly = false;
        else if (la === 'early' && lb !== 'early') aEarly = false;
        else if (lb === 'early' && la !== 'early') aEarly = true;
        else aEarly = true;
      }
      var out = {};
      if (aEarly) { out[a] = 'early'; out[b] = 'late'; } else { out[a] = 'late'; out[b] = 'early'; }
      return out;
    }
    // Only one of them works this week: the pairing is suspended. Whoever's
    // in always opens (7:30) automatically - not a fairness pick, and not
    // something that needs a manual override to hold.
    var who = presentA ? a : b;
    var out2 = {}; out2[who] = 'early'; return out2;
  }

  // ---------------------------------------------------------------- daily repair/checks
  function needs(floor, s) { return { early: s.min_open[floor], late: s.min_close[floor] }; }

  function wouldClash(n, targetSlot, slotOf, roomOf) {
    var room = roomOf ? roomOf[n] : null;
    if (!room) return false;
    for (var other in slotOf) {
      if (other !== n && roomOf[other] === room && slotOf[other] === targetSlot) return true;
    }
    return false;
  }

  function repairFloor(d, floor, slotOf, overridden, byName, s, costFn, checks, wi, need, roomOf, adjusted) {
    need = need || needs(floor, s);
    var floorNames = Object.keys(slotOf).filter(function (n) { return byName[n].floor === floor; });
    ['early', 'late'].forEach(function (target) {
      while (true) {
        var cnt = {};
        floorNames.forEach(function (n) { cnt[slotOf[n]] = (cnt[slotOf[n]] || 0) + 1; });
        if ((cnt[target] || 0) >= need[target]) break;
        var donors = [];
        floorNames.forEach(function (n) {
          if (byName[n].role !== 'rotating' || overridden.has(n)) return;
          var cur = slotOf[n];
          if (cur === target) return;
          if ((cur in need) && (cnt[cur] || 0) <= need[cur]) return;
          donors.push(n);
        });
        if (!donors.length) break;
        var safeDonors = donors.filter(function (n) { return !wouldClash(n, target, slotOf, roomOf); });
        var pool = safeDonors.length ? safeDonors : donors;
        pool = sortByKey(pool, function (n) {
          return [
            (slotOf[n] === 'mid1' || slotOf[n] === 'mid2') ? 0 : 1,
            costFn(n, target),
            floorNames.indexOf(n),
          ];
        });
        var n = pool[0];
        var old = slotOf[n];
        slotOf[n] = target;
        if (adjusted) adjusted.add(n);
        var what = target === 'early' ? 'opening' : 'closing';
        checks.push({
          level: 'INFO', rule: 'Cover adjusted',
          message: n + ' moved from ' + t12(s.shifts[old].start) + ' to ' + t12(s.shifts[target].start) +
            ' on ' + fmtDay(d) + ' to keep ' + floor + ' ' + what + ' cover.',
          day: d, week: wi,
        });
      }
    });
  }

  function capLateForFallback(d, floor, slotOf, overridden, byName, s, need, costFn, checks, wi, fb, roomOf, adjusted) {
    var target = need ? need.late : undefined;
    if (target === undefined || target === null) return;
    var floorNames = Object.keys(slotOf).filter(function (n) { return byName[n].floor === floor; });
    var otherSlots = SLOTS.filter(function (sl) { return sl !== 'late'; });
    while (true) {
      var cnt = {};
      floorNames.forEach(function (n) { cnt[slotOf[n]] = (cnt[slotOf[n]] || 0) + 1; });
      if ((cnt.late || 0) <= target) break;
      var candidates = floorNames.filter(function (n) {
        return slotOf[n] === 'late' && byName[n].role === 'rotating' && !overridden.has(n);
      });
      if (!candidates.length) break;
      var slotCounts = {};
      floorNames.forEach(function (n) { slotCounts[slotOf[n]] = (slotCounts[slotOf[n]] || 0) + 1; });
      var options = [];
      candidates.forEach(function (n) {
        otherSlots.forEach(function (sl) { if (!wouldClash(n, sl, slotOf, roomOf)) options.push([n, sl]); });
      });
      if (!options.length) {
        candidates.forEach(function (n) { otherSlots.forEach(function (sl) { options.push([n, sl]); }); });
      }
      var pick = minByKey(options, function (ns) { return [slotCounts[ns[1]] || 0, costFn(ns[0], ns[1])]; });
      var n = pick[0], moveTo = pick[1];
      var old = slotOf[n];
      slotOf[n] = moveTo;
      if (adjusted) adjusted.add(n);
      checks.push({
        level: 'INFO', rule: 'Cover adjusted',
        message: n + ' moved from ' + t12(s.shifts[old].start) + ' to ' + t12(s.shifts[moveTo].start) +
          ' on ' + fmtDay(d) + ' so closing stays at ' + (target + 1) + ' with ' + fb + ' covering, not more.',
        day: d, week: wi,
      });
    }
  }

  function checkFloor(d, floor, slotOf, byName, s, checks, wi, need) {
    need = need || needs(floor, s);
    var cnt = {};
    for (var n in slotOf) if (byName[n].floor === floor) cnt[slotOf[n]] = (cnt[slotOf[n]] || 0) + 1;
    [['early', 'Opening cover', 'opening'], ['late', 'Closing cover', 'closing']].forEach(function (t) {
      var slot = t[0], rule = t[1], what = t[2];
      if (need[slot] > 0 && (cnt[slot] || 0) < need[slot]) {
        checks.push({
          level: 'BREACH', rule: rule,
          message: floor + ' ' + what + ': ' + (cnt[slot] || 0) + ' on the ' + t12(s.shifts[slot].start) +
            ' start, minimum is ' + need[slot] + ' (' + fmtDay(d) + ').',
          day: d, week: wi,
        });
      }
    });
  }

  function checkRooms(d, slotOf, roomOf, shifts, checks, wi) {
    var byRoom = {};
    for (var name in slotOf) {
      var slot = slotOf[name];
      var room = roomOf[name];
      if (!room) continue;
      if (!byRoom[room]) byRoom[room] = {};
      if (!byRoom[room][slot]) byRoom[room][slot] = [];
      byRoom[room][slot].push(name);
    }
    for (var r in byRoom) {
      for (var sl in byRoom[r]) {
        var names = byRoom[r][sl];
        if (names.length > 1) {
          var sorted = names.slice().sort();
          checks.push({
            level: 'BREACH', rule: 'Room clash',
            message: r + ': ' + sorted.join(', ') + ' are all on the ' + t12(shifts[sl].start) +
              ' start on ' + fmtDay(d) + " - same-room staff can't share a shift.",
            day: d, week: wi,
          });
        }
      }
    }
  }

  function reportPairing(pair, days, cells, leaveKind, ignoredOverride, checks, wi) {
    var a = pair[0], b = pair[1];
    var suspended = {};
    var bothAway = [];
    days.forEach(function (d) {
      var la = leaveKind(a, d), lb = leaveKind(b, d);
      if (!la && !lb) {
        var sa = cells.get(cellKey(a, d)).slot, sb = cells.get(cellKey(b, d)).slot;
        var ok = (sa === 'early' && sb === 'late') || (sa === 'late' && sb === 'early');
        if (!ok) {
          checks.push({ level: 'BREACH', rule: 'Pairing rule', message: a + ' and ' + b + ' are not complementary on ' + fmtDay(d) + '.', day: d, week: wi });
        }
      } else if (la && !lb) {
        (suspended[a] = suspended[a] || []).push(d);
      } else if (lb && !la) {
        (suspended[b] = suspended[b] || []).push(d);
      } else {
        bothAway.push(d);
      }
    });
    if (bothAway.length) {
      checks.push({
        level: 'WARNING', rule: 'Pairing policy',
        message: a + ' and ' + b + ' are both away on ' + fmtDays(bothAway) + ' — policy says they should never be away at the same time. Double-check that leave.',
        day: null, week: wi,
      });
    }
    for (var absent in suspended) {
      var ds = suspended[absent];
      var partner = absent === a ? b : a;
      var overriddenDays = ds.filter(function (d) { return cells.get(cellKey(partner, d)).overridden; });
      if (!overriddenDays.length) {
        checks.push({
          level: 'INFO', rule: 'Pairing suspended',
          message: absent + ' is away: ' + fmtDays(ds) + '. ' + partner + ' opens (7:30) automatically.',
          day: null, week: wi,
        });
      } else if (overriddenDays.length < ds.length) {
        checks.push({
          level: 'INFO', rule: 'Pairing suspended',
          message: absent + ' is away: ' + fmtDays(ds) + '. ' + partner + ' opens (7:30) automatically, except ' + fmtDays(overriddenDays) + ' where a manual start time is set in Overrides.',
          day: null, week: wi,
        });
      } else {
        checks.push({
          level: 'INFO', rule: 'Pairing suspended',
          message: absent + ' is away: ' + fmtDays(ds) + '. ' + partner + "'s start time is set manually in Overrides.",
          day: null, week: wi,
        });
      }
    }
    for (var name in ignoredOverride) {
      var ds2 = ignoredOverride[name];
      var partner2 = name === a ? b : a;
      checks.push({
        level: 'INFO', rule: 'Override ignored',
        message: 'Override for ' + name + ' ignored on ' + fmtDays(ds2) + ' because ' + partner2 + ' is working: the pairing rule applies. You can delete or end that Overrides row.',
        day: null, week: wi,
      });
    }
  }

  // ---------------------------------------------------------------- build_roster
  function buildRoster(inputs) {
    var problems = validate(inputs);
    if (problems.length) {
      var e = new Error(problems.join('\n'));
      e.problems = problems;
      e.isInputError = true;
      throw e;
    }

    var s = inputs.settings;
    var staffKeys = [];
    inputs.staff.forEach(function (st, i) {
      var key = (st.role !== 'vacant' && st.role !== 'blank') ? st.name : (st.role + '#' + i);
      staffKeys.push([key, st]);
    });
    var working = staffKeys.filter(function (ks) { return ['rotating', 'fixed', 'paired', 'static'].indexOf(ks[1].role) !== -1; });
    var byName = {};
    working.forEach(function (ks) { byName[ks[1].name] = ks[1]; });
    var pair = working.filter(function (ks) { return ks[1].role === 'paired'; }).map(function (ks) { return ks[1].name; });

    var roomOf = {};
    for (var n in byName) if (byName[n].room) roomOf[n] = byName[n].room;

    var hist = {};
    for (var n2 in byName) hist[n2] = Object.assign({}, inputs.history[n2] || {});
    var period = {};
    for (var n3 in byName) period[n3] = {};
    var lastSlot = {};
    for (var n4 in inputs.last_slot) if (n4 in byName) lastSlot[n4] = inputs.last_slot[n4];

    var checks = [];
    var weeks = [];

    function leaveKind(name, d) {
      var st = byName[name];
      if (st) {
        if (st.start_date && d < st.start_date) return 'Not yet started';
        if (st.end_date && d > st.end_date) return 'Left';
      }
      for (var i = 0; i < inputs.leave.length; i++) {
        var lv = inputs.leave[i];
        if (lv.name === name && lv.start <= d && (lv.end == null || d <= lv.end)) return lv.kind;
      }
      return null;
    }
    // Like leaveKind, but a leave request with a known end date doesn't
    // count - only employment boundaries and open-ended leave do. Used
    // only to work out who else's slot moved *because of* someone's
    // temporary leave, for the "changed to cover" highlight - never for
    // what's actually scheduled. Open-ended leave (no return date) is the
    // team's new normal for this build, not a one-off to compare against,
    // so it stays a real absence here too, same as leaveKind.
    function creditedKind(name, d) {
      var st = byName[name];
      if (st) {
        if (st.start_date && d < st.start_date) return 'Not yet started';
        if (st.end_date && d > st.end_date) return 'Left';
      }
      for (var i = 0; i < inputs.leave.length; i++) {
        var lv = inputs.leave[i];
        if (lv.name === name && lv.start <= d && lv.end == null) return lv.kind;
      }
      return null;
    }
    function ovCovers(ov, d) { return ov.start <= d && (ov.end == null || d <= ov.end); }
    function overrideSlot(name, d) {
      var found = null;
      inputs.overrides.forEach(function (ov) { if (ov.name === name && ovCovers(ov, d) && ov.slot) found = ov.slot; });
      return found;
    }
    function overrideText(name, d) {
      var found = null;
      inputs.overrides.forEach(function (ov) { if (ov.name === name && ovCovers(ov, d) && ov.text) found = ov.text; });
      return found;
    }
    // True if the override in effect for this person on this day has a
    // known end date - a temporary, one-off adjustment, as opposed to an
    // open-ended standing pin (e.g. the paired person's permanent early
    // slot). Only the former counts toward the "changed today" highlight.
    function boundedOverride(name, d) {
      var found = null;
      inputs.overrides.forEach(function (ov) { if (ov.name === name && ovCovers(ov, d) && (ov.slot || ov.text)) found = ov; });
      return found !== null && found.end != null;
    }
    function effectiveOverride(name, d) {
      var ov = overrideSlot(name, d);
      if (ov && byName[name].role === 'paired') {
        var partner = name === pair[0] ? pair[1] : pair[0];
        if (!leaveKind(partner, d)) return [null, true];
      }
      return [ov, false];
    }
    function costFn(name, slot) { return cost(hist, lastSlot, name, slot); }

    for (var wi = 0; wi < s.weeks; wi++) {
      var monday = addDays(s.roster_start, wi * 7);
      var days = [];
      for (var i = 0; i < NDAYS; i++) days.push(addDays(monday, i));
      var present = {};
      for (var n5 in byName) present[n5] = days.filter(function (d) { return !leaveKind(n5, d); });

      // ---- weekly base ----
      function computeBase(presentMap, idealBase) {
        // An override that covers every day someone's in this week decides
        // their base slot for the whole week (an open-ended pinned shift,
        // say) - a shorter one only applies to the specific day(s) it
        // names, via effectiveOverride() in the daily pass below. It's
        // deliberately kept out of the weekly base here, or it would drag
        // every other day that week along with it too.
        var manual = {};
        for (var n6 in byName) {
          var st6 = byName[n6];
          if (st6.role === 'static' || !presentMap[n6].length) continue;
          var ovs = presentMap[n6].map(function (d) { return effectiveOverride(n6, d)[0]; }).filter(Boolean);
          if (ovs.length && ovs.length === presentMap[n6].length) {
            var c6 = {};
            ovs.forEach(function (o) { c6[o] = (c6[o] || 0) + 1; });
            manual[n6] = maxByKey(Object.keys(c6), function (sl) { return [c6[sl], -SLOTS.indexOf(sl)]; });
          }
        }

        var base = {};
        for (var n7 in byName) {
          var st7 = byName[n7];
          if (st7.role === 'fixed' && presentMap[n7].length) base[n7] = manual[n7] || st7.fixed_slot || 'early';
        }
        if (pair.length) {
          var a = pair[0], b = pair[1];
          Object.assign(base, choosePair(a, b, !!presentMap[a].length, !!presentMap[b].length, hist, lastSlot));
          [[a, b], [b, a]].forEach(function (pr) {
            var nm = pr[0], partner = pr[1];
            if (manual[nm] !== undefined && !presentMap[partner].length) base[nm] = manual[nm];
          });
        }
        s.floors.forEach(function (floor) {
          var floorPeople = [];
          for (var nn in byName) if (byName[nn].floor === floor) floorPeople.push(byName[nn]);
          floorPeople.forEach(function (st) {
            if (st.role === 'rotating' && manual[st.name] !== undefined) base[st.name] = manual[st.name];
          });
          var pre = {};
          floorPeople.forEach(function (st) { if (base[st.name] !== undefined) pre[base[st.name]] = (pre[base[st.name]] || 0) + 1; });
          var members = floorPeople
            .filter(function (st) { return st.role === 'rotating' && presentMap[st.name].length && manual[st.name] === undefined; })
            .map(function (st) { return st.name; });

          var minClose = s.min_close[floor];
          if (
            s.fallback_closer && pair.length &&
            byName[s.fallback_closer] && byName[s.fallback_closer].floor === floor &&
            !pair.some(function (p) { return byName[p] && byName[p].floor === floor && base[p] === 'late'; })
          ) {
            minClose = Math.max(0, minClose - 1);
          }
          if (members.length) {
            var takenByRoom = {};
            for (var nb in base) {
              var r = roomOf[nb];
              if (r) { if (!takenByRoom[r]) takenByRoom[r] = new Set(); takenByRoom[r].add(base[nb]); }
            }
            if (idealBase === undefined) {
              Object.assign(base, assignWeeklyBase(members, pre, s.min_open[floor], minClose, hist, lastSlot, wi, roomOf, takenByRoom));
            } else {
              Object.assign(base, patchWeeklyBase(members, idealBase, pre, s.min_open[floor], minClose, hist, lastSlot, wi, roomOf, takenByRoom));
            }
          }
        });
        return base;
      }

      // Two different counterfactuals, for two different jobs:
      //
      // baseIfNobodyAway: bounded leave doesn't count as absence, open
      // -ended does (creditedKind) - used only to decide who's "covering
      // because of leave" for the highlight, below. Never feeds the real
      // schedule.
      //
      // fullRotatingBase: the rotating pool at full strength (nobody in
      // it ever absent this week), but fixed hours and the pair's
      // presence are exactly the real week's - used as the patch
      // baseline for the real schedule itself, so opening/closing
      // requirements match the real week exactly and only the rotating
      // pool's own actual absences get patched around.
      var presentCredit = {};
      for (var n5b in byName) presentCredit[n5b] = days.filter(function (d) { return !creditedKind(n5b, d); });
      var baseIfNobodyAway = computeBase(presentCredit);
      var presentFullRotating = {};
      for (var n5d in byName) presentFullRotating[n5d] = byName[n5d].role === 'rotating' ? days : present[n5d];
      var fullRotatingBase = computeBase(presentFullRotating);
      var base = computeBase(present, fullRotatingBase);
      var coveringBecauseOfLeave = new Set();
      for (var n5c in base) {
        if (byName[n5c].role === 'rotating' && baseIfNobodyAway[n5c] !== undefined && base[n5c] !== baseIfNobodyAway[n5c]) {
          coveringBecauseOfLeave.add(n5c);
        }
      }

      // ---- daily pass ----
      var cells = new Map();
      var ignoredOverride = {};
      days.forEach(function (d) {
        var slotOf = {};
        var overridden = new Set();
        var boundedOverridden = new Set();
        var adjusted = new Set();
        staffKeys.forEach(function (ks) {
          var key = ks[0], st = ks[1];
          if (st.role === 'blank') { cells.set(cellKey(key, d), { kind: 'blank', text: '' }); return; }
          if (st.role === 'vacant') { cells.set(cellKey(key, d), { kind: 'vacant', text: st.hours[weekday(d)] || st.note }); return; }
          var lk = leaveKind(st.name, d);
          if (lk) { cells.set(cellKey(key, d), { kind: 'leave', text: lk }); return; }
          if (st.role === 'static') {
            var text = overrideText(st.name, d) || st.hours[weekday(d)] || st.note;
            if (isOff(text)) cells.set(cellKey(key, d), { kind: 'leave', text: 'OFF' });
            else cells.set(cellKey(key, d), { kind: 'static', text: text });
            return;
          }
          var eo = effectiveOverride(st.name, d);
          var ov = eo[0], ignored = eo[1];
          if (ignored) (ignoredOverride[st.name] = ignoredOverride[st.name] || []).push(d);
          if (ov) {
            slotOf[st.name] = ov;
            overridden.add(st.name);
            if (boundedOverride(st.name, d)) boundedOverridden.add(st.name);
          } else { slotOf[st.name] = base[st.name]; }
        });

        var fb = s.fallback_closer;
        var fbAssignment = fb ? cells.get(cellKey(fb, d)) : null;
        // The fallback closer covers whenever they're actually working that day
        // (not on leave/OFF) - their own typed hours don't gate it, since
        // covering closing IS them working later than usual, not a condition
        // they either happen to meet or don't. Their displayed hours are
        // extended below (unless overridden) to say so.
        var fbAvailable = !!(fb && byName[fb] && fbAssignment && fbAssignment.kind === 'static');

        s.floors.forEach(function (floor) {
          var need = needs(floor, s);
          var fallbackCovering = false;
          if (fbAvailable && pair.length && byName[fb].floor === floor && (need.late || 0) > 0) {
            var covered = pair.some(function (p) { return byName[p] && byName[p].floor === floor && slotOf[p] === 'late'; });
            if (!covered) {
              need = Object.assign({}, need);
              need.late = Math.max(0, need.late - 1);
              fallbackCovering = true;
              checks.push({
                level: 'INFO', rule: 'Closing fallback',
                message: fb + ' covers closing on ' + fmtDay(d) + ' because neither ' + pair[0] + ' nor ' + pair[1] + ' is closing.',
                day: d, week: wi,
              });
              // Their displayed hours stay exactly as typed - covering closing
              // doesn't rewrite the roster sheet on their behalf. If the
              // manager wants their hours to actually show as later that day,
              // that's a manual override she types in herself.
            }
          }
          repairFloor(d, floor, slotOf, overridden, byName, s, costFn, checks, wi, need, roomOf, adjusted);
          if (fallbackCovering) capLateForFallback(d, floor, slotOf, overridden, byName, s, need, costFn, checks, wi, fb, roomOf, adjusted);
          checkFloor(d, floor, slotOf, byName, s, checks, wi, need);
        });

        checkRooms(d, slotOf, roomOf, s.shifts, checks, wi);

        for (var name in slotOf) {
          var slot = slotOf[name];
          var wasAdjusted = adjusted.has(name) || coveringBecauseOfLeave.has(name) || boundedOverridden.has(name);
          cells.set(cellKey(name, d), { kind: 'shift', slot: slot, text: shiftLabel(s.shifts[slot]), overridden: overridden.has(name), adjusted: wasAdjusted });
        }
      });

      if (pair.length) reportPairing(pair, days, cells, leaveKind, ignoredOverride, checks, wi);

      weeks.push({ monday: monday, days: days, cells: cells });

      for (var n8 in byName) {
        var slots = days.map(function (d) { return cells.get(cellKey(n8, d)); })
          .filter(function (c) { return c && c.kind === 'shift'; })
          .map(function (c) { return c.slot; });
        slots.forEach(function (sl) { period[n8][sl] = (period[n8][sl] || 0) + 1; });
        if (slots.length) lastSlot[n8] = mostCommonSlot(slots);
        // hist (which decides *future* weeks' base-slot ordering) is
        // credited for the week's whole base slot, not just the days
        // actually worked - so a mid-week leave changes only that
        // person's own cells (and, when cover genuinely needs it, someone
        // else's matching day via the daily repair pass) instead of
        // quietly shifting everyone else's rotation in later weeks just
        // because the absent person's own count came out lower than a
        // full week would have given them. period (the Fairness screen)
        // stays truthful to days actually worked.
        if (Object.prototype.hasOwnProperty.call(base, n8)) {
          var creditSlot = base[n8];
          hist[n8][creditSlot] = (hist[n8][creditSlot] || 0) + NDAYS;
          lastSlot[n8] = creditSlot;
        } else {
          slots.forEach(function (sl) { hist[n8][sl] = (hist[n8][sl] || 0) + 1; });
        }
      }
    }

    return {
      inputs: inputs, staff_keys: staffKeys, weeks: weeks, checks: checks,
      period_counts: period, cumulative_counts: hist, last_slot: lastSlot,
    };
  }

  // ---------------------------------------------------------------- duties.js port
  var DUTY_SLOTS = [
    'Hallway upstairs / Hoover stairs upstairs',
    "Children's Toilets",
    'Staff Toilet upstairs',
    'Kitchen',
    'Staff Room',
    'Hallway downstairs / windows / door handles',
    'Staff Toilet',
    'Back Garden & Bins',
    'Front creche',
    'Paper & Soap dispensers',
  ];
  var DUTY_ELIGIBLE_SLOTS = {
    'Kitchen': new Set(['mid2', 'late']),
    'Hallway downstairs / windows / door handles': new Set(['mid2', 'late']),
    "Children's Toilets": new Set(['mid2', 'late']),
    'Back Garden & Bins': new Set(['early']),
    'Staff Toilet upstairs': new Set(['early']),
    'Staff Toilet': new Set(['early']),
    'Hallway upstairs / Hoover stairs upstairs': new Set(['mid1']),
    'Staff Room': new Set(['mid1']),
    'Front creche': new Set(['mid1']),
    'Paper & Soap dispensers': new Set(['mid1']),
  };
  var DUTY_MIN_SLOT = {};
  Object.keys(DUTY_ELIGIBLE_SLOTS).forEach(function (duty) {
    var best = null;
    DUTY_ELIGIBLE_SLOTS[duty].forEach(function (sl) {
      if (best === null || SLOTS.indexOf(sl) < SLOTS.indexOf(best)) best = sl;
    });
    DUTY_MIN_SLOT[duty] = best;
  });
  var CONTEXT_ROWS = ['Cot Room', 'Changing Area'];
  var FIXED_DUTIES = [['Dusting', ['Sue']], ['Laundry', ['Shehnaz', 'Priscilla']]];
  var EXTRA_POOL = ['Jason'];

  function dutyPool(inputs) {
    var fixedNames = new Set();
    FIXED_DUTIES.forEach(function (fd) { fd[1].forEach(function (n) { fixedNames.add(n); }); });
    var pool = [];
    inputs.staff.forEach(function (st) {
      if (st.role === 'rotating' && st.name && !fixedNames.has(st.name)) pool.push(st.name);
    });
    EXTRA_POOL.forEach(function (n) {
      if (pool.indexOf(n) === -1 && inputs.staff.some(function (st) { return st.name === n; })) pool.push(n);
    });
    return pool;
  }
  // True if `name` is rostered for more than half of `days` - present
  // enough of the week to meaningfully take a duty for it. A single day
  // away shouldn't drop someone out of the whole week's duty rotation -
  // only being away most or all of the week should.
  function presentMostOfWeek(inputs, name, days) {
    var st = inputs.staff.filter(function (s) { return s.name === name; })[0];
    if (!st) return false;
    var presentDays = 0;
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (st.start_date && d < st.start_date) continue;
      if (st.end_date && d > st.end_date) continue;
      if (inputs.leave.some(function (lv) { return lv.name === name && lv.start <= d && (lv.end == null || d <= lv.end); })) continue;
      presentDays++;
    }
    return presentDays * 2 > days.length;
  }
  function weeklySlot(roster, weekIndex, name) {
    var week = roster.weeks[weekIndex];
    var slots = [];
    week.days.forEach(function (d) {
      var c = week.cells.get(cellKey(name, d));
      if (c && c.kind === 'shift') slots.push(c.slot);
    });
    if (!slots.length) return null;
    var counts = {};
    slots.forEach(function (sl) { counts[sl] = (counts[sl] || 0) + 1; });
    return maxByKey(Object.keys(counts), function (sl) { return [counts[sl], -SLOTS.indexOf(sl)]; });
  }

  function buildDutyRoster(inputs, roster) {
    var pool = dutyPool(inputs);
    var history = {};
    pool.forEach(function (n) { history[n] = {}; });
    var weeksOut = [];
    for (var wi = 0; wi < inputs.settings.weeks; wi++) {
      var monday = addDays(inputs.settings.roster_start, wi * 7);
      var days = [];
      for (var i = 0; i < NDAYS; i++) days.push(addDays(monday, i));
      var remaining = pool.filter(function (n) { return presentMostOfWeek(inputs, n, days); });
      var slotOf = {};
      remaining.forEach(function (n) { slotOf[n] = weeklySlot(roster, wi, n); });
      var assignedByDuty = {};

      // Who wins a tie (same duty-specific and total history) rotates by
      // week too - a fixed tie-break would keep resolving the same tie the
      // same way every week, pinning whichever structural shortfall
      // recurs (there are always more 17:00-finish duties than 17:00
      // finishers) onto one person permanently instead of spreading it
      // around.
      var tieOffset = wi % pool.length;
      var tieOrder = pool.slice(tieOffset).concat(pool.slice(0, tieOffset));

      function bestPick(candidates, duty) {
        return minByKey(candidates, function (n) { return [g(history[n], duty), sumAll(history[n]), tieOrder.indexOf(n)]; });
      }

      var offset = wi % DUTY_SLOTS.length;
      var pickOrder = DUTY_SLOTS.slice(offset).concat(DUTY_SLOTS.slice(0, offset));

      // Pass 0: the manager's manual picks for this week, honoured only
      // when the person's actually working that week and the duty still
      // matches the shift they're actually on now - a pick that's gone
      // stale (their shift changed since) is dropped silently and falls
      // back to the normal fair pick below, rather than forcing a
      // mismatch through or leaving the build broken.
      (inputs.duty_overrides || []).forEach(function (ov) {
        if (ov.week !== monday || DUTY_SLOTS.indexOf(ov.duty) === -1) return;
        if (assignedByDuty[ov.duty] || remaining.indexOf(ov.name) === -1) return;
        if (!DUTY_ELIGIBLE_SLOTS[ov.duty].has(slotOf[ov.name])) return;
        remaining = remaining.filter(function (x) { return x !== ov.name; });
        history[ov.name][ov.duty] = (history[ov.name][ov.duty] || 0) + 1;
        assignedByDuty[ov.duty] = ov.name;
      });

      // Pass 1: the ideal match - ties to the actual finish-time bucket
      // each duty is designed for.
      pickOrder.forEach(function (duty) {
        if (assignedByDuty[duty]) return;
        var eligible = remaining.filter(function (n) { return DUTY_ELIGIBLE_SLOTS[duty].has(slotOf[n]); });
        if (!eligible.length) return;
        var person = bestPick(eligible, duty);
        remaining = remaining.filter(function (x) { return x !== person; });
        history[person][duty] = (history[person][duty] || 0) + 1;
        assignedByDuty[duty] = person;
      });

      // Pass 2: the safe fallback, for whatever's still unfilled - anyone
      // who finishes at least as late as the duty needs (DUTY_MIN_SLOT)
      // can stand in, since they're there long enough to cover it; never
      // someone finishing earlier, who'd have already left.
      pickOrder.forEach(function (duty) {
        if (assignedByDuty[duty] || !remaining.length) return;
        var minIndex = SLOTS.indexOf(DUTY_MIN_SLOT[duty]);
        var eligible = remaining.filter(function (n) { return slotOf[n] && SLOTS.indexOf(slotOf[n]) >= minIndex; });
        if (!eligible.length) return;
        var person = bestPick(eligible, duty);
        remaining = remaining.filter(function (x) { return x !== person; });
        history[person][duty] = (history[person][duty] || 0) + 1;
        assignedByDuty[duty] = person;
      });

      var unfilled = DUTY_SLOTS.filter(function (duty) { return !assignedByDuty[duty]; });

      var assignments = CONTEXT_ROWS.map(function (duty) { return { duty: duty, people: [] }; });
      DUTY_SLOTS.forEach(function (duty) {
        assignments.push({ duty: duty, people: assignedByDuty[duty] ? [assignedByDuty[duty]] : [] });
      });
      FIXED_DUTIES.forEach(function (fd) {
        var duty = fd[0], names = fd[1];
        var present = names.filter(function (n) { return presentMostOfWeek(inputs, n, days); });
        assignments.push({ duty: duty, people: present.length ? present : names });
      });
      weeksOut.push({ monday: monday, assignments: assignments, unfilled: unfilled });
    }
    return weeksOut;
  }

  function dutyFairness(inputs, weeks) {
    var totals = {};
    dutyPool(inputs).forEach(function (n) { totals[n] = 0; });
    weeks.forEach(function (week) {
      week.assignments.forEach(function (a) {
        a.people.forEach(function (p) { if (p in totals) totals[p]++; });
      });
    });
    return totals;
  }

  // ---------------------------------------------------------------- db_import.js port
  function staffFromDoc(doc) {
    var role = doc.role || 'blank';
    var fixedSlot = null;
    if (role === 'fixed') {
      var note = doc.note || '';
      fixedSlot = SLOTS.indexOf(note) !== -1 ? note : 'early';
    }
    var hours = doc.hours || ['', '', '', '', ''];
    return {
      name: doc.name || '', floor: doc.floor || 'All', role: role, note: doc.note || '',
      fixed_slot: fixedSlot, hours: hours.slice(), number: doc.number || '',
      start_date: doc.startDate || null, end_date: doc.endDate || null, room: doc.room || '',
    };
  }
  function leaveFromDoc(doc) { return { name: doc.name, start: doc.start, end: doc.end || null, kind: doc.kind || 'Leave' }; }
  function overrideFromTransferDoc(doc) {
    return { name: doc.name, start: doc.start, end: doc.end || null, slot: doc.slot || null, text: doc.text || '' };
  }
  function dutyOverrideFromDoc(doc) { return { name: doc.name, week: doc.week, duty: doc.duty }; }
  function seedNewJoinerHistory(staff, history) {
    var scheduled = new Set(['rotating', 'fixed', 'paired']);
    var countedNames = staff.filter(function (s) { return scheduled.has(s.role) && s.name && (s.name in history); }).map(function (s) { return s.name; });
    var avg;
    if (countedNames.length) {
      avg = {};
      SLOTS.forEach(function (slot) {
        avg[slot] = pyRound(countedNames.reduce(function (sum, n) { return sum + g(history[n], slot); }, 0) / countedNames.length);
      });
    } else {
      avg = {}; SLOTS.forEach(function (slot) { avg[slot] = 0; });
    }
    var seeded = Object.assign({}, history);
    staff.forEach(function (st) {
      if (scheduled.has(st.role) && st.name && !(st.name in seeded)) seeded[st.name] = Object.assign({}, avg);
    });
    return seeded;
  }
  function buildInputsFromDb(settings, staffDocs, leaveDocs, transferDocs, history, lastSlot, dutyOverrideDocs) {
    var ordered = staffDocs.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var staff = ordered.map(staffFromDoc);
    var leave = leaveDocs.map(leaveFromDoc);
    history = seedNewJoinerHistory(staff, history);
    var overrides = transferDocs.filter(function (d) { return d.slot || d.text; }).map(overrideFromTransferDoc);
    var dutyOverrides = (dutyOverrideDocs || []).map(dutyOverrideFromDoc);
    return {
      settings: settings, staff: staff, leave: leave, overrides: overrides,
      duty_overrides: dutyOverrides, history: history, last_slot: lastSlot,
    };
  }

  // ---------------------------------------------------------------- build_preview.js port
  var ADJUSTMENT_RULES = new Set(['Cover adjusted', 'Closing fallback']);

  function summaryJson(inputs, roster) {
    var weeksOut = [];
    roster.weeks.forEach(function (week, wi) {
      var breaches = roster.checks.filter(function (c) { return c.week === wi && c.level === 'BREACH'; }).map(function (c) { return c.message; });
      var warnings = roster.checks.filter(function (c) { return c.week === wi && c.level === 'WARNING'; }).map(function (c) { return c.message; });
      var adjustments = roster.checks.filter(function (c) { return c.week === wi && ADJUSTMENT_RULES.has(c.rule); }).map(function (c) { return c.message; });
      var infos = roster.checks.filter(function (c) { return c.week === wi && c.level === 'INFO' && !ADJUSTMENT_RULES.has(c.rule); }).map(function (c) { return c.message; });
      var working = [], people = [];
      roster.staff_keys.forEach(function (ks) {
        var key = ks[0], st = ks[1];
        if (st.role === 'blank') return;
        var label = st.name || (st.role === 'vacant' ? 'Vacant post' : '');
        if (!label) return;
        var daysOut = week.days.map(function (d) {
          var c = week.cells.get(cellKey(key, d));
          return { text: c.text || '', kind: c.kind, adjusted: !!c.adjusted };
        });
        people.push({ name: label, role: st.role, days: daysOut });
        if (st.role !== 'vacant' && week.days.some(function (d) {
          var c = week.cells.get(cellKey(key, d)); return c && (c.kind === 'shift' || c.kind === 'static');
        })) working.push(st.name);
      });
      weeksOut.push({
        label: weekLabel(week.days), monday: week.monday, day_names: DAY_NAMES,
        breaches: breaches, warnings: warnings, adjustments: adjustments, notes: infos,
        working: working, people: people,
      });
    });
    return { title: inputs.settings.title, weeks: weeksOut };
  }

  function dutiesJson(inputs, dutyWeeks) {
    return dutyWeeks.map(function (dw) {
      var days = []; for (var i = 0; i < NDAYS; i++) days.push(addDays(dw.monday, i));
      return { label: weekLabel(days), monday: dw.monday, assignments: dw.assignments, unfilled: dw.unfilled };
    });
  }

  function fairnessJson(inputs, roster, dutyWeeks) {
    var rotatingNames = inputs.staff.filter(function (st) { return st.role === 'rotating' && st.name; }).map(function (st) { return st.name; });
    var shiftRows = rotatingNames.map(function (name) {
      var pc = roster.period_counts[name] || {};
      return { name: name, early: g(pc, 'early'), mid1: g(pc, 'mid1'), mid2: g(pc, 'mid2'), late: g(pc, 'late') };
    });
    var totals = dutyFairness(inputs, dutyWeeks);
    var dutyRows = dutyPool(inputs).map(function (name) { return { name: name, duties: totals[name] || 0 }; });
    return { shifts: shiftRows, duties: dutyRows };
  }

  // ---------------------------------------------------------------- top-level build + diff
  function build(staffDocs, leaveDocs, transferDocs, rosterStartIso, dutyOverrideDocs) {
    var settings = buildSettings(rosterStartIso);
    var inputs = buildInputsFromDb(settings, staffDocs, leaveDocs, transferDocs, {}, {}, dutyOverrideDocs);
    var roster = buildRoster(inputs);
    var dutyWeeks = buildDutyRoster(inputs, roster);
    var summary = summaryJson(inputs, roster);
    summary.duties = dutiesJson(inputs, dutyWeeks);
    summary.fairness = fairnessJson(inputs, roster, dutyWeeks);
    return { inputs: inputs, roster: roster, dutyWeeks: dutyWeeks, summary: summary };
  }

  function peopleByWeek(roster) {
    return roster.weeks.map(function (week) {
      var people = {};
      roster.staff_keys.forEach(function (ks) {
        var key = ks[0], st = ks[1];
        if (st.role === 'blank' || !st.name) return;
        people[st.name] = week.days.map(function (d) { return (week.cells.get(cellKey(key, d)) || {}).text || ''; });
      });
      return people;
    });
  }
  // Per week, not a flat list across all 4 - the least-done-first fairness
  // rebalancing can genuinely ripple into later weeks the viewer isn't
  // currently looking at, and flattening that hid which week each change
  // was actually in (looked like everyone changed "now" when only this
  // week's person actually did).
  function diffRosters(beforeRoster, afterRoster, changedName) {
    if (!beforeRoster) return [];
    var beforeWeeks = peopleByWeek(beforeRoster);
    var afterWeeks = peopleByWeek(afterRoster);
    return afterWeeks.map(function (ap, wi) {
      var bp = beforeWeeks[wi] || {};
      var changed = [];
      for (var name in ap) {
        if (name === changedName) continue;
        var b = bp[name], a = ap[name];
        if (!b || a.join('|') !== b.join('|')) changed.push(name);
      }
      return changed;
    });
  }

  global.RosterEngine = {
    build: build,
    buildSettings: buildSettings,
    buildInputsFromDb: buildInputsFromDb,
    buildRoster: buildRoster,
    buildDutyRoster: buildDutyRoster,
    summaryJson: summaryJson,
    dutiesJson: dutiesJson,
    fairnessJson: fairnessJson,
    diffRosters: diffRosters,
    mondayOfWeek: mondayOfWeek,
    addDays: addDays,
    dutyPool: dutyPool,
    weeklySlot: weeklySlot,
    presentMostOfWeek: presentMostOfWeek,
    DUTY_SLOTS: DUTY_SLOTS,
    DUTY_ELIGIBLE_SLOTS: DUTY_ELIGIBLE_SLOTS,
  };
})(typeof window !== 'undefined' ? window : global);
