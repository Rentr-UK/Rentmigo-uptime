/*
 * Rentmigo enhancements for the Upptime status page (loaded via `status-website.scripts`).
 *
 * - Replaces the response-time sparkline on each card with 90-day uptime bars
 *   built from history/summary.json (dailyMinutesDown).
 * - Hides internal (staging) monitors from the public page.
 * - Strips the "[Prod] " prefix and groups cards into Rentmigo / third-party.
 *
 * Upptime re-renders with Svelte, so everything here is idempotent and re-run
 * from a MutationObserver.
 */
(function () {
  var SUMMARY_URL =
    "https://raw.githubusercontent.com/Rentr-UK/Rentmigo-uptime/HEAD/history/summary.json";
  var DAYS = 90;
  var MONITORING_START = "2026-02-18";
  var HIDDEN = /^\[Staging\]/i;
  var PREFIX = /^\[Prod\]\s*/i;
  var FIRST_PARTY_HOST = /(^|\.)rentmigo\.co\.uk$/i;
  // A day with at least this many minutes down is shown red; anything less is amber.
  var MAJOR_MINUTES = 60;

  var summary = null;
  fetch(SUMMARY_URL, { cache: "no-cache" })
    .then(function (res) {
      return res.ok ? res.json() : [];
    })
    .then(function (data) {
      summary = {};
      (data || []).forEach(function (site) {
        summary[site.slug] = site;
      });
      schedule();
    })
    .catch(function () {
      summary = {};
    });

  function isoDay(date) {
    return date.toISOString().slice(0, 10);
  }

  // YYYY-MM-DD -> DD/MM/YYYY
  function prettyDay(iso) {
    return iso.split("-").reverse().join("/");
  }

  function formatMinutes(min) {
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h + " hr" + (m ? " " + m + " min" : "");
  }

  function uptimeText(window) {
    var pct = window[0] ? 100 - (window[1] / (window[0] * 1440)) * 100 : 100;
    // Floor so a day with any downtime never rounds up to 100.00%.
    return (Math.floor(pct * 100) / 100).toFixed(2) + "% uptime";
  }

  function buildBars(site) {
    var down = (site && site.dailyMinutesDown) || {};
    var today = new Date();
    var bars = document.createElement("div");
    bars.className = "rm-bars";
    bars.setAttribute("role", "img");

    // [tracked days, minutes down] over the full window and the last 30 days (phones).
    var long = [0, 0];
    var short = [0, 0];
    for (var i = DAYS - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      var key = isoDay(d);
      var bar = document.createElement("span");
      bar.className = "rm-bar";
      var tip;
      if (key < MONITORING_START) {
        bar.className += " nodata";
        tip = prettyDay(key) + "\nNo data";
      } else {
        var mins = down[key] || 0;
        long[0]++;
        long[1] += mins;
        if (i < 30) {
          short[0]++;
          short[1] += mins;
        }
        if (mins >= MAJOR_MINUTES) bar.className += " major";
        else if (mins > 0) bar.className += " partial";
        tip = prettyDay(key) + "\n" + (mins ? formatMinutes(mins) + " downtime" : "No downtime");
      }
      var pos = DAYS - 1 - i;
      if (pos < 8 || (pos >= 60 && pos < 64)) bar.className += " tip-left";
      if (pos > DAYS - 9) bar.className += " tip-right";
      bar.setAttribute("data-tip", tip);
      bars.appendChild(bar);
    }

    var longText = uptimeText(long);
    bars.setAttribute("aria-label", longText + " over the last " + DAYS + " days");

    var legend = document.createElement("div");
    legend.className = "rm-legend";
    legend.innerHTML =
      '<span class="rm-start"><span class="rm-long">' + DAYS + ' days ago</span>' +
      '<span class="rm-short">30 days ago</span></span>' +
      '<span class="rm-uptime"><span class="rm-long"></span><span class="rm-short"></span></span>' +
      '<span class="rm-end">Today</span>';
    legend.querySelector(".rm-uptime .rm-long").textContent = longText;
    legend.querySelector(".rm-uptime .rm-short").textContent = uptimeText(short);

    return [bars, legend];
  }

  function statusOf(article) {
    if (article.classList.contains("down")) return ["down", "Major outage"];
    if (article.classList.contains("degraded")) return ["degraded", "Degraded"];
    return ["up", "Operational"];
  }

  function enhanceCard(article) {
    var link = article.querySelector("h4 a");
    if (!link) return;

    var name = link.textContent.trim();
    if (HIDDEN.test(name)) {
      article.classList.add("rm-hidden");
      return;
    }
    if (PREFIX.test(name)) link.textContent = name.replace(PREFIX, "");

    var h4 = article.querySelector("h4");
    var state = statusOf(article);
    var pill = h4.querySelector(".rm-pill");
    if (!pill) {
      pill = document.createElement("span");
      h4.appendChild(pill);
    }
    pill.className = "rm-pill " + state[0];
    pill.textContent = state[1];

    if (summary && !article.querySelector(".rm-bars")) {
      var slug = (link.getAttribute("href") || "").split("/").filter(Boolean).pop();
      buildBars(summary[slug]).forEach(function (el) {
        article.appendChild(el);
      });
    }
  }

  function isFirstParty(article) {
    var link = article.querySelector("h4 a");
    var slug = link && (link.getAttribute("href") || "").split("/").filter(Boolean).pop();
    var site = summary && summary[slug];
    if (site && site.url) {
      try {
        return FIRST_PARTY_HOST.test(new URL(site.url).hostname);
      } catch (e) {}
    }
    return /^(prod|staging)-/.test(slug || "");
  }

  function groupCards(section) {
    var cards = Array.prototype.filter.call(section.children, function (el) {
      return el.tagName === "ARTICLE" && !el.classList.contains("rm-hidden");
    });
    if (!cards.length || !summary) return;

    var firstOurs = null;
    var firstTheirs = null;
    cards.forEach(function (card) {
      if (isFirstParty(card)) firstOurs = firstOurs || card;
      else firstTheirs = firstTheirs || card;
    });
    placeHeading(section, "ours", "Rentmigo", firstOurs);
    placeHeading(section, "theirs", "Services we rely on", firstTheirs);
  }

  function placeHeading(section, key, text, before) {
    var heading = section.querySelector('.rm-group[data-group="' + key + '"]');
    if (!before) {
      if (heading) heading.remove();
      return;
    }
    if (!heading) {
      heading = document.createElement("h3");
      heading.className = "rm-group";
      heading.setAttribute("data-group", key);
      heading.textContent = text;
    }
    if (heading.nextElementSibling !== before) section.insertBefore(heading, before);
  }

  function enhanceIncidents() {
    // Hide open incidents that only concern internal monitors.
    document.querySelectorAll("main > section article.down-active").forEach(function (article) {
      var title = article.querySelector("h4");
      if (title && /\[Staging\]/i.test(title.textContent)) article.classList.add("rm-hidden");
    });
    // Drop the hard-coded emoji from the overall status banner; CSS draws a status dot.
    var banner = document.querySelector("main > article.up");
    if (banner && banner.firstChild && banner.firstChild.nodeType === 3) {
      var cleaned = banner.firstChild.nodeValue.replace(/^\s*✅\s*/, "");
      if (cleaned !== banner.firstChild.nodeValue) banner.firstChild.nodeValue = cleaned;
    }
    // History pages: tidy the "[Prod] " prefix in headings.
    document.querySelectorAll("main h1, main h1 > a, main h2").forEach(function (h) {
      var node = h.firstChild;
      if (node && node.nodeType === 3 && PREFIX.test(node.nodeValue)) {
        node.nodeValue = node.nodeValue.replace(PREFIX, "");
      }
    });
  }

  function run() {
    pending = false;
    if (!document.body) return schedule();
    observer.disconnect();
    try {
      document.querySelectorAll(".live-status").forEach(function (section) {
        section.querySelectorAll(":scope > article").forEach(enhanceCard);
        groupCards(section);
      });
      enhanceIncidents();
    } finally {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    // setTimeout rather than requestAnimationFrame: rAF is paused in background tabs.
    setTimeout(run, 16);
  }

  var observer = new MutationObserver(schedule);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }
})();
