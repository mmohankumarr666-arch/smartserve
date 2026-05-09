// ─── Constants ───────────────────────────────────────────────────────────────
const taxRate = 0.05;
const serviceRate = 0.04;
const firebaseModuleVersion = "10.12.5";

// ─── Menu ─────────────────────────────────────────────────────────────────────
const menu = [
  { id: "paneer-tikka",   name: "Paneer Tikka",      desc: "Charred cottage cheese, mint chutney",       price: 220, category: "popular", available: true },
  { id: "butter-chicken", name: "Butter Chicken",     desc: "Creamy tomato gravy, boneless chicken",      price: 340, category: "popular", available: true },
  { id: "veg-biryani",    name: "Veg Biryani",        desc: "Dum rice, raita, fried onions",              price: 260, category: "mains",   available: true },
  { id: "dal-tadka",      name: "Dal Tadka",          desc: "Yellow lentils, garlic tempering",           price: 180, category: "mains",   available: true },
  { id: "lime-soda",      name: "Fresh Lime Soda",    desc: "Sweet, salt, or mixed",                      price: 90,  category: "drinks",  available: true },
  { id: "cold-coffee",    name: "Cold Coffee",        desc: "Creamy chilled coffee",                      price: 140, category: "drinks",  available: true },
  { id: "gulab-jamun",    name: "Gulab Jamun",        desc: "Warm syrup dumplings",                       price: 110, category: "dessert", available: true },
  { id: "brownie",        name: "Sizzling Brownie",   desc: "Chocolate brownie, vanilla scoop",           price: 190, category: "dessert", available: true },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function slugify(value) {
  const slug = String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "demo-restaurant";
}
function money(value) { return "\u20B9" + Math.round(value).toLocaleString("en-IN"); }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function tableNumber(tableId) { return Number(tableId.replace(/\D/g, "")); }
function tableLabel(tableId)  { return "Table " + tableNumber(tableId); }
function getItem(id)          { return menu.find((item) => item.id === id); }
function cloneDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}
function uniqueMenuId(name) {
  const base = slugify(name);
  let id = base, index = 2;
  while (menu.some((item) => item.id === id)) { id = base + "-" + index; index++; }
  return id;
}
function resolveRestaurantId() {
  const p = new URLSearchParams(window.location.search);
  return slugify(p.get("restaurant") || window.SMARTSERVE_RESTAURANT_ID || "demo-restaurant");
}
function firebaseConfigIsReady() {
  const c = window.SMARTSERVE_FIREBASE_CONFIG;
  return Boolean(c && c.apiKey && c.projectId && !c.apiKey.includes("PASTE_"));
}
function sessionLines(session) {
  const merged = {};
  session.orders.flatMap((o) => o.items).forEach((line) => {
    if (!merged[line.id]) merged[line.id] = Object.assign({}, line, { qty: 0 });
    merged[line.id].qty += line.qty;
  });
  return Object.values(merged);
}
function totals(lines) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const service  = subtotal * serviceRate;
  const tax      = subtotal * taxRate;
  return { subtotal, service, tax, grand: subtotal + service + tax };
}

// ─── State ────────────────────────────────────────────────────────────────────
const params          = new URLSearchParams(window.location.search);
let restaurantId      = resolveRestaurantId();
const initialTableIds = ["T1", "T2", "T3", "T4"];

function createSession(tableId) {
  return { tableId, status: "idle", orders: [], billRequested: false, openedAt: new Date() };
}

const state = {
  dashboardTable: "T1",
  editingMenuId: null,
  tableIds: initialTableIds.slice(),
  carts:    Object.fromEntries(initialTableIds.map((id) => [id, {}])),
  sessions: Object.fromEntries(initialTableIds.map((id) => [id, createSession(id)])),
  invoices: [],
};

// ─── Restaurant details (for printed bills) ───────────────────────────────────
const restaurantDetails = {
  name:    "",
  address: "",
  phone:   "",
  gstin:   "",
  email:   "",
  fssai:   "",
};

const sync = {
  enabled: false, loaded: false, applyingRemote: false,
  saveTimer: null, stateDoc: null, detailsDoc: null,
  auth: null, authModule: null, firestoreModule: null, db: null, setDoc: null,
  pendingRegistration: false,
};

function ensureTable(tableId) {
  if (!state.tableIds.includes(tableId)) {
    state.tableIds.push(tableId);
    state.tableIds.sort((a, b) => tableNumber(a) - tableNumber(b));
  }
  if (!state.carts[tableId])    state.carts[tableId]    = {};
  if (!state.sessions[tableId]) state.sessions[tableId] = createSession(tableId);
}

function nextTableId() {
  const max = state.tableIds.reduce((h, id) => Math.max(h, tableNumber(id)), 0);
  return "T" + (max + 1);
}

function customerUrl(tableId) {
  const url = new URL("customer.html", window.location.href);
  url.searchParams.set("restaurant", restaurantId);
  url.searchParams.set("table", tableId);
  return url.href;
}

function qrUrl(tableId, size) {
  size = size || 220;
  return "https://api.qrserver.com/v1/create-qr-code/?size=" + size + "x" + size + "&margin=12&data=" + encodeURIComponent(customerUrl(tableId));
}

// ─── Serialise / deserialise ──────────────────────────────────────────────────
function serializeState() {
  return {
    version: 2, menu: menu,
    tableIds: state.tableIds,
    dashboardTable: state.dashboardTable,
    carts: state.carts,
    sessions: Object.fromEntries(Object.entries(state.sessions).map(function(entry) {
      var id = entry[0], s = entry[1];
      return [id, Object.assign({}, s, {
        openedAt: cloneDate(s.openedAt).toISOString(),
        orders: s.orders.map(function(o) { return Object.assign({}, o, { createdAt: cloneDate(o.createdAt).toISOString() }); }),
      })];
    })),
    invoices: state.invoices.map(function(inv) { return Object.assign({}, inv, { closedAt: cloneDate(inv.closedAt).toISOString() }); }),
    updatedAt: new Date().toISOString(),
  };
}

function applyRemoteState(data) {
  if (!data) return;
  sync.applyingRemote = true;
  menu.splice(0, menu.length);
  (Array.isArray(data.menu) ? data.menu : []).forEach(function(item) { menu.push(item); });
  state.tableIds     = (Array.isArray(data.tableIds) && data.tableIds.length) ? data.tableIds : state.tableIds;
  state.dashboardTable = data.dashboardTable || state.tableIds[0] || "T1";
  state.carts        = data.carts || {};
  state.sessions     = Object.fromEntries(Object.entries(data.sessions || {}).map(function(entry) {
    var id = entry[0], s = entry[1];
    return [id, Object.assign({}, createSession(id), s, {
      openedAt: cloneDate(s.openedAt),
      orders: (s.orders || []).map(function(o) { return Object.assign({}, o, { createdAt: cloneDate(o.createdAt) }); }),
    })];
  }));
  state.invoices = (data.invoices || []).map(function(inv) { return Object.assign({}, inv, { closedAt: cloneDate(inv.closedAt) }); });
  state.tableIds.forEach(ensureTable);
  if (!state.tableIds.includes(state.dashboardTable)) state.dashboardTable = state.tableIds[0];
  resetMenuForm();
  renderAll();
  sync.applyingRemote = false;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function scheduleSave() {
  if (!sync.enabled || !sync.loaded || sync.applyingRemote || !sync.stateDoc) return;
  updateSyncStatus("Saving...");
  clearTimeout(sync.saveTimer);
  sync.saveTimer = setTimeout(saveToFirebase, 450);
}
async function saveToFirebase() {
  try {
    await sync.setDoc(sync.stateDoc, serializeState(), { merge: true });
    updateSyncStatus("Firebase saved");
  } catch (e) {
    console.error("Save failed", e);
    updateSyncStatus("Save failed");
  }
}
function renderAndSave() { renderAll(); scheduleSave(); }

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateSyncStatus(text) {
  var el = document.querySelector("#sync-status");
  if (el) el.textContent = text;
}
function updateLoginMessage(text, isError) {
  var el = document.querySelector("#login-message");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}
function updateRegisterMessage(text, isError) {
  var el = document.querySelector("#register-message");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderDashboard() {
  document.querySelector("#restaurant-id-label").textContent = restaurantId;
  document.querySelector("#active-table-label").textContent  = tableLabel(state.dashboardTable);
  document.querySelector("#open-session-count").textContent  = Object.values(state.sessions).filter(function(s) { return s.status !== "idle"; }).length;
  document.querySelector("#invoice-count").textContent       = state.invoices.length;
  document.querySelector("#table-count-input").value         = state.tableIds.length;
  document.querySelector("#customer-preview-link").href      = customerUrl(state.dashboardTable);
  document.querySelector("#kot-link").href = new URL("kot.html?restaurant=" + restaurantId, window.location.href).href;
  document.querySelector("#report-link").href = new URL("sales-report.html?restaurant=" + restaurantId, window.location.href).href;

  var activeOrders = Object.values(state.sessions).reduce(function(s, ses) { return s + ses.orders.length; }, 0);
  document.querySelector("#active-orders-count").textContent = activeOrders + " active order" + (activeOrders === 1 ? "" : "s");

  document.querySelector("#table-cards").innerHTML = state.tableIds.map(function(tableId) {
    var session    = state.sessions[tableId];
    var lines      = sessionLines(session);
    var amount     = totals(lines).grand;
    var statusText = session.billRequested ? "Bill requested" : session.status === "idle" ? "Fresh" : "Serving";
    var badgeClass = session.billRequested ? "bill" : session.status === "idle" ? "idle" : "";
    return '<article class="table-card ' + (state.dashboardTable === tableId ? "selected" : "") + " " + (session.billRequested ? "requested" : "") + " " + (session.status === "idle" ? "closed" : "") + '">' +
      '<button class="table-select" data-view-table="' + tableId + '">' +
        '<span><strong>' + tableLabel(tableId) + '</strong><small>' + lines.reduce(function(s,l){return s+l.qty;},0) + ' items \u00B7 ' + money(amount) + '</small></span>' +
        '<span class="status-badge ' + badgeClass + '">' + statusText + '</span>' +
      '</button>' +
      '<img class="qr-image" src="' + qrUrl(tableId, 180) + '" alt="QR for ' + tableLabel(tableId) + '" />' +
      '<div class="qr-actions"><a href="' + customerUrl(tableId) + '" target="_blank" rel="noopener">Open Menu</a><a href="' + qrUrl(tableId, 420) + '" target="_blank" rel="noopener">Print QR</a></div>' +
      '</article>';
  }).join("");
}

function renderBill() {
  var session = state.sessions[state.dashboardTable];
  var lines   = sessionLines(session);
  var detail  = document.querySelector("#bill-detail");
  document.querySelector("#bill-state").textContent   = tableLabel(state.dashboardTable);
  document.querySelector("#close-table-btn").disabled = lines.length === 0;

  if (!lines.length) {
    detail.className   = "bill-detail empty";
    detail.textContent = "No orders for this table yet.";
    return;
  }
  var total = totals(lines);
  detail.className = "bill-detail";
  detail.innerHTML =
    lines.map(function(l) { return '<div class="bill-row"><span>' + l.qty + ' \u00D7 ' + escapeHtml(l.name) + '</span><strong>' + money(l.qty * l.price) + '</strong></div>'; }).join("") +
    '<div class="bill-total">' +
      '<div class="bill-row"><span>Subtotal</span><strong>' + money(total.subtotal) + '</strong></div>' +
      '<div class="bill-row"><span>Service 4%</span><strong>' + money(total.service) + '</strong></div>' +
      '<div class="bill-row"><span>GST 5%</span><strong>' + money(total.tax) + '</strong></div>' +
      '<div class="bill-row grand"><span>Total</span><strong>' + money(total.grand) + '</strong></div>' +
    '</div>';
}

function renderMenuEditor() {
  document.querySelector("#menu-editor-list").innerHTML = menu.map(function(item) {
    return '<article class="menu-editor-item ' + (item.available ? "" : "unavailable") + '">' +
      '<div><strong>' + escapeHtml(item.name) + '</strong><p>' + escapeHtml(item.desc) + '</p>' +
      '<div class="editor-meta"><span>' + money(item.price) + '</span><span>' + escapeHtml(item.category) + '</span><span>' + (item.available ? "Available" : "Hidden") + '</span></div></div>' +
      '<div class="editor-actions">' +
        '<button class="icon-action" data-edit-menu="' + item.id + '">Edit</button>' +
        '<button class="icon-action" data-toggle-menu="' + item.id + '">' + (item.available ? "Hide" : "Show") + '</button>' +
        '<button class="icon-action danger" data-delete-menu="' + item.id + '">Delete</button>' +
      '</div></article>';
  }).join("");
}

function renderHistory() {
  var history = document.querySelector("#invoice-history");
  if (!state.invoices.length) {
    history.className   = "invoice-history empty";
    history.textContent = "No closed tables yet.";
    return;
  }
  history.className = "invoice-history";
  history.innerHTML = state.invoices.map(function(inv) {
    var hasLines  = Array.isArray(inv.lines) && inv.lines.length;
    var itemCount = inv.itemCount != null ? inv.itemCount : (inv.items != null ? inv.items : 0);
    var subtotal  = inv.subtotal != null ? inv.subtotal : inv.total;
    var service   = inv.service  != null ? inv.service  : 0;
    var tax       = inv.tax      != null ? inv.tax      : 0;
    var lineRows  = hasLines ? inv.lines.map(function(l) {
      return '<div class="inv-line"><span>' + l.qty + ' \u00D7 ' + escapeHtml(l.name) + '</span><span>' + money(l.qty * l.price) + '</span></div>';
    }).join("") : "";
    var breakdown = hasLines
      ? '<div class="inv-breakdown">' + lineRows +
        '<div class="inv-sep"></div>' +
        '<div class="inv-line muted"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
        '<div class="inv-line muted"><span>Service 4%</span><span>' + money(service) + '</span></div>' +
        '<div class="inv-line muted"><span>GST 5%</span><span>' + money(tax) + '</span></div>' +
        '<div class="inv-line grand"><span>Grand Total</span><span>' + money(inv.total) + '</span></div>' +
        '</div>'
      : "";
    return '<div class="history-invoice">' +
      '<button class="history-summary" data-toggle-invoice="' + inv.id + '" type="button">' +
        '<div class="history-summary-left"><strong>' + inv.id + '</strong>' +
        '<span class="history-meta">' + tableLabel(inv.tableId) + ' \u00B7 ' + itemCount + ' item' + (itemCount === 1 ? "" : "s") + ' \u00B7 ' + inv.closedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + '</span></div>' +
        '<div class="history-summary-right"><strong>' + money(inv.total) + '</strong><span class="inv-chevron">\u25BE</span></div>' +
      '</button>' + breakdown + '</div>';
  }).join("");
}

// ─── Render restaurant details form ──────────────────────────────────────────
function renderDetailsForm() {
  document.querySelector("#detail-name").value    = restaurantDetails.name    || "";
  document.querySelector("#detail-address").value = restaurantDetails.address || "";
  document.querySelector("#detail-phone").value   = restaurantDetails.phone   || "";
  document.querySelector("#detail-gstin").value   = restaurantDetails.gstin   || "";
  document.querySelector("#detail-email").value   = restaurantDetails.email   || "";
  document.querySelector("#detail-fssai").value   = restaurantDetails.fssai   || "";
}

function renderAll() {
  renderDashboard();
  renderBill();
  renderMenuEditor();
  renderHistory();
}

// ─── Menu form ────────────────────────────────────────────────────────────────
function resetMenuForm() {
  state.editingMenuId = null;
  document.querySelector("#menu-item-id").value             = "";
  document.querySelector("#menu-name").value                = "";
  document.querySelector("#menu-price").value               = "";
  document.querySelector("#menu-category").value            = "popular";
  document.querySelector("#menu-desc").value                = "";
  document.querySelector("#menu-available").checked         = true;
  document.querySelector("#save-menu-item-btn").textContent = "Add Item";
}

function editMenuItem(id) {
  var item = getItem(id); if (!item) return;
  state.editingMenuId = id;
  document.querySelector("#menu-item-id").value             = id;
  document.querySelector("#menu-name").value                = item.name;
  document.querySelector("#menu-price").value               = item.price;
  document.querySelector("#menu-category").value            = item.category;
  document.querySelector("#menu-desc").value                = item.desc;
  document.querySelector("#menu-available").checked         = item.available;
  document.querySelector("#save-menu-item-btn").textContent = "Save Changes";
  document.querySelector("#menu-name").focus();
}

function saveMenuItem(event) {
  event.preventDefault();
  var name      = document.querySelector("#menu-name").value.trim();
  var price     = Number(document.querySelector("#menu-price").value);
  var category  = document.querySelector("#menu-category").value;
  var desc      = document.querySelector("#menu-desc").value.trim();
  var available = document.querySelector("#menu-available").checked;
  if (!name || !desc || !Number.isFinite(price) || price <= 0) return;
  if (state.editingMenuId) {
    var item = getItem(state.editingMenuId);
    if (item) Object.assign(item, { name: name, price: Math.round(price), category: category, desc: desc, available: available });
  } else {
    menu.push({ id: uniqueMenuId(name), name: name, price: Math.round(price), category: category, desc: desc, available: available });
  }
  resetMenuForm(); renderAndSave();
}

function toggleMenuItem(id) {
  var item = getItem(id); if (!item) return;
  item.available = !item.available;
  Object.values(state.carts).forEach(function(cart) { if (!item.available) delete cart[id]; });
  renderAndSave();
}

function deleteMenuItem(id) {
  var index = menu.findIndex(function(item) { return item.id === id; });
  if (index === -1) return;
  menu.splice(index, 1);
  Object.values(state.carts).forEach(function(cart) { delete cart[id]; });
  if (state.editingMenuId === id) resetMenuForm();
  renderAndSave();
}

// ─── Table management ─────────────────────────────────────────────────────────
function closeTable() {
  var session = state.sessions[state.dashboardTable];
  var lines   = sessionLines(session);
  if (!lines.length) return;
  var total = totals(lines);
  state.invoices.unshift({
    id:        "INV-" + String(state.invoices.length + 1).padStart(3, "0"),
    tableId:   state.dashboardTable,
    itemCount: lines.reduce(function(s, l) { return s + l.qty; }, 0),
    lines:     lines.map(function(l) { return { id: l.id, name: l.name, price: l.price, qty: l.qty }; }),
    subtotal:  total.subtotal,
    service:   total.service,
    tax:       total.tax,
    total:     total.grand,
    closedAt:  new Date(),
  });
  state.sessions[state.dashboardTable] = createSession(state.dashboardTable);
  state.carts[state.dashboardTable]    = {};
  renderAndSave();
}

function addTable() {
  var tableId = nextTableId();
  ensureTable(tableId);
  state.dashboardTable = tableId;
  renderAndSave();
}

function setTableCount(event) {
  event.preventDefault();
  var count = Math.max(1, Math.min(200, Math.floor(Number(document.querySelector("#table-count-input").value))));
  if (!Number.isFinite(count)) return;
  var keepers = state.tableIds.filter(function(id) {
    var s = state.sessions[id];
    return tableNumber(id) <= count || s.orders.length > 0 || s.billRequested
      || Object.values(state.carts[id] || {}).some(function(qty) { return qty > 0; });
  });
  for (var i = 1; i <= count; i++) ensureTable("T" + i);
  state.tableIds = Array.from(new Set(keepers.concat(state.tableIds.filter(function(id) { return tableNumber(id) <= count; }))))
    .sort(function(a, b) { return tableNumber(a) - tableNumber(b); });
  if (!state.tableIds.includes(state.dashboardTable)) state.dashboardTable = state.tableIds[0];
  renderAndSave();
}

function showNotification(tableId, itemCount) {
  var notice = document.querySelector("#notification");
  document.querySelector("#notification-text").textContent =
    tableLabel(tableId) + " placed " + itemCount + " item" + (itemCount === 1 ? "" : "s") + ".";
  notice.classList.remove("hidden");
  document.querySelector("#beep").play().catch(function() {});
  clearTimeout(showNotification.timer);
  showNotification.timer = setTimeout(function() { notice.classList.add("hidden"); }, 3200);
}

// ─── Print Bill ───────────────────────────────────────────────────────────────
function printBill() {
  var session = state.sessions[state.dashboardTable];
  var lines   = sessionLines(session);
  if (!lines.length) { alert("No orders on this table yet."); return; }
  var total   = totals(lines);
  var now     = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  // Use saved restaurant details, fall back to restaurantId-derived name
  var billName    = restaurantDetails.name    || restaurantId.replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  var billAddress = restaurantDetails.address || "";
  var billPhone   = restaurantDetails.phone   || "";
  var billGstin   = restaurantDetails.gstin   || "";
  var billEmail   = restaurantDetails.email   || "";
  var billFssai   = restaurantDetails.fssai   || "";

  // Invoice number: next in sequence (invoices.length + 1 since this hasn't been closed yet)
  var invoiceNum  = "INV-" + String(state.invoices.length + 1).padStart(3, "0");

  var rows = lines.map(function(l) {
    return "<tr><td>" + escapeHtml(l.name) + "</td><td style='text-align:center'>" + l.qty +
           "</td><td style='text-align:right'>" + money(l.price) +
           "</td><td style='text-align:right'>" + money(l.price * l.qty) + "</td></tr>";
  }).join("");

  var css = [
    "body{font-family:monospace;font-size:13px;padding:24px;color:#111;max-width:380px;margin:auto}",
    "h2{text-align:center;font-size:16px;margin-bottom:2px}",
    ".sub{text-align:center;color:#666;font-size:11px;margin-bottom:4px}",
    ".inv-no{text-align:center;font-size:11px;font-weight:700;margin-bottom:12px;border-bottom:1px dashed #ccc;padding-bottom:8px}",
    "table{width:100%;border-collapse:collapse;margin-bottom:12px}",
    "th{border-bottom:2px solid #111;padding:4px 0;font-size:11px;text-align:left}",
    "th:not(:first-child){text-align:center} th:last-child{text-align:right}",
    "td{padding:3px 0;vertical-align:top}",
    ".sep{border-top:1px dashed #999;margin:8px 0}",
    ".row{display:flex;justify-content:space-between;padding:2px 0}",
    ".row.grand{font-weight:bold;font-size:15px;border-top:2px solid #111;margin-top:4px;padding-top:6px}",
    ".footer{text-align:center;margin-top:16px;font-size:11px;color:#888;border-top:1px dashed #ccc;padding-top:10px}",
    ".footer p{margin:2px 0}",
    "@media print{body{padding:0}}"
  ].join("");

  // Build header info lines
  var headerLines = "";
  if (billAddress) headerLines += "<div class='sub'>" + escapeHtml(billAddress).replace(/\n/g, "<br>") + "</div>";
  if (billPhone)   headerLines += "<div class='sub'>Ph: " + escapeHtml(billPhone) + "</div>";
  if (billEmail)   headerLines += "<div class='sub'>" + escapeHtml(billEmail) + "</div>";
  if (billGstin)   headerLines += "<div class='sub'>GSTIN: " + escapeHtml(billGstin.toUpperCase()) + "</div>";
  if (billFssai)   headerLines += "<div class='sub'>FSSAI: " + escapeHtml(billFssai) + "</div>";

  var html = "<!doctype html><html><head><meta charset='utf-8'>"
    + "<title>Bill - " + invoiceNum + "</title><style>" + css + "</style></head><body>"
    + "<h2>" + escapeHtml(billName) + "</h2>"
    + headerLines
    + "<div class='inv-no'>" + invoiceNum + " &nbsp;|&nbsp; " + tableLabel(state.dashboardTable) + " &nbsp;|&nbsp; " + now + "</div>"
    + "<table><thead><tr>"
    + "<th>Item</th><th style='text-align:center'>Qty</th>"
    + "<th style='text-align:right'>Rate</th><th style='text-align:right'>Amt</th>"
    + "</tr></thead><tbody>" + rows + "</tbody></table>"
    + "<div class='sep'></div>"
    + "<div class='row'><span>Subtotal</span><span>" + money(total.subtotal) + "</span></div>"
    + "<div class='row'><span>Service charge (4%)</span><span>" + money(total.service) + "</span></div>"
    + "<div class='row'><span>GST (5%)</span><span>" + money(total.tax) + "</span></div>"
    + "<div class='row grand'><span>Total</span><span>" + money(total.grand) + "</span></div>"
    + "<div class='footer'><p>Thank you for dining with us!</p><p>Powered by SmartServe</p></div>"
    + "<scr" + "ipt>window.onload=function(){window.print();}</" + "script>"
    + "</body></html>";

  var win = window.open("", "_blank", "width=420,height=680");
  win.document.write(html);
  win.document.close();
}

// ─── Restaurant details — save & load ─────────────────────────────────────────
async function saveRestaurantDetails(event) {
  event.preventDefault();
  restaurantDetails.name    = document.querySelector("#detail-name").value.trim();
  restaurantDetails.address = document.querySelector("#detail-address").value.trim();
  restaurantDetails.phone   = document.querySelector("#detail-phone").value.trim();
  restaurantDetails.gstin   = document.querySelector("#detail-gstin").value.trim().toUpperCase();
  restaurantDetails.email   = document.querySelector("#detail-email").value.trim();
  restaurantDetails.fssai   = document.querySelector("#detail-fssai").value.trim();

  var msg = document.querySelector("#details-save-msg");

  if (sync.enabled && sync.detailsDoc && sync.setDoc) {
    try {
      await sync.setDoc(sync.detailsDoc, Object.assign({}, restaurantDetails, { updatedAt: new Date().toISOString() }), { merge: true });
      msg.textContent = "Saved to Firebase ✓";
    } catch (e) {
      console.error("Details save failed", e);
      msg.textContent = "Save failed — check connection.";
    }
  } else {
    msg.textContent = "Saved locally ✓";
  }
  setTimeout(function() { msg.textContent = ""; }, 3000);
}

async function loadRestaurantDetails(fsMod, db) {
  if (!sync.detailsDoc) return;
  try {
    var snap = await fsMod.getDoc(sync.detailsDoc);
    if (snap.exists()) {
      var data = snap.data();
      Object.assign(restaurantDetails, {
        name:    data.name    || "",
        address: data.address || "",
        phone:   data.phone   || "",
        gstin:   data.gstin   || "",
        email:   data.email   || "",
        fssai:   data.fssai   || "",
      });
      renderDetailsForm();
    }
  } catch (e) {
    console.error("Details load failed", e);
  }
}

// ─── Firebase ─────────────────────────────────────────────────────────────────
async function connectFirebase() {
  if (!firebaseConfigIsReady()) {
    document.body.classList.remove("auth-locked");
    document.body.classList.add("auth-ready");
    updateSyncStatus("Local prototype");
    sync.loaded = true;
    renderAll();
    return;
  }
  updateLoginMessage("Connecting to Firebase...");
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/" + firebaseModuleVersion + "/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/" + firebaseModuleVersion + "/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/" + firebaseModuleVersion + "/firebase-firestore.js"),
    ]);
    const app  = appMod.initializeApp(window.SMARTSERVE_FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    const db   = fsMod.getFirestore(app);

    sync.enabled         = true;
    sync.auth            = auth;
    sync.authModule      = authMod;
    sync.firestoreModule = fsMod;
    sync.db              = db;
    sync.setDoc          = fsMod.setDoc;

    updateLoginMessage("Ready. Please sign in.");

    authMod.onAuthStateChanged(auth, async function(user) {
      if (sync.pendingRegistration) return;

      if (!user) {
        document.body.classList.add("auth-locked");
        document.body.classList.remove("auth-ready");
        updateLoginMessage("Use your staff account to sign in.");
        updateSyncStatus("Signed out");
        return;
      }

      try {
        let resolvedRestaurantId = null;
        let staffDocExists = false;

        const indexSnap = await fsMod.getDoc(fsMod.doc(db, "staffIndex", user.uid));
        if (indexSnap.exists()) {
          resolvedRestaurantId = indexSnap.data().restaurantId;
          const staffSnap = await fsMod.getDoc(
            fsMod.doc(db, "restaurants", resolvedRestaurantId, "staff", user.uid)
          );
          staffDocExists = staffSnap.exists();
          if (staffDocExists && staffSnap.data().restaurantId) {
            resolvedRestaurantId = staffSnap.data().restaurantId;
          }
        }

        if (!staffDocExists) {
          const urlRestaurantId = resolveRestaurantId();
          if (urlRestaurantId && urlRestaurantId !== "demo-restaurant") {
            const staffSnap = await fsMod.getDoc(
              fsMod.doc(db, "restaurants", urlRestaurantId, "staff", user.uid)
            );
            if (staffSnap.exists()) {
              resolvedRestaurantId = staffSnap.data().restaurantId || urlRestaurantId;
              staffDocExists = true;
              await fsMod.setDoc(
                fsMod.doc(db, "staffIndex", user.uid),
                { restaurantId: resolvedRestaurantId, email: user.email, createdAt: new Date().toISOString() },
                { merge: true }
              );
            }
          }
        }

        if (!resolvedRestaurantId || !staffDocExists) {
          await authMod.signOut(auth);
          updateLoginMessage("No restaurant found for this account. Contact support on WhatsApp: 8610741387", true);
          return;
        }

        const subSnap = await fsMod.getDoc(fsMod.doc(db, "subscriptions", resolvedRestaurantId));
        if (!subSnap.exists()) {
          await authMod.signOut(auth);
          updateLoginMessage("No subscription found. Please complete payment to activate your account.", true);
          return;
        }
        const sub = subSnap.data();
        if (sub.status !== "active" || new Date(sub.expiryDate) < new Date()) {
          await authMod.signOut(auth);
          updateLoginMessage("Your account is pending activation. Please contact us on WhatsApp: 8610741387", true);
          return;
        }

        restaurantId   = resolvedRestaurantId;
        sync.stateDoc  = fsMod.doc(db, "restaurants", restaurantId, "smartserve", "state");
        sync.detailsDoc = fsMod.doc(db, "restaurants", restaurantId, "smartserve", "details");

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("restaurant", restaurantId);
        window.history.replaceState({}, "", newUrl.toString());

        document.body.classList.remove("auth-locked");
        document.body.classList.add("auth-ready");
        await loadDashboardState(fsMod, db);

      } catch (e) {
        console.error("Auth check failed", e);
        updateLoginMessage("Sign-in check failed. Please try again.", true);
        await authMod.signOut(auth).catch(function() {});
      }
    });

  } catch (e) {
    console.error("Firebase setup failed", e);
    updateLoginMessage("Firebase setup failed. Check firebase-config.js.", true);
    updateSyncStatus("Setup failed");
    sync.loaded = true;
  }
}

async function loadDashboardState(fsMod, db) {
  updateSyncStatus("Loading...");
  const snap = await fsMod.getDoc(sync.stateDoc);
  if (snap.exists()) { applyRemoteState(snap.data()); }
  else               { await sync.setDoc(sync.stateDoc, serializeState(), { merge: true }); }

  // Load restaurant details
  await loadRestaurantDetails(fsMod, db);

  sync.loaded = true;
  updateSyncStatus("Firebase live");
  updateLoginMessage("Signed in.");

  fsMod.onSnapshot(sync.stateDoc, function(s) {
    if (!s.exists()) return;
    applyRemoteState(s.data());
    updateSyncStatus("Firebase live");
  }, function(e) { console.error("Sync failed", e); updateSyncStatus("Offline"); });

  const ordersCol    = fsMod.collection(db, "restaurants", restaurantId, "orders");
  const pendingQuery = fsMod.query(ordersCol, fsMod.where("status", "==", "pending"));

  fsMod.onSnapshot(pendingQuery, async function(snapshot) {
    for (const change of snapshot.docChanges()) {
      if (change.type !== "added") continue;
      const data = change.doc.data();
      const tableId = data.tableId, items = data.items, billRequested = data.billRequested;
      if (!tableId) continue;
      ensureTable(tableId);
      if (billRequested) {
        state.sessions[tableId].status        = "active";
        state.sessions[tableId].billRequested = true;
     } else if (items && items.length) {
        const session = state.sessions[tableId];
        session.status        = "active";
        session.billRequested = false;
        session.orders.push({ id: "ORD-" + (session.orders.length + 1), createdAt: new Date(), items: items });
        showNotification(tableId, items.reduce(function(s, item) { return s + item.qty; }, 0));
        // ── KOT: push to kitchen queue ──
        fsMod.setDoc(
          fsMod.doc(db, "restaurants", restaurantId, "kot", change.doc.id),
          { tableId: tableId, items: items, createdAt: new Date().toISOString(), status: "pending" }
        ).catch(function(e) { console.error("KOT write failed", e); });
      }
      try { await fsMod.updateDoc(change.doc.ref, { status: "processed" }); }
      catch (e) { console.error("Could not mark processed", e); }
      renderAndSave();
    }
  }, function(e) { console.error("Orders listener failed", e); });
}
// ─── Staff management ─────────────────────────────────────────────────────────
function renderStaffList(staffMembers, invites) {
  var el = document.querySelector("#staff-list");
  if (!el) return;
  var all = [];
  staffMembers.forEach(function(s) {
    all.push({ name: s.name || "Unknown", email: s.email || "", role: s.role || "staff", status: "active", uid: s.uid });
  });
  invites.forEach(function(inv) {
    all.push({ name: inv.name || "", email: inv.email || "", role: inv.role || "staff", status: "pending" });
  });
  if (!all.length) {
    el.innerHTML = '<p style="font-size:.83rem;color:var(--text-muted)">No staff added yet. Use the form above to invite team members.</p>';
    return;
  }
  el.innerHTML = all.map(function(s) {
    var isPending = s.status === "pending";
    return '<div class="staff-item">' +
      '<div class="staff-item-left">' +
        '<strong>' + escapeHtml(s.name) + (isPending ? ' <em style="font-size:.75rem;font-weight:400;color:var(--text-muted)">(invite sent)</em>' : '') + '</strong>' +
        '<small>' + escapeHtml(s.email) + '</small>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="role-badge ' + (isPending ? "pending" : s.role) + '">' + (isPending ? "Invited" : s.role) + '</span>' +
        (isPending ? '<button class="icon-action danger" data-remove-invite="' + escapeHtml(s.email) + '">Remove</button>' : '') +
      '</div>' +
    '</div>';
  }).join("");
}
 
async function loadStaffList() {
  if (!sync.enabled || !sync.firestoreModule || !sync.db) return;
  var fsMod = sync.firestoreModule;
  var db    = sync.db;
  try {
    var [staffSnap, inviteSnap] = await Promise.all([
      fsMod.getDocs(fsMod.collection(db, "restaurants", restaurantId, "staff")),
      fsMod.getDocs(fsMod.collection(db, "restaurants", restaurantId, "staff-invites")),
    ]);
    var staff   = [];
    var invites = [];
    staffSnap.forEach(function(d) { staff.push(Object.assign({ uid: d.id }, d.data())); });
    inviteSnap.forEach(function(d) { if (d.data().status !== "accepted") invites.push(Object.assign({ email: d.id }, d.data())); });
    renderStaffList(staff, invites);
  } catch (e) { console.error("Load staff failed", e); }
}
 
async function addStaffInvite(name, email, role) {
  if (!sync.enabled || !sync.firestoreModule || !sync.db) return "Firebase not connected.";
  var fsMod = sync.firestoreModule;
  var db    = sync.db;
  try {
    await fsMod.setDoc(
      fsMod.doc(db, "restaurants", restaurantId, "staff-invites", email.toLowerCase()),
      { name: name, role: role, addedAt: new Date().toISOString(), status: "pending" }
    );
    await loadStaffList();
    return null; // success
  } catch (e) {
    console.error("Add staff failed", e);
    return "Failed: " + e.message;
  }
}
 
async function removeStaffInvite(email) {
  if (!sync.enabled || !sync.firestoreModule || !sync.db) return;
  var fsMod = sync.firestoreModule;
  var db    = sync.db;
  try {
    await fsMod.deleteDoc(fsMod.doc(db, "restaurants", restaurantId, "staff-invites", email.toLowerCase()));
    await loadStaffList();
  } catch (e) { console.error("Remove invite failed", e); }
}
// ─── Boot — wait for DOM ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function() {

  document.body.classList.add("auth-locked");

  document.querySelector("#tab-login").addEventListener("click", function() {
    document.querySelector("#tab-login").classList.add("active");
    document.querySelector("#tab-register").classList.remove("active");
    document.querySelector("#login-form").classList.remove("hidden");
    document.querySelector("#register-form").classList.add("hidden");
  });
  document.querySelector("#tab-register").addEventListener("click", function() {
    document.querySelector("#tab-register").classList.add("active");
    document.querySelector("#tab-login").classList.remove("active");
    document.querySelector("#register-form").classList.remove("hidden");
    document.querySelector("#login-form").classList.add("hidden");
  });

  document.querySelector("#login-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    if (!sync.auth || !sync.authModule) { updateLoginMessage("Firebase not ready yet, please wait.", true); return; }
    const email    = document.querySelector("#staff-email").value.trim();
    const password = document.querySelector("#staff-password").value;
    updateLoginMessage("Signing in...");
    try {
      await sync.authModule.signInWithEmailAndPassword(sync.auth, email, password);
    } catch (err) {
      var msgs = {
        "auth/user-not-found":     "No account found with this email.",
        "auth/wrong-password":     "Incorrect password.",
        "auth/invalid-credential": "Invalid email or password.",
        "auth/invalid-email":      "Invalid email address.",
      };
      updateLoginMessage(msgs[err.code] || "Login failed. Check email and password.", true);
    }
  });

  document.querySelector("#register-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    if (!sync.auth || !sync.authModule || !sync.firestoreModule || !sync.db) {
      updateRegisterMessage("Firebase not ready yet, please wait.", true); return;
    }

    const restaurantName = document.querySelector("#reg-restaurant").value.trim();
    const ownerName      = document.querySelector("#reg-name").value.trim();
    const email          = document.querySelector("#reg-email").value.trim();
    const password       = document.querySelector("#reg-password").value;
    const plan           = document.querySelector("#reg-plan").value;

    if (!restaurantName || !ownerName) {
      updateRegisterMessage("Please fill in all fields.", true); return;
    }

    const newRestaurantId = slugify(restaurantName);
    updateRegisterMessage("Creating your account...");

    try {
      sync.pendingRegistration = true;
      const cred = await sync.authModule.createUserWithEmailAndPassword(sync.auth, email, password);

      const staffDocData = {
        role:         "owner",
        name:         ownerName,
        email:        email,
        restaurantId: newRestaurantId,
        createdAt:    new Date().toISOString(),
      };

      await sync.firestoreModule.setDoc(
        sync.firestoreModule.doc(sync.db, "restaurants", newRestaurantId, "staff", cred.user.uid),
        staffDocData
      );

      await sync.firestoreModule.setDoc(
        sync.firestoreModule.doc(sync.db, "staffIndex", cred.user.uid),
        { restaurantId: newRestaurantId, email: email, createdAt: new Date().toISOString() }
      );

      await sync.firestoreModule.setDoc(
        sync.firestoreModule.doc(sync.db, "subscriptions", newRestaurantId),
        {
          restaurantId:   newRestaurantId,
          restaurantName: restaurantName,
          ownerName:      ownerName,
          ownerEmail:     email,
          plan:           plan,
          startDate:      new Date().toISOString(),
          expiryDate:     new Date().toISOString(),
          status:         "pending",
          createdAt:      new Date().toISOString(),
        }
      );

      await sync.authModule.signOut(sync.auth);
      sync.pendingRegistration = false;

      const planLabel = plan === "yearly" ? "Yearly — ₹9,999/year" : "Monthly — ₹999/month";
      const waMessage = encodeURIComponent(
        "Hi! I just registered on SmartServe.\n\n" +
        "Restaurant: " + restaurantName + "\n" +
        "Restaurant ID: " + newRestaurantId + "\n" +
        "Owner: " + ownerName + "\n" +
        "Email: " + email + "\n" +
        "Plan: " + planLabel + "\n\n" +
        "Please activate my account after payment. Thank you!"
      );
      const waUrl = "https://wa.me/918610741387?text=" + waMessage;

      updateRegisterMessage("Account created! Redirecting to WhatsApp...");
      setTimeout(function () {
        window.open(waUrl, "_blank");
        document.querySelector("#tab-login").click();
        updateLoginMessage(
          "Account created! After payment is confirmed, sign in here. Your Restaurant ID: " + newRestaurantId,
          false
        );
      }, 1200);

    } catch (err) {
      sync.pendingRegistration = false;
      var msgs = {
        "auth/email-already-in-use": "This email is already registered. Please sign in.",
        "auth/invalid-email":        "Invalid email address.",
        "auth/weak-password":        "Password must be at least 6 characters.",
      };
      updateRegisterMessage(msgs[err.code] || ("Registration failed: " + err.message), true);
    }
  });

  document.querySelector("#logout-btn").addEventListener("click", async function() {
    if (sync.authModule && sync.auth) await sync.authModule.signOut(sync.auth);
  });

  var printBtn = document.querySelector("#print-bill-btn");
  if (printBtn) printBtn.addEventListener("click", printBill);
  document.querySelector("#menu-form").addEventListener("submit", saveMenuItem);
  document.querySelector("#cancel-menu-edit-btn").addEventListener("click", function() { resetMenuForm(); renderAll(); });
  document.querySelector("#table-count-form").addEventListener("submit", setTableCount);
  document.querySelector("#add-table-btn").addEventListener("click", addTable);
  document.querySelector("#close-table-btn").addEventListener("click", closeTable);

  // Restaurant details form
  document.querySelector("#restaurant-details-form").addEventListener("submit", saveRestaurantDetails);
  var staffForm = document.querySelector("#staff-invite-form");
  if (staffForm) {
    staffForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      var name  = document.querySelector("#staff-name-input").value.trim();
      var email = document.querySelector("#staff-email-input").value.trim().toLowerCase();
      var role  = document.querySelector("#staff-role-input").value;
      var msg   = document.querySelector("#staff-invite-msg");
      var btn   = document.querySelector("#staff-invite-btn");
      if (!name || !email) return;
      btn.disabled = true; msg.textContent = "Adding…";
      var err = await addStaffInvite(name, email, role);
      if (err) {
        msg.textContent = err; msg.style.color = "var(--red)";
      } else {
        msg.textContent = "✓ " + name + " added. Share your Restaurant ID with them.";
        msg.style.color = "var(--green)";
        document.querySelector("#staff-name-input").value  = "";
        document.querySelector("#staff-email-input").value = "";
      }
      btn.disabled = false;
      setTimeout(function() { msg.textContent = ""; }, 4000);
    });
  }
  // Remove invite via delegated click (add inside the existing document.addEventListener("click",...) handler)
  // Find: if (target.dataset.toggleInvoice) { ...}
  // Add AFTER it:
  // if (target.dataset.removeInvite) removeStaffInvite(target.dataset.removeInvite);

  document.addEventListener("click", function(event) {
    var target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.viewTable)     { state.dashboardTable = target.dataset.viewTable; renderAndSave(); }
    if (target.dataset.editMenu)      editMenuItem(target.dataset.editMenu);
    if (target.dataset.toggleMenu)    toggleMenuItem(target.dataset.toggleMenu);
    if (target.dataset.deleteMenu)    deleteMenuItem(target.dataset.deleteMenu);
    if (target.dataset.toggleInvoice) { var inv = target.closest(".history-invoice"); if (inv) inv.classList.toggle("expanded"); }
  });

  renderAll();
  loadStaffList();
  connectFirebase();
});
