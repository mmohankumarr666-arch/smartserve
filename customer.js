const taxRate = 0.05;
const serviceRate = 0.04;
const firebaseModuleVersion = "10.12.5";

// ─── Menu (loaded from Firebase state, falling back to this default) ──────────
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
const tableIdFromUrl = params.get("table") || "T1";

const state = {
  activeTable: tableIdFromUrl,
  category: "popular",
  tableIds: [...initialTableIds],
  // Customer cart is LOCAL only — never written to Firestore state doc
  cart: {},
};

// sync holds Firebase references for reading menu and writing orders
const sync = {
  enabled: false,
  loaded: false,
  addDoc: null,
  collection: null,
  db: null,
  ordersCol: null,
  stateDoc: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(value) {
  const slug = String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "demo-restaurant";
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

function tableNumber(tableId) { return Number(tableId.replace(/\D/g, "")); }
function tableLabel(tableId) { return `Table ${tableNumber(tableId)}`; }

function getItem(id) { return menu.find((item) => item.id === id); }

function cartLines() {
  return Object.entries(state.cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ ...getItem(id), qty }))
    .filter((line) => line.id);
}

function cloneDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function updateSyncStatus(text) {
  document.querySelector("#sync-status").textContent = text;
}

function firebaseConfigIsReady() {
  const config = window.SMARTSERVE_FIREBASE_CONFIG;
  return Boolean(config && config.apiKey && config.projectId && !config.apiKey.includes("PASTE_"));
}

// ─── Firebase ─────────────────────────────────────────────────────────────────
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

    sync.enabled = true;
    sync.db = db;
    sync.addDoc = firestoreModule.addDoc;
    sync.collection = firestoreModule.collection;
    sync.ordersCol = firestoreModule.collection(db, "restaurants", restaurantId, "orders");

    // Read-only: load menu + table list from the staff-managed state doc
    sync.stateDoc = firestoreModule.doc(db, "restaurants", restaurantId, "smartserve", "state");
    const existing = await firestoreModule.getDoc(sync.stateDoc);
    if (existing.exists()) {
      applyMenuFromState(existing.data());
    }

    sync.loaded = true;
    updateSyncStatus("Menu live");

    // Keep menu in sync if staff update it
    firestoreModule.onSnapshot(sync.stateDoc, (snapshot) => {
      if (!snapshot.exists()) return;
      applyMenuFromState(snapshot.data());
    }, (error) => {
      console.error("Menu sync failed", error);
      updateSyncStatus("Offline");
    });

  } catch (error) {
    console.error("Firebase setup failed", error);
    updateSyncStatus("Setup failed");
    sync.loaded = true;
    renderAll();
  }
}

// Apply only the menu data from the staff state doc (read-only for customer)
function applyMenuFromState(data) {
  if (!data) return;
  if (Array.isArray(data.menu) && data.menu.length) {
    menu.splice(0, menu.length, ...data.menu);
  }
  renderAll();
  updateSyncStatus("Menu live");
}

// ─── Customer actions ─────────────────────────────────────────────────────────
async function placeOrder() {
  const lines = cartLines();
  if (!lines.length) return;

  const orderItems = lines.map((line) => ({
    id: line.id,
    name: line.name,
    price: line.price,
    category: line.category,
    qty: line.qty,
  }));

  if (sync.enabled && sync.ordersCol) {
    try {
      // Write to the PUBLIC orders collection — not touching smartserve/state
      await sync.addDoc(sync.ordersCol, {
        tableId: state.activeTable,
        items: orderItems,
        billRequested: false,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      updateSyncStatus("Order sent!");
    } catch (error) {
      console.error("Order failed", error);
      updateSyncStatus("Order failed — try again");
      return;
    }
  }

  state.cart = {};
  renderAll();

  // Confirm message
  setTimeout(() => updateSyncStatus("Menu live"), 2000);
}

async function requestBill() {
  if (sync.enabled && sync.ordersCol) {
    try {
      await sync.addDoc(sync.ordersCol, {
        tableId: state.activeTable,
        items: [],
        billRequested: true,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      updateSyncStatus("Bill requested!");
      document.querySelector("#request-bill-btn").textContent = "Bill Requested ✓";
      document.querySelector("#request-bill-btn").disabled = true;
    } catch (error) {
      console.error("Bill request failed", error);
      updateSyncStatus("Request failed — try again");
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
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

// ─── Events ───────────────────────────────────────────────────────────────────
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
      state.cart[id] = (state.cart[id] || 0) + 1;
      renderAll();
    }
  }

  if (target.dataset.dec) {
    const id = target.dataset.dec;
    state.cart[id] = Math.max((state.cart[id] || 0) - 1, 0);
    renderAll();
  }
});

document.querySelector("#place-order-btn").addEventListener("click", placeOrder);
document.querySelector("#request-bill-btn").addEventListener("click", requestBill);
// Cart toggle
const cartToggleBtn = document.querySelector("#cart-toggle-btn");
const cartBody = document.querySelector("#cart-body");
const cartArrow = document.querySelector("#cart-arrow");
let cartOpen = false;

cartToggleBtn.addEventListener("click", () => {
  cartOpen = !cartOpen;
  cartBody.style.display = cartOpen ? "block" : "none";
  cartArrow.style.transform = cartOpen ? "rotate(180deg)" : "rotate(0deg)";
});
renderAll();
connectFirebase();
