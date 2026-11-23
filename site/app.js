const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const norm = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase();
const format = (n) => n.toLocaleString("en-US");
const names = {
  BAS: "BASIC",
  ADV: "ADVANCED",
  EXP: "EXPERT",
  MAS: "MASTER",
  ULT: "ULTIMA",
  WE: "WORLD’S END",
};
const states = {
  present: "已收录",
  possible: "可能存在",
  removed: "已删除",
  not_released: "未推出",
  disabled: "已停用",
};
const flags = {
  up: "▲",
  down: "▼",
  first: "",
  released: "",
  restored: "↺",
  removed: "×",
};
const table = $("viewport"),
  modal = $("modal"),
  cache = new Map();
let db,
  groups = [],
  columns = [],
  difficulty = "",
  comparing = false,
  opened = null,
  source = null,
  frame = 0,
  range = "";
async function pack(name) {
  const res = await fetch("data/" + name);
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  const bytes = await res.arrayBuffer(); // Some CDNs transparently decode .gz.
  const stream =
    new Uint8Array(bytes)[0] === 31
      ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
      : bytes;
  return new Response(stream).json();
}
function options(id, items) {
  $(id).replaceChildren(...items.map(([v, t]) => new Option(t, v)));
}
function value(cell, we) {
  if (!cell) return "—";
  if (cell[0] !== "present")
    return (
      {
        possible: "？",
        removed: "删除",
        not_released: "未出",
        disabled: "停用",
      }[cell[0]] ?? "？"
    );
  if (we) return `${cell[2] ?? "？"}★${cell[1] ?? "？"}`;
  return cell[1] == null ? "？" : (cell[1] / 100).toFixed(cell[1] % 10 ? 2 : 1);
}
function change(c, i, prev = i - 1, pair = false) {
  const a = c.timeline[prev],
    b = c.timeline[i];
  if (pair) {
    if (prev === i) return "";
    if (a?.[0] === "present" && b?.[0] === "removed") return "removed";
    if (b?.[0] === "present" && a?.[0] === "removed") return "restored";
    if (b?.[0] === "present" && a?.[0] === "not_released") return "released";
    if (c.d !== "WE" && a?.[0] === "present" && b?.[0] === "present" && a[1] != null && b[1] != null) {
      return b[1] > a[1] ? "up" : b[1] < a[1] ? "down" : "";
    }
    return "";
  }
  const marks = c.marks?.[i] || [];
  if (marks.includes("removed") && (!b || b[0] !== "present")) return "removed";
  if (marks.includes("restored") && (!b || b[0] === "present"))
    return "restored";
  if (
    marks.includes("released") &&
    (!b || b[0] === "present") &&
    (!comparing || !a || a[0] !== "present")
  )
    return "released";
  if (!b) return "";
  if (b[0] === "removed" && a?.[0] !== "removed") return "removed";
  if (b[0] !== "present") return "";
  if (i === c.first && (!comparing || prev < i)) return "first";
  if (c.d === "WE" || a?.[0] !== "present" || a[1] == null || b[1] == null)
    return "";
  return b[1] > a[1] ? "up" : b[1] < a[1] ? "down" : "";
}
function cover(s, cls = "cover") {
  return s.cover
    ? `<img class="${cls}" src="data/jackets/${s.cover}.webp" alt="" decoding="async">`
    : `<span class="${cls}" aria-label="缺少曲绘"></span>`;
}
function cellHtml(c, i, prev, target = false) {
  const cell = c.timeline[i],
    flag = comparing && !target ? "" : change(c, i, prev, target),
    label = value(cell, c.d === "WE");
  const hint = cell
    ? [
        states[cell[0]],
        cell[3] === "hdd_inherited" ? "继承记录" : "",
        cell[4],
        cell[5] ? `标级 ${cell[5]}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "无版本快照";
  return `<div class="cell ${flag} ${!cell ? "nil" : ""}" title="${escape(hint)}">${flags[flag] ? `<i>${flags[flag]}</i>` : ""}${escape(label)}</div>`;
}
function update() {
  if (!db) return;
  const vi = $("ver").value,
    from = +$("from").value,
    to = +$("to").value;
  columns = comparing
    ? [from, to]
    : vi === ""
      ? db.versions.map((_, i) => i)
      : [+vi];
  const scan = comparing ? [to] : columns,
    lo = $("min").value,
    hi = $("max").value,
    kind = $("change").value,
    query = norm($("q").value.trim());
  const category = $("genre").value,
    sort = $("sort").value;
  groups = [];
  for (const s of db.songs) {
    if (category && !s.genres.includes(category)) continue;
    const match = s.search.includes(query);
    const cs = s.charts.filter((c) => {
      if (
        (difficulty && c.d !== difficulty) ||
        (!match && !c.search.includes(query))
      )
        return false;
      return scan.some((i) => {
        const v = c.timeline[i];
        if (!comparing && vi !== "" && !v && !c.marks?.[i]) return false;
        if (
          comparing &&
          !v &&
          !c.timeline[from] &&
          !c.marks?.[i] &&
          !c.marks?.[from]
        )
          return false;
        if (
          (lo !== "" || hi !== "") &&
          (c.d === "WE" ||
            v?.[0] !== "present" ||
            v[1] == null ||
            (lo !== "" && v[1] < Math.round(Number(lo) * 100)) ||
            (hi !== "" && v[1] > Math.round(Number(hi) * 100)))
        )
          return false;
        return !kind || change(c, i, comparing ? from : i - 1, comparing) === kind;
      });
    });
    if (
      !cs.length &&
      (s.charts.length ||
        !match ||
        difficulty ||
        kind ||
        lo ||
        hi ||
        vi !== "" ||
        comparing)
    )
      continue;
    const level =
      sort === "level"
        ? Math.max(
            -1,
            ...cs.flatMap((c) =>
              c.d === "WE"
                ? []
                : scan.map((i) =>
                    c.timeline[i]?.[0] === "present"
                      ? (c.timeline[i][1] ?? -1)
                      : -1,
                  ),
            ),
          )
        : 0;
    groups.push({ s, cs, level });
  }
  if (sort === "title")
    groups.sort((a, b) => a.s.title.localeCompare(b.s.title, "ja"));
  if (sort === "level") groups.sort((a, b) => b.level - a.level);
  let y = 0,
    n = 0;
  for (const g of groups) {
    g.y = y;
    y += 33 * Math.max(1, g.cs.length);
    g.end = y;
    n += g.cs.length;
  }
  $("body").style.height = y + "px";
  table.style.setProperty("--n", columns.length);
  $("head").innerHTML =
    '<div class="namehead">曲目 / ARTIST</div><div class="diffhead">难度</div>' +
    columns
      .map(
        (i) =>
          `<div class="vhead" title="${escape(db.versions[i].join(" · "))}"><img src="assets/v${i}.webp" alt=""><strong>${escape(db.versions[i][0])}</strong><span class="year">${db.versions[i][1].slice(0, 4)}</span></div>`,
      )
      .join("");
  $("count").textContent =
    `${format(groups.length)} 首曲目 · ${format(n)} 张谱面`;
  table.scrollTop = 0;
  table.scrollLeft = 0;
  range = "";
  draw();
}
function draw() {
  if (!db) return;
  let l = 0,
    r = groups.length;
  const y = table.scrollTop - 180;
  while (l < r) {
    const m = (l + r) >> 1;
    if (groups[m].end < y) l = m + 1;
    else r = m;
  }
  let end = l;
  while (end < groups.length && groups[end].y < y + table.clientHeight + 400)
    end++;
  const key = `${l}/${end}`;
  if (key === range) return;
  range = key;
  const html = groups
    .slice(l, end)
    .map(
      ({ s, cs, y }) =>
        `<div class="block" style="top:${y}px"><button class="song ${cs.length < 2 ? "single" : ""}" style="grid-row:span ${Math.max(1, cs.length)}" data-id="${escape(s.id)}" title="${escape(s.title)}">${cover(s)}<span><strong>${escape(s.title)}</strong><small>${escape(s.artist || "曲师未知")}</small></span></button>${cs.map((c) => `<div class="badge ${c.d}"><span>${c.d}</span></div>` + columns.map((i, j) => cellHtml(c, i, comparing && j === 1 ? columns[0] : i - 1, comparing && j === 1)).join("")).join("") || '<div class="badge">无谱面</div>'}</div>`,
    )
    .join("");
  $("body").innerHTML =
    html || '<p class="empty">没有符合条件的曲目。请调整筛选或搜索词。</p>';
}
const guide = `<article class="guide"><div class="eyebrow">READING THE ARCHIVE</div><h2>矩阵阅读指南</h2><p>每列是一个日服版本的快照，每行是一张独立谱面。点击曲名或曲绘可查看该版本内的修订记录。</p><p><b>新增</b> 和首见以浅绿色数值显示。新增来自历史库的确切配信日期，↺ 表示复活，× 表示明确删除。<b>首见</b> 表示该谱面首次被版本快照确认为已收录。实际配信日期可在详情的历史记录中查阅。</p><p>▲ 和 ▼ 表示两个已知定数之间的变化。× 表示库中明确记录删除。— 表示缺少快照，？表示状态或数值尚不确定。</p><p>WORLD’S END 显示属性和星数。定数范围与升降筛选仅适用于普通谱面。未指定版本时，任一版本满足筛选即可。</p><p>曲目按历史库中的独立身份计数。相同曲名可能对应不同的复刻、特殊谱面或包内记录。</p></article>`;
function transition(fn) {
  if (
    document.startViewTransition &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return document.startViewTransition(fn).finished.catch(() => {});
  fn();
  return Promise.resolve();
}
function close() {
  if (!modal.open) return;
  opened = null;
  transition(() => {
    modal.close();
    if (source?.isConnected) {
      source.querySelector(".cover").style.viewTransitionName = "jacket";
      source.focus({ preventScroll: true });
    }
  }).finally(() => {
    if (source?.isConnected)
      source.querySelector(".cover").style.viewTransitionName = "";
    source = null;
  });
}
const kinds = {
  released: "配信",
  removed: "删除",
  restored: "恢复配信",
  revision: "版本修订",
  hdd_revision: "HDD 修订",
  observation_gap: "观测间断",
  reobserved: "再次观测",
  file_observed: "文件首次观测",
  first_hdd_observation: "HDD 首次观测",
  removal_boundary_candidate: "候选删除边界",
  missing_from_local_overlay: "本地资源缺失",
  hdd_disabled: "HDD 停用",
  hdd_reappeared: "HDD 再次出现",
};
function showEvents(events) {
  let limit = 40;
  const host = $("events");
  function render() {
    host.innerHTML =
      events
        .slice(0, limit)
        .map(
          ([d, v, date, earliest, latest, kind, field, a, b, batch]) =>
            `<div class="event"><b>${escape(date || [earliest, latest].filter(Boolean).join(" ～ ") || "日期未确定")}</b>　${escape(kinds[kind] || kind)} · ${escape(d)}<small>${escape(v || batch)} / ${escape(field)}　${escape(typeof a === "object" ? JSON.stringify(a) : a)} → ${escape(typeof b === "object" ? JSON.stringify(b) : b)}</small></div>`,
        )
        .join("") || "无事件记录";
    if (limit < events.length) {
      const more = document.createElement("button");
      more.textContent = `继续显示（剩余 ${events.length - limit} 条）`;
      more.onclick = () => {
        limit += 80;
        render();
      };
      host.append(more);
    }
  }
  render();
}
async function openSong(s, button) {
  opened = s.id;
  source = button;
  button.querySelector(".cover").style.viewTransitionName = "jacket";
  await transition(() => {
    button.querySelector(".cover").style.viewTransitionName = "";
    $("detail").innerHTML =
      `<div class="profile">${cover(s)}<div><small>${escape(s.genres.join(" / "))} · #${s.num}</small><h2>${escape(s.title)}</h2><div>${escape(s.artist || "曲师未知")}</div></div></div><h3>谱面与谱师</h3>${s.charts.map((c) => `<div class="detailmeta"><b class="${c.d}" style="color:var(--dc)">${names[c.d]}</b>　${escape(c.designers.join(" / ") || "谱师未知")}</div>`).join("")}<h3>历代快照</h3><div class="mini"><table><thead><tr><th>日服版本</th>${s.charts.map((c) => `<th>${c.d}</th>`).join("")}</tr></thead><tbody>${db.versions.map(([v], i) => `<tr><th>${escape(v)}</th>` + s.charts.map((c) => `<td title="${escape(c.timeline[i]?.[4] || "谱师未知")}">${escape(value(c.timeline[i], c.d === "WE"))}</td>`).join("") + "</tr>").join("")}</tbody></table></div><h3>历史事件 <small id="eventCount"></small></h3><div id="events">正在读取包内修订与配信记录…</div>`;
    $("detail").querySelector(".cover").style.viewTransitionName = "jacket";
    modal.showModal();
    modal.scrollTop = 0;
  });
  if (opened !== s.id) return;
  try {
    const file = db.history[s.group];
    if (!cache.has(file))
      cache.set(
        file,
        pack(file).catch((err) => {
          cache.delete(file);
          throw err;
        }),
      );
    const data = await cache.get(file);
    if (opened === s.id) {
      const events = data[s.id] || [];
      $("eventCount").textContent = `(${events.length})`;
      showEvents(events);
    }
  } catch {
    if (opened === s.id)
      $("events").textContent = "历史分片读取失败，请关闭后重试。";
  }
}
async function init() {
  const m = await (
    await fetch("data/manifest.json", { cache: "no-cache" })
  ).json();
  db = await pack(m.index);
  for (const s of db.songs) {
    s.search = norm([s.title, s.artist, s.num, ...s.aliases].join("\n"));
    for (const c of s.charts) {
      c.search = norm(c.designers.join("\n"));
      let ptr = 0,
        code = 0;
      c.timeline = db.versions.map((_, i) => {
        if (c.cells[ptr] === i) {
          code = c.cells[ptr + 1];
          ptr += 2;
        }
        return db.cells[code];
      });
      c.first = c.timeline.findIndex((v) => v?.[0] === "present");
    }
  }
  const vs = db.versions.map(([v], i) => [i, v]);
  options("ver", [["", "全部版本"], ...vs]);
  options("from", vs);
  options("to", vs);
  $("from").value = vs.length - 2;
  $("to").value = vs.length - 1;
  options("genre", [
    ["", "全部分类"],
    ...[...new Set(db.songs.flatMap((s) => s.genres))]
      .sort()
      .map((t) => [t, t]),
  ]);
  $("stats").innerHTML = [
    [m.songs, "首曲目"],
    [m.charts, "张谱面"],
    [m.versions, "个版本"],
  ]
    .map(([n, label]) => `<span><b>${format(n)}</b> ${label}</span>`)
    .join("");
  $("wall").innerHTML = [
    69, 202, 152, 72, 506, 201, 464, 226, 500, 635, 380, 205, 75, 561, 452, 183,
    32, 150, 85, 160, 400,
  ]
    .map((id) => db.songs.find((s) => s.num === id && s.cover))
    .filter(Boolean)
    .map((s) => cover(s, "tile"))
    .join("");
  $("diff").innerHTML = Object.entries({ "": "全部难度", ...names })
    .map(
      ([d, n]) =>
        `<button type="button" class="${d}" data-d="${d}" aria-pressed="${d === ""}">${d ? '<i class="dot"></i>' : ""}${n}</button>`,
    )
    .join("");
  update();
}
$("diff").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  difficulty = b.dataset.d;
  for (const x of $("diff").children)
    x.setAttribute("aria-pressed", String(x === b));
  update();
};
$("filters").onclick = () => {
  const show = $("extra").hidden;
  $("extra").hidden = !show;
  $("filters").classList.toggle("on", show);
  $("filters").setAttribute("aria-expanded", String(show));
};
$("compare").onclick = () => {
  comparing = !comparing;
  $("pair").hidden = !comparing;
  $("compare").classList.toggle("on", comparing);
  $("compare").setAttribute("aria-pressed", String(comparing));
  $("ver").disabled = comparing;
  update();
};
$("reset").onclick = () => {
  for (const id of ["min", "max", "genre", "ver", "q", "change"])
    $(id).value = "";
  $("diff").firstElementChild.click();
  $("diff").scrollLeft = 0;
};
$("tools").oninput = update;
table.onscroll = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
};
new ResizeObserver(draw).observe(table);
$("body").onclick = (e) => {
  const b = e.target.closest(".song");
  if (b)
    openSong(
      db.songs.find((s) => s.id === b.dataset.id),
      b,
    );
};
$("guide").onclick = () => {
  $("detail").innerHTML = guide;
  modal.showModal();
  modal.scrollTop = 0;
};
modal.querySelector(".close").onclick = close;
modal.oncancel = (e) => {
  e.preventDefault();
  close();
};
modal.onclick = (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      close();
  }
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !modal.open &&
    !["INPUT", "SELECT"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    $("q").focus();
  }
});
init().catch((err) => {
  $("count").textContent = `档案载入失败（${err.message}），请刷新重试。`;
});
