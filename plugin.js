/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino — 1.5.2
 * jkanime.bz — Home: episodios recientes, emision, recientes, latino 16:9
 */

const BASE = "https://jkanime.bz";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    Referer: BASE + "/",
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

async function get(path, referer) {
  var url = path.indexOf("http") === 0 ? path : BASE + path;
  var r = await kino.fetch(url, {
    headers: hdr(referer ? { Referer: referer } : null),
    timeoutMs: 18000,
  });
  if (!r.ok) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: "No se pudo cargar la pagina (" + r.status + ").",
    });
  }
  return await r.text();
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function b64(s) {
  try {
    var t = String(s).replace(/\s/g, "");
    while (t.length % 4) t += "=";
    return atob(t);
  } catch (e) {
    return "";
  }
}

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function makeId(slug) {
  return String(slug || "x").replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 120);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rank(items, q) {
  var nq = norm(q);
  if (!nq) return items;
  var words = nq.split(" ").filter(function (w) {
    return w.length > 1;
  });
  var scored = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var nt = norm(it.title);
    var ns = norm(it.ref || "");
    var score = 0;
    if (nt === nq || ns === nq.replace(/\s+/g, "-")) score = 1000;
    else if (nt.indexOf(nq) === 0) score = 850;
    else if (nt.indexOf(nq) >= 0) score = 700;
    else if (ns.indexOf(nq.replace(/\s+/g, "-")) >= 0) score = 650;
    else {
      var hit = 0;
      var ordered = 0;
      var last = -1;
      for (var w = 0; w < words.length; w++) {
        var pos = nt.indexOf(words[w]);
        if (pos < 0) pos = ns.indexOf(words[w]);
        if (pos >= 0) {
          hit++;
          if (pos >= last) {
            ordered++;
            last = pos;
          }
        }
      }
      if (words.length) {
        score = Math.round((hit / words.length) * 500) + ordered * 40;
        // al menos la mitad de palabras significativas
        if (hit < Math.ceil(words.length * 0.5) && hit < 2) score = 0;
      }
    }
    // prefer shorter titles when score similar (exact series over long titles)
    if (score > 0) scored.push({ it: it, score: score, len: nt.length });
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.len - b.len;
  });
  var out = [];
  for (var j = 0; j < scored.length; j++) out.push(scored[j].it);
  return out;
}

function parseAnimeItems(html) {
  var items = [];
  var seen = {};
  var parts = html.split(/anime__item/);
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i].slice(0, 2500);
    var hrefM = block.match(/href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?["']/i);
    if (!hrefM) continue;
    var slug = hrefM[1];
    if (!slug || seen[slug]) continue;
    if (
      /^(buscar|directorio|dash|genero|horario|peliculas|ovas|comunidad)$/.test(slug)
    )
      continue;
    seen[slug] = true;

    var title = "";
    var h5 = block.match(/<h5[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (h5) title = strip(h5[1]);
    if (!title) {
      var h5b = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
      if (h5b) title = strip(h5b[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");

    var poster = "";
    var bg = block.match(/data-setbg=["']([^"']+)["']/i);
    if (bg) poster = abs(bg[1]);

    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: /pelicula|movie/i.test(block) ? "movie" : "series",
      poster: poster || posterFor(slug),
      genres: ["anime"],
    });
  }
  return items;
}

function posterFor(slug) {
  if (!slug) return undefined;
  return "https://cdn.jkdesa.com/assets/images/animes/image/" + slug + ".jpg";
}

function parseHomeCards(html) {
  var items = [];
  var seen = {};
  // custom_thumb_home: enlace + img (src/alt en cualquier orden)
  var re =
    /custom_thumb_home">\s*<a href="https?:\/\/[^"]+\/([a-z0-9-]+)\/?"[^>]*>\s*<img\b([^>]+)>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug] || /^(buscar|directorio|dash)$/.test(slug)) continue;
    seen[slug] = true;
    var imgTag = m[2] || "";
    var srcM = imgTag.match(/src=["']([^"']+)["']/i);
    var altM = imgTag.match(/alt=["']([^"']*)["']/i);
    var poster = (srcM && srcM[1]) || posterFor(slug);
    var title = altM ? strip(altM[1]) : "";
    if (!title) {
      var after = html.slice(m.index, m.index + 800);
      var t = after.match(/card-title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
      if (t) title = strip(t[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");
    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: poster,
      genres: ["anime"],
    });
  }
  // Fallback card-title
  if (items.length === 0) {
    var re2 =
      /<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) !== null) {
      var slug2 = m[1];
      if (seen[slug2]) continue;
      seen[slug2] = true;
      items.push({
        id: makeId(slug2),
        ref: slug2,
        title: strip(m[2]),
        kind: "series",
        poster: posterFor(slug2),
        genres: ["anime"],
      });
    }
  }
  return items;
}

/** Episodios recientes (orden de la portada = mas nuevos primero) */
function parseLatestEpisodes(html) {
  var items = [];
  var seen = {};
  // Cada entrada unica por slug+episodio para que se actualice al salir un cap nuevo
  var re =
    /href="https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?"[\s\S]{0,600}?src="(https:\/\/cdn\.jkdesa\.com[^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    var ep = m[2];
    var key = slug + "/" + ep;
    if (seen[key] || /^(buscar|directorio)$/.test(slug)) continue;
    seen[key] = true;
    var thumb = m[3];
    var chunk = html.slice(Math.max(0, m.index - 150), m.index + 650);
    var title = "";
    var t = chunk.match(/<(?:h5|h6)[^>]*>([\s\S]*?)<\/(?:h5|h6)>/i);
    if (t) title = strip(t[1]);
    if (!title || title.length < 2) {
      var t2 = chunk.match(/alt=["']([^"']+)["']/i);
      if (t2) title = strip(t2[1]);
    }
    if (!title || title.length < 2) title = slug.replace(/-/g, " ");
    // Si el titulo no menciona el cap, anadirlo
    if (!/\bep(isodio)?\s*\d+/i.test(title) && !new RegExp("\\b" + ep + "\\b").test(title)) {
      title = title + " — Ep " + ep;
    }
    items.push({
      id: makeId(slug + "-ep" + ep),
      ref: slug,
      title: title,
      kind: "series",
      poster: posterFor(slug),
      backdrop: thumb || posterFor(slug),
      quality: "Ep " + ep,
      genres: ["anime"],
    });
    if (items.length >= 36) break;
  }
  return items;
}

/** Destacados del slider */
function parseHero(html) {
  var items = [];
  var seen = {};
  var re =
    /data-setbg="(https:\/\/cdn\.jkdesa\.com[^"]+)"[\s\S]{0,1200}?href="https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/?"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var poster = m[1];
    var slug = m[2];
    if (seen[slug] || /^(buscar|directorio|dash)$/.test(slug)) continue;
    seen[slug] = true;
    var chunk = html.slice(m.index, m.index + 1200);
    var title = "";
    var t = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!t) t = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (t) title = strip(t[1]);
    if (!title) title = slug.replace(/-/g, " ");
    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: poster,
      genres: ["anime"],
    });
    if (items.length >= 12) break;
  }
  return items;
}

function dedupe(items) {
  var map = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    if (!map[items[i].ref]) {
      map[items[i].ref] = true;
      out.push(items[i]);
    }
  }
  return out;
}

/** Extrae lista de servidores del HTML del episodio */
function parseServers(html) {
  var servers = [];

  // 1) Desu / Nozomi vía jkplayer/um y umv (prioridad máxima)
  var ums = html.match(/https?:\/\/[^"'\s]*jkplayer\/um\?[^"'\s]+/gi) || [];
  var umvs = html.match(/https?:\/\/[^"'\s]*jkplayer\/umv\?[^"'\s]+/gi) || [];
  for (var i = 0; i < ums.length; i++) {
    servers.push({ name: "desu", url: ums[i].replace(/&amp;/g, "&"), label: "Desu", priority: 1 });
  }
  for (var j = 0; j < umvs.length; j++) {
    servers.push({ name: "nozomi", url: umvs[j].replace(/&amp;/g, "&"), label: "Nozomi", priority: 2 });
  }

  // 2) var servers JSON
  var m = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      var arr = JSON.parse(m[1]);
      for (var k = 0; k < arr.length; k++) {
        var s = arr[k];
        var url = s.remote || "";
        if (url && url.indexOf("http") !== 0) url = b64(url).replace(/\n/g, "").trim();
        if (!url || url.indexOf("http") !== 0) continue;
        var name = String(s.server || "server").toLowerCase();
        // saltar descargas
        if (/mega|mediafire/.test(name)) continue;
        var priority = 50;
        if (/mp4upload/.test(name)) priority = 3;
        else if (/streamwish|sfastwish/.test(name)) priority = 10;
        else if (/voe/.test(name)) priority = 15;
        else if (/filemoon|bysekoze/.test(name)) priority = 20;
        else if (/mixdrop|mxdrop/.test(name)) priority = 25;
        else if (/streamtape/.test(name)) priority = 30;
        servers.push({
          name: name,
          url: url,
          label: labelOf(name),
          priority: priority,
        });
      }
    } catch (e) {}
  }

  // ordenar por prioridad
  servers.sort(function (a, b) {
    return (a.priority || 99) - (b.priority || 99);
  });

  // dedupe por url
  var seen = {};
  var out = [];
  for (var n = 0; n < servers.length; n++) {
    if (seen[servers[n].url]) continue;
    seen[servers[n].url] = true;
    out.push(servers[n]);
  }
  return out;
}

function labelOf(name) {
  if (/mp4upload/.test(name)) return "Mp4Upload";
  if (/streamwish|sfastwish/.test(name)) return "StreamWish";
  if (/voe/.test(name)) return "VOE";
  if (/mixdrop|mxdrop/.test(name)) return "MixDrop";
  if (/filemoon|bysekoze/.test(name)) return "Filemoon";
  if (/streamtape/.test(name)) return "Streamtape";
  if (/vidhide/.test(name)) return "Vidhide";
  if (/dood/.test(name)) return "Doodstream";
  if (/desu/.test(name)) return "Desu";
  if (/nozomi/.test(name)) return "Nozomi";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Servidor";
}

/** Limpia URL de media encontrada en HTML */
function cleanMediaUrl(u) {
  if (!u) return "";
  u = u
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/\\/g, "")
    .trim();
  // quitar comillas residuales
  u = u.replace(/^["']|["']$/g, "");
  return u;
}

/** Busca m3u8 o mp4 en el cuerpo de un embed */
function findMediaInBody(body) {
  var patterns = [
    /(https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+:[0-9]+\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /file:\s*["'](https?:\/\/[^"']+)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /video:\s*\{\s*url:\s*["'](https?:\/\/[^"']+)["']/i,
    /<source[^>]+src=["'](https?:\/\/[^"']+)["']/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var mm = body.match(patterns[i]);
    if (mm) {
      var u = cleanMediaUrl(mm[1]);
      if (
        u.indexOf("http") === 0 &&
        !/\.(js|css)(\?|$)/i.test(u) &&
        !/google|facebook|ads/i.test(u)
      ) {
        return u;
      }
    }
  }
  return null;
}

async function resolveServer(server, pageReferer) {
  var url = server.url;

  // Ya es media directa
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return {
      url: url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: pageReferer || BASE + "/", "User-Agent": UA },
    };
  }

  try {
    var body = await get(url, pageReferer);
    var media = findMediaInBody(body);
    if (media) {
      return {
        url: media,
        mime: /\.m3u8/i.test(media) ? "application/x-mpegURL" : "video/mp4",
        label: server.label,
        headers: {
          Referer: url.indexOf("jkanime") >= 0 ? BASE + "/" : url,
          "User-Agent": UA,
        },
      };
    }
  } catch (e) {}

  return null;
}

// -------------------- exports --------------------

export async function search(query) {
  await Promise.resolve();
  var q = ((query && query.q) || "").trim();
  if (!q) return [];

  // Variantes: frase completa y versiones más cortas (nombres largos)
  var variants = [q];
  var parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 2) {
    variants.push(parts.slice(0, 3).join(" "));
    variants.push(parts.slice(0, 2).join(" "));
  }
  if (parts.length > 1) variants.push(parts[0]);
  // sin signos raros
  var clean = q.replace(/[!?¡¿.:,;'"()\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean && clean !== q) variants.push(clean);

  var seen = {};
  var all = [];
  for (var v = 0; v < variants.length; v++) {
    var term = variants[v];
    if (!term || seen["q:" + term.toLowerCase()]) continue;
    seen["q:" + term.toLowerCase()] = true;
    try {
      var html = await get("/buscar/?q=" + encodeURIComponent(term));
      var batch = parseAnimeItems(html);
      if (batch.length === 0) batch = parseHomeCards(html);
      for (var i = 0; i < batch.length; i++) {
        if (seen[batch[i].ref]) continue;
        seen[batch[i].ref] = true;
        all.push(batch[i]);
      }
      // si ya hay buenos resultados con la query completa, no hace falta más
      if (v === 0 && all.length >= 8) break;
    } catch (e) {}
  }

  all = rank(all, q);
  if (all.length > 80) all = all.slice(0, 80);
  return all;
}

export async function home() {
  await Promise.resolve();
  var rows = [];
  var html = await get("/");

  // 1) Episodios recientes
  var latest = parseLatestEpisodes(html);
  if (latest.length === 0) {
    var seen = {};
    var reEp = /href=["']https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?["']/gi;
    var m;
    while ((m = reEp.exec(html)) !== null) {
      var slug = m[1];
      var ep = m[2];
      if (seen[slug] || /^(buscar|directorio)$/.test(slug)) continue;
      seen[slug] = true;
      latest.push({
        id: makeId(slug + "-ep" + ep),
        ref: slug,
        title: slug.replace(/-/g, " ") + " — Ep " + ep,
        kind: "series",
        poster: posterFor(slug),
        backdrop: posterFor(slug),
        quality: "Ep " + ep,
        genres: ["anime"],
      });
      if (latest.length >= 24) break;
    }
  }
  if (latest.length) {
    rows.push({
      id: "episodios-recientes",
      title: "Episodios recientes",
      items: latest.slice(0, 30),
      ref: "dir-ultimos",
      genre: "anime",
    });
  }

  // 2) En emisión — priorizar hero + recientes en emision desde portada
  var aire = [];
  try {
    var html2 = await get(
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc"
    );
    aire = parseAnimeItems(html2);
    if (aire.length === 0) aire = parseHomeCards(html2);
  } catch (e) {}
  if (aire.length === 0) {
    aire = parseHero(html);
  }
  // si hero vacio, usar episodios recientes como proxy de "al aire"
  if (aire.length === 0 && latest.length) {
    var seenA = {};
    for (var a = 0; a < latest.length; a++) {
      if (seenA[latest[a].ref]) continue;
      seenA[latest[a].ref] = true;
      aire.push({
        id: makeId(latest[a].ref),
        ref: latest[a].ref,
        title: latest[a].title.replace(/\s*[—-]\s*Ep\s*\d+\s*$/i, ""),
        kind: "series",
        poster: posterFor(latest[a].ref),
        backdrop: posterFor(latest[a].ref),
        genres: ["anime"],
      });
    }
  }
  for (var k = 0; k < aire.length; k++) {
    if (!aire[k].poster) aire[k].poster = posterFor(aire[k].ref);
    if (!aire[k].backdrop) aire[k].backdrop = aire[k].poster;
  }
  if (aire.length) {
    rows.push({
      id: "en-emision",
      title: "En emisión",
      items: aire.slice(0, 24),
      ref: "dir-aire",
      genre: "anime",
    });
  }

  // 3) Animes recientes
  var cards = parseHomeCards(html);
  for (var j = 0; j < cards.length; j++) {
    if (!cards[j].poster) cards[j].poster = posterFor(cards[j].ref);
    if (!cards[j].backdrop) cards[j].backdrop = cards[j].poster;
  }
  if (cards.length) {
    rows.push({
      id: "animes-recientes",
      title: "Animes recientes",
      items: cards.slice(0, 30),
      ref: "dir-recientes",
      genre: "anime",
    });
  }

  // 4) Destacados (slider)
  var hero = parseHero(html);
  for (var h = 0; h < hero.length; h++) {
    if (!hero[h].poster) hero[h].poster = posterFor(hero[h].ref);
    if (!hero[h].backdrop) hero[h].backdrop = hero[h].poster;
  }
  if (hero.length === 0 && aire.length) hero = aire.slice(0, 12);
  if (hero.length) {
    rows.push({
      id: "destacados",
      title: "Destacados",
      items: hero.slice(0, 16),
      ref: "dir-destacados",
      genre: "anime",
    });
  }

  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  var path = "/";
  if (ref === "dir-aire") {
    path =
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc";
  } else if (ref === "dir-pelis") {
    path = "/directorio/peliculas/";
  } else if (ref === "dir-latino") {
    path = "/buscar/?q=" + encodeURIComponent("Latino");
  } else if (
    ref === "dir-ultimos" ||
    ref === "dir-recientes" ||
    ref === "dir-destacados"
  ) {
    path = "/";
  }

  var html = await get(path);
  var items = [];

  if (ref === "dir-ultimos") {
    items = parseLatestEpisodes(html);
    if (items.length === 0) {
      // fallback un por anime
      var seen = {};
      var reEp = /href=["']https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?["']/gi;
      var m;
      while ((m = reEp.exec(html)) !== null) {
        var slug = m[1];
        if (seen[slug] || /^(buscar|directorio)$/.test(slug)) continue;
        seen[slug] = true;
        items.push({
          id: makeId(slug),
          ref: slug,
          title: slug.replace(/-/g, " "),
          kind: "series",
          poster: posterFor(slug),
          backdrop: posterFor(slug),
          genres: ["anime"],
        });
        if (items.length >= 40) break;
      }
    }
  } else if (ref === "dir-destacados") {
    items = parseHero(html);
    if (items.length === 0) items = parseHomeCards(html);
  } else if (ref === "dir-recientes") {
    items = parseHomeCards(html);
    if (items.length === 0) items = parseAnimeItems(html);
  } else if (ref === "dir-aire") {
    items = parseAnimeItems(html);
    if (items.length === 0) items = parseHomeCards(html);
    if (items.length === 0) {
      // directorio a menudo es JS: usar portada
      var homeHtml = await get("/");
      items = parseHero(homeHtml);
      if (items.length === 0) items = parseLatestEpisodes(homeHtml);
    }
  } else {
    items = parseAnimeItems(html);
    if (items.length === 0) items = parseHomeCards(html);
  }

  if (ref === "dir-pelis") {
    for (var i = 0; i < items.length; i++) items[i].kind = "movie";
  }

  for (var k = 0; k < items.length; k++) {
    if (!items[k].poster) items[k].poster = posterFor(items[k].ref);
    if (!items[k].backdrop) items[k].backdrop = items[k].poster;
  }

  // dedupe por ref
  var map = {};
  var out = [];
  for (var n = 0; n < items.length; n++) {
    if (!map[items[n].ref]) {
      map[items[n].ref] = true;
      out.push(items[n]);
    }
  }
  return { items: out };
}

export async function episodes(ref) {
  await Promise.resolve();
  var slug = String(ref)
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .pop();
  var parts = String(ref).replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
    slug = parts[parts.length - 2];
  }

  var html = await get("/" + slug + "/");

  var title = slug.replace(/-/g, " ");
  var h3s = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || [];
  for (var i = 0; i < h3s.length; i++) {
    var t = strip(h3s[i].replace(/<\/?h3[^>]*>/gi, ""));
    if (t && t.length > 1 && !/buscado|temporada|relacionado/i.test(t)) {
      title = t;
      break;
    }
  }

  var overview = "";
  var p = html.match(/<p class="scroll">([\s\S]*?)<\/p>/i);
  if (p) overview = strip(p[1]).slice(0, 800);

  var poster = "";
  var og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!og) og = html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) poster = abs(og[1]);
  if (!poster) poster = posterFor(slug);

  // Estado real en JKAnime: class="enemision finished">Concluido  |  En emisión
  var isFinished =
    /enemision\s+finished/i.test(html) ||
    />(?:Concluido|Finalizado)</i.test(html) ||
    /Estado:[\s\S]{0,120}?(?:Concluido|Finalizado)/i.test(html);
  var isAiring =
    !isFinished &&
    (/enemision(?!\s+finished)/i.test(html) ||
      /En\s+emisi[oó]n/i.test(html) ||
      /id=["']uep["']/i.test(html));

  var animeId = "";
  var idM =
    html.match(/data-anime=["'](\d+)["']/i) ||
    html.match(/ajax\/episodes\/(\d+)\//i) ||
    html.match(/ajax\/search_episode\/(\d+)\//i);
  if (idM) animeId = idM[1];

  var csrf = "";
  var csrfM = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (!csrfM) csrfM = html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
  if (csrfM) csrf = csrfM[1];

  var episodes = [];
  var THUMB_BASE =
    "https://cdn.jkdesa.com/assets/images/animes/video/image_thumb/";

  // 1) Lista oficial AJAX (paginada): solo caps que existen en la web
  if (animeId) {
    try {
      for (var page = 1; page <= 40; page++) {
        var opts = {
          method: "POST",
          headers: hdr({
            Referer: BASE + "/" + slug + "/",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json, text/javascript, */*; q=0.01",
          }),
          timeoutMs: 15000,
        };
        if (csrf) {
          opts.headers["X-CSRF-TOKEN"] = csrf;
          opts.body = "_token=" + encodeURIComponent(csrf);
          opts.form = { _token: csrf };
        } else {
          opts.body = "";
        }
        var r = await kino.fetch(
          BASE + "/ajax/episodes/" + animeId + "/" + page,
          opts
        );
        if (!r.ok) break;
        var json = null;
        try {
          json = await r.json();
        } catch (je) {
          var raw = await r.text();
          try {
            json = JSON.parse(raw);
          } catch (je2) {
            break;
          }
        }
        var list = (json && json.data) || [];
        if (!list.length) break;
        for (var e = 0; e < list.length; e++) {
          var item = list[e];
          var num = parseInt(item.number, 10);
          if (!(num > 0)) continue;
          var still = undefined;
          if (item.image && String(item.image).length > 5) {
            still = THUMB_BASE + String(item.image).replace(/^.*\//, "");
          }
          episodes.push({
            season: 1,
            number: num,
            ref: slug + "/" + num,
            title: item.title ? strip(item.title) : "Episodio " + num,
            still: still,
          });
        }
        var lastPage = parseInt((json && json.last_page) || page, 10);
        if (page >= lastPage) break;
        if (!json.next_page_url) break;
      }
    } catch (err) {
      episodes = [];
    }
  }

  // 2) Fallback sin AJAX
  if (episodes.length === 0) {
    var available = 0;
    var uep =
      html.match(
        /id=["']uep["'][^>]*href=["'][^"']*\/([a-z0-9-]+)\/(\d+)\/?["']/i
      ) ||
      html.match(
        /href=["'][^"']*\/([a-z0-9-]+)\/(\d+)\/?["'][^>]*id=["']uep["']/i
      );
    if (uep) available = parseInt(uep[2], 10) || 0;
    if (available <= 0) {
      var uep2 = html.match(
        /[UÚ]ltimo episodio[\s\S]{0,250}?\/([a-z0-9-]+)\/(\d+)\/?/i
      );
      if (uep2) available = parseInt(uep2[2], 10) || 0;
    }

    var planned = 0;
    var epCount = html.match(/Episodios:<\/span>\s*(\d+)/i);
    if (epCount) planned = parseInt(epCount[1], 10) || 0;

    var maxLink = 0;
    var re = new RegExp(
      "/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(\\d+)/?",
      "gi"
    );
    var mm;
    while ((mm = re.exec(html)) !== null) {
      var nn = parseInt(mm[1], 10);
      if (nn > maxLink && nn < 100000) maxLink = nn;
    }

    var total = 0;
    if (isFinished) {
      // Concluidos: todos los planificados (están en la web)
      total = planned || available || maxLink;
    } else if (isAiring || available > 0) {
      // En emisión: solo hasta el último publicado (uep), nunca el total de temporada
      total = available || maxLink;
      if (planned > 0 && total > planned) total = planned;
    } else {
      // Estado desconocido: preferir lo publicado si hay pista, si no lo planificado
      total = available || maxLink || planned;
    }

    if (total <= 0) total = 1;
    if (total > 5000) total = 5000;

    for (var n = 1; n <= total; n++) {
      episodes.push({
        season: 1,
        number: n,
        ref: slug + "/" + n,
        title: "Episodio " + n,
        still: poster || undefined,
      });
    }
  }

  // dedupe por número
  var byNum = {};
  var uniq = [];
  for (var u = 0; u < episodes.length; u++) {
    if (byNum[episodes[u].number]) continue;
    byNum[episodes[u].number] = true;
    uniq.push(episodes[u]);
  }
  uniq.sort(function (a, b) {
    return a.number - b.number;
  });

  return {
    series: {
      title: title,
      poster: poster || undefined,
      overview: overview || undefined,
      genres: ["anime"],
    },
    episodes: uniq,
  };
}

export async function resolve(ref) {
  await Promise.resolve();
  var slugEp = String(ref);
  var forceIndex = -1;
  if (slugEp.indexOf("server-") === 0) {
    var rest = slugEp.slice(7);
    var lastDash = rest.lastIndexOf("-");
    if (lastDash > 0) {
      forceIndex = parseInt(rest.slice(lastDash + 1), 10);
      slugEp = rest.slice(0, lastDash);
    }
  }

  var path = "/" + slugEp.replace(/^\/+|\/+$/g, "") + "/";
  var pageUrl = BASE + path;
  var html = await get(path);
  var servers = parseServers(html);

  // Preferencia del usuario
  try {
    var prefer = kino.config && kino.config.get ? kino.config.get("preferServer") : "";
    if (prefer && prefer !== "auto") {
      for (var i = 0; i < servers.length; i++) {
        if (
          servers[i].name.indexOf(prefer) >= 0 ||
          servers[i].label.toLowerCase().indexOf(prefer) >= 0
        ) {
          var p = servers.splice(i, 1)[0];
          servers.unshift(p);
          break;
        }
      }
    }
  } catch (e) {}

  if (servers.length === 0) {
    throw kino.error("not_found", "sin servidores", {
      userMessage: "No hay servidores para este capitulo.",
    });
  }

  var order = servers;
  if (forceIndex >= 0 && forceIndex < servers.length) {
    order = [servers[forceIndex]].concat(
      servers.filter(function (_, i) {
        return i !== forceIndex;
      })
    );
  }

  var primary = null;
  var alternatives = [];
  // Intentar Desu, Nozomi, Mp4Upload primero (hasta 5)
  for (var i = 0; i < order.length && i < 5; i++) {
    var s = order[i];
    var stream = await resolveServer(s, pageUrl);
    var idx = -1;
    for (var t = 0; t < servers.length; t++) if (servers[t].url === s.url) idx = t;
    var altRef = "server-" + slugEp.replace(/\//g, ".") + "-" + (idx >= 0 ? idx : i);
    if (stream && stream.url && /\.(m3u8|mp4)(\?|$)/i.test(stream.url)) {
      if (!primary) primary = stream;
      else alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    } else {
      alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    }
  }

  // Resto como alternativas sin resolver
  for (var j = 5; j < servers.length && alternatives.length < 8; j++) {
    alternatives.push({
      label: servers[j].label.slice(0, 48),
      ref: "server-" + slugEp.replace(/\//g, ".") + "-" + j,
    });
  }

  if (!primary) {
    throw kino.error("unavailable", "sin stream directo", {
      userMessage: "No se pudo obtener el video. Prueba otro servidor en el menu.",
    });
  }

  if (alternatives.length) primary.alternatives = alternatives.slice(0, 8);
  return primary;
}
