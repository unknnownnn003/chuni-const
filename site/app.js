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
// The history catalog has both early and NEW-era identities for the tutorials.
const tutorialIds = new Set([
  "1:50:1",
  "1:81:1",
  "sdhd:A000:NEW:1:50",
  "sdhd:A000:NEW:1:81",
]);
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
  matrix = $("matrix"),
  modal = $("modal");
let db,
  groups = [],
  columns = [],
  difficulty = "",
  source = null,
  frame = 0,
  range = "",
  zoom = 1;
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
function change(c, i) {
  const a = c.timeline[i - 1],
    b = c.timeline[i];
  const marks = c.marks?.[i] || [];
  if (marks.includes("removed") && (!b || b[0] !== "present")) return "removed";
  if (marks.includes("restored") && (!b || b[0] === "present"))
    return "restored";
  if (marks.includes("released") && (!b || b[0] === "present"))
    return "released";
  if (!b) return "";
  if (b[0] === "removed" && a?.[0] !== "removed") return "removed";
  if (b[0] !== "present") return "";
  if (i === c.first) return "first";
  if (c.d === "WE" || a?.[0] !== "present" || a[1] == null || b[1] == null)
    return "";
  return b[1] > a[1] ? "up" : b[1] < a[1] ? "down" : "";
}
function cover(s) {
  return s.cover
    ? `<img class="cover" src="data/jackets/${s.cover}.webp" alt="" decoding="async">`
    : `<span class="cover" aria-label="缺少曲绘"></span>`;
}
function cellHtml(c, i, tutorial) {
  if (tutorial) return '<div class="cell nil">-</div>';
  const cell = c.timeline[i],
    flag = change(c, i),
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
  const vi = $("ver").value;
  const selectedVersions = vi === "" ? db.versions.map((_, i) => i) : [+vi];
  const lo = $("min").value,
    hi = $("max").value,
    query = norm($("q").value.trim());
  const category = $("genre").value,
    sort = $("sort").value;
  groups = [];
  for (const s of db.songs) {
    const tutorial = tutorialIds.has(s.id);
    if (category && !s.genres.includes(category)) continue;
    const match = s.search.includes(query);
    const cs = s.charts.filter((c) => {
      if (
        (difficulty && c.d !== difficulty) ||
        (!match && !c.search.includes(query))
      )
        return false;
      return selectedVersions.some((i) => {
        const v = c.timeline[i];
        if (vi !== "" && !v && !c.marks?.[i]) return false;
        if (
          (lo !== "" || hi !== "") &&
          (tutorial ||
            c.d === "WE" ||
            v?.[0] !== "present" ||
            v[1] == null ||
            (lo !== "" && v[1] < Math.round(Number(lo) * 100)) ||
            (hi !== "" && v[1] > Math.round(Number(hi) * 100)))
        )
          return false;
        return true;
      });
    });
    if (
      !cs.length &&
      (s.charts.length || !match || difficulty || lo || hi || vi !== "")
    )
      continue;
    const level =
      sort === "level" && !tutorial
        ? Math.max(
            -1,
            ...cs.flatMap((c) =>
              c.d === "WE"
                ? []
                : selectedVersions.map((i) =>
                    c.timeline[i]?.[0] === "present"
                      ? (c.timeline[i][1] ?? -1)
                      : -1,
                  ),
            ),
          )
        : -1;
    groups.push({ s, cs, level, tutorial });
  }
  columns = selectedVersions;
  if ($("hideEmptyVersions").checked) {
    // Check filtered data rather than just the rows rendered in the viewport.
    columns = selectedVersions.filter((i) => groups.some(({ cs, tutorial }) =>
      !tutorial && cs.some((c) => c.timeline[i] || flags[change(c, i)])
    ));
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
  table.style.setProperty("--matrix-columns", columns.length
    ? `var(--pin) var(--diff) repeat(${columns.length}, var(--col))`
    : "var(--pin) var(--diff)");
  $("head").innerHTML =
    '<div class="namehead">曲目 / ARTIST</div><div class="diffhead">难度</div>' +
    columns
      .map(
        (i) =>
          `<div class="vhead" title="${escape(db.versions[i].join(" · "))}"><img src="assets/v${i}.webp" alt=""><strong>${escape(db.versions[i][0])}</strong><span class="year">${db.versions[i][1].slice(0, 4)}</span></div>`,
      )
      .join("");
  $("count").textContent =
    `${format(groups.length)} 首曲目 · ${format(n)} 张谱面` +
    (groups.length && !columns.length ? " · 无可显示的版本列" : "");
  table.scrollTop = 0;
  table.scrollLeft = 0;
  range = "";
  draw();
}
const wikiTitles = new Map([
  ["1/3の純情な感情", "1／3の純情な感情"],
  ["]-[|/34<#!", "ヒバチ"],
  ['≠彡"/了→', "キミツアー"],
  ["Sinfonie Nr. 9 d-moll op. 125 (Master)", "Sinfonie Nr. 9 d-moll op. 125"],
]);
function songLinks(song) {
  const wikiTitle = wikiTitles.get(song.title) ?? song.title;
  const wikiPath = wikiTitle.split("/").map((part) =>
    encodeURIComponent(part).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  ).join("/");
  const wiki = `https://wikiwiki.jp/chunithmwiki/${wikiPath}`;
  const wikiLabel = escape(`${song.title} · CHUNITHM Wiki（新标签页）`);
  const sdvxLabel = escape(`${song.title} · SDVX.IN 谱面（新标签页）`);
  const chart = song.sdvx;
  const score = chart
    ? `<a class="song-link score-link" href="https://sdvx.in/chunithm/_/viewer.php?${escape(new URLSearchParams({ id: chart[0], diff: chart[1] }))}" target="_blank" rel="noopener noreferrer" aria-label="${sdvxLabel}" title="${sdvxLabel}">♫</a>`
    : '<span class="song-link score-link" role="img" aria-label="暂无可确认的 SDVX.IN 谱面直链" title="暂无可确认的 SDVX.IN 谱面直链">♫</span>';
  return `<div class="song-links">
    <a class="song-link wiki-link" href="${escape(wiki)}" target="_blank" rel="noopener noreferrer" aria-label="${wikiLabel}" title="${wikiLabel}">▤</a>
    ${score}
  </div>`;
}
function draw() {
  if (!db) return;
  let l = 0,
    r = groups.length;
  const y = table.scrollTop / zoom - 180;
  while (l < r) {
    const m = (l + r) >> 1;
    if (groups[m].end < y) l = m + 1;
    else r = m;
  }
  let end = l;
  while (end < groups.length && groups[end].y < y + table.clientHeight / zoom + 400)
    end++;
  const key = `${l}/${end}`;
  if (key === range) return;
  range = key;
  const html = groups
    .slice(l, end)
    .map(({ s, cs, y, tutorial }) => {
      let rows = cs.map((c) =>
        `<div class="badge ${c.d}"><span>${c.d}</span></div>` +
        columns.map((i) => cellHtml(c, i, tutorial)).join("")
      ).join("");
      if (!cs.length) {
        rows = tutorial
          ? '<div class="badge">-</div>' + columns.map((i) => cellHtml(null, i, true)).join("")
          : '<div class="badge">无谱面</div>';
      }
      return `<div class="block" style="top:${y}px">
        <div class="song-cell${cs.length < 2 ? " single" : ""}" style="grid-row:span ${Math.max(1, cs.length)}">
          <button type="button" class="song" data-id="${escape(s.id)}" title="${escape(s.title)}">${cover(s)}<span><strong>${escape(s.title)}</strong><small>${escape(s.artist || "曲师未知")}</small></span></button>
          ${songLinks(s)}
        </div>${rows}
      </div>`;
    })
    .join("");
  $("body").innerHTML =
    html || '<p class="empty">没有符合条件的曲目。请调整筛选或搜索词。</p>';
}
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
function snapshotTable(s) {
  const tutorial = tutorialIds.has(s.id);
  const charts = tutorial && !s.charts.length ? [null] : s.charts;
  const headings = charts.map((c) => `<th>${c?.d ?? "定数"}</th>`).join("");
  const rows = db.versions.map(([version], i) => {
    const cells = charts.map((c) => {
      const cell = c?.timeline[i];
      const credit = cell?.[4];
      const title = credit ? ` title="${escape(credit)}"` : "";
      const label = tutorial ? "-" : value(cell, c.d === "WE");
      return `<td${title}>${escape(label)}</td>`;
    }).join("");
    return `<tr><th>${escape(version)}</th>${cells}</tr>`;
  }).join("");
  return `<div class="mini"><table><thead><tr><th>日服版本</th>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function openSong(s, button) {
  source = button;
  button.querySelector(".cover").style.viewTransitionName = "jacket";
  transition(() => {
    button.querySelector(".cover").style.viewTransitionName = "";
    $("detail").innerHTML =
      `<div class="profile">${cover(s)}<div><small>${escape(s.genres.join(" / "))} · #${s.num}</small><h2>${escape(s.title)}</h2><div>${escape(s.artist || "曲师未知")}</div></div></div><h3>谱面与谱师</h3>${s.charts.map((c) => `<div class="detailmeta"><b class="${c.d}" style="color:var(--dc)">${names[c.d]}</b>　${escape(c.designers.join(" / ") || "档案未署名")}</div>`).join("")}<h3>历代快照</h3>${snapshotTable(s)}`;
    $("detail").querySelector(".cover").style.viewTransitionName = "jacket";
    modal.showModal();
    modal.scrollTop = 0;
  });
}
async function init() {
  const m = await (
    await fetch("data/manifest.json", { cache: "no-cache" })
  ).json();
  const [catalog, sdvxLinks] = await Promise.all([
    pack(m.index),
    fetch("data/sdvx-links.json", { cache: "no-cache" })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({})),
  ]);
  db = catalog;
  for (const s of db.songs) {
    s.sdvx = sdvxLinks[s.id];
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
  options("genre", [
    ["", "全部分类"],
    ...[...new Set(db.songs.flatMap((s) => s.genres))]
      .sort()
      .map((t) => [t, t]),
  ]);
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
$("reset").onclick = () => {
  for (const id of ["min", "max", "genre", "ver", "q"])
    $(id).value = "";
  $("hideEmptyVersions").checked = false;
  $("diff").firstElementChild.click();
  $("diff").scrollLeft = 0;
};
$("tools").oninput = update;
table.onscroll = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
};
new ResizeObserver(draw).observe(table);

const MIN_ZOOM = 0.65, MAX_ZOOM = 1.5;
function zoomAt(next, x, y, moveX = 0, moveY = 0) {
  next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  const ratio = next / zoom;
  const left = (table.scrollLeft + x) * ratio - x - moveX;
  const top = (table.scrollTop + y) * ratio - y - moveY;
  if (next !== zoom) {
    zoom = next;
    matrix.style.setProperty("--zoom", zoom);
    $("zoomReset").textContent = `${Math.round(zoom * 100)}%`;
    $("zoomOut").disabled = zoom === MIN_ZOOM;
    $("zoomIn").disabled = zoom === MAX_ZOOM;
  }
  table.scrollTo(left, top);
  draw(); // Zoom can reveal more rows even without a scroll event.
}
function zoomFromCenter(next) {
  zoomAt(next, table.clientWidth / 2, table.clientHeight / 2);
}
$("zoomOut").onclick = () => zoomFromCenter(zoom / 1.15);
$("zoomIn").onclick = () => zoomFromCenter(zoom * 1.15);
$("zoomReset").onclick = () => zoomFromCenter(1);
table.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = table.getBoundingClientRect();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? table.clientHeight : 1;
  zoomAt(zoom * Math.exp(-e.deltaY * unit * 0.002), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

const pointers = new Map();
let dragging = false;
let suppressClick = false;
function startDrag() {
  dragging = true;
  suppressClick = true;
  table.classList.add("dragging");
  for (const id of pointers.keys()) table.setPointerCapture(id);
}
table.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || pointers.size >= 2) return;
  if (!pointers.size) suppressClick = false;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) startDrag();
});
table.addEventListener("pointermove", (e) => {
  const previous = pointers.get(e.pointerId);
  if (!previous) return;
  const x = e.clientX, y = e.clientY;
  const dx = x - previous.x, dy = y - previous.y;
  if (!dragging) {
    if (Math.hypot(dx, dy) < 5) return;
    startDrag();
  }
  pointers.set(e.pointerId, { x, y });
  if (pointers.size === 1) {
    table.scrollBy(-dx, -dy);
    return;
  }
  const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
  const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
  const distance = Math.hypot(x - other.x, y - other.y);
  const rect = table.getBoundingClientRect();
  zoomAt(
    oldDistance > 1 ? zoom * distance / oldDistance : zoom,
    (previous.x + other.x) / 2 - rect.left,
    (previous.y + other.y) / 2 - rect.top,
    dx / 2, dy / 2,
  );
});
function endPointer(e) {
  if (!pointers.delete(e.pointerId) || pointers.size) return;
  dragging = false;
  table.classList.remove("dragging");
}
window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);
table.addEventListener("lostpointercapture", (e) => {
  if (e.target === table) endPointer(e);
});
table.addEventListener("pointerleave", (e) => {
  if (!dragging) endPointer(e);
});
table.addEventListener("dragstart", (e) => e.preventDefault());
table.addEventListener("click", (e) => {
  if (!suppressClick || e.detail === 0) return;
  e.preventDefault();
  e.stopPropagation();
}, { capture: true });
$("body").onclick = (e) => {
  const b = e.target.closest(".song");
  if (b)
    openSong(
      db.songs.find((s) => s.id === b.dataset.id),
      b,
    );
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
