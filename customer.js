const taxRate = 0.05;
const serviceRate = 0.04;
const firebaseModuleVersion = "10.12.5";

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
const params = new URLSearchParams(window.location.search);
const tableIdFromUrl = params.get("table") || "T1";

const state = {
  activeTable: tableIdFromUrl,
  category: "popular",
  tableIds: [...initialTableIds],
  carts: Object.fromEntries(initialTableIds.map((id) => [id, {}])),
  sessions: Object.fromEntries(initialTableIds.map((id) => [id, createSession(id)])),
  invoices: [],
};

const sync = {
  enabled: false,
  loaded: false,
  applyingRemote: false,
  saveTimer: null,
  stateDoc: null,
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

function getItem(id) {
  return menu.find((item) => item.id === id);
}

function cartLines() {
  return Object.entries(state.carts[state.activeTable] || {})
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ ...getItem(id), qty }))
    .filter((line) => line.id);
}

function sessionLines(session) {
  const merged = {};
  session.orders.flatMap((order) => order.items).forEach((line) => {
    if (!merged[line.id]) merged[line.id] = { ...line, qty: 0 };
    merged[line.id].qty += line.qty;
  });
  return Object.values(merged);
}

function updateSyncStatus(text) {
  document.querySelector("#sync-status").textContent = text;
}

function firebaseConfigIsReady() {
  const config = window.SMARTSERVE_FIREBASE_CONFIG;
  return Boolean(config && config.apiKey && config.projectId && !config.apiKey.includes("PASTE_"));
}

function cloneDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function serializeState() {
  return {
    version: 2,
    menu,
    tableIds: state.tableIds,
    dashboardTable: state.activeTable,
    carts: state.carts,
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([tableId, session]) => [
      tableId,
      {
        ...session,
        openedAt: cloneDate(session.openedAt).toISOString(),
        orders: session.orders.map((order) => ({ ...order, createdAt: cloneDate(order.createdAt).toISOString() })),
      },
    ])),
    invoices: state.invoices.map((invoice) => ({ ...invoice, closedAt: cloneDate(invoice.closedAt).toISOString() })),
    updatedAt: new Date().toISOString(),
  };
}

function applyRemoteState(data) {
  if (!data) return;
  sync.applyingRemote = true;
  menu.splice(0, menu.length, ...(Array.isArray(data.menu) ? data.menu : []));
  state.tableIds = Array.isArray(data.tableIds) && data.tableIds.length ? data.tableIds : state.tableIds;
  state.carts = data.carts || {};
  state.sessions = Object.fromEntries(Object.entries(data.sessions || {}).map(([tableId, session]) => [
    tableId,
    {
      ...createSession(tableId),
      ...session,
      openedAt: cloneDate(session.openedAt),
      orders: (session.orders || []).map((order) => ({ ...order, createdAt: cloneDate(order.createdAt) })),
    },
  ]));
  state.invoices = (data.invoices || []).map((invoice) => ({ ...invoice, closedAt: cloneDate(invoice.closedAt) }));
  ensureTable(state.activeTable);
  renderAll();
  sync.applyingRemote = false;
}

function scheduleSave() {
  if (!sync.enabled || !sync.loaded || sync.applyingRemote || !sync.stateDoc) return;
  updateSyncStatus("Saving...");
  window.clearTimeout(sync.saveTimer);
  sync.saveTimer = window.setTimeout(saveToFirebase, 350);
}

async function saveToFirebase() {
  try {
    await sync.setDoc(sync.stateDoc, serializeState(), { merge: true });
    updateSyncStatus("Firebase live");
  } catch (error) {
    console.error("Firebase save failed", error);
    updateSyncStatus("Save failed");
  }
}

function renderAndSave() {
  renderAll();
  scheduleSave();
}

async function connectFirebase() {
  if (!firebaseConfigIsReady()) {
    updateSyncStatus("Local menu");
    sync.loaded = true;
    renderAll();
    return;
  }

  updateSyncStatus("Connecting...");
  try {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${firebaseModuleVersion}/firebase-app.js`);
    const firestoreModule = await import(`https://www.gstatic.com/firebasejs/${firebaseModuleVersion}/firebase-firestore.js`);
    const app = appModule.initializeApp(window.SMARTSERVE_FIREBASE_CONFIG);
    const db = firestoreModule.getFirestore(app);
    const restaurantId = window.SMARTSERVE_RESTAURANT_ID || "demo-restaurant";

    sync.enabled = true;
    sync.setDoc = firestoreModule.setDoc;
    sync.stateDoc = firestoreModule.doc(db, "restaurants", restaurantId, "smartserve", "state");

    const existing = await firestoreModule.getDoc(sync.stateDoc);
    if (existing.exists()) applyRemoteState(existing.data());
    sync.loaded = true;
    updateSyncStatus("Firebase live");

    firestoreModule.onSnapshot(sync.stateDoc, (snapshot) => {
      if (!snapshot.exists()) return;
      applyRemoteState(snapshot.data());
      updateSyncStatus("Firebase live");
    }, (error) => {
      console.error("Firebase realtime sync failed", error);
      updateSyncStatus("Offline");
    });
  } catch (error) {
    console.error("Firebase setup failed", error);
    updateSyncStatus("Setup failed");
    sync.loaded = true;
  }
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

function renderTabs() {
  document.querySelectorAll(".category-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === state.category);
  });
}

function renderAll() {
  document.querySelector("#customer-table-title").textContent = tableLabel(state.activeTable);
  renderTabs();
  renderMenu();
  renderCart();
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
  renderAndSave();
}

function requestBill() {
  const session = state.sessions[state.activeTable];
  if (session.status === "idle") return;
  session.billRequested = true;
  renderAndSave();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.category) {
    state.category = target.dataset.category;
    renderAll();
  }

  if (target.dataset.add || target.dataset.inc) {
    const id = target.dataset.add || target.dataset.inc;
    const item = getItem(id);
    if (item && item.available) {
      state.carts[state.activeTable][id] = (state.carts[state.activeTable][id] || 0) + 1;
      renderAndSave();
    }
  }

  if (target.dataset.dec) {
    const id = target.dataset.dec;
    state.carts[state.activeTable][id] = Math.max((state.carts[state.activeTable][id] || 0) - 1, 0);
    renderAndSave();
  }
});

ensureTable(state.activeTable);
document.querySelector("#place-order-btn").addEventListener("click", placeOrder);
document.querySelector("#request-bill-btn").addEventListener("click", requestBill);
renderAll();
connectFirebase();
