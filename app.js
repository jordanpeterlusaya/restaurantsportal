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

const HAUL_BRAND_JUICE_TAG = 'haul_juice';
const HAUL_JUICE_PRESETS = [
  {
    key: 'embe',
    name: 'HAUL Juice Embe',
    category: 'Vinywaji · HAUL',
    price: 2500,
    emoji: '🥭',
    sizeLabel: 'Ndogo',
    flavor: 'embe',
    benefitLine: 'Baridi · embe asili',
    description: 'HAUL mango juice — cold, natural mango flavor.',
  },
  {
    key: 'paseni',
    name: 'HAUL Juice Paseni',
    category: 'Vinywaji · HAUL',
    price: 3500,
    emoji: '🧃',
    sizeLabel: 'Kati',
    flavor: 'paseni',
    benefitLine: 'Paseni safi · inafaa na chakula',
    description: 'HAUL passion juice — made to pair with meals.',
  },
  {
    key: 'nanasi',
    name: 'HAUL Juice Nanasi',
    category: 'Vinywaji · HAUL',
    price: 4500,
    emoji: '🍍',
    sizeLabel: 'Kubwa',
    flavor: 'nanasi',
    benefitLine: 'Kubwa · baridi kwa mlo mzito',
    description: 'HAUL pineapple juice — large cold serve.',
  },
];

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
  menuBusy: false,
  pendingImage: null,
  editingId: null,
  unsubscribers: [],
};

function apiBase() {
  return (runtime.apiBaseUrl || 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api').replace(/\/+$/, '');
}

async function api(path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`${apiBase()}${path}`, {
    method: options.method || 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body || {}),
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file, maxEdge = 1280, quality = 0.82) {
  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image.'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const contentType = 'image/jpeg';
  const compressed = canvas.toDataURL(contentType, quality);
  return { dataUrl: compressed, contentType, previewUrl: compressed };
}

async function uploadMenuImage(file) {
  if (!state.user || !state.restaurant?.id) {
    throw new Error('Sign in before uploading photos.');
  }
  const prepared = await compressImageFile(file);
  const idToken = await state.user.getIdToken();
  try {
    const payload = await api(
      '/media/restaurant-menu',
      {
        imageBase64: prepared.dataUrl,
        contentType: prepared.contentType,
        restaurantId: state.restaurant.id,
      },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );
    if (payload.downloadURL) {
      return { imageUrl: payload.downloadURL, localPreview: prepared.previewUrl };
    }
  } catch (error) {
    // Fallback: keep a compressed data URL so the dish still has a real owner photo.
    if (prepared.dataUrl.length > 900_000) {
      throw new Error(error.message || 'Image upload failed. Try a smaller photo.');
    }
    console.warn('menu image API upload failed; using compressed data URL', error);
    return { imageUrl: prepared.dataUrl, localPreview: prepared.previewUrl };
  }
  return { imageUrl: prepared.dataUrl, localPreview: prepared.previewUrl };
}

async function addMenuItem(event) {
  event.preventDefault();
  if (!state.restaurant?.id || state.menuBusy) return;
  const form = event.currentTarget;
  const name = String(form.name.value || '').trim();
  const category = String(form.category.value || 'Food').trim() || 'Food';
  const description = String(form.description?.value || '').trim();
  const price = Number(form.price.value);
  if (!name || !Number.isFinite(price) || price <= 0) {
    window.alert('Enter a name and valid price.');
    return;
  }

  state.menuBusy = true;
  render();
  try {
    let imageUrl = '';
    const file = form.image?.files?.[0] || state.pendingImage;
    if (file) {
      const uploaded = await uploadMenuImage(file);
      imageUrl = uploaded.imageUrl;
    }
    await addDoc(collection(db, 'menuItems'), {
      restaurantId: state.restaurant.id,
      restaurantName: state.restaurant.restaurantName || state.restaurant.name || '',
      name,
      category,
      description: description || '',
      price,
      currency: 'TZS',
      available: true,
      emoji: '🍽️',
      imageUrl: imageUrl || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    form.reset();
    state.pendingImage = null;
  } catch (error) {
    window.alert(error.message || 'Could not add menu item.');
  } finally {
    state.menuBusy = false;
    render();
  }
}

async function addHaulJuicePreset(presetKey) {
  if (!state.restaurant?.id || state.menuBusy) return;
  const preset = HAUL_JUICE_PRESETS.find((item) => item.key === presetKey);
  if (!preset) return;
  const fileInput = document.querySelector(`[data-juice-photo="${presetKey}"]`);
  const file = fileInput?.files?.[0];
  if (!file) {
    window.alert('Weka picha ya juice kwanza. Kila mgahawa anapakia picha yake.');
    return;
  }

  const already = state.menu.some(
    (item) =>
      item.isBrandJuice === true &&
      String(item.flavor || '').toLowerCase() === preset.flavor
  );
  if (already) {
    window.alert(`${preset.name} is already on your menu.`);
    return;
  }

  state.menuBusy = true;
  render();
  try {
    const uploaded = await uploadMenuImage(file);
    if (!uploaded.imageUrl) throw new Error('Picha haikupakiwa.');
    await addDoc(collection(db, 'menuItems'), {
      restaurantId: state.restaurant.id,
      restaurantName: state.restaurant.restaurantName || state.restaurant.name || '',
      name: preset.name,
      category: preset.category,
      description: preset.description,
      price: preset.price,
      currency: 'TZS',
      available: true,
      emoji: preset.emoji,
      isBrandJuice: true,
      brandTag: HAUL_BRAND_JUICE_TAG,
      brandJuice: true,
      highlight: 'HAUL',
      sizeLabel: preset.sizeLabel,
      flavor: preset.flavor,
      benefitLine: preset.benefitLine,
      imageUrl: uploaded.imageUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    window.alert(error.message || 'Could not add HAUL Juice.');
  } finally {
    state.menuBusy = false;
    render();
  }
}

async function toggleMenuItem(id, available) {
  await updateDoc(doc(db, 'menuItems', id), {
    available: !available,
    updatedAt: serverTimestamp(),
  });
}

async function saveMenuEdit(event) {
  event.preventDefault();
  const id = state.editingId;
  if (!id || state.menuBusy) return;
  const form = event.currentTarget;
  const name = String(form.name.value || '').trim();
  const category = String(form.category.value || 'Food').trim() || 'Food';
  const description = String(form.description?.value || '').trim();
  const price = Number(form.price.value);
  if (!name || !Number.isFinite(price) || price <= 0) {
    window.alert('Weka jina na bei sahihi.');
    return;
  }
  state.menuBusy = true;
  render();
  try {
    const patch = {
      name,
      category,
      description,
      price,
      updatedAt: serverTimestamp(),
    };
    const file = form.image?.files?.[0];
    if (file) {
      const uploaded = await uploadMenuImage(file);
      if (!uploaded.imageUrl) throw new Error('Picha haikupakiwa.');
      patch.imageUrl = uploaded.imageUrl;
    }
    await updateDoc(doc(db, 'menuItems', id), patch);
    state.editingId = null;
  } catch (error) {
    window.alert(error.message || 'Could not update menu item.');
  } finally {
    state.menuBusy = false;
    render();
  }
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
    .map((item) => {
      const brand = item.isBrandJuice === true || String(item.brandTag || '').toLowerCase() === HAUL_BRAND_JUICE_TAG;
      const thumb = item.imageUrl
        ? `<img class="menu-thumb" src="${escapeHtml(item.imageUrl)}" alt="" />`
        : `<span class="menu-thumb placeholder">${escapeHtml(item.emoji || '🍽️')}</span>`;
      if (state.editingId === item.id) {
        return `
        <form class="menu-form menu-edit" data-edit-form="${escapeHtml(item.id)}">
          <label>Jina<input name="name" value="${escapeHtml(item.name)}" required /></label>
          <label>Kategoria<input name="category" value="${escapeHtml(item.category || '')}" /></label>
          <label>Bei (TZS)<input name="price" type="number" min="500" step="500" value="${Number(item.price) || ''}" required /></label>
          <label class="menu-form-span">Maelezo<textarea name="description" rows="2">${escapeHtml(item.description || '')}</textarea></label>
          <label class="menu-form-span">Badilisha picha<input name="image" type="file" accept="image/*" /></label>
          <div class="menu-edit-actions">
            <button class="btn primary" type="submit" ${state.menuBusy ? 'disabled' : ''}>${state.menuBusy ? 'Inahifadhi…' : 'Hifadhi'}</button>
            <button class="btn small ghost" type="button" data-cancel-edit="1">Ghairi</button>
          </div>
        </form>`;
      }
      return `
      <article class="menu-card">
        <div class="menu-card-main">
          ${thumb}
          <div>
            <strong>${escapeHtml(item.name)}${brand ? ' <span class="haul-pill">HAUL</span>' : ''}</strong>
            <p class="muted">${escapeHtml(item.category || 'Food')}${item.sizeLabel ? ` · ${escapeHtml(item.sizeLabel)}` : ''} · ${item.available === false ? 'Hidden' : 'Available'}</p>
            ${item.description ? `<p class="muted menu-desc">${escapeHtml(item.description)}</p>` : ''}
          </div>
        </div>
        <div class="menu-card-actions">
          <span class="price">${formatMoney(item.price)}</span>
          <button class="btn small ghost" type="button" data-edit-menu="${escapeHtml(item.id)}">Hariri</button>
          <button class="btn small ghost" type="button" data-toggle-menu="${escapeHtml(item.id)}" data-available="${item.available === false ? '0' : '1'}">
            ${item.available === false ? 'Show' : 'Hide'}
          </button>
        </div>
      </article>`;
    })
    .join('');

  const juiceButtons = HAUL_JUICE_PRESETS.map((preset) => {
    const listed = state.menu.some(
      (item) => item.isBrandJuice === true && String(item.flavor || '').toLowerCase() === preset.flavor
    );
    if (listed) {
      return `<article class="juice-card is-listed">
        <strong>${escapeHtml(preset.name)}</strong>
        <span class="muted">Ipo kwenye menyu · ${formatMoney(preset.price)}</span>
      </article>`;
    }
    return `<article class="juice-card">
      <strong>${escapeHtml(preset.name)}</strong>
      <span class="muted">${escapeHtml(preset.sizeLabel)} · ${formatMoney(preset.price)}</span>
      <label>Picha ya juice
        <input type="file" accept="image/*" data-juice-photo="${escapeHtml(preset.key)}" ${state.menuBusy ? 'disabled' : ''} />
      </label>
      <button class="btn small primary" type="button" data-add-juice="${preset.key}" ${state.menuBusy ? 'disabled' : ''}>
        Pakia picha na ongeza
      </button>
    </article>`;
  }).join('');

  return `
    <div class="page-head">
      <div>
        <h1>Menu</h1>
        <p>Real dishes customers see in the HAUL app — no fake seed food.</p>
      </div>
    </div>
    <section class="juice-panel">
      <div>
        <h2>HAUL Juice brand</h2>
        <p class="muted">Pakia picha halisi ya kila juice. App inaonyesha picha uliyoweka, si picha bandia.</p>
      </div>
      <div class="juice-actions">${juiceButtons}</div>
    </section>
    <form class="menu-form" id="menuForm">
      <label>Name<input name="name" placeholder="e.g. Chipsi Mayai" required /></label>
      <label>Category<input name="category" placeholder="Chakula kikuu" /></label>
      <label>Price (TZS)<input name="price" type="number" min="500" step="500" placeholder="4500" required /></label>
      <label class="menu-form-span">Description<textarea name="description" rows="2" placeholder="Short honest description of the dish"></textarea></label>
      <label class="menu-form-span">Photo (upload)<input name="image" type="file" accept="image/*" /></label>
      <button class="btn primary" type="submit" ${state.menuBusy ? 'disabled' : ''}>${state.menuBusy ? 'Saving…' : 'Add food item'}</button>
    </form>
    <div class="card-list">
      ${rows || '<div class="empty">No menu items yet. Add your real food or HAUL Juice above.</div>'}
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
  document.querySelector('[data-edit-form]')?.addEventListener('submit', (event) => {
    void saveMenuEdit(event);
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
    const editBtn = event.target.closest?.('[data-edit-menu]');
    if (editBtn) {
      state.editingId = editBtn.dataset.editMenu || null;
      state.route = 'menu';
      render();
      return;
    }
    if (event.target.closest?.('[data-cancel-edit]')) {
      state.editingId = null;
      render();
      return;
    }
    const juiceBtn = event.target.closest?.('[data-add-juice]');
    if (juiceBtn) {
      void addHaulJuicePreset(juiceBtn.dataset.addJuice);
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
