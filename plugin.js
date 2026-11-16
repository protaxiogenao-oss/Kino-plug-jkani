/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino — 1.5.6
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

/**
 * Fetch HTML. opts: { retries, timeoutMs, soft }
 * soft=true: no lanza error, devuelve "" (para resolve de embeds).
 */
async function get(path, referer, opts) {
  opts = opts || {};
  var retries = opts.retries != null ? opts.retries : 1;
  var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 10000;
  var soft = !!opts.soft;
  var url = path.indexOf("http") === 0 ? path : BASE + path;
  var lastStatus = 0;
  var lastErr = null;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(function (res) {
          setTimeout(res, 250 * attempt);
        });
      }
      var r = await kino.fetch(url, {
        headers: hdr(referer ? { Referer: referer } : null),
        timeoutMs: timeoutMs,
      });
      lastStatus = r.status;
      if (r.ok) {
        return await r.text();
      }
      // Solo reintentar 5xx
      if (r.status < 500 || r.status >= 600) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (soft) return "";
  if (lastStatus) {
    throw kino.error("unavailable", "http " + lastStatus, {
      userMessage: "No se pudo cargar la pagina (" + lastStatus + "). Reintenta en unos segundos.",
    });
  }
  throw lastErr || kino.error("unavailable", "network", {
    userMessage: "Error de red al cargar la pagina. Reintenta.",
  });
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
    // Desu funciona pero el CDN suele ser lento
    servers.push({ name: "desu", url: ums[i].replace(/&amp;/g, "&"), label: "Desu", priority: 8 });
  }
  for (var j = 0; j < umvs.length; j++) {
    servers.push({ name: "nozomi", url: umvs[j].replace(/&amp;/g, "&"), label: "Nozomi", priority: 7 });
  }

  // Fenix (jkplayer/jk) — episodios antiguos
  var jks = html.match(/https?:\/\/[^"'\s]*jkplayer\/jk\?[^"'\s]+/gi) || [];
  for (var fi = 0; fi < jks.length; fi++) {
    servers.push({
      name: "fenix",
      url: jks[fi].replace(/&amp;/g, "&"),
      label: "Fenix",
      priority: 9,
    });
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
        // saltar solo descargas (no reproducibles embebidos)
        if (/mega|mediafire/.test(name)) continue;
        var priority = 50;
        // Prioridad: hosts con extractor fiable y CDN más ágil
        if (/mp4upload/.test(name)) priority = 1;
        else if (/vidhide/.test(name)) priority = 2;
        else if (/mixdrop|mxdrop/.test(name)) priority = 3;
        else if (/streamtape/.test(name)) priority = 4;
        else if (/streamwish|sfastwish|hgcloud/.test(name)) priority = 12;
        else if (/voe/.test(name)) priority = 15;
        else if (/filemoon|bysekoze/.test(name)) priority = 18;
        else if (/dood/.test(name)) priority = 10;
        // Dominios doodstream caídos → espejo
        if (/dood|dsvplay/.test(name) || /dsvplay\.com|d-s\.io|dood\./i.test(url)) {
          url = url
            .replace(/https?:\/\/dsvplay\.com/i, "https://d-s.io")
            .replace(/https?:\/\/doodstream\.com/i, "https://d-s.io")
            .replace(/https?:\/\/dood\.watch/i, "https://d-s.io");
        }
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
  if (/fenix/.test(name)) return "Fenix";
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

/** ¿Parece URL de video real (no JS/CSS/imagen)? */
function isVideoUrl(u) {
  if (!u || u.indexOf("http") !== 0) return false;
  if (/\.(js|css|woff2?|ttf|svg|png|jpe?g|gif|webp|ico)(\?|$)/i.test(u)) return false;
  if (/google|facebook|adservice|doubleclick|gtag|yandex/i.test(u)) return false;
  if (/\.m3u8([?#]|$)/i.test(u)) return true;
  if (/\.mp4([?#]|$)/i.test(u)) return true;
  if (/\/get_video\?/i.test(u)) return true;
  if (/\/hls[23]?\//i.test(u) && /master\.(m3u8|txt)/i.test(u)) return true;
  return false;
}

/** Unpack Dean Edwards / packer eval(function(p,a,c,k,e,d){...}) */
function unpackPacker(text) {
  if (!text) return "";
  var m = text.match(/}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/s);
  if (!m) {
    m = text.match(/}\("(.*)",(\d+),(\d+),"(.*)"\.split\("\|"\)/s);
  }
  if (!m) return "";
  var payload = m[1];
  var radix = parseInt(m[2], 10);
  var keywords = m[4].split("|");
  var alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function toIdx(token) {
    if (radix <= 36) {
      var n = parseInt(token, radix);
      return isNaN(n) ? -1 : n;
    }
    var idx = 0;
    for (var i = 0; i < token.length; i++) {
      var p = alphabet.indexOf(token.charAt(i));
      if (p < 0) return -1;
      idx = idx * radix + p;
    }
    return idx;
  }
  return payload.replace(/\b\w+\b/g, function (tok) {
    var i = toIdx(tok);
    if (i >= 0 && i < keywords.length && keywords[i]) return keywords[i];
    return tok;
  });
}

/** Busca m3u8 o mp4 en texto plano */
function findMediaInBody(body) {
  if (!body) return null;
  var patterns = [
    /(https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+:[0-9]+\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /file:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /video:\s*\{\s*url:\s*["'](https?:\/\/[^"']+)["']/i,
    /["']src["']\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /player\.src\(\s*\{\s*type:\s*["'][^"']+["']\s*,\s*src:\s*["'](https?:\/\/[^"']+)["']/i,
    /<source[^>]+src=["'](https?:\/\/[^"']+)["']/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var mm = body.match(patterns[i]);
    if (mm) {
      var u = cleanMediaUrl(mm[1]);
      if (isVideoUrl(u)) return u;
    }
  }
  // atob('base64...')
  var atobs = body.match(/atob\s*\(\s*['"]([A-Za-z0-9+/=\s]+)['"]\s*\)/g) || [];
  for (var j = 0; j < atobs.length; j++) {
    var m64 = atobs[j].match(/atob\s*\(\s*['"]([A-Za-z0-9+/=\s]+)['"]\s*\)/);
    if (!m64) continue;
    var decoded = b64(m64[1]);
    if (!decoded) continue;
    var mu = decoded.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
    if (mu) {
      var u2 = cleanMediaUrl(mu[1]);
      if (isVideoUrl(u2)) return u2;
    }
  }
  return null;
}

/** Vidhide / similar: packer → links.hls* */
function extractFromPackedLinks(body) {
  if (!body || body.indexOf("eval(function") < 0) return null;
  var scripts = body.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  var chunks = scripts.length ? scripts : [body];
  for (var i = 0; i < chunks.length; i++) {
    if (chunks[i].indexOf("eval(function") < 0) continue;
    var un = unpackPacker(chunks[i]);
    if (!un) continue;
    // links={"hls2":"https://...m3u8"...}
    var lm = un.match(/"hls[0-9]"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/i);
    if (!lm) lm = un.match(/hls[0-9]\s*:\s*["'](https?:[^"']+)["']/i);
    if (lm) {
      var u = cleanMediaUrl(lm[1]);
      if (isVideoUrl(u) || /\.txt([?#]|$)/i.test(u)) return u.replace(/master\.txt/i, "master.m3u8");
    }
    var direct = findMediaInBody(un);
    if (direct) return direct;
  }
  return null;
}

/** Mixdrop: MDCore.wurl */
function extractMixdrop(body) {
  if (!body) return null;
  var scripts = body.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (var i = 0; i < scripts.length; i++) {
    var s = scripts[i];
    if (s.indexOf("MDCore") < 0 && s.indexOf("eval(function") < 0) continue;
    var un = s.indexOf("eval(function") >= 0 ? unpackPacker(s) : s;
    if (!un) un = s;
    var m =
      un.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/i) ||
      un.match(/wurl\s*=\s*["']([^"']+\.mp4[^"']*)["']/i);
    if (m) {
      var u = m[1].replace(/&amp;/g, "&").trim();
      if (u.indexOf("//") === 0) u = "https:" + u;
      if (isVideoUrl(u)) return u;
    }
  }
  return extractFromPackedLinks(body);
}

/** Streamtape: reconstruye get_video desde robotlink (ideoolink suele ser señuelo) */
function extractStreamtape(body) {
  if (!body) return null;
  var candidates = [];
  var re =
    /getElementById\(['"](robotlink|botlink|ideoolink)['"]\)\.innerHTML\s*=\s*['"]([^'"]*)['"]\s*\+\s*(?:''\s*\+\s*)?\(?['"]([^'"]+)['"]\)?\.substring\((\d+)\)(?:\.substring\((\d+)\))?/gi;
  var m;
  while ((m = re.exec(body)) !== null) {
    var which = (m[1] || "").toLowerCase();
    var prefix = m[2] || "";
    var payload = m[3] || "";
    var a = parseInt(m[4], 10) || 0;
    var rest = payload.substring(a);
    if (m[5] != null) rest = rest.substring(parseInt(m[5], 10));
    var path = (prefix + rest).replace(/&amp;/g, "&");
    if (path.indexOf("//") === 0) path = "https:" + path;
    else if (path.indexOf("http") !== 0) {
      if (path.indexOf("/streamtape.com") === 0) path = "https://" + path.slice(1);
      else if (path.charAt(0) === "/") path = "https://streamtape.com" + path;
      else path = "https://streamtape.com/" + path;
    }
    path = path.replace(/^https:\/streamtape\.com/, "https://streamtape.com");
    if (!/get_video\?/i.test(path)) continue;
    if (path.indexOf("stream=") < 0) path += (path.indexOf("?") >= 0 ? "&" : "?") + "stream=1";
    // score: robotlink best, must contain get_video?id= (not idb=)
    var score = 0;
    if (which === "robotlink") score += 10;
    else if (which === "botlink") score += 5;
    if (/get_video\?id=/i.test(path)) score += 10;
    if (/get_video\?idb=/i.test(path)) score -= 20;
    candidates.push({ path: path, score: score });
  }
  candidates.sort(function (a, b) {
    return b.score - a.score;
  });
  if (candidates.length && candidates[0].score > 0) return candidates[0].path;

  // fallback: primer get_video?id= visible
  var g = body.match(/\/get_video\?id=([a-zA-Z0-9]+)&expires=(\d+)&ip=([^&"'<>\s]+)&token=([a-zA-Z0-9]+)/);
  if (g) {
    return (
      "https://streamtape.com/get_video?id=" +
      g[1] +
      "&expires=" +
      g[2] +
      "&ip=" +
      g[3] +
      "&token=" +
      g[4] +
      "&stream=1"
    );
  }
  return null;
}

/** Mp4Upload: player.src({ src: "..." }) */
function extractMp4upload(body) {
  if (!body) return null;
  var m =
    body.match(/player\.src\(\s*\{[\s\S]*?src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
    body.match(/src:\s*["'](https?:\/\/[^"']*mp4upload\.com[^"']+\.mp4[^"']*)["']/i) ||
    body.match(/src:\s*["'](https?:\/\/a\d*\.mp4upload\.com[^"']+)["']/i);
  if (m) {
    var u = cleanMediaUrl(m[1]);
    if (isVideoUrl(u)) return u;
  }
  return findMediaInBody(body);
}

/** Doodstream / d-s.io */
function extractDoodstream(body, pageUrl) {
  if (!body) return null;
  // pass_md5 path
  var m = body.match(/(\/pass_md5\/[^"'\s]+)/i);
  if (m) {
    var base = "https://d-s.io";
    try {
      if (pageUrl && pageUrl.indexOf("http") === 0) {
        var u = pageUrl.match(/^(https?:\/\/[^\/]+)/);
        if (u) base = u[1];
      }
    } catch (e) {}
    // real media needs a second request with token — return pass url marker for resolveServer
    return { pass: base + m[1], base: base };
  }
  var direct = body.match(/(https?:\/\/[^"'\s]+\/[^"'\s]*\.mp4[^"'\s]*)/i);
  if (direct && isVideoUrl(direct[1])) return direct[1];
  return null;
}

async function resolveServer(server, pageReferer) {
  var url = server.url;
  var name = String(server.name || "").toLowerCase();

  // Ya es media directa
  if (/\.(m3u8|mp4)(\?|$)/i.test(url) || /\/get_video\?/i.test(url)) {
    return {
      url: url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: pageReferer || BASE + "/", "User-Agent": UA },
    };
  }

  var isJk = /jkanime\.|jkplayer\//i.test(url);
  var isDood = /dood|dsvplay|d-s\.io/i.test(name + url);
  var body = await get(url, pageReferer, {
    retries: isJk ? 1 : 0,
    timeoutMs: isJk ? 7000 : 8000,
    soft: true,
  });
  if (!body) return null;

  var media = null;
  if (/mp4upload/.test(name) || /mp4upload\.com/i.test(url)) {
    media = extractMp4upload(body);
  } else if (/mixdrop|mxdrop/.test(name) || /mixdrop\.|mxcontent\.|mdbek/i.test(url)) {
    media = extractMixdrop(body);
  } else if (/streamtape/.test(name) || /streamtape\.com/i.test(url)) {
    media = extractStreamtape(body);
  } else if (/vidhide/.test(name) || /vidhide/i.test(url)) {
    media = extractFromPackedLinks(body) || findMediaInBody(body);
  } else if (isDood) {
    var dood = extractDoodstream(body, url);
    if (dood && typeof dood === "object" && dood.pass) {
      // Doodstream: GET pass_md5 → texto token, luego + random
      var tokenBody = await get(dood.pass, url, { retries: 0, timeoutMs: 6000, soft: true });
      if (tokenBody && tokenBody.indexOf("http") === 0) {
        media = tokenBody.trim().split("\n")[0].trim();
      } else if (tokenBody && tokenBody.length > 10 && tokenBody.indexOf("<") < 0) {
        var rnd = Math.random().toString(36).slice(2);
        media = tokenBody.trim() + rnd + "?token=" + (dood.pass.split("/").pop() || "") + "&expiry=" + Date.now();
      }
    } else if (typeof dood === "string") {
      media = dood;
    }
  } else {
    media = findMediaInBody(body);
    if (!media) media = extractFromPackedLinks(body);
    if (!media && /MDCore/.test(body)) media = extractMixdrop(body);
    if (!media && /get_video|robotlink|streamtape/i.test(body)) media = extractStreamtape(body);
  }

  if (!media || typeof media !== "string") return null;

  var refererHdr = isJk ? BASE + "/" : url;
  if (/mp4upload/i.test(media)) refererHdr = "https://www.mp4upload.com/";
  if (/streamtape|tapecontent/i.test(media)) refererHdr = "https://streamtape.com/";
  if (/mixdrop|mxcontent/i.test(media)) refererHdr = url;
  if (/vidhide|dramiyos|willowgrove/i.test(media)) refererHdr = url;
  if (isDood) refererHdr = url;

  return {
    url: media,
    mime: /\.m3u8|master\.txt/i.test(media) ? "application/x-mpegURL" : "video/mp4",
    label: server.label,
    headers: {
      Referer: refererHdr,
      "User-Agent": UA,
    },
  };
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
  var raw = String(ref || "");
  var forceIndex = -1;
  var slugEp = raw;

  // Formato nuevo: sv|INDEX|slug/ep  (no rompe con guiones del slug)
  if (raw.indexOf("sv|") === 0) {
    var segs = raw.split("|");
    forceIndex = parseInt(segs[1], 10);
    if (isNaN(forceIndex)) forceIndex = -1;
    slugEp = segs.slice(2).join("|");
  } else if (raw.indexOf("server-") === 0) {
    // Legado: server-slug.ep-INDEX
    var rest = raw.slice(7);
    var lastDash = rest.lastIndexOf("-");
    if (lastDash > 0) {
      forceIndex = parseInt(rest.slice(lastDash + 1), 10);
      if (isNaN(forceIndex)) forceIndex = -1;
      var body = rest.slice(0, lastDash);
      var lastDot = body.lastIndexOf(".");
      if (lastDot > 0 && /^\d+$/.test(body.slice(lastDot + 1))) {
        slugEp = body.slice(0, lastDot) + "/" + body.slice(lastDot + 1);
      } else {
        slugEp = body.replace(/\./g, "/");
      }
    }
  }

  slugEp = slugEp.replace(/^\/+|\/+$/g, "");
  var path = "/" + slugEp + "/";
  var pageUrl = BASE + path;
  var html = await get(path, null, { retries: 0, timeoutMs: 8000 });
  var servers = parseServers(html);

  // Preferencia del usuario
  try {
    var prefer = kino.config && kino.config.get ? kino.config.get("preferServer") : "";
    if (prefer && prefer !== "auto") {
      for (var i = 0; i < servers.length; i++) {
        if (
          servers[i].name.indexOf(prefer) >= 0 ||
          servers[i].label.toLowerCase().indexOf(String(prefer).toLowerCase()) >= 0
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

  function altRefOf(idx) {
    return "sv|" + idx + "|" + slugEp;
  }

  function indexOfServer(s) {
    for (var t = 0; t < servers.length; t++) {
      if (servers[t].url === s.url) return t;
    }
    return -1;
  }

  // Si el usuario eligió un servidor concreto, resolver solo ese (+1 respaldo)
  if (forceIndex >= 0 && forceIndex < servers.length) {
    var forced = servers[forceIndex];
    var stream = await resolveServer(forced, pageUrl);
    if (stream && stream.url) {
      var alts = [];
      for (var a = 0; a < servers.length && alts.length < 8; a++) {
        if (a === forceIndex) continue;
        alts.push({ label: servers[a].label.slice(0, 48), ref: altRefOf(a) });
      }
      if (alts.length) stream.alternatives = alts;
      return stream;
    }
    // fallback: probar otros extractables
  }

  // Resolver en paralelo los hosts con extractor fiable (máx 5)
  var extractable = /mp4upload|vidhide|mixdrop|mxdrop|streamtape|desu|nozomi|fenix|dood/;
  var batch = [];
  var batchIdx = [];
  for (var bi = 0; bi < servers.length && batch.length < 5; bi++) {
    if (extractable.test(servers[bi].name) || /jkplayer\//i.test(servers[bi].url)) {
      batch.push(servers[bi]);
      batchIdx.push(bi);
    }
  }
  // si prefer reordenó, asegurar que el primero entre
  if (batch.length === 0) {
    batch = servers.slice(0, Math.min(3, servers.length));
    batchIdx = batch.map(function (_, i) { return i; });
  }

  var results = await Promise.all(
    batch.map(function (s) {
      return resolveServer(s, pageUrl).then(
        function (stream) { return stream; },
        function () { return null; }
      );
    })
  );

  var primary = null;
  var primaryIdx = -1;
  var seenAlt = {};
  var alternatives = [];
  function pushAlt(idx, label) {
    if (idx === primaryIdx || seenAlt[idx]) return;
    seenAlt[idx] = true;
    if (alternatives.length < 8) {
      alternatives.push({ label: String(label || "Servidor").slice(0, 48), ref: altRefOf(idx) });
    }
  }
  for (var ri = 0; ri < results.length; ri++) {
    var st = results[ri];
    var sIdx = batchIdx[ri];
    if (
      st &&
      st.url &&
      (/\.(m3u8|mp4)(\?|$)/i.test(st.url) || /\/get_video\?/i.test(st.url) || /token=/i.test(st.url))
    ) {
      if (!primary) {
        primary = st;
        primaryIdx = sIdx;
      } else {
        pushAlt(sIdx, batch[ri].label);
      }
    } else {
      pushAlt(sIdx, batch[ri].label);
    }
  }
  for (var j = 0; j < servers.length; j++) {
    pushAlt(j, servers[j].label);
  }

  if (!primary) {
    throw kino.error("unavailable", "sin stream directo", {
      userMessage: "No se pudo obtener el video. Prueba otro servidor en el menu.",
    });
  }

  if (alternatives.length) primary.alternatives = alternatives.slice(0, 8);
  return primary;
}
