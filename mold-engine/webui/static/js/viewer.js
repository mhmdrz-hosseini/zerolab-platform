// Three.js viewport — the web stand-in for Blender's 3D view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PART_COLORS = [0x4f8cff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xb28dff, 0xff9f43];
const MASTER_COLOR = 0xaab2bd;

// The exported STLs are already in print orientation with their bottom at
// file-Z=0 (Blender is Z-up). The viewer is Y-up, so file +Z must map to
// world +Y — rotation about X by -90° does exactly that, putting each part's
// bed face exactly on the world y=0 plane.
const PRINT_ROT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0));
const IDENTITY_QUAT = new THREE.Quaternion();

// Reference FDM bed (must match webui/print_orientation.py): the plate never
// renders smaller than this so the familiar 220×220 footprint is visible.
const REF_BED = 220;
const LAYOUT_GAP = 8;        // mm between parts on the plate
const PLATE_MARGIN = 15;     // mm between content and plate edge

export class Viewer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161b);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50000);
    this.camera.position.set(60, 45, 75);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // studio-ish lighting
    const hemi = new THREE.HemisphereLight(0xdde6ff, 0x2a2c33, 1.05);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(80, 120, 60);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5);
    fill.position.set(-70, 30, -50);
    this.scene.add(fill);

    this.master = null;          // the uploaded model (Group holding the Object3D)
    this.masterHome = new THREE.Vector3();   // rest position (explode undoes to it)
    this.masterVisible = true;
    this.parts = [];             // [{mesh, center, dir, assembly, print, visible}]
    this.skin = null;
    this.skinVisible = true;
    this.explode = 0;
    this.wireframe = false;
    this.grid = null;
    this.plate = null;           // the print-bed group (plate + grid + border)
    this.printMode = false;      // parts on the build plate vs. assembled mold

    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this._loop();
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _material(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color, roughness: 0.55, metalness: 0.08,
      side: THREE.DoubleSide, ...opts,
    });
  }

  _prepGeometry(geom) {
    if (!geom.attributes.normal) geom.computeVertexNormals();
    geom.computeBoundingBox();
    return geom;
  }

  // ---- master (uploaded model) ----

  setMaster(object3d, { zUpFile = true } = {}) {
    if (this.master) this._dispose(this.master);
    // Files authored Y-up (glTF) display rotated so the preview matches the
    // Z-up orientation Blender's importer will use.
    if (!zUpFile) object3d.rotation.x = -Math.PI / 2;
    object3d.traverse(o => {
      if (o.isMesh) {
        o.material = this._material(0xaab2bd);
        this._prepGeometry(o.geometry);
      }
    });
    // Hold the file in a Group so the intake step can spin the model in
    // world axes (intake's rotation control) without touching the file's
    // own import orientation.
    const holder = new THREE.Group();
    holder.add(object3d);
    this.master = holder;
    this.scene.add(holder);
    this.masterHome.set(0, 0, 0);
    this._rebuildGrid();
    this.fitView();
  }

  clearMaster() {
    if (this.master) this._dispose(this.master);
    this.master = null;
    this.masterHome.set(0, 0, 0);
    this._rebuildGrid();
  }

  // drop any generated mold parts/skin (e.g. when a new model is loaded)
  clearOutputs() {
    for (const p of this.parts) this._dispose(p.mesh);
    this.parts = [];
    if (this.skin) this._dispose(this.skin);
    this.skin = null;
    if (this.plate) { this._dispose(this.plate); this.plate = null; }
    this.printMode = false;
    if (this.grid) this.grid.visible = true;
  }

  setMasterVisible(v) {
    this.masterVisible = v;
    if (this.master) this.master.visible = v && !this.printMode;
  }

  // ---- generated mold parts ----
  // geoms: [{name, geometry, isMaster, quaternion, assemblyCenter}] — the
  // geometry arrives in its RECOMMENDED PRINT ORIENTATION (bottom at Z=0,
  // exactly as exported); `quaternion` is the backend's print rotation and
  // `assemblyCenter` the part's original position, together enough to put
  // the part back into the assembled mold for the assembly view.
  setParts(geoms) {
    for (const p of this.parts) this._dispose(p.mesh);
    this.parts = [];
    if (this.plate) { this._dispose(this.plate); this.plate = null; }

    const all = new THREE.Vector3();
    geoms.forEach((g, i) => {
      const geom = this._prepGeometry(g.geometry);
      const mesh = new THREE.Mesh(geom, this._material(
        g.isMaster ? MASTER_COLOR : PART_COLORS[i % PART_COLORS.length]));
      mesh.name = g.name;
      this.scene.add(mesh);

      // assembly placement: undo the print rotation, land the bbox center
      // back where the pipeline put the part
      const invQ = g.quaternion ? new THREE.Quaternion(...g.quaternion).invert()
                                : null;
      const geomCenter = geom.boundingBox.getCenter(new THREE.Vector3());
      if (invQ) geomCenter.applyQuaternion(invQ);
      const aCenter = g.assemblyCenter
        ? new THREE.Vector3(...g.assemblyCenter) : geomCenter.clone();
      const assembly = {
        quat: invQ || IDENTITY_QUAT,
        pos: aCenter.clone().sub(geomCenter),
      };

      all.add(aCenter);
      this.parts.push({
        mesh, center: aCenter, dir: new THREE.Vector3(),
        assembly, print: null, visible: true, isMaster: !!g.isMaster,
      });
    });
    all.divideScalar(Math.max(geoms.length, 1));
    for (const p of this.parts) p.dir.subVectors(p.center, all);

    this._layoutPlate(geoms);
    this.setPrintMode(true);          // results open on the build plate
    this.setWireframe(this.wireframe);
  }

  togglePart(i, visible) {
    if (!this.parts[i]) return;
    this.parts[i].visible = visible;
    this._syncPartVisibility();
  }

  // The Master STL lives on the print bed; in the assembly view the uploaded
  // model preview already represents it (the two would overlap exactly).
  _syncPartVisibility() {
    for (const p of this.parts)
      p.mesh.visible = p.visible && !(p.isMaster && !this.printMode);
  }

  // Shelf-pack the parts side by side on a square plate (like objects arranged
  // on a printer bed). Footprints come from each geometry's print-frame bbox:
  // file X stays world X, file Y maps to world -Z.
  _layoutPlate(geoms) {
    const items = geoms.map((g, i) => {
      const b = this.parts[i].mesh.geometry.boundingBox;
      return {
        part: this.parts[i],
        min: b.min, max: b.max,
        w: b.max.x - b.min.x, d: b.max.y - b.min.y,
      };
    });
    const maxW = Math.max(...items.map(it => it.w), 1);
    const rowLimit = Math.max(REF_BED - 2 * PLATE_MARGIN, maxW + LAYOUT_GAP);
    const rows = [[]];
    let rowW = 0;
    for (const it of items) {
      if (rows[rows.length - 1].length && rowW + LAYOUT_GAP + it.w > rowLimit) {
        rows.push([]); rowW = 0;
      }
      if (rows[rows.length - 1].length) rowW += LAYOUT_GAP;
      rows[rows.length - 1].push(it);
      rowW += it.w;
    }
    const contentW = Math.max(...rows.map(r =>
      r.reduce((s, it) => s + it.w + LAYOUT_GAP, -LAYOUT_GAP)), 0);
    const contentD = rows.reduce((s, r) =>
      s + Math.max(...r.map(it => it.d), 0), 0)
      + LAYOUT_GAP * (rows.length - 1);
    const size = Math.ceil(Math.max(
      REF_BED, contentW + 2 * PLATE_MARGIN, contentD + 2 * PLATE_MARGIN) / 10) * 10;

    let z = -contentD / 2;
    for (const row of rows) {
      const rowWidth = row.reduce((s, it) => s + it.w + LAYOUT_GAP, -LAYOUT_GAP);
      let x = -rowWidth / 2;
      const rowD = Math.max(...row.map(it => it.d), 0);
      for (const it of row) {
        // world z of a file point is -file.y, so shifting by +max.y parks the
        // part's near edge at the row cursor; +0.02 lifts it off the grid lines
        it.part.print = {
          pos: new THREE.Vector3(x - it.min.x, 0.02, z + it.max.y),
        };
        x += it.w + LAYOUT_GAP;
      }
      z += rowD + LAYOUT_GAP;
    }
    this._buildPlate(size);
  }

  _buildPlate(size) {
    if (this.plate) this._dispose(this.plate);
    const group = new THREE.Group();
    group.name = 'printPlate';

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        color: 0x1b1f26, roughness: 0.9, metalness: 0.05,
      }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.05;
    group.add(plane);

    const step = size > 400 ? 50 : 10;
    const grid = new THREE.GridHelper(size, Math.round(size / step),
      0x46536b, 0x2a3140);
    group.add(grid);

    const h = size / 2;
    const border = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h),
        new THREE.Vector3(h, 0, -h), new THREE.Vector3(h, 0, h),
        new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h),
        new THREE.Vector3(-h, 0, h), new THREE.Vector3(-h, 0, -h),
      ]),
      new THREE.LineBasicMaterial({ color: 0x5b6877 }));
    group.add(border);
    this.scene.add(group);
    this.plate = group;
  }

  // Print bed (default) vs. assembled mold: same meshes, two placements.
  setPrintMode(on) {
    if (!this.parts.length && on) return;
    this.printMode = on;
    if (this.plate) this.plate.visible = on;
    if (this.grid) this.grid.visible = !on;
    this._applyPartTransforms();
    this._syncPartVisibility();
    if (this.master) this.master.visible = !on && this.masterVisible;
    if (this.skin) this.skin.visible = !on && this.skinVisible;
  }

  _applyPartTransforms() {
    for (const p of this.parts) {
      if (this.printMode && p.print) {
        p.mesh.quaternion.copy(PRINT_ROT);
        p.mesh.position.copy(p.print.pos);
      } else if (!this.printMode) {
        p.mesh.quaternion.copy(p.assembly.quat);
        p.mesh.position.copy(p.assembly.pos);
        if (this.explode > 0 && p.dir.lengthSq() > 1e-9) {
          p.mesh.position.addScaledVector(
            p.dir.clone().normalize(), this.explode * this._diag() * 0.55);
        }
      }
    }
  }

  setSkin(geom) {
    if (this.skin) this._dispose(this.skin);
    this.skin = new THREE.Mesh(this._prepGeometry(geom),
      this._material(0x2fb565, {
        transparent: true, opacity: 0.35, depthWrite: false,
        roughness: 0.35,
      }));
    this.skin.visible = this.skinVisible;
    this.scene.add(this.skin);
  }

  setSkinVisible(v) {
    this.skinVisible = v;
    if (this.skin) this.skin.visible = v && !this.printMode;
  }

  setExplode(f) {
    this.explode = f;
    if (this.printMode) return;         // parts are laid out on the plate
    const k = f * this._diag() * 0.55;
    let moved = false;
    for (const p of this.parts) {
      p.mesh.position.copy(p.assembly.pos);
      if (p.dir.lengthSq() > 1e-9) {
        p.mesh.position.add(p.dir.clone().normalize().multiplyScalar(k));
        moved = true;
      }
    }
    // One-piece molds (tray / open pour, solid block) have no second part to
    // slide away: the exploded view instead lifts the master straight up out
    // of the cavity, so the slider still shows how the cast comes out.
    if (this.master) {
      if (!moved && this.parts.length) {
        this.master.position.set(
          this.masterHome.x, this.masterHome.y, this.masterHome.z + k);
      } else {
        this.master.position.copy(this.masterHome);
      }
    }
  }

  setWireframe(v) {
    this.wireframe = v;
    const apply = o => { if (o.isMesh) o.material.wireframe = v; };
    if (this.master) this.master.traverse(apply);
    this.parts.forEach(p => apply(p.mesh));
    if (this.skin) apply(this.skin);
  }

  // ---- framing ----

  _bounds() {
    const box = new THREE.Box3();
    let any = false;
    if (this.master && this.masterVisible && !this.printMode) {
      box.expandByObject(this.master); any = true;
    }
    for (const p of this.parts) {
      if (!p.mesh.visible) continue;
      const b = new THREE.Box3().setFromObject(p.mesh);
      box.union(b); any = true;
    }
    if (this.plate && this.plate.visible) {
      box.expandByObject(this.plate); any = true;
    }
    if (this.skin && this.skinVisible && !this.printMode) {
      box.expandByObject(this.skin); any = true;
    }
    return any ? box : null;
  }

  _diag() {
    const b = this._bounds();
    return b ? b.getSize(new THREE.Vector3()).length() : 100;
  }

  modelBBox() {
    if (!this.master) return null;
    const b = new THREE.Box3().setFromObject(this.master);
    const s = b.getSize(new THREE.Vector3());
    return { sizeX: s.x, sizeY: s.y, sizeZ: s.z };
  }

  // Orient the master in world axes (degrees X/Y/Z, applied over the file's
  // import orientation). This mirrors what the driver bakes into the mesh.
  setMasterSpin(rx, ry, rz) {
    if (!this.master) return;
    this.master.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz));
    this.master.updateMatrixWorld(true);
  }

  // World bbox the master would have at uniform scale 1, keeping the current
  // orientation — the reference frame for the intake size math. The live
  // (scaled) view is restored before returning.
  masterBBoxAtScale1() {
    if (!this.master) return null;
    const s = this.master.scale.x;
    this.master.scale.setScalar(1);
    this.master.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.master);
    const size = b.getSize(new THREE.Vector3());
    this.master.scale.setScalar(s);
    this.master.updateMatrixWorld(true);
    return { sizeX: size.x, sizeY: size.y, sizeZ: size.z };
  }

  fitView() {
    const b = this._bounds();
    if (!b) return;
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const diag = Math.max(size.length(), 1e-3);
    const dist = diag / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.35;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(
      new THREE.Vector3(0.62, 0.5, 0.85).normalize().multiplyScalar(dist));
    this.camera.near = diag / 500;
    this.camera.far = diag * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._rebuildGrid(diag, center);
  }

  _rebuildGrid(diag, center) {
    if (this.grid) { this._dispose(this.grid); this.grid = null; }
    if (diag === undefined) {
      diag = this._diag();
      const b = this._bounds();
      center = b ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    }
    if (!isFinite(diag) || diag <= 0) return;
    const size = Math.ceil(diag * 1.4);
    const step = Math.pow(10, Math.floor(Math.log10(diag / 5)));
    const grid = new THREE.GridHelper(size, Math.round(size / step),
      0x3a3f4a, 0x25282f);
    grid.position.set(center.x, 0, center.z);
    grid.visible = !this.printMode;   // the build plate replaces it in print view
    this.scene.add(grid);
    this.grid = grid;
  }

  _dispose(obj) {
    this.scene.remove(obj);
    obj.traverse?.(o => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
        .forEach(m => m.dispose());
    });
  }
}
