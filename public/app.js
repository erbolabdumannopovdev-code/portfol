const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authModal = $("#auth-modal");
const orderModal = $("#order-modal");
const authForm = $("#auth-form");
const authMessage = $("#auth-message");
const orderMessage = $("#order-message");
const toast = $("#toast");

let authMode = "login";
let codeRequested = false;
let signedInUser = null;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function setMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `form-message${type ? ` ${type}` : ""}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "So‘rov bajarilmadi. Keyinroq qayta urinib ko‘ring.");
  return body;
}

function openAuth() {
  authModal.showModal();
}

function updateAuthMode(mode) {
  authMode = mode;
  codeRequested = false;
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  $$(".register-field").forEach((field) => { field.hidden = mode !== "register"; });
  $(".code-field").hidden = true;
  $("#resend-code").hidden = true;
  $("#auth-submit").textContent = "Kodni emailga yuborish ↗";
  setMessage(authMessage, "");
}

function updateUser(user) {
  signedInUser = user;
  $("#open-auth").textContent = user ? `${user.name.split(" ")[0]} ↗` : "Kirish ↗";
  $("#admin-section").hidden = !user?.isAdmin;
  if (user?.isAdmin) loadAdminOrders();
}

async function loadAdminOrders() {
  const list = $("#orders-list");
  const message = $("#admin-message");
  list.replaceChildren();
  message.textContent = "Buyurtmalar yuklanmoqda...";
  try {
    const { orders } = await api("/api/admin/orders");
    message.textContent = orders.length ? `${orders.length} ta so‘nggi buyurtma` : "Hozircha buyurtmalar yo‘q.";
    for (const order of orders) {
      const card = document.createElement("article");
      card.className = "order-card";
      const content = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `#${order.id} · ${order.name} — ${order.service}`;
      const email = document.createElement("p");
      email.textContent = `${order.email} · ${order.budget} · ${order.created_at}`;
      const details = document.createElement("p");
      details.textContent = order.details;
      content.append(title, email, details);
      const status = document.createElement("select");
      status.setAttribute("aria-label", `#${order.id} buyurtma holati`);
      for (const value of ["Yangi", "Jarayonda", "Yakunlandi"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === order.status;
        status.append(option);
      }
      status.addEventListener("change", async () => {
        status.disabled = true;
        try {
          await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status: status.value }) });
          showToast("Buyurtma holati yangilandi.");
        } catch (error) {
          status.value = order.status;
          showToast(error.message);
        } finally {
          status.disabled = false;
        }
      });
      card.append(content, status);
      list.append(card);
    }
  } catch (error) {
    message.textContent = error.message;
  }
}

$("#open-auth").addEventListener("click", () => {
  if (signedInUser?.isAdmin) {
    $("#admin-section").scrollIntoView({ behavior: "smooth" });
    return;
  }
  openAuth();
});

$$("[data-open-order]").forEach((button) => button.addEventListener("click", () => {
  orderMessage.textContent = "";
  if (signedInUser) {
    $("#order-form").elements.name.value = signedInUser.name;
    $("#order-form").elements.email.value = signedInUser.email;
  }
  orderModal.showModal();
}));

$$(".auth-tab").forEach((tab) => tab.addEventListener("click", () => updateAuthMode(tab.dataset.mode)));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#auth-submit");
  const values = new FormData(authForm);
  const email = values.get("email").trim();
  submit.disabled = true;
  try {
    if (!codeRequested) {
      const body = { mode: authMode, email };
      if (authMode === "register") {
        body.name = values.get("name").trim();
        body.age = values.get("age");
      }
      const result = await api("/api/auth/request-code", { method: "POST", body: JSON.stringify(body) });
      codeRequested = true;
      $(".code-field").hidden = false;
      $("#resend-code").hidden = false;
      $("#auth-submit").textContent = "Kodni tasdiqlash ↗";
      setMessage(authMessage, result.message, "success");
      authForm.elements.code.focus();
      return;
    }
    const result = await api("/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ email, code: values.get("code") }),
    });
    updateUser(result.user);
    authModal.close();
    authForm.reset();
    updateAuthMode("login");
    showToast(`Xush kelibsiz, ${result.user.name}!`);
  } catch (error) {
    setMessage(authMessage, error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

$("#resend-code").addEventListener("click", () => {
  codeRequested = false;
  authForm.requestSubmit();
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    updateUser(null);
    showToast("Tizimdan chiqdingiz.");
  } catch (error) {
    showToast(error.message);
  }
});

$("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const body = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  setMessage(orderMessage, "Yuborilmoqda...");
  try {
    const result = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
    orderModal.close();
    form.reset();
    showToast(result.message);
  } catch (error) {
    setMessage(orderMessage, error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

const menuToggle = $("#menu-toggle");
menuToggle.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  $("#main-nav").classList.toggle("open", open);
});
$$(".main-nav a").forEach((link) => link.addEventListener("click", () => {
  menuToggle.setAttribute("aria-expanded", "false");
  $("#main-nav").classList.remove("open");
}));

$("#current-year").textContent = new Date().getFullYear();

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("revealed");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
$$(".section-heading, .about-grid, .stat, .service-card, .stack-group").forEach((element) => {
  element.classList.add("reveal");
  revealObserver.observe(element);
});

try {
  const result = await api("/api/auth/me");
  updateUser(result.user);
} catch {
  updateUser(null);
}

try {
  const [THREE, environmentModule] = await Promise.all([
    import("three"),
    import("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/environments/RoomEnvironment.js"),
  ]);
  const { RoomEnvironment } = environmentModule;
  const canvas = $("#hero-canvas");
  const visual = $(".hero-visual");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 7.3);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: window.devicePixelRatio < 2,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = environmentGenerator.fromScene(environment, 0.04).texture;
  environment.dispose();
  environmentGenerator.dispose();

  scene.add(new THREE.AmbientLight(0xbcc5ab, 0.5));
  const keyLight = new THREE.DirectionalLight(0xecffd0, 3.3);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);

  const movingLight = new THREE.SpotLight(0xd9fb91, 105, 18, Math.PI / 6, 0.78, 1.3);
  movingLight.position.set(3.6, 3.2, 4.3);
  movingLight.target.position.set(0, 0, 0);
  scene.add(movingLight, movingLight.target);

  const rimLight = new THREE.PointLight(0xa8c879, 31, 13, 2);
  rimLight.position.set(-4, -1, -3);
  scene.add(rimLight);

  function addVertexMotion(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
          vec3 transformed = vec3(position);
          float waveA = sin(position.x * 2.6 + uTime * 0.55);
          float waveB = cos(position.y * 3.1 - uTime * 0.43);
          float waveC = sin(position.z * 2.8 + uTime * 0.34);
          transformed += normal * ((waveA * waveB + waveC) * 0.035);
        `,
      );
      material.userData.timeUniform = shader.uniforms.uTime;
    };
    material.customProgramCacheKey = () => "yerbol-orbital-wave-v1";
    return material;
  }

  const sculpture = new THREE.Group();
  scene.add(sculpture);

  const coreMaterial = addVertexMotion(new THREE.MeshPhysicalMaterial({
    color: "#a8cc70",
    metalness: 0.78,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    envMapIntensity: 1.55,
    emissive: "#24301a",
    emissiveIntensity: 0.25,
  }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.31, 4), coreMaterial);
  sculpture.add(core);

  const wireMaterial = addVertexMotion(new THREE.MeshBasicMaterial({
    color: "#e5ffb8",
    wireframe: true,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  }));
  const wireShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.39, 3), wireMaterial);
  sculpture.add(wireShell);

  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.59, 0.12, 160, 12, 2, 3),
    new THREE.MeshPhysicalMaterial({
      color: "#e2e8d5",
      metalness: 0.86,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.7,
    }),
  );
  knot.rotation.set(0.45, 0.35, -0.25);
  sculpture.add(knot);

  const particleCount = window.innerWidth < 640 ? 220 : 480;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const lime = new THREE.Color("#d9fb91");
  const softWhite = new THREE.Color("#e9e8df");
  for (let index = 0; index < particleCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.8 + Math.random() * 1.1;
    const offset = index * 3;
    particlePositions[offset] = Math.cos(angle) * radius;
    particlePositions[offset + 1] = (Math.random() - 0.5) * 4.1;
    particlePositions[offset + 2] = Math.sin(angle) * radius - 0.6;
    const shade = index % 4 === 0 ? softWhite : lime;
    particleColors[offset] = shade.r;
    particleColors[offset + 1] = shade.g;
    particleColors[offset + 2] = shade.b;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particleField = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      size: 0.022,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(particleField);

  const pointer = new THREE.Vector2();
  const targetRotation = new THREE.Vector2();
  let animationFrame = 0;
  let isVisible = true;
  let isPageActive = true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  visual.addEventListener("pointermove", (event) => {
    const bounds = visual.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    pointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
  }, { passive: true });
  visual.addEventListener("pointerleave", () => pointer.set(0, 0), { passive: true });

  const resize = () => {
    const { width, height } = visual.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = window.innerWidth < 640 ? 43 : 38;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderer.render(scene, camera);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(visual);
  window.addEventListener("resize", resize, { passive: true });
  resize();

  let lastFrame = performance.now();
  function renderFrame(now) {
    animationFrame = 0;
    if (!isVisible || !isPageActive) return;
    if (!reducedMotion) animationFrame = requestAnimationFrame(renderFrame);

    const elapsed = now * 0.001;
    const delta = Math.min((now - lastFrame) * 0.001, 0.05);
    lastFrame = now;
    const motionScale = reducedMotion ? 0 : 1;
    const follow = 1 - Math.exp(-delta * 4.5);

    targetRotation.x += (pointer.y * 0.22 * motionScale - targetRotation.x) * follow;
    targetRotation.y += (pointer.x * 0.32 * motionScale - targetRotation.y) * follow;
    sculpture.rotation.x = elapsed * 0.12 * motionScale + targetRotation.x;
    sculpture.rotation.y = elapsed * 0.17 * motionScale + targetRotation.y;
    sculpture.rotation.z = Math.sin(elapsed * 0.19) * 0.035 * motionScale;
    knot.rotation.x = 0.45 + elapsed * 0.13 * motionScale - targetRotation.y * 0.6;
    knot.rotation.y = 0.35 + elapsed * 0.18 * motionScale + targetRotation.x * 0.6;
    particleField.rotation.y = elapsed * 0.027 * motionScale;
    if (coreMaterial.userData.timeUniform) coreMaterial.userData.timeUniform.value = elapsed;
    if (wireMaterial.userData.timeUniform) wireMaterial.userData.timeUniform.value = elapsed;
    movingLight.position.x = 3.5 + Math.sin(elapsed * 0.35) * 1.15;
    movingLight.position.y = 3 + Math.cos(elapsed * 0.27) * 0.75;
    movingLight.position.z = 3.8 + Math.cos(elapsed * 0.3) * 0.8;
    renderer.render(scene, camera);
  }

  function resumeAnimation() {
    if (animationFrame || !isVisible || !isPageActive) return;
    lastFrame = performance.now();
    if (reducedMotion) {
      renderer.render(scene, camera);
      return;
    }
    animationFrame = requestAnimationFrame(renderFrame);
  }

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    if (isVisible) {
      resumeAnimation();
    } else {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }, { threshold: 0.05 });
  visibilityObserver.observe(visual);

  document.addEventListener("visibilitychange", () => {
    isPageActive = !document.hidden;
    if (isPageActive) {
      resumeAnimation();
    } else {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  });

  renderer.render(scene, camera);
  resumeAnimation();
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    particleGeometry.dispose();
    core.geometry.dispose();
    wireShell.geometry.dispose();
    knot.geometry.dispose();
    renderer.dispose();
  }, { once: true });
} catch (error) {
  console.warn("3D sahna yuklanmadi:", error);
}
