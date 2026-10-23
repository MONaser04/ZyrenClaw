
(function(){
  'use strict';

  // ------------------------------------------------------------------
  // Graceful failure if CDN libs do not load
  // ------------------------------------------------------------------
  function showLibError(name){
    var el = document.getElementById('lib-error');
    el.style.display = 'block';
    el.innerHTML = '<b>' + name + '</b> failed to load from the CDN.<br>The header and panel still render, but the 3D scene is unavailable.';
  }
  if (typeof THREE === 'undefined'){ showLibError('Three.js'); return; }
  if (typeof CANNON === 'undefined'){ showLibError('Cannon.js'); return; }

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------
  var MAX_CATS = 60;
  var SQUISH_THRESHOLD = 1.5; // m/s relative impact speed to trigger squash

  var PALETTE = [
    { name: 'Mochi Pink',   hex: 0xf6c9d4 },
    { name: 'Mint',         hex: 0xbfe3d0 },
    { name: 'Butter Yellow',hex: 0xf7e3a1 },
    { name: 'Lavender',     hex: 0xd8ccf0 },
    { name: 'Cream',        hex: 0xf5efe1 }
  ];

  var scene, camera, renderer, world;
  var floorBody, floorMat, catMat, cmFloorCat, cmCatCat;
  var cats = [];               // live cat records
  var catGroups = [];          // parallel array for raycaster
  var stage = document.getElementById('stage');
  var pourBtn = document.getElementById('pour');
  var gravInput = document.getElementById('gravity');
  var gravVal = document.getElementById('grav-val');
  var bounInput = document.getElementById('bounciness');
  var bounVal = document.getElementById('boun-val');
  var swatchesEl = document.getElementById('swatches');

  var currentColor = new THREE.Color(PALETTE[0].hex);
  var activeSwatchIndex = 0;

  // ------------------------------------------------------------------
  // Shared geometry cache (per-cat meshes clone materials only)
  // ------------------------------------------------------------------
  var geo = {};
  geo.body  = new THREE.SphereGeometry(0.5, 16, 12);
  geo.head  = new THREE.SphereGeometry(0.44, 14, 12);
  geo.ear   = new THREE.ConeGeometry(0.125, 0.3, 8);
  geo.earIn = new THREE.ConeGeometry(0.065, 0.18, 6);
  geo.eye   = new THREE.SphereGeometry(0.07, 8, 6);
  geo.glint = new THREE.SphereGeometry(0.022, 6, 4);
  geo.nose  = new THREE.SphereGeometry(0.055, 8, 6);
  geo.paw   = new THREE.SphereGeometry(0.085, 8, 6);
  // curved tail built from a shared tube geometry
  var tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3( 0.00, 0.02, 0.00),
    new THREE.Vector3( 0.06, 0.16,-0.08),
    new THREE.Vector3( 0.02, 0.34,-0.30),
    new THREE.Vector3(-0.04, 0.42,-0.46)
  ]);
  geo.tail  = new THREE.TubeGeometry(tailCurve, 10, 0.06, 6, false);

  // ------------------------------------------------------------------
  // Cannon.js world setup
  // ------------------------------------------------------------------
  function initPhysics(){
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 10;
    world.allowSleep = true;

    floorMat = new CANNON.Material('floor');
    catMat   = new CANNON.Material('cat');

    cmFloorCat = new CANNON.ContactMaterial(floorMat, catMat, {
      friction: 0.4,
      restitution: 0.6
    });
    cmCatCat = new CANNON.ContactMaterial(catMat, catMat, {
      friction: 0.4,
      restitution: 0.6
    });
    world.addContactMaterial(cmFloorCat);
    world.addContactMaterial(cmCatCat);

    // floor body (static plane, normal up along Y)
    var floorShape = new CANNON.Plane();
    floorBody = new CANNON.Body({
      mass: 0,
      shape: floorShape,
      material: floorMat
    });
    floorBody.position.set(0, 0, 0);
    world.addBody(floorBody);
  }

  // ------------------------------------------------------------------
  // Three.js setup
  // ------------------------------------------------------------------
  function initThree(){
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4efe8);
    scene.fog = new THREE.Fog(0xf4efe8, 2, 26);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 3.2, 11);
    camera.lookAt(0, 1, 0);

    renderer = new THREE.WebGLRenderer({ canvas: stage, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    var hemi = new THREE.HemisphereLight(0xf4efe8, 0xe0d8d0, 0.7);
    scene.add(hemi);

    var sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(5, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 42;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    var fill = new THREE.PointLight(0xfff5ea, 0.45);
    fill.position.set(-7, 3, -6);
    scene.add(fill);

    // Floor visual
    var floorGeo = new THREE.CircleGeometry(16, 80);
    var floorMatVis = new THREE.MeshStandardMaterial({
      color: 0xe8e0d8,
      roughness: 0.92
    });
    var floorMesh = new THREE.Mesh(floorGeo, floorMatVis);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.01;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // soft contact shadow under floor area (subtle)
    var shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(15.5, 80),
      new THREE.ShadowMaterial({ opacity: 0.12, color: 0x000000 })
    );
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.02;
    scene.add(shadowMesh);
  }

  // ------------------------------------------------------------------
  // Cat construction
  // ------------------------------------------------------------------
  function spawnCat(x, y, z, color){
    if (cats.length >= MAX_CATS) return null;

    var group = new THREE.Group();
    scene.add(group);

    // --- body ---
    var bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.62 });
    var bodyMesh = new THREE.Mesh(geo.body, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // --- head ---
    var headMat = bodyMat.clone();
    var headMesh = new THREE.Mesh(geo.head, headMat);
    headMesh.position.set(0, 0.48, 0.16);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    group.add(headMesh);

    // --- ears ---
    var earMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
    var earInMat = new THREE.MeshStandardMaterial({ color: 0xffc8d8, roughness: 0.8 });
    var earL = new THREE.Mesh(geo.ear, earMat);
    var earR = new THREE.Mesh(geo.ear, earMat);
    earL.position.set(-0.17, 0.66, -0.04); earL.rotation.x = -0.25; earL.rotation.z = -0.12;
    earR.position.set( 0.17, 0.66, -0.04); earR.rotation.x = -0.25; earR.rotation.z =  0.12;
    earL.castShadow = true; earR.castShadow = true;
    var earInL = new THREE.Mesh(geo.earIn, earInMat);
    var earInR = new THREE.Mesh(geo.earIn, earInMat);
    earInL.position.copy(earL.position); earInL.rotation.copy(earL.rotation); earInL.scale.set(0.6, 0.75, 0.6);
    earInR.position.copy(earR.position); earInR.rotation.copy(earR.rotation); earInR.scale.set(0.6, 0.75, 0.6);
    headMesh.add(earL); headMesh.add(earR); headMesh.add(earInL); headMesh.add(earInR);

    // --- eyes ---
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0x261f1c, roughness: 0.1 });
    var eyeL = new THREE.Mesh(geo.eye, eyeMat);
    var eyeR = new THREE.Mesh(geo.eye, eyeMat);
    eyeL.position.set(-0.135, 0.56, 0.30); eyeL.scale.set(1, 1, 0.45);
    eyeR.position.set( 0.135, 0.56, 0.30); eyeR.scale.set(1, 1, 0.45);
    var glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var glintL = new THREE.Mesh(geo.glint, glintMat);
    var glintR = new THREE.Mesh(geo.glint, glintMat);
    glintL.position.set(-0.155, 0.595, 0.325);
    glintR.position.set( 0.155, 0.595, 0.325);
    headMesh.add(eyeL); headMesh.add(eyeR); headMesh.add(glintL); headMesh.add(glintR);

    // --- nose ---
    var noseMat = new THREE.MeshStandardMaterial({ color: 0xffb7c7, roughness: 0.6 });
    var nose = new THREE.Mesh(geo.nose, noseMat);
    nose.position.set(0, 0.50, 0.36);
    headMesh.add(nose);

    // --- paws ---
    var pawMat = bodyMat.clone();
    pawMat.color.copy(color).multiplyScalar(0.92);
    var pawL = new THREE.Mesh(geo.paw, pawMat);
    var pawM = new THREE.Mesh(geo.paw, pawMat);
    var pawR = new THREE.Mesh(geo.paw, pawMat);
    pawL.position.set(-0.20, -0.44, 0.39);
    pawM.position.set( 0.00, -0.46, 0.42);
    pawR.position.set( 0.20, -0.44, 0.39);
    pawL.castShadow = true; pawM.castShadow = true; pawR.castShadow = true;
    bodyMesh.add(pawL); bodyMesh.add(pawM); bodyMesh.add(pawR);

    // --- tail ---
    var tailMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
    var tailMesh = new THREE.Mesh(geo.tail, tailMat);
    tailMesh.position.set(0, 0.04, -0.26);
    tailMesh.rotation.x = -0.55;
    tailMesh.rotation.z = 0.15;
    tailMesh.castShadow = true;
    bodyMesh.add(tailMesh);

    // --- cannon body ---
    var shape = new CANNON.Sphere(0.52);
    var cbody = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(x, y, z),
      shape: shape,
      material: catMat,
      linearDamping: 0.05,
      angularDamping: 0.15
    });
    cbody.allowSleep = true;
    cbody.sleepSpeedLimit = 0.35;
    cbody.sleepTimeLimit = 1.0;
    world.addBody(cbody);

    var cat = {
      id: cats.length,
      group: group,
      body: cbody,
      bodyMat: bodyMat,
      headMat: headMat,
      color: color.clone(),
      targetColor: color.clone(),
      squish: { sx:1, sy:1, sz:1, tx:1, ty:1, tz:1, vx:0, vy:0, vz:0 }
    };
    cats.push(cat);
    catGroups.push(group);
    cbody.addEventListener('collide', onCatCollide);
    return cat;
  }

  function catByGroup(group){
    for (var i = 0; i < cats.length; i++) if (cats[i].group === group) return cats[i];
    return null;
  }

  // ------------------------------------------------------------------
  // Squish / spring system
  // ------------------------------------------------------------------
  function triggerSquish(cat, normalWorld, speed){
    var impact = Math.min(Math.max(speed, 0) / 10, 1);
    if (impact < 0.12) return;

    var s = cat.squish;
    var nx = Math.abs(normalWorld.x), ny = Math.abs(normalWorld.y), nz = Math.abs(normalWorld.z);

    // choose dominant axis: vertical hit -> world Y, else dominant normal component
    var compX, compY, compZ;
    if (ny > 0.7 && ny >= nx && ny >= nz){
      compX = 1 + 0.22 * impact; compY = 1 - 0.5 * impact; compZ = 1 + 0.22 * impact;
    } else {
      // side hit: compress along the strongest normal axis, expand others
      var cx = 1 + 0.16 * impact, cy = 1 + 0.16 * impact, cz = 1 + 0.16 * impact;
      if (nx >= ny && nx >= nz){ cx = 1 - 0.5 * impact; }
      else if (ny >= nz){ cy = 1 - 0.5 * impact; }
      else { cz = 1 - 0.5 * impact; }
      compX = cx; compY = cy; compZ = cz;
    }

    var clamp = function(v){ return Math.max(0.5, Math.min(1.6, v)); };
    s.tx = clamp(compX); s.ty = clamp(compY); s.tz = clamp(compZ);

    // mild stretch when falling fast
    if (cat.body.velocity.y < -2.5){
      var stretch = 1 + Math.min(-cat.body.velocity.y / 14, 0.4);
      s.ty = clamp(Math.max(s.ty, stretch));
      s.tx = clamp(Math.min(s.tx, 1 - 0.12));
      s.tz = clamp(Math.min(s.tz, 1 - 0.12));
    }
  }

  function updateSquish(cat, dt){
    var s = cat.squish;
    var decay = Math.exp(-7 * dt);
    s.tx = 1 + (s.tx - 1) * decay;
    s.ty = 1 + (s.ty - 1) * decay;
    s.tz = 1 + (s.tz - 1) * decay;

    var stiffness = 14, damping = 5.5;
    // x
    var err = s.tx - s.sx;
    var acc = err * stiffness - s.vx * damping;
    s.vx += acc * dt; s.sx += s.vx * dt;
    // y
    err = s.ty - s.sy;
    acc = err * stiffness - s.vy * damping;
    s.vy += acc * dt; s.sy += s.vy * dt;
    // z
    err = s.tz - s.sz;
    acc = err * stiffness - s.vz * damping;
    s.vz += acc * dt; s.sz += s.vz * dt;

    cat.group.scale.set(s.sx, s.sy, s.sz);
  }

  // ------------------------------------------------------------------
  // Collision handler (per cat body)
  // ------------------------------------------------------------------
  function onCatCollide(event){
    var body = event.target;
    var cat = null;
    for (var i = 0; i < cats.length; i++){ if (cats[i].body === body){ cat = cats[i]; break; } }
    if (!cat) return;

    var contact = event.contact;
    var bi = contact.bi, bj = contact.bj;
    var rel = new CANNON.Vec3().copy(bi.velocity).vsub(bj.velocity);
    var speed = Math.abs(rel.dot(contact.ni));
    triggerSquish(cat, contact.ni, speed);
  }

  // ------------------------------------------------------------------
  // Input (pointer) — grab / drag / toss
  // ------------------------------------------------------------------
  var pointer = new THREE.Vector2();
  var raycaster = new THREE.Raycaster();
  var dragPlane = new THREE.Plane();
  var camDir = new THREE.Vector3();
  var dragged = null;
  var dragHist = [];

  function getPointerPos(e){
    var clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    var clientY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  }

  function onPointerDown(e){
    if (dragged) return;
    getPointerPos(e);
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(catGroups, true);
    if (!hits.length) return;
    var obj = hits[0].object;
    var root = obj;
    while (root.parent && root.parent !== scene) root = root.parent;
    var cat = catByGroup(root);
    if (!cat) return;

    dragged = cat;
    dragHist = [];
    cat.body.sleep();

    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, cat.body.position);
    stage.classList.add('is-grabbing');
  }

  function onPointerMove(e){
    if (!dragged) return;
    getPointerPos(e);
    raycaster.setFromCamera(pointer, camera);
    var target = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, target)) return;
    var b = dragged.body;
    b.position.lerp(target, 0.55);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.wakeUp();
    var now = performance.now();
    dragHist.push({ x: target.x, y: target.y, z: target.z, t: now });
    while (dragHist.length && dragHist[0].t < now - 150) dragHist.shift();
  }

  function onPointerUp(){
    if (!dragged) return;
    var b = dragged.body;
    if (dragHist.length >= 2){
      var old = dragHist[0];
      var newest = dragHist[dragHist.length - 1];
      var dt = (newest.t - old.t) / 1000;
      if (dt > 0){
        var scale = 1.1;
        var vx = (newest.x - old.x) / dt * scale;
        var vy = (newest.y - old.y) / dt * scale;
        var vz = (newest.z - old.z) / dt * scale;
        var cap = 16;
        b.velocity.set(
          Math.max(-cap, Math.min(cap, vx)),
          Math.max(-cap, Math.min(cap, vy)),
          Math.max(-cap, Math.min(cap, vz))
        );
      }
    }
    b.angularVelocity.set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    b.wakeUp();
    dragged = null;
    dragHist = [];
    stage.classList.remove('is-grabbing');
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // ------------------------------------------------------------------
  // Spawning
  // ------------------------------------------------------------------
  function randRange(min, max){ return Math.random() * (max - min) + min; }
  function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }

  function pourCats(){
    var count = randInt(4, 6);
    var room = MAX_CATS - cats.length;
    if (room <= 0) return;
    var toSpawn = Math.min(count, room);
    var color = currentColor.clone();
    for (var i = 0; i < toSpawn; i++){
      spawnCat(
        randRange(-3.6, 3.6),
        randRange(5.2, 9.0),
        randRange(-2.6, 2.6),
        color
      );
    }
    // give new cats a little random tumble
    var n = cats.length;
    for (var k = n - toSpawn; k < n; k++){
      var b = cats[k].body;
      b.angularVelocity.set(randRange(-1,1), randRange(-1,1), randRange(-1,1));
    }
  }
  pourBtn.addEventListener('click', pourCats);

  // ------------------------------------------------------------------
  // Controls wiring
  // ------------------------------------------------------------------
  function buildSwatches(){
    swatchesEl.innerHTML = '';
    PALETTE.forEach(function(entry, idx){
      var sw = document.createElement('div');
      sw.className = 'swatch' + (idx === activeSwatchIndex ? ' is-active' : '');
      sw.style.backgroundColor = '#' + entry.hex.toString(16).padStart(6, '0');
      sw.title = entry.name;
      sw.addEventListener('click', function(){
        activeSwatchIndex = idx;
        currentColor.setHex(entry.hex);
        document.querySelectorAll('#swatches .swatch').forEach(function(s, j){
          s.classList.toggle('is-active', j === idx);
        });
        // recolor all existing cats via target color (smooth lerp in loop)
        for (var i = 0; i < cats.length; i++){
          cats[i].targetColor.setHex(entry.hex);
        }
      });
      swatchesEl.appendChild(sw);
    });
  }
  buildSwatches();

  gravInput.addEventListener('input', function(){
    var v = parseFloat(gravInput.value);
    gravVal.textContent = v.toFixed(2);
    world.gravity.y = -v;
    // wake bodies so they respond to the new gravity immediately
    for (var i = 0; i < cats.length; i++) cats[i].body.wakeUp();
  });
  bounInput.addEventListener('input', function(){
    var v = parseFloat(bounInput.value);
    bounVal.textContent = v.toFixed(2);
    cmFloorCat.restitution = v;
    cmCatCat.restitution = v;
    floorMat.restitution = v;
    catMat.restitution = v;
  });

  // ------------------------------------------------------------------
  // Initial scene: 5 gently staggered cats
  // ------------------------------------------------------------------
  function seedCats(){
    var starts = [
      [-2.1, 0.9, 0.0],
      [ 0.0, 1.1, -0.8],
      [ 2.0, 0.9, 0.6],
      [-0.9, 1.3, 1.4],
      [ 1.1, 1.0, -1.6]
    ];
    starts.forEach(function(s){
      spawnCat(s[0], s[1], s[2], currentColor.clone());
    });
  }

  // ------------------------------------------------------------------
  // Resize
  // ------------------------------------------------------------------
  function onResize(){
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  var lastTime = null;
  function animate(t){
    requestAnimationFrame(animate);
    if (lastTime === null){ lastTime = t; }
    var dt = (t - lastTime) / 1000;
    lastTime = t;
    dt = Math.min(dt, 0.1); // clamp to avoid spiral of death

    world.step(1 / 60, dt, 3);

    for (var i = 0; i < cats.length; i++){
      var cat = cats[i];
      var b = cat.body;
      var g = cat.group;

      // sync visuals to physics
      g.position.copy(b.position);
      g.quaternion.copy(b.quaternion);

      // live color lerp toward target (palette changes are smooth)
      cat.color.lerp(cat.targetColor, 0.1);
      cat.bodyMat.color.copy(cat.color);
      cat.headMat.color.copy(cat.color);

      // squish spring + falling stretch
      updateSquish(cat, dt);

      // drag follow
      if (dragged === cat){
        raycaster.setFromCamera(pointer, camera);
        var target = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, target)){
          b.position.lerp(target, 0.55);
          b.velocity.set(0, 0, 0);
          b.angularVelocity.set(0, 0, 0);
          b.wakeUp();
        }
      }
    }

    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot(){
    initPhysics();
    initThree();
    seedCats();
    onResize();
    lastTime = performance.now();
    requestAnimationFrame(animate);
  }
  boot();
})();
