const API_BASE_URL = "http://localhost:4000";

const truckSizes = [
  "Small Pickup (1-2 tons)",
  "Light Truck (3-5 tons)",
  "Medium Truck (6-10 tons)",
  "Heavy Truck (11-20 tons)",
  "Superlink / Articulated (21-34 tons)",
  "Abnormal / Oversize Load",
  "Refrigerated Truck",
  "Tanker Truck",
];

const southernAfricaCountries = [
  "Angola",
  "Botswana",
  "Comoros",
  "Democratic Republic of the Congo",
  "Eswatini",
  "Lesotho",
  "Madagascar",
  "Malawi",
  "Mauritius",
  "Mozambique",
  "Namibia",
  "Seychelles",
  "South Africa",
  "Tanzania",
  "Zambia",
  "Zimbabwe",
];

const state = {
  requests: [],
  drivers: [],
  bids: [],
  verifications: [],
  deliveries: [],
  matches: [],
  activeChatRoom: "",
  chatMessages: [],
};

const socket = io(API_BASE_URL);
let customerMap;
let driverMap;
let pickupMarker;
let dropoffMarker;
let driverMarker;
let customerPinMode = "pickup";

function createOption(value, label = value) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function fillSelectOptions() {
  const truckSelects = document.querySelectorAll('select[name="truckSize"]');
  truckSelects.forEach((select) => truckSizes.forEach((size) => select.appendChild(createOption(size))));

  const countrySelects = document.querySelectorAll(
    'select[name="originCountry"], select[name="destinationCountry"], select[name="baseCountry"]'
  );
  countrySelects.forEach((select) => {
    southernAfricaCountries.forEach((country) => select.appendChild(createOption(country)));
  });
}

function wireTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(target).classList.add("active");
      if (target === "customer" && customerMap) customerMap.invalidateSize();
      if (target === "driver" && driverMap) driverMap.invalidateSize();
    });
  });
}

function renderList(containerId, items, toHtml) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = '<div class="item"><p>No items yet.</p></div>';
    return;
  }
  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = toHtml(item);
    container.appendChild(el);
  });
}

function parsePin(raw) {
  const text = raw.toString().trim();
  const parts = text.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
}

function toPinLabel(pin) {
  return `${Number(pin.lat).toFixed(4)}, ${Number(pin.lng).toFixed(4)}`;
}

function setInputPin(fieldName, pin) {
  const input = document.querySelector(`input[name="${fieldName}"]`);
  input.value = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
}

function initMaps() {
  const defaultCenter = [-24.6282, 25.9231];
  customerMap = L.map("customerMap").setView(defaultCenter, 5);
  driverMap = L.map("driverMap").setView(defaultCenter, 5);

  const tileConfig = {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  };

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileConfig).addTo(customerMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileConfig).addTo(driverMap);

  document.getElementById("setPickupMode").addEventListener("click", () => {
    customerPinMode = "pickup";
  });
  document.getElementById("setDropoffMode").addEventListener("click", () => {
    customerPinMode = "dropoff";
  });

  customerMap.on("click", (e) => {
    const pin = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (customerPinMode === "pickup") {
      if (pickupMarker) pickupMarker.remove();
      pickupMarker = L.marker([pin.lat, pin.lng]).addTo(customerMap).bindPopup("Pickup Pin").openPopup();
      setInputPin("pickupPin", pin);
    } else {
      if (dropoffMarker) dropoffMarker.remove();
      dropoffMarker = L.marker([pin.lat, pin.lng]).addTo(customerMap).bindPopup("Dropoff Pin").openPopup();
      setInputPin("dropoffPin", pin);
    }
  });

  driverMap.on("click", (e) => {
    const pin = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (driverMarker) driverMarker.remove();
    driverMarker = L.marker([pin.lat, pin.lng]).addTo(driverMap).bindPopup("Driver Current Pin").openPopup();
    setInputPin("currentPin", pin);
  });
}

function createBidActions(requestId, driverId) {
  return `
    <div class="actions">
      <button class="small-btn" data-action="bid" data-request-id="${requestId}" data-driver-id="${driverId}">Place Bid</button>
      <button class="small-btn" data-action="counter" data-request-id="${requestId}" data-driver-id="${driverId}">Counter-Offer</button>
      <button class="small-btn" data-action="chat" data-request-id="${requestId}" data-driver-id="${driverId}">Open Chat</button>
    </div>
  `;
}

function renderChat() {
  const chatRoomMeta = document.getElementById("chatRoomMeta");
  chatRoomMeta.innerHTML = state.activeChatRoom
    ? `<p><strong>Room:</strong> ${state.activeChatRoom}</p>`
    : "<p>No chat room selected.</p>";

  renderList("chatMessages", state.chatMessages, (m) => `
    <p><strong>${m.sender}</strong></p>
    <p>${m.message}</p>
    <p>${new Date(m.createdAt).toLocaleString()}</p>
  `);
}

function formatMoney(amount, currency = "BWP") {
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function renderLiveBids() {
  const container = document.getElementById("liveBidsContainer");
  if (!container) return;

  const bids = Array.isArray(state.bids) ? state.bids.slice(0, 6) : [];
  if (bids.length === 0) {
    container.innerHTML = '<article class="bid-card"><p class="hint">No live driver offers yet.</p></article>';
    return;
  }

  container.innerHTML = bids
    .map((bid) => {
      const request = state.requests.find((item) => item.id === bid.requestId) || {};
      const requestLabel = request.originCountry && request.destinationCountry
        ? `${request.originCountry} → ${request.destinationCountry}`
        : "Route request";
      const driverName = bid.driverName || bid.driverId || "Driver";
      const driverPayout = Number(bid.driverPayout || bid.amount || 0);
      const platformFee = Number(bid.platformFee || 0);
      const totalCost = Number(bid.totalCost || driverPayout + platformFee);
      const currency = String(bid.currency || "BWP").toUpperCase();

      return `
        <article class="bid-card">
          <div class="bid-top">
            <div>
              <h4>${driverName}</h4>
              <p>${bid.vehicle || bid.type || "Driver offer"}</p>
            </div>
            <span>${bid.eta || "Live"}</span>
          </div>
          <div class="bid-route">${requestLabel}</div>
          <div class="bid-finance">
            <div class="bid-line">
              <span>Driver payout</span>
              <strong>${formatMoney(driverPayout, currency)}</strong>
            </div>
            <div class="bid-line bid-line--fee">
              <span>Platform service fee (10%)</span>
              <strong>${formatMoney(platformFee, currency)}</strong>
            </div>
            <div class="bid-total">
              <span>Gross cost</span>
              <strong>${formatMoney(totalCost, currency)}</strong>
            </div>
          </div>
          <button class="bid-btn" type="button">Accept Bid</button>
        </article>
      `;
    })
    .join("");
}

function renderAll() {
  renderList(
    "requestList",
    state.requests,
    (r) => `
      <p><strong>${r.name}</strong> needs <strong>${r.truckSize}</strong></p>
      <p>ID: ${r.id}</p>
      <p>Cargo: ${r.cargo}</p>
      <p>Route: ${r.originCountry} -> ${r.destinationCountry}</p>
      <p>Pickup Pin: ${toPinLabel(r.pickupPin)} | Dropoff Pin: ${toPinLabel(r.dropoffPin)}</p>
      <p>Type: ${r.crossBorder ? "Cross-border" : "Local"} | Budget: $${r.budget}</p>
    `
  );

  renderList(
    "driverList",
    state.drivers,
    (d) => `
      <p><strong>${d.name}</strong> - ${d.truckSize}</p>
      <p>ID: ${d.id}</p>
      <p>Plate: ${d.plate} | Base: ${d.baseCountry}</p>
      <p>Current Pin: ${toPinLabel(d.currentPin)}</p>
      <p>Capability: ${d.crossBorderCapable ? "Cross-border + local" : "Local only"}</p>
    `
  );

  renderList(
    "matchList",
    state.matches,
    (m) => `
      <p><strong>Driver ${m.driverId} can serve request ${m.requestId}</strong></p>
      <p>Route: ${m.route}</p>
      <p>Driver to pickup: ${m.pickupDistanceKm} km</p>
      ${createBidActions(m.requestId, m.driverId)}
    `
  );

  renderList(
    "verificationList",
    state.verifications,
    (v) => `
      <p><strong>Verified:</strong> Request ${v.requestId}</p>
      <p>Code: ${v.verificationCode} | Time: ${new Date(v.createdAt).toLocaleString()}</p>
    `
  );

  renderList(
    "podList",
    state.deliveries,
    (p) => `
      <p><strong>Delivered:</strong> Request ${p.requestId}</p>
      <p>Receiver: ${p.receiverName} | Signature: ${p.signature}</p>
      <p>Note: ${p.note}</p>
      <p>Time: ${new Date(p.createdAt).toLocaleString()}</p>
    `
  );

  renderLiveBids();
  renderChat();
}

async function apiPost(path, payload) {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed request: ${path} (${response.status})`);
    }
    return response.json();
  } catch (error) {
    console.error(`API POST error for ${path}:`, error);
    throw error;
  }
}

async function refreshData() {
  try {
    const [requests, drivers, bids, verifications, pods, matches] = await Promise.all([
      fetch(`${API_BASE_URL}/api/requests`).then((r) => r.json()),
      fetch(`${API_BASE_URL}/api/drivers`).then((r) => r.json()),
      fetch(`${API_BASE_URL}/api/bids`).then((r) => r.json()),
      fetch(`${API_BASE_URL}/api/verifications`).then((r) => r.json()),
      fetch(`${API_BASE_URL}/api/pods`).then((r) => r.json()),
      fetch(`${API_BASE_URL}/api/matches`).then((r) => r.json()),
    ]);

    state.requests = requests;
    state.drivers = drivers;
    state.bids = bids;
    state.verifications = verifications;
    state.deliveries = pods;
    state.matches = matches;
    renderAll();
  } catch (error) {
    console.error("Failed to refresh data:", error);
  }
}

function wireBidActions() {
  const matchList = document.getElementById("matchList");
  matchList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    const requestId = target.dataset.requestId;
    const driverId = target.dataset.driverId;
    if (!action || !requestId || !driverId) return;

    if (action === "chat") {
      state.activeChatRoom = `${requestId}:${driverId}`;
      state.chatMessages = [];
      socket.emit("chat:join", { roomId: state.activeChatRoom });
      renderChat();
      return;
    }

    const value = prompt(`Enter ${action === "bid" ? "bid" : "counter-offer"} amount (USD):`);
    if (!value) return;
    const amount = Number(value);
    if (Number.isNaN(amount) || amount <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    await apiPost("/api/bids", { requestId, driverId, type: action, amount, status: "open" });
  });
}

function wireForms() {
  const customerForm = document.getElementById("customerForm");
  const driverForm = document.getElementById("driverForm");
  const verifyForm = document.getElementById("verifyForm");
  const podForm = document.getElementById("podForm");
  const chatForm = document.getElementById("chatForm");

  customerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(customerForm);
    const pickupPin = parsePin(data.get("pickupPin"));
    const dropoffPin = parsePin(data.get("dropoffPin"));
    if (!pickupPin || !dropoffPin) {
      alert("Pin format must be lat,lng");
      return;
    }

    await apiPost("/api/requests", {
      name: data.get("name").toString().trim(),
      cargo: data.get("cargo").toString().trim(),
      truckSize: data.get("truckSize").toString(),
      originCountry: data.get("originCountry").toString(),
      destinationCountry: data.get("destinationCountry").toString(),
      crossBorder: data.get("crossBorder") === "on",
      budget: Number(data.get("budget")),
      pickupPin,
      dropoffPin,
    });
    customerForm.reset();
  });

  driverForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(driverForm);
    const currentPin = parsePin(data.get("currentPin"));
    if (!currentPin) {
      alert("Driver pin format must be lat,lng");
      return;
    }

    await apiPost("/api/drivers", {
      name: data.get("name").toString().trim(),
      truckSize: data.get("truckSize").toString(),
      plate: data.get("plate").toString().trim().toUpperCase(),
      baseCountry: data.get("baseCountry").toString(),
      crossBorderCapable: data.get("crossBorderCapable") === "on",
      currentPin,
    });
    driverForm.reset();
  });

  verifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(verifyForm);
    await apiPost("/api/verifications", {
      requestId: data.get("requestId").toString().trim(),
      verificationCode: data.get("verificationCode").toString().trim().toUpperCase(),
    });
    verifyForm.reset();
  });

  podForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(podForm);
    await apiPost("/api/pods", {
      requestId: data.get("requestId").toString().trim(),
      receiverName: data.get("receiverName").toString().trim(),
      signature: data.get("signature").toString().trim(),
      note: data.get("note").toString().trim(),
    });
    podForm.reset();
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.activeChatRoom) {
      alert("Open a chat room from a match first.");
      return;
    }
    const data = new FormData(chatForm);
    socket.emit("chat:message", {
      roomId: state.activeChatRoom,
      sender: data.get("sender").toString().trim(),
      message: data.get("message").toString().trim(),
    });
    chatForm.reset();
  });
}

function wireSockets() {
  socket.on("connect", () => {
    console.log("Connected to realtime server");
  });

  socket.on("request:created", refreshData);
  socket.on("driver:created", refreshData);
  socket.on("bid:created", refreshData);
  socket.on("verification:created", refreshData);
  socket.on("pod:created", refreshData);
  socket.on("chat:message", (message) => {
    if (message.roomId === state.activeChatRoom) {
      state.chatMessages.push(message);
      renderChat();
    }
  });
}

async function bootstrap() {
  try {
    fillSelectOptions();
    wireTabs();
    initMaps();
    wireForms();
    wireBidActions();
    wireSockets();
    await refreshData();
  } catch (error) {
    console.error("Bootstrap error:", error);
    alert("Could not initialize app. Make sure backend/server.js is running on port 4000.");
  }
}

bootstrap();
