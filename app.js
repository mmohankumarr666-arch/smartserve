const taxRate = 0.05;
const serviceRate = 0.04;

const menu = [
  { id: "paneer-tikka", name: "Paneer Tikka", desc: "Charred cottage cheese, mint chutney", price: 220, category: "popular", available: true },
  { id: "butter-chicken", name: "Butter Chicken", desc: "Creamy tomato gravy, boneless chicken", price: 340, category: "popular", available: true },
  { id: "veg-biryani", name: "Veg Biryani", desc: "Dum rice, raita, fried onions", price: 260, category: "mains", available: true },
  { id: "dal-tadka", name: "Dal Tadka", desc: "Yellow lentils, garlic tempering", price: 180, category: "mains", available: true },
  { id: "lime-soda", name: "Fresh Lime Soda", desc: "Sweet, salt, or mixed", price: 90, category: "drinks", available: true },
  { id: "cold-coffee", name: "Cold Coffee", desc: "Creamy chilled coffee", price: 140, category: "drinks", available: true },
  { id: "gulab-jamun", name: "Gulab Jamun", desc: "Warm syrup dumplings", price: 110, category: "dessert", available: true },
  { id: "brownie", name: "Sizzling Brownie", desc: "Chocolate brownie, vanilla scoop", price: 190, category: "dessert", available: true },
];

const initialTableIds = ["T1", "T2", "T3", "T4"];
const state = {
  activeTable: "T1",
  dashboardTable: "T1",
  category: "popular",
  editingMenuId: null,
  tableIds: [...initialTableIds],
  carts: Object.fromEntries(initialTableIds.map((id) => [id, {}])),
  sessions: Object.fromEntries(initialTableIds.map((id) => [id, createSession(id)])),
  invoices: [],
};

function createSession(tableId) {
  return {
    tableId,
    status: "idle",
    orders: [],
    billRequested: false,
    openedAt: new Date(),
  };
}

function money(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function slugify(value) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || `item-${Date.now()}`;
}

function uniqueMenuId(name) {
  const base = slugify(name);
  let id = base;
  let index = 2;
  while (menu.some((item) => item.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function tableNumber(tableId) {
  return Number(tableId.replace(/\D/g, ""));
}

function tableLabel(tableId) {
  return `Table ${tableNumber(tableId)}`;
}

function ensureTable(tableId) {
  if (!state.tableIds.includes(tableId)) {
    state.tableIds.push(tableId);
    state.tableIds.sort((a, b) => tableNumber(a) - tableNumber(b));
  }
  if (!state.carts[tableId]) state.carts[tableId] = {};
  if (!state.sessions[tableId]) state.sessions[tableId] = createSession(tableId);
}

function nextTableId() {
  const max = state.tableIds.reduce((highest, tableId) => Math.max(highest, tableNumber(tableId)), 0);
  return `T${max + 1}`;
}

function getItem(id) {
  return menu.find((item) => item.id === id);
}

function sessionLines(session) {
  const merged = {};
  session.orders.flatMap((order) => order.items).forEach((line) => {
    if (!merged[line.id]) {
      merged[line.id] = { ...line, qty: 0 };
    }
    merged[line.id].qty += line.qty;
  });
  return Object.values(merged);
}

function totals(lines) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const service = subtotal * serviceRate;
  const tax = subtotal * taxRate;
  return { subtotal, service, tax, grand: subtotal + service + tax };
}

function cartLines(tableId = state.activeTable) {
  return Object.entries(state.carts[tableId])
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ ...getItem(id), qty }))
    .filter((line) => line.id);
}

function renderMenu() {
  const grid = document.querySelector("#menu-grid");
  const visible = menu.filter((item) => item.available && item.category === state.category);
  if (!visible.length) {
    grid.innerHTML = `<div class="empty">No available items in this category.</div>`;
    return;
  }

  grid.innerHTML = visible.map((item) => `
    <article class="menu-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.desc)}</p>
      </div>
      <div class="item-bottom">
        <span>${money(item.price)}</span>
        <button class="add-btn" data-add="${item.id}" aria-label="Add ${escapeHtml(item.name)}">+</button>
      </div>
    </article>
  `).join("");
}

function renderTableSwitcher() {
  document.querySelector("#table-switch").innerHTML = state.tableIds.map((tableId) => `
    <button class="table-pill ${tableId === state.activeTable ? "active" : ""}" data-table="${tableId}">${tableLabel(tableId)}</button>
  `).join("");
}

function renderCart() {
  const lines = cartLines();
  const container = document.querySelector("#cart-lines");
  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  document.querySelector("#cart-total").textContent = money(total);
  document.querySelector("#place-order-btn").disabled = lines.length === 0;

  if (!lines.length) {
    container.className = "cart-lines empty";
    container.textContent = "Add items to begin.";
    return;
  }

  container.className = "cart-lines";
  container.innerHTML = lines.map((line) => `
    <div class="cart-line">
      <div>
        <strong>${escapeHtml(line.name)}</strong>
        <small>${money(line.price)} each</small>
      </div>
      <div class="qty-tools">
        <button data-dec="${line.id}" aria-label="Remove one ${escapeHtml(line.name)}">-</button>
        <strong>${line.qty}</strong>
        <button data-inc="${line.id}" aria-label="Add one ${escapeHtml(line.name)}">+</button>
      </div>
    </div>
  `).join("");
}

function renderDashboard() {
  document.querySelector("#active-table-label").textContent = tableLabel(state.activeTable);
  document.querySelector("#customer-table-title").textContent = tableLabel(state.activeTable);
  document.querySelector("#open-session-count").textContent = Object.values(state.sessions).filter((session) => session.status !== "idle").length;
  document.querySelector("#invoice-count").textContent = state.invoices.length;
  document.querySelector("#table-count-input").value = state.tableIds.length;

  const activeOrders = Object.values(state.sessions).reduce((sum, session) => sum + session.orders.length, 0);
  document.querySelector("#active-orders-count").textContent = `${activeOrders} active order${activeOrders === 1 ? "" : "s"}`;

  document.querySelector("#table-cards").innerHTML = state.tableIds.map((tableId) => {
    const session = state.sessions[tableId];
    const lines = sessionLines(session);
    const amount = totals(lines).grand;
    const statusText = session.billRequested ? "Bill requested" : session.status === "idle" ? "Fresh" : "Serving";
    const badgeClass = session.billRequested ? "bill" : session.status === "idle" ? "idle" : "";
    return `
      <button class="table-card ${state.dashboardTable === tableId ? "selected" : ""} ${session.billRequested ? "requested" : ""} ${session.status === "idle" ? "closed" : ""}" data-view-table="${tableId}">
        <div class="panel-heading compact">
          <strong>${tableLabel(tableId)}</strong>
          <span class="status-badge ${badgeClass}">${statusText}</span>
        </div>
        <div class="table-meta">
          <span>${lines.reduce((sum, line) => sum + line.qty, 0)} items</span>
          <span>${money(amount)}</span>
        </div>
      </button>
    `;
  }).join("");

  renderBill();
  renderMenuEditor();
  renderHistory();
}

function renderBill() {
  const session = state.sessions[state.dashboardTable];
  const lines = sessionLines(session);
  const detail = document.querySelector("#bill-detail");
  document.querySelector("#bill-state").textContent = tableLabel(state.dashboardTable);
  document.querySelector("#close-table-btn").disabled = lines.length === 0;

  if (!lines.length) {
    detail.className = "bill-detail empty";
    detail.textContent = "No orders for this table yet.";
    return;
  }

  const total = totals(lines);
  detail.className = "bill-detail";
  detail.innerHTML = `
    ${lines.map((line) => `
      <div class="bill-row">
        <span>${line.qty} x ${escapeHtml(line.name)}</span>
        <strong>${money(line.qty * line.price)}</strong>
      </div>
    `).join("")}
    <div class="bill-total">
      <div class="bill-row"><span>Subtotal</span><strong>${money(total.subtotal)}</strong></div>
      <div class="bill-row"><span>Service charge 4%</span><strong>${money(total.service)}</strong></div>
      <div class="bill-row"><span>GST 5%</span><strong>${money(total.tax)}</strong></div>
      <div class="bill-row grand"><span>Total</span><strong>${money(total.grand)}</strong></div>
    </div>
  `;
}

function renderMenuEditor() {
  const list = document.querySelector("#menu-editor-list");
  list.innerHTML = menu.map((item) => `
    <article class="menu-editor-item ${item.available ? "" : "unavailable"}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.desc)}</p>
        <div class="editor-meta">
          <span>${money(item.price)}</span>
          <span>${escapeHtml(item.category)}</span>
          <span>${item.available ? "Available" : "Hidden"}</span>
        </div>
      </div>
      <div class="editor-actions">
        <button class="icon-action" data-edit-menu="${item.id}" aria-label="Edit ${escapeHtml(item.name)}">Edit</button>
        <button class="icon-action" data-toggle-menu="${item.id}" aria-label="${item.available ? "Hide" : "Show"} ${escapeHtml(item.name)}">${item.available ? "Hide" : "Show"}</button>
        <button class="icon-action danger" data-delete-menu="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function resetMenuForm() {
  state.editingMenuId = null;
  document.querySelector("#menu-item-id").value = "";
  document.querySelector("#menu-name").value = "";
  document.querySelector("#menu-price").value = "";
  document.querySelector("#menu-category").value = "popular";
  document.querySelector("#menu-desc").value = "";
  document.querySelector("#menu-available").checked = true;
  document.querySelector("#save-menu-item-btn").textContent = "Add Item";
}

function editMenuItem(id) {
  const item = getItem(id);
  if (!item) return;
  state.editingMenuId = id;
  document.querySelector("#menu-item-id").value = id;
  document.querySelector("#menu-name").value = item.name;
  document.querySelector("#menu-price").value = item.price;
  document.querySelector("#menu-category").value = item.category;
  document.querySelector("#menu-desc").value = item.desc;
  document.querySelector("#menu-available").checked = item.available;
  document.querySelector("#save-menu-item-btn").textContent = "Save Changes";
  document.querySelector("#menu-name").focus();
}

function saveMenuItem(event) {
  event.preventDefault();
  const name = document.querySelector("#menu-name").value.trim();
  const price = Number(document.querySelector("#menu-price").value);
  const category = document.querySelector("#menu-category").value;
  const desc = document.querySelector("#menu-desc").value.trim();
  const available = document.querySelector("#menu-available").checked;

  if (!name || !desc || !Number.isFinite(price) || price <= 0) return;

  if (state.editingMenuId) {
    const item = getItem(state.editingMenuId);
    if (item) {
      Object.assign(item, { name, price: Math.round(price), category, desc, available });
    }
  } else {
    menu.push({ id: uniqueMenuId(name), name, price: Math.round(price), category, desc, available });
  }

  resetMenuForm();
  renderAll();
}

function toggleMenuItem(id) {
  const item = getItem(id);
  if (!item) return;
  item.available = !item.available;
  Object.values(state.carts).forEach((cart) => {
    if (!item.available) delete cart[id];
  });
  renderAll();
}

function deleteMenuItem(id) {
  const index = menu.findIndex((item) => item.id === id);
  if (index === -1) return;
  menu.splice(index, 1);
  Object.values(state.carts).forEach((cart) => delete cart[id]);
  if (state.editingMenuId === id) resetMenuForm();
  renderAll();
}

function renderHistory() {
  const history = document.querySelector("#invoice-history");
  if (!state.invoices.length) {
    history.className = "invoice-history empty";
    history.textContent = "No closed tables yet.";
    return;
  }

  history.className = "invoice-history";
  history.innerHTML = state.invoices.map((invoice) => `
    <div class="history-line">
      <div>
        <strong>${invoice.id} · ${tableLabel(invoice.tableId)}</strong>
        <small>${invoice.items} items · ${invoice.closedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </div>
      <strong>${money(invoice.total)}</strong>
    </div>
  `).join("");
}

function renderTabs() {
  document.querySelectorAll(".category-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === state.category);
  });
}

function renderAll() {
  renderTableSwitcher();
  renderTabs();
  renderMenu();
  renderCart();
  renderDashboard();
}

function showNotification(tableId, itemCount) {
  const notice = document.querySelector("#notification");
  document.querySelector("#notification-text").textContent = `${tableLabel(tableId)} placed ${itemCount} item${itemCount === 1 ? "" : "s"}.`;
  notice.classList.remove("hidden");
  document.querySelector("#beep").play().catch(() => {});
  window.clearTimeout(showNotification.timer);
  showNotification.timer = window.setTimeout(() => notice.classList.add("hidden"), 3200);
}

function placeOrder() {
  const lines = cartLines();
  if (!lines.length) return;

  const session = state.sessions[state.activeTable];
  session.status = "active";
  session.billRequested = false;
  session.orders.push({
    id: `ORD-${session.orders.length + 1}`,
    createdAt: new Date(),
    items: lines.map((line) => ({
      id: line.id,
      name: line.name,
      price: line.price,
      category: line.category,
      qty: line.qty,
    })),
  });
  state.carts[state.activeTable] = {};
  state.dashboardTable = state.activeTable;
  showNotification(state.activeTable, lines.reduce((sum, line) => sum + line.qty, 0));
  renderAll();
}

function requestBill() {
  const session = state.sessions[state.activeTable];
  if (session.status === "idle") return;
  session.billRequested = true;
  state.dashboardTable = state.activeTable;
  renderAll();
  showNotification(state.activeTable, sessionLines(session).reduce((sum, line) => sum + line.qty, 0));
}

function closeTable() {
  const session = state.sessions[state.dashboardTable];
  const lines = sessionLines(session);
  if (!lines.length) return;

  const total = totals(lines);
  state.invoices.unshift({
    id: `INV-${String(state.invoices.length + 1).padStart(3, "0")}`,
    tableId: state.dashboardTable,
    items: lines.reduce((sum, line) => sum + line.qty, 0),
    total: total.grand,
    closedAt: new Date(),
  });
  state.sessions[state.dashboardTable] = createSession(state.dashboardTable);
  state.carts[state.dashboardTable] = {};
  renderAll();
}

function addTable() {
  const tableId = nextTableId();
  ensureTable(tableId);
  state.activeTable = tableId;
  state.dashboardTable = tableId;
  renderAll();
}

function setTableCount(event) {
  event.preventDefault();
  const requestedCount = Math.max(1, Math.min(200, Math.floor(Number(document.querySelector("#table-count-input").value))));
  if (!Number.isFinite(requestedCount)) return;

  const keepers = state.tableIds.filter((tableId) => {
    const session = state.sessions[tableId];
    const hasOrders = session.orders.length > 0 || session.billRequested;
    const hasCart = Object.values(state.carts[tableId] || {}).some((qty) => qty > 0);
    return tableNumber(tableId) <= requestedCount || hasOrders || hasCart;
  });

  for (let index = 1; index <= requestedCount; index += 1) {
    ensureTable(`T${index}`);
  }

  state.tableIds = Array.from(new Set([...keepers, ...state.tableIds.filter((tableId) => tableNumber(tableId) <= requestedCount)]))
    .sort((a, b) => tableNumber(a) - tableNumber(b));

  if (!state.tableIds.includes(state.activeTable)) state.activeTable = state.tableIds[0];
  if (!state.tableIds.includes(state.dashboardTable)) state.dashboardTable = state.activeTable;
  renderAll();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.table) {
    state.activeTable = target.dataset.table;
    renderAll();
  }

  if (target.dataset.category) {
    state.category = target.dataset.category;
    renderAll();
  }

  if (target.dataset.add || target.dataset.inc) {
    const id = target.dataset.add || target.dataset.inc;
    const item = getItem(id);
    if (item && item.available) {
      state.carts[state.activeTable][id] = (state.carts[state.activeTable][id] || 0) + 1;
      renderAll();
    }
  }

  if (target.dataset.dec) {
    const id = target.dataset.dec;
    state.carts[state.activeTable][id] = Math.max((state.carts[state.activeTable][id] || 0) - 1, 0);
    renderAll();
  }

  if (target.dataset.viewTable) {
    state.dashboardTable = target.dataset.viewTable;
    renderAll();
  }

  if (target.dataset.editMenu) {
    editMenuItem(target.dataset.editMenu);
  }

  if (target.dataset.toggleMenu) {
    toggleMenuItem(target.dataset.toggleMenu);
  }

  if (target.dataset.deleteMenu) {
    deleteMenuItem(target.dataset.deleteMenu);
  }
});

document.querySelector("#place-order-btn").addEventListener("click", placeOrder);
document.querySelector("#request-bill-btn").addEventListener("click", requestBill);
document.querySelector("#close-table-btn").addEventListener("click", closeTable);
document.querySelector("#menu-form").addEventListener("submit", saveMenuItem);
document.querySelector("#table-count-form").addEventListener("submit", setTableCount);
document.querySelector("#add-table-btn").addEventListener("click", addTable);
document.querySelector("#cancel-menu-edit-btn").addEventListener("click", () => {
  resetMenuForm();
  renderAll();
});

renderAll();
