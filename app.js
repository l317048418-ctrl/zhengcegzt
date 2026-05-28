const state = {
  activeView: "policies",
  facets: null,
  items: [],
  total: 0,
  selectedId: null,
  selectedDictionaryId: "secondary_vocational",
  glossaryItems: [],
  glossaryTotal: 0,
  selectedTermId: null,
  timer: null,
  glossaryTimer: null,
  updateTimer: null,
  publishTimer: null,
  noteTarget: null,
};

const $ = (id) => document.getElementById(id);
const IS_STATIC = Boolean(window.POLICY_BROWSER_STATIC);
const EMBEDDED_DATA = window.POLICY_BROWSER_EMBEDDED_DATA || null;
const STATIC_VERSION = window.POLICY_BROWSER_DATA_VERSION || "";
const staticCache = {};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function optionList(select, values, label = "全部") {
  select.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function splitTerms(q = "") {
  return q
    .replaceAll("，", " ")
    .replaceAll("、", " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function loadStaticData(name) {
  if (EMBEDDED_DATA && Object.prototype.hasOwnProperty.call(EMBEDDED_DATA, name)) {
    return EMBEDDED_DATA[name];
  }
  if (!staticCache[name]) {
    staticCache[name] = fetch(staticAssetUrl(`data/${name}.json`)).then((response) => {
      if (!response.ok) throw new Error(`静态数据加载失败：${name}`);
      return response.json();
    });
  }
  return staticCache[name];
}

function staticAssetUrl(path) {
  return STATIC_VERSION ? `${path}?v=${encodeURIComponent(STATIC_VERSION)}` : path;
}

function cleanSearchItem(item) {
  const { searchText, ...rest } = item;
  return rest;
}

function textIncludes(value, term) {
  return String(value || "").toLowerCase().includes(term.toLowerCase());
}

function matchesAllTerms(item, terms) {
  return terms.every((term) =>
    [item.title, item.keywords, item.excerpt, item.documentNo, item.searchText].some((value) => textIncludes(value, term)),
  );
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-CN");
}

async function staticSearchDocuments(query) {
  const allItems = await loadStaticData("search-index");
  const terms = splitTerms(query.get("q") || "");
  let items = allItems.filter((item) => matchesAllTerms(item, terms));
  const source = query.get("source");
  const yearFrom = query.get("yearFrom");
  const yearTo = query.get("yearTo");
  const level = query.get("level");
  const department = query.get("department");
  const theme = query.get("theme");
  const scope = query.get("scope");
  const hasAttachment = query.get("hasAttachment");
  const sort = query.get("sort") || "date_desc";
  if (source) items = items.filter((item) => item.sourceName === source);
  if (yearFrom) items = items.filter((item) => String(item.publishedAt || "").slice(0, 4) >= yearFrom);
  if (yearTo) items = items.filter((item) => String(item.publishedAt || "").slice(0, 4) <= yearTo);
  if (level) items = items.filter((item) => item.levels.includes(level));
  if (department) items = items.filter((item) => item.departments.includes(department));
  if (theme) items = items.filter((item) => item.themes.includes(theme));
  if (scope) items = items.filter((item) => item.scope === scope);
  if (hasAttachment === "1") items = items.filter((item) => item.attachmentCount > 0);
  items = [...items].sort((a, b) => {
    if (sort === "date_asc") return compareText(a.publishedAt, b.publishedAt) || compareText(a.title, b.title);
    if (sort === "title") return compareText(a.title, b.title);
    return compareText(b.publishedAt, a.publishedAt) || compareText(a.title, b.title);
  });
  const total = items.length;
  const limit = Number(query.get("limit") || 80);
  const offset = Number(query.get("offset") || 0);
  return { total, items: items.slice(offset, offset + limit).map(cleanSearchItem), limit, offset };
}

function glossaryMatchRank(item, terms) {
  if (!terms.length) return 0;
  return terms.reduce((score, term) => {
    if (textIncludes(item.term, term)) return score;
    if ([...item.aliases, ...item.queryTerms].some((value) => textIncludes(value, term))) return score + 1;
    if (textIncludes(item.category, term)) return score + 2;
    if ([item.explanation, item.policyMeaning].some((value) => textIncludes(value, term))) return score + 3;
    return score + 4;
  }, 0);
}

function glossaryMatches(item, terms) {
  const values = [
    item.term,
    item.category,
    item.explanation,
    item.policyMeaning,
    item.whyItMatters,
    item.beginnerTip,
    ...item.aliases,
    ...item.commonScenarios,
    ...item.relatedTerms,
    ...item.queryTerms,
  ];
  return terms.every((term) => values.some((value) => textIncludes(value, term)));
}

async function staticSearchGlossary(query) {
  const allTerms = await loadStaticData("glossary");
  const terms = splitTerms(query.get("q") || "");
  const dictionary = query.get("dictionary");
  const category = query.get("category");
  let items = allTerms.filter((item) => glossaryMatches(item, terms));
  if (dictionary) items = items.filter((item) => item.dictionaryId === dictionary);
  if (category) items = items.filter((item) => item.category === category);
  items = [...items].sort(
    (a, b) =>
      glossaryMatchRank(a, terms) - glossaryMatchRank(b, terms) ||
      compareText(a.dictionaryId, b.dictionaryId) ||
      compareText(a.category, b.category) ||
      compareText(a.term, b.term),
  );
  const total = items.length;
  const limit = Number(query.get("limit") || 160);
  const offset = Number(query.get("offset") || 0);
  return { total, items: items.slice(offset, offset + limit), limit, offset };
}

async function getStaticJson(url) {
  const parsed = new URL(url, window.location.href);
  if (parsed.pathname.endsWith("/api/facets")) return loadStaticData("facets");
  if (parsed.pathname.endsWith("/api/stats")) return loadStaticData("stats");
  if (parsed.pathname.endsWith("/api/search")) return staticSearchDocuments(parsed.searchParams);
  if (parsed.pathname.endsWith("/api/glossary")) return staticSearchGlossary(parsed.searchParams);
  if (parsed.pathname.includes("/api/document/")) {
    const id = decodeURIComponent(parsed.pathname.split("/").pop());
    if (EMBEDDED_DATA) {
      const allItems = await loadStaticData("search-index");
      const item = allItems.find((doc) => doc.id === id);
      if (!item) throw new Error("未找到政策详情");
      return {
        ...cleanSearchItem(item),
        fullText: item.excerpt || "单文件轻量版未内置完整正文，请打开官网原文查看。",
        contentSource: "",
        issuer: "",
        attachments: [],
        notes: [],
      };
    }
    return fetch(staticAssetUrl(`data/documents/${encodeURIComponent(id)}.json`)).then((response) => {
      if (!response.ok) throw new Error("未找到政策详情");
      return response.json();
    });
  }
  if (parsed.pathname.includes("/api/glossary/")) {
    const id = decodeURIComponent(parsed.pathname.split("/").pop());
    const allTerms = await loadStaticData("glossary");
    const term = allTerms.find((item) => item.id === id);
    if (!term) throw new Error("未找到术语详情");
    return term;
  }
  throw new Error("静态版不支持该操作");
}

function dictionaryOptionList(select, dictionaries) {
  if (!dictionaries.length) {
    select.innerHTML = `<option value="">暂无词典</option>`;
    return;
  }
  select.innerHTML = dictionaries
    .map((item) => {
      const count = item.termCount ? ` (${item.termCount})` : "";
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${count}</option>`;
    })
    .join("");
}

function mutationDictionaryOptionList(select, dictionaries) {
  select.innerHTML =
    `<option value="">自动判断</option>` +
    dictionaries
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
      .join("");
}

function updateGlossaryCategories() {
  const dictionaryId = $("glossaryDictionary").value;
  const categoryMap = state.facets?.glossaryCategoryMap || {};
  const categories = categoryMap[dictionaryId] || state.facets?.glossaryCategories || [];
  const previous = $("glossaryCategory").value;
  optionList($("glossaryCategory"), categories);
  if (categories.includes(previous)) $("glossaryCategory").value = previous;
}

function params() {
  const data = new URLSearchParams();
  ["q", "source", "yearFrom", "yearTo", "level", "department", "theme", "scope", "hasAttachment", "sort"].forEach((id) => {
    const value = $(id).value.trim();
    if (value) data.set(id, value);
  });
  data.set("limit", "80");
  return data;
}

function glossaryParams() {
  const data = new URLSearchParams();
  const q = $("glossaryQ").value.trim();
  const dictionary = $("glossaryDictionary").value.trim();
  const category = $("glossaryCategory").value.trim();
  if (q) data.set("q", q);
  if (dictionary) data.set("dictionary", dictionary);
  if (category) data.set("category", category);
  data.set("limit", "160");
  return data;
}

async function getJson(url, options) {
  if (IS_STATIC) return getStaticJson(url, options);
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const data = JSON.parse(text);
      message = data.error || text;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function loadFacets() {
  const [facets, stats] = await Promise.all([getJson("/api/facets"), getJson("/api/stats")]);
  state.facets = facets;
  optionList($("source"), facets.sources);
  optionList($("yearFrom"), facets.years);
  optionList($("yearTo"), facets.years);
  optionList($("level"), facets.levels);
  optionList($("department"), facets.departments);
  optionList($("theme"), facets.themes);
  optionList($("scope"), facets.scopes);
  const dictionaries = facets.glossaryDictionaries || [];
  dictionaryOptionList($("glossaryDictionary"), dictionaries);
  mutationDictionaryOptionList($("termDictionary"), dictionaries);
  const preferred = state.selectedDictionaryId || "secondary_vocational";
  state.selectedDictionaryId = dictionaries.some((item) => item.id === preferred) ? preferred : dictionaries[0]?.id || "";
  $("glossaryDictionary").value = state.selectedDictionaryId;
  updateGlossaryCategories();
  renderMetrics(stats);
}

function renderMetrics(stats) {
  const scopes = stats.byScope.map((s) => `${escapeHtml(s.name)} ${s.count}`).join(" / ");
  $("metrics").innerHTML = `
    <div class="metric"><span>政策条目</span><strong>${stats.total}</strong></div>
    <div class="metric"><span>附件</span><strong>${stats.attachments}</strong></div>
    <div class="metric"><span>教育术语</span><strong>${stats.glossaryTerms || 0}</strong></div>
    <div class="metric"><span>最新发布日期</span><strong>${escapeHtml(stats.latestPublishedAt || "-")}</strong></div>
    <div class="metric wide"><span>收录范围</span><strong title="${scopes}">${scopes || "-"}</strong></div>
  `;
}

function setActiveView(view) {
  state.activeView = view;
  $("policyView").hidden = view !== "policies";
  $("glossaryView").hidden = view !== "glossary";
  $("policyTab").classList.toggle("active", view === "policies");
  $("glossaryTab").classList.toggle("active", view === "glossary");
}

async function search() {
  const data = await getJson(`/api/search?${params().toString()}`);
  state.items = data.items;
  state.total = data.total;
  renderResults();
  if (!state.selectedId && data.items.length) {
    selectDocument(data.items[0].id);
  } else if (!data.items.length) {
    state.selectedId = null;
    renderEmpty();
  }
}

function renderResults() {
  $("resultCount").textContent = `${state.total} 条`;
  $("resultList").innerHTML = state.items
    .map((item) => {
      const tags = [...item.levels.slice(0, 2), ...item.departments.slice(0, 2), ...item.themes.slice(0, 1)];
      return `
        <button class="resultItem ${item.id === state.selectedId ? "active" : ""}" type="button" data-id="${escapeHtml(item.id)}">
          <span class="itemMeta">
            <span class="date">${escapeHtml(item.publishedAt || "未标注")}</span>
            <span class="badge">${escapeHtml(item.sourceName)}</span>
            ${item.attachmentCount ? `<span class="chip">附件 ${item.attachmentCount}</span>` : ""}
          </span>
          <strong class="itemTitle">${escapeHtml(item.title)}</strong>
          <span class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</span>
          <p class="itemExcerpt">${escapeHtml(item.excerpt || item.keywords || "")}</p>
        </button>
      `;
    })
    .join("");
  document.querySelectorAll(".resultItem").forEach((button) => {
    button.addEventListener("click", () => selectDocument(button.dataset.id));
  });
}

async function selectDocument(id) {
  state.selectedId = id;
  renderResults();
  const doc = await getJson(`/api/document/${encodeURIComponent(id)}`);
  renderDetail(doc);
}

function renderEmpty() {
  $("detailEmpty").hidden = false;
  $("detailContent").hidden = true;
  $("detailContent").innerHTML = "";
}

function renderDetail(doc) {
  $("detailEmpty").hidden = true;
  const detail = $("detailContent");
  detail.hidden = false;
  const metaChips = [
    doc.publishedAt,
    doc.sourceName,
    doc.documentNo,
    doc.scope,
    ...doc.levels,
    ...doc.departments.slice(0, 3),
  ].filter(Boolean);
  const attachmentHtml = doc.attachments.length
    ? doc.attachments
        .map(
          (att) => `
            <div class="attachment">
              <a href="${escapeHtml(att.href)}" target="_blank">${escapeHtml(att.title)}</a>
              <span>${formatBytes(att.sizeBytes)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="notice">未下载到附件，仍可打开官网查看。</p>`;

  detail.innerHTML = `
    <h2 class="detailTitle">${escapeHtml(doc.title)}</h2>
    <div class="detailMeta">${metaChips.map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join("")}</div>
    <div class="toolbar">
      <a href="${escapeHtml(doc.url)}" target="_blank">打开官网原文</a>
      <button type="button" id="copyRef">复制引用</button>
      ${IS_STATIC ? "" : `<button type="button" id="addPolicyNote">笔记</button>`}
    </div>
    <h3 class="sectionTitle">关键词</h3>
    <div class="chips">${(doc.keywords || "未提取")
      .split("、")
      .filter(Boolean)
      .slice(0, 18)
      .map((v) => `<span class="chip">${escapeHtml(v)}</span>`)
      .join("")}</div>
    <h3 class="sectionTitle">收录理由</h3>
    <p>${escapeHtml(doc.importanceReason || "2020年以来全量收录")}</p>
    <h3 class="sectionTitle">附件</h3>
    <div class="attachments">${attachmentHtml}</div>
    <h3 class="sectionTitle">学习笔记</h3>
    <div class="notesList">${renderNotes(doc.notes || [])}</div>
    <h3 class="sectionTitle">正文</h3>
    <div class="bodyText">${escapeHtml(trimArticleText(doc.fullText || doc.excerpt || ""))}</div>
  `;
  $("copyRef").addEventListener("click", () => copyReference(doc));
  if ($("addPolicyNote")) $("addPolicyNote").addEventListener("click", () => openNoteDialog("policy", doc.id, doc.title));
  bindNoteDeleteButtons();
}

async function searchGlossary() {
  const data = await getJson(`/api/glossary?${glossaryParams().toString()}`);
  state.glossaryItems = data.items;
  state.glossaryTotal = data.total;
  renderGlossaryResults();
  if (!state.selectedTermId && data.items.length) {
    selectGlossaryTerm(data.items[0].id);
  } else if (state.selectedTermId && !data.items.some((item) => item.id === state.selectedTermId) && data.items.length) {
    selectGlossaryTerm(data.items[0].id);
  } else if (!data.items.length) {
    state.selectedTermId = null;
    renderGlossaryEmpty();
  }
}

function renderGlossaryResults() {
  $("glossaryCount").textContent = `${state.glossaryTotal} 个术语`;
  $("glossaryList").innerHTML = state.glossaryItems
    .map((item) => {
      const aliases = item.aliases.slice(0, 3).join("、");
      return `
        <button class="glossaryItem ${item.id === state.selectedTermId ? "active" : ""}" type="button" data-id="${escapeHtml(item.id)}">
          <span class="itemMeta">
            <span class="badge">${escapeHtml(item.dictionaryShortName || "术语")}</span>
            <span class="badge">${escapeHtml(item.category)}</span>
            <span class="chip">政策命中 ${item.sourceCount}</span>
          </span>
          <strong class="itemTitle">${escapeHtml(item.term)}</strong>
          ${aliases ? `<span class="aliasLine">${escapeHtml(aliases)}</span>` : ""}
          <p class="itemExcerpt">${escapeHtml(item.explanation)}</p>
        </button>
      `;
    })
    .join("");
  document.querySelectorAll(".glossaryItem").forEach((button) => {
    button.addEventListener("click", () => selectGlossaryTerm(button.dataset.id));
  });
}

async function selectGlossaryTerm(id) {
  state.selectedTermId = id;
  renderGlossaryResults();
  const term = await getJson(`/api/glossary/${encodeURIComponent(id)}`);
  renderGlossaryDetail(term);
}

function renderGlossaryEmpty() {
  $("glossaryEmpty").hidden = false;
  $("glossaryDetail").hidden = true;
  $("glossaryDetail").innerHTML = "";
}

function renderGlossaryDetail(term) {
  $("glossaryEmpty").hidden = true;
  const detail = $("glossaryDetail");
  detail.hidden = false;
  const chips = [term.dictionaryShortName, term.category, ...term.aliases].filter(Boolean);
  const scenarios = term.commonScenarios.map((item) => `<span class="scenario">${escapeHtml(item)}</span>`).join("");
  const related = term.relatedTerms.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("");
  const sources = term.sources.length
    ? term.sources
        .map(
          (source) => `
            <div class="sourceItem">
              <div>
                <span class="itemMeta">
                  <span class="date">${escapeHtml(source.publishedAt || "未标注")}</span>
                  <span class="badge">${escapeHtml(source.sourceName || "")}</span>
                  <span class="chip">${escapeHtml(source.reason || "政策文本相关")}</span>
                </span>
                <strong>${escapeHtml(source.title)}</strong>
              </div>
              <div class="sourceActions">
                <a href="${escapeHtml(source.url)}" target="_blank">官网</a>
                <button type="button" data-source-doc="${escapeHtml(source.documentId)}">查看</button>
              </div>
            </div>
          `,
        )
        .join("")
    : `<p class="notice">本地政策库暂未直接命中，可用术语继续检索。</p>`;

  detail.innerHTML = `
    <div class="termKicker">${escapeHtml(term.dictionaryName || "教育术语词典")}</div>
    <h2 class="detailTitle">${escapeHtml(term.term)}</h2>
    <div class="detailMeta">${chips.map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join("")}</div>
    <div class="toolbar">
      <button type="button" id="copyTerm">复制词条</button>
      ${IS_STATIC ? "" : `<button type="button" id="addTermNote">笔记</button>`}
    </div>
    <section class="termBlock leadBlock">
      <h3 class="sectionTitle">一句话解释</h3>
      <p>${escapeHtml(term.explanation)}</p>
    </section>
    <section class="termGrid">
      <div class="termBlock">
        <h3 class="sectionTitle">政策语境</h3>
        <p>${escapeHtml(term.policyMeaning)}</p>
      </div>
      <div class="termBlock">
        <h3 class="sectionTitle">指导时为什么重要</h3>
        <p>${escapeHtml(term.whyItMatters)}</p>
      </div>
    </section>
    <h3 class="sectionTitle">常见场景</h3>
    <div class="scenarioGrid">${scenarios || `<span class="notice">未标注</span>`}</div>
    <h3 class="sectionTitle">外行提示</h3>
    <p class="beginnerTip">${escapeHtml(term.beginnerTip)}</p>
    <h3 class="sectionTitle">相关词</h3>
    <div class="chips">${related || `<span class="notice">未标注</span>`}</div>
    <h3 class="sectionTitle">学习笔记</h3>
    <div class="notesList">${renderNotes(term.notes || [])}</div>
    <h3 class="sectionTitle">依据政策</h3>
    <div class="sourceList">${sources}</div>
  `;
  $("copyTerm").addEventListener("click", () => copyTerm(term));
  if ($("addTermNote")) $("addTermNote").addEventListener("click", () => openNoteDialog("glossary", term.id, term.term));
  bindNoteDeleteButtons();
  document.querySelectorAll("[data-source-doc]").forEach((button) => {
    button.addEventListener("click", () => openPolicySource(button.dataset.sourceDoc));
  });
}

function trimArticleText(text) {
  const lines = text.split("\n").filter((line) => line.trim());
  const start = Math.max(0, lines.findIndex((line) => line.includes("正文")) + 1);
  return lines.slice(start).join("\n").slice(0, 20000);
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImageFile(file) {
  return String(file.mimeType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.title || file.href || "");
}

function renderNotes(notes = []) {
  if (!notes.length) return `<p class="notice mutedNotice">暂无学习笔记。</p>`;
  return notes
    .map((note) => {
      const images = (note.files || []).filter(isImageFile);
      const files = (note.files || []).filter((file) => !isImageFile(file));
      const deleteButton = IS_STATIC ? "" : `<button type="button" class="noteDelete" data-note-delete="${escapeHtml(note.id)}">删除</button>`;
      return `
        <section class="noteCard" data-note-id="${escapeHtml(note.id)}">
          <div class="noteHead">
            <strong>${escapeHtml(note.title || "学习笔记")}</strong>
            <span>${escapeHtml((note.createdAt || "").replace("T", " "))}</span>
            ${deleteButton}
          </div>
          ${note.body ? `<p class="noteBody">${escapeHtml(note.body)}</p>` : ""}
          ${
            images.length
              ? `<div class="noteImages">${images
                  .map(
                    (file) =>
                      `<a href="${escapeHtml(file.href)}" target="_blank"><img src="${escapeHtml(file.href)}" alt="${escapeHtml(file.title)}" /></a>`,
                  )
                  .join("")}</div>`
              : ""
          }
          ${
            files.length
              ? `<div class="noteFiles">${files
                  .map(
                    (file) =>
                      `<a href="${escapeHtml(file.href)}" target="_blank">${escapeHtml(file.title)}<span>${formatBytes(file.sizeBytes)}</span></a>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </section>
      `;
    })
    .join("");
}

async function copyReference(doc) {
  const text = `${doc.title}（${doc.sourceName}，${doc.publishedAt || "未标注日期"}）${doc.url}`;
  await navigator.clipboard.writeText(text);
  $("copyRef").textContent = "已复制";
  setTimeout(() => {
    const button = $("copyRef");
    if (button) button.textContent = "复制引用";
  }, 1200);
}

async function copyTerm(term) {
  const text = `【${term.dictionaryName || "教育术语词典"}】${term.term}\n一句话解释：${term.explanation}\n政策语境：${term.policyMeaning}\n指导提示：${term.beginnerTip}`;
  await navigator.clipboard.writeText(text);
  $("copyTerm").textContent = "已复制";
  setTimeout(() => {
    const button = $("copyTerm");
    if (button) button.textContent = "复制词条";
  }, 1200);
}

async function openPolicySource(docId) {
  setActiveView("policies");
  await selectDocument(docId);
  document.querySelector(".detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function configureStaticMode() {
  if (!IS_STATIC) return;
  document.body.classList.add("staticMode");
  $("staticBanner").hidden = false;
  [
    ["uploadBtn", "线上静态版不能直接上传资料，请回到本地工作台上传后再发布。"],
    ["termBtn", "线上静态版不能直接添加术语，请回到本地工作台添加后再发布。"],
    ["updateBtn", "线上静态版不能直接更新知识库，请回到本地工作台更新后再发布。"],
    ["publishBtn", "线上静态版不能发布 GitHub，请回到本地工作台发布。"],
  ].forEach(([id, title]) => {
    const button = $(id);
    button.classList.add("staticOnly");
    button.title = title;
  });
  $("dataApiLink").hidden = true;
  $("updateStatus").textContent = "静态版";
}

function showStaticOnlyMessage(action) {
  window.alert(`线上静态版只支持阅读、检索和打开已导出的附件，不能直接${action}。\n\n请回到本地工作台完成该操作，再点击“发布到 GitHub”同步到线上。`);
}

function setStatus(elementId, message, type = "") {
  const status = $(elementId);
  status.className = `publishStatus ${type}`.trim();
  status.innerHTML = message;
}

function openNoteDialog(targetType, targetId, targetTitle) {
  state.noteTarget = { targetType, targetId };
  $("noteHeading").value = "学习笔记";
  $("noteBody").value = "";
  $("noteFiles").value = "";
  setStatus("noteStatus", "");
  $("noteDialog").showModal();
  setTimeout(() => $("noteBody").focus(), 30);
}

function closeNoteDialog() {
  $("noteDialog").close();
}

function bindNoteDeleteButtons() {
  document.querySelectorAll("[data-note-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteStudyNote(button.dataset.noteDelete));
  });
}

async function deleteStudyNote(noteId) {
  if (!noteId) return;
  if (!window.confirm("删除这条学习笔记？")) return;
  try {
    const result = await getJson(`/api/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
    if (result.targetType === "policy") {
      await selectDocument(result.targetId);
    } else if (result.targetType === "glossary") {
      await selectGlossaryTerm(result.targetId);
    }
  } catch (error) {
    alert(error.message || String(error));
  }
}

async function saveStudyNote() {
  if (!state.noteTarget) return;
  const files = [...$("noteFiles").files];
  const bodyText = $("noteBody").value.trim();
  if (!bodyText && !files.length) {
    setStatus("noteStatus", "请填写文字笔记或上传图片/文件。", "error");
    return;
  }
  const body = new FormData();
  body.append("targetType", state.noteTarget.targetType);
  body.append("targetId", state.noteTarget.targetId);
  body.append("title", $("noteHeading").value.trim());
  body.append("body", bodyText);
  files.forEach((file) => body.append("files", file));
  $("noteSubmitBtn").disabled = true;
  setStatus("noteStatus", "正在保存笔记...");
  try {
    await getJson("/api/notes", { method: "POST", body });
    setStatus("noteStatus", "笔记已保存。", "success");
    if (state.noteTarget.targetType === "policy") {
      await selectDocument(state.noteTarget.targetId);
    } else {
      await selectGlossaryTerm(state.noteTarget.targetId);
    }
  } catch (error) {
    setStatus("noteStatus", escapeHtml(error.message || String(error)), "error");
  } finally {
    $("noteSubmitBtn").disabled = false;
  }
}

function openUploadDialog() {
  $("uploadFiles").value = "";
  $("uploadFolderFiles").value = "";
  $("uploadSourceName").value = localStorage.getItem("policyUploadSourceName") || "本地上传";
  $("uploadNote").value = "";
  setStatus("uploadStatus", "");
  $("uploadDialog").showModal();
}

function closeUploadDialog() {
  $("uploadDialog").close();
}

function setUploadButtonsDisabled(disabled) {
  $("uploadSubmitBtn").disabled = disabled;
  $("uploadBtn").disabled = disabled;
}

async function uploadKnowledgeFiles() {
  const files = [
    ...[...$("uploadFiles").files].map((file) => ({ file, name: file.name })),
    ...[...$("uploadFolderFiles").files].map((file) => ({ file, name: file.webkitRelativePath || file.name })),
  ];
  const sourceName = $("uploadSourceName").value.trim() || "本地上传";
  if (!files.length) {
    setStatus("uploadStatus", "请选择至少一个文件或一个文件夹。", "error");
    return;
  }
  localStorage.setItem("policyUploadSourceName", sourceName);
  const body = new FormData();
  files.forEach(({ file, name }) => body.append("files", file, name));
  body.append("sourceName", sourceName);
  body.append("note", $("uploadNote").value.trim());
  setUploadButtonsDisabled(true);
  setStatus("uploadStatus", `正在上传 ${files.length} 个文件、解析并重建知识库...`);
  try {
    const result = await getJson("/api/uploads/knowledge", { method: "POST", body });
    const rows = (result.items || [])
      .map((item) => `${escapeHtml(item.filename)}：${escapeHtml(item.message || "已处理")}`)
      .join("<br>");
    setStatus("uploadStatus", `已入库 ${result.count || 0} 个文件。<br>${rows}`, "success");
    await loadFacets();
    setActiveView("policies");
    $("source").value = sourceName;
    $("q").value = "";
    state.selectedId = null;
    await search();
    const firstId = (result.items || []).find((item) => item.id)?.id;
    if (firstId) await selectDocument(firstId);
  } catch (error) {
    setStatus("uploadStatus", escapeHtml(error.message || String(error)), "error");
  } finally {
    setUploadButtonsDisabled(false);
  }
}

function openTermDialog() {
  $("termName").value = "";
  $("termAliases").value = "";
  $("termNote").value = "";
  $("termDictionary").value = "";
  setStatus("termStatus", "");
  $("termDialog").showModal();
  setTimeout(() => $("termName").focus(), 30);
}

function closeTermDialog() {
  $("termDialog").close();
}

function setTermButtonsDisabled(disabled) {
  $("termSubmitBtn").disabled = disabled;
  $("termBtn").disabled = disabled;
}

async function addGlossaryTerm() {
  const term = $("termName").value.trim();
  if (!term) {
    setStatus("termStatus", "请填写术语名称。", "error");
    return;
  }
  setTermButtonsDisabled(true);
  setStatus("termStatus", "正在结合本地政策和教育部、四川省教育厅在线资料分析术语...");
  try {
    const result = await getJson("/api/glossary/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term,
        aliases: $("termAliases").value.trim(),
        note: $("termNote").value.trim(),
        dictionaryId: $("termDictionary").value,
      }),
    });
    const addedTerm = result.term || {};
    setStatus("termStatus", escapeHtml(result.message || "术语已加入词典。"), "success");
    await loadFacets();
    setActiveView("glossary");
    if (addedTerm.dictionaryId) {
      state.selectedDictionaryId = addedTerm.dictionaryId;
      $("glossaryDictionary").value = addedTerm.dictionaryId;
      updateGlossaryCategories();
    }
    $("glossaryQ").value = addedTerm.term || term;
    $("glossaryCategory").value = "";
    state.selectedTermId = null;
    await searchGlossary();
    if (addedTerm.id) await selectGlossaryTerm(addedTerm.id);
  } catch (error) {
    setStatus("termStatus", escapeHtml(error.message || String(error)), "error");
  } finally {
    setTermButtonsDisabled(false);
  }
}

function openPublishDialog() {
  $("publishRepo").value = localStorage.getItem("policyGithubDesktopRepo") || "";
  $("publishBranch").value = localStorage.getItem("policyGithubDesktopBranch") || "main";
  $("publishStatus").className = "publishStatus";
  $("publishStatus").textContent = "正在读取本地 GitHub Desktop 仓库...";
  $("publishDialog").showModal();
  getJson("/api/publish/github-desktop/default")
    .then((data) => {
      if (!$("publishRepo").value) $("publishRepo").value = data.repoPath || "";
      if (!$("publishBranch").value) $("publishBranch").value = data.branch || "main";
      setPublishStatus("准备好后点击“发布更新”。");
    })
    .catch((error) => setPublishStatus(escapeHtml(error.message || String(error)), "error"));
}

function closePublishDialog() {
  $("publishDialog").close();
}

function setPublishStatus(message, type = "") {
  const status = $("publishStatus");
  status.className = `publishStatus ${type}`.trim();
  status.innerHTML = message;
}

async function publishToGithub() {
  const repoPath = $("publishRepo").value.trim();
  const branch = $("publishBranch").value.trim() || "main";
  if (!repoPath) {
    setPublishStatus("请填写 GitHub Desktop 本地仓库路径。", "error");
    return;
  }
  localStorage.setItem("policyGithubDesktopRepo", repoPath);
  localStorage.setItem("policyGithubDesktopBranch", branch);
  $("publishSubmitBtn").disabled = true;
  $("publishBtn").disabled = true;
  setPublishStatus("正在生成静态站点、更新本地仓库并推送...");
  try {
    const result = await getJson("/api/publish/github-desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath,
        branch,
      }),
    });
    if (result.pushed) {
      const url = result.url ? `<br><a href="${escapeHtml(result.url)}" target="_blank">${escapeHtml(result.url)}</a>` : "";
      setPublishStatus(`已提交并推送，GitHub Desktop 已打开。${url}`, "success");
    } else if (result.needsDesktopPush) {
      const url = result.url ? `<br>推送完成后访问：<a href="${escapeHtml(result.url)}" target="_blank">${escapeHtml(result.url)}</a>` : "";
      const ahead = result.ahead ? `当前有 ${result.ahead} 个本地提交待推送。` : "当前本地提交待推送。";
      const repoHint = result.repoPath ? `<br>仓库路径：${escapeHtml(result.repoPath)}` : "";
      setPublishStatus(
        `网页已生成并提交到本地仓库，GitHub Desktop 已打开。${ahead}${repoHint}<br>` +
          `下一步在 GitHub Desktop 操作：左上角 <strong>Current Repository</strong> 选择 <strong>zhengcegzt</strong>，` +
          `然后看窗口顶部工具栏右侧，点击带上箭头的 <strong>Push origin</strong> / <strong>推送 origin</strong>。` +
          `<br>如果没有看到按钮，也可以用 Mac 顶部菜单 <strong>Repository → Push</strong>。${url}`,
        "warning",
      );
    } else {
      setPublishStatus(`已更新本地仓库并打开 GitHub Desktop，但自动推送未完成：<br>${escapeHtml(result.pushError || "")}`, "error");
    }
  } catch (error) {
    setPublishStatus(escapeHtml(error.message || String(error)), "error");
  } finally {
    $("publishSubmitBtn").disabled = false;
    $("publishBtn").disabled = false;
  }
}

function publishFormPayload() {
  const repo = $("publishRepo").value.trim();
  const branch = $("publishBranch").value.trim() || "gh-pages";
  if (!repo) {
    setPublishStatus("请填写 GitHub 仓库名，例如 education-policy-workbench；也可以填 owner/repo。", "error");
    return null;
  }
  localStorage.setItem("policyGithubRepo", repo);
  localStorage.setItem("policyGithubBranch", branch);
  return {
    repo,
    branch,
    private: $("publishPrivate").checked,
  };
}

function setPublishButtonsDisabled(disabled) {
  $("publishSubmitBtn").disabled = disabled;
  if ($("publishWebSubmitBtn")) $("publishWebSubmitBtn").disabled = disabled;
  $("publishBtn").disabled = disabled;
}

function renderPublishLines(lines, type = "") {
  setPublishStatus((lines || []).map((line) => escapeHtml(line)).join("<br>"), type);
}

async function refreshGithubWebStatus() {
  try {
    const data = await getJson("/api/publish/github-web/status");
    const gh = data.gh || {};
    if (data.job?.running) {
      pollGithubWebPublish();
      return;
    }
    if (gh.authenticated) {
      setPublishStatus("已检测到 GitHub 网页授权，可直接发布。", "success");
    } else if (gh.available) {
      setPublishStatus("GitHub CLI 已可用；点击“网页登录授权并发布”后会打开 GitHub 授权页。");
    } else {
      setPublishStatus("首次使用会自动下载 GitHub CLI，然后打开 GitHub 授权页。");
    }
  } catch (error) {
    setPublishStatus(escapeHtml(error.message || String(error)), "error");
  }
}

async function publishWithGithubWeb() {
  const payload = publishFormPayload();
  if (!payload) return;
  setPublishButtonsDisabled(true);
  setPublishStatus("正在准备网页登录发布...");
  try {
    const response = await getJson("/api/publish/github-web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.started) {
      setPublishStatus("已有发布任务正在进行，请稍候。");
    }
    pollGithubWebPublish();
  } catch (error) {
    setPublishStatus(escapeHtml(error.message || String(error)), "error");
    setPublishButtonsDisabled(false);
  }
}

async function pollGithubWebPublish() {
  clearTimeout(state.publishTimer);
  const data = await getJson("/api/publish/github-web/status");
  const job = data.job || {};
  const lines = job.lines || [];
  if (job.running) {
    renderPublishLines(lines.length ? lines : ["正在网页登录发布..."]);
    state.publishTimer = setTimeout(pollGithubWebPublish, 1600);
    return;
  }
  setPublishButtonsDisabled(false);
  if (job.ok && job.result?.url) {
    const safeUrl = escapeHtml(job.result.url);
    setPublishStatus(`发布完成：<a href="${safeUrl}" target="_blank">${safeUrl}</a>`, "success");
  } else if (job.error) {
    renderPublishLines(lines.length ? lines : [job.error], "error");
  } else {
    renderPublishLines(lines);
  }
}

function debounceSearch() {
  clearTimeout(state.timer);
  state.timer = setTimeout(search, 180);
}

function debounceGlossarySearch() {
  clearTimeout(state.glossaryTimer);
  state.glossaryTimer = setTimeout(searchGlossary, 180);
}

function resetFilters() {
  ["q", "source", "yearFrom", "yearTo", "level", "department", "theme", "scope", "hasAttachment"].forEach((id) => {
    $(id).value = "";
  });
  $("sort").value = "date_desc";
  state.selectedId = null;
  search();
}

function resetGlossaryFilters() {
  $("glossaryQ").value = "";
  state.selectedDictionaryId = state.facets?.glossaryDictionaries?.some((item) => item.id === "secondary_vocational")
    ? "secondary_vocational"
    : state.facets?.glossaryDictionaries?.[0]?.id || "";
  $("glossaryDictionary").value = state.selectedDictionaryId;
  updateGlossaryCategories();
  $("glossaryCategory").value = "";
  state.selectedTermId = null;
  searchGlossary();
}

function changeGlossaryDictionary() {
  state.selectedDictionaryId = $("glossaryDictionary").value;
  $("glossaryCategory").value = "";
  updateGlossaryCategories();
  state.selectedTermId = null;
  searchGlossary();
}

async function updateKnowledgeBase() {
  $("updateBtn").disabled = true;
  $("updateStatus").textContent = "正在更新";
  await getJson("/api/update", { method: "POST" });
  pollUpdate();
}

async function pollUpdate() {
  const status = await getJson("/api/update/status");
  const lines = status.lines || [];
  $("updateStatus").textContent = status.running ? lines.slice(-1)[0] || "正在更新" : "更新完成";
  if (status.running) {
    state.updateTimer = setTimeout(pollUpdate, 1800);
  } else {
    $("updateBtn").disabled = false;
    await loadFacets();
    await search();
    await searchGlossary();
  }
}

async function init() {
  configureStaticMode();
  await loadFacets();
  await Promise.all([search(), searchGlossary()]);
  ["q", "source", "yearFrom", "yearTo", "level", "department", "theme", "scope", "hasAttachment", "sort"].forEach((id) => {
    $(id).addEventListener(id === "q" ? "input" : "change", debounceSearch);
  });
  $("glossaryQ").addEventListener("input", debounceGlossarySearch);
  $("glossaryDictionary").addEventListener("change", changeGlossaryDictionary);
  $("glossaryCategory").addEventListener("change", debounceGlossarySearch);
  $("resetBtn").addEventListener("click", resetFilters);
  $("glossaryResetBtn").addEventListener("click", resetGlossaryFilters);
  $("noteCloseBtn").addEventListener("click", closeNoteDialog);
  $("noteCancelBtn").addEventListener("click", closeNoteDialog);
  $("noteSubmitBtn").addEventListener("click", saveStudyNote);
  $("uploadBtn").addEventListener("click", IS_STATIC ? () => showStaticOnlyMessage("上传资料入库") : openUploadDialog);
  $("uploadCloseBtn").addEventListener("click", closeUploadDialog);
  $("uploadCancelBtn").addEventListener("click", closeUploadDialog);
  $("uploadSubmitBtn").addEventListener("click", uploadKnowledgeFiles);
  $("termBtn").addEventListener("click", IS_STATIC ? () => showStaticOnlyMessage("添加术语") : openTermDialog);
  $("termCloseBtn").addEventListener("click", closeTermDialog);
  $("termCancelBtn").addEventListener("click", closeTermDialog);
  $("termSubmitBtn").addEventListener("click", addGlossaryTerm);
  $("updateBtn").addEventListener("click", IS_STATIC ? () => showStaticOnlyMessage("更新知识库") : updateKnowledgeBase);
  $("publishBtn").addEventListener("click", IS_STATIC ? () => showStaticOnlyMessage("发布到 GitHub") : openPublishDialog);
  $("publishCloseBtn").addEventListener("click", closePublishDialog);
  $("publishCancelBtn").addEventListener("click", closePublishDialog);
  $("publishSubmitBtn").addEventListener("click", publishToGithub);
  $("policyTab").addEventListener("click", () => setActiveView("policies"));
  $("glossaryTab").addEventListener("click", () => setActiveView("glossary"));
}

init().catch((error) => {
  $("resultList").innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  $("glossaryList").innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
});
