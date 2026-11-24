import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

const runtime = globalThis.DOORDROP_ADMIN_CONFIG || {};
const firebaseOverrides = runtime.firebaseConfig || {};
const app = initializeApp({
  apiKey: firebaseOverrides.apiKey || runtime.firebaseApiKey || 'AIzaSyD97lPfGR0Yf0z-WfCl1L_rYH9HPlgE3s0',
  authDomain: firebaseOverrides.authDomain || 'efootball-app-9d175.firebaseapp.com',
  projectId: firebaseOverrides.projectId || 'efootball-app-9d175',
  storageBucket: firebaseOverrides.storageBucket || 'efootball-app-9d175.firebasestorage.app',
  messagingSenderId: firebaseOverrides.messagingSenderId || '729242246964',
  appId: firebaseOverrides.appId || '1:729242246964:web:bdb35a59a681a4a7420f61',
});

function createPortalAuth(firebaseApp) {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    if (String(error?.code || '') === 'auth/already-initialized') return getAuth(firebaseApp);
    throw error;
  }
}

const auth = createPortalAuth(app);
const db = getFirestore(app);

const STATUS_FLOW = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
const STATUS_LABEL = {
  received: 'Received',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const state = {
  authReady: false,
  user: null,
  restaurant: null,
  orders: [],
  menu: [],
  mode: 'login',
  authStep: 'phone',
  otpPhone: '',
  otpTicket: '',
  otpMasked: '',
  otpCooldown: 0,
  otpBypass: false,
  route: 'orders',
  orderTab: 'active',
  busy: false,
  unsubscribers: [],
};

function apiBase() {
  return (runtime.apiBaseUrl || 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api').replace(/\/+$/, '');
}

async function api(path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function show(el, on) {
  if (!el) return;
  el.classList.toggle('hidden', !on);
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return `TZS ${n.toLocaleString('en-TZ')}`;
}

function setAuthError(message) {
  const el = $('authError');
  if (!el) return;
  el.textContent = message || '';
  show(el, Boolean(message));
}

function setAuthMode(mode) {
  state.mode = mode === 'register' ? 'register' : 'login';
  state.authStep = 'phone';
  state.otpTicket = '';
  $('modeLogin')?.setAttribute('aria-selected', String(state.mode === 'login'));
  $('modeRegister')?.setAttribute('aria-selected', String(state.mode === 'register'));
  $('authTitle').textContent = state.mode === 'login' ? 'Login' : 'Register';
  $('authLead').textContent =
    state.mode === 'login' ? 'Restaurant dashboard.' : 'Phone, restaurant name, and location.';
  updateAuthSteps();
  setAuthError('');
}

function updateAuthSteps() {
  const step = state.authStep;
  show($('stepPhone'), step === 'phone');
  show($('stepOtp'), step === 'otp');
  show($('stepDetails'), step === 'details');
  const labels = {
    phone: 'Enter your phone number',
    otp: state.otpMasked ? `Code sent to ${state.otpMasked}` : 'Enter the SMS code',
    details: 'Restaurant details',
  };
  $('authStep').textContent = labels[step] || '';
  const submit = $('authSubmit');
  if (submit) {
    submit.textContent =
      step === 'phone' ? 'Send OTP' : step === 'otp' ? 'Verify' : state.busy ? 'Working…' : 'Create account';
    submit.disabled = state.busy;
  }
}

function openAuth(mode) {
  show($('landing'), false);
  show($('authCard'), true);
  setAuthMode(mode || 'login');
}

function closeAuth() {
  show($('authCard'), false);
  show($('landing'), true);
  setAuthError('');
}

function clearListeners() {
  for (const unsub of state.unsubscribers) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  state.unsubscribers = [];
}

function subscribeRestaurantData(restaurantId) {
  clearListeners();
  const ordersQ = query(
    collection(db, 'foodOrders'),
    where('restaurantId', '==', restaurantId),
    orderBy('createdAt', 'desc')
  );
  state.unsubscribers.push(
    onSnapshot(
      ordersQ,
      (snap) => {
        state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
      },
      async () => {
        // Fallback without orderBy if composite index missing
        const fallback = query(collection(db, 'foodOrders'), where('restaurantId', '==', restaurantId));
        state.unsubscribers.push(
          onSnapshot(fallback, (snap) => {
            state.orders = snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            render();
          })
        );
      }
    )
  );

  const menuQ = query(collection(db, 'menuItems'), where('restaurantId', '==', restaurantId));
  state.unsubscribers.push(
    onSnapshot(menuQ, (snap) => {
      state.menu = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    })
  );
}

async function loadRestaurant(uid) {
  const memberSnap = await getDoc(doc(db, 'restaurantMembers', uid));
  const restaurantId = memberSnap.exists()
    ? String(memberSnap.data()?.restaurantId || uid)
    : uid;
  const restSnap = await getDoc(doc(db, 'restaurants', restaurantId));
  if (!restSnap.exists()) {
    state.restaurant = null;
    return null;
  }
  state.restaurant = { id: restSnap.id, ...restSnap.data() };
  subscribeRestaurantData(restSnap.id);
  return state.restaurant;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (state.busy) return;
  setAuthError('');
  state.busy = true;
  updateAuthSteps();
  try {
    if (state.authStep === 'phone') {
      const phone = String($('authPhone')?.value || '').trim();
      if (!phone) throw new Error('Enter a valid phone number.');
      const purpose = state.mode === 'login' ? 'login' : 'signup';
      const payload = await api('/restaurant-auth/otp/send', { phone, purpose });
      state.otpPhone = phone;
      state.otpMasked = payload.phoneMasked || phone;
      state.otpBypass = Boolean(payload.otpBypass);
      state.otpCooldown = Number(payload.cooldownSeconds || 60);
      state.authStep = 'otp';
    } else if (state.authStep === 'otp') {
      const code = String($('authOtp')?.value || '').replace(/\D/g, '');
      if (code.length < 4) throw new Error('Enter the SMS code.');
      const verified = await api('/restaurant-auth/otp/verify', {
        phone: state.otpPhone,
        code,
      });
      state.otpTicket = verified.otpTicket;
      if (state.mode === 'login') {
        const login = await api('/restaurant-auth/otp/login', {
          phone: state.otpPhone,
          otpTicket: state.otpTicket,
        });
        await signInWithCustomToken(auth, login.customToken);
      } else {
        state.authStep = 'details';
      }
    } else if (state.authStep === 'details') {
      const restaurantName = String($('regRestaurantName')?.value || '').trim();
      const location = String($('regLocation')?.value || '').trim();
      if (restaurantName.length < 2) throw new Error('Enter restaurant name.');
      if (location.length < 2) throw new Error('Enter location.');
      const registered = await api('/restaurant-auth/otp/register', {
        phone: state.otpPhone,
        otpTicket: state.otpTicket,
        restaurantName,
        location,
        contactPerson: restaurantName,
      });
      await signInWithCustomToken(auth, registered.customToken);
    }
  } catch (error) {
    setAuthError(error.message || 'Something went wrong.');
  } finally {
    state.busy = false;
    updateAuthSteps();
  }
}

async function updateOrderStatus(orderId, status) {
  await updateDoc(doc(db, 'foodOrders', orderId), {
    status,
    updatedAt: serverTimestamp(),
    [`statusTimestamps.${status}`]: serverTimestamp(),
  });
}

async function addMenuItem(event) {
  event.preventDefault();
  if (!state.restaurant?.id) return;
  const form = event.currentTarget;
  const name = String(form.name.value || '').trim();
  const category = String(form.category.value || 'Food').trim() || 'Food';
  const price = Number(form.price.value);
  if (!name || !Number.isFinite(price) || price <= 0) {
    window.alert('Enter a name and valid price.');
    return;
  }
  await addDoc(collection(db, 'menuItems'), {
    restaurantId: state.restaurant.id,
    restaurantName: state.restaurant.restaurantName || state.restaurant.name || '',
    name,
    category,
    price,
    currency: 'TZS',
    available: true,
    emoji: '🍽️',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  form.reset();
}

async function toggleMenuItem(id, available) {
  await updateDoc(doc(db, 'menuItems', id), {
    available: !available,
    updatedAt: serverTimestamp(),
  });
}

function activeOrders() {
  return state.orders.filter((o) => !['delivered', 'cancelled'].includes(String(o.status || '')));
}

function filteredOrders() {
  if (state.orderTab === 'done') {
    return state.orders.filter((o) => ['delivered', 'cancelled'].includes(String(o.status || '')));
  }
  return activeOrders();
}

function nextStatus(current) {
  const idx = STATUS_FLOW.indexOf(String(current || 'received'));
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

function renderOrders() {
  const list = filteredOrders();
  const cards = list
    .map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const next = nextStatus(order.status);
      const badgeClass = String(order.status || 'received');
      return `
        <article class="order-card">
          <div class="order-card-top">
            <div>
              <h3>${escapeHtml(order.orderNumber || order.id)}</h3>
              <p class="muted">${escapeHtml(order.customerName || 'Customer')} · ${escapeHtml(order.customerPhone || '—')}</p>
              <p class="muted">${escapeHtml(order.customerAddress || order.deliveryLabel || '')}</p>
            </div>
            <span class="badge ${escapeHtml(badgeClass)}">${escapeHtml(STATUS_LABEL[order.status] || order.status || 'Received')}</span>
          </div>
          <ul class="order-items">
            ${items
              .map(
                (item) => `
              <li>
                <span>${escapeHtml(item.name)} × ${Number(item.quantity) || 1}</span>
                <span class="price">${formatMoney((Number(item.price) || 0) * (Number(item.quantity) || 1))}</span>
              </li>`
              )
              .join('')}
          </ul>
          <div class="order-card-top">
            <strong>${formatMoney(order.total)}</strong>
            <div class="order-actions">
              ${
                next
                  ? `<button class="btn small" type="button" data-status="${next}" data-order="${escapeHtml(order.id)}">Mark ${escapeHtml(STATUS_LABEL[next])}</button>`
                  : ''
              }
              ${
                !['delivered', 'cancelled'].includes(String(order.status || ''))
                  ? `<button class="btn small ghost" type="button" data-status="cancelled" data-order="${escapeHtml(order.id)}">Cancel</button>`
                  : ''
              }
            </div>
          </div>
        </article>`;
    })
    .join('');

  return `
    <div class="page-head">
      <div>
        <h1>Orders</h1>
        <p>Live food orders from the DoorDrop app.</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><strong>${activeOrders().length}</strong><span>Active</span></div>
      <div class="stat"><strong>${state.orders.filter((o) => o.status === 'preparing').length}</strong><span>Preparing</span></div>
      <div class="stat"><strong>${state.orders.filter((o) => o.status === 'ready').length}</strong><span>Ready</span></div>
      <div class="stat"><strong>${state.orders.filter((o) => o.status === 'delivered').length}</strong><span>Delivered</span></div>
    </div>
    <div class="tabs">
      <button type="button" class="tab ${state.orderTab === 'active' ? 'is-active' : ''}" data-order-tab="active">Active</button>
      <button type="button" class="tab ${state.orderTab === 'done' ? 'is-active' : ''}" data-order-tab="done">History</button>
    </div>
    <div class="card-list">
      ${cards || '<div class="empty">No orders yet. When customers order food in DoorDrop, they show up here.</div>'}
    </div>`;
}

function renderMenu() {
  const rows = state.menu
    .map(
      (item) => `
      <article class="menu-card">
        <div>
          <strong>${escapeHtml(item.emoji || '🍽️')} ${escapeHtml(item.name)}</strong>
          <p class="muted">${escapeHtml(item.category || 'Food')} · ${item.available === false ? 'Hidden' : 'Available'}</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="price">${formatMoney(item.price)}</span>
          <button class="btn small ghost" type="button" data-toggle-menu="${escapeHtml(item.id)}" data-available="${item.available === false ? '0' : '1'}">
            ${item.available === false ? 'Show' : 'Hide'}
          </button>
        </div>
      </article>`
    )
    .join('');

  return `
    <div class="page-head">
      <div>
        <h1>Menu</h1>
        <p>Items customers can order in DoorDrop.</p>
      </div>
    </div>
    <form class="menu-form" id="menuForm">
      <label>Name<input name="name" placeholder="e.g. Cheese Burger" required /></label>
      <label>Category<input name="category" placeholder="Burgers" /></label>
      <label>Price (TZS)<input name="price" type="number" min="500" step="500" placeholder="12000" required /></label>
      <button class="btn primary" type="submit">Add item</button>
    </form>
    <div class="card-list">
      ${rows || '<div class="empty">No menu items yet.</div>'}
    </div>`;
}

function renderProfile() {
  const r = state.restaurant || {};
  return `
    <div class="page-head">
      <div>
        <h1>Profile</h1>
        <p>Restaurant account details.</p>
      </div>
    </div>
    <div class="profile-card">
      <div class="profile-row"><span class="muted">Restaurant</span><strong>${escapeHtml(r.restaurantName || r.name || '—')}</strong></div>
      <div class="profile-row"><span class="muted">Location</span><strong>${escapeHtml(r.location || r.region || '—')}</strong></div>
      <div class="profile-row"><span class="muted">Phone</span><strong>${escapeHtml(r.notificationPhone || r.phone || '—')}</strong></div>
      <div class="profile-row"><span class="muted">Status</span><strong>${escapeHtml(r.status || 'active')}</strong></div>
      <div class="profile-row"><span class="muted">Restaurant ID</span><strong style="font-size:12px">${escapeHtml(r.id || '—')}</strong></div>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const publicEl = $('public');
  const appEl = $('app');
  const loggedIn = Boolean(state.user && state.restaurant);

  show(publicEl, !loggedIn);
  show(appEl, loggedIn);

  if (!loggedIn) {
    if (!state.authReady) return;
    return;
  }

  document.querySelectorAll('.side-link').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.route === state.route);
  });

  const main = $('mainView');
  if (!main) return;
  if (state.route === 'menu') main.innerHTML = renderMenu();
  else if (state.route === 'profile') main.innerHTML = renderProfile();
  else main.innerHTML = renderOrders();

  $('menuForm')?.addEventListener('submit', (event) => {
    void addMenuItem(event);
  });
}

function bindUi() {
  $('navRegister')?.addEventListener('click', () => openAuth('register'));
  $('heroCta')?.addEventListener('click', () => openAuth('register'));
  $('quietLogin')?.addEventListener('click', () => openAuth('login'));
  $('heroLogin')?.addEventListener('click', () => openAuth('login'));
  $('authBackHome')?.addEventListener('click', () => closeAuth());
  $('modeLogin')?.addEventListener('click', () => setAuthMode('login'));
  $('modeRegister')?.addEventListener('click', () => setAuthMode('register'));
  $('otpChangePhone')?.addEventListener('click', () => {
    state.authStep = 'phone';
    state.otpTicket = '';
    updateAuthSteps();
  });
  $('otpResend')?.addEventListener('click', async () => {
    try {
      setAuthError('');
      const purpose = state.mode === 'login' ? 'login' : 'signup';
      const payload = await api('/restaurant-auth/otp/send', { phone: state.otpPhone, purpose });
      state.otpMasked = payload.phoneMasked || state.otpPhone;
      state.otpBypass = Boolean(payload.otpBypass);
      $('authStep').textContent = `Code sent to ${state.otpMasked}`;
    } catch (error) {
      setAuthError(error.message || 'Could not resend.');
    }
  });
  $('authForm')?.addEventListener('submit', (event) => {
    void handleAuthSubmit(event);
  });
  $('logoutBtn')?.addEventListener('click', async () => {
    clearListeners();
    state.restaurant = null;
    state.orders = [];
    state.menu = [];
    await signOut(auth);
  });

  document.querySelectorAll('.side-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.route = btn.dataset.route || 'orders';
      render();
    });
  });

  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[data-order-tab]');
    if (tab) {
      state.orderTab = tab.dataset.orderTab || 'active';
      render();
      return;
    }
    const statusBtn = event.target.closest?.('[data-status][data-order]');
    if (statusBtn) {
      void updateOrderStatus(statusBtn.dataset.order, statusBtn.dataset.status);
      return;
    }
    const toggle = event.target.closest?.('[data-toggle-menu]');
    if (toggle) {
      void toggleMenuItem(toggle.dataset.toggleMenu, toggle.dataset.available === '1');
    }
  });

  document.querySelectorAll('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-scroll');
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.authReady = true;
  if (!user) {
    clearListeners();
    state.restaurant = null;
    state.orders = [];
    state.menu = [];
    show($('landing'), true);
    show($('authCard'), false);
    render();
    return;
  }
  try {
    await loadRestaurant(user.uid);
    show($('authCard'), false);
  } catch (error) {
    console.warn('restaurant load failed', error);
    state.restaurant = null;
  }
  render();
});

bindUi();
setAuthMode('login');
render();
