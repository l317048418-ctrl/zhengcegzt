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
};

const $ = (id) => document.getElementById(id);
const IS_STATIC = Boolean(window.POLICY_BROWSER_STATIC);
const EMBEDDED_DATA = window.POLICY_BROWSER_EMBEDDED_DATA || null;
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
    staticCache[name] = fetch(`data/${name}.json`).then((response) => {
      if (!response.ok) throw new Error(`静态数据加载失败：${name}`);
      return response.json();
    });
  }
  return staticCache[name];
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
      };
    }
    return fetch(`data/documents/${encodeURIComponent(id)}.json`).then((response) => {
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
    <h3 class="sectionTitle">正文</h3>
    <div class="bodyText">${escapeHtml(trimArticleText(doc.fullText || doc.excerpt || ""))}</div>
  `;
  $("copyRef").addEventListener("click", () => copyReference(doc));
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
    <h3 class="sectionTitle">依据政策</h3>
    <div class="sourceList">${sources}</div>
  `;
  $("copyTerm").addEventListener("click", () => copyTerm(term));
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
  $("updateBtn").hidden = true;
  $("publishBtn").hidden = true;
  $("dataApiLink").hidden = true;
  $("updateStatus").textContent = "静态版";
}

function openPublishDialog() {
  $("publishRepo").value = localStorage.getItem("policyGithubRepo") || "education-policy-workbench";
  $("publishBranch").value = localStorage.getItem("policyGithubBranch") || "gh-pages";
  $("publishToken").value = "";
  $("publishPrivate").checked = false;
  $("publishStatus").className = "publishStatus";
  $("publishStatus").textContent = "正在检查网页登录发布环境...";
  $("publishDialog").showModal();
  refreshGithubWebStatus();
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
  const repo = $("publishRepo").value.trim();
  const token = $("publishToken").value.trim();
  const branch = $("publishBranch").value.trim() || "gh-pages";
  if (!repo) {
    setPublishStatus("请填写 GitHub 仓库名，例如 education-policy-workbench；也可以填 owner/repo。", "error");
    return;
  }
  if (!token) {
    setPublishStatus("Token 发布需要填写 token；你也可以直接点“网页登录授权并发布”。", "error");
    return;
  }
  localStorage.setItem("policyGithubRepo", repo);
  localStorage.setItem("policyGithubBranch", branch);
  $("publishSubmitBtn").disabled = true;
  $("publishBtn").disabled = true;
  setPublishStatus("正在生成静态站点并推送到 GitHub...");
  try {
    const result = await getJson("/api/publish/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo,
        token,
        branch,
        private: $("publishPrivate").checked,
      }),
    });
    const pagesNote = result.pagesConfigured ? "" : `<br>${escapeHtml(result.pagesMessage || "Pages 可能需要稍后在仓库设置中开启。")}`;
    setPublishStatus(
      `发布完成：<a href="${escapeHtml(result.url)}" target="_blank">${escapeHtml(result.url)}</a>${pagesNote}`,
      "success",
    );
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
  $("publishWebSubmitBtn").disabled = disabled;
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
  $("updateBtn").addEventListener("click", updateKnowledgeBase);
  $("publishBtn").addEventListener("click", openPublishDialog);
  $("publishCloseBtn").addEventListener("click", closePublishDialog);
  $("publishCancelBtn").addEventListener("click", closePublishDialog);
  $("publishSubmitBtn").addEventListener("click", publishToGithub);
  $("publishWebSubmitBtn").addEventListener("click", publishWithGithubWeb);
  $("policyTab").addEventListener("click", () => setActiveView("policies"));
  $("glossaryTab").addEventListener("click", () => setActiveView("glossary"));
}

init().catch((error) => {
  $("resultList").innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  $("glossaryList").innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
});
