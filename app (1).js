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
const restaurantId = resolveRestaurantId();
const state = {
  dashboardTable: "T1",
  editingMenuId: null,
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
  auth: null,
  authModule: null,
  firestoreModule: null,
  db: null,
};

document.body.classList.add("auth-locked");

// ─── Auth tab switching ──────────────────────────────────────────────────────
document.querySelector("#tab-login").addEventListener("click", () => {
  document.querySelector("#tab-login").classList.add("active");
  document.querySelector("#tab-register").classList.remove("active");
  document.querySelector("#login-form").classList.remove("hidden");
  document.querySelector("#register-form").classList.add("hidden");
});
document.querySelector("#tab-register").addEventListener("click", () => {
  document.querySelector("#tab-register").classList.add("active");
  document.querySelector("#tab-login").classList.remove("active");
  document.querySelector("#register-form").classList.remove("hidden");
  document.querySelector("#login-form").classList.add("hidden");
});

// ─── Core helpers ────────────────────────────────────────────────────────────
function createSession(tableId) {
  return { tableId, status: "idle", orders: [], billRequested: false, openedAt: new Date() };
}

function resolveRestaurantId() {
  const fromUrl = params.get("restaurant");
  const fallback = window.SMARTSERVE_RESTAURANT_ID || "demo-restaurant";
  return slugify(fromUrl || fallback);
}

function money(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function slugify(value) {
  const slug = String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "demo-restaurant";
}

function uniqueMenuId(name) {
  const base = slugify(name);
  let id = base;
  let index = 2;
  while (menu.some((item) => item.id === id)) { id = `${base}-${index}`; index += 1; }
  return id;
}

function tableNumber(tableId) { return Number(tableId.replace(/\D/g, "")); }
function tableLabel(tableId) { return `Table ${tableNumber(tableId)}`; }

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

function customerUrl(tableId) {
  const url = new URL("customer.html", window.location.href);
  url.searchParams.set("restaurant", restaurantId);
  url.searchParams.set("table", tableId);
  return url.href;
}

function qrUrl(tableId, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(customerUrl(tableId))}`;
}

function getItem(id) { return menu.find((item) => item.id === id); }

function sessionLines(session) {
  const merged = {};
  session.orders.flatMap((order) => order.items).forEach((line) => {
    if (!merged[line.id]) merged[line.id] = { ...line, qty: 0 };
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

function updateSyncStatus(text) {
  document.querySelector("#sync-status").textContent = text;
}

function updateLoginMessage(text, isError = false) {
  const message = document.querySelector("#login-message");
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function updateRegisterMessage(text, isError = false) {
  const message = document.querySelector("#register-message");
  message.textContent = text;
  message.classList.toggle("error", isError);
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
    dashboardTable: state.dashboardTable,
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
  menu.splice(0, menu.length, ...(Array.isArray(data.menu) ? data.menu : menu));
  state.tableIds = Array.isArray(data.tableIds) && data.tableIds.length ? data.tableIds : state.tableIds;
  state.dashboardTable = data.dashboardTable || state.tableIds[0] || "T1";
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
  state.tableIds.forEach(ensureTable);
  if (!state.tableIds.includes(state.dashboardTable)) state.dashboardTable = state.tableIds[0];
  resetMenuForm();
  renderAll();
  sync.applyingRemote = false;
}

function scheduleSave() {
  if (!sync.enabled || !sync.loaded || sync.applyingRemote || !sync.stateDoc) return;
  updateSyncStatus("Saving...");
  window.clearTimeout(sync.saveTimer);
  sync.saveTimer = window.setTimeout(saveToFirebase, 450);
}

async function saveToFirebase() {
  try {
    await sync.setDoc(sync.stateDoc, serializeState(), { merge: true });
    updateSyncStatus("Firebase saved");
  } catch (error) {
    console.error("Firebase save failed", error);
    updateSyncStatus("Firebase save failed");
  }
}

function renderAndSave() {
  renderAll();
  scheduleSave();
}

// ─── Firebase connect ────────────────────────────────────────────────────────
async function connectFirebase() {
  if (!firebaseConfigIsReady()) {
    document.body.classList.remove("auth-locked");
    document.body.classList.add("auth-ready");
    updateSyncStatus("Local prototype");
    sync.loaded = true;
    return;
  }

  updateLoginMessage("Connecting Firebase...");
  try {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${firebaseModuleVersion}/firebase-app.js`);
    const authModule = await import(`https://www.gstatic.com/firebasejs/${firebaseModuleVersion}/firebase-auth.js`);
    const firestoreModule = await import(`https://www.gstatic.com/firebasejs/${firebaseModuleVersion}/firebase-firestore.js`);

    const app = appModule.initializeApp(window.SMARTSERVE_FIREBASE_CONFIG);
    const auth = authModule.getAuth(app);
    const db = firestoreModule.getFirestore(app);

    sync.enabled = true;
    sync.auth = auth;
    sync.authModule = authModule;
    sync.firestoreModule = firestoreModule;
    sync.db = db;
    sync.setDoc = firestoreModule.setDoc;
    sync.stateDoc = firestoreModule.doc(db, "restaurants", restaurantId, "smartserve", "state");

    updateLoginMessage("Ready. Please sign in.");

    authModule.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        document.body.classList.add("auth-locked");
        document.body.classList.remove("auth-ready");
        updateLoginMessage("Use your staff account to sign in.");
        updateSyncStatus("Signed out");
        return;
      }

      // Verify staff document exists for this restaurant
      const staffDoc = firestoreModule.doc(db, "restaurants", restaurantId, "staff", user.uid);
      const staffSnap = await firestoreModule.getDoc(staffDoc);
      if (!staffSnap.exists()) {
        await authModule.signOut(auth);
        updateLoginMessage("This account has no access to this restaurant.", true);
        return;
      }

      document.body.classList.remove("auth-locked");
      document.body.classList.add("auth-ready");
      await loadDashboardState(firestoreModule, db);
    });
  } catch (error) {
    console.error("Firebase setup failed", error);
    updateLoginMessage("Firebase setup failed. Check firebase-config.js.", true);
    updateSyncStatus("Firebase setup failed");
    sync.loaded = true;
  }
}

async function loadDashboardState(firestoreModule, db) {
  updateSyncStatus("Connecting Firebase...");
  const existing = await firestoreModule.getDoc(sync.stateDoc);
  if (existing.exists()) {
    applyRemoteState(existing.data());
  } else {
    await sync.setDoc(sync.stateDoc, serializeState(), { merge: true });
  }

  sync.loaded = true;
  updateSyncStatus("Firebase live");
  updateLoginMessage("Signed in.");

  // Listen for dashboard state changes
  firestoreModule.onSnapshot(sync.stateDoc, (snapshot) => {
    if (!snapshot.exists()) return;
    applyRemoteState(snapshot.data());
    updateSyncStatus("Firebase live");
  }, (error) => {
    console.error("Firebase realtime sync failed", error);
    updateSyncStatus("Firebase offline");
  });

  // ── Listen for incoming customer orders (from separate orders collection) ──
  const ordersCol = firestoreModule.collection(db, "restaurants", restaurantId, "orders");
  const pendingQuery = firestoreModule.query(ordersCol, firestoreModule.where("status", "==", "pending"));

  firestoreModule.onSnapshot(pendingQuery, async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type !== "added") return;
      const orderData = change.doc.data();
      const { tableId, items, billRequested } = orderData;

      if (!tableId) return;
      ensureTable(tableId);

      if (billRequested) {
        // Customer pressed "Request Bill"
        state.sessions[tableId].status = "active";
        state.sessions[tableId].billRequested = true;
      } else if (items && items.length) {
        // Customer placed an order
        const session = state.sessions[tableId];
        session.status = "active";
        session.billRequested = false;
        session.orders.push({
          id: `ORD-${session.orders.length + 1}`,
          createdAt: new Date(),
          items,
        });
        showNotification(tableId, items.reduce((sum, item) => sum + item.qty, 0));
      }

      // Mark order as processed so it doesn't re-trigger
      try {
        await firestoreModule.updateDoc(change.doc.ref, { status: "processed" });
      } catch (e) {
        console.error("Could not mark order processed", e);
      }

      renderAndSave();
    });
  }, (error) => {
    console.error("Orders listener failed", error);
  });
}

// ─── Register handler ────────────────────────────────────────────────────────
document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sync.auth || !sync.authModule || !sync.firestoreModule || !sync.db) {
    updateRegisterMessage("Firebase not connected yet. Please wait.", true);
    return;
  }

  const restaurantName = document.querySelector("#reg-restaurant").value.trim();
  const ownerName = document.querySelector("#reg-name").value.trim();
  const email = document.querySelector("#reg-email").value.trim();
  const password = document.querySelector("#reg-password").value;

  if (!restaurantName || !ownerName) {
    updateRegisterMessage("Please fill in all fields.", true);
    return;
  }

  const newRestaurantId = slugify(restaurantName);
  updateRegisterMessage("Creating account...");

  try {
    // Create Firebase Auth user
    const credential = await sync.authModule.createUserWithEmailAndPassword(sync.auth, email, password);
    const uid = credential.user.uid;

    // Save staff document under their restaurant
    const staffDocRef = sync.firestoreModule.doc(
      sync.db,
      "restaurants",
      newRestaurantId,
      "staff",
      uid
    );
    await sync.firestoreModule.setDoc(staffDocRef, {
      role: "owner",
      name: ownerName,
      email,
      restaurantId: newRestaurantId,
      createdAt: new Date().toISOString(),
    });

    // Redirect to their restaurant dashboard
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("restaurant", newRestaurantId);
    window.location.href = newUrl.href;

  } catch (error) {
    console.error("Registration failed", error);
    const messages = {
      "auth/email-already-in-use": "This email is already registered. Please sign in.",
      "auth/invalid-email": "Invalid email address.",
      "auth/weak-password": "Password must be at least 6 characters.",
    };
    updateRegisterMessage(messages[error.code] || `Registration failed: ${error.message}`, true);
  }
});

// ─── Login handler ───────────────────────────────────────────────────────────
document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sync.auth || !sync.authModule) return;
  const email = document.querySelector("#staff-email").value.trim();
  const password = document.querySelector("#staff-password").value;
  updateLoginMessage("Signing in...");
  try {
    await sync.authModule.signInWithEmailAndPassword(sync.auth, email, password);
  } catch (error) {
    console.error("Staff login failed", error);
    const messages = {
      "auth/user-not-found": "No account found with this email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Invalid email or password.",
    };
    updateLoginMessage(messages[error.code] || "Login failed. Check email and password.", true);
  }
});

document.querySelector("#logout-btn").addEventListener("click", async () => {
  if (sync.authModule && sync.auth) await sync.authModule.signOut(sync.auth);
});

// ─── Render functions ────────────────────────────────────────────────────────
function renderDashboard() {
  document.querySelector("#restaurant-id-label").textContent = restaurantId;
  document.querySelector("#active-table-label").textContent = tableLabel(state.dashboardTable);
  document.querySelector("#open-session-count").textContent = Object.values(state.sessions).filter((s) => s.status !== "idle").length;
  document.querySelector("#invoice-count").textContent = state.invoices.length;
  document.querySelector("#table-count-input").value = state.tableIds.length;
  document.querySelector("#customer-preview-link").href = customerUrl(state.dashboardTable);

  const activeOrders = Object.values(state.sessions).reduce((sum, s) => sum + s.orders.length, 0);
  document.querySelector("#active-orders-count").textContent = `${activeOrders} active order${activeOrders === 1 ? "" : "s"}`;

  document.querySelector("#table-cards").innerHTML = state.tableIds.map((tableId) => {
    const session = state.sessions[tableId];
    const lines = sessionLines(session);
    const amount = totals(lines).grand;
    const statusText = session.billRequested ? "Bill requested" : session.status === "idle" ? "Fresh" : "Serving";
    const badgeClass = session.billRequested ? "bill" : session.status === "idle" ? "idle" : "";
    return `
      <article class="table-card ${state.dashboardTable === tableId ? "selected" : ""} ${session.billRequested ? "requested" : ""} ${session.status === "idle" ? "closed" : ""}">
        <button class="table-select" data-view-table="${tableId}">
          <span>
            <strong>${tableLabel(tableId)}</strong>
            <small>${lines.reduce((sum, line) => sum + line.qty, 0)} items · ${money(amount)}</small>
          </span>
          <span class="status-badge ${badgeClass}">${statusText}</span>
        </button>
        <img class="qr-image" src="${qrUrl(tableId, 180)}" alt="QR code for ${tableLabel(tableId)}" />
        <div class="qr-actions">
          <a href="${customerUrl(tableId)}" target="_blank" rel="noopener">Open Menu</a>
          <a href="${qrUrl(tableId, 420)}" target="_blank" rel="noopener">Print QR</a>
        </div>
      </article>
    `;
  }).join("");
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
  document.querySelector("#menu-editor-list").innerHTML = menu.map((item) => `
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

function renderHistory() {
  const history = document.querySelector("#invoice-history");
  if (!state.invoices.length) {
    history.className = "invoice-history empty";
    history.textContent = "No closed tables yet.";
    return;
  }
  history.className = "invoice-history";
  history.innerHTML = state.invoices.map((invoice) => {
    // Support old invoices that only have `items` count (no lines array)
    const hasLines = Array.isArray(invoice.lines) && invoice.lines.length;
    const itemCount = invoice.itemCount ?? invoice.items ?? 0;
    const subtotal = invoice.subtotal ?? invoice.total;
    const service = invoice.service ?? 0;
    const tax = invoice.tax ?? 0;

    const lineRows = hasLines ? invoice.lines.map((line) => `
      <div class="inv-line">
        <span>${line.qty} × ${escapeHtml(line.name)}</span>
        <span>${money(line.qty * line.price)}</span>
      </div>
    `).join("") : "";

    const breakdown = hasLines ? `
      <div class="inv-breakdown">
        ${lineRows}
        <div class="inv-sep"></div>
        <div class="inv-line muted"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="inv-line muted"><span>Service 4%</span><span>${money(service)}</span></div>
        <div class="inv-line muted"><span>GST 5%</span><span>${money(tax)}</span></div>
        <div class="inv-line grand"><span>Grand Total</span><span>${money(invoice.total)}</span></div>
      </div>
    ` : "";

    return `
      <div class="history-invoice">
        <button class="history-summary" data-toggle-invoice="${invoice.id}" type="button">
          <div class="history-summary-left">
            <strong>${invoice.id}</strong>
            <span class="history-meta">${tableLabel(invoice.tableId)} · ${itemCount} item${itemCount === 1 ? "" : "s"} · ${invoice.closedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div class="history-summary-right">
            <strong>${money(invoice.total)}</strong>
            <span class="inv-chevron">▾</span>
          </div>
        </button>
        ${breakdown}
      </div>
    `;
  }).join("");
}

function renderAll() {
  renderDashboard();
  renderBill();
  renderMenuEditor();
  renderHistory();
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
    if (item) Object.assign(item, { name, price: Math.round(price), category, desc, available });
  } else {
    menu.push({ id: uniqueMenuId(name), name, price: Math.round(price), category, desc, available });
  }

  resetMenuForm();
  renderAndSave();
}

function toggleMenuItem(id) {
  const item = getItem(id);
  if (!item) return;
  item.available = !item.available;
  Object.values(state.carts).forEach((cart) => { if (!item.available) delete cart[id]; });
  renderAndSave();
}

function deleteMenuItem(id) {
  const index = menu.findIndex((item) => item.id === id);
  if (index === -1) return;
  menu.splice(index, 1);
  Object.values(state.carts).forEach((cart) => delete cart[id]);
  if (state.editingMenuId === id) resetMenuForm();
  renderAndSave();
}

function closeTable() {
  const session = state.sessions[state.dashboardTable];
  const lines = sessionLines(session);
  if (!lines.length) return;

  const total = totals(lines);
  state.invoices.unshift({
    id: `INV-${String(state.invoices.length + 1).padStart(3, "0")}`,
    tableId: state.dashboardTable,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    lines: lines.map((line) => ({ id: line.id, name: line.name, price: line.price, qty: line.qty })),
    subtotal: total.subtotal,
    service: total.service,
    tax: total.tax,
    total: total.grand,
    closedAt: new Date(),
  });
  state.sessions[state.dashboardTable] = createSession(state.dashboardTable);
  state.carts[state.dashboardTable] = {};
  renderAndSave();
}

function addTable() {
  const tableId = nextTableId();
  ensureTable(tableId);
  state.dashboardTable = tableId;
  renderAndSave();
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

  for (let i = 1; i <= requestedCount; i++) ensureTable(`T${i}`);
  state.tableIds = Array.from(new Set([...keepers, ...state.tableIds.filter((t) => tableNumber(t) <= requestedCount)]))
    .sort((a, b) => tableNumber(a) - tableNumber(b));
  if (!state.tableIds.includes(state.dashboardTable)) state.dashboardTable = state.tableIds[0];
  renderAndSave();
}

function showNotification(tableId, itemCount) {
  const notice = document.querySelector("#notification");
  document.querySelector("#notification-text").textContent = `${tableLabel(tableId)} placed ${itemCount} item${itemCount === 1 ? "" : "s"}.`;
  notice.classList.remove("hidden");
  document.querySelector("#beep").play().catch(() => {});
  window.clearTimeout(showNotification.timer);
  showNotification.timer = window.setTimeout(() => notice.classList.add("hidden"), 3200);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.viewTable) { state.dashboardTable = target.dataset.viewTable; renderAndSave(); }
  if (target.dataset.editMenu) editMenuItem(target.dataset.editMenu);
  if (target.dataset.toggleMenu) toggleMenuItem(target.dataset.toggleMenu);
  if (target.dataset.deleteMenu) deleteMenuItem(target.dataset.deleteMenu);

  // Expand / collapse invoice breakdown
  if (target.dataset.toggleInvoice) {
    const invoiceEl = target.closest(".history-invoice");
    if (invoiceEl) invoiceEl.classList.toggle("expanded");
  }
});

document.querySelector("#menu-form").addEventListener("submit", saveMenuItem);
document.querySelector("#table-count-form").addEventListener("submit", setTableCount);
document.querySelector("#add-table-btn").addEventListener("click", addTable);
document.querySelector("#close-table-btn").addEventListener("click", closeTable);
document.querySelector("#cancel-menu-edit-btn").addEventListener("click", () => { resetMenuForm(); renderAll(); });

renderAll();
connectFirebase();
